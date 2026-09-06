# Task 4 report: messages, expiry, and the block that reaches into a DM

## Summary

Implemented `public.messages` with RLS, ephemeral retention (7-day `expires_at`),
soft delete, and realtime publication, per the brief — with three corrections
applied per the harness's rulings/notes, plus one additional defect found and
fixed during TDD (see "Deviation" below).

Migration: `supabase/migrations/20260907003000_messages.sql` (NOT the brief's
`20260905143000`, which sorts before migrations already in production).

Tests appended to `supabase/tests/channels.test.ts` (same describe block, four
new `it` blocks, verbatim from the brief except renaming the two
`denied_policy_denied` consts to `nonMemberInsert` / `blockedInsert` since they
live in the same lexical scope conventions as neighboring tests — no actual
naming collision existed in this brief's text, but I kept them descriptive and
distinct anyway).

## Corrections applied from the harness's instructions

1. **Ruling B1 — `blocked_between` grant trap.** The brief's INSERT policy
   called the two-argument `public.blocked_between(other.user_id, auth.uid())`
   directly. That function is `security definer` but NOT granted to
   `authenticated` (by design, since M3a — granting it would let any signed-in
   user probe arbitrary pairs for a block). An RLS policy expression executes
   as the querying role, so `security definer` on the *called* function does
   not help; every authenticated INSERT would raise `permission denied for
   function blocked_between(uuid,uuid)`. Fixed by adding a new, caller-scoped,
   single-argument `public.blocked_with_me(p_other uuid)` (derives the caller
   from `auth.uid()` internally, so it can only ever answer about a pair the
   caller is part of), revoked from `public`/`anon`, granted to
   `authenticated`. The policy now calls `blocked_with_me(other.user_id)`
   instead of `blocked_between(...)`.

2. **`is_channel_member` now single-argument.** The brief called
   `public.is_channel_member(channel_id, auth.uid())` (two args) in both the
   SELECT and INSERT policies. The deployed function
   (`20260907000000_channels_and_members.sql`) takes only
   `p_channel uuid` and derives the caller internally. Both call sites in the
   new migration use the one-argument form.

3. **Naming.** Migration filed as `20260907003000_messages.sql`, sorting after
   the newest existing migration `20260907002000_match_channel_trigger.sql`.

4. **Realtime publication.** Kept `alter publication supabase_realtime add
   table public.messages;` and verified it landed (see below) — the
   publication held zero tables before this migration.

5. **Grant-before-revoke order / DELETE revoke.** `revoke all ... from public,
   anon` precedes the `grant ... to authenticated` for `blocked_with_me`.
   `revoke delete on public.messages from authenticated` is present; there is
   no DELETE policy at all, so deletion is impossible for any client role —
   only soft delete via UPDATE.

## Deviation: a second, independent defect found during TDD

After fixing the grant issue exactly per Ruling B1's given SQL (a
**symmetric** caller-scoped check — "did I block them, or did they block me,
in either direction"), `npm run check:db` still failed one test:

```
FAIL channels and membership > stops a blocked person posting into a dm they already share
PostgresError: new row violates row-level security policy for table "messages"
```

The failure was on the test's *last* statement — ann (the blocker) trying to
post after having blocked bob — which the test expects to **succeed** ("And
ann can still post; a block is one-directional."). The literal ruling-B1 body

```sql
select exists (
  select 1 from public.blocks
   where (blocker_id = auth.uid() and blocked_id = p_other)
      or (blocker_id = p_other and blocked_id = auth.uid())
)
```

is symmetric — identical in effect to `blocked_between` — so once *any* block
exists between two channel members, it silences both of them, not just the
blocked party. That contradicts the test the brief itself specifies (present
in the brief's original Step 1 text, unrelated to the grant fix), so a
literal, symmetric implementation of the ruling's SQL cannot pass this suite —
independent of who calls it or with what privileges.

**Fix:** kept everything about `blocked_with_me` from Ruling B1 (name,
single-argument signature, `security definer`, revoke/grant shape, the
prohibition on widening it to two arguments or granting `blocked_between`
directly) but changed the predicate body to be **directional**: "did
`p_other` block *me*", not "does a block exist between us at all":

```sql
select exists (
  select 1 from public.blocks
   where blocker_id = p_other and blocked_id = auth.uid()
)
```

With this, bob's insert (checking "did ann block me" — true) is denied, and
ann's insert (checking "did bob block me" — false) is allowed, matching the
test and the general block model used elsewhere in the codebase where
`blocked_between`'s symmetric check is correct for *mutual-exclusion*
contexts (matchmaking, friend requests — you can't friend/match someone who
blocked you, or someone you blocked) but wrong for *messaging into an
existing shared channel*, where only the blocked party should be silenced.
I documented this reasoning directly above the function in the migration so
the next reader understands why `blocked_with_me` and `blocked_between` differ
in more than argument count.

I flag this because it deviates from the literal SQL given as "verbatim" —
I made the judgment call that "never weaken, skip, or delete a test to make a
suite pass" outranks reproducing a symmetric predicate that provably fails
that same test, and the fix stays inside the guardrails the ruling actually
cared about (single caller-scoped argument, no grant on `blocked_between`,
security definer, proper revoke/grant ordering).

## Commands run and output

### TDD: see the test fail first

```
$ cd app && npm run check:db > /tmp/db_fail.log 2>&1; echo "EXIT=$?"
EXIT=1
```
Relevant excerpt from `/tmp/db_fail.log`:
```
 ❯ ../supabase/tests/channels.test.ts (16 tests | 4 failed) 142ms
PostgresError: relation "public.messages" does not exist
...
 Test Files  1 failed | 10 passed (11)
      Tests  4 failed | 192 passed (196)
```

### Write migration, reset, first re-run (still 1 failure — the direction bug)

```
$ cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
$ npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=1
```
```
FAIL ../supabase/tests/channels.test.ts > channels and membership > stops a blocked person posting into a dm they already share
PostgresError: new row violates row-level security policy for table "messages"
 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 195 passed (196)
```

### Fix `blocked_with_me` to be directional, reset, re-run — green

```
$ cd app && npm run db:reset > /tmp/reset2.log 2>&1; echo "EXIT=$?"
EXIT=0
$ npm run check:db > /tmp/db2.log 2>&1; echo "EXIT=$?"
EXIT=0
```
```
 Test Files  11 passed (11)
      Tests  196 passed (196)
```

(192 pre-existing + 4 new = 196.)

### Full app gate

```
$ cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
EXIT=0
```
```
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```

### Required verification 1 — function privileges

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select 'blocked_with_me' fn, has_function_privilege('authenticated','public.blocked_with_me(uuid)','execute') as ok union all select 'blocked_between (must be f)', has_function_privilege('authenticated','public.blocked_between(uuid,uuid)','execute');"
blocked_with_me|t
blocked_between (must be f)|f
```

### Required verification 2 — realtime publication

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select tablename from pg_publication_tables where pubname='supabase_realtime';"
messages
```

(The publication held zero tables before this migration, confirmed at the
start of the task with the same query.)

## Files changed

- `supabase/migrations/20260907003000_messages.sql` (new)
- `supabase/tests/channels.test.ts` (appended 4 tests, verbatim from the brief)

## Things I am unsure about / worth a second look

- The directional-vs-symmetric `blocked_with_me` decision (above) is the one
  substantive judgment call in this task. I believe it is correct and
  matches the test's own stated intent ("a block is one-directional"), but
  it does deviate from the literal SQL body handed to me as "verbatim," so
  flagging clearly rather than burying it.
- I did not touch `.superpowers/sdd/.../progress.md`, `task-3-brief.md`,
  `task-5-brief.md`, `task-6-brief.md`, `task-6-report.md`, or
  `app/.env.local.bak` — all pre-existing untracked/modified files unrelated
  to this task, left as found.
- No commit has been made yet at the time of writing this report (see next
  step in the transcript); the report intentionally covers command output up
  to the pre-commit gate-green state.
