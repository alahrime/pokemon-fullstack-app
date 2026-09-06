# Final fix wave — M3a friendships and blocks, before push to production

Applied against the three UNPUSHED migrations (`20260906000000`,
`20260906001000`, `20260906002000`) plus their covering tests, edited in
place since none has touched production. No migration dated `20260905124300`
or earlier was touched.

## FIX 1 (CRITICAL) — the offer board was a working block detector

**File:** `supabase/migrations/20260906002000_friend_codes_and_blocked_matchmaking.sql`

Changed `accept_offer_blocked_guard()`'s `raise exception 'this offer is no
longer available'` to `raise exception 'this offer is no longer open'` —
byte-identical to the sentence `accept_offer()` itself raises (deployed,
`20260904071717_accept_offer_agrees_on_the_data_build.sql:43`) for any offer
whose `state` is not `'open'`. Updated the two comment blocks above it (one
before the function, one inside it) that previously asserted the strings
matched without them actually matching.

**Test:** `supabase/tests/social.test.ts`, the test formerly named "lets an
unblocked accept through and refuses a blocked one, with the same message a
lapse gives" — renamed and rewritten. It no longer asserts a regex against a
literal. It now:
1. Forces one offer to `state = 'lapsed'` directly and calls `accept_offer`
   on it, capturing the real thrown message via the `refusal()` helper (a
   genuine lapse).
2. Blocks a pair and calls `accept_offer` on a genuinely still-`'open'`
   offer between them, capturing that thrown message too (the guard firing).
3. Asserts `expect(blockRefusal.message).toEqual(lapseRefusal.message)` —
   comparing the two captured runtime strings to each other, not either one
   against a hardcoded literal.

Also fixed the now-false comments at the old line 309 (`... raises 'this
offer is no longer available' ...`) and line 335 (`Succeeds, rather than
throwing 'this offer is no longer available' ...`) in the sweep test, both
updated to name the unified sentence.

## FIX 2 (IMPORTANT) — the guard didn't fire on confirm; that leaked the friend code

**File:** same migration, the `match_offers_block_guard` trigger.

Root cause confirmed by reading the deployed functions directly:
- `accept_offer()` (deployed) sets `accepted_by` at accept time on BOTH
  branches (live: `accepted_by` + `state='converted'` in one update;
  scheduled: `accepted_by` + `state='accepted'`).
- `confirm_offer()` (deployed, `20260905124300...sql:52-54`) moves
  `state: 'accepted' → 'converted'` and NEVER touches `accepted_by`.

So the old `when (old.accepted_by is distinct from new.accepted_by)` never
fired on the confirm transition. A scheduled offer accepted honestly, then
blocked by either party, then confirmed inside the window, would create a
`matches` row between the blocked pair — and the "shared active match" arm
of the `friend_codes` SELECT policy (`20260905124000_match_reports_and_rounds.sql`)
then reveals the blocker's friend code to the blocked party.

**Fix applied**, extending the `WHEN` clause:
```sql
when (old.accepted_by is distinct from new.accepted_by
      or (old.state is distinct from new.state and new.state = 'converted'))
```
Rewrote the comment above the trigger to explain both arms and why the
regression check below still holds.

### Regression check — did NOT skip

`sweep_expired()` (deployed) only ever writes `state = 'lapsed'`, never
`'converted'`, and never touches `accepted_by`. So neither arm of the new
`WHEN` clause should fire for it. Verified this directly against the live
database rather than assuming it:

```
$ docker exec -i supabase_db_paragon-iv psql -U postgres -v ON_ERROR_STOP=0 -f - <<'SQL'
begin;
insert into auth.users (...) values (SWEEPA, SWEEPB);
... (format, format_version, an 'accepted' offer expired 1 hour ago, a block between the two players)
select public.sweep_expired() as swept;
select state from public.match_offers where proposer_id = '11111111-...';
rollback;
SQL
```
Real output:
```
 swept
-------
     0
(1 row)

 state
--------
 lapsed
(1 row)

ROLLBACK
```
`sweep_expired()` returned a plain integer (0 — no queue entries to delete
in this fixture) rather than raising, and the poisoned offer's row was
actually updated to `'lapsed'` inside the same transaction before the
rollback. The guard did not fire on the sweep's update.

**New test added** proving the confirm path IS now guarded:
`supabase/tests/social.test.ts`, "refuses to confirm a scheduled offer once
the two parties have blocked each other, with the same sentence FIX 1
unified on". Sequence: create a scheduled offer, accept it honestly (state
→ 'accepted', `accepted_by` set), block afterward, then call
`confirm_offer` as the proposer. Asserts:
- `confirm_offer`'s thrown message equals a second, independently-captured
  `accept_offer` refusal message on the same now-non-open offer (both
  produce `accept_offer_blocked_guard`'s / `accept_offer`'s unified `'this
  offer is no longer open'` sentence) — captured and compared, not
  hardcoded.
- The offer's `state` stays `'accepted'` and `match_id` stays `null` (the
  whole `confirm_offer` transaction, including its `insert into matches`,
  rolled back).
- No row was created in `matches` for the pair.

This test also existing-tests-as-regression-guard: it was added to
`supabase/tests/social.test.ts` and is part of the 180-test `check:db` run
below (was 178 before this wave; +1 for this test, +1 for FIX 4's new
direct-insert-refusal test).

## FIX 3 (free) — no longer depends on production's catalog

**File:** same migration. Removed the comment that reasoned "`create or
replace function` preserves the existing grants, checked against
`pg_proc.proacl`" — that check is meaningless against production, where this
migration has never run and there is no prior grant state to have "checked".
Replaced it with an explicit, self-contained re-emission of the ACL, exactly
matching the precedent in `20260903005933_pairing_functions.sql`:
```sql
revoke all on function public.pair_queue_entries() from public, anon, authenticated;
grant execute on function public.pair_queue_entries() to service_role;
```
Covered by the existing (unmodified) test in `supabase/tests/pairing.test.ts`
("runs the coordinator functions as service_role and refuses everyone
else"), which asserts `anon`/`authenticated` get `permission denied` and
`service_role` succeeds — still green.

## FIX 4 (IMPORTANT) — the blocks policy permitted the state its own comment forbade

**File:** `supabase/migrations/20260906000000_friendships_and_blocks.sql`

The single `for all` policy on `public.blocks` let any `authenticated`
caller `INSERT`/`UPDATE` the table directly via PostgREST, bypassing
`block_user()` — which is the only place that also tears down the
friendship (`block_user`'s own comment: "A block that leaves the friendship
standing is not a block"). A direct insert could create a block while the
friendship survived, leaving the blocked party still able to read the
blocker's friend code, both still listed as friends, and
`respond_to_friendship()` able to accept a request from a blocked party.
UPDATE additionally let a caller repoint `blocked_id` on their own row.

**Fix applied:** replaced the one `for all` policy with two — `for select`
and `for delete` — both keeping the original `blocker_id = auth.uid()`
`USING` clause (Postgres's `CREATE POLICY` takes exactly one command keyword
or `ALL`; `for select, delete` is not valid syntax, confirmed by testing it
directly against the live database — it raises a plain syntax error). Wrote
a new comment explaining why INSERT/UPDATE are now closed and what a client
still legitimately needs (list and remove its own blocks).

### Per-test statement (harness changes, not weakenings)

All three are in `supabase/tests/social.test.ts`.

1. **`social.test.ts:67`** ("hides a block completely from the person
   blocked") — changed the fixture-creation line from
   `insert into public.blocks (blocked_id) values (...)` to
   `select public.block_user('${bob}')`. Same assertions afterward (ann
   sees 1 row, bob and cal see 0). **Route change only** — the policy this
   test exercises is SELECT, untouched by FIX 4; only the way the fixture
   block gets created had to move off the now-closed INSERT path.

2. **`social.test.ts:77`** ("refuses a block against yourself") — split
   into two real, separate claims that a single direct-insert assertion had
   been standing in for:
   - `block_user(self)` returns `false` (it returns early, never raises —
     confirmed by reading `block_user`'s body: `if p_target is null or
     p_target = me then return false`). Asserted via
     `.toEqual([{ block_user: false }])`, not `.rejects.toThrow`, because
     there is nothing to catch on this path.
   - The `blocks_distinct` CHECK constraint on the table itself is a
     separate, still-real invariant, exercised via the superuser `sql()`
     helper (which bypasses RLS the same way the `postgres`-owned,
     `security definer` `block_user` does) doing a raw
     `insert into public.blocks (blocker_id, blocked_id) values (ann, ann)`,
     asserted to `.rejects.toThrow(/blocks_distinct/)`. **Route change,
     required by FIX 4**: the only client-reachable route (a direct
     authenticated insert) is now refused by RLS before the constraint is
     ever reached, so exercising the constraint at all requires the
     superuser helper — exactly as the brief anticipated.

3. **`social.test.ts:82`** ("lets the blocker unblock and nobody else") —
   same fixture-creation change as (1): `block_user('${bob}')` instead of a
   direct insert. The DELETE-side assertions (bob's delete is filtered to 0
   rows with no error; ann's own delete succeeds) are untouched — FIX 4
   left the DELETE policy exactly as it was, so this is a pure route change
   on the setup line.

**New test added** (not a rewrite): "refuses a direct insert into blocks;
block_user is the only route in" — proves the hole FIX 4 closes is actually
closed, which none of the three rewritten tests above prove on their own
(they only prove `block_user` still works). Asserts a direct
`insert into public.blocks (blocked_id) values (...)` as `authenticated` is
refused with `POLICY_DENIED` (`new row violates row-level security policy`),
and that no row was created.

## FIX 5 (free) — untracked, ungitignored env backup

`app/.env.local.bak` (contents: only the local Supabase URL and the
publishable anon key — nothing secret, per its own header comment) was
untracked and NOT matched by any existing `.gitignore` pattern (`.env.local`,
`*.env.local`, `*.env.*.local` all miss the `.bak` suffix — confirmed with
`git check-ignore -v`, which exited 1 before the fix).

Added to `.gitignore`:
```
# Backups and other derivatives of an env file carry the same values and must
# be excluded too — `*.env.local` alone does not match `app/.env.local.bak`.
*.env.local*
```
Deleted `app/.env.local.bak`. Confirmed the hole is closed:
```
$ git check-ignore -v app/.env.local.bak
.gitignore:10:*.env.local*	app/.env.local.bak
```
(exit 0 now, would ignore the file if it reappeared).

## Verification — exact commands and real output

### 1. `db:reset`
```
$ cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
```
All 32 migrations applied cleanly, ending with `20260906002000...sql`, no
errors.

### 2. `check:db`
```
$ cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail of `/tmp/db.log`:
```
 ✓ ../supabase/tests/coordinator-tick.test.ts (9 tests) 97ms
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 143ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 250ms
 ✓ ../supabase/tests/queue.test.ts (11 tests) 274ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 280ms
 ✓ ../supabase/tests/teams.test.ts (23 tests) 313ms
 ✓ ../supabase/tests/offers.test.ts (21 tests) 427ms
 ✓ ../supabase/tests/reports.test.ts (20 tests) 465ms
 ✓ ../supabase/tests/social.test.ts (21 tests) 469ms
 ✓ ../supabase/tests/pairing.test.ts (26 tests) 1114ms

 Test Files  10 passed (10)
      Tests  180 passed (180)
```
180 ≥ 179 required. `pairing.test.ts` (26) and `offers.test.ts` (21) both
green.

### 3. `check`
```
$ cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail of `/tmp/app.log`:
```
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```
Exactly 1233/1233 as required.

### 4. `sweep_expired` reproduction

See FIX 2 section above — real output included, `swept` came back as `0`
(a number), the offer's row was actually set to `'lapsed'`, no exception.

### 5. Roundtrips
```
$ cd app && KEY=$(npx supabase status --workdir .. 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
DEF='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
for t in m3a m2b; do ./node_modules/.bin/esbuild tools/$t-roundtrip.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/$t-f.mjs --log-level=warning --define:import.meta.env="$DEF" > /tmp/b-$t.log 2>&1; SUPABASE_SERVICE_ROLE_KEY="$KEY" node node_modules/.cache/$t-f.mjs > /tmp/rt-$t.log 2>&1; echo "$t EXIT=$?"; tail -2 /tmp/rt-$t.log; done
```
Real output:
```
m3a EXIT=0

9 passed, 0 failed
m2b EXIT=0

11 passed, 0 failed
```
Both esbuild bundles produced no warnings (both `/tmp/b-*.log` empty).

## Files changed

- `supabase/migrations/20260906002000_friend_codes_and_blocked_matchmaking.sql`
  (FIX 1, FIX 2, FIX 3)
- `supabase/migrations/20260906000000_friendships_and_blocks.sql` (FIX 4)
- `supabase/tests/social.test.ts` (tests for FIX 1, FIX 2, FIX 4; imports
  `POLICY_DENIED`)
- `.gitignore` (FIX 5)
- `app/.env.local.bak` deleted (FIX 5)

## Concerns

None outstanding. Every fix was applied, verified against the live database
where the brief called for it (the `pg_proc.proacl`-syntax check for FIX 4's
`for select, delete` rejection, and the `sweep_expired` reproduction for
FIX 2), and no test was weakened — three tests changed ROUTE (direct insert
→ `block_user()`) as FIX 4 required, and two new tests were added to cover
ground no existing test proved. All four gates (`check:db`, `check`,
`m3a-roundtrip`, `m2b-roundtrip`) are green. Nothing has been pushed.
