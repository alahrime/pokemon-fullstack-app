### Task 1: Channels, and membership as the only visibility rule

Every question this subsystem answers — can I read this, can I post here, whose unread count is this — reduces to "am I a member". Keeping that one join in one place is what stops the policies multiplying.

**Files:**
- Create: `supabase/migrations/20260905140000_channels_and_members.sql`
- Modify: `supabase/tests/helpers.ts`
- Test: `supabase/tests/channels.test.ts`

**Interfaces:**
- Produces: `public.channels (id, kind, created_by, match_id, dm_key, title, created_at)`, `kind in ('dm','group','match')`.
- Produces: `public.channel_members (channel_id, user_id, role, joined_at, last_read_at)`, PK `(channel_id, user_id)`, `role in ('member','owner')`.
- Produces: `public.is_channel_member(p_channel uuid, p_user uuid) returns boolean`, `stable security definer`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/channels.test.ts
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
    const denied_privilege_denied = await refusal(() =>
        asUser({ sub: ann })(`insert into public.channel_members (channel_id, user_id) values ('${id}', '${cal}')`),
    );
    expect(denied_privilege_denied.message).toMatch(PRIVILEGE_DENIED);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.channels" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905140000_channels_and_members.sql
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  -- Set only for kind='match'. RESTRICT would strand a channel; a match that
  -- is deleted takes its channel with it.
  match_id uuid references public.matches (id) on delete cascade,
  -- Set only for kind='dm': the canonically ordered pair, as 'lo:hi'. It exists
  -- so "open the DM with this person" is an upsert rather than a search that
  -- two simultaneous clicks can both lose.
  dm_key text,
  title text,
  created_at timestamptz not null default now(),
  constraint channels_kind check (kind in ('dm', 'group', 'match')),
  constraint channels_match_id_only_for_match
    check ((kind = 'match') = (match_id is not null)),
  constraint channels_dm_key_only_for_dm
    check ((kind = 'dm') = (dm_key is not null))
);

create unique index channels_dm_key on public.channels (dm_key) where dm_key is not null;
create unique index channels_match_id on public.channels (match_id) where match_id is not null;

create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  -- Nullable and client-writable, which makes an unread count a comparison
  -- rather than a counter. Counters drift under retries; this cannot.
  last_read_at timestamptz,
  primary key (channel_id, user_id),
  constraint channel_members_role check (role in ('member', 'owner'))
);

create index channel_members_user_idx on public.channel_members (user_id);

-- SECURITY DEFINER on purpose. The policy on `channels` needs to ask about
-- `channel_members`, and the policy on `channel_members` needs to ask about
-- `channel_members` — a policy that selects its own table recurses. Asking
-- through a definer function reads the table with RLS bypassed, which is both
-- the fix and, not incidentally, the thing that keeps this off the per-row
-- policy path the spec warns about.
create or replace function public.is_channel_member(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and user_id = p_user
  )
$fn$;

grant execute on function public.is_channel_member(uuid, uuid) to authenticated;

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;

create policy "a channel is visible to its members"
  on public.channels for select
  to authenticated
  using (public.is_channel_member(id, (select auth.uid())));

create policy "the member list is visible to members"
  on public.channel_members for select
  to authenticated
  using (public.is_channel_member(channel_id, (select auth.uid())));

-- Your own read position, and only your own.
create policy "you may move your own read position"
  on public.channel_members for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Creation and membership go through the functions in the next migration, which
-- are the only place the friendship rules are checked.
revoke insert, delete on public.channels from authenticated;
revoke update on public.channels from authenticated;
revoke insert, delete on public.channel_members from authenticated;
```

- [ ] **Step 4: Extend the privilege-denied matcher**

```ts
export const PRIVILEGE_DENIED =
  /permission denied for table (match_offers|queue_entries|matches|match_reports|match_rounds|friendships|channels|channel_members|messages)/;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905140000_channels_and_members.sql supabase/tests/channels.test.ts supabase/tests/helpers.ts
git commit -m "feat(chat): channels, with membership as the only visibility rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

