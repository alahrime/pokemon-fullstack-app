import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

describe('glicko2_update', () => {
  it("reproduces Glickman's worked example (1500/200/0.06 vs three opponents)", async () => {
    const [r] = await sql<{ rating: number; rd: number; vol: number }>(
      `select * from public.glicko2_update(1500, 200, 0.06,
         array[1400,1550,1700]::float8[], array[30,100,300]::float8[], array[1,0,0]::float8[], 0.5)`,
    );
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });

  it('is symmetric for two fresh players: winner up, loser down by the same amount', async () => {
    const [w] = await sql<{ rating: number; rd: number }>(
      `select * from public.glicko2_update(1500, 350, 0.06, array[1500]::float8[], array[350]::float8[], array[1]::float8[])`,
    );
    const [l] = await sql<{ rating: number; rd: number }>(
      `select * from public.glicko2_update(1500, 350, 0.06, array[1500]::float8[], array[350]::float8[], array[0]::float8[])`,
    );
    expect(w.rating).toBeGreaterThan(1500);
    expect(w.rating - 1500).toBeCloseTo(1500 - l.rating, 6);
    expect(w.rd).toBeLessThan(350);
    expect(w.rd).toBeCloseTo(l.rd, 6);
  });
});

describe('seasons and ratings schema', () => {
  it('season_for is one row per UTC month and idempotent', async () => {
    const [a] = await sql<{ id: string }>(`select public.season_for('2031-03-31 23:59:59+00') as id`);
    const [b] = await sql<{ id: string }>(`select public.season_for('2031-03-01 00:00:00+00') as id`);
    const [c] = await sql<{ id: string }>(`select public.season_for('2031-04-01 00:00:00+00') as id`);
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
    const [s] = await sql<{ s: string; e: string }>(
      `select starts_at::text as s, ends_at::text as e from public.seasons where id = '${a.id}'`,
    );
    expect(s.s).toMatch(/^2031-03-01 00:00:00/);
    expect(s.e).toMatch(/^2031-04-01 00:00:00/);
  });

  it('refuses every client write to ratings and seasons', async () => {
    const me = randomUUID();
    const asMe = asUser({ sub: me, role: 'authenticated' });
    for (const q of [
      `insert into public.ratings (season_id, league, user_id) values (gen_random_uuid(), 'great', '${me}')`,
      `update public.ratings set rating = 3000`,
      `delete from public.ratings`,
      `insert into public.seasons (starts_at, ends_at) values (now(), now())`,
    ]) expect((await refusal(() => asMe(q))).code).toBe('42501');
    expect((await refusal(() => asAnon()(`select * from public.ratings`))).code).toBe('42501');
  });
});

describe('sweep_ratings and leaderboard', () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
  const users = [a, b, c, d];
  const list = users.map((u) => `'${u}'`).join(',');
  let versionId = '';

  beforeAll(async () => {
    for (const [i, id] of users.entries()) {
      await sql(
        `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         values ('${id}', '${id}@example.com', now(),
           '{"display_name":"RT${i}_${id.slice(0, 8)}","go_username":"RT${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`,
      );
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'Rating Cup') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  // The 2031 seasons below are this suite's own; leave the shared table as found.
  afterAll(() => sql(`delete from public.seasons where starts_at >= '2031-01-01' and starts_at < '2032-01-01'`));

  afterEach(async () => {
    await sql(`delete from public.ratings where user_id in (${list})`);
    await sql(`delete from public.matches where player_a in (${list}) or player_b in (${list})`);
  });

  async function ratedMatch(x: string, y: string, winner: 'a' | 'b', o: { league?: string | null; source?: string; settled?: string; state?: string } = {}) {
    const league = o.league === undefined ? 'great' : o.league;
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source, league, state)
       values ('${x}', '${y}', '${versionId}', 'aa', '[]', '[]', 'r', 's', 3, '${o.source ?? 'queue'}',
               ${league === null ? 'null' : `'${league}'`}, 'paired') returning id`,
    );
    const w = winner === 'a' ? x : y;
    await sql(`insert into public.match_rounds (match_id, round_no, winner) values ('${m.id}', 1, '${w}'), ('${m.id}', 2, '${w}')`);
    await sql(`update public.matches set state = '${o.state ?? 'confirmed'}' where id = '${m.id}'`);
    if (o.settled) await sql(`update public.matches set settled_at = '${o.settled}' where id = '${m.id}'`);
    return m.id;
  }
  const mine = () => sql<{ user_id: string; rating: number; games: number; wins: number; season_id: string; rd: number }>(
    `select user_id, rating, rd, games, wins, season_id from public.ratings where user_id in (${list})`,
  );
  // The sweep is global; rows other suites left unrated are not ours to assert on.
  const sweep = () => sql(`select public.sweep_ratings()`);

  it('rates a confirmed queue match once, and only once', async () => {
    const id = await ratedMatch(a, b, 'a');
    await sweep();
    const rows = await mine();
    const ra = rows.find((r) => r.user_id === a)!, rb = rows.find((r) => r.user_id === b)!;
    expect(ra.rating).toBeGreaterThan(1500);
    expect(rb.rating).toBeLessThan(1500);
    expect([ra.games, ra.wins, rb.games, rb.wins]).toEqual([1, 1, 1, 0]);
    const [m] = await sql<{ rated_at: string | null }>(`select rated_at from public.matches where id = '${id}'`);
    expect(m.rated_at).not.toBeNull();
    await sweep();
    expect(await mine()).toEqual(rows);
  });

  it('ignores anything that is not an eligible queue match', async () => {
    const ids = [
      await ratedMatch(a, b, 'a', { source: 'offer' }),
      await ratedMatch(a, b, 'a', { league: 'ubl' }),
      await ratedMatch(a, b, 'a', { league: null }),
      await ratedMatch(a, b, 'a', { state: 'unverified' }),
    ];
    await sweep();
    expect(await mine()).toEqual([]);
    const left = await sql(`select id from public.matches where id in (${ids.map((i) => `'${i}'`).join(',')}) and rated_at is null`);
    expect(left).toHaveLength(4);
  });

  it('starts a fresh rating each UTC month', async () => {
    await ratedMatch(a, b, 'a', { settled: '2031-03-31 23:59:59+00' });
    await ratedMatch(a, b, 'a', { settled: '2031-04-01 00:00:01+00' });
    await sweep();
    const rows = (await mine()).filter((r) => r.user_id === a);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.season_id)).size).toBe(2);
    expect(rows.every((r) => r.games === 1)).toBe(true);
    expect(rows[0].rating).toBeCloseTo(rows[1].rating, 6);
  });

  it('lists only players past the gate, and shows everyone their own row', async () => {
    const sid = (await sql<{ id: string }>(`select public.season_for('2031-05-10 00:00:00+00') as id`))[0].id;
    const put = (u: string, r: number, rd: number, g: number) =>
      sql(`insert into public.ratings (season_id, league, user_id, rating, rd, games) values ('${sid}', 'great', '${u}', ${r}, ${rd}, ${g})`);
    await put(a, 1620, 100, 7);
    await put(b, 1700, 150, 9); // RD too wide
    await put(c, 1800, 50, 3); //  too few games
    const board = await asUser({ sub: d, role: 'authenticated' })<{ pos: string; user_id: string; display_name: string; rating: number }>(
      `select * from public.leaderboard('${sid}', 'great')`,
    );
    expect(board.map((r) => r.user_id)).toEqual([a]);
    expect(Number(board[0].pos)).toBe(1);
    expect(board[0].rating).toBe(1620);
    expect(board[0].display_name).toMatch(/^RT0_/);

    const asB = asUser({ sub: b, role: 'authenticated' });
    const seen = (await asB<{ user_id: string }>(`select user_id from public.ratings where season_id = '${sid}'`)).map((r) => r.user_id);
    expect(seen.sort()).toEqual([a, b].sort()); // own provisional row + the listed player, not c
    expect((await refusal(() => asAnon()(`select * from public.leaderboard('${sid}', 'great')`))).code).toBe('42501');
  });

  it('rates a match that was adjudicated through the real submit_report path', async () => {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source, league)
       values ('${c}', '${d}', '${versionId}', 'aa', '[]', '[]', 'r', 's', 3, 'queue', 'master') returning id`,
    );
    for (const who of [c, d]) {
      await asUser({ sub: who, role: 'authenticated' })(`select public.submit_report('${m.id}', '{b,b}'::text[])`);
    }
    const [row] = await sql<{ state: string; settled_at: string | null }>(`select state, settled_at from public.matches where id = '${m.id}'`);
    expect(row.state).toBe('confirmed');
    expect(row.settled_at).not.toBeNull();
    await sweep();
    const rows = await mine();
    expect(rows.find((r) => r.user_id === d)!.wins).toBe(1);
    expect(rows.find((r) => r.user_id === c)!.wins).toBe(0);
  });

  it('pair_queue_entries stamps the entry league on the match', async () => {
    const hash = `lg-${randomUUID()}`;
    for (const u of [a, b]) {
      await sql(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('${u}', 'ultra', '${versionId}', '${hash}', '${hash}', '[]'::jsonb, 'rev-lg')`,
      );
    }
    await sql(`select public.pair_queue_entries()`);
    const [m] = await sql<{ league: string }>(`select league from public.matches where rules_hash = '${hash}'`);
    expect(m.league).toBe('ultra');
  });
});
