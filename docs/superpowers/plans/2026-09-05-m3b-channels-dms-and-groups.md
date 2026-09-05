# M3b — Channels: DMs, group chats and the match channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two friends, or two people who share a live match, can open a direct message channel; a group of mutual friends can talk in one; every paired match gets a channel of its own automatically; messages expire by default, a pin or a report keeps one alive, and any member can report one.

**Architecture:** One `channels` table with a `kind` of `dm`, `group` or `match`, so the match channel M2b deferred and the DMs M3 wants are the same code rather than two implementations that drift. Membership is a separate table and is the *only* thing the message policies consult — "can I read this channel" is a membership question, and every visibility rule reduces to it. Match channels are created by a trigger on `matches` rather than by editing the two pairing functions, so a third route into a match cannot forget to make one. Ephemerality is a property of the server, not the reader: messages carry an `expires_at`, the coordinator deletes what has passed it, and a pin or an open report is what lifts a message out of that.

**Tech Stack:** Postgres 17.6 + RLS, Supabase Realtime (`postgres_changes`), Supabase Edge Functions (Deno), pg_cron, React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-paragon-platform-design.md` — section 2 (`channels`, `channel_members`, `messages`, `message_pins`, `message_reports`), "Message retention follows an ephemeral model" (the retention table, and the moderation conflict it resolves), section 3 (`blocks` enforced as `not exists` clauses in the policies on `messages`), and "Moderation is not a milestone" (a report button and a queue behind it land the moment two strangers can type at each other).

**Depends on:** the M3a plan (`friendships`, `blocks`, `blocked_between`, `pair_lo`/`pair_hi`) — Task 2 here cannot be built before M3a Task 2. It also assumes **M2b** has extended `matches.state`: `share_a_live_match` in Task 2 names `reported`, `mismatch` and `disputed`, and without M2b those values do not exist yet. The clause is still correct in that case (it matches `paired` alone), so M3b can land first — but a DM opened with an opponent would then close the moment either side reported, which is the same defect M2b Task 1 fixes on `friend_codes`.

## Global Constraints

- `npm run check` (Docker-free) and `npm run check:db` (needs the local stack) are the two gates. **`check:db` is required before merging anything touching a migration or a policy.** Both must be green at the end of every task.
- **Merging to `main` deploys every migration to the production database.** Treat each migration as an outward-facing change.
- Ownership columns default to `auth.uid()` and are never sent by the client.
- Every policy gets an allow test **and** a deny test.
- Distinguish `PRIVILEGE_DENIED` from `POLICY_DENIED`; extend the alternation in `supabase/tests/helpers.ts` for the new tables.
- **Retention is a maximum, not a target.** The spec's rule is "the shortest window that still permits investigation": 7 days unreported, through resolution then 30 days reported, indefinite while pinned. Every interval in this plan is one of those three; do not invent a fourth.
- **A blocked user must never be able to detect the block** (carried over from M3a). A DM that cannot be opened says the same thing whether the target blocked you or never existed.
- **The moderation queue has no operator yet.** `message_reports` accumulates and nothing drains it. That is acknowledged in "Known gaps", not hidden — a report button that silently discards reports would be worse than none.
- Piped exit codes lie: run `cmd > out.log 2>&1; echo "EXIT=$?"`.
- Two signed-in accounts in one browser: `http://localhost:5173` and `http://127.0.0.1:5173`. Bots are `test-opponent-{1,2}@example.test` / `Test-Opponent-{1,2}-fixture`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/*_channels_and_members.sql` (create) | `channels`, `channel_members`, membership-based policies |
| `supabase/migrations/*_channel_functions.sql` (create) | `open_dm`, `create_group`, `add_to_group`, `leave_channel` |
| `supabase/migrations/*_match_channel_trigger.sql` (create) | Every `matches` row gets a channel |
| `supabase/migrations/*_messages.sql` (create) | `messages`, expiry, block enforcement, Realtime publication |
| `supabase/migrations/*_pins_and_reports.sql` (create) | `message_pins`, `message_reports`, `sweep_messages` |
| `supabase/functions/coordinator/index.ts` (modify) | Call `sweep_messages` on each tick |
| `app/src/lib/channels.ts` (create) | Client data layer + the Realtime subscription |
| `app/src/screens/ChatScreen.tsx` (create) | Channel list and one conversation |
| `app/src/lib/screens.ts` (modify) | Register the `chat` destination |
| `supabase/tests/channels.test.ts` (create) | Policy, membership and retention tests |
| `app/tools/m3b-roundtrip.ts` (create) | Two real accounts through DM, group and match channel |

---

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
    await refusal(
      asUser({ sub: ann })(`insert into public.channels (kind, created_by) values ('group', '${ann}')`),
      PRIVILEGE_DENIED,
    );
    const id = await makeChannel('group', [ann]);
    await refusal(
      asUser({ sub: ann })(`insert into public.channel_members (channel_id, user_id) values ('${id}', '${cal}')`),
      PRIVILEGE_DENIED,
    );
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

### Task 2: Who may open what — friends, opponents, and mutual friend groups

Three rules, and they are the product decision this whole plan exists to encode:

- **A DM** may be opened with an accepted friend, **or** with someone you share a live match with. That is "message friends and opponents".
- **A group** is created with people who are already your accepted friends.
- **Adding to a group** is done by a member, and only with *their own* accepted friends. That is what makes a group a *mutual friend* group: nobody is ever in a room with a stranger somebody else dragged in without a friendship somewhere.

**Files:**
- Create: `supabase/migrations/20260905141000_channel_functions.sql`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Consumes: `public.pair_lo`, `public.pair_hi`, `public.blocked_between`, `public.friendships` from the M3a plan; `public.is_channel_member` from Task 1.
- Produces, all granted to `authenticated`:
  - `public.are_friends(a uuid, b uuid) returns boolean`
  - `public.open_dm(p_other uuid) returns uuid`
  - `public.create_group(p_title text, p_members uuid[]) returns uuid`
  - `public.add_to_group(p_channel uuid, p_user uuid) returns boolean`
  - `public.leave_channel(p_channel uuid) returns boolean`

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
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

  it('refuses a dm with a stranger, and says the same thing to a blocked user', async () => {
    await expect(openDm(ann, bob)).rejects.toThrow(/cannot be messaged/);
    await befriend(ann, bob);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${bob}')`);
    await expect(openDm(bob, ann)).rejects.toThrow(/cannot be messaged/);
    await expect(openDm(ann, randomUUID())).rejects.toThrow(/cannot be messaged/);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL with `function public.open_dm(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905141000_channel_functions.sql
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and user_lo = public.pair_lo(a, b)
       and user_hi = public.pair_hi(a, b)
  )
$fn$;

create or replace function public.share_a_live_match(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.matches m
     where m.state in ('paired', 'reported', 'mismatch', 'disputed')
       and ((m.player_a = a and m.player_b = b) or (m.player_a = b and m.player_b = a))
  )
$fn$;

-- One sentence for every reason a DM cannot be opened. A caller that can tell
-- "they blocked me" from "we are not friends" can enumerate blocks.
create or replace function public.open_dm(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  key text;
  existing uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_other is null or p_other = me
     or not exists (select 1 from public.profiles where id = p_other)
     or public.blocked_between(me, p_other)
     or not (public.are_friends(me, p_other) or public.share_a_live_match(me, p_other)) then
    raise exception 'that person cannot be messaged';
  end if;

  key := public.pair_lo(me, p_other)::text || ':' || public.pair_hi(me, p_other)::text;

  select id into existing from public.channels where dm_key = key;
  if found then return existing; end if;

  -- Two simultaneous "open the DM" clicks race here. The unique index on
  -- dm_key is what decides it; the loser reads the winner's row rather than
  -- raising, so both clicks land in the same conversation.
  begin
    insert into public.channels (kind, created_by, dm_key) values ('dm', me, key) returning id into existing;
  exception when unique_violation then
    select id into existing from public.channels where dm_key = key;
    return existing;
  end;

  insert into public.channel_members (channel_id, user_id) values (existing, me), (existing, p_other);
  return existing;
end;
$fn$;

create or replace function public.create_group(p_title text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  channel uuid;
  m uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'a group needs a name'; end if;

  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m = me then continue; end if;
    -- The rule that makes this a MUTUAL FRIEND group: you seed it with people
    -- you are actually friends with, and nobody else can be dropped in.
    if not public.are_friends(me, m) or public.blocked_between(me, m) then
      raise exception 'you can only add your own friends to a group';
    end if;
  end loop;

  insert into public.channels (kind, created_by, title) values ('group', me, btrim(p_title))
  returning id into channel;

  insert into public.channel_members (channel_id, user_id, role) values (channel, me, 'owner');
  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m = me then continue; end if;
    insert into public.channel_members (channel_id, user_id) values (channel, m)
    on conflict do nothing;
  end loop;

  return channel;
end;
$fn$;

create or replace function public.add_to_group(p_channel uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  k text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select kind into k from public.channels where id = p_channel;
  if k is null then raise exception 'no such channel'; end if;
  if k <> 'group' then raise exception 'only a group takes new members'; end if;
  if not public.is_channel_member(p_channel, me) then raise exception 'you are not a member'; end if;
  -- Checked against the ADDER's friendships, not the owner's. Every person in
  -- the room got there through somebody they are friends with.
  if not public.are_friends(me, p_user) or public.blocked_between(me, p_user) then
    raise exception 'you can only add your own friends to a group';
  end if;

  insert into public.channel_members (channel_id, user_id) values (p_channel, p_user)
  on conflict do nothing;
  return true;
end;
$fn$;

create or replace function public.leave_channel(p_channel uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  k text;
  n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  select kind into k from public.channels where id = p_channel;
  -- A match channel is part of the record of the match. Leaving a DM likewise
  -- would strand the other side talking to nobody; hide it client-side instead.
  if k in ('match', 'dm') then raise exception 'this channel cannot be left'; end if;
  delete from public.channel_members where channel_id = p_channel and user_id = me;
  get diagnostics n = row_count;
  -- The last person out closes the room rather than leaving an orphan.
  delete from public.channels c
   where c.id = p_channel
     and not exists (select 1 from public.channel_members where channel_id = c.id);
  return n > 0;
end;
$fn$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.share_a_live_match(uuid, uuid) to authenticated;
grant execute on function public.open_dm(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_to_group(uuid, uuid) to authenticated;
grant execute on function public.leave_channel(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905141000_channel_functions.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): dms with friends and opponents, mutual-friend groups

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Every match gets a channel, without either pairing function knowing

A trigger, not two edits. `matches` rows are created by `pair_queue_entries` and by `confirm_offer` today, and by whatever M2b's successor adds tomorrow. A trigger cannot be forgotten by a third writer.

**Files:**
- Create: `supabase/migrations/20260905142000_match_channel_trigger.sql`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Produces: `public.create_match_channel()` trigger function on `matches` AFTER INSERT.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  it('gives every new match a channel with exactly its two players', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Trigger Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'dd') returning id`,
    );
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${ann}', '${bob}', '${v.id}', 'dd', '[]'::jsonb, '[]'::jsonb, 'r', 's', 'queue') returning id`,
    );
    const [c] = await sql<{ id: string; kind: string }>(
      `select id, kind from public.channels where match_id = '${m.id}'`,
    );
    expect(c.kind).toBe('match');
    const members = await sql<{ user_id: string }>(
      `select user_id from public.channel_members where channel_id = '${c.id}' order by user_id`,
    );
    expect(members.map((r) => r.user_id).sort()).toEqual([ann, bob].sort());

    // And it is reachable by both players through RLS, with no friendship.
    expect(await asUser({ sub: ann })(`select * from public.channels where id = '${c.id}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select * from public.channels where id = '${c.id}'`)).toHaveLength(0);

    await sql(`delete from public.matches where id = '${m.id}'`);
    expect(await sql(`select * from public.channels where match_id = '${m.id}'`),
      'the channel goes with the match').toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — no row in `channels` for the new match.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905142000_match_channel_trigger.sql
create or replace function public.create_match_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  channel uuid;
begin
  insert into public.channels (kind, created_by, match_id)
  values ('match', new.player_a, new.id)
  returning id into channel;

  insert into public.channel_members (channel_id, user_id)
  values (channel, new.player_a), (channel, new.player_b);

  return new;
end;
$fn$;

-- AFTER INSERT, not inside the pairing functions. `matches` has two writers
-- today and will have more; a trigger is the only version of this that a third
-- one cannot forget.
create trigger matches_get_a_channel
  after insert on public.matches
  for each row execute function public.create_match_channel();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. `pairing.test.ts` and `offers.test.ts` must stay green — they create matches and now create channels as a side effect.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905142000_match_channel_trigger.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): every match gets a channel, by trigger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Messages, expiry, and the block that reaches into a DM

`expires_at` defaults to seven days out. The client shows messages as ephemeral well before that; the server holds them exactly long enough for a victim to report and a moderator to act, which is the trade the spec makes explicitly.

**Files:**
- Create: `supabase/migrations/20260905143000_messages.sql`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Produces: `public.messages (id, channel_id, author_id, body, created_at, edited_at, deleted_at, expires_at)`.
- Produces: `messages` added to the `supabase_realtime` publication.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  it('lets a member post and read, and a non-member neither', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    await asUser({ sub: ann })(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'hello')`,
    );
    expect(await asUser({ sub: bob })(`select body from public.messages where channel_id = '${dm.open_dm}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select body from public.messages where channel_id = '${dm.open_dm}'`)).toHaveLength(0);
    await refusal(
      asUser({ sub: cal })(`insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'intruding')`),
      POLICY_DENIED,
    );
  });

  it('stops a blocked person posting into a dm they already share', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${bob}')`);
    await refusal(
      asUser({ sub: bob })(`insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'still here')`),
      POLICY_DENIED,
    );
    // And ann can still post; a block is one-directional.
    await asUser({ sub: ann })(`insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'fine')`);
  });

  it('gives a new message a seven-day life', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    const [msg] = await asUser({ sub: ann })<{ expires_at: string }>(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'tick')
       returning expires_at`,
    );
    const days = (new Date(msg.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('lets an author edit and soft-delete their own message only', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    const [msg] = await asUser({ sub: ann })<{ id: string }>(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'typo') returning id`,
    );
    await asUser({ sub: bob })(`update public.messages set body = 'hijacked' where id = '${msg.id}'`);
    const [after] = await sql<{ body: string }>(`select body from public.messages where id = '${msg.id}'`);
    expect(after.body, 'filtered out by USING, 0 rows, no error').toBe('typo');

    await asUser({ sub: ann })(`update public.messages set body = 'fixed', edited_at = now() where id = '${msg.id}'`);
    const [edited] = await sql<{ body: string }>(`select body from public.messages where id = '${msg.id}'`);
    expect(edited.body).toBe('fixed');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.messages" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905143000_messages.sql
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Soft delete: the row survives its author removing it, because a message
  -- deleted the instant it is read is a message no moderator ever sees. The
  -- reader's view is where a deletion is honoured; retention is the server's.
  deleted_at timestamptz,
  -- Seven days. The spec's rule is "the shortest window that still permits
  -- investigation" — long enough for a victim to report, short enough that the
  -- store is not an archive.
  expires_at timestamptz not null default now() + interval '7 days',
  constraint messages_body_not_empty check (btrim(body) <> ''),
  constraint messages_body_length check (length(body) <= 4000)
);

create index messages_channel_idx on public.messages (channel_id, created_at desc);
create index messages_expiry_idx on public.messages (expires_at);

alter table public.messages enable row level security;

create policy "a message is visible to the channel's members"
  on public.messages for select
  to authenticated
  using (public.is_channel_member(channel_id, (select auth.uid())));

-- The block enforcement the spec asks for, as a `not exists` clause in the
-- policy of the table it constrains. It cannot live in `blocks`, because the
-- blocked side has no read on that table by design.
create policy "a member who is not blocked may post"
  on public.messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id, (select auth.uid()))
    and not exists (
      select 1
        from public.channel_members other
       where other.channel_id = messages.channel_id
         and other.user_id <> (select auth.uid())
         and public.blocked_between(other.user_id, (select auth.uid()))
    )
  );

create policy "an author may edit or soft-delete their own message"
  on public.messages for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- No DELETE policy anywhere. Hard deletion is retention's job, and it runs as
-- the table owner. A user "deleting" a message sets deleted_at.
revoke delete on public.messages from authenticated;

-- Realtime. Without this the client's postgres_changes subscription silently
-- receives nothing — no error, no warning, an empty chat that looks like a
-- network problem.
alter publication supabase_realtime add table public.messages;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905143000_messages.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): messages, ephemeral by default, blocks enforced in policy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Pins, reports, and the sweep that makes ephemerality real

Three retention rules, exactly as the spec's table states them. A pin holds a message while it is pinned; a report holds it through resolution and thirty days after; everything else goes at seven days.

**Files:**
- Create: `supabase/migrations/20260905144000_pins_and_reports.sql`
- Modify: `supabase/functions/coordinator/index.ts`
- Modify: `docs/superpowers/HANDOFF.md`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Produces: `public.message_pins (message_id, pinned_by, pinned_at)`, `public.message_reports (id, message_id, reporter_id, reason, state, created_at, resolved_at)`.
- Produces: `public.report_message(p_message uuid, p_reason text) returns uuid`, granted to `authenticated`.
- Produces: `public.sweep_messages() returns integer`, granted to `service_role`.
- Produces: the coordinator's JSON body gains a `messages` key.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  async function aMessage(): Promise<{ dm: string; id: string }> {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    const [msg] = await asUser({ sub: ann })<{ id: string }>(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'said') returning id`,
    );
    return { dm: dm.open_dm, id: msg.id };
  }

  it('deletes an expired message and keeps an unexpired one', async () => {
    const { id } = await aMessage();
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`)).toHaveLength(1);
    await sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`)).toHaveLength(0);
  });

  it('keeps a pinned message past its expiry', async () => {
    const { id } = await aMessage();
    await asUser({ sub: bob })(`insert into public.message_pins (message_id) values ('${id}')`);
    await sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`)).toHaveLength(1);
  });

  it('holds a reported message through resolution, then thirty days', async () => {
    const { id } = await aMessage();
    await asUser({ sub: bob })(`select public.report_message('${id}', 'abusive')`);
    await sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`),
      'an open report holds it indefinitely').toHaveLength(1);

    await sql(`update public.message_reports set state = 'resolved', resolved_at = now() - interval '31 days' where message_id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`),
      'thirty days after resolution it goes').toHaveLength(0);
  });

  it('shows a report to its reporter and to no other member', async () => {
    const { id } = await aMessage();
    await asUser({ sub: bob })(`select public.report_message('${id}', 'abusive')`);
    expect(await asUser({ sub: bob })(`select * from public.message_reports`)).toHaveLength(1);
    expect(await asUser({ sub: ann })(`select * from public.message_reports`),
      'the author must not learn they were reported').toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.message_pins" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905144000_pins_and_reports.sql
create table public.message_pins (
  message_id uuid primary key references public.messages (id) on delete cascade,
  pinned_by uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  pinned_at timestamptz not null default now()
);

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  reason text not null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_id),
  constraint message_reports_state check (state in ('open', 'resolved')),
  constraint message_reports_reason check (btrim(reason) <> '' and length(reason) <= 500)
);

create index message_reports_open_idx on public.message_reports (state, created_at) where state = 'open';

alter table public.message_pins enable row level security;
alter table public.message_reports enable row level security;

create policy "a pin is visible to the channel's members"
  on public.message_pins for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id, (select auth.uid()))
    )
  );

create policy "a member may pin and unpin in their own channel"
  on public.message_pins for all
  to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id, (select auth.uid()))
    )
  )
  with check (
    pinned_by = (select auth.uid())
    and exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id, (select auth.uid()))
    )
  );

-- Your own reports and nobody else's. The author of a reported message must not
-- be able to learn they were reported — that is what turns reporting into a
-- risk for the person doing it.
create policy "a report belongs to the person who filed it"
  on public.message_reports for select
  to authenticated
  using (reporter_id = (select auth.uid()));

revoke insert, update, delete on public.message_reports from authenticated;

create or replace function public.report_message(p_message uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  chan uuid;
  report uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select channel_id into chan from public.messages where id = p_message;
  if chan is null then raise exception 'no such message'; end if;
  if not public.is_channel_member(chan, me) then raise exception 'no such message'; end if;

  insert into public.message_reports (message_id, reporter_id, reason)
  values (p_message, me, p_reason)
  on conflict (message_id, reporter_id) do update set reason = excluded.reason
  returning id into report;

  return report;
end;
$fn$;

-- The three retention rules, in one statement so they cannot disagree.
create or replace function public.sweep_messages()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  removed integer;
begin
  delete from public.messages m
   where m.expires_at <= now()
     -- Pinned: held while pinned. User-controlled and deliberate.
     and not exists (select 1 from public.message_pins p where p.message_id = m.id)
     -- Reported: held through resolution, then thirty days.
     and not exists (
       select 1 from public.message_reports r
        where r.message_id = m.id
          and (r.state = 'open' or r.resolved_at > now() - interval '30 days')
     );
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

grant execute on function public.report_message(uuid, text) to authenticated;
grant execute on function public.sweep_messages() to service_role;
```

- [ ] **Step 4: Call it from the coordinator**

Beside the existing RPC calls in `supabase/functions/coordinator/index.ts`:

```ts
  const { data: sweptMessages } = await admin.rpc('sweep_messages');
```

and add `messages: sweptMessages ?? 0` to the returned JSON body. Update the two places in `docs/superpowers/HANDOFF.md` that name the expected body so an operator proving the tick is alive is not comparing against a stale shape.

- [ ] **Step 5: Run both gates to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "DB=$?"; npm run check > /tmp/app.log 2>&1; echo "APP=$?"`
Expected: `DB=0`, `APP=0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905144000_pins_and_reports.sql supabase/functions/coordinator/index.ts supabase/tests/channels.test.ts docs/superpowers/HANDOFF.md
git commit -m "feat(chat): pins, reports, and a sweep that makes expiry real

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The client data layer, and a subscription that cleans up after itself

The Realtime subscription is where this codebase has been bitten before. `useFormats.ts` shipped a migration guarded by a `live` flag that React StrictMode's mount-unmount-mount defeated, and the fix was a module-scoped in-flight promise because *the thing that breaks is precisely the remount React state does not survive*. A channel subscription has the same shape: subscribe on mount, and a remount leaves two subscriptions delivering every message twice.

**Files:**
- Create: `app/src/lib/channels.ts`
- Test: `app/src/lib/__tests__/channels.test.ts`

**Interfaces:**
- Consumes: `open_dm`, `create_group`, `add_to_group`, `report_message` from Tasks 2 and 5.
- Produces:
  - `type ChannelKind = 'dm' | 'group' | 'match'`
  - `interface Channel { id: string; kind: ChannelKind; title: string | null; matchId: string | null; lastReadAt: string | null }`
  - `interface Message { id: string; channelId: string; authorId: string; body: string; createdAt: string; editedAt: string | null; deletedAt: string | null }`
  - `listChannels(): Promise<Channel[]>`
  - `listMessages(channelId: string, limit?: number): Promise<Message[]>`
  - `sendMessage(channelId: string, body: string): Promise<Message>`
  - `openDm(otherId: string): Promise<string>`
  - `createGroup(title: string, memberIds: string[]): Promise<string>`
  - `addToGroup(channelId: string, userId: string): Promise<boolean>`
  - `reportMessage(messageId: string, reason: string): Promise<string>`
  - `markRead(channelId: string): Promise<void>`
  - `subscribeToChannel(channelId: string, onMessage: (m: Message) => void): () => void`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/channels.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const removeChannel = vi.fn();
const subscribe = vi.fn().mockReturnValue({});
const on = vi.fn().mockReturnThis();
const channel = vi.fn(() => ({ on, subscribe }));

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } }, error: null }) },
    channel,
    removeChannel,
  },
}));

const { subscribeToChannel } = await import('../channels');

beforeEach(() => {
  channel.mockClear();
  removeChannel.mockClear();
  subscribe.mockClear();
});

describe('subscribeToChannel', () => {
  it('opens one subscription and tears it down exactly once', () => {
    const stop = subscribeToChannel('c1', () => {});
    expect(channel).toHaveBeenCalledTimes(1);
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    // A double unsubscribe is what a StrictMode remount produces. It must not
    // remove a subscription some LATER mount has since opened.
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it('opens a separate subscription per mount', () => {
    const a = subscribeToChannel('c1', () => {});
    const b = subscribeToChannel('c1', () => {});
    expect(channel).toHaveBeenCalledTimes(2);
    a();
    b();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/__tests__/channels.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../channels"`.

- [ ] **Step 3: Write the module**

```ts
// app/src/lib/channels.ts
import { supabase } from './supabase';

export type ChannelKind = 'dm' | 'group' | 'match';

export interface Channel {
  id: string;
  kind: ChannelKind;
  title: string | null;
  matchId: string | null;
  lastReadAt: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    channelId: r.channel_id,
    authorId: r.author_id,
    body: r.body,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
  };
}

export async function listChannels(): Promise<Channel[]> {
  const { data, error } = await supabase
    .from('channels')
    .select('id, kind, title, match_id, channel_members(last_read_at)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string; kind: ChannelKind; title: string | null; match_id: string | null;
      channel_members: { last_read_at: string | null }[];
    };
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      matchId: r.match_id,
      // The join is filtered by RLS to the rows this viewer may see, which for
      // channel_members is every member of a channel they belong to. Their own
      // row is the one with a read position that means anything to them.
      lastReadAt: r.channel_members[0]?.last_read_at ?? null,
    };
  });
}

export async function listMessages(channelId: string, limit = 100): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMessage(r as unknown as MessageRow)).reverse();
}

export async function sendMessage(channelId: string, body: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId, body })
    .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
    .single();
  if (error) throw new Error(error.message);
  return toMessage(data as unknown as MessageRow);
}

export async function openDm(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_dm', { p_other: otherId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', {
    p_title: title,
    p_members: memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function addToGroup(channelId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('add_to_group', {
    p_channel: channelId,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function reportMessage(messageId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('report_message', {
    p_message: messageId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function markRead(channelId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return;
  const { error } = await supabase
    .from('channel_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('user_id', me);
  if (error) throw new Error(error.message);
}

/**
 * Returns its own teardown, and the teardown is IDEMPOTENT.
 *
 * StrictMode mounts an effect, tears it down and mounts it again. A teardown
 * that removes "the subscription for channel X" rather than the specific
 * subscription it opened will, on the second call, remove the one the second
 * mount just created — leaving a live component wired to nothing. `useFormats`
 * shipped exactly this bug in a different costume; see the M1b notes in
 * docs/superpowers/HANDOFF.md.
 */
export function subscribeToChannel(
  channelId: string,
  onMessage: (m: Message) => void,
): () => void {
  const sub = supabase
    .channel(`messages:${channelId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload: { new: MessageRow }) => onMessage(toMessage(payload.new)),
    )
    .subscribe();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    supabase.removeChannel(sub);
  };
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/channels.ts app/src/lib/__tests__/channels.test.ts
git commit -m "feat(chat): the client data layer, with a teardown that survives a remount

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The chat screen

**Files:**
- Create: `app/src/screens/ChatScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Modify: `app/src/screens/MatchScreen.tsx`
- Test: `app/src/screens/__tests__/chat-screen.test.tsx`

**Interfaces:**
- Consumes: everything exported by `app/src/lib/channels.ts` (Task 6).
- Produces: a `chat` screen id in `screens.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/screens/__tests__/chat-screen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/render';
import { ChatScreen } from '../ChatScreen';

const sendMessage = vi.fn();
const unsubscribe = vi.fn();
vi.mock('../../lib/channels', () => ({
  listChannels: async () => [
    { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null },
    { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null },
  ],
  listMessages: async () => [
    { id: 'm1', channelId: 'c1', authorId: 'them', body: 'hey', createdAt: 't', editedAt: null, deletedAt: null },
  ],
  sendMessage: (...a: unknown[]) => sendMessage(...a),
  subscribeToChannel: () => unsubscribe,
  markRead: async () => {},
  reportMessage: vi.fn(),
}));

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue({
    id: 'm2', channelId: 'c1', authorId: 'me', body: 'hi', createdAt: 't', editedAt: null, deletedAt: null,
  });
  unsubscribe.mockReset();
});

describe('chat screen', () => {
  it('lists channels and opens one', async () => {
    render(<ChatScreen />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /squad/i }));
    expect(await screen.findByText('hey')).toBeInTheDocument();
  });

  it('will not send an empty message', async () => {
    render(<ChatScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /squad/i }));
    expect(await screen.findByRole('button', { name: /send/i })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c2', 'hi'));
  });

  it('unsubscribes when the open channel changes', async () => {
    render(<ChatScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /squad/i }));
    await user.click(screen.getByRole('button', { name: /direct message/i }));
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/screens/__tests__/chat-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../ChatScreen"`.

- [ ] **Step 3: Write the screen**

Two panes. A list from `listChannels()`, each row a button labelled by `title` for a group, `Direct message` for a `dm`, and `Match chat` for a `match`. Selecting one calls `listMessages`, then `subscribeToChannel` inside a `useEffect` whose cleanup calls the returned teardown — the effect keys on the channel id, so switching channels tears the old one down. Append incoming messages, ignoring one whose `id` is already present, because `sendMessage` returns the row *and* the subscription delivers it.

Below the transcript, a labelled textarea and a Send button disabled while the trimmed body is empty or a send is in flight. Each message gets a Report control that prompts for a reason and calls `reportMessage`, showing `Reported` afterwards; a message with `deletedAt` renders as `Message deleted` rather than its body.

Register `chat` in `app/src/lib/screens.ts`, titled `Chat`, blurb `Direct messages, group chats, and the channel for each of your matches.` In `MatchScreen.tsx`, add a control that navigates to the `chat` destination for that match's channel, so the match and its conversation are one click apart.

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/ChatScreen.tsx app/src/lib/screens.ts app/src/screens/MatchScreen.tsx app/src/screens/__tests__/chat-screen.test.tsx
git commit -m "feat(chat): a screen for dms, groups and match channels

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Two accounts, three kinds of channel, against real Postgres

**Files:**
- Create: `app/tools/m3b-roundtrip.ts`

**Interfaces:**
- Consumes: `app/src/lib/channels.ts` (Task 6) — the shipping module.

- [ ] **Step 1: Write the script**

Same shape and localhost-only guard as `app/tools/opponents.ts`. Sign in as both bots and assert, printing a line per check:

1. Not yet friends: `openDm` raises `that person cannot be messaged`.
2. Befriend them through `request_friendship` / `respond_to_friendship`; `openDm` now returns a channel id, and calling it from the *other* bot returns **the same id**.
3. Bot 1 sends a message; **bot 2 receives it on a live `subscribeToChannel` within 5 seconds.** This is the check no unit test can make — the Realtime publication is a piece of server configuration, and the failure mode when it is missing is an empty chat and no error anywhere.
4. Create a match between the two bots with the service role; a `match` channel appears with both as members, and both can `listMessages` on it.
5. Bot 2 reports bot 1's message; bot 1's `message_reports` read returns **zero rows**.
6. Force that message's `expires_at` into the past, call `sweep_messages`, and the message **survives** — the open report holds it.
7. A third throwaway account is created, is a friend of neither, and `listChannels()` for it returns none of the above.
8. Bot 1 blocks bot 2; bot 2 sending into the shared DM is refused, and bot 1 sending still succeeds.

- [ ] **Step 2: Run it and verify every check passes**

```bash
cd app && ./node_modules/.bin/esbuild tools/m3b-roundtrip.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/m3b.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY='<from npm run db:start>' node node_modules/.cache/m3b.mjs > /tmp/rt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, all eight checks passing. **Check 3 is the one this script exists for.**

- [ ] **Step 3: Commit**

```bash
git add app/tools/m3b-roundtrip.ts
git commit -m "test(tools): dm, group and match channel, two real accounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Both gates green; `pairing.test.ts` and `offers.test.ts` still green after the match-channel trigger started firing on every match they create.
- `m3b-roundtrip.ts` passes all eight checks, check 3 included.
- Driven by hand through two browser origins as two accounts: open a DM, watch a message arrive without a reload, create a group, report a message.
- `docs/superpowers/HANDOFF.md` records the coordinator's response shape.

## Deliberately not in M3b

- **Tournament channels.** `channels.kind` has room for them; M5 fills it.
- **Attachments and images.** They bring re-encoding, EXIF stripping and serving from the object store's own origin — three rules the spec states and none of which are cheap. Text only here.
- **Typing indicators and presence.** Realtime supports both; neither is load-bearing.
- **Direct challenges.** An offer aimed at a friend. It belongs with matchmaking, now that it has somewhere to be delivered.

## Known gaps this plan accepts

- **The moderation queue has no operator.** `message_reports` fills up and nothing drains it; `state` never leaves `'open'` without someone writing SQL by hand. That is the honest state of it, and it is why retention holds a reported message indefinitely rather than for a fixed window — an unresolved report must not expire the evidence. A minimal moderator view is the next thing this subsystem needs.
- **`is_channel_member` is `security definer` and is called from three policies.** That is what stops the `channel_members` policy recursing into itself, and it means the check runs with RLS bypassed — correct here, and worth a second look before any new policy starts calling it.
- **`listChannels` reads `channel_members(last_read_at)` and takes element 0.** In a group this returns some member's row rather than reliably the viewer's. It is right for DMs and match channels, and unread counts in groups will need the query filtered by `user_id` before they can be trusted.
- **The spec puts a `channel` column on `matches`; this puts `match_id` on `channels`.** Same relationship, opposite direction, chosen so that `matches` needs no migration when a channel is added and so the unique index that guarantees one channel per match lives beside the channel. If anything later wants to read a match's channel in the same query as the match, that is a join rather than a column.
- **No rate limit on `messages`.** The body length is capped at 4,000 characters and nothing caps the rate. A public signup with DMs needs one before it meets strangers.
- **Message edits keep no history.** `edited_at` records that an edit happened, not what it replaced, so a reported message can be edited after the report. Holding the reported *version* rather than the row is the fix, and it is not built here.
