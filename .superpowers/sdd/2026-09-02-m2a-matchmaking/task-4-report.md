# Task 4 report — `match_offers`

## Migration

`supabase/migrations/20260902205215_match_offers.sql` — timestamp sorts after Task 3's `20260902204023`.

Applied with the required non-destructive command:

```
cd app && ./node_modules/.bin/supabase migration up --workdir .. > /tmp/mig.log 2>&1; echo "EXIT=$?"
```

Result: `EXIT=0`, log:
```
Connecting to local database...
Applying migration 20260902205215_match_offers.sql...
{"applied":["/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260902205215_match_offers.sql"],"message":"Migrations applied"}
```

**I did not run `supabase db reset`, `db:start`, or `db:stop` directly.** The only `db:start` invocation was the one baked into the `npm run check:db` gate script itself (`db:start && vitest run ...`), which the brief's own corrected gate command requires me to run. `supabase start` against an already-running stack is idempotent (it reports "Stopped services: [...]" for two optional containers that were never running in this project, and does not touch data) — verified before touching anything by running `supabase status --workdir ..`, which showed the stack already up and reachable. No reset, no fresh containers, no data loss.

## Correction 2 — `accepted_team`

Added `accepted_team jsonb` (nullable), placed next to `accepted_by`/`accepted_at`, with a comment explaining it captures the taker's roster at accept time (a snapshot, not a pointer into `teams`, for the same reason `team` on the offer and on `queue_entries` is a snapshot) so Task 5's `accept_offer()` has both rosters `matches.team_a`/`team_b` need.

## Test file

`supabase/tests/offers.test.ts` — based on the brief's verbatim test code, with two deliberate departures, both required by correction 4 and by an actual Postgres semantics issue I hit in step 2 (see below):

1. **"hides a public offer from someone not signed in"** — strengthened to also assert, in the same test, that the superuser connection and the proposer's own connection still see the row. An empty `asAnon()` result alone doesn't distinguish "policy enforced" from "no such row."
2. **"refuses a taker editing the offer's terms"** — the brief's version asserts `.rejects.toThrow(...)`. That assertion is not achievable for this policy shape, and I changed it (details below) after confirming the actual behavior both through the test run and through an isolated debug script.
3. `afterEach` also cleans `public.matches` and `public.friend_codes` for both fixture users, not just `match_offers`, per correction 3 — even though this task's tests don't insert into either table today, a future test added to this file (or copy-pasted from it) won't silently start leaking rows the way `queue.test.ts`'s `friend_codes` insert only gets cleaned by chance of test order.

## Step 2 — verbatim failing output (before the migration existed)

```
cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"
EXIT=1
```

```
 ❯ ../supabase/tests/offers.test.ts (6 tests | 6 failed) 74ms
   × match offer policies > shows a public offer to any signed-in stranger 8ms
     → relation "public.match_offers" does not exist
     → relation "public.match_offers" does not exist
   × match offer policies > hides a public offer from someone not signed in, though the row exists and is visible to its proposer 5ms
     → relation "public.match_offers" does not exist
     → relation "public.match_offers" does not exist
   × match offer policies > hides an unlisted offer from a stranger while its proposer still sees it 5ms
     → relation "public.match_offers" does not exist
     → relation "public.match_offers" does not exist
   × match offer policies > refuses an offer proposed on someone else's behalf 8ms
     → expected [Function] to throw error matching /row-level security/ but got 'relation "public.match_offers" does n…'
     → relation "public.match_offers" does not exist
   × match offer policies > refuses a taker editing the offer's terms 4ms
     → relation "public.match_offers" does not exist
     → relation "public.match_offers" does not exist
   × match offer policies > refuses a scheduled offer in the past 5ms
     → expected [Function] to throw error matching /match_offers_scheduled_future/ but got 'relation "public.match_offers" does n…'
     → relation "public.match_offers" does not exist
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 89ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 118ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 144ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 158ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 158ms

 Test Files  1 failed | 5 passed (6)
      Tests  6 failed | 75 passed (81)
```

Matches the brief's expectation exactly (`relation "public.match_offers" does not exist`).

## An intermediate failure the brief's test code did not anticipate

After applying the migration verbatim as given in the brief (with only the `accepted_team` addition), 5/6 tests passed but this one failed:

```
 × match offer policies > refuses a taker editing the offer's terms 15ms
   → promise resolved "[]" instead of rejecting
```

I did not immediately weaken the assertion — I verified what was actually happening with an isolated debug script (raw `postgres` client, same connection pattern as `helpers.ts`) hitting the live table directly:

```
offer 3a33ba2f-da3a-416e-9427-2a4605ac1622
update result Result(0) [] count 0
league now Result(1) [ { league: 'great' } ]
```

**Finding:** the policy is correctly enforced — the taker's `UPDATE` touches 0 rows and the row's `league` is provably unchanged. But Postgres does not raise an exception for an `UPDATE` whose target is excluded by a policy's `USING` clause; it behaves exactly like `UPDATE ... WHERE id = <nonexistent>` — 0 rows affected, no error, no thrown promise rejection. This is different from `INSERT`, where a row failing `WITH CHECK` always throws `new row violates row-level security policy` (that's why the sibling test "refuses an offer proposed on someone else's behalf", an `INSERT`, does throw as written). The brief's own migration comment ("no WITH CHECK expressible here can say 'you may set accepted_by and nothing else'") already concedes there's no update policy admitting a taker at all — this is the direct, correctly-understood consequence of that design, just not the consequence the given test assertion predicted.

I rewrote that one test to assert what's actually provable: the `UPDATE ... RETURNING id` resolves (not throws) with an empty result (0 rows matched/returned), and a superuser `select` on the same row afterward shows `league` still `'great'`. This is a "refused write" in the sense correction 4 asks for — the write had no effect — even though the mechanism is "matched nothing" rather than "raised an error." I did not touch the policy itself; the RLS behavior was already correct on the first attempt, only the test's expression of it was wrong.

## Step 4 — verbatim passing output

```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 93ms
 ✓ ../supabase/tests/offers.test.ts (6 tests) 104ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 122ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 147ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 150ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 160ms

 Test Files  6 passed (6)
      Tests  81 passed (81)
```

## Gates

```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
EXIT=0
```
(`check` tail: `Test Files  79 passed (79)` / `Tests  1081 passed (1081)`.)

## Fixture cleanup

`afterEach` in `offers.test.ts` deletes, for both `proposer` and `taker`:
- `public.matches` (as either `player_a` or `player_b`)
- `public.match_offers` (as `proposer_id`)
- `public.friend_codes` (as `profile_id`)

`beforeAll` fixtures (the two `auth.users` rows, one `formats` row, one `format_versions` row) are intentionally left in place for the run's duration and are not per-test — matching the existing pattern in `queue.test.ts` and `formats.test.ts`. Nothing outside these three tables is written by this test file. Verified after a full green run that `select count(*) from public.match_offers` is `0` — no leaked rows.

## Confirmation on the reset ban

No `supabase db reset`, `db:start` (as a standalone command), or `db:stop` was run by me directly at any point. `supabase status --workdir ..` was used to confirm the stack was already running before doing anything else. The only place `db:start` ran was inside the `npm run check:db` gate exactly as instructed, against an already-running stack (idempotent, no data loss).

## Things I'm unsure about / want a second look at

1. **The taker-update test's proof shape.** I'm confident the policy is correct (verified independently, twice, outside the test framework too) but the "refused write" here is "0 rows matched" rather than "exception thrown." Correction 4 says "only a refused write... distinguishes an enforced policy from an absent one" — I believe 0-rows-affected-with-unchanged-state satisfies that intent, but it's a different shape than every other "refuses ..." test in this file and in `queue.test.ts` (which are all `INSERT`s that do throw). Worth confirming this reasoning holds up under review.
2. **`accepted_team`'s column position and lack of its own constraint.** I did not add a check like "`accepted_team is null iff accepted_by is null`" because Task 5's `accept_offer()` (not yet written) is what will set both together, and I didn't want to guess at an invariant that function might need to violate transiently (e.g., setting `accepted_by` first). If Task 5 expects that invariant enforced at the DB level rather than only in the function, this migration doesn't provide it.
3. **No test exercises `accepted_team` itself** — there's no `accept_offer()` yet for it to matter to, so nothing in this task's test file writes or reads it. It's present only so Task 5 has somewhere to put data; its correctness will only be provable once that function exists.
4. **The `'private'` visibility branch of `format_visibility` is untested here**, same as the brief — only `'public'` and `'unlisted'` are exercised, matching what was asked for and what `formats.test.ts` did for the same enum. If a private-offer visibility test is expected, it wasn't in scope as briefed.
5. **The `accepted_by` disjunct of "a public offer is readable by anyone signed in" is untested.** That policy is `using (visibility = 'public' or (select auth.uid()) = accepted_by)` — the `accepted_by` half exists for Task 5 (so an accepted taker can see a non-public offer they've accepted) but nothing in this file ever sets `accepted_by`, so no test exercises that branch in either direction. It should be covered once Task 5's `accept_offer()` exists to populate it. (This gap was real in the original submission but I failed to list it here — flagged by review, added now for a complete record.)

## Fix round 1

Reviewer found one Important: the "refuses a taker editing the offer's terms" test had only two of the three legs an honest UPDATE-denial proof needs (taker's write affects 0 rows; row provably unchanged) and was missing the third: proof that *someone* — the proposer — can update the same row, so the test can't be fooled by a broken/typo'd proposer policy that made the whole table unwritable.

Fix: in that same test, after confirming the taker's write is a no-op, added `asUser({ sub: proposer })` performing the identical `update ... set league = 'master' where id = '${o.id}' returning id` on the same row and column, asserting it returns 1 row and that a subsequent superuser `select` shows `league` now `'master'`. No migration change — this is test-only, matching the reviewer's read of the underlying RLS behavior as already correct.

Row cleanup: the update reuses the same offer row (`o.id`) created by that test's own `offer('public')` call, which `afterEach`'s existing `delete from public.match_offers where proposer_id in (...)` already covers — no new fixture rows introduced, nothing new for `afterEach` to clean.

Command and output:

```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 81ms
 ✓ ../supabase/tests/offers.test.ts (6 tests) 98ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 111ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 133ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 143ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 148ms

 Test Files  6 passed (6)
      Tests  81 passed (81)
```

The covering test: `match offer policies > refuses a taker editing the offer's terms` (in `supabase/tests/offers.test.ts`), now three-legged.

Post-run check confirmed no leaked rows: `select count(*) from public.match_offers` → `0`.

No `db reset`/`db:start`(standalone)/`db:stop` was run; the stack was already up from the prior round and untouched except through the `check:db` gate script itself.
