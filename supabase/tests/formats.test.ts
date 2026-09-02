import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

const RULES = `'{"schema":1,"base":"great","pool":[],"composition":{"size":3,"uniqueSpecies":true},"selection":{"mode":"open"}}'::jsonb`;

describe('format policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(userA, `FmtA_${userA.slice(0, 8)}`);
    await makeUser(userB, `FmtB_${userB.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.formats where owner_id in ('${userA}', '${userB}')`);
  });

  async function formatFor(owner: string, visibility = 'private'): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility)
       values ('${owner}', 'Air Ban', '${visibility}') returning id`,
    );
    return row.id;
  }

  async function versionFor(formatId: string, version = 1): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${formatId}', ${version}, ${RULES}, 'hash-${version}') returning id`,
    );
    return row.id;
  }

  it('defaults owner_id to the signed-in user, since the client never sends it', async () => {
    const rows = await asUser({ sub: userA })<{ owner_id: string }>(
      `insert into public.formats (name, visibility) values ('Defaulted', 'private') returning owner_id`,
    );
    expect(rows[0].owner_id).toBe(userA);
  });

  it('shows an owner their private format', async () => {
    const id = await formatFor(userA);
    const rows = await asUser({ sub: userA })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  it('hides a private format from another user', async () => {
    const id = await formatFor(userA);
    const rows = await asUser({ sub: userB })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('shows a public format to another signed-in user', async () => {
    const id = await formatFor(userA, 'public');
    const rows = await asUser({ sub: userB })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  /** Readable is not writable — the widening policy is SELECT-only. */
  it('does not let another user edit a public format', async () => {
    const id = await formatFor(userA, 'public');
    await asUser({ sub: userB })(`update public.formats set name = 'stolen' where id = '${id}'`);
    const [row] = await sql<{ name: string }>(`select name from public.formats where id = '${id}'`);
    expect(row.name).toBe('Air Ban');
  });

  it('hides an unlisted format from another user, since sharing does not exist yet', async () => {
    const id = await formatFor(userA, 'unlisted');
    const rows = await asUser({ sub: userB })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('hides every format from anonymous requests', async () => {
    await formatFor(userA, 'public');
    const rows = await asAnon()(`select id from public.formats`);
    expect(rows).toHaveLength(0);
  });

  it('shows versions of a public format to another user', async () => {
    const id = await formatFor(userA, 'public');
    await versionFor(id);
    const rows = await asUser({ sub: userB })(`select version from public.format_versions where format_id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  it('hides versions of a private format from another user', async () => {
    const id = await formatFor(userA);
    await versionFor(id);
    const rows = await asUser({ sub: userB })(`select version from public.format_versions where format_id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a version appended to a format that is not yours', async () => {
    const id = await formatFor(userA, 'public');
    await expect(
      asUser({ sub: userB })(
        `insert into public.format_versions (format_id, version, rules, rules_hash)
         values ('${id}', 1, ${RULES}, 'hash-x')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  describe('immutability', () => {
    it('refuses to rewrite a version, even for its owner', async () => {
      const id = await formatFor(userA);
      await versionFor(id);
      await expect(
        asUser({ sub: userA })(
          `update public.format_versions set rules_hash = 'tampered' where format_id = '${id}'`,
        ),
      ).rejects.toThrow(/immutable/);
    });

    /** Holds against the superuser too, which is the point of a trigger. */
    it('refuses to rewrite a version even as the table owner', async () => {
      const id = await formatFor(userA);
      await versionFor(id);
      await expect(
        sql(`update public.format_versions set rules_hash = 'tampered' where format_id = '${id}'`),
      ).rejects.toThrow(/immutable/);
    });

    it('allows a second version alongside the first', async () => {
      const id = await formatFor(userA);
      await versionFor(id, 1);
      await versionFor(id, 2);
      const rows = await sql(`select version from public.format_versions where format_id = '${id}'`);
      expect(rows).toHaveLength(2);
    });

    it('refuses a duplicate version number', async () => {
      const id = await formatFor(userA);
      await versionFor(id, 1);
      await expect(versionFor(id, 1)).rejects.toThrow(/duplicate key/);
    });
  });
});
