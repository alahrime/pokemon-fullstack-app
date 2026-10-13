import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, refusal } from './helpers';

describe('rosters reach players without IVs', () => {
  const a = randomUUID(), b = randomUUID();
  const list = `'${a}','${b}'`;
  const as = (id: string) => asUser({ sub: id, role: 'authenticated' });
  const mem = (ref: string) => ({ ref, fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 50, best_buddy: true });
  const team = (ref: string) => `'${JSON.stringify([mem(ref)])}'`;
  let matchId = '', offerId = '';

  beforeAll(async () => {
    for (const [i, id] of [a, b].entries()) {
      await sql(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ('${id}', '${id}@example.com', now(),
        '{"display_name":"RW${i}_${id.slice(0, 8)}","go_username":"RW${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`);
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'RW Cup') returning id`);
    const [v] = await sql<{ id: string }>(`insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`);
    [{ id: matchId }] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source, league, state)
       values ('${a}', '${b}', '${v.id}', 'aa', ${team('medicham')}, ${team('azumarill')}, 'r', 's', 3, 'offer', 'great', 'paired') returning id`);
    [{ id: offerId }] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev, visibility, accepted_team)
       values ('${a}', '${b}', '${v.id}', 'aa', 'great', ${team('medicham')}, 'r', 'private', null) returning id`);
  });
  afterAll(async () => {
    await sql(`delete from public.match_offers where proposer_id in (${list})`);
    await sql(`delete from public.matches where player_a in (${list})`);
    await sql(`delete from public.formats where owner_id = '${a}'`);
    await sql(`delete from auth.users where id in (${list})`);
  });

  it("refuses either player the match's full rosters", async () => {
    for (const col of ['team_a', 'team_b']) {
      expect((await refusal(() => as(b)(`select ${col} from public.matches where id = '${matchId}'`))).code).toBe('42501');
    }
  });

  it('gives both players species and moves only', async () => {
    const [r] = await as(b)<{ team_a_public: unknown[] }>(`select team_a_public from public.matches where id = '${matchId}'`);
    expect(r.team_a_public).toEqual([{ ref: 'medicham', fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH'] }]);
  });

  it("refuses a challenge's target the challenger's full roster, and gives them the stripped one", async () => {
    expect((await refusal(() => as(b)(`select team from public.match_offers where id = '${offerId}'`))).code).toBe('42501');
    expect((await refusal(() => as(a)(`select accepted_team from public.match_offers where id = '${offerId}'`))).code).toBe('42501');
    const [r] = await as(b)<{ team_public: unknown[] }>(`select team_public from public.match_offers where id = '${offerId}'`);
    expect(JSON.stringify(r.team_public)).not.toMatch(/iv_|level|best_buddy/);
  });
});
