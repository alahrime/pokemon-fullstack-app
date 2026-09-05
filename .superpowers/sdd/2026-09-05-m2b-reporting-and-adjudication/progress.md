# SDD ledger — plan: docs/superpowers/plans/2026-09-05-m2b-reporting-and-adjudication.md

Spec: docs/superpowers/specs/2026-08-31-paragon-platform-design.md (read; binding authority)
Branch: feat/m2b-reporting (from main @ 6cde170)
Baseline before Task 1: npm run check green — 83 files, 1209 tests, exit 0.

## Preflight conflict scan

### Task pairs sharing a file or an interface

| Pair | Produced vs consumed | Finding |
|---|---|---|
| T1 ↔ T2 | `is_valid_scoreline(smallint,text[])`; both append to `reports.test.ts` | Clean. T2's tests reuse `makeMatch` from T1's block; execution order holds it. |
| T1 ↔ T3 | `reports.test.ts` append | Clean. |
| T2 ↔ T3 | `submit` helper defined in T2, used by T3 | Clean, order-dependent; ordering holds. |
| T2 ↔ T4 | `submit_report(uuid,text[])` vs rpc args `p_match_id`/`p_wins` | Clean, names match. |
| T1 ↔ T4 | `matches.state` 7 values vs `MatchState` union | Clean, all 7 agree. |
| T4 ↔ T5 | `Match`, `Side`, `submitReport`, `toMatchTerms`, `toMyTerms` | Clean. |
| T4 ↔ T5 | `matchmaking.ts` re-export vs `MatchmakingScreen` import | Clean — screen imports stay valid. |
| T3 ↔ T6 | `sweep_matches()` vs roundtrip check 6 | Clean. |
| T4 ↔ T6 | `matches.ts` consumed by the roundtrip | Clean. |

### Each task against itself

| Task | Finding |
|---|---|
| T1 | Agrees. Test imports `POLICY_DENIED` without using it — see Ruling 3. |
| T2 | Agrees. |
| T3 | Agrees. Also edits HANDOFF.md, which is documentation, not gated. |
| T4 | Agrees. |
| T5 | **DEFECT** — test imports `{ render } from '../../../test/render'`. Neither exists: the helper is `app/src/test/render.tsx`, exporting **`renderApp`**, reached from `src/screens/__tests__/` as `'../../test/render'`. See Ruling 2. |
| T6 | Specified in prose, not full code. See Ruling 4. |

## Rulings

Ruling 1: Feature branch `feat/m2b-reporting` in the existing checkout rather than a git worktree — the user's running dev server, their two signed-in browser origins, and the 12-container local Supabase stack are all bound to this checkout, and a worktree would need a duplicate node_modules and would contend for the same container names and ports. Cost if wrong: none to the code; create a worktree later and the branch moves with it.

Ruling 2: Task 5 uses `renderApp` from `'../../test/render'`, not `render` from `'../../../test/render'`. The plan's import is wrong on both the name and the depth. Cost if wrong: none — `renderApp` is the only export the file has.

Ruling 3: T1's unused `POLICY_DENIED` import is left to the implementer's discretion. oxlint runs with cwd `app/`, and `supabase/tests/` sits outside it, so an unused import there is not a gate failure. Cost if wrong: one lint error at T1's gate, one import removed.

Ruling 4: Task 6 is accepted as prose. It is a fixture, its seven checks are individually enumerated, and `app/tools/m2a-roundtrip.ts` is the pattern to copy. Cost if wrong: one clarification round with the implementer.

## Progress

Task 1: complete (commit b379c29, review pending) — see Ruling 5/6 first.

Ruling 5: `npm run check:db` was ALREADY RED on main before this plan started. Measured, not assumed: checked out baseline 6cde170, ran `db:reset` + `check:db`, got the byte-identical 8 failures (139 tests, 8 failed). The implementer's "pre-existing" claim is confirmed. The plan's Global Constraint "check:db green at the end of every task" is therefore unsatisfiable as written; for this plan it is read as "no NEW failures, and the pre-existing 8 fixed by Task 1b". Cost if wrong: none — the measurement is reproducible with two commands.

Ruling 6: Insert an unplanned Task 1b to fix the 8 pre-existing failures BEFORE continuing to Task 2, rather than parking them. Two groups, both regressions from commit 996be91 (`20260904190000_friend_codes_are_twelve_digits.sql`), which is DEPLOYED TO PRODUCTION:
  (a) CRITICAL — that migration rewrote `handle_confirmed_user()` and dropped the `display_name/go_username/birth_date is null -> return new` guard added by `20260901225208`. Only the `email_confirmed_at` check survives. This is verbatim the defect HANDOFF.md documents as "OAuth signup was impossible at the database level": Discord is the only provider button, GoTrue inserts a provider account already confirmed with none of those three fields, the INSERT raises not_null_violation, which is NOT the unique_violation the handler forgives, so it propagates and takes the whole auth.users INSERT with it. 5 failing tests have been reporting this since 2026-09-04.
  (b) MINOR — 3 rls.test.ts fixtures write friend codes that predate the `friend_codes_twelve_digits` constraint the same migration added, so they now violate it. Stale tests, not a product bug.
  Rationale for fixing rather than parking: a red gate makes every later task's gate unreadable ("did I break it, or was it already broken?"), which degrades every review left in this plan; and M2b will be deployed on top of (a).
  Cost if wrong: one extra migration and a test-fixture edit, both revertable, on a branch that is not yet merged.
Task 1+1b: review clean on spec (✅), 1 Important + 3 Minor on quality. Entering fix round 1.
Task 1: minor (deferred): `is_valid_scoreline`'s `other-side < needed` clause is mathematically redundant given the other two conditions. Harmless, and it documents the rule; left alone.
Task 1: minor (deferred): neither `match_reports.reporter_id` nor `match_rounds.winner` is constrained to be one of the match's two players. Not exploitable while all client writes are revoked and no INSERT policy exists. CARRY INTO TASK 2 — `submit_report` becomes the only writer and is where that invariant gets enforced.

Ruling 7: the deny-test gap on the friend-code policy (no test proves the code is HIDDEN once `confirmed`/`unverified`) is promoted from Minor into fix round 1. The plan's Global Constraints say "Every policy gets an allow test AND a deny test" without exception, so this is spec compliance, not polish. Cost if wrong: two extra assertions in a test that already exists.

Ruling 8: fix round 1 EDITS `20260905120000_match_reports_and_rounds.sql` in place rather than adding a follow-up migration. The append-only rule binds DEPLOYED migrations; this one exists only on the unmerged branch `feat/m2b-reporting` and has never reached production. A corrective migration here would ship a permanent two-step apology for a file nobody outside this branch has run. Cost if wrong: if the branch had somehow been deployed, the edit would not re-run — checked, it has not; `main` is at 6cde170.
Task 1: fix round 1/5 (2 addressed, 0 open — anon write grants revoked on both tables; deny tests added for confirmed/unverified friend-code visibility and for anonymous writes; commits 85998a0..36dcb05). Verified by the controller: check:db EXIT=0 145/145, check EXIT=0 1209/1209, and information_schema.role_table_grants returns EMPTY for anon+authenticated INSERT/UPDATE/DELETE on match_reports and match_rounds.

Ruling 9: the superpowers `sdd-workspace` / `review-package` scripts rewrite `.superpowers/sdd/.gitignore` to a bare `*` on every run, silently reversing commit 26bb6a3, which deliberately made the decision ledgers tracked (HANDOFF.md documents this and tells the next session to read them). Restored after each script run and this plan's ledger committed explicitly. Cost if wrong: none — worst case the ledgers are tracked when somebody wanted them ignored, which is the state the repo already chose.
