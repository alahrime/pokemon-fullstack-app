import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, refusal, PRIVILEGE_DENIED } from './helpers';

describe('friendships and blocks', () => {
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

  const lo = (a: string, b: string) => (a < b ? a : b);
  const hi = (a: string, b: string) => (a < b ? b : a);

  beforeAll(async () => {
    await makeUser(ann, `SA_${ann.slice(0, 8)}`);
    await makeUser(bob, `SB_${bob.slice(0, 8)}`);
    await makeUser(cal, `SC_${cal.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.friendships where user_lo in ('${ann}','${bob}','${cal}') or user_hi in ('${ann}','${bob}','${cal}')`);
    await sql(`delete from public.blocks where blocker_id in ('${ann}','${bob}','${cal}')`);
  });

  it('refuses a friendship row that is not canonically ordered', async () => {
    await expect(
      sql(`insert into public.friendships (user_lo, user_hi, requested_by)
           values ('${hi(ann, bob)}', '${lo(ann, bob)}', '${ann}')`),
    ).rejects.toThrow(/friendships_ordered/);
  });

  it('holds exactly one row for a pair however the request went', async () => {
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by)
               values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`);
    await expect(
      sql(`insert into public.friendships (user_lo, user_hi, requested_by)
           values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${bob}')`),
    ).rejects.toThrow(/duplicate key/);
  });

  it('shows a friendship to its two sides and to nobody else', async () => {
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by)
               values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`);
    expect(await asUser({ sub: ann })(`select * from public.friendships`)).toHaveLength(1);
    expect(await asUser({ sub: bob })(`select * from public.friendships`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select * from public.friendships`)).toHaveLength(0);
  });

  it('lets nobody write a friendship row directly', async () => {
    const denied = await refusal(() =>
      asUser({ sub: ann })(
        `insert into public.friendships (user_lo, user_hi, requested_by)
         values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`,
      ),
    );
    expect(denied.message).toMatch(PRIVILEGE_DENIED);
  });

  it('hides a block completely from the person blocked', async () => {
    await asUser({ sub: ann })(`insert into public.blocks (blocked_id) values ('${bob}')`);
    expect(await asUser({ sub: ann })(`select * from public.blocks`)).toHaveLength(1);
    // Not "sees a row that says nothing" — sees NOTHING. A blocked user who can
    // count rows can detect the block.
    expect(await asUser({ sub: bob })(`select * from public.blocks`)).toHaveLength(0);
    expect(await asUser({ sub: cal })(`select * from public.blocks`)).toHaveLength(0);
  });

  it('refuses a block against yourself', async () => {
    await expect(
      asUser({ sub: ann })(`insert into public.blocks (blocked_id) values ('${ann}')`),
    ).rejects.toThrow(/blocks_distinct/);
  });

  it('lets the blocker unblock and nobody else', async () => {
    await asUser({ sub: ann })(`insert into public.blocks (blocked_id) values ('${bob}')`);
    // Filtered out by USING — 0 rows, and NO error. Asserting "it threw" here
    // would pass for the wrong reason.
    await asUser({ sub: bob })(`delete from public.blocks where blocker_id = '${ann}'`);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(1);
    await asUser({ sub: ann })(`delete from public.blocks where blocked_id = '${bob}'`);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(0);
  });

  const request = (who: string, target: string) =>
    asUser({ sub: who })<{ request_friendship: string }>(
      `select public.request_friendship('${target}') as request_friendship`,
    );
  const respond = (who: string, other: string, accept: boolean) =>
    asUser({ sub: who })<{ respond_to_friendship: string }>(
      `select public.respond_to_friendship('${other}', ${accept}) as respond_to_friendship`,
    );

  it('turns a mutual request into an accepted friendship', async () => {
    const [first] = await request(ann, bob);
    expect(first.request_friendship).toBe('pending');
    const [second] = await request(bob, ann);
    expect(second.request_friendship).toBe('accepted');
    const [f] = await sql<{ status: string }>(`select status from public.friendships`);
    expect(f.status).toBe('accepted');
  });

  it('will not let the requester accept their own request', async () => {
    await request(ann, bob);
    await expect(respond(ann, bob, true)).rejects.toThrow(/you sent this request/);
    const [f] = await sql<{ status: string }>(`select status from public.friendships`);
    expect(f.status).toBe('pending');
  });

  it('deletes the row when a request is declined', async () => {
    await request(ann, bob);
    const [r] = await respond(bob, ann, false);
    expect(r.respond_to_friendship).toBe('removed');
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
  });

  it('refuses a request in both directions once either side blocks', async () => {
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    // Both messages are the SAME, and the same one a nonexistent user gets.
    await expect(request(bob, ann)).rejects.toThrow(/cannot be sent a friend request/);
    await expect(request(ann, bob)).rejects.toThrow(/cannot be sent a friend request/);
    await expect(request(ann, randomUUID())).rejects.toThrow(/cannot be sent a friend request/);
  });

  it('tears down an existing friendship when one side blocks', async () => {
    await request(ann, bob);
    await respond(bob, ann, true);
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(1);
  });

  it('lets either side remove an accepted friendship', async () => {
    await request(ann, bob);
    await respond(bob, ann, true);
    const [gone] = await asUser({ sub: bob })<{ remove_friendship: boolean }>(
      `select public.remove_friendship('${ann}') as remove_friendship`,
    );
    expect(gone.remove_friendship).toBe(true);
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
  });

  it('refuses a stranger acting on a friendship that is not theirs', async () => {
    await request(ann, bob);
    const [nothing] = await asUser({ sub: cal })<{ remove_friendship: boolean }>(
      `select public.remove_friendship('${ann}') as remove_friendship`,
    );
    expect(nothing.remove_friendship).toBe(false);
    expect(await sql(`select * from public.friendships`)).toHaveLength(1);
  });
});
