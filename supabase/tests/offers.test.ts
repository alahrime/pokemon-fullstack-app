import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('match offer policies', () => {
  const proposer = randomUUID();
  const taker = randomUUID();
  let versionId = '';

  // `set local role` is transaction-scoped and `sql()` gives no transaction,
  // so role-scoped queries need their own connection. Same shape as
  // pairing.test.ts's, which is the precedent this copies.
  const alt = postgres(CONNECTION_STRING, { max: 1 });
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
    await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
    await makeUser(taker, `OT_${taker.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a in ('${proposer}','${taker}') or player_b in ('${proposer}','${taker}')`);
    await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
    await sql(`delete from public.friend_codes where profile_id in ('${proposer}','${taker}')`);
  });

  afterAll(async () => {
    await alt.end();
  });

  const offer = (visibility: string, scheduled = 'null') =>
    asUser({ sub: proposer })<{ id: string }>(
      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`,
    );

  it('shows a public offer to any signed-in stranger', async () => {
    const [o] = await offer('public');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('hides a public offer from someone not signed in, though the row exists and is visible to its proposer', async () => {
    const [o] = await offer('public');
    expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
    // Prove the emptiness above is the anon policy at work, not an absent row:
    // the superuser connection (bypasses RLS) and the proposer (via their own
    // policy) both still see it.
    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
    const [o] = await offer('unlisted');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('refuses an offer proposed on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: taker })(
        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
         values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
    ).rejects.toThrow(/row-level security/);
  });

  /**
   * Nobody signed in may rewrite an offer's terms — not the taker, and (this
   * is what changed) not the proposer either.
   *
   * THIS TEST USED TO ASSERT THE HOLE. Its third leg read "Same row, same
   * column, different actor: the proposer can", and a proposer's successful
   * UPDATE was offered as proof that the taker's 0 rows meant denial rather
   * than a table nobody could write. The capability it certified as healthy
   * was step 2 of the measured C2 chain: the proposer used exactly it to set
   * `accepted_by` to a victim who had never seen the offer, called
   * confirm_offer(), and read the victim's friend code out of the match that
   * produced. The leg was sound as an argument and the thing it proved
   * present was the exploit.
   *
   * The class of refusal has changed with it, and that is the point of the
   * assertions below. Before: no UPDATE policy admitted the taker, so the row
   * failed the USING clause, and an UPDATE whose USING excludes every row
   * reports 0 rows and raises nothing. Now `authenticated` holds no UPDATE
   * grant on this table at all, so the statement is refused before a row is
   * looked at — a RAISED `42501 permission denied for table match_offers`.
   *
   * Three legs still, re-aimed at what is now true:
   *  (a) the taker is refused, and by PRIVILEGE — not silently filtered;
   *  (b) the proposer, same row and same column, is refused identically —
   *      the leg that used to succeed;
   *  (c) the row is provably unchanged, read past RLS by the superuser.
   * Leg (d) below then proves the suite can still SEE the silent kind, so
   * (a) and (b) are not "any refusal at all".
   */
  it('refuses a taker editing the offer\'s terms — and the proposer too, by privilege', async () => {
    const [o] = await offer('public');

    const takerRefusal = await refusal(() =>
      asUser({ sub: taker })(`update public.match_offers set league = 'master' where id = '${o.id}' returning id`),
    );
    expect(takerRefusal.code).toBe('42501');
    expect(takerRefusal.message).toMatch(PRIVILEGE_DENIED);
    // Not the silent kind, and not the WITH CHECK kind. Named explicitly so a
    // future migration that re-grants UPDATE and leans on the policy instead
    // fails here rather than passing under a looser regex.
    expect(takerRefusal.message).not.toMatch(POLICY_DENIED);

    const proposerRefusal = await refusal(() =>
      asUser({ sub: proposer })(`update public.match_offers set league = 'master' where id = '${o.id}' returning id`),
    );
    expect(proposerRefusal.code).toBe('42501');
    expect(proposerRefusal.message).toMatch(PRIVILEGE_DENIED);

    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
      { league: 'great' },
    ]);
  });

  /**
   * Leg (d) of the test above, kept separate because it is a claim about the
   * HARNESS rather than about offers: this suite can still observe the silent
   * refusal, so the raised errors above are a specific finding and not the
   * only thing it is capable of noticing.
   *
   * DELETE is the verb clients still hold on this table (withdrawing your own
   * offer), so its USING clause is live. A stranger's DELETE is filtered to 0
   * rows with no error; the proposer's, on the very same row, removes it.
   * That is the old test's three-leg shape intact — moved to the verb where
   * "a different actor can" is still a property worth having.
   */
  it('filters a stranger\'s DELETE to nothing without raising, while the proposer\'s removes the row', async () => {
    const [o] = await offer('public');
    const strangerDelete = await asUser({ sub: taker })<{ id: string }>(
      `delete from public.match_offers where id = '${o.id}' returning id`,
    );
    expect(strangerDelete).toHaveLength(0);
    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);

    const proposerDelete = await asUser({ sub: proposer })<{ id: string }>(
      `delete from public.match_offers where id = '${o.id}' returning id`,
    );
    expect(proposerDelete).toHaveLength(1);
    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
  });

  it('refuses a scheduled offer in the past', async () => {
    await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
  });

  /**
   * The insert half of C1/C2, which no test in this suite ever had.
   *
   * Revoking UPDATE stops a row being EDITED into a privileged state. It does
   * nothing about one that ARRIVES in it, and the measured C1 was exactly
   * that: an INSERT carrying its own `verified_hash`. The old owner policy's
   * WITH CHECK said only `auth.uid() = proposer_id` — "this row must be
   * yours" — and said nothing at all about which columns you might fill in
   * while making it yours.
   *
   * One case per server-owned column, rather than one insert setting them all,
   * because a single combined row would still be refused if the policy named
   * only one of them and dropped the rest. Each row below is otherwise
   * completely valid: it differs from the offer the good path creates in that
   * one column and nothing else, so the refusal has one available cause.
   */
  const proposerInsert = (extraCols: string, extraVals: string) =>
    asUser({ sub: proposer })<{ id: string }>(
      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility${extraCols})
       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public'${extraVals}) returning id`,
    );

  it('accepts the honest offer the cases below are each one column away from', async () => {
    // The control. Without it, every refusal below could be the shared part of
    // the statement failing for a reason that has nothing to do with the
    // column under test.
    expect(await proposerInsert('', '')).toHaveLength(1);
  });

  const forgedAtInsert: Array<[string, string, string]> = [
    // The coordinator's answer to claimed_hash. C1 itself.
    ['verified_hash', ', verified_hash', `, 'forged-verified-hash'`],
    // accept_offer()'s three writes. `accepted_by` is the forge at the heart
    // of C2 — see the test after this one for the second line behind it.
    ['accepted_by', ', accepted_by', `, '${taker}'`],
    ['accepted_team', ', accepted_team', `, '[]'::jsonb`],
    ['accepted_at', ', accepted_at', ', now()'],
    // confirm_offer()'s two.
    ['confirmed_at', ', confirmed_at', ', now()'],
    // Every state but 'open' is somewhere only a function may move a row to.
    ['state', ', state', `, 'accepted'`],
    ['state', ', state', `, 'converted'`],
    ['state', ', state', `, 'confirmed'`],
    ['state', ', state', `, 'lapsed'`],
  ];

  it.each(forgedAtInsert)('refuses an offer that arrives with %s already set', async (_col, cols, vals) => {
    const denied = await refusal(() => proposerInsert(cols, vals));
    // The POLICY class specifically. A CHECK constraint (23514) or an FK
    // (23503) refusing first would look like a pass and prove nothing about
    // the policy, which is what this test is for.
    expect(denied.code).toBe('42501');
    expect(denied.message).toMatch(POLICY_DENIED);
  });

  /**
   * `accepted_by` twice over, because it is the column C2 forged and the one
   * case above whose refusal could be the right answer for the wrong reason.
   *
   * `match_offers_accepted_needs_team` is `accepted_by is null or
   * accepted_team is not null`, so a row setting `accepted_by` alone is
   * ALSO refusable by that CHECK — and a test that only asserted "it threw"
   * would pass identically if the policy said nothing about the column.
   *
   * Measured ordering, not assumed: RLS's WITH CHECK is evaluated BEFORE the
   * table's CHECK constraints, so the policy answers first with 42501 and the
   * constraint is never reached. Both are asserted, on the same row, from the
   * two sides of RLS:
   *   - as the proposer, the POLICY refuses (42501);
   *   - as the superuser, past RLS entirely, the CONSTRAINT refuses (23514).
   * That second assertion is what makes the first one discriminating: drop
   * the `accepted_by is null` conjunct from the policy and this row stops
   * being refused at 42501 and starts being refused at 23514, so the code
   * assertion fails rather than the test staying green on a different denial.
   *
   * The pair together is C2's own shape — the forged acceptance carried an
   * empty roster precisely to satisfy that constraint — and is refused by the
   * policy with the constraint satisfied, so nothing here rests on it.
   */
  it('refuses an offer that arrives already accepted, and the constraint stands behind the policy', async () => {
    const byPolicy = await refusal(() => proposerInsert(', accepted_by', `, '${taker}'`));
    expect(byPolicy.code).toBe('42501');
    expect(byPolicy.message).toMatch(POLICY_DENIED);

    const byConstraint = await refusal(() =>
      sql(`insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility, accepted_by)
           values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public', '${taker}')`),
    );
    expect(byConstraint.code).toBe('23514');
    expect(byConstraint.message).toMatch(/match_offers_accepted_needs_team/);

    // The constraint satisfied, so only the policy can be refusing this one.
    const paired = await refusal(() =>
      proposerInsert(', accepted_by, accepted_team', `, '${taker}', '[]'::jsonb`),
    );
    expect(paired.code).toBe('42501');
    expect(paired.message).toMatch(POLICY_DENIED);
  });

  /**
   * `match_id` needs a real match to point at, or the FK refuses before the
   * policy does and the test proves nothing — the same trap as `accepted_by`
   * above, avoidable here because a match can simply be created.
   */
  it('refuses an offer that arrives already pointing at a match', async () => {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${proposer}','${taker}','${versionId}','bb','[]'::jsonb,'[]'::jsonb,'rev1','seed-forge','offer') returning id`,
    );
    const denied = await refusal(() => proposerInsert(', match_id', `, '${m.id}'`));
    expect(denied.code).toBe('42501');
    expect(denied.message).toMatch(POLICY_DENIED);
  });

  /**
   * C2, END TO END, as the attacker actually ran it against this database.
   *
   * The individual refusals above each say a step is closed. This says the
   * CHAIN is, which is a different claim and the one that matters: the report
   * that opened this fix measured four steps, and a fix that closed three of
   * them would still hand over the friend code.
   *
   * Every step is asserted at its own outcome, and the last two are asserted
   * on the ATTACKER'S OWN READS rather than on the superuser's — what the
   * victim's privacy means is what the attacker can see, not what is true
   * behind RLS.
   */
  it('breaks the whole C2 chain: no forged acceptance, no match, no friend code', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${taker}', '1111 2222 3333')
               on conflict (profile_id) do update set code = excluded.code`);

    // Step 1 as the attacker ran it — an offer arriving already verified — is
    // refused outright. `confirm_offer` copies verified_hash into
    // matches.rules_hash, which is NOT NULL, so C1 was not merely alongside
    // C2: it was the step that made the forged match insertable at all.
    const selfVerified = await refusal(() =>
      proposerInsert(', verified_hash', `, 'forged-verified-hash'`),
    );
    expect(selfVerified.message).toMatch(POLICY_DENIED);

    // Give the attacker the strongest position the fix still permits: an
    // honest offer, verified by the coordinator rather than by themselves.
    // Planting it with the superuser concedes step 1 entirely, so the rest of
    // the chain is tested on its own merits rather than passing because the
    // first step happened to fail.
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${proposer}', '${versionId}', 'bb', 'bb', 'great', '[]'::jsonb, 'rev1', 'public', now() + interval '2 days') returning id`,
    );

    // Step 2: the forge. This is the UPDATE the old third leg certified.
    const forge = await refusal(() =>
      asUser({ sub: proposer })(
        `update public.match_offers
            set accepted_by = '${taker}', accepted_team = '[]'::jsonb, accepted_at = now(), state = 'accepted'
          where id = '${o.id}' returning id`,
      ),
    );
    expect(forge.code).toBe('42501');
    expect(forge.message).toMatch(PRIVILEGE_DENIED);

    // The row did not move, read past RLS.
    expect(
      await sql<{ state: string; accepted_by: string | null }>(
        `select state, accepted_by from public.match_offers where id = '${o.id}'`,
      ),
    ).toEqual([{ state: 'open', accepted_by: null }]);

    // Step 3: confirm_offer cannot produce a match, and says why in its own
    // words rather than raising something raw.
    const confirmed = await refusal(() => asUser({ sub: proposer })(`select public.confirm_offer('${o.id}')`));
    expect(confirmed.message).toMatch(/this offer has not been accepted yet/);
    expect(await sql(`select id from public.matches where player_b = '${taker}'`)).toHaveLength(0);

    // Step 4: the payload. Asserted as the attacker sees it.
    expect(
      await asUser({ sub: proposer })(`select code from public.friend_codes where profile_id = '${taker}'`),
    ).toHaveLength(0);

    // And the friend code is genuinely there to be leaked — otherwise the
    // zero above is a missing row, not a working policy.
    expect(await sql(`select code from public.friend_codes where profile_id = '${taker}'`)).toHaveLength(1);
  });

  /**
   * The other half of the revoke, and the one that would break the product
   * rather than a test: the coordinator writes `verified_hash` over PostgREST
   * as `service_role`, and if that grant had gone with the others then
   * nothing would ever be verified, nothing would ever pair, and both gates
   * would stay green while the feature shipped dead.
   *
   * Exercised for real through `set local role service_role` on this file's
   * own connection — the same mechanism pairing.test.ts uses to prove the
   * coordinator functions are callable. Not a claim inferred from the
   * migration text.
   */
  it('still lets service_role write verified_hash, which is the coordinator\'s whole job', async () => {
    const [o] = await offer('public');
    expect(
      await asRole('service_role')<{ verified_hash: string }>(
        `update public.match_offers set verified_hash = 'bb' where id = '${o.id}' returning verified_hash`,
      ),
    ).toEqual([{ verified_hash: 'bb' }]);

    // And the same statement from the client roles the revoke named.
    for (const role of ['authenticated', 'anon']) {
      const denied = await refusal(() =>
        asRole(role)(`update public.match_offers set verified_hash = 'zz' where id = '${o.id}'`),
      );
      expect(denied.code).toBe('42501');
      expect(denied.message).toMatch(PRIVILEGE_DENIED);
    }
    // Unchanged by the two refusals, not merely unreported.
    expect(
      await sql<{ verified_hash: string }>(`select verified_hash from public.match_offers where id = '${o.id}'`),
    ).toEqual([{ verified_hash: 'bb' }]);
  });
});
