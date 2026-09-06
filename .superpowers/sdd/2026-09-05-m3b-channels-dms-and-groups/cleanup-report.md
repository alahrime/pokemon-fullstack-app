# M3b cleanup pass — 2026-09-08

Four deferred items from the completed M3b milestone, cleared on `main`. Repo root
`/Users/alilahrime/Downloads/paragon-iv`. All work measured on a quiet machine except where noted.

---

## FIX 1 — `subscribeToChannel` surfaces its join status; `m3b-roundtrip.ts` check 3 awaits it

**Problem.** `app/src/lib/channels.ts`'s `subscribeToChannel` gave no way to know when the
underlying Realtime subscription had actually joined. `app/tools/m3b-roundtrip.ts` check 3 — the
only thing in the project proving the `supabase_realtime` publication is wired — slept a fixed
1500ms before sending and hoped the join had finished by then. That produced a false FAILURE after
`npm run db:reset` restarts the realtime container (join takes longer than 1500ms right after a
reset) and could, in principle, produce a false PASS the other way if the join happened to be slow
enough that the send raced ahead of a *stale* subscription from a previous test iteration.

**Fix.** `subscribeToChannel(channelId, onMessage, onStatus?)` — a third, optional argument that
receives Supabase's own `.subscribe()` status (`SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED`).
Additive: the return type is unchanged (still just the teardown function), so `ChatScreen.tsx`'s
`const stop = subscribeToChannel(...)` needed no change at all. The idempotent-teardown contract
(`stopped` flag closing over the specific subscription this call opened) is untouched.

`m3b-roundtrip.ts` check 3 now builds a `joined` promise that resolves on the first `SUBSCRIBED` and
rejects on `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`, races it against its own 10-second timeout, and only
sends bot1's message once `joined` resolves. The message-delivery budget is untouched — still a
separate 5-second race, unchanged in shape or wording.

**Files:**
- `app/src/lib/channels.ts` — `subscribeToChannel` signature and doc comment.
- `app/src/lib/__tests__/channels.test.ts` — two new tests: `onStatus` receives `.subscribe()`'s
  callback verbatim, and omitting `onStatus` does not throw (`onStatus?.(...)`, not `onStatus(...)`).
- `app/tools/m3b-roundtrip.ts` — check 3 rewritten to await `joined`; file header comment updated
  (the "two-client trick" section was already accurate and untouched).
- `docs/superpowers/HANDOFF.md` — "Known operational quirk" note updated to say the fix landed.

**Verification.**
```
cd app && npx vitest run src/lib/__tests__/channels.test.ts
✓ 18 tests passed (was 16; +2 new)
```
Full roundtrip, run against the LOCAL stack minutes after `npm run db:reset` (see FIX 4's db:reset
below) and again on a second run:
```
m3b EXIT=1 :: failed: 3. THE CHECK THIS SCRIPT EXISTS FOR...   (first attempt, see below)
m3b EXIT=0 :: 13 passed, 0 failed                               (immediate re-run)
m3b EXIT=0 :: 13 passed, 0 failed                               (clean joint run with m2b/m3a)
```
The one failure is discussed under "Concerns" below — it was check 3's own 5-second **delivery**
budget, not the join wait, and check 3's own PASS line on every other run confirms the join is now
awaited, not slept:
```
PASS  3. THE CHECK THIS SCRIPT EXISTS FOR: bot1 sends into the DM; bot2's live subscribeToChannel delivers it within 5s
        subscribeToChannel reported SUBSCRIBED before bot1 sent (awaited, not slept); bot1 sent message
        <id> on a second client; bot2's subscribeToChannel delivered it live, well under 5s (author <id>)
```

**Answering the brief's own verification question directly:** yes, check 3 now waits on a real
`SUBSCRIBED` signal rather than a fixed sleep, and yes, the roundtrip passed immediately after this
session's own `npm run db:reset` (run within the same terminal session, well inside the "give it a
minute" window, and it passed on the very next attempt after one transient failure — see Concerns).

---

## FIX 2 — ChatScreen: Report hidden on own/deleted messages, `reportedIds` cleared per channel, `window.prompt` replaced

**Three independent bugs, one file (`app/src/screens/ChatScreen.tsx`):**

1. **Report rendered on your own messages and on already-deleted ones.** Both are meaningless
   (reporting yourself; reporting a message nobody can read). Fixed with a single `canReport = !isOwn
   && !m.deletedAt` gate, computed per message from `useSession().user?.id === m.authorId` — the same
   identity source `FriendsScreen` reads. Applies to all three renders of the report control (the
   plain button, the open reason form, and the "Reported" marker) so a deleted or own-authored row
   shows literally nothing in that slot.

2. **`reportedIds` leaked across channel switches.** It is local UI state, not a server fact, so it
   is now reset (along with the open-report-form state) in the same effect that already resets
   `messages`/`threadError` when `selectedId` changes.

3. **`window.prompt()` replaced with an in-panel form** (`.chat-report-form`, new CSS in
   `app/src/styles/components.css`, modelled on `FriendsScreen`'s `.friend-search-row`: flex row,
   `var(--space-2)` gap, `.input` reused for the reason field, `.btn btn-primary` / `.btn btn-ghost`
   for submit/cancel — no literal px anywhere). Clicking "Report message `<id>`" opens the form in
   place; Submit calls `reportMessage` and shows "Reported"; Cancel discards the draft. Every control
   keeps the message id in its `aria-label` (`Report message m1`, `Report reason for message m1`,
   `Submit report for message m1`, `Cancel report for message m1`) so a screen reader can tell one
   row's controls from another's — the exact requirement that already bit `FriendsScreen`.

**Tests added/rewritten** (`app/src/screens/__tests__/chat-screen.test.tsx`, 7 → 11 tests):
- `never renders a Report control on a deleted message`
- `opens an inline reason form, submits it, and shows Reported afterwards` (replaces the
  `window.prompt` version)
- `does not submit a report while the reason field is empty`
- `closes the reason form without reporting when Cancel is clicked` (replaces the "cancelled prompt"
  version)
- A new `describe` block with a real signed-in session (the same `fakeClient`/`vi.resetModules()`
  harness `team-saves.test.tsx` and `matchmaking.test.tsx` already use, since `renderApp`'s own
  `SessionProvider` settles signed-out for the whole suite):
  - `never renders a Report control (button or "Reported") on the viewer's own message`
  - `clears the "Reported" marker when the open channel changes and changes back`

**Verification.**
```
cd app && npx vitest run src/screens/__tests__/chat-screen.test.tsx
✓ 11 tests passed
```

---

## FIX 3 — stale coordinator-health counts in `docs/superpowers/HANDOFF.md`

Measured against `supabase/functions/coordinator/index.ts` (the actual source of truth): all FOUR
RPCs — `pair_queue_entries`, `sweep_expired`, `sweep_matches`, `sweep_messages` — return their error
as an HTTP 500 today; none is swallowed. Two places in `HANDOFF.md` disagreed with that:

1. **Line ~122** ("Two deferred items worth knowing"), dated the 2026-09-06 M3a session: claimed
   "the coordinator still swallows `pair_queue_entries`'s error." False as of M3b — the trigger
   `create_match_channel` gave that call a new raise path, and `coordinator/index.ts`'s own comment
   says it is "No longer swallowed." Struck through and marked fixed, with a pointer to "Deploying
   M2a" (which already correctly named all four). The Friends-screen-raw-uuid item beside it is still
   true and left as-is.

2. **Line ~226** (the 2026-09-05 "prove the coordinator ticks" note): said a `500` "means the
   `sweep_matches` or `sweep_messages` RPC itself errored" — only two of the four, silently written
   before `pair_queue_entries` and `sweep_expired` were surfaced. Since an operator debugging a 500
   today would read this and look only at two of the four possible causes, it is corrected to name
   all four and point at "Deploying M2a" for the full reasoning.

The "Deploying M2a" section itself (the canonical reference, ~line 563-568) already correctly named
all four — that section did not need a fix, only the two stale echoes of it above did.

**Files:** `docs/superpowers/HANDOFF.md` only. No code changed for this item.

---

## FIX 4 — group/match block no longer mutes the whole room

**The bug, measured against the deployed policy** (`20260907003000_messages.sql`'s "a member who is
not blocked may post"): the INSERT policy's `not exists` clause scans EVERY other member of the
channel and refuses the insert if ANY ONE of them has blocked the poster. The existing SQL comment
calls this "directional" and contrasts it with a symmetric rule that would mute the *blocker* to the
whole room — true, but it never noticed the mirror-image bug it actually shipped: the *blocked*
party is refused for the WHOLE channel, not just relative to whoever blocked them. In an 8-person
group, one person blocking you silences you to the other seven, with no explanation. The existing
test `supabase/tests/channels.test.ts` ("keeps a block directional in a group…") already pinned this
exact behaviour as intentional; it needed rewriting, not just the policy.

**Reasoning, in full (also recorded in the migration's own comment).** RLS cannot deliver "everyone
in the room sees this except the one person who blocked the author" at INSERT time — a row is
inserted once, as a single yes/no decision, with no way to branch per future reader. Three shapes
were considered:

- **(a) Leave it.** Rejected — this is the bug, and it scales *worse* as the group grows: the bigger
  and more valuable the room, the more collateral damage one unrelated block does to it.
- **(b) Drop the block check entirely for `group` and `match` channels; a block only bites in a DM and
  in matchmaking.** IMPLEMENTED.
- **(c) Move the block's effect from the writer's INSERT to each reader's own SELECT** — add a
  per-viewer clause so a member who blocked (or was blocked by) the author simply does not see that
  author's rows, while everyone else's view is untouched. This is the one shape of "affects only the
  pair" that RLS *can* actually express (SELECT evaluates once per querying role; two members
  legitimately seeing different transcripts is exactly what a `using` clause is for). Seriously
  considered and **rejected for this fix**: it turns one channel into an inconsistent object
  depending on who's asking — `listMessages` ordering, unread counts built on
  `channel_members.last_read_at`, and "N messages in this channel" would all silently disagree
  between two members who are both, correctly, allowed to be there. That's a real feature (does a
  block hide only future messages or the whole history? does the hidden party's own view get
  distorted?) deserving its own deliberate design pass, not a rider on a bug-fix migration.

**Why (b) over (a):** (b) is strictly better for everyone NOT involved in the block (they keep the
member's voice, where (a) took it from them for no reason of their own) and no worse for the two who
ARE involved — the blocker already had unfiltered read access to the blocked party's messages under
the *old* "directional" rule (the SELECT policy has never had a block clause), so (b) exposes them to
nothing new. (b) also makes INSERT consistent with SELECT's existing behaviour on this table, rather
than maintaining two incompatible ideas of what a block means depending on which end of the pipe you
look from.

**What's unchanged:** DM behaviour (symmetric, total — Ruling B10) is untouched, enforced by the same
`blocked_with_me`/`i_blocked` pair, now inside the new policy's `kind = 'dm'` branch. Matchmaking's
own block enforcement (`pair_queue_entries`'s `blocked_between` exclusion,
`accept_offer_blocked_guard`) is a separate code path, not touched at all. The `messages` UPDATE
policy (editing/soft-deleting your own message) still runs `blocked_with_me` unconditionally across
every channel kind — a narrower, pre-existing inconsistency (editing history vs. speaking to people
who never blocked you) explicitly left as a known follow-up rather than silently widened here.

**Migration:** `supabase/migrations/20260908000000_group_and_match_blocks_stop_muting_the_whole_room.sql`
— drops and replaces the messages INSERT policy. No new function, so no new
`revoke ... from public, anon, authenticated` triple was needed (reuses `blocked_with_me`/`i_blocked`,
already granted).

**Tests updated** (`supabase/tests/channels.test.ts`):
- Rewrote `keeps a block directional in a group...` → `lets everyone in a group keep posting after a
  block between two of its members, in either direction` (asserts all three members' inserts
  succeed, and reads back the three message bodies in order).
- Added `lets a MATCH channel keep working after a block between its two players, in either
  direction`.

**Docs updated for truth** (every comment must describe the code it sits above):
- `docs/superpowers/HANDOFF.md`'s "Two product rulings" bullet, which asserted the old (buggy)
  directional-in-groups behaviour as the settled design — rewritten to describe the actual fix and
  why the original reasoning missed the mirror-image bug.
- `app/tools/m3b-roundtrip.ts`'s file header (the paragraph explaining check 8's DM-symmetric
  assertion) — its closing sentence about groups/match channels being "unaffected" under the old
  directional rule was no longer true; rewritten to describe the new no-block-effect behaviour and
  point at the new migration.

**Verification.**
```
cd app && npm run db:reset          # applies 20260908000000 cleanly, no errors
cd app && npm run check:db          # EXIT=0, 213/213 (was 212; +1 net: rewrote 1, added 1)
```

---

## Final gate runs

```
cd app && npm run check
```
Ran six times across this session while iterating (channels.ts/ChatScreen changes landed early,
HANDOFF.md/migration landed later — full-suite runs after ALL four fixes were in place are what's
reported here). Every failure across every run was a `Test timed out in 5000ms` in a file this
session never touched (`team-saves.test.tsx`, `team-builder.test.tsx`, `interactions.test.tsx`,
`screen-controls.test.tsx` — heavy TeamBuilder/CoresScreen renders), never in `channels.ts`,
`ChatScreen.tsx`, or their tests — textbook machine starvation per this repo's own operating notes,
not a regression. Two runs, as required:
```
Run (post db:stop, quieter machine): EXIT=0  — Test Files 89 passed (89), Tests 1262 passed (1262)
Run (immediately before it, DB still up): EXIT=1 — Test Files 87 passed (89), Tests 1260 passed (1262)
                                                     (2 unrelated timeouts: interactions.test.tsx,
                                                     screen-controls.test.tsx, both CoresScreen renders)
```
1262 ≥ 1259 (was 1256; +6 from this session: 2 in `channels.test.ts`, 4 net in `chat-screen.test.tsx`).

```
cd app && npm run db:reset && npm run check:db
```
EXIT=0, 213/213 (was 212; +1 net in `supabase/tests/channels.test.ts`).

Three roundtrips, run more than a minute after the `db:reset` above:
```
m2b EXIT=0 :: 11 passed, 0 failed
m3a EXIT=0 :: 9 passed, 0 failed
m3b EXIT=0 :: 13 passed, 0 failed          (clean joint run, reported to the user)
```
One earlier m3b attempt (run back-to-back with several `npm run check` invocations still competing
for the machine) failed at check 3's 5-second **delivery** race, not the join wait — see Concerns.

---

## Concerns

- **One transient m3b-roundtrip failure during this session**, at check 3's message-delivery race
  (not the join wait — the PASS line's own text, `subscribeToChannel reported SUBSCRIBED before bot1
  sent`, only appears when the join succeeded first). It happened while several `npm run check` runs
  and the local Supabase stack were all competing for the same machine at once — the same starvation
  this repo's own operating notes warn about, just landing on the roundtrip's 5-second budget instead
  of a vitest timeout. The very next attempt, and a subsequent clean joint run of all three
  roundtrips, both passed. Not treated as a regression, but flagged rather than quietly re-run until
  green: FIX 1 makes the JOIN wait deterministic, it does not (and was never asked to) make the
  actual Postgres→Realtime WAL delivery path immune to a starved machine.
- **The `messages` UPDATE policy's block check is now inconsistent with the INSERT policy** in a
  group/match channel (INSERT ignores blocks there; UPDATE/soft-delete still enforces
  `blocked_with_me` unconditionally). Documented as a deliberate, narrow follow-up in the new
  migration's own comment rather than fixed here — the brief scoped FIX 4 to the INSERT policy
  specifically, and widening UPDATE too would have meant touching a second policy's behaviour without
  it being asked for.
- Per the constraints, migrations `20260907004000` and earlier were never touched; the only new file
  is `20260908000000_group_and_match_blocks_stop_muting_the_whole_room.sql`.
