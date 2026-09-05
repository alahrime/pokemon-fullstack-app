# M3a — Friendships and blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can send, accept and withdraw a friend request; friends can see each other's friend codes without sharing a match; and a block silently removes the blocker from the blocked person's reach — in the friend list, in the queue, and at the offer board.

**Architecture:** A friendship is one row per *pair*, keyed on the canonically ordered `(user_lo, user_hi)`, not one row per direction. That single choice removes the entire class of bugs where A→B and B→A both exist with different statuses, and it makes "we both requested each other" resolve to an accept rather than to a duplicate. Blocks are the opposite shape — one-directional, and readable only by the blocker, because a blocked user who can detect the block can route around it. Enforcement therefore cannot live in `blocks`: it lives as `not exists` clauses in the policies and functions of every table a block is supposed to constrain.

**Tech Stack:** Postgres 17.6 + RLS, React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-paragon-platform-design.md` — section 2 (`friendships`: canonical ordered pair, `requested_by`, `status`; `blocks`: separate because blocks are one-directional and friendship is not), section 3 (`friend_codes` readable if yours, an accepted friendship, or a shared active match; `blocks` are enforced elsewhere, on purpose), and the M3 milestone.

## Global Constraints

- `npm run check` (Docker-free) and `npm run check:db` (needs the local stack) are the two gates. **`check:db` is required before merging anything touching a migration or a policy.** Both must be green at the end of every task.
- **Merging to `main` deploys every migration to the production database.** Treat each migration as an outward-facing change.
- Ownership columns default to `auth.uid()` and are never sent by the client.
- **`refusal()` takes a THUNK and RETURNS `{code, message}`** — it does not take a matcher. Use `const denied = await refusal(() => asUser(...)(...)); expect(denied.message).toMatch(PRIVILEGE_DENIED);`. Passing a promise plus a matcher type-checks against nothing and silently asserts less than you think; two implementers have already hit this.
- Every policy gets an allow test **and** a deny test.
- Distinguish `PRIVILEGE_DENIED` (`permission denied for table x`) from `POLICY_DENIED` (`new row violates row-level security policy`). Both are SQLSTATE 42501 and mean different things. Extend `PRIVILEGE_DENIED`'s alternation in `supabase/tests/helpers.ts` for the new tables.
- An UPDATE or DELETE filtered out by a USING clause affects 0 rows and raises **nothing**. Assert the row count, not that it threw.
- Piped exit codes lie: run `cmd > out.log 2>&1; echo "EXIT=$?"`.
- **A blocked user must never be able to detect the block.** Any error message, row count or timing difference that distinguishes "blocked" from "no such person" is a defect in this plan, not a detail. Every refusal a blocked user can observe says the same thing a non-existent target would say.
- Two signed-in accounts in one browser: `http://localhost:5173` and `http://127.0.0.1:5173` are different origins. Bots are `test-opponent-{1,2}@example.test` / `Test-Opponent-{1,2}-fixture`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/*_friendships_and_blocks.sql` (create) | Both tables, canonical ordering, policies |
| `supabase/migrations/*_friendship_functions.sql` (create) | `request_friendship`, `respond_to_friendship`, `remove_friendship` |
| `supabase/migrations/*_friend_codes_for_friends.sql` (create) | Widen `friend_codes` to accepted friends |
| `supabase/migrations/*_blocks_reach_the_queue.sql` (create) | `pair_queue_entries` and `accept_offer` refuse blocked pairs |
| `app/src/lib/social.ts` (create) | Client data layer for friends and blocks |
| `app/src/screens/FriendsScreen.tsx` (create) | Requests in, requests out, friends, blocks |
| `app/src/lib/screens.ts` (modify) | Register the `friends` destination |
| `supabase/tests/social.test.ts` (create) | Policy and function tests |
| `app/tools/m3a-roundtrip.ts` (create) | Two real accounts through request → accept → block |

---

### Task 1: One row per pair, and a block nobody can see

The canonical ordering is the design. `user_lo < user_hi` as a check constraint plus a primary key on the pair means the database itself refuses to hold two contradictory rows about one friendship — so no function has to remember to look for the reverse direction, and none of them can forget.

**Files:**
- Create: `supabase/migrations/20260905130000_friendships_and_blocks.sql`
- Modify: `supabase/tests/helpers.ts`
- Test: `supabase/tests/social.test.ts`

**Interfaces:**
- Produces: `public.friendships (user_lo, user_hi, requested_by, status, created_at, responded_at)`, PK `(user_lo, user_hi)`, `status in ('pending','accepted')`, check `user_lo < user_hi`.
- Produces: `public.blocks (blocker_id, blocked_id, created_at)`, PK `(blocker_id, blocked_id)`, check `blocker_id <> blocked_id`.
- Produces: `public.pair_lo(a uuid, b uuid) returns uuid` and `public.pair_hi(a uuid, b uuid) returns uuid`, both immutable.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/social.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

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
    const denied_privilege_denied = await refusal(() =>
        asUser({ sub: ann })(
          `insert into public.friendships (user_lo, user_hi, requested_by)
           values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`,
        ),
    );
    expect(denied_privilege_denied.message).toMatch(PRIVILEGE_DENIED);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.friendships" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905130000_friendships_and_blocks.sql

-- Canonical ordering, as two immutable functions so every caller orders a pair
-- the same way and none of them writes the comparison out by hand.
create or replace function public.pair_lo(a uuid, b uuid) returns uuid
language sql immutable as $fn$ select least(a, b) $fn$;

create or replace function public.pair_hi(a uuid, b uuid) returns uuid
language sql immutable as $fn$ select greatest(a, b) $fn$;

-- ONE row per pair. Not one per direction: two rows for one friendship is how
-- "A thinks we are friends and B has a pending request" becomes representable,
-- and it is not a state anyone should have to write code against.
create table public.friendships (
  user_lo uuid not null references public.profiles (id) on delete cascade,
  user_hi uuid not null references public.profiles (id) on delete cascade,
  -- Which of the two asked. Needed to know who may accept: the requester
  -- accepting their own request is the whole point of storing this.
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_lo, user_hi),
  constraint friendships_ordered check (user_lo < user_hi),
  constraint friendships_status check (status in ('pending', 'accepted')),
  constraint friendships_requester_is_a_party check (requested_by in (user_lo, user_hi))
);

create index friendships_hi_idx on public.friendships (user_hi);

-- One-directional, and deliberately not symmetric with friendships.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_distinct check (blocker_id <> blocked_id)
);

-- The blocked side is looked up constantly by the enforcement clauses below.
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.friendships enable row level security;
alter table public.blocks enable row level security;

create policy "a friendship is visible to its two sides"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) in (user_lo, user_hi));

-- No write policy: every change goes through the functions in the next
-- migration, which are the only place that canonicalises a pair and checks a
-- block. Revoked as well as unpoliced, so a later `for all` policy cannot
-- quietly turn default-deny into a grant.
revoke insert, update, delete on public.friendships from authenticated;

-- A block is yours alone. There is no policy for the blocked side at ALL —
-- not a narrowed one — because any row they can see, or count, is a signal.
create policy "a block belongs to the person who made it"
  on public.blocks for all
  to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));
```

- [ ] **Step 4: Extend the privilege-denied matcher**

```ts
export const PRIVILEGE_DENIED =
  /permission denied for table (match_offers|queue_entries|matches|match_reports|match_rounds|friendships)/;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905130000_friendships_and_blocks.sql supabase/tests/social.test.ts supabase/tests/helpers.ts
git commit -m "feat(social): one row per friendship, and a block nobody can see

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The three things you can do to a friendship

Requesting someone who has already requested you is an **accept**, not a duplicate — that falls out of the one-row-per-pair design, and it is the behaviour a user expects.

Every refusal a blocked user can see is worded identically to the refusal for a person who does not exist. That is not politeness; a distinguishable error is a block detector.

**Files:**
- Create: `supabase/migrations/20260905131000_friendship_functions.sql`
- Test: `supabase/tests/social.test.ts` (append)

**Interfaces:**
- Consumes: `public.pair_lo`, `public.pair_hi`, `public.friendships`, `public.blocks` from Task 1.
- Produces, all granted to `authenticated`:
  - `public.request_friendship(p_target uuid) returns text` — `'pending'` or `'accepted'`
  - `public.respond_to_friendship(p_other uuid, p_accept boolean) returns text` — `'accepted'` or `'removed'`
  - `public.remove_friendship(p_other uuid) returns boolean`
  - `public.block_user(p_target uuid) returns boolean` — blocks and tears down any friendship

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/social.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL with `function public.request_friendship(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905131000_friendship_functions.sql

-- One sentence, used for every reason a request cannot be sent: blocked in
-- either direction, no such profile, or yourself. A caller that can tell those
-- apart can enumerate who has blocked them.
create or replace function public.friend_request_refusal() returns text
language sql immutable as $fn$
  select 'that person cannot be sent a friend request'
$fn$;

create or replace function public.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  )
$fn$;

create or replace function public.request_friendship(p_target uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid;
  h uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_target is null or p_target = me
     or not exists (select 1 from public.profiles where id = p_target)
     or public.blocked_between(me, p_target) then
    raise exception '%', public.friend_request_refusal();
  end if;

  l := public.pair_lo(me, p_target);
  h := public.pair_hi(me, p_target);

  select * into existing from public.friendships where user_lo = l and user_hi = h for update;

  if found then
    if existing.status = 'accepted' then return 'accepted'; end if;
    -- They asked first and now we have asked back. That is an accept, not a
    -- duplicate, and it is the behaviour a person expects.
    if existing.requested_by <> me then
      update public.friendships set status = 'accepted', responded_at = now()
       where user_lo = l and user_hi = h;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (user_lo, user_hi, requested_by) values (l, h, me);
  return 'pending';
end;
$fn$;

create or replace function public.respond_to_friendship(p_other uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid := public.pair_lo(auth.uid(), p_other);
  h uuid := public.pair_hi(auth.uid(), p_other);
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into existing from public.friendships where user_lo = l and user_hi = h for update;
  if not found then raise exception 'there is no request to respond to'; end if;
  if existing.status = 'accepted' then return 'accepted'; end if;
  if existing.requested_by = me then raise exception 'you sent this request'; end if;

  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where user_lo = l and user_hi = h;
    return 'accepted';
  end if;

  delete from public.friendships where user_lo = l and user_hi = h;
  return 'removed';
end;
$fn$;

create or replace function public.remove_friendship(p_other uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid := public.pair_lo(auth.uid(), p_other);
  h uuid := public.pair_hi(auth.uid(), p_other);
  n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- The `me in (l, h)` guard is what stops a stranger deleting a pair they
  -- named: pair_lo/pair_hi of (me, other) always contains me, so this is only
  -- false when the caller passed a pair they are not part of.
  delete from public.friendships
   where user_lo = l and user_hi = h and me in (user_lo, user_hi);
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

create or replace function public.block_user(p_target uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_target is null or p_target = me then return false; end if;

  insert into public.blocks (blocker_id, blocked_id) values (me, p_target)
  on conflict do nothing;

  -- A block that leaves the friendship standing is not a block. This is why
  -- blocking is a function and not an insert policy.
  delete from public.friendships
   where user_lo = public.pair_lo(me, p_target)
     and user_hi = public.pair_hi(me, p_target);
  return true;
end;
$fn$;

grant execute on function public.request_friendship(uuid) to authenticated;
grant execute on function public.respond_to_friendship(uuid, boolean) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.blocked_between(uuid, uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905131000_friendship_functions.sql supabase/tests/social.test.ts
git commit -m "feat(social): request, accept, remove, block

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A friend can see your friend code; a blocked stranger cannot reach you

Two widenings, in one migration because they are one idea: an accepted friendship is the second route to a friend code, and a block has to actually stop the matchmaking that M2a already ships.

The queue clause is the subtle one. `pair_queue_entries` scans for two entries with the same verified hash and league; it must skip a pair where either has blocked the other, **without** either of them learning why they are waiting longer.

**Files:**
- Create: `supabase/migrations/20260905132000_friend_codes_for_friends.sql`
- Create: `supabase/migrations/20260905133000_blocks_reach_the_queue.sql`
- Test: `supabase/tests/social.test.ts` (append)

**Interfaces:**
- Consumes: `public.blocked_between` from Task 2.
- Produces: `friend_codes` readable by accepted friends; `pair_queue_entries` and `accept_offer` refuse blocked pairs.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/social.test.ts
  it('shows a friend code to an accepted friend and to nobody else', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${bob}', '4444 5555 6666')
               on conflict (profile_id) do update set code = excluded.code`);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(0);

    await request(ann, bob);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`),
      'pending is not accepted').toHaveLength(0);

    await respond(bob, ann, true);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(0);
  });

  it('never pairs two people who have blocked each other', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Block Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`,
    );
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    for (const who of [ann, bob]) {
      await asUser({ sub: who })(
        `insert into public.queue_entries (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('great', '${v.id}', 'bb', 'bb', '[]'::jsonb, 'rev1')`,
      );
    }
    // verified_hash is set by hand here: the coordinator is not running in this suite.
    await sql(`update public.queue_entries set verified_hash = 'bb' where user_id in ('${ann}','${bob}')`);
    await sql(`select public.pair_queue_entries()`);
    expect(await sql(`select * from public.matches where player_a in ('${ann}','${bob}')`)).toHaveLength(0);
    // And both are still queued — a skipped pair is not a consumed one.
    expect(await sql(`select * from public.queue_entries where user_id in ('${ann}','${bob}')`)).toHaveLength(2);
    await sql(`delete from public.queue_entries where user_id in ('${ann}','${bob}')`);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — the friend code is not visible to a friend, and the blocked pair is matched.

- [ ] **Step 3: Write the friend-code migration**

```sql
-- supabase/migrations/20260905132000_friend_codes_for_friends.sql
-- The third route to a friend code, beside "it is yours" and "we share a live
-- match". Accepted only: a pending request must not leak the thing the request
-- is for, or sending one becomes the way to read it.
create policy "an accepted friend may read your friend code"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and f.user_lo = public.pair_lo(friend_codes.profile_id, (select auth.uid()))
         and f.user_hi = public.pair_hi(friend_codes.profile_id, (select auth.uid()))
         and (select auth.uid()) <> friend_codes.profile_id
    )
  );
```

- [ ] **Step 4: Write the blocks-enforcement migration**

```sql
-- supabase/migrations/20260905133000_blocks_reach_the_queue.sql
-- `blocks` cannot enforce itself: the blocked side has no read on it by design.
-- Enforcement lives in the places a block is supposed to bite. This is the
-- scattering the spec calls for, made explicit rather than implied.

-- 1. The blind queue. The pairing scan must SKIP a blocked pair and leave both
--    entries queued for somebody else — not consume them, and not error, since
--    an error is a signal the blocked side could read.
create or replace function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  a public.queue_entries;
  b public.queue_entries;
  paired integer := 0;
begin
  for a in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by created_at
     for update skip locked
  loop
    -- `a` may have been consumed as somebody's `b` earlier in this same loop.
    if not exists (select 1 from public.queue_entries where id = a.id) then
      continue;
    end if;

    select * into b from public.queue_entries q
     where q.verified_hash = a.verified_hash
       and q.league = a.league
       and q.user_id <> a.user_id
       and q.expires_at > now()
       and q.id <> a.id
       and not public.blocked_between(a.user_id, q.user_id)
     order by q.created_at
     limit 1
     for update skip locked;

    if not found then continue; end if;

    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (a.user_id, b.user_id, a.format_version_id, a.verified_hash, a.team, b.team,
       a.data_rev, gen_random_uuid()::text, 'queue');

    delete from public.queue_entries where id in (a.id, b.id);
    paired := paired + 1;
  end loop;
  return paired;
end;
$fn$;

grant execute on function public.pair_queue_entries() to service_role;

-- 2. The offer board. Accepting is a deliberate act aimed at a named person, so
--    unlike the queue it may refuse out loud — but the sentence says the offer
--    is gone, which is also what a lapsed offer says.
create or replace function public.accept_offer_blocked_guard() returns trigger
language plpgsql as $fn$
begin
  if new.accepted_by is not null
     and public.blocked_between(new.proposer_id, new.accepted_by) then
    raise exception 'this offer is no longer available';
  end if;
  return new;
end;
$fn$;

create trigger match_offers_block_guard
  before update on public.match_offers
  for each row execute function public.accept_offer_blocked_guard();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. **The existing `pairing.test.ts` must still be green** — this task rewrites `pair_queue_entries`, and its concurrency guarantees are what that suite pins.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905132000_friend_codes_for_friends.sql supabase/migrations/20260905133000_blocks_reach_the_queue.sql supabase/tests/social.test.ts
git commit -m "feat(social): friends see codes, blocks reach the queue

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The client data layer

**Files:**
- Create: `app/src/lib/social.ts`
- Test: `app/src/lib/__tests__/social.test.ts`

**Interfaces:**
- Consumes: the four RPCs from Task 2.
- Produces:
  - `type FriendshipStatus = 'pending' | 'accepted'`
  - `interface Friend { otherId: string; status: FriendshipStatus; theyAsked: boolean; createdAt: string }`
  - `listFriends(): Promise<Friend[]>`
  - `requestFriendship(targetId: string): Promise<FriendshipStatus>`
  - `respondToFriendship(otherId: string, accept: boolean): Promise<'accepted' | 'removed'>`
  - `removeFriendship(otherId: string): Promise<boolean>`
  - `blockUser(targetId: string): Promise<boolean>`
  - `listBlocks(): Promise<string[]>`
  - `unblockUser(targetId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/social.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows: Record<string, unknown>[] = [];
const getSession = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession },
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    rpc: vi.fn().mockResolvedValue({ data: 'pending', error: null }),
  },
}));

const { listFriends } = await import('../social');

beforeEach(() => {
  rows.length = 0;
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } }, error: null });
});

describe('listFriends', () => {
  it('reports the other side of the pair from either seat', async () => {
    rows.push(
      { user_lo: 'me', user_hi: 'zed', requested_by: 'me', status: 'pending', created_at: 't' },
      { user_lo: 'abe', user_hi: 'me', requested_by: 'abe', status: 'accepted', created_at: 't' },
    );
    const friends = await listFriends();
    expect(friends).toEqual([
      { otherId: 'zed', status: 'pending', theyAsked: false, createdAt: 't' },
      { otherId: 'abe', status: 'accepted', theyAsked: true, createdAt: 't' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/__tests__/social.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../social"`.

- [ ] **Step 3: Write the module**

```ts
// app/src/lib/social.ts
import { supabase } from './supabase';

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friend {
  otherId: string;
  status: FriendshipStatus;
  /** True when the OTHER person sent the request, i.e. it is yours to accept. */
  theyAsked: boolean;
  createdAt: string;
}

async function myId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id;
}

export async function listFriends(): Promise<Friend[]> {
  const me = await myId();
  const { data, error } = await supabase
    .from('friendships')
    .select('user_lo, user_hi, requested_by, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      user_lo: string; user_hi: string; requested_by: string;
      status: FriendshipStatus; created_at: string;
    };
    return {
      otherId: r.user_lo === me ? r.user_hi : r.user_lo,
      status: r.status,
      theyAsked: r.requested_by !== me,
      createdAt: r.created_at,
    };
  });
}

export async function requestFriendship(targetId: string): Promise<FriendshipStatus> {
  const { data, error } = await supabase.rpc('request_friendship', { p_target: targetId });
  if (error) throw new Error(error.message);
  return data as FriendshipStatus;
}

export async function respondToFriendship(
  otherId: string,
  accept: boolean,
): Promise<'accepted' | 'removed'> {
  const { data, error } = await supabase.rpc('respond_to_friendship', {
    p_other: otherId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  return data as 'accepted' | 'removed';
}

export async function removeFriendship(otherId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('remove_friendship', { p_other: otherId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function blockUser(targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function listBlocks(): Promise<string[]> {
  const { data, error } = await supabase.from('blocks').select('blocked_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as unknown as { blocked_id: string }).blocked_id);
}

export async function unblockUser(targetId: string): Promise<void> {
  const { error } = await supabase.from('blocks').delete().eq('blocked_id', targetId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/social.ts app/src/lib/__tests__/social.test.ts
git commit -m "feat(social): the client data layer for friends and blocks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The Friends screen

Four sections: requests waiting on you, requests you sent, accepted friends, and people you have blocked. People are found by display name, which `profiles` already exposes.

**Files:**
- Create: `app/src/screens/FriendsScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Test: `app/src/screens/__tests__/friends-screen.test.tsx`

**Interfaces:**
- Consumes: everything exported by `app/src/lib/social.ts` (Task 4).
- Produces: a `friends` screen id registered in `screens.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/screens/__tests__/friends-screen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/render';
import { FriendsScreen } from '../FriendsScreen';

const respondToFriendship = vi.fn();
vi.mock('../../lib/social', () => ({
  listFriends: async () => [
    { otherId: 'incoming', status: 'pending', theyAsked: true, createdAt: 't' },
    { otherId: 'outgoing', status: 'pending', theyAsked: false, createdAt: 't' },
    { otherId: 'mate', status: 'accepted', theyAsked: false, createdAt: 't' },
  ],
  listBlocks: async () => ['blocked'],
  respondToFriendship: (...a: unknown[]) => respondToFriendship(...a),
  requestFriendship: vi.fn(),
  removeFriendship: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
}));

beforeEach(() => respondToFriendship.mockReset().mockResolvedValue('accepted'));

describe('friends screen', () => {
  it('offers Accept only on a request somebody sent to you', async () => {
    render(<FriendsScreen />);
    expect(await screen.findByRole('button', { name: /accept incoming/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept outgoing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting on them/i)).toBeInTheDocument();
  });

  it('accepts a request', async () => {
    render(<FriendsScreen />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /accept incoming/i }));
    await waitFor(() => expect(respondToFriendship).toHaveBeenCalledWith('incoming', true));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/screens/__tests__/friends-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../FriendsScreen"`.

- [ ] **Step 3: Write the screen**

Render four `<section>`s driven by one `listFriends()` call plus one `listBlocks()` call, partitioned in the component:

- **Requests waiting on you** — `status === 'pending' && theyAsked`. Two buttons per row, labelled `Accept {otherId}` and `Decline {otherId}`, calling `respondToFriendship(otherId, true|false)`.
- **Requests you sent** — `status === 'pending' && !theyAsked`. No Accept button; the row reads `Waiting on them`, with a `Withdraw` button calling `removeFriendship`.
- **Friends** — `status === 'accepted'`. Each row shows the friend code when `friend_codes` returns one (the Task 3 policy is what makes that read succeed) and offers `Remove` and `Block`.
- **Blocked** — from `listBlocks()`, each with `Unblock`.

Above them, a search field that looks up `profiles` by `display_name` and offers `Send friend request`, calling `requestFriendship`. Every failure renders `err.message` verbatim — the refusal sentence from Task 2 is deliberately uninformative and must not be "improved" into something that distinguishes a block from a missing account.

- [ ] **Step 4: Register the screen**

Add a `friends` entry to `app/src/lib/screens.ts` beside `matchmaking`, titled `Friends`, blurb `Send and accept friend requests, see friend codes, and block people.`

- [ ] **Step 5: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/FriendsScreen.tsx app/src/lib/screens.ts app/src/screens/__tests__/friends-screen.test.tsx
git commit -m "feat(social): a friends screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Two accounts, against real Postgres

**Files:**
- Create: `app/tools/m3a-roundtrip.ts`

**Interfaces:**
- Consumes: `app/src/lib/social.ts` (Task 4) — the shipping module.

- [ ] **Step 1: Write the script**

Same shape and the same localhost-only guard as `app/tools/opponents.ts`. Sign in as both bots and assert, printing a line per check:

1. Bot 1 requests bot 2 → `pending`; bot 2's `listFriends()` shows it with `theyAsked: true`.
2. Bot 2 cannot yet read bot 1's friend code — **zero rows through PostgREST**, not an error.
3. Bot 2 accepts → `accepted`; **now** bot 2 reads bot 1's friend code and gets `1111 2222 3333`.
4. Bot 1 blocks bot 2. Bot 1's `listFriends()` is empty; the friend code read returns zero rows again.
5. **Bot 2's `listBlocks()` is empty and `listFriends()` is empty** — the block is invisible from the blocked side. This is the check that matters.
6. Bot 2 requesting bot 1 raises exactly `that person cannot be sent a friend request`, the same sentence a random UUID produces.
7. Bot 1 unblocks; a fresh request from bot 2 returns `pending` again.

- [ ] **Step 2: Run it and verify every check passes**

```bash
cd app && ./node_modules/.bin/esbuild tools/m3a-roundtrip.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/m3a.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY='<from npm run db:start>' node node_modules/.cache/m3a.mjs > /tmp/rt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, all seven checks passing.

- [ ] **Step 3: Commit**

```bash
git add app/tools/m3a-roundtrip.ts
git commit -m "test(tools): friendship and block, driven by two real accounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Both gates green, and `pairing.test.ts` still green after `pair_queue_entries` was rewritten.
- `m3a-roundtrip.ts` passes all seven checks.
- Driven by hand through two browser origins as two accounts: request, accept, read the friend code, block, confirm the blocked side sees nothing.

## Deliberately not in M3a

- **DMs, group chats and the match channel.** They are one subsystem — see the M3b plan.
- **Direct challenges between friends.** The spec puts them in M3; they are an offer with a named recipient, and they are better built once `channels` exists so the challenge can be sent somewhere.
- **A friends-only visibility tier on formats or teams.** `formats.visibility` exists; nothing reads it yet.

## Known gaps this plan accepts

- `blocked_between` is called per candidate row inside `pair_queue_entries`'s loop. It is `stable` and `blocks_blocked_idx` covers the lookup, but at a queue of thousands this becomes the scan's inner loop and should become a single anti-join.
- The block guard on `match_offers` is a trigger on UPDATE, so it fires on every update of that table, not only on an accept. Cheap, and it cannot be bypassed by a future second write path — which is why it is a trigger rather than a line inside `accept_offer`.
- People are found by exact `display_name`. There is no search ranking, no pagination and no rate limit on the lookup; a public user-enumeration endpoint is a real consideration before this ships to strangers.
