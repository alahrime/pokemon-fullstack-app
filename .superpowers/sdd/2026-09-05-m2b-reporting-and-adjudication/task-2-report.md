# Task 2 report — `submit_report()`

## What changed

- Created `supabase/migrations/20260905121000_submit_report.sql` — verbatim from the brief. Defines `public.submit_report(p_match_id uuid, p_wins text[]) returns text`, `security definer`, granted to `authenticated`.
- Appended four tests to the existing `describe('match reports and adjudicated rounds', ...)` block in `supabase/tests/reports.test.ts` — verbatim from the brief, plus the `submit` helper. No new file, no new describe block.

## TDD sequence

**1. Baseline (before any change):**
```
cd app && npm run check:db > /tmp/db_baseline.log 2>&1; echo "EXIT=$?"
```
`EXIT=0`, `Test Files 9 passed (9)`, `Tests 145 passed (145)`.

**2. Appended the tests, ran to confirm the expected failure:**
```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"; grep -c "submit_report" /tmp/db.log
```
Output: `EXIT=1`, grep count `7`.
Relevant log lines:
```
❯ ../supabase/tests/reports.test.ts (10 tests | 4 failed) 244ms
  → function public.submit_report(unknown, text[]) does not exist
  → function public.submit_report(unknown, text[]) does not exist
  → function public.submit_report(unknown, text[]) does not exist
FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > confirms the match when both sides agree, and writes the rounds
FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > opens one amend window on disagreement and does not extend it
FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > confirms after an amend brings the two claims together
PostgresError: function public.submit_report(unknown, text[]) does not exist
FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > refuses a stranger, an impossible scoreline, and a settled match
"function public.submit_report(unknown, text[]) does not exist"
Test Files  1 failed | 8 passed (9)
     Tests  4 failed | 145 passed (149)
```
Exactly the failure mode the brief predicted, and for exactly the reason expected (the function does not exist yet). 145 pre-existing tests stayed green; the 4 new failures are all and only the new `submit_report` assertions.

**3. Wrote the migration** (`supabase/migrations/20260905121000_submit_report.sql`), verbatim from the brief.

**4. Reset the DB and reran the full gate:**
```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET_EXIT=$?"
```
`RESET_EXIT=0`. Migration order confirmed from the reset log: `...match_reports_and_rounds.sql` → `...submit_report.sql` → `...restore_the_oauth_signup_guard.sql` (unedited, applied after as before).

```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
```
`EXIT=0`
```
✓ ../supabase/tests/reports.test.ts (10 tests) 364ms
Test Files  9 passed (9)
     Tests  149 passed (149)
```

**5. Full app gate:**
```
cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
```
`EXIT=0`
```
Test Files  83 passed (83)
     Tests  1209 passed (1209)
```

## Test counts

| Gate | Before | After |
|---|---|---|
| `check:db` | 145/145, EXIT=0 | 149/149, EXIT=0 |
| `check` | 1209/1209, EXIT=0 (not disturbed) | 1209/1209, EXIT=0 |

## Load-bearing details verified against the deployed function

Pulled the live function definition directly from Postgres to confirm nothing was silently altered on apply:
```
docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select pg_get_functiondef('public.submit_report'::regproc)"
```
Confirmed present, verbatim:
- `select * into m from public.matches where id = p_match_id for update;` — the row lock is intact, not dropped or weakened.
- `amend_deadline = coalesce(m.amend_deadline, now() + interval '10 minutes')` — `coalesce`, not plain assignment. The "opens one amend window and does not extend it" test (`second.amend_deadline` equals `first.amend_deadline` after a second `mismatch`-producing amend) passed, which is the direct behavioral proof.

## Carried finding from Task 1 — resolved

The brief asked me to confirm the "reporter_id / winner must be a match participant" invariant is now enforced, since `submit_report` is the only writer of both tables (all direct client INSERT/UPDATE/DELETE revoked in Task 1's migration, unedited).

Checked directly in the function body:
- `if me is null or me not in (m.player_a, m.player_b) then raise exception 'this match is not yours'; end if;` runs before the `insert into public.match_reports`, so `reporter_id` (bound to `me`, from `auth.uid()`) can never be written as anyone other than one of the match's two players. `me` itself comes from `auth.uid()`, which the caller cannot spoof — RLS/session context sets it, not a parameter.
- `match_rounds.winner` is written only in one place: `case when p_wins[i] = 'a' then m.player_a else m.player_b end` — the value can only ever be `m.player_a` or `m.player_b`, both scalars pulled from the locked `matches` row, never from caller-supplied text.
- I did not find any other INSERT path into either table: both tables still have INSERT/UPDATE/DELETE revoked from `anon` and `authenticated` (Task 1, untouched), and `submit_report` is `security definer` owned by the table owner, so it is the sole writer.

Conclusion: the invariant is now enforced by construction, not by a constraint. No path exists that writes `reporter_id` or `winner` with a non-participant. I did not add an explicit CHECK/FK for this since the brief's function already closes the gap procedurally and no test in the brief calls for a constraint-level enforcement; flagging this only in case a future migration adds a second writer to these tables without re-deriving this guarantee.

## Deviations from the brief

None. Migration SQL and test code were used verbatim as given. Only addition beyond the literal brief text was writing this report and running the verification queries.

## Anything I'm unsure about

- The brief's step 2 command included `grep -c "submit_report" /tmp/db.log` with no stated expected count; I ran it for completeness (got `7`) but treated the actual pass/fail evidence (the `does not exist` error and the 4 named failing tests) as the real verification, per the brief's own "Expected: FAIL with `function public.submit_report(unknown, text[]) does not exist`."
- I did not add a belt-and-braces DB-level constraint (FK/check) tying `match_rounds.winner` or `match_reports.reporter_id` to the match's two players, since the brief's design deliberately closes this at the function level and asked me to confirm rather than harden further. If a future task adds any other writer to these tables (even another security-definer function), this invariant would need to be re-verified there — it is not structurally guaranteed by the schema itself.
