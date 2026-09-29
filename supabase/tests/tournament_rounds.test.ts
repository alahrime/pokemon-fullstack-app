import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

// helpers.ts's PRIVILEGE_DENIED names the older tables only; same class, these tables.
const PRIVILEGE_DENIED = /permission denied for table tournament/;

const SPECIES = ['azumarill', 'medicham', 'registeel', 'altaria', 'swampert', 'skarmory'];
const roster = () =>
  SPECIES.map((ref) => ({ ref, fast: 'BUBBLE', charges: ['ICE_BEAM', 'PLAY_ROUGH'], cp: 1500, bestBuddy: false }));
const lit = (r: unknown) => `'${JSON.stringify(r)}'::jsonb`;

type Pair = { a: string; b?: string | null };
type Pairing = {
  id: string; round: number; table_no: number; player_a: string; player_b: string | null;
  score_a: number | null; score_b: number | null; state: string; reported_by: string | null;
  settled_by: string | null; note: string | null;
};

describe('tournament rounds', () => {
  const host = randomUUID();
  const judge = randomUUID();
  const [p1, p2, p3, p4, p5] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const stranger = randomUUID();
  const everyone = [host, judge, p1, p2, p3, p4, p5, stranger];
  const ids = everyone.map((u) => `'${u}'`).join(',');
  let six = '';
  let p1Public = ''; // a format p1 may challenge on

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }
  async function makeVersion(owner: string, vis: 'public' | 'private', name: string) {
    const rules = JSON.stringify({ schema: 1, base: 'great', pool: [], composition: { size: 6, uniqueSpecies: true }, selection: { mode: 'open' } });
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility) values ('${owner}', '${name}', '${vis}') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '${rules}'::jsonb, 'bb') returning id`);
    return v.id;
  }

  const as = (who: string) => asUser({ sub: who });
  const call = (who: string, fn: string, ...args: string[]) =>
    as(who)(`select public.${fn}(${args.join(', ')}) as r`).then(([r]) => r.r);
  const q = (s: string) => `'${s}'`;
  const s = (n: number) => `(${n})::smallint`;

  /** host organises, judge judges, `players` register; closed unless `close` is false. */
  async function setup(players = [p1, p2, p3, p4], { rounds = 3, close = true } = {}) {
    const [{ id }] = await as(host)<{ id: string }>(
      `select public.create_tournament('Rounds', '', '${six}', ${s(rounds)}, ${s(25)}, ${s(64)}) as id`);
    await call(host, 'open_registration', q(id));
    await call(host, 'grant_judge', q(id), q(judge));
    for (const p of players) await as(p)(`select public.register_roster('${id}', ${lit(roster())})`);
    if (close) await call(host, 'close_registration', q(id));
    return id;
  }
  const start = (who: string, id: string, pairs: Pair[], force = false, override = false) =>
    call(who, 'start_round', q(id), lit(pairs.map(({ a, b }) => ({ a, b: b ?? null }))), `${force}`, `${override}`);
  const pairingOf = async (id: string, player: string, round?: number) => {
    const [p] = await sql<Pairing>(
      `select * from public.tournament_pairings where tournament_id = '${id}'
         and '${player}' in (player_a, coalesce(player_b, player_a))
         ${round ? `and round = ${round}` : ''} order by round desc limit 1`);
    return p;
  };
  const report = (who: string, pid: string, a: number, b: number) =>
    call(who, 'report_score', q(pid), s(a), s(b));
  const settle = (who: string, pid: string, a: number, b: number, note = 'null') =>
    call(who, 'settle_pairing', q(pid), s(a), s(b), note);
  const settleAll = (id: string) =>
    sql(`update public.tournament_pairings set state = 'settled', score_a = 2, score_b = 0
          where tournament_id = '${id}' and player_b is not null`);
  const audit = (id: string, action: string) =>
    sql<{ actor_id: string; detail: Record<string, unknown> }>(
      `select actor_id, detail from public.tournament_audit where tournament_id = '${id}' and action = '${action}' order by created_at`);
  const round1 = [{ a: p1, b: p2 }, { a: p3, b: p4 }];

  beforeAll(async () => {
    for (const [id, tag] of [[host, 'RH'], [judge, 'RJ'], [p1, 'R1'], [p2, 'R2'], [p3, 'R3'], [p4, 'R4'], [p5, 'R5'], [stranger, 'RS']] as const) {
      await makeUser(id, `${tag}_${id.slice(0, 8)}`);
    }
    six = await makeVersion(host, 'private', 'Rounds private');
    p1Public = await makeVersion(p1, 'public', 'Rounds p1 public');
    for (const [i, p] of [p1, p2, p3, p4].entries()) {
      await sql(`insert into public.friend_codes (profile_id, code) values ('${p}', '1111 2222 000${i}')`);
    }
  });

  afterEach(async () => {
    // Tournaments cascade to entrants, rosters, roles, pairings and audit.
    await sql(`delete from public.tournaments where organiser_id in (${ids})`);
    await sql(`delete from public.match_offers where proposer_id in (${ids})`);
    await sql(`delete from public.channels where created_by in (${ids})`);
    await sql(`delete from public.blocks where blocker_id in (${ids})`);
  });

  it('1. starts round one for those who run it, and refuses every malformed pairing', async () => {
    const id = await setup();
    const refused = async (who: string, pairs: Pair[]) => (await refusal(() => start(who, id, pairs))).message;
    expect(await refused(stranger, round1)).toMatch(/not allowed/);
    expect(await refused(p1, round1)).toMatch(/not allowed/);
    expect(await refused(host, [{ a: p1, b: p2 }])).toMatch(/every active entrant must be paired exactly once/);
    expect(await refused(host, [{ a: p1, b: p2 }, { a: p1, b: p3 }])).toMatch(/a player appears twice/);
    expect(await refused(host, [{ a: p1, b: p1 }, { a: p3, b: p4 }])).toMatch(/two different players, or a bye/);
    expect(await refused(host, [{ a: p1, b: stranger }, { a: p3, b: p4 }])).toMatch(/pairings may only name active entrants/);
    // An even field cannot carry a bye: one bye leaves someone unpaired, two is two.
    expect(await refused(host, [{ a: p1, b: p2 }, { a: p3 }])).toMatch(/every active entrant must be paired exactly once/);
    expect(await refused(host, [{ a: p1, b: p2 }, { a: p3 }, { a: p4 }])).toMatch(/an odd field needs exactly one bye, an even field none/);
    expect(await sql(`select 1 from public.tournament_pairings where tournament_id = '${id}'`)).toHaveLength(0);

    const open = await setup(undefined, { close: false });
    expect((await refusal(() => start(host, open, round1))).message).toMatch(/the tournament is not ready for a round/);

    expect(await start(judge, id, round1)).toBe(1);
    const [t] = await sql<{ state: string; current_round: number; near: boolean }>(
      `select state, current_round,
              abs(extract(epoch from round_ends_at - (now() + make_interval(mins => round_minutes)))) < 5 as near
         from public.tournaments where id = '${id}'`);
    expect(t).toEqual({ state: 'running', current_round: 1, near: true });
    const rows = await sql<Pairing>(
      `select * from public.tournament_pairings where tournament_id = '${id}' order by table_no`);
    expect(rows.map((r) => [r.table_no, r.player_a, r.player_b, r.state])).toEqual([
      [1, p1, p2, 'pending'], [2, p3, p4, 'pending'],
    ]);
    const [a] = await audit(id, 'start_round');
    expect(a.actor_id).toBe(judge);
    expect(a.detail).toMatchObject({ round: 1, forced: false, override: false });

    await settleAll(id);
    await sql(`update public.tournaments set rounds = 1 where id = '${id}'`);
    expect((await refusal(() => start(host, id, [{ a: p1, b: p3 }, { a: p2, b: p4 }]))).message).toMatch(
      /every round has been played/);
  });

  it('2. an odd field takes exactly one bye, settled 2-0; a second bye needs an override', async () => {
    const id = await setup([p1, p2, p3, p4, p5]);
    expect((await refusal(() => start(host, id, [{ a: p1, b: p2 }, { a: p3 }, { a: p4 }, { a: p5 }]))).message).toMatch(
      /an odd field needs exactly one bye/);
    await start(host, id, [...round1, { a: p5 }]);
    const bye = await pairingOf(id, p5);
    expect(bye).toMatchObject({ player_b: null, state: 'settled', score_a: 2, score_b: 0, table_no: 3 });

    await settleAll(id);
    const again = [{ a: p1, b: p3 }, { a: p2, b: p4 }, { a: p5 }];
    expect((await refusal(() => start(host, id, again))).message).toMatch(/that player has already had a bye/);
    expect(await start(host, id, again, false, true)).toBe(2);
    expect((await audit(id, 'start_round'))[1].detail).toMatchObject({ round: 2, override: true });
  });

  it('3. round two waits for round one to count, unless forced', async () => {
    const id = await setup();
    await start(host, id, round1);
    const r2 = [{ a: p1, b: p3 }, { a: p2, b: p4 }];
    expect((await refusal(() => start(host, id, r2))).message).toMatch(/2 pairings are unsettled/);
    await sql(`update public.tournament_pairings set state = 'settled', score_a = 2, score_b = 0
                where tournament_id = '${id}' and player_a = '${p1}'`);
    expect((await refusal(() => start(host, id, r2))).message).toMatch(/1 pairings are unsettled/);
    const b = (await pairingOf(id, p3)).id;
    await sql(`update public.tournament_pairings set state = 'reported', score_a = 2, score_b = 1,
                 reported_by = '${p3}', reported_at = now(), final_at = now() + interval '5 minutes' where id = '${b}'`);
    expect((await refusal(() => start(host, id, r2))).message).toMatch(/1 pairings are unsettled/);
    await sql(`update public.tournament_pairings set final_at = now() - interval '1 second' where id = '${b}'`);
    expect(await start(host, id, r2)).toBe(2);

    // Round 2 is all pending; forcing round 3 records it.
    expect(await start(host, id, [{ a: p1, b: p4 }, { a: p2, b: p3 }], true)).toBe(3);
    expect((await audit(id, 'start_round'))[2].detail).toMatchObject({ round: 3, forced: true, unsettled: 2 });
  });

  it('4. a rematch is refused unless overridden, and the override is audited', async () => {
    const id = await setup();
    await start(host, id, round1);
    await settleAll(id);
    const rematch = [{ a: p2, b: p1 }, { a: p3, b: p4 }];
    expect((await refusal(() => start(host, id, rematch))).message).toMatch(/those two have already played/);
    expect(await start(host, id, rematch, false, true)).toBe(2);
    expect((await audit(id, 'start_round'))[1].detail).toMatchObject({ override: true });
  });

  it('5. report_score: the two players, possible scores, finality time, corrections', async () => {
    const id = await setup([p1, p2, p3, p4, p5]);
    await start(host, id, [...round1, { a: p5 }]);
    const a = (await pairingOf(id, p1)).id;
    expect((await refusal(() => report(stranger, a, 2, 0))).message).toMatch(/that pairing is not yours/);
    expect((await refusal(() => report(p3, a, 2, 0))).message).toMatch(/that pairing is not yours/);
    for (const [x, y] of [[2, 2], [3, 0], [0, 0], [-1, 2], [2, -1]]) {
      expect((await refusal(() => report(p1, a, x, y))).message).toMatch(/not a possible score/);
    }
    for (const [x, y] of [[2, 0], [2, 1], [1, 2], [0, 2]]) {
      expect(await report(p1, a, x, y)).toBe('reported'); // the reporter corrects their own report
    }
    const finality = async () => (await sql<{ reported_by: string; score_a: number; round_end: boolean; ten: boolean }>(
      `select tp.reported_by, tp.score_a, tp.reported_at is not null
              and tp.final_at = t.round_ends_at as round_end,
              tp.final_at = tp.reported_at + interval '10 minutes' as ten
         from public.tournament_pairings tp join public.tournaments t on t.id = tp.tournament_id
        where tp.id = '${a}'`))[0];
    expect(await finality()).toEqual({ reported_by: p1, score_a: 0, round_end: true, ten: false });
    await sql(`update public.tournaments set round_ends_at = now() - interval '1 hour' where id = '${id}'`);
    await report(p1, a, 2, 1);
    expect(await finality()).toEqual({ reported_by: p1, score_a: 2, round_end: false, ten: true });

    expect((await refusal(() => report(p2, a, 2, 0))).message).toMatch(/confirm or dispute the report/);
    const bye = (await pairingOf(id, p5)).id;
    expect((await refusal(() => report(p5, bye, 2, 0))).message).toMatch(/a bye has no score to report/);
    await call(p2, 'confirm_score', q(a));
    expect((await refusal(() => report(p1, a, 2, 0))).message).toMatch(/no longer open to reports/);
  });

  it('6. confirm and dispute belong to the other player', async () => {
    const id = await setup();
    await start(host, id, round1);
    const a = (await pairingOf(id, p1)).id;
    const b = (await pairingOf(id, p3)).id;
    expect((await refusal(() => call(p2, 'confirm_score', q(a)))).message).toMatch(/there is nothing to confirm/);
    await report(p1, a, 2, 1);
    expect((await refusal(() => call(p1, 'confirm_score', q(a)))).message).toMatch(/the other player confirms your report/);
    expect((await refusal(() => call(p3, 'confirm_score', q(a)))).message).toMatch(/that pairing is not yours/);
    expect((await refusal(() => call(stranger, 'dispute_score', q(a)))).message).toMatch(/that pairing is not yours/);
    expect(await call(p2, 'confirm_score', q(a))).toBe('settled');
    expect((await pairingOf(id, p1)).state).toBe('settled');

    await report(p3, b, 2, 0);
    expect((await refusal(() => call(p3, 'dispute_score', q(b)))).message).toMatch(/you cannot dispute your own report/);
    expect(await call(p4, 'dispute_score', q(b))).toBe('disputed');
    for (const who of [p3, p4]) {
      expect((await refusal(() => call(who, 'confirm_score', q(b)))).message).toMatch(/there is nothing to confirm/);
    }
    expect((await pairingOf(id, p3)).state).toBe('disputed');
  });

  it('7. settle_pairing: organiser or judge, from pending, reported and disputed; audited', async () => {
    const id = await setup([p1, p2, p3, p4, p5]);
    await start(host, id, [...round1, { a: p5 }]);
    const a = (await pairingOf(id, p1)).id;
    const b = (await pairingOf(id, p3)).id;
    const bye = (await pairingOf(id, p5)).id;
    for (const who of [p1, p3, stranger]) {
      expect((await refusal(() => settle(who, a, 2, 0))).message).toMatch(/not allowed/);
    }
    expect((await refusal(() => settle(host, bye, 2, 0))).message).toMatch(/a bye cannot be settled/);
    expect((await refusal(() => settle(host, a, 2, 2))).message).toMatch(/not a possible score/);

    expect(await settle(host, a, 2, 0, `'no show'`)).toBe('settled'); // from pending
    expect(await pairingOf(id, p1)).toMatchObject({ state: 'settled', score_a: 2, score_b: 0, settled_by: host, note: 'no show' });
    await report(p3, b, 2, 1);
    expect(await settle(judge, b, 0, 0, `'both late'`)).toBe('settled'); // from reported; a double loss
    expect(await pairingOf(id, p3)).toMatchObject({ state: 'settled', score_a: 0, score_b: 0, settled_by: judge });

    await start(host, id, [{ a: p1, b: p3 }, { a: p2, b: p5 }, { a: p4 }]);
    const c = (await pairingOf(id, p1, 2)).id;
    await report(p1, c, 2, 0);
    await call(p3, 'dispute_score', q(c));
    expect(await settle(host, c, 1, 2)).toBe('settled'); // from disputed
    expect(await pairingOf(id, p1, 2)).toMatchObject({ state: 'settled', score_a: 1, score_b: 2, settled_by: host, note: null });

    const rows = await audit(id, 'settle_pairing');
    expect(rows.map((r) => r.detail)).toEqual([
      expect.objectContaining({ pairing: a, was_state: 'pending', was_score_a: null, was_score_b: null, score_a: 2, score_b: 0, note: 'no show' }),
      expect.objectContaining({ pairing: b, was_state: 'reported', was_score_a: 2, was_score_b: 1, score_a: 0, score_b: 0 }),
      expect.objectContaining({ pairing: c, was_state: 'disputed', was_score_a: 2, was_score_b: 0, score_a: 1, score_b: 2 }),
    ]);
    // A re-settle records the note and settler it replaces; an earlier round stays settleable while running.
    expect(await settle(judge, a, 0, 2, `'appeal upheld'`)).toBe('settled');
    expect((await audit(id, 'settle_pairing'))[3].detail).toMatchObject({
      pairing: a, was_state: 'settled', was_score_a: 2, was_score_b: 0, was_note: 'no show', was_settled_by: host,
      score_a: 0, score_b: 2, note: 'appeal upheld',
    });
  });

  it('7b. an organiser or judge who also plays cannot settle their own game, only others\'', async () => {
    const id = await setup([host, judge, p1, p2]);
    await start(host, id, [{ a: host, b: p1 }, { a: judge, b: p2 }]);
    const hostGame = (await pairingOf(id, host)).id;
    const judgeGame = (await pairingOf(id, judge)).id;
    // As players they report, confirm and dispute like anyone else.
    await report(p1, hostGame, 2, 1);
    expect(await call(host, 'dispute_score', q(hostGame))).toBe('disputed');
    await report(judge, judgeGame, 2, 0);
    expect(await call(p2, 'confirm_score', q(judgeGame))).toBe('settled');

    expect((await refusal(() => settle(host, hostGame, 2, 0))).message).toMatch(/you cannot settle your own game/);
    expect((await refusal(() => settle(judge, judgeGame, 2, 0))).message).toMatch(/you cannot settle your own game/);
    expect(await pairingOf(id, host)).toMatchObject({ state: 'disputed', score_a: 2, score_b: 1 });
    expect(await settle(judge, hostGame, 0, 2)).toBe('settled');
    expect(await settle(host, judgeGame, 2, 1)).toBe('settled');
    expect(await pairingOf(id, host)).toMatchObject({ settled_by: judge, score_a: 0, score_b: 2 });
    expect(await pairingOf(id, judge)).toMatchObject({ settled_by: host, score_a: 2, score_b: 1 });
  });

  it('8. drop_out forfeits a pending game and keeps the player out of later rounds', async () => {
    const early = await setup(undefined, { close: false });
    expect((await refusal(() => call(p1, 'drop_out', q(early)))).message).toMatch(
      /withdraw before the tournament starts/);
    const [kept] = await sql<{ dropped: boolean }>(
      `select dropped from public.tournament_entrants where tournament_id = '${early}' and player_id = '${p1}'`);
    expect(kept).toEqual({ dropped: false }); // the entrant row is intact

    const id = await setup();
    await start(host, id, round1);
    expect(await call(p1, 'drop_out', q(id))).toBe(true);
    expect(await pairingOf(id, p1)).toMatchObject({ state: 'settled', score_a: 0, score_b: 2, settled_by: p1, note: 'dropped out' });
    const [e] = await sql<{ dropped: boolean }>(
      `select dropped from public.tournament_entrants where tournament_id = '${id}' and player_id = '${p1}'`);
    expect(e.dropped).toBe(true);
    expect(await call(p1, 'drop_out', q(id))).toBe(false);
    const a = (await pairingOf(id, p1)).id;
    expect(await audit(id, 'drop_out')).toEqual([{ actor_id: p1, detail: { player: p1, forfeited: [
      { pairing: a, was_state: 'pending', was_score_a: null, was_score_b: null }] } }]);
    expect(await call(stranger, 'drop_out', q(id))).toBe(false);

    await settleAll(id);
    expect((await refusal(() => start(host, id, [{ a: p1, b: p3 }, { a: p2, b: p4 }]))).message).toMatch(
      /pairings may only name active entrants/);
  });

  it('8b. a forfeit settles pending and disputed games, keeps a reported one, never touches a bye', async () => {
    const id = await setup([p1, p2, p3, p4, p5]);
    await start(host, id, [...round1, { a: p5 }]);
    const byeBefore = await pairingOf(id, p5);
    const b = (await pairingOf(id, p3)).id;
    await report(p3, b, 2, 1);

    await call(p4, 'drop_out', q(id)); // reported: the entered result stands
    expect(await pairingOf(id, p4)).toMatchObject({ state: 'reported', score_a: 2, score_b: 1, reported_by: p3, settled_by: null });
    await call(p5, 'drop_out', q(id)); // bye: untouched
    expect(await pairingOf(id, p5)).toEqual(byeBefore);
    await call(p2, 'drop_out', q(id)); // pending, as player_b: 2-0 to player_a
    expect(await pairingOf(id, p2)).toMatchObject({ state: 'settled', score_a: 2, score_b: 0, settled_by: p2 });

    await sql(`update public.tournament_pairings set final_at = now() - interval '1 second' where id = '${b}'`);
    await start(host, id, [{ a: p1, b: p3 }]);
    const c = (await pairingOf(id, p1, 2)).id;
    await report(p1, c, 1, 2);
    await call(p3, 'dispute_score', q(c));
    await call(p3, 'drop_out', q(id)); // disputed, as player_b
    expect(await pairingOf(id, p1, 2)).toMatchObject({ state: 'settled', score_a: 2, score_b: 0, note: 'dropped out' });
    // The audit keeps what the forfeit overwrote.
    const drop3 = (await audit(id, 'drop_out')).find((r) => r.actor_id === p3);
    expect(drop3?.detail).toEqual({ player: p3, forfeited: [{ pairing: c, was_state: 'disputed', was_score_a: 1, was_score_b: 2 }] });
    const drop4 = (await audit(id, 'drop_out')).find((r) => r.actor_id === p4);
    expect(drop4?.detail).toEqual({ player: p4, forfeited: [] }); // the reported game was left alone
  });

  it('9. remove_player: organiser or judge; deletes before the start, drops and forfeits after', async () => {
    const id = await setup(undefined, { close: false });
    for (const who of [p1, stranger]) {
      expect((await refusal(() => call(who, 'remove_player', q(id), q(p2), `'x'`))).message).toMatch(/not allowed/);
    }
    expect((await refusal(() => call(judge, 'remove_player', q(id), q(host), `'x'`))).message).toMatch(
      /the organiser cannot be removed/);
    expect(await call(host, 'remove_player', q(id), q(p4), `'no show'`)).toBe(true);
    const [left] = await sql<{ e: number; r: number }>(
      `select (select count(*)::int from public.tournament_entrants where tournament_id = '${id}' and player_id = '${p4}') as e,
              (select count(*)::int from public.tournament_rosters where tournament_id = '${id}' and player_id = '${p4}') as r`);
    expect(left).toEqual({ e: 0, r: 0 });
    expect(await call(host, 'remove_player', q(id), q(p4), `'again'`)).toBe(false);
    expect(await call(host, 'remove_player', q(id), q(stranger), `'never entered'`)).toBe(false);
    expect((await audit(id, 'remove_player')).map((r) => r.detail)).toEqual([{ player: p4, reason: 'no show', forfeited: [] }]);

    const run = await setup();
    await start(host, run, round1);
    expect(await call(judge, 'remove_player', q(run), q(p1), `'cheating'`)).toBe(true);
    expect(await pairingOf(run, p1)).toMatchObject({ state: 'settled', score_a: 0, score_b: 2, settled_by: judge, note: 'removed: cheating' });
    const [e] = await sql<{ dropped: boolean }>(
      `select dropped from public.tournament_entrants where tournament_id = '${run}' and player_id = '${p1}'`);
    expect(e.dropped).toBe(true);
    // A no-op removal (already dropped, or never an entrant) returns false and writes no audit row.
    expect(await call(host, 'remove_player', q(run), q(p1), `'again'`)).toBe(false);
    expect(await call(host, 'remove_player', q(run), q(stranger), `'never entered'`)).toBe(false);
    const forfeited = [{ pairing: (await pairingOf(run, p1)).id, was_state: 'pending', was_score_a: null, was_score_b: null }];
    expect(await audit(run, 'remove_player')).toEqual([{ actor_id: judge, detail: { player: p1, reason: 'cheating', forfeited } }]);
  });

  it('10. finish_tournament: organiser only, after the last round, once every pairing counts', async () => {
    const id = await setup(undefined, { rounds: 2 });
    await start(host, id, round1);
    await settleAll(id);
    expect((await refusal(() => call(host, 'finish_tournament', q(id)))).message).toMatch(/unsettled pairings remain/);
    await start(host, id, [{ a: p1, b: p3 }, { a: p2, b: p4 }]);
    expect((await refusal(() => call(host, 'finish_tournament', q(id)))).message).toMatch(/unsettled pairings remain/);
    await settleAll(id);
    for (const who of [judge, p1]) {
      expect((await refusal(() => call(who, 'finish_tournament', q(id)))).message).toMatch(/not allowed/);
    }
    expect(await call(host, 'finish_tournament', q(id))).toBe(true);
    const [t] = await sql<{ state: string }>(`select state from public.tournaments where id = '${id}'`);
    expect(t.state).toBe('complete');
    expect(await audit(id, 'finish')).toHaveLength(1);
  });

  it('11. opponents at a live table reach each other; nobody else, and not after', async () => {
    const dm = (a: string, b: string) => as(a)(`select public.open_dm('${b}')`);
    const code = async (reader: string, owner: string) =>
      (await as(reader)(`select code from public.friend_codes where profile_id = '${owner}'`)).length;
    const reaches = async (a: string, b: string) => {
      const ok = await dm(a, b).then(() => true, (e: Error) => {
        expect(e.message).toMatch(/that person cannot be messaged/);
        return false;
      });
      return { dm: ok, code: await code(a, b) };
    };
    const yes = { dm: true, code: 1 };
    const no = { dm: false, code: 0 };

    const id = await setup();
    expect(await reaches(p1, p2)).toEqual(no); // closed, not yet paired
    await start(host, id, round1);
    const a = (await pairingOf(id, p1)).id;
    expect(await reaches(p1, p2)).toEqual(yes);
    expect(await reaches(p2, p1)).toEqual(yes);
    expect(await reaches(p1, p3)).toEqual(no); // another table
    expect(await reaches(stranger, p1)).toEqual(no);
    await expect(as(p1)(
      `select public.create_challenge('${p2}', '${p1Public}', 'bb', 'great', '[]'::jsonb, 'rev1', null)`)).resolves.toHaveLength(1);

    await report(p1, a, 2, 0);
    expect(await reaches(p2, p1)).toEqual(yes); // reported
    await call(p2, 'dispute_score', q(a));
    expect(await reaches(p1, p2)).toEqual(yes); // disputed
    await settle(host, a, 2, 0);
    expect(await reaches(p1, p2)).toEqual(no); // settled: gone, even with the DM already open
    expect(await reaches(p2, p1)).toEqual(no);

    expect(await reaches(p3, p4)).toEqual(yes); // still pending...
    await start(host, id, [{ a: p1, b: p3 }, { a: p2, b: p4 }], true);
    expect(await reaches(p3, p4)).toEqual(no); // ...but the round moved on
    expect(await reaches(p1, p3)).toEqual(yes);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${p3}', '${p1}')`);
    expect((await reaches(p1, p3)).dm).toBe(false); // the block rule still wins
  });

  it('12. pairings are public once the tournament is; no client writes them; the audit stays with those who run it', async () => {
    const id = await setup();
    await start(host, id, round1);
    const seen = async (who: string) =>
      (await as(who)(`select id from public.tournament_pairings where tournament_id = '${id}'`)).length;
    for (const who of [stranger, p1, host]) expect(await seen(who)).toBe(2);
    for (const who of [host, judge, p1]) {
      expect((await refusal(() => as(who)(
        `insert into public.tournament_pairings (tournament_id, round, table_no, player_a, player_b)
         values ('${id}', 9, 9, '${p1}', '${p2}')`))).message).toMatch(PRIVILEGE_DENIED);
      expect((await refusal(() => as(who)(
        `update public.tournament_pairings set state = 'settled' where tournament_id = '${id}'`))).message).toMatch(PRIVILEGE_DENIED);
      expect((await refusal(() => as(who)(
        `delete from public.tournament_pairings where tournament_id = '${id}'`))).message).toMatch(PRIVILEGE_DENIED);
    }
    const auditSeen = async (who: string) =>
      (await as(who)(`select id from public.tournament_audit where tournament_id = '${id}'`)).length;
    expect(await auditSeen(p1)).toBe(0);
    expect(await auditSeen(stranger)).toBe(0);
    expect(await auditSeen(judge)).toBeGreaterThan(0);
  });

  describe('hardening (20260930000110)', () => {
    const final = (pid: string) =>
      sql(`update public.tournament_pairings set final_at = now() - interval '1 second' where id = '${pid}'`);

    it('a final report is closed to correction, confirmation and dispute; an open one can still be disputed', async () => {
      const id = await setup(undefined, { rounds: 1 });
      await start(host, id, round1);
      const a = (await pairingOf(id, p1)).id;
      const b = (await pairingOf(id, p3)).id;
      await report(p1, a, 2, 0);
      await final(a);
      expect((await refusal(() => call(p2, 'dispute_score', q(a)))).message).toMatch(/that result is final/);
      expect((await refusal(() => call(p2, 'confirm_score', q(a)))).message).toMatch(/that result is final/);
      expect((await refusal(() => report(p1, a, 2, 1))).message).toMatch(/that result is final/);
      expect((await refusal(() => report(p2, a, 0, 2))).message).toMatch(/that result is final/);
      expect(await pairingOf(id, p1)).toMatchObject({ state: 'reported', score_a: 2, score_b: 0 });
      await report(p3, b, 2, 1);
      expect(await call(p4, 'dispute_score', q(b))).toBe('disputed');
    });

    it('nothing is reported, confirmed, disputed, settled, removed or dropped once the tournament is over', async () => {
      const id = await setup(undefined, { rounds: 1 });
      await start(host, id, round1);
      const a = (await pairingOf(id, p1)).id;
      const b = (await pairingOf(id, p3)).id;
      await report(p1, a, 2, 0);
      await final(a);
      await report(p3, b, 2, 1);
      await call(p4, 'confirm_score', q(b));
      expect(await call(host, 'finish_tournament', q(id))).toBe(true);
      // current_round is still the last round; the state is what closes it.
      const over = /this tournament is over/;
      expect((await refusal(() => report(p1, a, 2, 1))).message).toMatch(over);
      expect((await refusal(() => call(p2, 'confirm_score', q(a)))).message).toMatch(over);
      expect((await refusal(() => call(p2, 'dispute_score', q(a)))).message).toMatch(over);
      expect((await refusal(() => settle(judge, a, 0, 2))).message).toMatch(over);
      expect((await refusal(() => call(host, 'remove_player', q(id), q(p2), `'x'`))).message).toMatch(over);
      expect(await call(p2, 'drop_out', q(id))).toBe(false);
      expect(await pairingOf(id, p1)).toMatchObject({ state: 'reported', score_a: 2, score_b: 0, settled_by: null });

      const gone = await setup();
      await start(host, gone, round1);
      await call(host, 'cancel_tournament', q(gone));
      const g = (await pairingOf(gone, p1)).id;
      expect((await refusal(() => settle(judge, g, 2, 0))).message).toMatch(over);
      expect((await refusal(() => report(p1, g, 2, 0))).message).toMatch(over);
      expect((await refusal(() => call(judge, 'remove_player', q(gone), q(p2), `'x'`))).message).toMatch(over);
      expect(await call(p2, 'drop_out', q(gone))).toBe(false);
      const [e] = await sql<{ n: number }>(
        `select count(*)::int as n from public.tournament_entrants where tournament_id in ('${id}', '${gone}') and dropped`);
      expect(e.n).toBe(0);
      expect(await pairingOf(gone, p1)).toMatchObject({ state: 'pending' });
    });

    it('a report on a round that has moved on is refused', async () => {
      const id = await setup();
      await start(host, id, round1);
      const a = (await pairingOf(id, p1)).id;
      await start(host, id, [{ a: p1, b: p3 }, { a: p2, b: p4 }], true);
      expect((await refusal(() => report(p1, a, 2, 0))).message).toMatch(/that round is over/);
    });

    it('drop_out answers a draft like a missing tournament', async () => {
      const [{ id }] = await as(host)<{ id: string }>(
        `select public.create_tournament('Rounds', '', '${six}', ${s(3)}, ${s(25)}, ${s(64)}) as id`);
      expect(await call(p1, 'drop_out', q(id))).toBe(false);
      expect(await call(p1, 'drop_out', q(randomUUID()))).toBe(false);
    });

    it('refuses a round when nobody is left to pair', async () => {
      const id = await setup([p1, p2]);
      await start(host, id, [{ a: p1, b: p2 }]);
      await call(p1, 'drop_out', q(id));
      await call(p2, 'drop_out', q(id));
      expect((await refusal(() => start(host, id, []))).message).toMatch(/nobody is left to pair/);
      expect((await refusal(() => start(host, id, [{ a: p1, b: p2 }]))).message).toMatch(/nobody is left to pair/);
      const [t] = await sql<{ current_round: number }>(`select current_round from public.tournaments where id = '${id}'`);
      expect(t.current_round).toBe(1);
    });

    it('the friend-code policy has its full, short name', async () => {
      const rows = await sql<{ polname: string }>(
        `select polname from pg_policy where polrelid = 'public.friend_codes'::regclass and polname like 'a tournament%'`);
      expect(rows).toEqual([{ polname: 'a tournament opponent may read your friend code' }]);
    });
  });

  it('13. refuses anonymous callers every new RPC, and clients every internal helper', async () => {
    const id = randomUUID();
    const calls: [string, string][] = [
      ['start_round', `select public.start_round('${id}', '[]'::jsonb)`],
      ['report_score', `select public.report_score('${id}', 2::smallint, 0::smallint)`],
      ['confirm_score', `select public.confirm_score('${id}')`],
      ['dispute_score', `select public.dispute_score('${id}')`],
      ['settle_pairing', `select public.settle_pairing('${id}', 2::smallint, 0::smallint)`],
      ['drop_out', `select public.drop_out('${id}')`],
      ['remove_player', `select public.remove_player('${id}', '${p1}', 'x')`],
      ['finish_tournament', `select public.finish_tournament('${id}')`],
    ];
    for (const [fn, sqlText] of calls) {
      expect((await refusal(() => asAnon()(sqlText))).message).toMatch(new RegExp(`permission denied for function ${fn}`));
    }
    const internal: [string, string][] = [
      ['_pairing_counts', `select public._pairing_counts('settled', now())`],
      ['_valid_score', `select public._valid_score(2::smallint, 0::smallint)`],
      ['_forfeit_pending', `select public._forfeit_pending('${id}', '${p1}', '${p1}', 'x')`],
      ['share_a_live_match', `select public.share_a_live_match('${p1}', '${p2}')`],
    ];
    for (const [fn, sqlText] of internal) {
      for (const caller of [as(p1), asAnon()]) {
        expect((await refusal(() => caller(sqlText))).message).toMatch(new RegExp(`permission denied for function ${fn}`));
      }
    }
  });
});
