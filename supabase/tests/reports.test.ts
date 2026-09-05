import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon, refusal, PRIVILEGE_DENIED } from './helpers';

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
});
