import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

describe('my_match_records', () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  const list = [a, b, c].map((u) => `'${u}'`).join(',');
  let versionId = '';
  const ids: Record<string, string> = {};

  async function match(key: string, x: string, y: string, state: string, winner: string, source = 'queue', league = 'great') {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source, league, state)
       values ('${x}', '${y}', '${versionId}', 'aa', '[]', '[]', 'r', 's', 3, '${source}', '${league}', '${state}') returning id`,
    );
    await sql(`insert into public.match_rounds (match_id, round_no, winner) values ('${m.id}', 1, '${winner}'), ('${m.id}', 2, '${winner}')`);
    ids[key] = m.id;
  }

  beforeAll(async () => {
    for (const [i, id] of [a, b, c].entries()) {
      await sql(
        `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         values ('${id}', '${id}@example.com', now(),
           '{"display_name":"RC${i}_${id.slice(0, 8)}","go_username":"RC${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`,
      );
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'Records Cup') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
    await match('aWins', a, b, 'confirmed', a);
    await match('aLosesSeat2', c, a, 'confirmed', c, 'offer', 'ubl');
    await match('disputed', a, b, 'disputed', a);
    await match('bc', b, c, 'confirmed', b);
  });

  afterAll(async () => {
    await sql(`delete from public.matches where player_a in (${list}) or player_b in (${list})`);
  });

  it("shows each player only their own confirmed matches, from their own side", async () => {
    const rows = await asUser({ sub: a, role: 'authenticated' })<{ match_id: string; won: boolean; opponent_id: string; my_rounds: number; opp_rounds: number; ranked: boolean }>(
      `select * from public.my_match_records order by match_id`,
    );
    expect(rows.map((r) => r.match_id).sort()).toEqual([ids.aWins, ids.aLosesSeat2].sort());
    const win = rows.find((r) => r.match_id === ids.aWins)!;
    expect([win.won, win.opponent_id, win.my_rounds, win.opp_rounds, win.ranked]).toEqual([true, b, 2, 0, true]);
    const loss = rows.find((r) => r.match_id === ids.aLosesSeat2)!;
    expect([loss.won, loss.opponent_id, loss.my_rounds, loss.opp_rounds, loss.ranked]).toEqual([false, c, 0, 2, false]);
  });

  it('gives the opponent the mirror image, and a third party nothing of it', async () => {
    const bRows = await asUser({ sub: b, role: 'authenticated' })<{ match_id: string; won: boolean }>(`select match_id, won from public.my_match_records`);
    expect(bRows.find((r) => r.match_id === ids.aWins)!.won).toBe(false);
    expect(bRows.map((r) => r.match_id)).not.toContain(ids.aLosesSeat2);
  });

  it('refuses anonymous callers', async () => {
    expect((await refusal(() => asAnon()(`select * from public.my_match_records`))).code).toBe('42501');
  });
});
