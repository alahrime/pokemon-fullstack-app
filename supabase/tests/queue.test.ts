import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon, refusal, rollingBack, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

describe('queue and match policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(userA, `QA_${userA.slice(0, 8)}`);
    await makeUser(userB, `QB_${userB.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${userA}', 'Queue Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a in ('${userA}','${userB}') or player_b in ('${userA}','${userB}')`);
    await sql(`delete from public.queue_entries where user_id in ('${userA}','${userB}')`);
  });

  const enqueue = (owner: string) =>
    asUser({ sub: owner })<{ id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning id`,
    );

  it('lets someone join the queue without naming themselves', async () => {
    const rows = await asUser({ sub: userA })<{ user_id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning user_id`,
    );
    expect(rows[0].user_id).toBe(userA);
  });

  it('refuses a queue entry made on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, team, data_rev)
         values ('${userA}', 'great', '${versionId}', 'aa', '[]'::jsonb, 'rev1')`),
    ).rejects.toThrow(/row-level security/);
  });

  /**
   * C1, measured against this database before the fix: a plain authenticated
   * user inserted a queue entry that already carried its own `verified_hash`
   * and it returned INSERT 0 1.
   *
   * That is the whole trust boundary. `pair_queue_entries` only ever pairs
   * rows where `verified_hash is not null`, and the coordinator only ever
   * READS rows where it `is null` — so a self-verified row is never
   * recomputed, never examined, and pairs on the next tick with whatever
   * `claimed_hash` its author felt like typing. Verification was, until the
   * fix, something a client could simply decline.
   *
   * The refusal is the POLICY class, named explicitly: the WITH CHECK clause
   * rejects the row. The insert immediately above this test is the control —
   * identical in every respect but this column, and it succeeds.
   */
  it('refuses a queue entry that arrives already verified', async () => {
    const denied = await refusal(() =>
      asUser({ sub: userA })(
        `insert into public.queue_entries (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('great', '${versionId}', 'I-NEVER-COMPUTED-THIS', 'forged-verified-hash', '[]'::jsonb, 'rev1')`),
    );
    expect(denied.code).toBe('42501');
    expect(denied.message).toMatch(POLICY_DENIED);
    expect(await sql(`select id from public.queue_entries where user_id = '${userA}'`)).toHaveLength(0);
  });

  /**
   * The other route to the same column: join honestly, then edit. Both have to
   * be shut or neither is.
   *
   * A DIFFERENT class of refusal from the one above, and the distinction is
   * the point — `authenticated` holds no UPDATE grant on this table at all, so
   * this is raised as `permission denied for table queue_entries` before any
   * row is considered, rather than being silently filtered to 0 rows the way
   * an excluded USING clause would be.
   */
  it('refuses its owner editing verified_hash onto an entry after the fact', async () => {
    await enqueue(userA);
    const denied = await refusal(() =>
      asUser({ sub: userA })(
        `update public.queue_entries set verified_hash = 'forged-verified-hash' where user_id = '${userA}'`),
    );
    expect(denied.code).toBe('42501');
    expect(denied.message).toMatch(PRIVILEGE_DENIED);
    expect(denied.message).not.toMatch(POLICY_DENIED);
    expect(
      await sql<{ verified_hash: string | null }>(
        `select verified_hash from public.queue_entries where user_id = '${userA}'`,
      ),
    ).toEqual([{ verified_hash: null }]);
  });

  /**
   * TRUNCATE, found while measuring the two Criticals and in the same family.
   * The default grant included it, and TRUNCATE does not consult row-level
   * security at all — so one signed-in client could empty every user's queue
   * with a single statement, and RLS would not have been asked.
   *
   * Rolled back regardless of outcome: this suite runs against the partner's
   * real local database, and a test that emptied their queue to prove it
   * could would be the defect rather than the check for it.
   */
  it('refuses a client truncating the whole queue, which RLS would never have seen', async () => {
    await enqueue(userA);
    const denied = await refusal(() =>
      // Wrapped in a transaction that ALWAYS rolls back, so a regression here
      // reports itself instead of emptying the partner's queue to prove it
      // could. TRUNCATE is transactional, and the privilege check runs when
      // the statement executes, so the evidence is identical either way. The
      // sentinel is what keeps the two apart: without it, "the truncate ran
      // and we undid it" and "the truncate was refused" both look like a
      // rejected promise.
      rollingBack(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userA })]);
        await tx.unsafe(`truncate public.queue_entries`);
      }),
    );
    expect(denied.code).toBe('42501');
    expect(denied.message).toMatch(PRIVILEGE_DENIED);
    // Still there — and since the block above can only have rolled back, this
    // is the refusal's doing rather than the rollback's.
    expect(await sql(`select id from public.queue_entries where user_id = '${userA}'`)).toHaveLength(1);
  });

  it('hides a queue entry from everyone but its owner', async () => {
    await enqueue(userA);
    expect(await asUser({ sub: userB })(`select id from public.queue_entries`)).toHaveLength(0);
    expect(await asAnon()(`select id from public.queue_entries`)).toHaveLength(0);
  });

  it('allows only one queue entry per person', async () => {
    await enqueue(userA);
    await expect(enqueue(userA)).rejects.toThrow(/queue_entries_one_per_user/);
  });

  it('lets a player see a match they are in, and nobody else see it', async () => {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-1','queue') returning id`,
    );
    expect(await asUser({ sub: userA })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(1);
    const stranger = randomUUID();
    await makeUser(stranger, `QS_${stranger.slice(0, 8)}`);
    expect(await asUser({ sub: stranger })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(0);
  });

  /** The reason this table exists as coordinator-only. */
  it('refuses a match inserted by a player, even one they are in', async () => {
    await expect(
      asUser({ sub: userA })(
        `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
         values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-2','queue')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('reveals an opponent\'s friend code, and only to an opponent', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')`);
    const stranger = randomUUID();
    await makeUser(stranger, `QT_${stranger.slice(0, 8)}`);
    // Before any match: invisible.
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-3','queue')`);
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
    expect(await asUser({ sub: stranger })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
  });

  /**
   * The `state = 'paired'` clause is the only thing keeping this policy from
   * granting an opponent's friend code forever, past the point the match
   * ended. Nothing else in this file ever inserts a non-'paired' match, so a
   * policy with that clause dropped — or swapped for something looser like
   * `state != 'abandoned'` — would pass every other test here undetected.
   * Same pair, same friend-code row, same querier as the paired case: the
   * only thing that changes is state, so this is what proves the clause is
   * load-bearing rather than decorative.
   */
  it('stops showing a friend code once the match is abandoned', async () => {
    // upsert: an earlier test in this file already gave userB a friend code
    // and afterEach doesn't touch public.friend_codes, so a bare insert
    // would collide on the profile_id primary key here.
    await sql(
      `insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')
       on conflict (profile_id) do update set code = excluded.code`,
    );
    // Ground truth: inserted with the superuser connection, which bypasses
    // RLS, so its existence is proven independently of the policy under test.
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source, state)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-4','queue','paired')`);
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);

    await sql(`update public.matches set state = 'abandoned' where player_a = '${userA}' and player_b = '${userB}'`);
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
    // afterEach deletes every match for userA/userB, but not friend_codes;
    // clean up explicitly so this row doesn't linger in the partner's DB.
    await sql(`delete from public.friend_codes where profile_id = '${userB}'`);
  });
});
