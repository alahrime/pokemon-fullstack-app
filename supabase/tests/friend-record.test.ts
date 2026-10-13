import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

describe('friend_record', () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
  const list = [a, b, c, d].map((u) => `'${u}'`).join(',');
  const as = (id: string) => asUser({ sub: id, role: 'authenticated' });
  const rec = (who: string, of: string) =>
    as(who)<{ wins: number; losses: number; opponents: number }>(`select * from public.friend_record('${of}')`);

  async function match(x: string, y: string, state: string, winner: string) {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source, league, state)
       select '${x}', '${y}', v.id, 'aa', '[]', '[]', 'r', 's', 3, 'offer', 'great', '${state}'
         from public.format_versions v join public.formats f on f.id = v.format_id where f.owner_id = '${a}' returning id`);
    await sql(`insert into public.match_rounds (match_id, round_no, winner) values ('${m.id}', 1, '${winner}'), ('${m.id}', 2, '${winner}')`);
  }

  beforeAll(async () => {
    for (const [i, id] of [a, b, c, d].entries()) {
      await sql(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ('${id}', '${id}@example.com', now(),
        '{"display_name":"FR${i}_${id.slice(0, 8)}","go_username":"FR${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`);
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'FR Cup') returning id`);
    await sql(`insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa')`);
    await match(a, c, 'confirmed', a);
    await match(c, a, 'confirmed', a);
    await match(a, d, 'confirmed', d);
    await match(a, d, 'disputed', a); // not confirmed: not counted
    // a and b are friends; c and a played but are not friends.
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by, status)
               values (public.pair_lo('${a}', '${b}'), public.pair_hi('${a}', '${b}'), '${a}', 'accepted')`);
  });
  afterAll(async () => {
    await sql(`delete from public.matches where player_a in (${list}) or player_b in (${list})`);
    await sql(`delete from public.formats where owner_id = '${a}'`);
    await sql(`delete from auth.users where id in (${list})`);
  });

  it('gives the player and their friends the totals', async () => {
    expect(await rec(a, a)).toEqual([{ wins: 2, losses: 1, opponents: 2 }]);
    expect(await rec(b, a)).toEqual([{ wins: 2, losses: 1, opponents: 2 }]);
  });

  it('gives anyone else nothing, opponents included', async () => {
    expect(await rec(c, a)).toEqual([]);
    expect(await rec(d, a)).toEqual([]);
  });

  it('closes when a friend blocks', async () => {
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${a}', '${b}')`);
    expect(await rec(b, a)).toEqual([]);
    await sql(`delete from public.blocks where blocker_id = '${a}'`);
  });

  it('refuses anonymous callers', async () => {
    expect((await refusal(() => asAnon()(`select * from public.friend_record('${a}')`))).code).toBe('42501');
  });
});
