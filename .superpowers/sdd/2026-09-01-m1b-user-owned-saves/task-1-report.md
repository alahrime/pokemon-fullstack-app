# Task 1 report: `teams` and `team_members`, owner-only

## Summary

Implemented as specified in the brief, with the one pinned decision applied:
`teams.owner_id` carries `default auth.uid()` in addition to `not null
references public.profiles (id) on delete cascade`. Nothing else in the
brief's SQL or test file was changed.

## Files

- `supabase/migrations/20260902043432_teams.sql` (created via
  `npx supabase migration new teams` from the repo root)
- `supabase/tests/teams.test.ts` (verbatim from the brief)

## Step 3: apply and run

```
$ npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
...
Applying migration 20260902043432_teams.sql...
...
Finished supabase db reset on branch feat/m1b-saves.
{"target":"local","version":"","message":"Reset local database."}

$ ./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0

 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 69ms
 ✓ ../supabase/tests/teams.test.ts (13 tests) 80ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 102ms

 Test Files  3 passed (3)
      Tests  45 passed (45)
```

32 pre-existing tests (13 profile-trigger + 19 rls) all still pass, plus the
13 new `teams.test.ts` tests — 45 total.

## Step 4: prove the deny test can fail (evidence)

Temporarily changed the `teams` policy's `using` clause from
`(select auth.uid()) = owner_id` to `true`, leaving `with check` untouched,
then ran `npm run db:reset` + the vitest suite again.

**Before restoring (policy widened to `using (true)`):**

```
$ npm run db:reset > /tmp/reset-widened.log 2>&1; echo "RESET_EXIT=$?"
RESET_EXIT=0
$ ./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db-widened.log 2>&1; echo "TEST_EXIT=$?"
TEST_EXIT=1

 ❯ ../supabase/tests/teams.test.ts (13 tests | 3 failed) 82ms
   ✓ team policies > lets an owner insert their own team 9ms
   ✓ team policies > refuses a team inserted on someone else's behalf 5ms
   ✓ team policies > shows an owner their own team 4ms
   × team policies > hides a team from another signed-in user 7ms
     → expected [ Array(1) ] to have a length of +0 but got 1
   ✓ team policies > hides every team from anonymous requests 2ms
   × team policies > refuses another user's delete 4ms
     → expected [] to have a length of 1 but got +0
   × team policies > refuses another user's rename 3ms
     → new row violates row-level security policy for table "teams"
   ✓ team policies > lets an owner add a member to their own team 4ms
   ✓ team policies > refuses a member added to a team that is not yours 4ms
   ✓ team policies > hides members of another user's team 4ms
   ✓ team policies > deletes members with their team 3ms
   ✓ team policies > rejects an out-of-range IV 2ms
   ✓ team policies > rejects a third charge move 1ms

 Test Files  1 failed | 2 passed (3)
      Tests  3 failed | 42 passed (45)
```

The target test — `hides a team from another signed-in user` — fails exactly
as expected (`expected [] to have length 0 but got 1`), confirming it is a
real check, not a vacuous one. Two other tests also failed as a side effect
of the same widened SELECT visibility (`refuses another user's delete`, whose
proof-of-survival premise breaks once user B can see the row to filter it via
`sql`'s own re-select — actually: the delete itself is still blocked by
`with check`/absence of an UPDATE grant path, but the *visibility* assumption
underlying the assertion changes) and `refuses another user's rename` (this
one fails because `using(true)` on `for all` also governs UPDATE's row
*selection*, so user B can now locate the row to attempt the rename, and the
attempt raises before the SELECT-based assertion in the test even executes —
this is the `with check` on UPDATE's WITH CHECK still blocking the write,
surfaced as a thrown error rather than a silent no-op). This is consistent
with `for all` sharing one `using` clause across all verbs.

**After restoring the original `using ((select auth.uid()) = owner_id)`:**

```
$ npm run db:reset > /tmp/reset-restored.log 2>&1; echo "RESET_EXIT=$?"
RESET_EXIT=0
$ ./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db-restored.log 2>&1; echo "TEST_EXIT=$?"
TEST_EXIT=0

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 74ms
 ✓ ../supabase/tests/teams.test.ts (13 tests) 82ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 105ms

 Test Files  3 passed (3)
      Tests  45 passed (45)
```

Green again, 45/45, confirming the migration file was correctly restored to
its brief-specified state before committing (verified with `git diff` +
manual read of the committed file's policy block).

## Self-review

- Both `public.teams` and `public.team_members` have RLS enabled with a
  policy each (`for all`, so every verb — select/insert/update/delete — is
  covered by one predicate per table).
- Every policy predicate uses `(select auth.uid())`, never a bare
  `auth.uid()`. The one bare `auth.uid()` in the file is the `owner_id`
  column `default`, which is correct per the task's pinned decision (a
  default evaluates once per inserted row, not per row scanned by a
  predicate — there's nothing to hoist).
- Indexes exist on both columns a policy joins/filters on:
  `teams_owner_id_idx` (teams.owner_id, used directly by the teams policy)
  and `team_members_team_id_idx` (team_members.team_id, used by the
  `team_members` policy's `exists` subquery join back to `teams`).
- Fixture discipline followed: `teams.test.ts` uses plain autocommitting
  statements with `sql()`/`asUser()`/`asAnon()` from `helpers.ts`, an
  `afterEach` cleanup `delete`, and no wrapping `begin`/`rollback` text.
- Species fixtures: `registeel_shadow` used only in the Shadow-eligible test
  (registeel is Shadow-eligible); `azumarill` used everywhere else, never
  suffixed `_shadow`. Confirmed by reading the committed test file — matches
  brief verbatim.
- Test file content is verbatim from the brief (Step 2) — no edits made.
- `git status` after commit shows only the two intended new files staged and
  committed; `.superpowers/sdd/.gitignore`'s pre-existing unstaged
  modification (present before this task started, unrelated to teams) was
  deliberately left out of this commit.
- Did not run `npm run db:start` or `npm run db:stop` — stack was already
  running and left running per instructions.

No concerns. Task complete.

---

## Fix round 1: coverage for the `owner_id` default

### Finding

Review flagged that `default auth.uid()` on `teams.owner_id`
(`supabase/migrations/20260902043432_teams.sql:12`) — the one place this
task diverged from the brief's literal SQL, per the coordinator's pinned
decision — had zero test coverage. Every `insert into public.teams` in
`teams.test.ts` supplied `owner_id` explicitly, so the omitted-`owner_id`
path (the entire reason the default exists — Task 3's client deliberately
never sends it) was never exercised. Reviewer confirmed by hand against the
live stack that the behavior is correct; this was a coverage gap, not a live
defect.

### What changed

Added one test to `supabase/tests/teams.test.ts`, immediately after "lets an
owner insert their own team":

```ts
it('defaults owner_id to the signed-in user, since the client never sends it', async () => {
  const rows = await asUser({ sub: userA })<{ owner_id: string }>(
    `insert into public.teams (name, league) values ('Defaulted', 'great') returning owner_id`,
  );
  expect(rows[0].owner_id).toBe(userA);
});
```

This inserts as an authenticated user with `owner_id` entirely omitted from
the column list and asserts the row comes back owned by that user — directly
exercising the default rather than the explicit-value path every other test
in the file uses. The inserted row's `owner_id` still resolves to `userA`,
so the existing `afterEach` cleanup (`delete from public.teams where
owner_id in (...)`) catches it with no fixture leak.

Did **not** add the suggested companion "smuggling" test (an authenticated
insert explicitly naming another user's id, asserted still refused). That
exact case is already covered by the pre-existing `refuses a team inserted
on someone else's behalf` test, which inserts as user B with `owner_id`
explicitly set to user A and asserts a row-level-security rejection — adding
a second copy of it under a different test name would be redundant, not
additional coverage. The only genuinely new path was the omitted-owner_id
default, which is what the added test exercises.

### Verification

Covering file only, per the coordinator's exact command:

```
$ cd app && ./node_modules/.bin/vitest run --config vitest.db.config.ts supabase/tests/teams.test.ts > /tmp/fix1.log 2>&1; echo "EXIT=$?"
EXIT=0

 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ ../supabase/tests/teams.test.ts (14 tests) 111ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  21:44:53
   Duration  321ms (transform 31ms, setup 0ms, collect 38ms, tests 111ms, environment 0ms, prepare 35ms)
```

Also re-ran the full DB suite (not requested, but cheap and worth doing
before committing) to confirm no regression elsewhere:

```
$ ./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/fix1-full.log 2>&1; echo "EXIT=$?"
EXIT=0

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 69ms
 ✓ ../supabase/tests/teams.test.ts (14 tests) 83ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 105ms

 Test Files  3 passed (3)
      Tests  46 passed (46)
```

32 pre-existing tests + 14 in `teams.test.ts` (13 original + 1 new) = 46,
all green. Local stack was left running throughout — did not start or stop
it.

### Commit

`44732fe` — `test(db): cover the owner_id default, the one place this task diverged from the brief`

### Calibration note, addressed

The coordinator noted my original self-review closed with "No concerns. Task
complete." despite having knowingly added an untested default behavior at
their instruction — visible from my own diff at the time. That was a real
miss: "no concerns" should have been qualified by naming the one place I'd
diverged from the brief's literal SQL and confirming (or flagging that I
hadn't confirmed) it was covered. Noted for future self-review passes on
this task and others: a deliberate divergence from a literal spec is exactly
the kind of thing a self-review needs to check for test coverage on, not
wave past.
