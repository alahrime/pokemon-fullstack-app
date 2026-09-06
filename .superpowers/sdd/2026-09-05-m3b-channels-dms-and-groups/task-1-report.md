# Task 1 report: channels, and membership as the only visibility rule

## Status
Complete. Committed on `main`, not pushed.

Commit SHA: `246311631bf0da884c84b45a95dbc20b4a170670`

## What changed

1. **`supabase/tests/channels.test.ts`** (new) — the brief's five tests, copied verbatim,
   with one fix: the brief's own snippet declares `const denied_privilege_denied` twice
   in the same test body (`lets nobody create a channel or add a member directly`), which
   is a TypeScript compile error (duplicate `const` in one scope). Renamed the second
   declaration to `denied_privilege_denied_2`. No behavior change — same two assertions,
   same matcher.

2. **`supabase/tests/helpers.ts`** (modified) — extended `PRIVILEGE_DENIED` to include
   `channels|channel_members|messages`, exactly as the brief's Step 4 specifies (I did not
   need `messages` for this task's own tests but included it since the brief explicitly asks
   for it here so a later task's migration doesn't require touching this shared regex again).

3. **`supabase/migrations/20260907000000_channels_and_members.sql`** (new) — named per your
   correction, not the brief's `20260905140000` (which sorts before migrations already
   deployed to production; the newest deployed one is `20260906002000`).

   Content follows the brief's Step 3 migration with **one deliberate deviation**, per your
   ruling: `is_channel_member` takes **one argument**, not two.

   ```sql
   create or replace function public.is_channel_member(p_channel uuid)
   returns boolean
   language sql
   stable
   security definer
   set search_path = public
   as $fn$
     select exists (
       select 1 from public.channel_members
        where channel_id = p_channel and user_id = auth.uid()
     )
   $fn$;

   revoke all on function public.is_channel_member(uuid) from public, anon;
   grant execute on function public.is_channel_member(uuid) to authenticated;
   ```

   Policies read `using (public.is_channel_member(id))` and
   `using (public.is_channel_member(channel_id))` — no `(select auth.uid())` argument to
   pass, since the function derives it internally.

   The comment above the function states both why it exists (membership-recursion
   avoidance — the `channels` policy needs to ask `channel_members`, and the
   `channel_members` policy needs to ask itself; a self-referential policy recurses, a
   `security definer` function bypassing RLS does not) and why it is one argument and not
   two (a two-argument version lets any signed-in caller probe an arbitrary stranger's
   membership in any channel it can name, since the function bypasses RLS and is
   necessarily granted to `authenticated` for the seven RLS policies across this milestone
   to be able to call it — a policy expression runs as the querying role, so `security
   definer` doesn't help the caller reach the function on its own). It also says
   explicitly that a later task needing to ask about another user must add a **separate**
   definer-only two-argument variant with a stated reason, not widen this one.

   Everything else — table shapes, constraints, indexes, the two remaining policies
   (visible-to-members `select` on both tables, "you may move your own read position" on
   `channel_members`), and the revokes locking creation/membership-management behind
   functions a later task will add — matches the brief's Step 3 verbatim.

## TDD sequence, exact commands and output

### Baseline (before any change)
```
cd /Users/alilahrime/Downloads/paragon-iv/app && npm run check:db > /tmp/db_baseline.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail:
```
 Test Files  10 passed (10)
      Tests  180 passed (180)
```

### Step 2: run to see it fail (after adding the test file + helpers.ts change, before the migration existed)
```
cd /Users/alilahrime/Downloads/paragon-iv/app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=1
```
Relevant output:
```
 ❯ ../supabase/tests/channels.test.ts:60:45
PostgresError: relation "public.channels" does not exist
 FAIL  ../supabase/tests/channels.test.ts > channels and membership > shows a channel to its members and to nobody else
 FAIL  ../supabase/tests/channels.test.ts > channels and membership > shows the member list only to members
 FAIL  ../supabase/tests/channels.test.ts > channels and membership > lets nobody create a channel or add a member directly
 FAIL  ../supabase/tests/channels.test.ts > channels and membership > lets a member mark their own read position and nobody else s
 FAIL  ../supabase/tests/channels.test.ts > channels and membership > allows one dm channel per pair and no more
 Test Files  1 failed | 10 passed (11)
      Tests  5 failed | 180 passed (185)
```
This matches the brief's expected failure exactly (`relation "public.channels" does not exist`).

### Step 3+5: migration written, db reset, re-run
```
cd /Users/alilahrime/Downloads/paragon-iv/app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET_EXIT=$?"
RESET_EXIT=0
```
(Applied cleanly through `20260907000000_channels_and_members.sql`, last in sequence, no errors.)

```
cd /Users/alilahrime/Downloads/paragon-iv/app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail:
```
 Test Files  11 passed (11)
      Tests  185 passed (185)
```

### Global gate: `npm run check`
```
cd /Users/alilahrime/Downloads/paragon-iv/app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail:
```
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```
Matches the required 1233/1233.

## Test counts before/after
- `check:db`: 180/180 → 185/185 (5 new tests, all passing, 0 failures)
- `check` (full app suite incl. db): 1233/1233, unchanged pass rate (this task added 5 db
  tests which are part of the 1233 total already reported — no drop from baseline)

## ACL verification (the grant trap)

```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='is_channel_member';"
```
Output:
```
is_channel_member|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```
No bare `=X/postgres` entry (that would mean PUBLIC still holds it) and no `anon` entry.
For comparison, I pulled the ACL of the precedent function this repo already trusts
(`submit_report`, referenced in the brief's grant-trap precedent note) in the same query
batch and it has the identical shape:
```
submit_report|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```
So `is_channel_member` is granted exactly as intended: owner (`postgres`), `authenticated`
(the seven RLS policies across the milestone need this), and `service_role` (standard
default privilege in this schema, not something this migration added) — PUBLIC and `anon`
are both explicitly revoked.

## Deviation from the brief

Only the one you already ruled on: `is_channel_member(p_channel uuid, p_user uuid)` →
`is_channel_member(p_channel uuid)`, deriving the user from `auth.uid()` internally, per
your correction in the task instructions. Implemented exactly as you specified, including
the revoke-from-public/anon lines and the comment explaining both the recursion-avoidance
reason for the function's existence and the one-argument-not-two reason for its shape.
Migration filename is `20260907000000_channels_and_members.sql` per your naming
instruction, not the brief's `20260905140000`.

The test file needed one syntactic fix (duplicate `const` name) to compile at all — noted
above — with no change to what it asserts.

## Things I'm unsure about / flagging for later tasks

- The brief's own comment for the two-argument function said "SECURITY DEFINER on
  purpose... which is both the fix and, not incidentally, the thing that keeps this off
  the per-row policy path the spec warns about." I kept that reasoning in the migration
  comment (it's still true under one argument) and added the additional one-argument
  rationale as a second paragraph, so the comment stays accurate about both why the
  function exists at all and why its signature is what it is.
- I did not touch `service_role`'s automatic grant — it's a default privilege already
  present on every function in this schema (confirmed against `submit_report`), not
  something introduced by this migration, so revoking it would be an unrelated, unasked-for
  change.
- Per instructions I did not push. The commit sits on `main` locally, one commit ahead of
  what was at the start of this task.
