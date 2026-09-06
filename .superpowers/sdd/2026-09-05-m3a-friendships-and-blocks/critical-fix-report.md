# Critical fix wave: the block guard vs. the coordinator's sweep

Scope: one CRITICAL defect (the block guard permanently kills `sweep_expired()`) plus two
Important findings (a missing PUBLIC revoke, an untested pairing guarantee), all against
`20260906002000_friend_codes_and_blocked_matchmaking.sql` and its neighbours. All three fixes
land in the same unpushed migration plus the coordinator function and the social test suite —
no corrective migration was needed since `20260906002000` was never deployed.

## FIX 1 — scope the block guard trigger, stop the coordinator swallowing its error

**What changed**

`supabase/migrations/20260906002000_friend_codes_and_blocked_matchmaking.sql`: the trigger

```sql
create trigger match_offers_block_guard
  before update on public.match_offers
  for each row execute function public.accept_offer_blocked_guard();
```

fired on every update to `match_offers`, including `sweep_expired()`'s bulk
`update ... set state = 'lapsed' where state in ('open','accepted') and expires_at <= now()`,
which never touches `accepted_by`. For any offer that had reached `accepted` honestly and whose
two parties later blocked each other, once it expired the guard raised
`this offer is no longer available` *inside the sweep's own transaction* — rolling back the
`delete from queue_entries where expires_at <= now()` that had already run earlier in the same
function. Added a `when` clause so the trigger only fires on the transition the guard is meant to
police:

```sql
create trigger match_offers_block_guard
  before update on public.match_offers
  for each row
  when (old.accepted_by is distinct from new.accepted_by)
  execute function public.accept_offer_blocked_guard();
```

`is distinct from` (not `<>`) so the ordinary accept path (`old.accepted_by` null →
non-null) still fires — `<>` against a null evaluates to null, which `when` treats as "do not
fire", the one case that must never be skipped.

`supabase/functions/coordinator/index.ts`: `sweep_expired`'s RPC error was discarded while
`sweep_matches`'s (three lines below) was surfaced as a 500. Made them consistent — capture and
surface `sweep_expired`'s error the same way, with a comment explaining why the swallow used to be
harmless and no longer is. `pair_queue_entries`'s error handling was left untouched, per the brief.

**Covering test** — `supabase/tests/social.test.ts`, new test `sweeps a lapsed, blocked, accepted
offer instead of raising through the whole tick`: builds the exact poisoned state (an `accepted`
`match_offers` row, `accepted_at` and `expires_at` in the past, proposer and `accepted_by` blocked
each other *after* the accept) via the superuser `sql()` connection, calls
`public.sweep_expired()` unguarded (an uncaught rejection fails the test on its own), then asserts
the row is now `state = 'lapsed'`.

**Remove-the-`when` experiment**: temporarily reverted the trigger to the bare
`before update ... execute function ...` (no `when`), ran `npm run db:reset`, then ran only the
new test in isolation:

```
cd app && npx vitest run --config vitest.db.config.ts -t "sweeps a lapsed, blocked, accepted offer"
```

Result: **FAILED**, exactly as predicted —

```
FAIL  ../supabase/tests/social.test.ts > friendships and blocks > sweeps a lapsed, blocked, accepted offer instead of raising through the whole tick
PostgresError: this offer is no longer available
```

Restored the `when` clause, ran `npm run db:reset` again, then the full `check:db` suite — 178/178
passed, EXIT=0. The test genuinely pins the fix.

## FIX 2 — revoke PUBLIC/anon/authenticated from `accept_offer_blocked_guard()`

Every other function added across Tasks 2 and 3 got `revoke all on function ... from public,
anon;` (or `public, anon, authenticated`) before its grant; `accept_offer_blocked_guard()` did
not, leaving a bare `=X/postgres` (PUBLIC) and `anon=X/postgres` on it. Not exploitable — a
trigger function cannot be called directly regardless of grant — but it broke the rule the rest of
the diff was built on. Added, in the same migration, right after the function definition:

```sql
revoke all on function public.accept_offer_blocked_guard() from public, anon, authenticated;
```

with a comment noting there is no role to grant it to (only Postgres invokes it, as the trigger
fires) and that the revoke changes nothing reachable today.

## FIX 3 — pin "skip, don't quarantine" for a blocked pair in the same queue group

The existing test (`never pairs two people who have blocked each other`) only proves ann and bob
don't pair with *each other*, using exactly two entries — a version of `pair_queue_entries()` that
gave up on the whole group on hitting a block would also pass it. Added a new test,
`skips a blocked pair without quarantining the third party sharing their group`: enqueues ann, bob
(blocked pair) and cal (unblocked) on the same league/`verified_hash`/`data_rev`, calls
`pair_queue_entries()` once via the superuser `sql()` connection (matching `pairing.test.ts`'s
`enqueue()` pattern, since `queue_entries` has a client-side `WITH CHECK (verified_hash is null)`
policy), and asserts: exactly one match was created, cal is one of its two parties, the other party
is ann or bob, and the remaining third party is still in `queue_entries`.

## Commands and real output

```
$ cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
... Applying migration 20260906002000_friend_codes_and_blocked_matchmaking.sql...
Finished supabase db reset on branch main.

$ cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  10 passed (10)
      Tests  178 passed (178)
 ✓ ../supabase/tests/offers.test.ts (21 tests) 421ms
 ✓ ../supabase/tests/social.test.ts (19 tests) 444ms
 ✓ ../supabase/tests/pairing.test.ts (26 tests) 1312ms

$ cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  86 passed (86)
      Tests  1221 passed (1221)
```

No "Test timed out in 5000ms" or "no Azumarill"/"no search result" lines appeared in `/tmp/app.log`
— no starvation on this run.

After the remove-the-`when` experiment, restored the fix and re-ran everything from a clean reset
to confirm nothing was left in a stale state:

```
$ cd app && npm run db:reset > /tmp/reset-restored.log 2>&1; echo "EXIT=$?"
EXIT=0

$ cd app && npm run check:db > /tmp/db-restored.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  10 passed (10)
      Tests  178 passed (178)
 ✓ ../supabase/tests/offers.test.ts (21 tests) 396ms
 ✓ ../supabase/tests/social.test.ts (19 tests) 403ms
 ✓ ../supabase/tests/pairing.test.ts (26 tests) 1162ms

$ cd app && npm run check > /tmp/app-restored.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  86 passed (86)
      Tests  1221 passed (1221)
```

`pairing.test.ts` and `offers.test.ts` stayed green throughout, both before and after the
remove-the-`when` experiment and restore.

## ACL verification

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('accept_offer_blocked_guard','blocked_between','pair_lo') order by 1;"

accept_offer_blocked_guard|postgres=X/postgres | service_role=X/postgres
blocked_between|postgres=X/postgres | service_role=X/postgres
pair_lo|postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
```

- `accept_offer_blocked_guard`: no bare `=X` (PUBLIC), no `anon`, no `authenticated`. Fixed.
- `blocked_between`: still has NO `authenticated` grant, as required — it stays unreachable
  directly, so a signed-in user cannot use it to probe whether two strangers have blocked each
  other.
- `pair_lo`: still carries the `authenticated` grant Task 3 added (needed by the RLS policy on
  `friend_codes`), untouched by this work.

`service_role=X/postgres` on all three is the local stack's baseline default privilege for new
functions (also present on `pair_queue_entries`/`sweep_expired` before this change) — not
something either the migration or this fix wave adds explicitly, and harmless since the coordinator
already runs as `service_role`.

## Files touched

- `/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260906002000_friend_codes_and_blocked_matchmaking.sql`
- `/Users/alilahrime/Downloads/paragon-iv/supabase/functions/coordinator/index.ts`
- `/Users/alilahrime/Downloads/paragon-iv/supabase/tests/social.test.ts`

## Concerns

None outstanding. All three fixes are covered by tests that were verified to actually fail without
the fix (FIX 1's `when` clause — confirmed by the remove-the-`when` experiment) or that assert the
specific behaviour the brief called out as untested (FIX 3). FIX 2 is a pure ACL tightening with no
behavioural test possible (a trigger function has no direct-call surface to test against), verified
instead by the `pg_proc.proacl` query above.
