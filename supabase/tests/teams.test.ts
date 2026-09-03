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

  async function teamFor(owner: string, size: 3 | 6 = 6): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.teams (owner_id, name, league, size)
       values ('${owner}', 'Test Roster', 'great', ${size}) returning id`,
    );
    return row.id;
  }

  it('lets an owner insert their own team', async () => {
    const rows = await asUser({ sub: userA })<{ id: string }>(
      `insert into public.teams (owner_id, name, league, size)
       values ('${userA}', 'Mine', 'great', 6) returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('defaults owner_id to the signed-in user, since the client never sends it', async () => {
    const rows = await asUser({ sub: userA })<{ owner_id: string }>(
      `insert into public.teams (name, league, size) values ('Defaulted', 'great', 6) returning owner_id`,
    );
    expect(rows[0].owner_id).toBe(userA);
  });

  it('refuses a team inserted on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.teams (owner_id, name, league, size)
         values ('${userA}', 'Not mine', 'great', 6)`,
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

  /**
   * The duplicate the builder's overwrite prompt cannot prevent on its own.
   *
   * That prompt compares against the roster list already in the browser, so two
   * tabs — or one tab whose list is stale — both see "no such name" and both
   * insert. The client cannot close that window; only the database can, because
   * only the database sees both writes.
   *
   * Trimmed and lower-cased to match the client's own comparison exactly
   * (`name.trim().toLowerCase()` in TeamBuilderScreen). An index on bare `name`
   * would let "  GL Squad" through a check that had already called it taken,
   * which is worse than no index: the two rules would disagree.
   */
  it('refuses a second roster with the same name and size for one owner', async () => {
    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
    await expect(
      asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`),
    ).rejects.toThrow(/teams_owner_name_uniq/);
  });

  it('refuses one that differs only in case or surrounding space, at the same size', async () => {
    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
    await expect(
      asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('  gl squad  ', 'ultra', 3)`),
    ).rejects.toThrow(/teams_owner_name_uniq/);
  });

  /** Names are personal. Two people may both have a "GL Squad". */
  it('lets a different owner hold the same name', async () => {
    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
    const rows = await asUser({ sub: userB })<{ id: string }>(
      `insert into public.teams (name, league, size) values ('GL Squad', 'great', 3) returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * The whole point of widening the index to (owner_id, size, name): a GBL
   * "Core" and a Show 6 "Core" are two different rosters now that each
   * builder only ever sees its own size, and forbidding the shared name would
   * be a restriction the UI could never explain. Asserted alongside the
   * same-size duplicate rejection above, not instead of it — an index that
   * simply permitted everything would pass this half alone.
   */
  it('lets one owner hold the same name at two different sizes', async () => {
    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
    const rows = await asUser({ sub: userA })<{ id: string }>(
      `insert into public.teams (name, league, size) values ('GL Squad', 'great', 6) returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  /** The rename path has to keep working, or overwriting is the only way to save. */
  it('still lets an owner rename a roster to a name nobody holds', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userA })<{ name: string }>(
      `update public.teams set name = 'Renamed' where id = '${id}' returning name`,
    );
    expect(rows[0].name).toBe('Renamed');
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

  /**
   * Task 5b: size is a consequence of the screen a roster was saved from, not
   * a stored guess (ledger Ruling 13). Every insert above already supplies it
   * because the column is NOT NULL with no default — these tests are the ones
   * that pin down the column's own rules rather than relying on it as a side
   * effect of another test passing.
   */
  describe('team size', () => {
    it('rejects a team with no size at all', async () => {
      await expect(
        asUser({ sub: userA })(`insert into public.teams (name, league) values ('No Size', 'great')`),
      ).rejects.toThrow(/null value in column "size"|violates not-null constraint/);
    });

    it('rejects a size outside 3 or 6', async () => {
      await expect(
        asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('Bad Size', 'great', 4)`),
      ).rejects.toThrow(/teams_size/);
    });

    it('accepts a size of 3', async () => {
      const rows = await asUser({ sub: userA })<{ size: number }>(
        `insert into public.teams (name, league, size) values ('Three', 'great', 3) returning size`,
      );
      expect(rows[0].size).toBe(3);
    });

    it('accepts a size of 6', async () => {
      const rows = await asUser({ sub: userA })<{ size: number }>(
        `insert into public.teams (name, league, size) values ('Six', 'great', 6) returning size`,
      );
      expect(rows[0].size).toBe(6);
    });
  });
});
