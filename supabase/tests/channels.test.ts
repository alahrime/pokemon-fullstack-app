import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

describe('channels and membership', () => {
  const ann = randomUUID();
  const bob = randomUUID();
  const cal = randomUUID();

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  async function makeChannel(kind: string, members: string[]): Promise<string> {
    const [c] = await sql<{ id: string }>(
      `insert into public.channels (kind, created_by) values ('${kind}', '${members[0]}') returning id`,
    );
    for (const m of members) {
      await sql(`insert into public.channel_members (channel_id, user_id) values ('${c.id}', '${m}')`);
    }
    return c.id;
  }

  beforeAll(async () => {
    await makeUser(ann, `CA_${ann.slice(0, 8)}`);
    await makeUser(bob, `CB_${bob.slice(0, 8)}`);
    await makeUser(cal, `CC_${cal.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.channels where created_by in ('${ann}','${bob}','${cal}')`);
    // Later tasks append tests that call befriend() and block(); without these
    // two the second such test collides on the friendships primary key.
    await sql(`delete from public.friendships where user_lo in ('${ann}','${bob}','${cal}') or user_hi in ('${ann}','${bob}','${cal}')`);
    await sql(`delete from public.blocks where blocker_id in ('${ann}','${bob}','${cal}')`);
    await sql(`delete from public.matches where player_a in ('${ann}','${bob}','${cal}') or player_b in ('${ann}','${bob}','${cal}')`);
  });

  it('shows a channel to its members and to nobody else', async () => {
    const id = await makeChannel('group', [ann, bob]);
    expect(await asUser({ sub: ann })(`select * from public.channels where id = '${id}'`)).toHaveLength(1);
    expect(await asUser({ sub: bob })(`select * from public.channels where id = '${id}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select * from public.channels where id = '${id}'`)).toHaveLength(0);
  });

  it('shows the member list only to members', async () => {
    const id = await makeChannel('group', [ann, bob]);
    expect(await asUser({ sub: ann })(`select * from public.channel_members where channel_id = '${id}'`)).toHaveLength(2);
    expect(await asUser({ sub: cal })(`select * from public.channel_members where channel_id = '${id}'`)).toHaveLength(0);
  });

  it('lets nobody create a channel or add a member directly', async () => {
    const denied_privilege_denied = await refusal(() =>
        asUser({ sub: ann })(`insert into public.channels (kind, created_by) values ('group', '${ann}')`),
    );
    expect(denied_privilege_denied.message).toMatch(PRIVILEGE_DENIED);
    const id = await makeChannel('group', [ann]);
    const denied_privilege_denied_2 = await refusal(() =>
        asUser({ sub: ann })(`insert into public.channel_members (channel_id, user_id) values ('${id}', '${cal}')`),
    );
    expect(denied_privilege_denied_2.message).toMatch(PRIVILEGE_DENIED);
  });

  it('lets a member mark their own read position and nobody else s', async () => {
    const id = await makeChannel('group', [ann, bob]);
    await asUser({ sub: ann })(
      `update public.channel_members set last_read_at = now() where channel_id = '${id}' and user_id = '${ann}'`,
    );
    // Filtered out by USING: 0 rows, no error.
    await asUser({ sub: ann })(
      `update public.channel_members set last_read_at = now() where channel_id = '${id}' and user_id = '${bob}'`,
    );
    const [theirs] = await sql<{ last_read_at: string | null }>(
      `select last_read_at from public.channel_members where channel_id = '${id}' and user_id = '${bob}'`,
    );
    expect(theirs.last_read_at).toBeNull();
  });

  it('allows one dm channel per pair and no more', async () => {
    const key = [ann, bob].sort().join(':');
    await sql(`insert into public.channels (kind, created_by, dm_key) values ('dm', '${ann}', '${key}')`);
    await expect(
      sql(`insert into public.channels (kind, created_by, dm_key) values ('dm', '${bob}', '${key}')`),
    ).rejects.toThrow(/duplicate key|channels_dm_key/);
  });

  async function befriend(a: string, b: string) {
    const [lo, hi] = [a, b].sort();
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by, status)
               values ('${lo}', '${hi}', '${a}', 'accepted')`);
  }

  const openDm = (who: string, other: string) =>
    asUser({ sub: who })<{ open_dm: string }>(`select public.open_dm('${other}') as open_dm`);

  it('opens a dm with a friend, and returns the same channel twice', async () => {
    await befriend(ann, bob);
    const [first] = await openDm(ann, bob);
    const [second] = await openDm(bob, ann);
    expect(second.open_dm).toBe(first.open_dm);
    expect(await sql(`select * from public.channel_members where channel_id = '${first.open_dm}'`)).toHaveLength(2);
  });

  it('opens a dm with an opponent you share a live match with, without a friendship', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Chat Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cc') returning id`,
    );
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${ann}', '${cal}', '${v.id}', 'cc', '[]'::jsonb, '[]'::jsonb, 'r', 's', 'queue')`,
    );
    const [dm] = await openDm(ann, cal);
    expect(dm.open_dm).toBeTruthy();
  });

  it('refuses a dm with a stranger, and gives the identical refusal to a blocked user and a nonexistent profile', async () => {
    const stranger = await refusal(() => openDm(ann, bob));
    expect(stranger.message).toMatch(/cannot be messaged/);

    await befriend(ann, bob);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${bob}')`);
    const blocked = await refusal(() => openDm(bob, ann));
    const nonexistent = await refusal(() => openDm(ann, randomUUID()));

    // Same sentence for every reason a DM cannot be opened: a caller able to
    // tell these apart would have a working block detector. Compared as
    // identical strings, not each matched against a literal separately, so a
    // wording difference that both happen to satisfy a loose regex still fails.
    expect(blocked.message).toBe(stranger.message);
    expect(nonexistent.message).toBe(stranger.message);
  });

  it('creates a group only out of the creator s own friends', async () => {
    await befriend(ann, bob);
    await expect(
      asUser({ sub: ann })(`select public.create_group('Squad', array['${bob}','${cal}']::uuid[])`),
    ).rejects.toThrow(/only add your own friends/);

    await befriend(ann, cal);
    const [g] = await asUser({ sub: ann })<{ create_group: string }>(
      `select public.create_group('Squad', array['${bob}','${cal}']::uuid[]) as create_group`,
    );
    expect(await sql(`select * from public.channel_members where channel_id = '${g.create_group}'`)).toHaveLength(3);
  });

  it('lets a member add their own friend, and refuses to add a stranger', async () => {
    await befriend(ann, bob);
    const [g] = await asUser({ sub: ann })<{ create_group: string }>(
      `select public.create_group('Squad', array['${bob}']::uuid[]) as create_group`,
    );
    // bob is a member but is not friends with cal.
    await expect(
      asUser({ sub: bob })(`select public.add_to_group('${g.create_group}', '${cal}')`),
    ).rejects.toThrow(/only add your own friends/);

    await befriend(bob, cal);
    const [added] = await asUser({ sub: bob })<{ add_to_group: boolean }>(
      `select public.add_to_group('${g.create_group}', '${cal}') as add_to_group`,
    );
    expect(added.add_to_group).toBe(true);
  });

  it('refuses to add someone to a group they are not a member of', async () => {
    await befriend(ann, bob);
    await befriend(cal, bob);
    const [g] = await asUser({ sub: ann })<{ create_group: string }>(
      `select public.create_group('Squad', array['${bob}']::uuid[]) as create_group`,
    );
    await expect(
      asUser({ sub: cal })(`select public.add_to_group('${g.create_group}', '${bob}')`),
    ).rejects.toThrow(/not a member/);
  });
});
