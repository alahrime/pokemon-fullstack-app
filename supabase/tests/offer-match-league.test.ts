import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from './helpers';

describe('a match made from an offer carries its league', () => {
  const a = randomUUID(), b = randomUUID();
  const list = `'${a}','${b}'`;
  let versionId = '';
  const match = async () => (await sql<{ id: string }>(
    `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source)
     values ('${a}', '${b}', '${versionId}', 'aa', '[]', '[]', 'r', 's', 3, 'offer') returning id`))[0].id;
  const leagueOf = async (id: string) => (await sql<{ league: string | null }>(`select league from public.matches where id = '${id}'`))[0].league;

  beforeAll(async () => {
    for (const [i, id] of [a, b].entries()) {
      await sql(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ('${id}', '${id}@example.com', now(),
        '{"display_name":"OL${i}_${id.slice(0, 8)}","go_username":"OL${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`);
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'OL Cup') returning id`);
    [{ id: versionId }] = await sql<{ id: string }>(`insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`);
  });
  afterAll(async () => {
    await sql(`delete from public.match_offers where proposer_id in (${list})`);
    await sql(`delete from public.matches where player_a in (${list})`);
    await sql(`delete from public.formats where owner_id = '${a}'`);
    await sql(`delete from auth.users where id in (${list})`);
  });

  it('when the offer is pointed at its match (the accept/confirm path)', async () => {
    const m = await match();
    const [o] = await sql<{ id: string }>(`insert into public.match_offers (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
      values ('${a}', '${b}', '${versionId}', 'aa', 'ultra', '[]', 'r', 'private') returning id`);
    expect(await leagueOf(m)).toBeNull();
    await sql(`update public.match_offers set state = 'converted', match_id = '${m}' where id = '${o.id}'`);
    expect(await leagueOf(m)).toBe('ultra');
  });

  it('never overwrites a league the match already has', async () => {
    const m = await match();
    await sql(`update public.matches set league = 'great' where id = '${m}'`);
    await sql(`insert into public.match_offers (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev, visibility, match_id, state)
      values ('${a}', '${b}', '${versionId}', 'aa', 'master', '[]', 'r', 'private', '${m}', 'converted')`);
    expect(await leagueOf(m)).toBe('great');
  });
});
