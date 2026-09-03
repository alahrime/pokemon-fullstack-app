# Task 5 report: pairing functions

## Judgement of the inherited test file

The file was substantially better than the brief's ~7-test sketch, and I kept
almost all of it. It correctly anticipated correction #3 (every `accept_offer`
call already carried a team argument) and correction #2 (it already had the
`service_role` grant test). It scoped every assertion to its own three users
(`mine()` / `myEntries()`) rather than reading the whole table, which the brief's
draft did not do and which matters on a shared local database. It used three
legitimate legs for the SKIP LOCKED proof (returns quickly, no match appeared,
the same rows pair once released) and for the two-tick race it correctly
allowed *either* safe outcome (0 or 1 matches) rather than asserting a single
one, which a real unsynchronized race cannot guarantee.

I found and fixed two real defects:

1. **`hold(...)` was called but never defined anywhere** — not in the test
   file, not in `helpers.ts`. Every test that used it (`skips rows another
   tick already holds...`) would have failed with a `ReferenceError` before
   ever reaching Postgres, i.e. the exact "a test that cannot fail [for the
   claimed reason] is worse than no test" case the brief warned about. I added
   `hold()` as a local helper (opens a fresh connection, begins a transaction,
   runs the given locking query, and only resolves once that query has
   actually completed — so the caller can't race the lock's own acquisition).
   It mirrors the manual lock/gate pattern already used elsewhere in the file,
   so this isn't a new idiom, just extracting the one that was missing.

2. **The lock-wedge bug the previous attempt flagged was only half-fixed.**
   The SKIP LOCKED test already had a `try/finally` releasing its lock. The
   *other* lock-holding test — `makes a second accept wait for the row rather
   than declaring it missing` — did not: if `expect(early).toBe('still
   waiting')` had failed, `release()` would never run, the holder's
   transaction would stay open forever, `accepting` would hang blocked on the
   same row, and `afterEach`'s `delete from match_offers where proposer_id in
   (...)` would then block on that exact row for the rest of the file. I
   rewrote it to use the new `hold()` helper and wrapped the body in
   `try/finally`, releasing the lock and draining `accepting` (with
   `.catch(() => {})`, so a hang-related rejection there can't clobber the
   original assertion failure) before the test can exit either way.

No other correctness issues found. I did not add anything myself beyond these
two fixes — the file's coverage (22 tests) already exceeded the brief and I
judged the extra tests worth keeping: they exercise real edges (different
`data_rev`, no-team, no-identity, no-session, the `accepted_team`/`accepted_by`
invariant, account deletion during an open acceptance) that the brief's ~7
never touched.

Correction #5 (UPDATE/DELETE denial needs three legs) doesn't apply to
anything in this file — there is no RLS-based UPDATE/DELETE denial test here
(the one direct `UPDATE` test asserts a `CHECK` constraint violation, which
always throws; it can't be confused with a silent 0-row RLS filter).

## Migration

`supabase/migrations/20260903005933_pairing_functions.sql`

Contents, relative to the brief's Step 3 draft:
- `pair_queue_entries()` and `sweep_expired()` unchanged from the brief, plus
  `grant execute ... to service_role` added for both (correction #2 — nothing
  else in the repo grants that role anything, and Task 6's coordinator needs
  it).
- `accept_offer(p_offer uuid, p_team jsonb)` — new signature (correction #3).
  Raises `'you must supply the team you are accepting with'` when `p_team` is
  null (checked right after the signed-in check, before touching the row).
  Writes `accepted_team = p_team` in the same `UPDATE` as `accepted_by` in
  both the live-offer and scheduled-offer branches, so the two columns are
  always set atomically together — never one without the other.
- `confirm_offer(p_offer uuid)` — reads `o.accepted_team` for `team_b` instead
  of `'[]'::jsonb`.
- `accept_offer`/`confirm_offer` grants: `revoke all ... from public, anon`
  then `grant execute ... to authenticated`. `create function` grants EXECUTE
  to PUBLIC by default, which every role inherits unless revoked — without
  the explicit revoke, `anon` would have been able to call `accept_offer` and
  the "refuses an accept from a request with no session at all" test
  (expecting `permission denied`) would have failed.
- `match_offers_accepted_needs_team` table constraint — see decision below.

## Decision: the `accepted_team`/`accepted_by` invariant

Added as a table constraint, one-directional:

```sql
alter table public.match_offers
  add constraint match_offers_accepted_needs_team
  check (accepted_by is null or accepted_team is not null);
```

Not "both null or both set." `accepted_by` is `on delete set null` (from Task
4's migration); when the taker's account is deleted, `accepted_by` is nulled
by the FK but `accepted_team` is deliberately left behind as a snapshot of a
roster with nobody attached — that's what the "still lets the taker delete
their account after accepting" test checks. A symmetric constraint would turn
that `ON DELETE SET NULL` into a constraint violation at delete time and make
the account undeletable, which is worse than the asymmetry it would be
closing.

I did not rely on "the functions alone suffice" — `accept_offer` always writes
both columns together and would never itself violate this, but a constraint
closes off every other path to the same broken state (a direct `UPDATE` by
someone with proposer-level ALL-policy access, or a future function), and the
inherited test file was already written expecting exactly this constraint by
name (`match_offers_accepted_needs_team`), which confirmed it as the right
call rather than a guess.

## Verification

**Confirmed I did not run `db reset`, `db:start`, or `db:stop` directly.** I
only ran `npm run check:db` (which is the gate command I was given verbatim,
and whose `db:start` step is `supabase start` — a no-op status check against
an already-running stack, not a restart) and `supabase migration up`, which
applies one specific pending migration without touching existing data. Before
touching anything I ran `supabase status --workdir ..` and confirmed the
stack was already up (`DB_URL` reachable on 54322); after the whole run I
queried `pg_locks where not granted`, `queue_entries`, `match_offers`, and
`matches` directly and got `0` for all four — no stuck locks, no leftover
fixture rows.

### Red (before the migration was applied — verbatim, trimmed to the pairing
file's failures and the run summary; full log at `/tmp/db-red.log`)

```
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 105ms
 ✓ ../supabase/tests/offers.test.ts (6 tests) 126ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 135ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 170ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 178ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 182ms
 ❯ ../supabase/tests/pairing.test.ts (22 tests | 22 failed) 311ms
   × pairing > pairs two verified entries sharing a hash, and consumes them 11ms
     → function public.pair_queue_entries() does not exist
   × pairing > leaves an unverified entry alone — the trust boundary 6ms
     → function public.pair_queue_entries() does not exist
   × pairing > does not pair entries whose hashes differ 5ms
     → function public.pair_queue_entries() does not exist
   × pairing > does not pair two clients on different data builds 5ms
     → function public.pair_queue_entries() does not exist
   × pairing > leaves the odd one out queued when three are waiting 6ms
     → function public.pair_queue_entries() does not exist
   × pairing > skips rows another tick already holds, rather than blocking on them 32ms
     → function public.pair_queue_entries() does not exist
   × pairing > never turns two entries into two matches when two ticks overlap 19ms
     → function public.pair_queue_entries() does not exist
   × pairing > records the taker's own team as team_b, not an empty roster 9ms
     → function public.accept_offer(unknown, jsonb) does not exist
   × pairing > lets only one of two simultaneous accepts through 30ms
     → expected [] to have a length of 1 but got +0
   × pairing > makes a second accept wait for the row rather than declaring it missing 56ms
     → expected 'failed: function public.accept_offer(…' to be 'still waiting' // Object.is equality
   × pairing > holds a scheduled offer until the proposer confirms it too 13ms
     → function public.accept_offer(unknown, jsonb) does not exist
   × pairing > lets nobody but the proposer confirm a scheduled offer 14ms
     → function public.accept_offer(unknown, jsonb) does not exist
   × pairing > refuses to let someone accept their own offer 12ms
     → expected [Function] to throw error matching /cannot accept your own offer/ but got 'function public.accept_offer(unknown,…'
   × pairing > refuses an accept on an offer the coordinator has not verified 9ms
     → expected [Function] to throw error matching /not been verified/ but got 'function public.accept_offer(unknown,…'
   × pairing > refuses an accept with no team at all 7ms
     → expected [Function] to throw error matching /team you are accepting with/ but got 'function public.accept_offer(unknown,…'
   × pairing > refuses an accept from a request carrying no identity 13ms
     → expected [Function] to throw error matching /signed in/ but got 'function public.accept_offer(unknown,…'
   × pairing > lapses an unconfirmed offer rather than converting it 2ms
     → function public.sweep_expired() does not exist
   × pairing > drops a queue entry that waited too long, and leaves a fresh one 4ms
     → function public.sweep_expired() does not exist
   × pairing > runs the coordinator functions as service_role and refuses everyone else 3ms
     → expected [Function] to throw error matching /permission denied/ but got 'function public.pair_queue_entries() …'
   × pairing > refuses an accept from a request with no session at all 3ms
     → expected [Function] to throw error matching /permission denied/ but got 'function public.accept_offer(unknown,…'
   × pairing > refuses an acceptance recorded without the taker's team 3ms
     → promise resolved "[]" instead of rejecting
   × pairing > still lets the taker delete their account after accepting 5ms
     → function public.accept_offer(unknown, jsonb) does not exist

 Test Files  1 failed | 6 passed (7)
      Tests  22 failed | 81 passed (103)
   Duration  618ms (transform 264ms, setup 0ms, collect 510ms, tests 1.21s, environment 1ms, prepare 574ms)
```

`EXIT=1`, exactly the 22 pairing tests failing, everything else in the DB
suite green — a clean red confirming the functions/constraint genuinely don't
exist yet, not an unrelated breakage.

### Migration apply

```
$ cd app && ./node_modules/.bin/supabase migration up --workdir .. > /tmp/mig.log 2>&1; echo "EXIT=$?"
EXIT=0
```
```
Connecting to local database...
Applying migration 20260903005933_pairing_functions.sql...
{"applied":["/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260903005933_pairing_functions.sql"],"message":"Migrations applied"}
```

### Green (after the migration — verbatim, full log at `/tmp/db-green.log`)

```
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 94ms
 ✓ ../supabase/tests/offers.test.ts (6 tests) 102ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 122ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 148ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 161ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 172ms
 ✓ ../supabase/tests/pairing.test.ts (22 tests) 1012ms
   ✓ pairing > makes a second accept wait for the row rather than declaring it missing  646ms

 Test Files  7 passed (7)
      Tests  103 passed (103)
   Duration  1.30s (transform 250ms, setup 0ms, collect 504ms, tests 1.81s, environment 1ms, prepare 486ms)
```

`EXIT=0`. I ran `check:db` a second time immediately after to check the
concurrency tests for flakiness: also `EXIT=0`, also 103/103, same shape
(pairing suite ~1s, the lock-wait test ~650ms). No flakes across two runs.

### Gates

```
cd app && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"   → EXIT=0  (7 files, 103 tests — full output above)
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"          → EXIT=0  (79 files, 1081 tests — tsc, oxlint, themes, tokens, verify, audit:spreads, rules:node, full test suite)
```

### Database left clean

Post-run direct query: `pg_locks where not granted` = 0, `queue_entries` = 0,
`match_offers` = 0, `matches` = 0. No fixture leakage, no held locks.

## What I could not prove about the concurrency tests

`lets only one of two simultaneous accepts through` and `never turns two
entries into two matches when two ticks overlap` depend on `Promise.all` /
`Promise.allSettled` actually causing genuine overlap at the database level —
that's inherent to testing a real race and isn't something a deterministic
assertion can force. I ran the suite twice and both races landed on their
"real" outcome both times (exactly one acceptance wins; the two-tick pairing
test produced a matched pair, the branch the test also permits producing zero
matches followed by a successful subsequent pair). I did not run it dozens of
times to hunt for the alternate branch, so I can't personally attest the
`matches.length === 0` branch of the two-tick test executes on this machine —
only that the test's logic covers it correctly if it does. This is inherent
to the test design, not a defect I introduced or left unfixed.

Separately, `runs the coordinator functions as service_role and refuses
everyone else` genuinely calls `pair_queue_entries()` and `sweep_expired()` as
`service_role` against the shared local database — these are global,
unscoped functions by design. If the human partner had real queue entries or
offers sitting in the table at the moment this test ran, this test would
process them for real (pair them, or lapse expired ones). I checked before
and after and the tables were empty both times, so nothing was affected in
this run, but this is a standing risk in the test's design, not something I
introduced — flagging it since the brief asked what I could not fully rule
out.

## Not merged to main

I committed this work on `feat/m2a-matchmaking` only. Per the task framing
this is Task 5 of a multi-task milestone (Task 6, the coordinator, is
explicitly still pending and depends on the `service_role` grants added
here), so I did not push or fast-forward this branch into `main` — that
belongs at milestone handoff, not mid-milestone, consistent with how M1b's
handoff was structured (local commits, merge/push at the end).

## Fix round 1

One Important finding from review, addressed. Compliance: spec compliant, no
Critical.

**Finding:** `confirm_offer` never checked `accepted_by is null` before using
it as `matches.player_b`. Because the `accepted_team`/`accepted_by` invariant
was chosen to be one-directional (deliberately — see the decision above), a
scheduled offer that reaches `state = 'accepted'` and then has its taker's
account deleted keeps sitting in `'accepted'` with `accepted_by` null and
`accepted_team` intact. A proposer confirming inside the expiry window then
hit `matches.player_b`'s `NOT NULL` constraint as a raw Postgres error instead
of a clean domain error. Reachable, untested, not corruption (the insert rolls
back).

**Fix — migration:**
`supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql`,
a `create or replace function public.confirm_offer(...)` (no `db reset`, per
the standing constraint) adding one guard before the INSERT:

```sql
if o.accepted_by is null then raise exception 'the person who accepted this offer no longer exists'; end if;
```

**Decision — do not also lapse the offer here.** `sweep_expired()` already
reaches this exact row once `expires_at` passes (`state in ('open',
'accepted')`), so the terminal `'lapsed'` transition already has one owner,
already tested. Having `confirm_offer` additionally mutate `state` on this
error path would duplicate that responsibility for no real gain: the window
is time-bounded regardless, and a proposer who retries before expiry just
gets the same clean error again rather than a different one. Keeping
`confirm_offer` as "confirm or raise a clean error" and leaving all
terminal-state transitions to the sweep keeps a single place responsible for
each.

**Fix — test:** added `refuses to confirm an accepted offer whose taker no
longer exists` to `supabase/tests/pairing.test.ts`, immediately after `still
lets the taker delete their account after accepting` (same setup: a
scheduled offer, a throwaway user `t`, `accept_offer` as `t`, then `delete
from auth.users where id = t`). It additionally confirms the offer is left
at `state: 'accepted', accepted_by: null` — the exact reachable state the
finding described — then calls `confirm_offer` as the proposer and asserts
the clean error (`/no longer exists/`) rather than a NOT NULL violation, and
that no match row was created. Cleans up nothing extra: the throwaway
user's cascade removes its own profile row, and the offer row is caught by
the file's existing `afterEach` (`delete from match_offers where proposer_id
in (a,b,c)` — this offer's proposer is `a`).

**Commands and output** (unique log path per the coordinator's instruction):

```
$ cd app && ./node_modules/.bin/supabase migration up --workdir .. > /tmp/task-5-fix-mig.log 2>&1; echo "EXIT=$?"
EXIT=0
```
```
Connecting to local database...
Applying migration 20260903011151_confirm_offer_guards_deleted_taker.sql...
{"applied":["/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql"],"message":"Migrations applied"}
```

```
$ cd app && npm run check:db > /tmp/task-5-fix-db.log 2>&1; echo "EXIT=$?"
EXIT=0
```
```
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 90ms
 ✓ ../supabase/tests/offers.test.ts (6 tests) 112ms
 ✓ ../supabase/tests/queue.test.ts (8 tests) 127ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 150ms
 ✓ ../supabase/tests/teams.test.ts (18 tests) 160ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 176ms
 ✓ ../supabase/tests/pairing.test.ts (23 tests) 1062ms
   ✓ pairing > makes a second accept wait for the row rather than declaring it missing  660ms

 Test Files  7 passed (7)
      Tests  104 passed (104)
```

Ran a second time immediately after (same command, output at the same log
path) to check for flakes with the new test in place: also `EXIT=0`, also
104/104. Also isolated the new test by name (`vitest run ... -t "refuses to
confirm an accepted offer whose taker no longer exists"`, output at
`/tmp/task-5-fix-covering-test.log`) to confirm it, specifically, passes:

```
 ✓ ../supabase/tests/pairing.test.ts > pairing > refuses to confirm an accepted offer whose taker no longer exists 41ms
 Test Files  1 passed | 6 skipped (7)
      Tests  1 passed | 103 skipped (104)
```

Post-run direct query confirmed the database left clean: `pg_locks where not
granted` = 0, `queue_entries` = 0, `match_offers` = 0, `matches` = 0.

No `db reset` run at any point in this fix round — only `supabase migration
up` (one targeted `create or replace function`) and `npm run check:db`.

**Stale citation corrected:** the "Gates" section above cited `/tmp/db.log`
for the `check:db` run; that path was never the one containing this task's
evidence (it was another agent's leftover run from an earlier time). The line
now cites `/tmp/db-green.log`, the file that was actually quoted in full
immediately above it in this report.
