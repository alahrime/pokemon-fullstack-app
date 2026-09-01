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

  /**
   * The lockout regression. A display_name collision discovered AT
   * CONFIRMATION TIME must not be able to fail the confirmation itself:
   * confirming only proves email ownership, and failing that UPDATE (which
   * is what a raised exception inside the row trigger does — it rolls back
   * the whole statement, including email_confirmed_at) would strand the
   * losing account permanently. They could never confirm (same collision
   * every retry) and could never re-register (the email is already taken in
   * auth.users). Only an administrator could clear that state.
   *
   * These three tests replace what was previously here: a test asserting
   * the OPPOSITE — that confirmation should reject on a name collision.
   * That was pinning the exact bug described above; once the trigger is
   * fixed to swallow the collision, that assertion is simply wrong and was
   * rewritten rather than kept passing by accident.
   */
  describe('a display_name collision discovered at confirmation', () => {
    async function setUpCollision() {
      const sharedName = `TakenName_${randomUUID().slice(0, 8)}`;
      const ownerId = await insertUnconfirmedUser({
        displayName: sharedName,
        goUsername: 'FirstGo',
        birthDate: '1990-01-01',
      });
      await confirm(ownerId);
      expect(await sql(`select id from public.profiles where id = '${ownerId}'`)).toHaveLength(1);

      const loserId = await insertUnconfirmedUser({
        displayName: sharedName,
        goUsername: 'SecondGo',
        birthDate: '1990-02-02',
      });

      return { sharedName, ownerId, loserId };
    }

    it('still confirms the losing account rather than stranding it', async () => {
      const { loserId } = await setUpCollision();

      await expect(confirm(loserId)).resolves.not.toThrow();

      const [row] = await sql<{ email_confirmed_at: string | null }>(
        `select email_confirmed_at from auth.users where id = '${loserId}'`,
      );
      expect(row.email_confirmed_at).not.toBeNull();
    });

    it('leaves the losing account with no profile row', async () => {
      const { loserId } = await setUpCollision();

      await confirm(loserId);

      const rows = await sql(`select id from public.profiles where id = '${loserId}'`);
      expect(rows).toHaveLength(0);
    });

    it('leaves the name owner unaffected', async () => {
      const { sharedName, ownerId, loserId } = await setUpCollision();

      await confirm(loserId);

      const rows = await sql<{ display_name: string }>(
        `select display_name from public.profiles where id = '${ownerId}'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].display_name).toBe(sharedName);
    });
  });
});
