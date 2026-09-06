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
});
