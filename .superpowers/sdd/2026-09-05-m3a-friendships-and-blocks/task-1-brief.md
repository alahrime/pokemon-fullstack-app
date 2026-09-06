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
    await refusal(
      asUser({ sub: ann })(
        `insert into public.friendships (user_lo, user_hi, requested_by)
         values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`,
      ),
      PRIVILEGE_DENIED,
    );
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

