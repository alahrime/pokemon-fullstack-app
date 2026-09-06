# M3b final fix wave — pre-push review corrections

Applied to the four unpushed migrations (`20260907000000`–`20260907004000`, edited
in place — none has touched production), `supabase/functions/coordinator/index.ts`,
`docs/superpowers/HANDOFF.md`, and `supabase/tests/channels.test.ts`.

## FIX 1 (CRITICAL) — block enforcement bypassable via UPDATE

**File:** `supabase/migrations/20260907003000_messages.sql`

Three changes:

1. **WITH CHECK widened.** "an author may edit or soft-delete their own message"
   now also requires `is_channel_member(channel_id)` and the same
   `blocked_with_me` not-exists clause the INSERT policy uses — moving a
   message into a channel is a post, and must clear the same gate a post does.

2. **Immutability trigger.** RLS's WITH CHECK can only inspect the proposed NEW
   row; it cannot compare it to OLD. Added `messages_protect_columns()`, a
   `BEFORE INSERT OR UPDATE` trigger that:
   - on UPDATE, raises if `channel_id`, `author_id`, `created_at`, or
     `expires_at` differ from OLD;
   - on INSERT, unconditionally forces `expires_at := now() + interval '7
     days'`, ignoring anything the client supplied.

   **Not `security definer`, on purpose, after a live correction.** I first
   wrote it security definer (matching the brief's suggested pattern) and
   revoked EXECUTE from all three roles. That broke immediately: inside a
   SECURITY DEFINER function, `current_user` is the function's *owner*
   (`postgres`) for the whole call, not the querying role — confirmed live by
   watching the role-scoping guard (see below) always short-circuit
   regardless of who fired the UPDATE. This function calls no other table and
   no revoked function, so it needs no elevated privilege at all; switching
   it to security invoker (the default) fixed the role check and cost
   nothing, matching the precedent of `freeze_format_version()` in
   `20260902044726_formats.sql`, which is also plain invoker.

   **Scoped to `current_user = 'authenticated'`.** Without this, the trigger
   also blocked the test suite's own pattern of moving `expires_at` into the
   past as the `postgres` role to simulate a message aging out — a legitimate
   test-setup write, not the attack. PostgREST always executes a signed-in
   client's query as `authenticated`; nothing reachable from a real client
   runs as any other role, so scoping the guard this way closes the gap for
   every real caller while leaving server-side/test maintenance alone. (First
   attempt without this guard broke three pre-existing tests —
   `deletes an expired message...`, `keeps a pinned message...`,
   `holds a reported message...` — confirmed by running `check:db` and
   reading the failures before adding the scope.)

   `expires_at` forced via the same trigger rather than a column-level INSERT
   revoke: a column revoke would require re-granting every *other* column
   back to `authenticated` for inserts to keep working — more surface for a
   future migration to get wrong than one branch in one function.

## Tests (FIX 1)

Added to `supabase/tests/channels.test.ts`, all via `asUser` (a real
`authenticated` role, not `postgres`):

- `refuses the five-step attack that moved a message into a blocked DM via
  UPDATE` — reproduces all five steps (block, refused direct insert, solo
  group via empty-array `create_group`, staged message, refused UPDATE-move)
  and asserts the message's `channel_id` never changed and the DM stays
  empty.
- `refuses an author changing expires_at on their own message`.
- `ignores a caller-supplied expires_at at INSERT time and forces seven
  days`.
- `still lets an author edit body and soft-delete their own message` (the
  legitimate path stays open).

### The revert experiment (as required)

1. Restored `20260907003000_messages.sql` to its pre-fix (`git show HEAD:...`)
   content — the original single-column WITH CHECK, no trigger.
2. `npm run db:reset` (exit 0), then ran just
   `./node_modules/.bin/vitest run --config vitest.db.config.ts
   ../supabase/tests/channels.test.ts` directly (skipping `db:start` since the
   stack was already up).
3. Result: **3 failed, 27 passed.** The three FIX 1 tests failed exactly as
   expected:
   - the five-step attack: `expected this statement to be refused, and it
     SUCCEEDED` — the message really did move into the blocked DM.
   - expires_at UPDATE: same `SUCCEEDED` failure — the author changed
     `expires_at` freely.
   - expires_at at INSERT: `expected 365.00... to be less than 7.1` — the
     client-supplied year-long expiry was honored.
   All other tests (including the FIX 2/3/4 tests added below, in other
   files) still passed, confirming the failures were isolated to what FIX 1
   changed.
4. Restored the fixed file (`diff` against the pre-revert copy: identical).
5. `npm run db:reset` (exit 0) → `npm run check:db` (exit 0): **210/210**,
   all green again.

## FIX 2 (IMPORTANT) — same defect on channel_members

**File:** `supabase/migrations/20260907000000_channels_and_members.sql`

The "you may move your own read position" policy constrains *which row*
(`user_id = auth.uid()`), never *which column* — with no column grants, the
owner could rewrite `channel_id` (rejoining any group they left, including
one manufactured by FIX 1's empty-array `create_group`) or `role` (self-promote
to owner).

Chose **column-level grants** over a trigger (the approach used for
`messages`, which needs more than one column touchable): the only legitimate
update here is `last_read_at`, so naming exactly that column is a smaller,
harder-to-drift surface than a trigger's deny-list.

```sql
revoke update on public.channel_members from authenticated;
grant update (last_read_at) on public.channel_members to authenticated;
```

**Test added:** `refuses to move a membership row to another channel, but
last_read_at still updates` — asserts the `channel_id` move is refused
(`PRIVILEGE_DENIED`, i.e. "permission denied for table channel_members" —
column-level UPDATE grants surface exactly that class of error) and the row
is unchanged, then confirms `last_read_at` still updates for the same user.

## FIX 3 (IMPORTANT) — leave_channel destroying open moderation reports

**File:** `supabase/migrations/20260907001000_channel_functions.sql`

Removed the "last person out deletes the channel" block from `leave_channel`.
Chose **never delete** over the conditional (only-delete-if-nothing-open)
alternative: an empty channel is one row, visible to nobody
(`is_channel_member` has no members left to satisfy it), and every message in
it is still cleared on schedule by `sweep_messages()` per that message's own
expiry/pin/report state. That is cheaper and safer than a conditional delete
that has to correctly enumerate every reason a message might need to survive
— and it is presented as an equally acceptable option in the brief.

**Test added:** `keeps a reported message, its report, and the channel alive
through report-then-both-leave` — two-person group, one member posts, the
other reports then leaves, the poster leaves last (emptying the channel);
asserts the channel, the message, and the report all still exist afterward.

## FIX 4 (IMPORTANT) — resolved report with null resolved_at

**File:** `supabase/migrations/20260907004000_pins_and_reports.sql`

Added `constraint message_reports_resolved_consistent check ((state =
'resolved') = (resolved_at is not null))` to `message_reports`.

**Test added:** `refuses a message_reports row where state and resolved_at
disagree` — asserts both `state='resolved'` with no `resolved_at`, and a bare
`resolved_at` with `state` left `'open'`, are refused
(`message_reports_resolved_consistent`), and the consistent pair still
succeeds.

## FIX 5 (IMPORTANT) — coordinator swallowing pair_queue_entries' error

**File:** `supabase/functions/coordinator/index.ts`

```ts
const { data: paired, error: pairError } = await admin.rpc('pair_queue_entries');
if (pairError) return new Response(pairError.message, { status: 500 });
```

surfaced exactly like `sweep_expired`, `sweep_matches`, `sweep_messages`
below it. Rewrote the comment above it, which used to say "unlike `paired`
above (pre-existing, left alone)" — now false — to instead explain the new
raise path M3b introduced: `pair_queue_entries`'s own `insert into
public.matches` is exactly the statement
`20260907002000_match_channel_trigger.sql` attached an AFTER INSERT trigger
to (`create_match_channel`, itself inserting into `channels` and
`channel_members`), so a failure there now propagates out of
`pair_queue_entries()`'s transaction and rolls back the match — previously
this call had no raise path at all, so ignoring its error cost nothing; now
it does.

**Doc updated:** `docs/superpowers/HANDOFF.md` — "both calls ... NOT
swallowed" (which only ever named `sweep_matches`/`sweep_messages`, already
stale since it never counted `sweep_expired`) rewritten to name all four:
`pair_queue_entries`, `sweep_expired`, `sweep_matches`, `sweep_messages`.

No migration needed for this fix (edge function + doc only).

## Verification

```
$ npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0

$ npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
Test Files  11 passed (11)
     Tests  210 passed (210)
 ✓ ../supabase/tests/pairing.test.ts (26 tests)
 ✓ ../supabase/tests/offers.test.ts (21 tests)

$ npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
Test Files  89 passed (89)
     Tests  1256 passed (1256)
(includes verify:coordinator-bundle, which ran clean)
```

210 (was 203) = 203 + 7 new tests (3 for FIX 1's attack/expires_at-UPDATE/
expires_at-INSERT, 1 for FIX 1's "legitimate edit still works", 1 for FIX 2,
1 for FIX 3, 1 for FIX 4).

Waited well over 60 seconds after the last `db:reset` before the roundtrips —
satisfied naturally by running the full `npm run check` (tsc + oxlint + 1256
vitest tests, several minutes) in between, rather than a bare `sleep`.

### Roundtrips

```
$ KEY=$(npx supabase status --workdir .. 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
$ DEF='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
$ for t in m2b m3a m3b; do ...; done
m2b EXIT=0 :: 11 passed, 0 failed
m3a EXIT=0 :: 9 passed, 0 failed
m3b EXIT=0 :: 13 passed, 0 failed
```

All three match the quiet-machine baseline exactly (11/11, 9/9, 13/13), all
exit 0, no esbuild warnings.

## Files changed

- `supabase/migrations/20260907000000_channels_and_members.sql` (FIX 2)
- `supabase/migrations/20260907001000_channel_functions.sql` (FIX 3)
- `supabase/migrations/20260907003000_messages.sql` (FIX 1)
- `supabase/migrations/20260907004000_pins_and_reports.sql` (FIX 4)
- `supabase/functions/coordinator/index.ts` (FIX 5)
- `docs/superpowers/HANDOFF.md` (FIX 5's doc correction)
- `supabase/tests/channels.test.ts` (new tests for FIXes 1–4)

## Concerns / things worth a second look

- FIX 1's WITH CHECK widening (membership + block clause) is, in practice,
  never the thing that actually fires for a `channel_id` change: the
  immutability trigger runs first (confirmed live — a channel_id change
  raises the trigger's own exception even in a control case engineered so
  WITH CHECK would otherwise pass) and always wins the race for that
  specific column. It is still correct to have both — defense in depth if
  the trigger is ever weakened or removed — but be aware the WITH CHECK
  addition is currently unreachable dead-weight for the one case it was
  named for; it does still matter on its own if `is_channel_member`/blocked
  status ever needs re-checking for some other future UPDATE path that
  doesn't touch `channel_id`.
- FIX 3's choice (never delete an empty channel) means abandoned two-person
  groups accumulate as permanent zero-row-membership `channels` rows. This
  was an explicit, offered-as-acceptable tradeoff in the brief and costs
  essentially nothing (unreadable, unreferenced rows), but it is a small,
  permanent bit of table growth that a future migration might want to sweep
  separately if it ever becomes material.
- Did not add a test asserting `role` specifically cannot be changed on
  `channel_members` (only `channel_id`, as the brief's example, plus
  `last_read_at` working) — the column-level grant makes any non-`last_read_at`
  column equally unwritable, so `channel_id` failing is representative, but
  flagging in case an explicit `role` test was wanted too.
