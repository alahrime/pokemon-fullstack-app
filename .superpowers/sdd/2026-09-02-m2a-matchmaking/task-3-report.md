# Task 3 report: `queue_entries` and `matches`

## Migration filename

`supabase/migrations/20260902204023_queue_and_matches.sql`

(timestamp generated via `date -u +%Y%m%d%H%M%S`, sorts after `20260902163500` as required)

## Did NOT reset the database

Per correction #1, the migration was applied with:

```
cd app && ./node_modules/.bin/supabase migration up --workdir .. > /tmp/mig.log 2>&1; echo "EXIT=$?"
```

Output (`/tmp/mig.log`):

```
Connecting to local database...
Applying migration 20260902204023_queue_and_matches.sql...
{"applied":["/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260902204023_queue_and_matches.sql"],"message":"Migrations applied"}
```

`EXIT=0`. `supabase db reset` was never invoked, and `db:start`/`db:stop` were never invoked directly — the only stack-touching command run outside `migration up` was `npm run check:db`, whose `db:start` pre-step is idempotent against an already-running stack (it just reprinted the connection info; no reset occurred).

Verified afterward that real data survived (this is schema-only DDL, which cannot itself delete rows, but I checked anyway): `auth.users` still contains `alahrime@gmail.com`, and the total row counts across `auth.users`/`public.profiles` did not drop from what a live, multi-session-tested stack would accumulate. I did not have a pre-migration baseline count to diff against (the brief forbids querying via `db reset`, and I didn't think to snapshot counts before running `migration up` — in hindsight I should have; noted under Concerns below), but `migration up` only executes the DDL in the one new migration file, which contains no `delete`, `truncate`, or `drop table` statements, so no rows could have been lost by it.

## Verbatim failing-test output (before migration)

Command: `npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"` → `EXIT=1`

```
 ❯ ../supabase/tests/queue.test.ts (7 tests | 7 failed) 79ms
   × queue and match policies > lets someone join the queue without naming themselves 10ms
     → relation "public.queue_entries" does not exist
     → relation "public.matches" does not exist
   × queue and match policies > refuses a queue entry made on someone else's behalf 7ms
     → expected [Function] to throw error matching /row-level security/ but got 'relation "public.queue_entries" does …'
     → relation "public.matches" does not exist
   × queue and match policies > hides a queue entry from everyone but its owner 4ms
     → relation "public.queue_entries" does not exist
     → relation "public.matches" does not exist
   × queue and match policies > allows only one queue entry per person 4ms
     → relation "public.queue_entries" does not exist
     → relation "public.matches" does not exist
   × queue and match policies > lets a player see a match they are in, and nobody else see it 1ms
     → relation "public.matches" does not exist
     → relation "public.matches" does not exist
   × queue and match policies > refuses a match inserted by a player, even one they are in 4ms
     → expected [Function] to throw error matching /row-level security/ but got 'relation "public.matches" does not ex…'
     → relation "public.matches" does not exist
   × queue and match policies > reveals an opponent's friend code, and only to an opponent 6ms
     → relation "public.matches" does not exist
     → relation "public.matches" does not exist
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 93ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 176ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 179ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 194ms

 Test Files  1 failed | 4 passed (5)
      Tests  7 failed | 67 passed (74)
```

All 7 failures are exactly the expected shape from Step 2 of the brief: `relation "public.queue_entries" does not exist` / `relation "public.matches" does not exist`.

## Verbatim passing output (after migration)

Command: `npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"` → `EXIT=0`

```
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 79ms
 ✓ ../supabase/tests/queue.test.ts (7 tests) 95ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 121ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 129ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 133ms

 Test Files  5 passed (5)
      Tests  74 passed (74)
```

## Gate results

- `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"` → **EXIT=0** (74/74 tests, all 5 files passing)
- `cd app && npm run check > /tmp/app-check.log 2>&1; echo "EXIT=$?"` → **EXIT=0** (79 test files, 1081/1081 tests, lint/build/typecheck all clean)

## Corrections applied

1. Applied via `supabase migration up`, never `db reset`. Confirmed above.
2. No grants added for `pair_queue_entries()` or `sweep_expired()` — those functions don't exist yet (Task 5's problem). Grepped the migration file for `grant`; none present.
3. `matches.team_a` and `matches.team_b` both kept `not null` exactly as the brief specified — neither relaxed to nullable.

## Files changed

- `supabase/migrations/20260902204023_queue_and_matches.sql` (new)
- `supabase/tests/queue.test.ts` (new, verbatim from the brief)

## Concerns / things I'm unsure about

- **No pre-migration row-count baseline.** I applied `migration up` first and only checked `auth.users`/`public.profiles` counts afterward, on the reasoning that the migration file contains no destructive DML. That reasoning holds, but a strict "prove nothing was lost" standard would have wanted a before/after diff. If this matters, it's straightforward to re-verify now since no further schema changes have happened since.

- **The friend-code widening policy (`an opponent may read your friend code while you have a match`) is the trickiest one to test in both directions**, and I want to flag it explicitly even though the brief's given test does cover it correctly: the "deny" side isn't a rejected write, it's an absence in a `select` (before any match exists, `userA` selecting `userB`'s code returns 0 rows) — this is exactly the "empty result doesn't prove RLS" trap the task instructions warn about. What makes it a legitimate deny proof here, unlike a bare empty-table check, is that the same test later performs the identical `select` after inserting a match and gets 1 row back — so the emptiness beforehand is contrasted against a proven-nonempty afterward with everything else held constant (same querier, same target row, same table). The *stranger*-deny case (a third user, never paired with `userB`, selecting `userB`'s code after the match exists, to rule out the policy being accidentally too broad — e.g. "any authenticated user" rather than "the specific opponent") IS in the brief's test verbatim — the `reveals an opponent's friend code, and only to an opponent` test's final two assertions are exactly this — and I carried it through unchanged. (Correcting my own earlier claim here: I previously wrote that this stranger check "isn't in the brief's test and I didn't add it," which was wrong; it was already present and untouched. See the Fix round 1 section below.)

- **`queue_entries_one_per_user` unique index doubles as the anti-self-match guard** the migration's comment describes, but nothing in this task's tests exercises the *pairing* behavior itself (that's Task 5's `pair_queue_entries()`). The index only proves "one row per user_id" here; it doesn't yet prove no self-pairing is possible, since pairing logic doesn't exist yet. Flagging so it isn't assumed already covered.

- I did not touch `db:start`/`db:stop` directly at any point, and did not run `supabase db reset` at any point. The only commands executed against the live stack were `supabase migration up`, `npm run check:db` (whose `db:start` prestep no-ops against a running stack), `npm run check`, and read-only `select count(*)` queries via a throwaway Node script using the `postgres` package (same approach as `helpers.ts`) to verify data integrity.

## Fix round 1

**Finding addressed (Important):** the friend-code policy's `state = 'paired'` clause was never falsified by any test — nothing inserted a non-`'paired'` match and re-checked visibility, so a dropped or wrong clause (e.g. `state != 'abandoned'`) would have passed the whole suite undetected.

**Fix:** added a new test to `supabase/tests/queue.test.ts`, `stops showing a friend code once the match is abandoned`. It:
- inserts a friend code for `userB` via the superuser `sql()` connection (upsert, since an earlier test in the file already gave `userB` a friend code and `afterEach` doesn't clean `public.friend_codes`),
- inserts a `state = 'paired'` match between `userA`/`userB` via `sql()` and confirms `userA` gets the code (1 row) — ground truth proven independently of RLS since the insert bypasses it,
- updates that same match's `state` to `'abandoned'` via `sql()`,
- re-runs the identical `select` as `userA` and asserts **0 rows**,
- explicitly deletes the `friend_codes` row for `userB` at the end (not covered by `afterEach`, which only clears `matches`/`queue_entries`), so nothing leaks into the partner's local database.

Same pair, same friend-code row, same querier throughout — only `state` changes between the two assertions, which is what makes this a real discriminator for the clause rather than another instance of the empty-result trap.

**Command:** `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`

First run (fixture bug, not the policy): `EXIT=1` — the initial version of the new test did a plain `insert into public.friend_codes` for `userB`, which collided with the earlier `reveals an opponent's friend code...` test's row on the `friend_codes_pkey` (profile_id) primary key, since `afterEach` doesn't touch `friend_codes`:

```
 × queue and match policies > stops showing a friend code once the match is abandoned 2ms
   → duplicate key value violates unique constraint "friend_codes_pkey"
```

Fixed by switching that insert to `on conflict (profile_id) do update set code = excluded.code`. Re-ran:

**Output (`/tmp/db.log`), EXIT=0:**

```
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 76ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 98ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 118ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 119ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 134ms

 Test Files  5 passed (5)
      Tests  75 passed (75)
```

No migration changes in this round — test-only, as instructed. `supabase db reset` was not run; `db:start` only ran as `check:db`'s idempotent prestep against the already-running stack.

**Also corrected:** the factual error the reviewer flagged, in the "Concerns" section above — the stranger-deny check for `friend_codes` is in the brief's test verbatim (the last two assertions of `reveals an opponent's friend code, and only to an opponent`) and was carried through unchanged; my earlier claim that it "isn't in the brief's test and I didn't add it" was wrong.

**Deferred, not touched this round (per instruction):** the three Minor findings from the review.
