import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { sql } from './helpers';

/**
 * Exercises `public.handle_confirmed_user()` — the trigger that creates a
 * profile once an `auth.users` row becomes confirmed, not when it is
 * inserted. Manipulates `auth.users` directly with the `postgres` superuser
 * connection (never a hosted service role key — see helpers.ts), which is
 * the "direct SQL against auth.users" option the brief names as an
 * alternative to driving the admin API.
 *
 * Fixture rows are cleaned up with an explicit, autocommitting `delete`
 * after each test — not a wrapping transaction — for the same reason
 * rls.test.ts avoids one: nesting raw begin/rollback text against this
 * shared connection silently commits instead of rolling back (see
 * task-3-report.md).
 */
describe('the profile-creation trigger', () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length > 0) {
      await sql(`delete from auth.users where id in (${createdIds.map((id) => `'${id}'`).join(',')})`);
      createdIds.length = 0;
    }
  });

  async function insertUnconfirmedUser(meta: {
    displayName: string;
    goUsername: string;
    birthDate: string;
  }) {
    const id = randomUUID();
    createdIds.push(id);
    await sql(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (
         '${id}',
         '${id}@example.com',
         '{"display_name":"${meta.displayName}","go_username":"${meta.goUsername}","birth_date":"${meta.birthDate}"}'::jsonb
       )`,
    );
    return id;
  }

  async function confirm(id: string) {
    await sql(`update auth.users set email_confirmed_at = now() where id = '${id}'`);
  }

  it('creates no profile for a user who has not confirmed', async () => {
    const id = await insertUnconfirmedUser({
      displayName: `Unconfirmed_${randomUUID().slice(0, 8)}`,
      goUsername: 'UnconfirmedGo',
      birthDate: '2000-01-01',
    });

    const rows = await sql(`select id from public.profiles where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('creates exactly one profile, carrying signup metadata, once the user confirms', async () => {
    const meta = {
      displayName: `Confirmed_${randomUUID().slice(0, 8)}`,
      goUsername: 'ConfirmedGo',
      birthDate: '1999-06-15',
    };
    const id = await insertUnconfirmedUser(meta);

    // Still nothing before confirmation — the squatting case.
    expect(await sql(`select id from public.profiles where id = '${id}'`)).toHaveLength(0);

    await confirm(id);

    const rows = await sql<{
      display_name: string;
      go_username: string;
      birth_date: string;
    }>(
      `select display_name, go_username, birth_date::text from public.profiles where id = '${id}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe(meta.displayName);
    expect(rows[0].go_username).toBe(meta.goUsername);
    expect(rows[0].birth_date).toBe(meta.birthDate);
  });

  it('creates a profile on insert for a user who arrives already confirmed (the Google path)', async () => {
    const id = randomUUID();
    createdIds.push(id);
    const meta = {
      displayName: `GoogleArrival_${randomUUID().slice(0, 8)}`,
      goUsername: 'GoogleGo',
      birthDate: '1995-03-20',
    };
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values (
         '${id}',
         '${id}@example.com',
         now(),
         '{"display_name":"${meta.displayName}","go_username":"${meta.goUsername}","birth_date":"${meta.birthDate}"}'::jsonb
       )`,
    );

    const rows = await sql(`select display_name from public.profiles where id = '${id}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe(meta.displayName);
  });

  it('does not raise and does not create a second row when confirmed twice', async () => {
    const meta = {
      displayName: `Twice_${randomUUID().slice(0, 8)}`,
      goUsername: 'TwiceGo',
      birthDate: '2001-11-02',
    };
    const id = await insertUnconfirmedUser(meta);

    await confirm(id);
    await expect(confirm(id)).resolves.not.toThrow();

    const rows = await sql(`select id from public.profiles where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  it('fails on the unique display_name constraint rather than silently producing no profile', async () => {
    const sharedName = `TakenName_${randomUUID().slice(0, 8)}`;
    const firstId = await insertUnconfirmedUser({
      displayName: sharedName,
      goUsername: 'FirstGo',
      birthDate: '1990-01-01',
    });
    await confirm(firstId);
    expect(await sql(`select id from public.profiles where id = '${firstId}'`)).toHaveLength(1);

    const secondId = randomUUID();
    createdIds.push(secondId);
    await sql(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (
         '${secondId}',
         '${secondId}@example.com',
         '{"display_name":"${sharedName}","go_username":"SecondGo","birth_date":"1990-02-02"}'::jsonb
       )`,
    );

    await expect(confirm(secondId)).rejects.toThrow(/duplicate key|unique constraint/i);

    const rows = await sql(`select id from public.profiles where display_name = '${sharedName}'`);
    expect(rows).toHaveLength(1);
  });
});
