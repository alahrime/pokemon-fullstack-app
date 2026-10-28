import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal, POLICY_DENIED } from './helpers';

describe('battle tracker', () => {
  // me; friend; pub (opted in, a stranger); priv (a stranger who did not opt in).
  const me = randomUUID(), friend = randomUUID(), pub = randomUUID(), priv = randomUUID();
  const all = [me, friend, pub, priv];
  const list = all.map((u) => `'${u}'`).join(',');
  const as = (id: string) => asUser({ sub: id, role: 'authenticated' });
  const ids: Record<string, string> = {};
  // A format of this run's own, so other players' battles on this database never reach the meta counts.
  const fmt = `bt-${me.slice(0, 8)}`;

  /** One set of `results` (win/loss/tie/null) against `opp`, at `elo` start and `elo + delta` end. */
  async function set(who: string, elo: number, delta: number, results: (string | null)[], opp = ['azumarill', 'registeel', 'altaria']) {
    const [s] = await sql<{ id: string }>(
      `insert into public.gbl_sets (user_id, season, format, elo_start, elo_end) values ('${who}', 28, '${fmt}', ${elo}, ${elo + delta}) returning id`);
    for (const [i, r] of results.entries()) {
      await sql(`insert into public.gbl_battles (set_id, user_id, idx, result, opponents)
                 values ('${s.id}', '${who}', ${i + 1}, ${r ? `'${r}'` : 'null'}, '{${opp.join(',')}}')`);
    }
    return s.id;
  }

  beforeAll(async () => {
    for (const [i, id] of all.entries()) {
      await sql(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ('${id}', '${id}@example.com', now(),
        '{"display_name":"BT${i}_${id.slice(0, 8)}","go_username":"BT${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`);
    }
    await sql(`update public.profiles set gbl_public = true where id = '${pub}'`);
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by, status)
               values (public.pair_lo('${me}', '${friend}'), public.pair_hi('${me}', '${friend}'), '${me}', 'accepted')`);
    ids.me = await set(me, 2500, 40, ['win', 'win', 'loss', 'tie', null]);
    ids.friend = await set(friend, 2100, -20, ['loss', 'loss', 'win']);
    ids.pub = await set(pub, 2800, 30, ['win', 'win', 'win', 'loss', 'win'], ['medicham', 'azumarill']);
    ids.priv = await set(priv, 3000, 10, ['win'], ['medicham']);
  });
  afterAll(async () => {
    await sql(`delete from auth.users where id in (${list})`);
  });

  it('keeps sets and battles to their owner', async () => {
    expect(await as(me)(`select id from public.gbl_sets`)).toEqual([{ id: ids.me }]);
    expect(await as(friend)(`select id from public.gbl_battles where set_id = '${ids.me}'`)).toEqual([]);
    expect(await as(friend)(`update public.gbl_sets set elo_end = 4000 where id = '${ids.me}' returning id`)).toEqual([]);
  });

  it('refuses a battle written into someone else\'s set', async () => {
    const r = await refusal(() => as(friend)(
      `insert into public.gbl_battles (set_id, user_id, idx, result) values ('${ids.me}', '${friend}', 1, 'win')`));
    expect(r.message).toMatch(POLICY_DENIED);
  });

  it('shows a season to its owner, a friend and, once opted in, everyone — and nobody else', async () => {
    const tally = (who: string, of: string) => as(who)<{ wins: number; losses: number; ties: number; battles: number }>(
      `select wins, losses, ties, battles from public.gbl_season_sets('${of}', 28::smallint)`);
    expect(await tally(me, me)).toEqual([{ wins: 2, losses: 1, ties: 1, battles: 5 }]);
    expect(await tally(friend, me)).toEqual([{ wins: 2, losses: 1, ties: 1, battles: 5 }]);
    expect(await tally(priv, me)).toEqual([]);
    expect(await tally(priv, pub)).toEqual([{ wins: 4, losses: 1, ties: 0, battles: 5 }]);
    expect(await tally(me, priv)).toEqual([]);
  });

  it('ranks the visible ladder by the last Elo written down', async () => {
    const board = await as(me)<{ user_id: string; elo: number; is_friend: boolean }>(
      `select user_id, elo, is_friend from public.gbl_leaderboard(28::smallint) where user_id in (${list})`);
    expect(board).toEqual([
      { user_id: pub, elo: 2830, is_friend: false },
      { user_id: me, elo: 2540, is_friend: false },
      { user_id: friend, elo: 2080, is_friend: true },
    ]);
  });

  it('closes both rings when either side blocks', async () => {
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${pub}', '${me}')`);
    const board = await as(me)<{ user_id: string }>(`select user_id from public.gbl_leaderboard(28::smallint)`);
    expect(board.map((r) => r.user_id)).not.toContain(pub);
    expect(await as(me)(`select * from public.gbl_season_sets('${pub}', 28::smallint)`)).toEqual([]);
    await sql(`delete from public.blocks where blocker_id = '${pub}'`);
  });

  it('counts the meta from opted-in players and the caller, by Elo band', async () => {
    type Row = { ref: string; seen: number; wins: number; losses: number; battles: number; players: number };
    const meta = (lo: string, hi: string) => as(me)<Row>(
      `select ref, seen, wins, losses, battles, players from public.gbl_meta('${fmt}', now() - interval '1 day', ${lo}, ${hi})`);
    const every = await meta('null', 'null');
    // pub's five and my five; the friend's and the stranger's are not opted in.
    expect(every[0]).toMatchObject({ ref: 'azumarill', seen: 10, wins: 6, losses: 2, battles: 10, players: 2 });
    expect(every.find((r) => r.ref === 'medicham')).toMatchObject({ seen: 5, wins: 4 });
    // Expert band: only pub's set started there.
    const expert = await meta('2750::smallint', '2999::smallint');
    expect(expert.map((r) => r.ref).sort()).toEqual(['azumarill', 'medicham']);
    expect(expert[0]).toMatchObject({ battles: 5, players: 1 });
  });

  it('counts the moves players saw, out of the sightings that recorded any', async () => {
    const [b] = await sql<{ id: string }>(`select id from public.gbl_battles where set_id = '${ids.pub}' and idx = 1`);
    await sql(`update public.gbl_battles set opponent_moves = '[{"fast":"COUNTER","charges":["ICE_PUNCH"]},{"fast":null,"charges":[]}]',
               note = 'baited Ice Punch' where id = '${b.id}'`);
    const [c] = await sql<{ id: string }>(`select id from public.gbl_battles where set_id = '${ids.pub}' and idx = 2`);
    await sql(`update public.gbl_battles set opponent_moves = '[{"fast":"COUNTER","charges":["ICE_PUNCH","DYNAMIC_PUNCH"]}]' where id = '${c.id}'`);
    const moves = await as(me)<{ ref: string; kind: string; move: string; n: number; known: number }>(
      `select ref, kind, move, n, known from public.gbl_meta_moves('${fmt}', now() - interval '1 day') order by kind, move`);
    // Azumarill was seen in that battle but with nothing recorded, so it has no rows.
    expect(moves).toEqual([
      { ref: 'medicham', kind: 'charge', move: 'DYNAMIC_PUNCH', n: 1, known: 2 },
      { ref: 'medicham', kind: 'charge', move: 'ICE_PUNCH', n: 2, known: 2 },
      { ref: 'medicham', kind: 'fast', move: 'COUNTER', n: 2, known: 2 },
    ]);
  });

  it('keeps a battle note to its owner, whatever else is shared', async () => {
    expect(await as(pub)<{ note: string }>(`select note from public.gbl_battles where note is not null`)).toEqual([{ note: 'baited Ice Punch' }]);
    expect(await as(me)(`select note from public.gbl_battles where note is not null`)).toEqual([]);
  });

  it('lets nobody call the meta population directly', async () => {
    const r = await refusal(() => as(me)(`select * from public._gbl_meta_pop('${fmt}', now() - interval '1 day', null, null)`));
    expect(r.code).toBe('42501');
  });

  describe('alternate accounts', () => {
    const goName = async (id: string) => (await sql<{ g: string }>(`select go_username g from public.profiles where id = '${id}'`))[0].g;
    const alt = (who: string, name: string) => as(who)<{ id: string }>(`insert into public.gbl_accounts (name) values ('${name}') returning id`);

    it('allows two alts besides the main account, and no third', async () => {
      await alt(me, 'AltOne');
      await alt(me, 'AltTwo');
      expect((await refusal(() => alt(me, 'AltThree'))).message).toMatch(/two alternate accounts at most/);
    });

    it('refuses an alt named like the main account, or like the other alt', async () => {
      expect((await refusal(() => alt(friend, '   '))).code).toBe('23514');
      const main = await goName(friend);
      expect((await refusal(() => alt(friend, main.toUpperCase()))).message).toMatch(/main account's trainer name/);
      await alt(friend, 'Second');
      expect((await refusal(() => alt(friend, 'SECOND'))).code).toBe('23505');
      // Another player's main name is fine.
      await alt(priv, await goName(friend));
    });

    it('keeps each account to its own set, season and ladder row', async () => {
      const [a] = await as(me)<{ id: string }>(`select id from public.gbl_accounts where name = 'AltOne'`);
      const [s] = await as(me)<{ id: string }>(
        `insert into public.gbl_sets (season, format, account_id, elo_start, elo_end) values (28, '${fmt}', '${a.id}', 1800, 1850) returning id`);
      await as(me)(`insert into public.gbl_battles (set_id, idx, result) values ('${s.id}', 1, 'win')`);
      // The main account's season is untouched; the alt's is its own.
      expect(await as(me)<{ battles: number }>(`select battles from public.gbl_season_sets('${me}', 28::smallint)`)).toEqual([{ battles: 5 }]);
      expect(await as(friend)<{ battles: number }>(`select battles from public.gbl_season_sets('${me}', 28::smallint, '${a.id}')`)).toEqual([{ battles: 1 }]);
      const rows = await as(me)<{ account_name: string | null; elo: number }>(
        `select account_name, elo from public.gbl_leaderboard(28::smallint) where user_id = '${me}' order by elo desc`);
      expect(rows).toEqual([{ account_name: null, elo: 2540 }, { account_name: 'AltOne', elo: 1850 }]);
    });

    it('refuses a set on someone else\'s alt, and takes an alt\'s sets with it when deleted', async () => {
      const [a] = await as(me)<{ id: string }>(`select id from public.gbl_accounts where name = 'AltOne'`);
      expect((await refusal(() => as(friend)(`insert into public.gbl_sets (season, format, account_id) values (28, 'great', '${a.id}')`))).message)
        .toMatch(POLICY_DENIED);
      await as(me)(`delete from public.gbl_accounts where id = '${a.id}'`);
      expect(await sql(`select 1 from public.gbl_sets where account_id = '${a.id}'`)).toEqual([]);
    });
  });

  it('keeps saved teams of three to their owner, once each', async () => {
    const save = (who: string, team: string) => as(who)<{ id: string }>(`insert into public.gbl_teams (team) values ('{${team}}') returning id`);
    const [t] = await save(me, 'medicham,azumarill,registeel');
    expect((await refusal(() => save(me, 'medicham,azumarill,registeel'))).code).toBe('23505');
    expect((await refusal(() => save(me, 'medicham,azumarill'))).code).toBe('23514');
    // The same three on another player is theirs to keep; neither sees the other's.
    await save(friend, 'medicham,azumarill,registeel');
    expect(await as(me)(`select id from public.gbl_teams`)).toEqual([{ id: t.id }]);
    expect(await as(friend)(`delete from public.gbl_teams where id = '${t.id}' returning id`)).toEqual([]);
    expect((await refusal(() => asAnon()(`select * from public.gbl_teams`))).code).toBe('42501');
  });

  it('keeps one day size per account and day to its owner, and upserts it', async () => {
    const put = (who: string, size: number, account = 'null') => as(who)(
      `insert into public.gbl_day_sizes (account_id, day, size) values (${account}, '2026-10-28', ${size})
       on conflict (user_id, account_id, day) do update set size = excluded.size`);
    await put(me, 50);
    await put(me, 100);
    expect(await as(me)(`select size from public.gbl_day_sizes`)).toEqual([{ size: 100 }]);
    expect((await refusal(() => put(me, 30))).code).toBe('23514');
    // Another player's alt is not an account of mine to size.
    const [alt] = await sql<{ id: string }>(`insert into public.gbl_accounts (user_id, name) values ('${friend}', 'DS${friend.slice(0, 6)}') returning id`);
    expect((await refusal(() => put(me, 50, `'${alt.id}'`))).message).toMatch(POLICY_DENIED);
    expect(await as(friend)(`select * from public.gbl_day_sizes`)).toEqual([]);
    expect((await refusal(() => asAnon()(`select * from public.gbl_day_sizes`))).code).toBe('42501');
  });

  it('refuses anonymous callers', async () => {
    expect((await refusal(() => asAnon()(`select * from public.gbl_leaderboard(28::smallint)`))).code).toBe('42501');
    expect((await refusal(() => asAnon()(`select * from public.gbl_sets`))).code).toBe('42501');
  });
});
