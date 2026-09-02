import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('team policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const createdUsers: string[] = [];

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
    createdUsers.push(id);
  }

  beforeAll(async () => {
    await makeUser(userA, `TeamA_${userA.slice(0, 8)}`);
    await makeUser(userB, `TeamB_${userB.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.teams where owner_id in ('${userA}', '${userB}')`);
  });

  async function teamFor(owner: string): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.teams (owner_id, name, league)
       values ('${owner}', 'Test Roster', 'great') returning id`,
    );
    return row.id;
  }

  it('lets an owner insert their own team', async () => {
    const rows = await asUser({ sub: userA })<{ id: string }>(
      `insert into public.teams (owner_id, name, league)
       values ('${userA}', 'Mine', 'great') returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('defaults owner_id to the signed-in user, since the client never sends it', async () => {
    const rows = await asUser({ sub: userA })<{ owner_id: string }>(
      `insert into public.teams (name, league) values ('Defaulted', 'great') returning owner_id`,
    );
    expect(rows[0].owner_id).toBe(userA);
  });

  it('refuses a team inserted on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.teams (owner_id, name, league)
         values ('${userA}', 'Not mine', 'great')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('shows an owner their own team', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userA })(`select id from public.teams where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  /** The half usually skipped, and the half that catches a loosened policy. */
  it('hides a team from another signed-in user', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userB })(`select id from public.teams where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('hides every team from anonymous requests', async () => {
    await teamFor(userA);
    const rows = await asAnon()(`select id from public.teams`);
    expect(rows).toHaveLength(0);
  });

  it('refuses another user\'s delete', async () => {
    const id = await teamFor(userA);
    await asUser({ sub: userB })(`delete from public.teams where id = '${id}'`);
    // RLS filters the row out rather than raising, so the proof is that it survived.
    const still = await sql(`select id from public.teams where id = '${id}'`);
    expect(still).toHaveLength(1);
  });

  it('refuses another user\'s rename', async () => {
    const id = await teamFor(userA);
    await asUser({ sub: userB })(`update public.teams set name = 'stolen' where id = '${id}'`);
    const [row] = await sql<{ name: string }>(`select name from public.teams where id = '${id}'`);
    expect(row.name).toBe('Test Roster');
  });

  it('lets an owner add a member to their own team', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userA })(
      `insert into public.team_members
         (team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)
       values ('${id}', 1, 'registeel_shadow', 'LOCK_ON', '{"FOCUS_BLAST","FLASH_CANNON"}', 0, 14, 15, 41.5)
       returning slot`,
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a member added to a team that is not yours', async () => {
    const id = await teamFor(userA);
    await expect(
      asUser({ sub: userB })(
        `insert into public.team_members
           (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
         values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 15)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides members of another user\'s team', async () => {
    const id = await teamFor(userA);
    await sql(
      `insert into public.team_members
         (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
       values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 15)`,
    );
    const rows = await asUser({ sub: userB })(`select slot from public.team_members`);
    expect(rows).toHaveLength(0);
  });

  it('deletes members with their team', async () => {
    const id = await teamFor(userA);
    await sql(
      `insert into public.team_members
         (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
       values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 15)`,
    );
    await sql(`delete from public.teams where id = '${id}'`);
    const rows = await sql(`select slot from public.team_members where team_id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('rejects an out-of-range IV', async () => {
    const id = await teamFor(userA);
    await expect(
      sql(
        `insert into public.team_members
           (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
         values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 16)`,
      ),
    ).rejects.toThrow(/team_members_iv_range/);
  });

  it('rejects a third charge move', async () => {
    const id = await teamFor(userA);
    await expect(
      sql(
        `insert into public.team_members
           (team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina)
         values ('${id}', 1, 'azumarill', 'BUBBLE', '{"A","B","C"}', 0, 15, 15)`,
      ),
    ).rejects.toThrow(/team_members_charge_count/);
  });
});
