# Task 2 report: `formats` and `format_versions`

## Summary

Created `supabase/migrations/20260902044726_formats.sql` and
`supabase/tests/formats.test.ts`, matching the brief verbatim except for the
sanctioned `owner_id default auth.uid()` addition and the accompanying test
for it. Verified via `diff` against the brief's SQL and test blocks that no
other text drifted.

## Files

- `supabase/migrations/20260902044726_formats.sql` (new)
- `supabase/tests/formats.test.ts` (new)

## What was built

- `public.format_visibility` enum (`private` | `unlisted` | `public`).
- `public.formats` — owner-only for all verbs via one `for all` policy, plus a
  second, SELECT-only policy widening to any signed-in user when
  `visibility = 'public'`. `owner_id` carries `default auth.uid()` (plain, not
  `(select ...)`) per the pre-taken decision, so Task 3's client can omit it.
- `public.format_versions` — a `for all` policy that follows ownership on the
  parent `formats` row via `exists(...)`, plus a SELECT-only policy that
  follows the parent's `visibility = 'public'`. A `before update` trigger
  (`format_versions_immutable` / `freeze_format_version()`) unconditionally
  raises, so no role — not even the `postgres` superuser, which bypasses RLS
  but not triggers — can rewrite a version.
- Indexes: `formats_owner_id_idx`, `format_versions_format_id_idx` (both
  columns the policies join/filter on).

## Test run (final, both widenings restored)

```
cd app && npm run db:reset            → EXIT=0
./node_modules/.bin/vitest run --config vitest.db.config.ts   → EXIT=0

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests)
 ✓ ../supabase/tests/teams.test.ts (14 tests)
 ✓ ../supabase/tests/formats.test.ts (14 tests)
 ✓ ../supabase/tests/rls.test.ts (19 tests)

 Test Files  4 passed (4)
      Tests  60 passed (60)
```

46 pre-existing tests + 14 new `formats.test.ts` tests (13 from the brief + 1
added for the `owner_id` default) = 60, all green.

## Step 3: widen-and-confirm-failure (both parent and child)

### Parent: `"a public format is readable by anyone signed in"` → `using (true)`

Reset + ran `formats.test.ts` alone. 2 of 14 failed, exactly the ones this
widening should break:

```
❯ ../supabase/tests/formats.test.ts (14 tests | 2 failed)
   × hides a private format from another user
     → expected [ Array(1) ] to have a length of +0 but got 1
   × hides an unlisted format from another user, since sharing does not exist yet
     → expected [ Array(1) ] to have a length of +0 but got 1
 Test Files  1 failed (1)
      Tests  2 failed | 12 passed (14)
```

(The unlisted-deny test also breaks here because `using (true)` on the
formats SELECT policy admits every row regardless of visibility — expected,
since both tests read through the same widened policy.)

Restored to `using (visibility = 'public')`.

### Child: `"format versions follow their format"` → `using (true)` (with-check left untouched)

Reset + ran `formats.test.ts` alone. 1 of 14 failed:

```
❯ ../supabase/tests/formats.test.ts (14 tests | 1 failed)
   × hides versions of a private format from another user
     → expected [ { version: 1 } ] to have a length of +0 but got 1
 Test Files  1 failed (1)
      Tests  1 failed | 13 passed (14)
```

This is the case Task 1 didn't exercise on its child table — proof that the
`exists(...)` subquery in the `format_versions` policy is actually load-bearing
and not just decorative alongside the parent's.

Restored to the original `exists(...)` predicate. Confirmed via `diff` against
the brief's SQL block that the migration file, post-restore, is byte-identical
to the brief except for the one sanctioned `owner_id default` line. Re-ran
`npm run db:reset` + the full suite: 60/60 green (shown above).

## Self-review

- RLS enabled on both new tables, each with at least one policy — no
  RLS-on-with-no-policy trap, no RLS-off gap.
- Every policy predicate uses `(select auth.uid())`, never a bare call, except
  the `owner_id` column default, which is intentionally the plain form (a
  DEFAULT evaluates once per inserted row; there's nothing for the planner to
  hoist, and the brief/decision memo calls this out explicitly).
- Every column a policy joins or filters through is indexed:
  `formats.owner_id`, `format_versions.format_id`. `formats.id` and
  `formats.visibility` are reached through `formats`'s own primary key and a
  small table scan respectively — same shape as `teams`/`team_members`, not a
  new pattern.
- Immutability trigger tested against both a signed-in owner (`asUser`) and
  the `postgres` superuser directly (`sql()`) — the superuser case is the one
  that actually proves anything, since RLS alone would not have stopped it.
- Unlisted visibility explicitly asserted as NOT readable by another user
  (not just "untested" / assumed-same-as-private) — this is the behavior the
  task brief calls out as easy to get backwards.
- Widen-and-confirm-failure done for BOTH tables (not just the parent, which
  is what Task 1 did): the child widening isolates the `exists(...)` subquery
  as the actual guard, since it's the more intricate policy of the two and
  the one a parent-only widen would say nothing about.
- Verified by `diff` (not by eye) that the final migration and test files
  match the brief's SQL/TS blocks verbatim outside the two sanctioned
  changes (`owner_id default` and its test) — ruling out silent drift
  introduced by the widen/restore edits.
- Checked exit codes directly (`EXIT=$?` immediately after each command, no
  pipes into `tail`) throughout, per the constraint that piped exit codes
  have produced false "success" readings before.
- Considered whether `format_versions` should also refuse DELETE for true
  immutability — the trigger only fires on UPDATE. This matches the brief
  exactly (which only specifies a `before update` trigger and doesn't test
  DELETE), and the `for all` child policy still permits an owner to delete
  their own version rows. Not a defect against this task's stated scope, but
  worth flagging as a gap if a later task assumes versions can never
  disappear once written — right now "immutable" means "can't be rewritten,"
  not "can't be deleted."

---

## Fix round 1: `format_versions` DELETE gap (finding accepted, fixed)

### The finding

The original migration gave `format_versions` a single `for all` policy
tying every verb to ownership, plus a `before update` trigger to block
rewrites. That left DELETE granted: an owner could `delete from
public.format_versions ...` and RLS would let it through, since the `for
all` policy's `using`/`with check` said nothing about which verb was being
run. The UPDATE trigger never fires on a DELETE, so nothing stopped a
published version from disappearing. Flagged in the original report as
"worth noting, not a defect" — the coordinator correctly called that
understated: the spec says "immutable once published," and M2 decides
matches against a specific version, so a version that can vanish is exactly
the failure immutability exists to prevent.

### The fix

New migration `supabase/migrations/20260902045636_format_versions_undeletable.sql`
(existing migrations are append-only, so this is additive, not an edit to
the committed one):

- Dropped the child `for all` policy `"format versions follow their format"`.
- Replaced it with two narrower policies, same `exists(...)` ownership
  subquery and `(select auth.uid())` form as before:
  - `"an owner can read their format's versions"` — SELECT only.
  - `"an owner can append a version to their format"` — INSERT only.
- Left UPDATE and DELETE ungranted for everyone, owner included. The
  `format_versions_immutable` trigger still exists and still fires for the
  one path that bypasses RLS (the `postgres` superuser), but for a
  signed-in client RLS is now the first line of defense against a rewrite,
  not just the trigger.
- Left `"versions of a public format are readable by anyone signed in"`
  untouched, as directed.

**Why not a `before delete` trigger:** `format_versions.format_id`
references `formats(id) on delete cascade`. A `before delete` trigger on
`format_versions` fires on every row deletion regardless of cause,
including the cascade from deleting the parent `formats` row — so it would
make every format permanently undeletable, trading a small gap (a version
can be deleted directly) for a bigger one (a format can never be deleted at
all). Narrowing the policy instead leaves the cascade alone: a cascade
delete runs as the table owner and bypasses RLS entirely, so it was never
going through the `format_versions` policy layer in the first place — only
a direct client DELETE was. This reasoning is captured as a comment at the
top of the new migration so it isn't quietly "fixed" back to a trigger
later.

### A consequence this surfaced: the pre-existing immutability test's mechanism changed

Narrowing the policy to grant no UPDATE at all means a signed-in owner's
`update ... where format_id = ...` is now denied by RLS itself — silently
filtered to zero affected rows, exactly like the new DELETE test, rather
than reaching the trigger and raising `/immutable/`. That broke the
already-committed test `'refuses to rewrite a version, even for its
owner'`, which asserted `.rejects.toThrow(/immutable/)`. The trigger only
still raises for the path that actually reaches it: the `postgres`
superuser test (`'refuses to rewrite a version even as the table owner'`),
which bypasses RLS and therefore still hits the `before update` trigger —
that test was untouched and still passes.

I updated the owner-side test to match the new (stronger) enforcement path:
assert the row survived unchanged, via a superuser `sql()` read, the same
proof-by-survival shape used for the new DELETE test — rather than
asserting an exception was thrown. This is a behavioral strengthening, not
a weakening: RLS denying the write outright is a harder guarantee than
"the trigger caught it after the fact."

### New tests (in `supabase/tests/formats.test.ts`, `describe('undeletable', ...)`)

1. `"refuses an owner's direct delete of a version"` — deletes as `asUser`,
   then asserts via superuser `sql()` that the row survived (RLS filters a
   denied DELETE to zero rows rather than raising, so asserting on a thrown
   error would be testing for the wrong failure mode).
2. `"lets an owner append a version to their own format through RLS"` — the
   now-mandatory coverage gap: every other fixture in this file inserts
   versions via the superuser `sql()` helper (RLS bypassed), so nothing
   proved the new INSERT policy actually works for a real owner until this
   test. Inserts as `asUser` and asserts the insert returns a row.
3. `"removes a format's versions when its owner deletes the format, via the
   parent's cascade"` — deletes the format as `asUser`, then confirms via
   superuser `sql()` that no `format_versions` rows remain, proving the
   cascade survived the DELETE-policy narrowing.

### Commands and output

```
cd app && npm run db:reset > /tmp/reset2.log 2>&1; echo "EXIT=$?"
```
```
EXIT=0
...
Applying migration 20260902045636_format_versions_undeletable.sql...
WARN: no files matched pattern: supabase/seed.sql
Restarting containers...
Finished supabase db reset on branch feat/m1b-saves.
{"target":"local","version":"","message":"Reset local database."}
```

```
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/fix2.log 2>&1; echo "EXIT=$?"
```
```
EXIT=0

 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 65ms
 ✓ ../supabase/tests/teams.test.ts (14 tests) 80ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 100ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 111ms

 Test Files  4 passed (4)
      Tests  63 passed (63)
   Start at  21:58:58
   Duration  385ms (transform 91ms, setup 0ms, collect 221ms, tests 357ms, environment 1ms, prepare 214ms)
```

46 baseline (profile-trigger + teams + rls) + 17 in `formats.test.ts` (14
original + 3 new `undeletable` tests) = 63, all green. Both exit codes
captured directly (`echo "EXIT=$?"` immediately after each command, no
pipe), per the standing instruction that piped exit codes have produced
false "success" readings before.

### Commit

`c8af5ae` — `fix(db): close the format_versions delete gap RLS left open`

---

## Fix round 2: restore UPDATE so it reaches the trigger, not RLS's silent filter

### The finding

Round 1 dropped both DELETE and UPDATE from the owner's grants on
`format_versions`, on the reasoning "the trigger already refuses UPDATE, so
it doesn't need a grant." That reasoning didn't hold: with no UPDATE policy
at all, RLS filters an owner's UPDATE to zero affected rows *before* the
row ever reaches `format_versions_immutable`. The trigger only fires on
rows a policy actually lets an UPDATE touch — with none, it's dead code on
every client path, reachable only by the superuser. A loud, diagnosable
`immutable` exception became a silent no-op: a client that only checks
whether the call threw would believe it had edited an immutable row when
nothing happened at all. The coordinator attributed this to their own
ruling ("grant SELECT and INSERT but not DELETE" said nothing about
UPDATE), not to my reading of it.

### The fix

New migration
`supabase/migrations/20260902050313_format_versions_update_reaches_the_trigger.sql`:

- Added `"an owner's update reaches the immutability trigger"` — an UPDATE
  policy on `format_versions`, same `exists(...)` ownership subquery and
  `(select auth.uid())` form as the SELECT/INSERT policies from round 1,
  both `using` and `with check`.
- Left DELETE ungranted, and left SELECT, INSERT, and the public-read
  policy exactly as they were.

This produces the intended layering, stated directly in the migration's
comment: **RLS decides whose rows you may touch; the trigger decides what
may change.** An owner's UPDATE now passes RLS, reaches the trigger, and is
refused loudly with a message naming the reason (`a format version is
immutable; append a new version instead`). DELETE is still refused by RLS
alone, with no policy to grant it. The parent's cascade is untouched by any
of this — it runs as the table owner and bypasses RLS entirely, so it was
never subject to either the round 1 or round 2 grants.

### Test change

Restored `'refuses to rewrite a version, even for its owner'`
(`supabase/tests/formats.test.ts`) to its original brief-specified
assertion — `asUser(...).rejects.toThrow(/immutable/)` — since with the
UPDATE grant back, that assertion is true again and is the stronger of the
two available checks: it proves the *caller finds out*, not merely that the
row didn't change. Kept a survival check (`sql()` read confirming
`rules_hash` is still `'hash-1'`) alongside it as a second, independent
proof that the row itself never changed, per the coordinator's "keep a
survival check alongside it if you think it earns its place." The
superuser test (`'refuses to rewrite a version even as the table owner'`)
was left untouched — it bypasses RLS and always reached the trigger
directly, so nothing about it needed to change. All three round-1 tests
(`describe('undeletable', ...)`) were left as they are.

**On the earlier framing:** the round-1 report called the RLS-silent-filter
outcome "actually (stronger)" than the trigger's loud exception. That was
resolving a trade in my own favor rather than naming it as a trade — a
silent zero-row UPDATE and a loud named exception are different failure
modes with different diagnosability, not a strictly-better/strictly-worse
pair, and the coordinator's ruling correctly went the other way once framed
plainly.

### Commands and output

```
cd app && npm run db:reset > /tmp/reset3.log 2>&1; echo "EXIT=$?"
```
```
EXIT=0
...
Applying migration 20260902045636_format_versions_undeletable.sql...
Applying migration 20260902050313_format_versions_update_reaches_the_trigger.sql...
WARN: no files matched pattern: supabase/seed.sql
Restarting containers...
Finished supabase db reset on branch feat/m1b-saves.
{"target":"local","version":"","message":"Reset local database."}
```

```
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/fix3.log 2>&1; echo "EXIT=$?"
```
```
EXIT=0

 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 71ms
 ✓ ../supabase/tests/teams.test.ts (14 tests) 83ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 103ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 107ms

 Test Files  4 passed (4)
      Tests  63 passed (63)
   Start at  22:04:08
   Duration  359ms (transform 105ms, setup 0ms, collect 227ms, tests 364ms, environment 0ms, prepare 214ms)
```

Still 63/63 green — the same 17 `formats.test.ts` tests as round 1, no
count change, only the one assertion's shape restored. Both exit codes
captured directly, no pipe.

### Commit

`413a961` — `fix(db): let an owner's UPDATE reach the immutability trigger`
