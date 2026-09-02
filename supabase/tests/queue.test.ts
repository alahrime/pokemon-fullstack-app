import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('queue and match policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(userA, `QA_${userA.slice(0, 8)}`);
    await makeUser(userB, `QB_${userB.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${userA}', 'Queue Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a in ('${userA}','${userB}') or player_b in ('${userA}','${userB}')`);
    await sql(`delete from public.queue_entries where user_id in ('${userA}','${userB}')`);
  });

  const enqueue = (owner: string) =>
    asUser({ sub: owner })<{ id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning id`,
    );

  it('lets someone join the queue without naming themselves', async () => {
    const rows = await asUser({ sub: userA })<{ user_id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning user_id`,
    );
    expect(rows[0].user_id).toBe(userA);
  });

  it('refuses a queue entry made on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, team, data_rev)
         values ('${userA}', 'great', '${versionId}', 'aa', '[]'::jsonb, 'rev1')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides a queue entry from everyone but its owner', async () => {
    await enqueue(userA);
    expect(await asUser({ sub: userB })(`select id from public.queue_entries`)).toHaveLength(0);
    expect(await asAnon()(`select id from public.queue_entries`)).toHaveLength(0);
  });

  it('allows only one queue entry per person', async () => {
    await enqueue(userA);
    await expect(enqueue(userA)).rejects.toThrow(/queue_entries_one_per_user/);
  });

  it('lets a player see a match they are in, and nobody else see it', async () => {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-1','queue') returning id`,
    );
    expect(await asUser({ sub: userA })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(1);
    const stranger = randomUUID();
    await makeUser(stranger, `QS_${stranger.slice(0, 8)}`);
    expect(await asUser({ sub: stranger })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(0);
  });

  /** The reason this table exists as coordinator-only. */
  it('refuses a match inserted by a player, even one they are in', async () => {
    await expect(
      asUser({ sub: userA })(
        `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
         values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-2','queue')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('reveals an opponent\'s friend code, and only to an opponent', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')`);
    const stranger = randomUUID();
    await makeUser(stranger, `QT_${stranger.slice(0, 8)}`);
    // Before any match: invisible.
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-3','queue')`);
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
    expect(await asUser({ sub: stranger })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
  });
});
