# Task 3 report: a friend can see your friend code; a blocked stranger cannot reach you

## What changed

One new migration, one in-place edit to an unpushed migration, and test additions.

- **New:** `supabase/migrations/20260906002000_friend_codes_and_blocked_matchmaking.sql`
  (named per instructions, not the brief's `20260905132000`/`20260905133000`, which sort
  before migrations already deployed to production).
- **Edited in place:** `supabase/migrations/20260906000000_friendships_and_blocks.sql` —
  `revoke insert, update, delete on public.friendships from authenticated;` became
  `from anon, authenticated;`. Verified before touching it that this migration is not on
  `origin/main` (`git log origin/main..main` includes it; `main` is 3 commits ahead of
  `origin/main` and this migration is one of them), so editing in place rather than adding
  a corrective migration was correct.
- **Tests appended:** `supabase/tests/social.test.ts` — three new tests (friend-code
  visibility, queue block-skip, offer-accept block-refusal).

Nothing else was touched. `20260905124300` and earlier were not edited.

## The three corrections, as implemented

**(1) `pair_lo`/`pair_hi` grants.** Added
`grant execute on function public.pair_lo(uuid, uuid) to authenticated;` and the same for
`pair_hi`, with a comment explaining why an RLS `USING` clause needs its own grant even
when called only from inside code that is otherwise SECURITY DEFINER elsewhere in the
system — the querying role's own privileges are what get checked for a policy expression,
full stop. Verified below.

**(2) `accept_offer_blocked_guard` is `security definer set search_path = public`.**
Implemented exactly as instructed, not by granting `blocked_between` to `authenticated`.

My understanding of the distinction, since the brief asked me to state it: `blocked_between`
is itself SECURITY DEFINER and bypasses RLS to answer for *any* pair of uuids the caller
supplies — its whole safety property depends on it never being callable by
`authenticated` directly, because a client that could call it with two arbitrary stranger
IDs would have a working oracle for "has X blocked Y", which is precisely the detectability
the block design is built to prevent (the block itself has no read policy for the blocked
side at all, for the same reason). The trigger firing from `accept_offer`'s internal
`update ... set accepted_by = taker` needs to reach `blocked_between` regardless, so the
fix is to let the *trigger* run as the owner (`security definer` on
`accept_offer_blocked_guard` itself) rather than opening a grant on the function it calls.
The owner already has implicit rights to call functions it owns; no grant is added, and
`blocked_between` stays exactly as unreachable to `authenticated` as before this migration
(confirmed by the trap-verification query below).

**(3) `friendships` write-revoke includes `anon`.** Edited in place as instructed, with a
comment pointing at the `match_reports_and_rounds` precedent and noting this is
defence-in-depth, not a fix for a live hole (RLS default-denies `anon` on this table
regardless, since no policy grants it anything).

## A fourth issue found while implementing, not in the brief's three corrections

The brief's own test for the queue-blocking half inserts a `queue_entries` row as the
*client* (`asUser`) with `verified_hash` set directly in the `insert`:

```sql
insert into public.queue_entries (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
values ('great', '${v.id}', 'bb', 'bb', '[]'::jsonb, 'rev1')
```

`20260904071716_handshake_columns_are_server_only.sql` added a `WITH CHECK` on the
`queue_entries` "all" policy requiring `verified_hash is null` on any client-side write —
exactly the trust boundary `pairing.test.ts`'s own `enqueue()` helper works around by
inserting through the superuser `sql()` connection, not `asUser()`. The brief's test as
written would fail on the INSERT itself with a row-level-security violation, before
`pair_queue_entries()` is ever called — a different failure than the one the test is meant
to demonstrate. I rewrote the insert to use `sql()` (matching `pairing.test.ts`'s
established pattern), explicitly naming `user_id` since it defaults to `auth.uid()`, which
is null on that connection. I also widened the match-absence assertion from
`player_a in (...)` to `player_a in (...) or player_b in (...)`, since which of the two
blocked users the pairing scan visits first (and thus which becomes `player_a`) is not
guaranteed. Both changes are noted inline in the test.

## `pair_queue_entries()` rewrite — also a fifth deviation from the brief

The brief's rewritten function drops the `data_rev` equality check that the original
(`20260903005933_pairing_functions.sql`) enforced when choosing a partner. That check is
exactly what `pairing.test.ts`'s "does not pair two clients on different data builds" test
pins — dropping it would have turned that regression test red, which the task explicitly
forbade weakening or adjusting. I restored `and q.data_rev = a.data_rev` to the inner
partner search in my version, keeping the reasoning already on record in the old function
(quoted in my migration's comment): "a random draw both sides compute must deal from the
same pool."

Everything else about the rewrite matches the brief's shape: outer scan over verified,
unexpired entries in `created_at` order with `for update skip locked`; a guard against
re-visiting a row already consumed as someone else's partner earlier in the same loop
(`if not exists (select 1 from queue_entries where id = a.id) then continue`); an inner
search for the best remaining partner sharing hash/league/data_rev, excluding a blocked
pair via `not public.blocked_between(a.user_id, q.user_id)`, also under
`for update skip locked`. `create or replace function` preserves the existing grants
(`service_role` only) — checked against the same precedent already on record for
`confirm_offer` in `20260905124300`.

## Verification

### TDD

Wrote the three tests first, confirmed they failed for the right reasons before writing
the migration:

```
cd app && npm run check:db > /tmp/db_before.log 2>&1; echo "EXIT=$?"
EXIT=1
```

```
FAIL  social.test.ts > shows a friend code to an accepted friend and to nobody else
  AssertionError: expected [] to have a length of 1 but got +0     (no policy yet — correct)
FAIL  social.test.ts > never pairs two people who have blocked each other
  AssertionError: expected [ {…} ] to have a length of +0 but got 1  (block not enforced yet — correct)
FAIL  social.test.ts > lets an unblocked accept through and refuses a blocked one...
  AssertionError: promise resolved instead of rejecting              (no guard yet — correct)
Test Files  1 failed | 9 passed (10)
     Tests  3 failed | 173 passed (176)
```

173 baseline tests passing before the change, matching the stated starting point.

### After the migration

```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
```

`reset.log` shows `20260906002000_friend_codes_and_blocked_matchmaking.sql` applying
cleanly after `20260906001000`, ending `Finished supabase db reset on branch main.` /
`Reset local database.`

### The two-trap verification (exact command, exact output)

```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select 'pair_lo' fn, has_function_privilege('authenticated','public.pair_lo(uuid,uuid)','execute') ok union all select 'pair_hi', has_function_privilege('authenticated','public.pair_hi(uuid,uuid)','execute') union all select 'blocked_between(anon-must-be-f)', has_function_privilege('authenticated','public.blocked_between(uuid,uuid)','execute');"
```

```
pair_lo|t
pair_hi|t
blocked_between(anon-must-be-f)|f
```

Both traps closed exactly as expected: `pair_lo`/`pair_hi` executable by `authenticated`
(TRUE), `blocked_between` still not (FALSE) — the block-detector oracle stays closed even
though the queue and offer paths both now call it internally as the owner.

### `check:db`

```
cd app && npm run check:db > /tmp/db_after.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
✓ ../supabase/tests/social.test.ts (17 tests) 411ms
✓ ../supabase/tests/pairing.test.ts (26 tests) 1298ms
Test Files  10 passed (10)
     Tests  176 passed (176)
```

176/176 — 173 baseline + 3 new. `pairing.test.ts` is fully green, all 26 tests, including
both concurrency-race tests ("skips rows another tick already holds, rather than blocking
on them" and "never turns two entries into two matches when two ticks overlap"). Ran it a
second time in isolation for extra confidence on the timing-sensitive tests:

```
cd app && npx vitest run --config vitest.db.config.ts -t pairing
EXIT=0
✓ ../supabase/tests/pairing.test.ts (26 tests) 1909ms
Test Files  1 passed | 9 skipped (10)
     Tests  26 passed | 150 skipped (176)
```

### `check` (full app gate)

```
cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
Test Files  85 passed (85)
     Tests  1220 passed (1220)
```

1220/1220, no timeouts observed (no "Test timed out" lines in the log), so no contention
caveat to report this run.

## Concerns / things I'm not fully certain of

- The `accept_offer_blocked_guard` trigger also fires on `confirm_offer`'s own `update`
  (state → `converted`, `accepted_by` unchanged but still non-null on that row). This means
  a block placed *after* acceptance but *before* confirmation will now also stop the
  confirm from converting into a match, refused with the same "no longer available"
  message. Nothing in the brief or the corrections asked for this, but nothing in the
  existing test suite exercises that window either way, so it neither broke anything nor
  was it something I added a test for. Flagging it as an intentional side effect of where
  the trigger sits (`before update on match_offers`, not scoped to a particular state
  transition) rather than a deliberate design decision on my part — worth a second look if
  a later task cares about exactly when a block can still interrupt a scheduled offer.
- I did not add a migration-level test asserting `pair_queue_entries`'s grants are
  unchanged after `create or replace` (i.e., that `anon`/`authenticated` still get
  `permission denied`) — that invariant is already covered by
  `pairing.test.ts`'s "runs the coordinator functions as service_role and refuses everyone
  else" test, which passed unchanged, so I relied on that existing coverage rather than
  duplicating it.
- I widened one assertion and rewrote one insert in the brief's own test text (documented
  above as a "fourth issue" and restored a `data_rev` check the brief's rewrite silently
  dropped (documented as a "fifth deviation"). Both were necessary for the suite to pass at
  all and for `pairing.test.ts` to stay green; neither weakens an assertion — the widened
  one is strictly more correct (checks both `player_a` and `player_b`), and the restored
  `data_rev` check is a regression the existing `pairing.test.ts` test would have caught
  had it run before the queue rewrite went in.

## Commit

Not yet committed at the time of writing this report — see the parent conversation for the
commit SHA once it lands. Diff is: `20260906000000_friendships_and_blocks.sql` (one-line
edit), `20260906002000_friend_codes_and_blocked_matchmaking.sql` (new), and
`supabase/tests/social.test.ts` (three tests appended).
