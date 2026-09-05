import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon, refusal, PRIVILEGE_DENIED } from './helpers';

const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('match reports and adjudicated rounds', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const stranger = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  async function makeMatch(rounds = 3): Promise<string> {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches
         (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source)
       values ('${userA}', '${userB}', '${versionId}', 'aa', '[]'::jsonb, '[]'::jsonb, 'rev1', 's', ${rounds}, 'queue')
       returning id`,
    );
    return m.id;
  }

  beforeAll(async () => {
    await makeUser(userA, `RA_${userA.slice(0, 8)}`);
    await makeUser(userB, `RB_${userB.slice(0, 8)}`);
    await makeUser(stranger, `RS_${stranger.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${userA}', 'Report Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a = '${userA}' or player_b = '${userA}'`);
  });

  it('accepts only scorelines a best-of could actually produce', async () => {
    const valid = [
      [3, `'{a,a}'`], [3, `'{b,b}'`], [3, `'{a,b,a}'`], [3, `'{b,a,b}'`],
      [5, `'{a,a,a}'`], [5, `'{a,b,a,b,a}'`], [5, `'{b,a,b,b}'`],
    ] as const;
    for (const [n, arr] of valid) {
      const [r] = await sql<{ ok: boolean }>(
        `select public.is_valid_scoreline(${n}::smallint, ${arr}::text[]) as ok`,
      );
      expect(r.ok, `best-of-${n} ${arr} should be valid`).toBe(true);
    }

    const invalid = [
      [3, `'{a,a,a}'`],   // the third round would never have been played
      [3, `'{a,b}'`],     // nobody reached two
      [3, `'{a}'`],       // ditto
      [3, `'{a,b,a,b}'`], // longer than the best-of
      [3, `'{a,c}'`],     // not a side
      [3, `'{}'`],        // empty
      [5, `'{a,a}'`],     // nobody reached three
      [5, `'{a,a,a,b}'`], // decided in round 3; round 4 never happened
    ] as const;
    for (const [n, arr] of invalid) {
      const [r] = await sql<{ ok: boolean }>(
        `select public.is_valid_scoreline(${n}::smallint, ${arr}::text[]) as ok`,
      );
      expect(r.ok, `best-of-${n} ${arr} should be invalid`).toBe(false);
    }
  });

  it('seals a report from the opponent until the match is confirmed', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.match_reports (match_id, reporter_id, best_of, wins)
       values ('${matchId}', '${userA}', 3, '{a,a}')`,
    );

    const mine = await asUser({ sub: userA })(
      `select wins from public.match_reports where match_id = '${matchId}'`,
    );
    expect(mine).toHaveLength(1);

    const theirs = await asUser({ sub: userB })(
      `select wins from public.match_reports where match_id = '${matchId}'`,
    );
    expect(theirs).toHaveLength(0);

    await sql(`update public.matches set state = 'confirmed' where id = '${matchId}'`);
    const afterConfirm = await asUser({ sub: userB })(
      `select wins from public.match_reports where match_id = '${matchId}'`,
    );
    expect(afterConfirm).toHaveLength(1);
  });

  it('lets nobody write a report or an adjudicated round directly', async () => {
    const matchId = await makeMatch();
    const reportDenied = await refusal(() =>
      asUser({ sub: userA })(
        `insert into public.match_reports (match_id, reporter_id, best_of, wins)
         values ('${matchId}', '${userA}', 3, '{a,a}')`,
      ),
    );
    expect(reportDenied.message).toMatch(PRIVILEGE_DENIED);

    const roundDenied = await refusal(() =>
      asUser({ sub: userA })(
        `insert into public.match_rounds (match_id, round_no, winner)
         values ('${matchId}', 1, '${userA}')`,
      ),
    );
    expect(roundDenied.message).toMatch(PRIVILEGE_DENIED);

    // Belt and braces means both belts: an anonymous write must be refused by
    // the missing GRANT, not merely by the absence of any permissive policy.
    // `revoke ... from authenticated` alone leaves `anon` still holding
    // INSERT/UPDATE/DELETE from the default Supabase grant, which is a policy
    // refusal (POLICY_DENIED) wearing the wrong error class.
    const anonReportDenied = await refusal(() =>
      asAnon()(
        `insert into public.match_reports (match_id, reporter_id, best_of, wins)
         values ('${matchId}', '${userA}', 3, '{a,a}')`,
      ),
    );
    expect(anonReportDenied.message).toMatch(PRIVILEGE_DENIED);

    const anonRoundDenied = await refusal(() =>
      asAnon()(
        `insert into public.match_rounds (match_id, round_no, winner)
         values ('${matchId}', 1, '${userA}')`,
      ),
    );
    expect(anonRoundDenied.message).toMatch(PRIVILEGE_DENIED);
  });

  it('shows an adjudicated round to the two players and to nobody else', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.match_rounds (match_id, round_no, winner)
       values ('${matchId}', 1, '${userA}')`,
    );
    expect(await asUser({ sub: userA })(`select * from public.match_rounds where match_id = '${matchId}'`)).toHaveLength(1);
    expect(await asUser({ sub: userB })(`select * from public.match_rounds where match_id = '${matchId}'`)).toHaveLength(1);
    expect(await asUser({ sub: stranger })(`select * from public.match_rounds where match_id = '${matchId}'`)).toHaveLength(0);
  });

  it('keeps the opponent friend code readable while the match is still live', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.friend_codes (profile_id, code) values ('${userB}', '1111 2222 3333')
       on conflict (profile_id) do update set code = excluded.code`,
    );
    for (const state of ['paired', 'reported', 'mismatch', 'disputed']) {
      await sql(`update public.matches set state = '${state}' where id = '${matchId}'`);
      const rows = await asUser({ sub: userA })(
        `select code from public.friend_codes where profile_id = '${userB}'`,
      );
      expect(rows, `friend code should be readable while ${state}`).toHaveLength(1);
    }
  });

  it('hides the opponent friend code once the match is no longer live', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.friend_codes (profile_id, code) values ('${userB}', '1111 2222 3333')
       on conflict (profile_id) do update set code = excluded.code`,
    );
    // A SELECT policy denies by filtering, not by throwing: the correct
    // assertion is zero rows, not a rejected promise. This is the deny half
    // of the allow test above — without it, a regression that widened the
    // policy's `state in (...)` list to include either excluded state would
    // pass the suite undetected.
    for (const state of ['confirmed', 'unverified']) {
      await sql(`update public.matches set state = '${state}' where id = '${matchId}'`);
      const rows = await asUser({ sub: userA })(
        `select code from public.friend_codes where profile_id = '${userB}'`,
      );
      expect(rows, `friend code should NOT be readable while ${state}`).toHaveLength(0);
    }
  });

  const submit = (who: string, matchId: string, wins: string) =>
    asUser({ sub: who })<{ submit_report: string }>(
      `select public.submit_report('${matchId}', '${wins}'::text[]) as submit_report`,
    );

  it('confirms the match when both sides agree, and writes the rounds', async () => {
    const matchId = await makeMatch();
    const [first] = await submit(userA, matchId, '{a,b,a}');
    expect(first.submit_report).toBe('reported');
    const [second] = await submit(userB, matchId, '{a,b,a}');
    expect(second.submit_report).toBe('confirmed');

    const [m] = await sql<{ state: string; rating_counted: boolean }>(
      `select state, rating_counted from public.matches where id = '${matchId}'`,
    );
    expect(m.state).toBe('confirmed');
    expect(m.rating_counted).toBe(true);

    const rounds = await sql<{ round_no: number; winner: string }>(
      `select round_no, winner from public.match_rounds where match_id = '${matchId}' order by round_no`,
    );
    expect(rounds).toEqual([
      { round_no: 1, winner: userA },
      { round_no: 2, winner: userB },
      { round_no: 3, winner: userA },
    ]);
  });

  /**
   * The row lock in `submit_report` (`select ... from matches ... for
   * update`) is, per the brief, the whole reason the common path is safe:
   * without it, two simultaneous submissions of the SAME agreeing scoreline
   * each read "the opponent has not reported yet" inside their own
   * transaction, each write state 'reported', and a match both players
   * agreed on never confirms.
   *
   * Proving that needs two connections that can actually overlap in
   * Postgres. This suite's shared `sql()`/`asUser()` connection (see
   * `helpers.ts`) is opened with `max: 1` and wraps every call in
   * `client.begin()` on that ONE socket, so even `Promise.all` on it would
   * just serialise the two BEGINs — the identical limitation
   * `pairing.test.ts` documents (around its `conn()` helper) and works
   * around by opening independent connections. Same fix here.
   */
  it('confirms exactly once when both sides submit the same scoreline at the same moment', { timeout: 20000 }, async () => {
    const matchId = await makeMatch();
    const conn = () => postgres(CONNECTION_STRING, { max: 1 });
    const [c1, c2] = [conn(), conn()];
    const submitOn = (client: ReturnType<typeof conn>, who: string) =>
      client.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
        return tx.unsafe(`select public.submit_report('${matchId}', '{a,b,a}'::text[]) as submit_report`);
      });
    const results = await Promise.all([submitOn(c1, userA), submitOn(c2, userB)]);
    await Promise.all([c1.end(), c2.end()]);

    // Without the lock both calls take the "opponent hasn't reported" branch
    // and both return 'reported'; with it, whichever call is second to
    // acquire the row lock sees the first call's report and confirms.
    const outcomes = results.map((r) => (r as unknown as { submit_report: string }[])[0].submit_report).sort();
    expect(outcomes).toEqual(['confirmed', 'reported']);

    const [m] = await sql<{ state: string; rating_counted: boolean }>(
      `select state, rating_counted from public.matches where id = '${matchId}'`,
    );
    expect(m.state).toBe('confirmed');
    expect(m.rating_counted).toBe(true);

    // Exactly once, not duplicated by two racing writers.
    const rounds = await sql<{ round_no: number; winner: string }>(
      `select round_no, winner from public.match_rounds where match_id = '${matchId}' order by round_no`,
    );
    expect(rounds).toEqual([
      { round_no: 1, winner: userA },
      { round_no: 2, winner: userB },
      { round_no: 3, winner: userA },
    ]);
  });

  it('opens one amend window on disagreement and does not extend it', async () => {
    const matchId = await makeMatch();
    await submit(userA, matchId, '{a,a}');
    const [mismatch] = await submit(userB, matchId, '{b,b}');
    expect(mismatch.submit_report).toBe('mismatch');

    const [first] = await sql<{ amend_deadline: string }>(
      `select amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(first.amend_deadline).not.toBeNull();

    await submit(userB, matchId, '{b,a,b}');
    const [second] = await sql<{ amend_deadline: string }>(
      `select amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(second.amend_deadline).toEqual(first.amend_deadline);
  });

  it('confirms after an amend brings the two claims together', async () => {
    const matchId = await makeMatch();
    await submit(userA, matchId, '{a,a}');
    await submit(userB, matchId, '{b,b}');
    const [amended] = await submit(userB, matchId, '{a,a}');
    expect(amended.submit_report).toBe('confirmed');

    const [r] = await sql<{ amend_count: number }>(
      `select amend_count from public.match_reports where match_id = '${matchId}' and reporter_id = '${userB}'`,
    );
    expect(r.amend_count).toBe(1);

    const [m] = await sql<{ amend_deadline: string | null }>(
      `select amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(m.amend_deadline).toBeNull();
  });

  it('refuses a stranger, an impossible scoreline, and a settled match', async () => {
    const matchId = await makeMatch();
    await expect(submit(stranger, matchId, '{a,a}')).rejects.toThrow(/this match is not yours/);
    await expect(submit(userA, matchId, '{a,a,a}')).rejects.toThrow(/not a possible best-of-3 scoreline/);

    await submit(userA, matchId, '{a,a}');
    await submit(userB, matchId, '{a,a}');
    await expect(submit(userA, matchId, '{b,b}')).rejects.toThrow(/no longer accepting reports/);
  });
});
