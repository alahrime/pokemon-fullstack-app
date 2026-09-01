import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('every public table is protected', () => {
  it('has row level security enabled', async () => {
    const rows = await sql(
      `select tablename from pg_tables where schemaname='public' and rowsecurity = false`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});

/**
 * Two fixture identities, A and B. Both get an `auth.users` row (fixture only
 * — app code never writes there) and a matching `profiles` + `friend_codes`
 * row inserted directly as the `postgres` superuser, bypassing RLS entirely
 * so the fixture setup can't be blocked by the very policies under test.
 *
 * `email_confirmed_at` is left NULL on these fixture users so the
 * profile-creation trigger (added later in this task) never fires for them —
 * these rows are hand-built to test the policies in isolation from the
 * confirmation flow, which gets its own test file.
 *
 * Cleanup is a plain `delete from auth.users` (autocommitting, no
 * transaction wrapping `asUser`/`asAnon`'s own `client.begin()` — see
 * task-3-report.md's footgun: nesting raw begin/rollback text against the
 * harness's shared-connection transactions silently commits instead of
 * rolling back).
 */
describe('profiles and friend_codes policies', () => {
  const userA = {
    id: randomUUID(),
    email: `policy-a-${randomUUID()}@example.com`,
    displayName: `PolicyUserA_${randomUUID().slice(0, 8)}`,
    goUsername: 'TrainerA',
    code: '111122223333',
  };
  const userB = {
    id: randomUUID(),
    email: `policy-b-${randomUUID()}@example.com`,
    displayName: `PolicyUserB_${randomUUID().slice(0, 8)}`,
    goUsername: 'TrainerB',
    code: '444455556666',
  };

  const claims = (u: typeof userA) => ({ sub: u.id, role: 'authenticated' });

  beforeAll(async () => {
    for (const u of [userA, userB]) {
      await sql(
        `insert into auth.users (id, email) values ('${u.id}', '${u.email}')`,
      );
      await sql(
        `insert into public.profiles (id, display_name, go_username, tos_accepted_at, birth_date)
         values ('${u.id}', '${u.displayName}', '${u.goUsername}', now(), '2000-01-01')`,
      );
      await sql(
        `insert into public.friend_codes (profile_id, code) values ('${u.id}', '${u.code}')`,
      );
    }
  });

  afterAll(async () => {
    // Cascades to profiles and friend_codes via ON DELETE CASCADE.
    await sql(`delete from auth.users where id in ('${userA.id}', '${userB.id}')`);
  });

  it('lets a user read their own profile row', async () => {
    const rows = await asUser(claims(userA))<{ id: string; display_name: string }>(
      `select id, display_name from public.profiles where id = '${userA.id}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe(userA.displayName);
  });

  it('lets a different signed-in user read that profile too — handles are public', async () => {
    const rows = await asUser(claims(userB))<{ id: string }>(
      `select id from public.profiles where id = '${userA.id}'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('does not let a different signed-in user update that profile', async () => {
    const rows = await asUser(claims(userB))<{ id: string }>(
      `update public.profiles set go_username = 'Hijacked' where id = '${userA.id}' returning id`,
    );
    // RLS filters the row out of the update's target set entirely — 0 rows
    // affected, no error. Confirmed unchanged as ground truth via the
    // superuser connection, which bypasses RLS.
    expect(rows).toHaveLength(0);
    const [row] = await sql<{ go_username: string }>(
      `select go_username from public.profiles where id = '${userA.id}'`,
    );
    expect(row.go_username).toBe(userA.goUsername);
  });

  it('lets a user read their own friend code', async () => {
    const rows = await asUser(claims(userA))<{ code: string }>(
      `select code from public.friend_codes where profile_id = '${userA.id}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe(userA.code);
  });

  it('does not let a different signed-in user read that friend code', async () => {
    const rows = await asUser(claims(userB))<{ code: string }>(
      `select code from public.friend_codes where profile_id = '${userA.id}'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not let an anonymous request read any friend code', async () => {
    const rows = await asAnon()<{ code: string }>(`select code from public.friend_codes`);
    expect(rows).toHaveLength(0);
  });

  it('does not let a user insert a profile whose id is not their own auth.uid()', async () => {
    const impostorId = randomUUID();
    await expect(
      asUser(claims(userA))(
        `insert into public.profiles (id, display_name, go_username, tos_accepted_at, birth_date)
         values ('${impostorId}', 'ImpostorName_${impostorId.slice(0, 8)}', 'ImpostorGo', now(), '2000-01-01')`,
      ),
    ).rejects.toThrow();
  });

  it('does not let a user change their own display_name — the trigger rejects it', async () => {
    await expect(
      asUser(claims(userA))(
        `update public.profiles set display_name = 'ChangedName' where id = '${userA.id}'`,
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('lets a user change their own go_username', async () => {
    const rows = await asUser(claims(userA))<{ go_username: string }>(
      `update public.profiles set go_username = 'TrainerA_Renamed' where id = '${userA.id}' returning go_username`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].go_username).toBe('TrainerA_Renamed');
  });

  it('lets a user change their own friend code', async () => {
    const rows = await asUser(claims(userA))<{ code: string }>(
      `update public.friend_codes set code = '999988887777' where profile_id = '${userA.id}' returning code`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('999988887777');
  });

  it('lets two profiles share the same go_username', async () => {
    const userC = {
      id: randomUUID(),
      email: `policy-c-${randomUUID()}@example.com`,
      displayName: `PolicyUserC_${randomUUID().slice(0, 8)}`,
    };
    const userD = {
      id: randomUUID(),
      email: `policy-d-${randomUUID()}@example.com`,
      displayName: `PolicyUserD_${randomUUID().slice(0, 8)}`,
    };
    const sharedGoUsername = 'SharedTrainerName';

    try {
      for (const u of [userC, userD]) {
        await sql(`insert into auth.users (id, email) values ('${u.id}', '${u.email}')`);
      }

      // Each inserts their own profile — through the insert policy, not the
      // superuser connection — to also cover the "allow" direction of the
      // insert policy (own id succeeds) alongside the shared-go_username claim.
      for (const u of [userC, userD]) {
        const rows = await asUser({ sub: u.id, role: 'authenticated' })<{ id: string }>(
          `insert into public.profiles (id, display_name, go_username, tos_accepted_at, birth_date)
           values ('${u.id}', '${u.displayName}', '${sharedGoUsername}', now(), '2000-01-01')
           returning id`,
        );
        expect(rows).toHaveLength(1);
      }

      const rows = await sql<{ go_username: string }>(
        `select go_username from public.profiles where id in ('${userC.id}', '${userD.id}')`,
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.go_username === sharedGoUsername)).toBe(true);
    } finally {
      await sql(`delete from auth.users where id in ('${userC.id}', '${userD.id}')`);
    }
  });
});
