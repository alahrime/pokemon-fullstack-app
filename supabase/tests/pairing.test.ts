import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { sql, asUser } from './helpers';

const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('pairing', () => {
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  let versionId = '';

  // Every assertion in this file is scoped to these three users. The pairing
  // functions are global by design — `pair_queue_entries()` scans the whole
  // queue and `sweep_expired()` sweeps every table — and this suite runs
  // against the partner's real local database alongside other test files
  // running in parallel. An unscoped `select count(*) from matches` would be
  // reading somebody else's rows.
  const mine = () => `player_a in ('${a}','${b}','${c}') or player_b in ('${a}','${b}','${c}')`;
  const myEntries = () => `user_id in ('${a}','${b}','${c}')`;

  /**
   * Independent connections. `helpers.ts` deliberately shares ONE connection
   * with `max: 1`, which cannot express a race: two queries on it are
   * serialised by the pool before they ever reach Postgres. A test about two
   * transactions overlapping has to own its own sockets.
   */
  const conn = () => postgres(CONNECTION_STRING, { max: 1 });

  /**
   * Opens a fresh connection, begins a transaction, and runs `query` inside
   * it, holding the transaction open until `release()` is called. Used to
   * hold a row lock across an `await` boundary so a concurrent test body can
   * prove it is blocked (plain `for update`) or skipped (`skip locked`) by
   * another transaction. Only resolves once the locking query has actually
   * completed, so the caller never races the lock's own acquisition.
   */
  async function hold(query: string) {
    const client = conn();
    let announceLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((r) => (announceLocked = r));
    const gate = new Promise<void>((r) => (release = r));
    const held = client.begin(async (tx) => {
      await tx.unsafe(query);
      announceLocked();
      await gate;
    });
    await locked;
    return {
      release: async () => {
        release();
        await held;
        await client.end();
      },
    };
  }

  // A long-lived side connection for role-scoped queries (`set local role` is
  // transaction-scoped, so it needs a transaction, and `sql()` gives none).
  const alt = conn();
  const asRole =
    (role: string) =>
    async <T = Record<string, unknown>>(query: string): Promise<T[]> =>
      alt.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        return tx.unsafe(query) as unknown as Promise<T[]>;
      }) as unknown as Promise<T[]>;

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    for (const [id, n] of [
      [a, 'PA'],
      [b, 'PB'],
      [c, 'PC'],
    ] as const)
      await makeUser(id, `${n}_${id.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${a}', 'Pair Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cc') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.match_offers where proposer_id in ('${a}','${b}','${c}')`);
    await sql(`delete from public.matches where ${mine()}`);
    await sql(`delete from public.queue_entries where ${myEntries()}`);
  });

  afterAll(async () => {
    await alt.end();
    // The fixtures cascade out of auth.users: profiles, formats and
    // format_versions all go with them, so nothing this file created is left
    // in the partner's database.
    await sql(`delete from auth.users where id in ('${a}','${b}','${c}')`);
  });

  const enqueue = (user: string, hash: string | null = 'cc', team = '[]', rev = 'rev1') =>
    sql(`insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('${user}', 'great', '${versionId}', 'cc', ${hash === null ? 'null' : `'${hash}'`}, '${team}'::jsonb, '${rev}')`);

  const pair = async () => {
    const [row] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    return Number(row.pair_queue_entries);
  };

  const offer = async (extraCols = '', extraVals = '') => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility${extraCols})
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '["A"]'::jsonb, 'rev1', 'public'${extraVals}) returning id`,
    );
    return o;
  };

  it('pairs two verified entries sharing a hash, and consumes them', async () => {
    await enqueue(a, 'cc', '["A"]');
    await enqueue(b, 'cc', '["B"]');
    expect(await pair()).toBe(1);
    expect(
      await sql<{ team_a: unknown; team_b: unknown; source: string; rules_hash: string }>(
        `select team_a, team_b, source, rules_hash from public.matches where ${mine()}`,
      ),
    ).toEqual([{ team_a: ['A'], team_b: ['B'], source: 'queue', rules_hash: 'cc' }]);
    expect(await sql(`select id from public.queue_entries where ${myEntries()}`)).toHaveLength(0);
  });

  it('leaves an unverified entry alone — the trust boundary', async () => {
    await enqueue(a);
    await enqueue(b, null);
    expect(await pair()).toBe(0);
    expect(await sql(`select id from public.queue_entries where ${myEntries()}`)).toHaveLength(2);
  });

  it('does not pair entries whose hashes differ', async () => {
    await enqueue(a);
    await enqueue(b, 'dd');
    expect(await pair()).toBe(0);
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
  });

  /**
   * The `data_rev` leg of the pairing predicate, which nothing else here can
   * fail: every other test uses one data build, so dropping the clause would
   * leave them all green. A random draw both sides compute has to deal from
   * the same pool.
   */
  it('does not pair two clients on different data builds', async () => {
    await enqueue(a, 'cc', '[]', 'rev1');
    await enqueue(b, 'cc', '[]', 'rev2');
    expect(await pair()).toBe(0);
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
  });

  it('leaves the odd one out queued when three are waiting', async () => {
    await enqueue(a);
    await enqueue(b);
    await enqueue(c);
    expect(await pair()).toBe(1);
    expect(await sql(`select id from public.queue_entries where ${myEntries()}`)).toHaveLength(1);
  });

  /**
   * The SKIP LOCKED proof, made deterministic.
   *
   * A true race can only ever say "no duplicate happened this time". This says
   * something stronger and repeatable: while another transaction holds these
   * rows, a tick must SKIP them and return promptly. Written with plain `for
   * update` the same call would block on the held rows instead of returning,
   * so the 2s ceiling is the assertion that distinguishes the two.
   *
   * Three legs, because "returned 0" on its own is indistinguishable from
   * "there was nothing to pair": (a) the tick reports 0 and quickly, (b) no
   * match appeared, and (c) once the lock is released the very same rows pair.
   */
  it('skips rows another tick already holds, rather than blocking on them', { timeout: 20000 }, async () => {
    await enqueue(a);
    await enqueue(b);

    const lock = await hold(`select id from public.queue_entries where ${myEntries()} for update`);
    // On its own connection, so a regression that blocks stalls this call
    // rather than the shared connection every other assertion here uses.
    const runner = conn();
    try {
      const settled = await Promise.race([
        runner
          .unsafe(`select public.pair_queue_entries()`)
          .then((r) => ({ done: true, n: Number((r[0] as { pair_queue_entries: number }).pair_queue_entries) })),
        new Promise<{ done: boolean; n: number }>((r) => setTimeout(() => r({ done: false, n: -1 }), 2000)),
      ]);
      expect(settled).toEqual({ done: true, n: 0 });
      expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
    } finally {
      // Unconditionally: a failed assertion above must not leave rows locked,
      // or `afterEach` blocks on them and every later test in this file times
      // out for a reason that has nothing to do with what broke.
      await lock.release();
      await runner.end();
    }

    // Leg (c): the rows were pairable all along.
    expect(await pair()).toBe(1);
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
  });

  /**
   * The race itself: two coordinator ticks overlapping, which is the normal
   * failure of any timer — a tick that runs long while the next one fires.
   * The invariant is not "exactly one match": with SKIP LOCKED the two ticks
   * may each claim one of the two rows and pair nothing, which is safe and
   * self-correcting. The invariant is that two entries never become two
   * matches, and that what the ticks REPORT matches what they wrote.
   *
   * This is the shape of bug M1b shipped: an effect that ran twice under a
   * remount and duplicated every row, invisible to 1056 tests that all
   * exercised a single run.
   */
  it('never turns two entries into two matches when two ticks overlap', { timeout: 20000 }, async () => {
    await enqueue(a);
    await enqueue(b);
    const [c1, c2] = [conn(), conn()];
    const [r1, r2] = await Promise.all([
      c1.unsafe(`select public.pair_queue_entries()`),
      c2.unsafe(`select public.pair_queue_entries()`),
    ]);
    await Promise.all([c1.end(), c2.end()]);
    const reported =
      Number((r1[0] as { pair_queue_entries: number }).pair_queue_entries) +
      Number((r2[0] as { pair_queue_entries: number }).pair_queue_entries);

    const matches = await sql(`select id from public.matches where ${mine()}`);
    const left = await sql(`select id from public.queue_entries where ${myEntries()}`);
    // What was reported is what was written — a tick that returns 1 while
    // another already consumed the rows is the duplicate bug reporting itself.
    expect(matches).toHaveLength(reported);
    expect(matches.length).toBeLessThanOrEqual(1);
    if (matches.length === 1) {
      expect(left).toHaveLength(0);
    } else {
      // Nothing was consumed, and the next tick still pairs them.
      expect(left).toHaveLength(2);
      expect(await pair()).toBe(1);
    }
  });

  it('records the taker\'s own team as team_b, not an empty roster', async () => {
    const o = await offer();
    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
    expect(
      await sql<{ team_a: unknown; team_b: unknown; source: string }>(
        `select team_a, team_b, source from public.matches where ${mine()}`,
      ),
    ).toEqual([{ team_a: ['A'], team_b: ['B'], source: 'offer' }]);
    expect(
      await sql<{ state: string; accepted_team: unknown }>(
        `select state, accepted_team from public.match_offers where id = '${o.id}'`,
      ),
    ).toEqual([{ state: 'converted', accepted_team: ['B'] }]);
  });

  /**
   * The race. Two independent connections accept the same offer at the same
   * moment. One must win and one must be told no — and crucially there must be
   * exactly ONE match, not two. Counting rejections is not enough: a rejection
   * for the wrong reason counts the same, which is how a false pass gets
   * recorded, so the refusal's message is asserted too.
   */
  it('lets only one of two simultaneous accepts through', { timeout: 20000 }, async () => {
    const o = await offer();
    const [c1, c2] = [conn(), conn()];
    const accept = (client: ReturnType<typeof conn>, who: string, team: string) =>
      client.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
        return tx.unsafe(`select public.accept_offer('${o.id}', '${team}'::jsonb)`);
      });
    const results = await Promise.allSettled([accept(c1, b, '["B"]'), accept(c2, c, '["C"]')]);
    await Promise.all([c1.end(), c2.end()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(refused.reason?.message)).toMatch(/no longer open/);
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
  });

  /**
   * `accept_offer` uses plain `for update`, NOT skip locked, deliberately: a
   * second accept must WAIT and then be told the offer is taken. Skipping
   * would find no row and answer "no such offer" — a different and misleading
   * thing to tell someone whose opponent beat them by a tenth of a second.
   *
   * The race above cannot tell those apart on its own, because a run where the
   * two transactions happen not to overlap produces the same tally. Here the
   * overlap is forced: a third connection holds the offer row, and the accept
   * must still be unfinished half a second later.
   */
  it('makes a second accept wait for the row rather than declaring it missing', { timeout: 20000 }, async () => {
    const o = await offer();
    const lock = await hold(`select id from public.match_offers where id = '${o.id}' for update`);
    const runner = conn();
    // Declared outside the try so the `finally` below can release the lock
    // and then wait for this to unblock, rather than leaving it dangling —
    // otherwise a failed assertion here leaves the row locked forever and
    // `afterEach`'s delete on it wedges every later test in this file, which
    // is exactly the failure mode the previous attempt on this task flagged.
    let accepting!: Promise<unknown>;
    try {
      accepting = runner.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: b })]);
        return tx.unsafe(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
      });
      const early = await Promise.race([
        accepting.then(() => 'settled').catch((e: Error) => `failed: ${e.message}`),
        new Promise<string>((r) => setTimeout(() => r('still waiting'), 600)),
      ]);
      expect(early).toBe('still waiting');
    } finally {
      await lock.release();
      await accepting.catch(() => {});
      await runner.end();
    }
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
  });

  it('holds a scheduled offer until the proposer confirms it too', async () => {
    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
    // One-sided acceptance is not a match.
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
    expect(
      await sql<{ state: string; accepted_team: unknown }>(
        `select state, accepted_team from public.match_offers where id = '${o.id}'`,
      ),
    ).toEqual([{ state: 'accepted', accepted_team: ['B'] }]);

    await asUser({ sub: a })(`select public.confirm_offer('${o.id}')`);
    // The roster the taker accepted with is what the match is played on — the
    // proposer's confirmation does not get to supply it for them.
    expect(
      await sql<{ team_a: unknown; team_b: unknown }>(`select team_a, team_b from public.matches where ${mine()}`),
    ).toEqual([{ team_a: ['A'], team_b: ['B'] }]);
  });

  it('lets nobody but the proposer confirm a scheduled offer', async () => {
    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
    await expect(asUser({ sub: c })(`select public.confirm_offer('${o.id}')`)).rejects.toThrow(/only the proposer/);
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
  });

  it('refuses to let someone accept their own offer', async () => {
    const o = await offer();
    await expect(asUser({ sub: a })(`select public.accept_offer('${o.id}', '["A"]'::jsonb)`)).rejects.toThrow(
      /cannot accept your own offer/,
    );
  });

  it('refuses an accept on an offer the coordinator has not verified', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
       values ('${a}', '${versionId}', 'cc', 'great', '["A"]'::jsonb, 'rev1', 'public') returning id`,
    );
    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
      /not been verified/,
    );
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
  });

  it('refuses an accept with no team at all', async () => {
    const o = await offer();
    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', null)`)).rejects.toThrow(
      /team you are accepting with/,
    );
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
  });

  it('refuses an accept from a request carrying no identity', async () => {
    const o = await offer();
    await expect(asRole('authenticated')(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
      /signed in/,
    );
  });

  it('lapses an unconfirmed offer rather than converting it', async () => {
    const o = await offer(', expires_at', `, now() - interval '1 minute'`);
    await sql(`select public.sweep_expired()`);
    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([
      { state: 'lapsed' },
    ]);
    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
  });

  it('drops a queue entry that waited too long, and leaves a fresh one', async () => {
    await enqueue(a);
    await sql(`update public.queue_entries set expires_at = now() - interval '1 minute' where user_id = '${a}'`);
    await enqueue(b);
    await sql(`select public.sweep_expired()`);
    expect(await sql<{ user_id: string }>(`select user_id from public.queue_entries where ${myEntries()}`)).toEqual([
      { user_id: b },
    ]);
  });

  /**
   * The coordinator in Task 6 calls these two over PostgREST as `service_role`.
   * Nothing else in this repo grants that role anything, so if this migration
   * does not, the first tick fails with permission denied.
   */
  it('runs the coordinator functions as service_role and refuses everyone else', async () => {
    await expect(asRole('anon')(`select public.pair_queue_entries()`)).rejects.toThrow(/permission denied/);
    await expect(asRole('authenticated')(`select public.pair_queue_entries()`)).rejects.toThrow(/permission denied/);
    await expect(asRole('anon')(`select public.sweep_expired()`)).rejects.toThrow(/permission denied/);
    await expect(asRole('authenticated')(`select public.sweep_expired()`)).rejects.toThrow(/permission denied/);
    expect(await asRole('service_role')(`select public.pair_queue_entries()`)).toHaveLength(1);
    expect(await asRole('service_role')(`select public.sweep_expired()`)).toHaveLength(1);
  });

  it('refuses an accept from a request with no session at all', async () => {
    const o = await offer();
    await expect(asRole('anon')(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
      /permission denied/,
    );
  });

  /**
   * The invariant Task 4 deferred: `accepted_team` was added with no
   * constraint tying it to `accepted_by`. An `accepted_by` without a team is
   * an acceptance whose roster was lost, and `confirm_offer` would then try to
   * write a null into `matches.team_b`, which is NOT NULL — a failure at
   * confirmation time for a mistake made at acceptance time.
   */
  it('refuses an acceptance recorded without the taker\'s team', async () => {
    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
    await expect(
      sql(`update public.match_offers set accepted_by = '${b}', accepted_at = now() where id = '${o.id}'`),
    ).rejects.toThrow(/match_offers_accepted_needs_team/);
    // The row is untouched...
    expect(
      await sql<{ accepted_by: string | null }>(`select accepted_by from public.match_offers where id = '${o.id}'`),
    ).toEqual([{ accepted_by: null }]);
    // ...and the same write, with the team it was missing, goes through.
    expect(
      await sql(
        `update public.match_offers set accepted_by = '${b}', accepted_team = '["B"]'::jsonb, accepted_at = now()
         where id = '${o.id}' returning id`,
      ),
    ).toHaveLength(1);
  });

  /**
   * The constraint is deliberately one-directional. `accepted_by` is
   * `on delete set null`, so deleting the taker's account nulls it while
   * `accepted_team` stays — a snapshot of a roster with nobody attached. A
   * symmetric "both null or both set" constraint would turn that cascade into
   * an error and make the account undeletable.
   */
  it('still lets the taker delete their account after accepting', async () => {
    const t = randomUUID();
    await makeUser(t, `PT_${t.slice(0, 8)}`);
    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
    await expect(sql(`delete from auth.users where id = '${t}'`)).resolves.toBeDefined();
    expect(
      await sql<{ accepted_by: string | null; accepted_team: unknown }>(
        `select accepted_by, accepted_team from public.match_offers where id = '${o.id}'`,
      ),
    ).toEqual([{ accepted_by: null, accepted_team: ['T'] }]);
  });
});
