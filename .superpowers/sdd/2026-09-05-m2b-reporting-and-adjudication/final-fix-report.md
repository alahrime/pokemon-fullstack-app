# Final whole-branch review — remaining fix wave

All four remaining findings (Rulings 19–22, plus the cheap Ruling-adjacent FIX 4) are closed.
`npm run db:stop` was never run; the local stack stayed up throughout.

## FIX 1 (CRITICAL) — scheduled match play time

**Root cause confirmed**, matching the brief's four legs exactly: `confirm_offer()`
(`supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql:37-42`, deployed to
production) inserts the `matches` row at handshake confirmation, with `created_at = now()`.
`match_offers.scheduled_for` (`20260902205215_match_offers.sql:15,35`) is constrained only
`scheduled_for is null or scheduled_for > created_at` — no upper bound. `matches` had no play-time
column. `MatchmakingScreen.tsx:832`'s `datetime-local` input has no `max`. So a match agreed
Monday for Friday would be swept `unverified` on Wednesday, before either side played it.

**What changed:**

- `supabase/migrations/20260905124000_match_reports_and_rounds.sql` (unmerged, edited in place):
  added `matches.play_after timestamptz`, nullable, beside `rating_counted`/`amend_deadline`, with
  a comment explaining why `created_at` is the wrong clock for a scheduled match.
- `supabase/migrations/20260905124300_scheduled_matches_carry_their_play_time.sql` (new): replaces
  `confirm_offer(uuid)` — the deployed function — via `create or replace function`, inserting
  `play_after = o.scheduled_for` into the new match. `create or replace` preserves existing grants
  (verified: `pg_proc.proacl` for `confirm_offer` is unchanged, no `public`/`anon`), so no
  revoke/grant statements were needed.
- Checked the other writer named in the brief, `accept_offer()`
  (`20260904071717_accept_offer_agrees_on_the_data_build.sql`): its match-creating INSERT only runs
  on the `o.scheduled_for is null` (live) branch — by construction a live offer has no scheduled
  time, so its match's `play_after` is null exactly like a queue match's, with no code change
  needed. The scheduled branch of `accept_offer` never inserts into `matches` at all (it just
  flips the offer to `accepted`); `confirm_offer` is the only function that ever creates a match
  from a *scheduled* offer, so it is the only one that needed replacing.
- `pair_queue_entries()` (queue path) inserts no `play_after` — stays null, correct.
- `supabase/migrations/20260905124200_sweep_matches.sql`: give-up predicate changed to
  `coalesce(play_after, created_at) < now() - interval '48 hours'`, with a comment naming the
  scheduled-match failure mode this closes.

**Tests added** (`supabase/tests/reports.test.ts`), plus `makeMatch` parameterized with an optional
`source` argument (default `'queue'`, all existing call sites unaffected):

- `does not give up on a scheduled match before its agreed play time arrives` — `play_after` 96h
  in the future, `created_at` 49h in the past; asserts state stays `paired`.
- `gives up on a scheduled match whose agreed play time is more than 48 hours past` — `play_after`
  49h in the past, `created_at` only 1h in the past; asserts state becomes `unverified`.
- `still gives up on a queue match with no play_after, aged by created_at as before` — regression
  guard for existing queue behaviour.

**Revert experiment (exact result):** reverted the predicate to bare `created_at` in
`20260905124200_sweep_matches.sql`, `db:reset`, ran `reports.test.ts` alone:

```
× does not give up on a scheduled match before its agreed play time arrives
  → should still be waiting to be played, not swept: expected 'unverified' to be 'paired'
× gives up on a scheduled match whose agreed play time is more than 48 hours past
  → expected 'paired' to be 'unverified'
✓ still gives up on a queue match with no play_after, aged by created_at as before
Test Files  1 failed (1)
     Tests  2 failed | 18 passed (20)
```

Both new scheduled-match tests fail exactly as the bug predicts (the first would be wrongly swept,
the second wrongly not swept); the queue-match regression test is unaffected. Restored the fix,
`db:reset`, re-ran: all 20 tests in the file pass, and the full `check:db`/`check` suites below
confirm the restore.

## FIX 2 (IMPORTANT) — rating_counted overclaims

`20260905124100_submit_report.sql`'s confirm branch changed from unconditional `rating_counted =
true` to `rating_counted = (m.source = 'queue')`, per Ruling 21 (not the reviewer's suggested
constant `false` — `source` is exactly the half of the spec's predicate a `matches` row can answer
today, since there is no `league` column). Added a comment stating plainly this is only half the
predicate and that the rating pass landing later (M4) must re-derive eligibility, not trust this
flag.

**Test added:** `only counts a confirmed match toward rating when it came from the open queue` — a
confirmed `source='queue'` match gets `rating_counted = true`; a confirmed `source='offer'` match
gets `false`.

## FIX 3 (IMPORTANT) — coordinator swallowing sweep_matches errors

`supabase/functions/coordinator/index.ts`: the `sweep_matches` RPC call now destructures `error`
and returns `new Response(sweepError.message, { status: 500 })` when it fails, instead of folding
a failure into `matches: sweptMatches ?? 0` (indistinguishable from "nothing to sweep"). This
mirrors the existing pattern earlier in the same file (`if (error) return new Response(error.message,
{ status: 500 })` in the verify loop). `paired`/`swept` are deliberately left swallowing their
errors — pre-existing, out of scope per the brief.

`docs/superpowers/HANDOFF.md` updated at both places describing the healthy tick's body:
- The "prove the coordinator ticks" section (originally just "Expect `200` with
  `{"verified":0,...}`") now also notes a `500` with a plain-text body means `sweep_matches`
  itself failed.
- The "confirm, on the next whole minute" section's "A healthy tick answers `200` with
  `{"verified":N,...}`" line now has a follow-on sentence with the same `500` explanation.

`npm run check`'s `verify:coordinator-bundle` step passed, confirming the edited
`coordinator/index.ts` still builds against the same rules bundle (`rules.bundle.js` — matches
`src/rules`, not stale).

## FIX 4 (cheap) — stuck mismatch row class

`20260905124200_sweep_matches.sql`'s first UPDATE guard changed from `amend_deadline is not null
and amend_deadline <= now()` to `(amend_deadline is null or amend_deadline <= now())`, with a
comment explaining this closes an unreachable-today (but free) stuck-row class: a `mismatch` row
with a null deadline would otherwise match neither this update nor the give-up update below
(which only targets `paired`/`reported`), and would be permanently unresolvable.

## Files changed

- `supabase/migrations/20260905124000_match_reports_and_rounds.sql` — added `play_after` column
- `supabase/migrations/20260905124100_submit_report.sql` — `rating_counted = (m.source = 'queue')`
- `supabase/migrations/20260905124200_sweep_matches.sql` — `coalesce(play_after, created_at)`,
  null-deadline guard
- `supabase/migrations/20260905124300_scheduled_matches_carry_their_play_time.sql` — new,
  `confirm_offer()` replace
- `supabase/functions/coordinator/index.ts` — surface `sweep_matches` RPC errors as 500
- `docs/superpowers/HANDOFF.md` — two healthy-tick-body descriptions updated
- `supabase/tests/reports.test.ts` — 4 new tests, `makeMatch` parameterized with `source`
- `.superpowers/sdd/2026-09-05-m2b-reporting-and-adjudication/progress.md` — ledger entry appended

## Verification commands and output

```
$ npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
# migrations applied in strict order ...20260905123000 (oauth guard, untouched)
# ...20260905124000, 124100, 124200, 124300

$ npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  9 passed (9)
      Tests  159 passed (159)          # was 155; +4 new tests, 0 regressions

$ npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  85 passed (85)
      Tests  1220 passed (1220)        # unchanged; includes verify:coordinator-bundle pass
```

Two-account roundtrip (`tools/m2b-roundtrip.ts`), run twice — once right after the fixes, once
again after the FIX-1 revert experiment restored the fix — both times:

```
BUILD_EXIT=0
RT=0
...
PASS  7. bot1 submitting into that disputed match raises "this match is no longer accepting reports"

11 passed, 0 failed
```

ACLs re-checked directly against `pg_proc.proacl` after the final `db:reset`, confirming
`create or replace function public.confirm_offer` did not widen its grants:

```
confirm_offer|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
submit_report|{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
sweep_matches|{postgres=X/postgres,service_role=X/postgres}
```

No `public`/`anon` on any of the three — matches the pre-existing state.

## Disagreements / concerns

None. One clarification worth recording: the brief said "check both" `confirm_offer` and an
`accept_offer` live path for the play-time fix. `accept_offer`'s live branch needed no code
change — it only ever inserts a match when `o.scheduled_for is null`, so `play_after` is null on
that path by construction, which is the correct behaviour (a live offer has no agreed-later play
time). Only `confirm_offer`, the scheduled-offer path, needed the new migration. This is stated
explicitly in the new migration's own comment and in the progress ledger.
