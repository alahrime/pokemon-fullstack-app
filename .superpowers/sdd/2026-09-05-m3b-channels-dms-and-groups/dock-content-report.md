# Dock content fix — report

## What was wrong (recap)

Measured from the live DOM: the rail rendered `Direct message` with no name,
a raw ISO timestamp with microsecond precision, and a raw channel uuid — all
three concatenated into one string that also happened to be the button's
entire accessible name.

## What changed

### `app/src/lib/channels.ts`

- **`resolveDisplayNames(ids: string[]): Promise<Map<string, string>>`** —
  `profiles` by id, one `IN` query no matter how many ids, deduped. Shared
  helper: both `withDisplayNames` (below) and `FriendsScreen` call this same
  function.
- **`withDisplayNames(channels: ChannelActivity[]): Promise<ChannelDisplay[]>`**
  — attaches `displayTitle` and `memberCount` to every channel.
  - Query 1: `channel_members` filtered with one `.in('channel_id', [...])`
    across every channel passed in, `select('channel_id, user_id')`.
  - Query 2: `resolveDisplayNames()` on the distinct set of "other" member
    ids that turns up (skipping `group` channels, which use their own
    `title` instead of a member's name).
  - **Exactly two queries total, regardless of channel count** — proven by
    a dedicated test (`costs exactly two queries total, regardless of how
    many channels are passed`) that passes three channels and asserts
    exactly one `channel_members` `.in()` call and one `profiles` `.in()`
    call.
  - `dm`/`match` → the other member's `display_name`, or `FALLBACK_TITLE`
    (`Direct message` / `Match chat`) when unresolvable. `group` → its own
    `title`, or `Group` if null, plus `memberCount` (total member rows).
- **`humanTime(iso: string, now: Date = new Date()): string`** — four
  buckets: clock time (`19:04`) for today, `yesterday`, a weekday name for
  2–6 calendar days back, else a short date (`Aug 20`). Calendar-day math,
  not a raw 24h divide (handles the midnight-boundary case correctly).
  Never emits an ISO string or microseconds — a dedicated test feeds it the
  exact `2026-09-07T00:35:13.94682+00:00` string from the bug report and
  asserts neither `94682` nor a `T\d\d:\d\d:\d\d` pattern survives.

### `app/src/components/ChatDock.tsx`

- `refresh()` now chains `listChannelsWithActivity().then(withDisplayNames)`
  before `setChannels`, so both the initial load and every `POLL_MS` (15s)
  poll carry resolved names.
- Rail row now renders `c.displayTitle` (never `channelLabel`'s
  title-less fallback, never the uuid) and a `subLine(c)` sub-line: kind
  word (`direct`/`group`/`match`) + either `humanTime(lastMessageAt)` or,
  for a group, `"N people"`.
- Rail button now carries `aria-label={railAriaLabel(c, unread)}` —
  `"Open chat with Ally"` or `"Open chat with Ally, 1 unread"` — instead of
  exposing the concatenation of its child text nodes as its accessible
  name. The "Unread" tag is now `aria-hidden` (redundant with the label).
- Removed the dead `channelLabel` import and the old `kindWord` (`DM`/
  `Match`/`Group`) in favor of the design canvas's lowercase words
  (`direct`/`match`/`group`).
- `ChatPane.tsx` was deliberately left untouched — its own header/controls
  still use `channelLabel`'s generic kind-based text, which is a separate
  concern from the rail's uuid/timestamp defect the brief measured, and
  touching it would have widened the diff and the test surface for no
  requested behavior change.

### `app/src/screens/FriendsScreen.tsx`

- Applied the same helper (`resolveDisplayNames`, imported from
  `lib/channels.ts`) to close the identical defect here: every row (`incoming`,
  `outgoing`, `accepted`, `blocked`) previously rendered `f.otherId`/`id` — a
  uuid — as both visible text and inside its own button's accessible name
  (`Accept 9f2c…`).
- `load()` now makes **one** batched call —
  `resolveDisplayNames([...f.map(x => x.otherId), ...b])` — covering every id
  on the screen at once, not one profile lookup per row.
- Added `nameFor(id)` returning the resolved name or `UNKNOWN_TRAINER`
  (`"Unknown trainer"`) — the honest, human fallback, never the uuid.
- Every row's visible `<span>` and every mutation button's label
  (`Accept`/`Decline`/`Withdraw`/`Remove`/`Block`/`Unblock`) now reads
  `nameFor(id)` instead of the raw id. Per-row accessible-name uniqueness is
  preserved wherever the underlying friends have distinct display names
  (unchanged shape — `Remove Buddy` is exactly as unique as `Remove mate`
  was).

## Query cost of name resolution

- **`ChatDock`**: `withDisplayNames` adds **2 queries** per refresh
  (`channel_members` `IN`, then `profiles` `IN`) on top of
  `listChannelsWithActivity`'s existing 2 queries (`channels`, `messages`) —
  4 total per poll cycle, still independent of how many channels exist.
- **`FriendsScreen`**: `resolveDisplayNames` adds **1 query** (`profiles`
  `IN`) per `load()`, covering every id on the screen — no change to
  `listFriends`/`listBlocks`'s existing query count.
- Neither is N+1: proven directly by the `costs exactly two queries total,
  regardless of how many channels are passed` test (3 channels, still 1+1
  queries) and by `resolveDisplayNames`'s own de-dup test.

## Tests added

`app/src/lib/__tests__/channels.test.ts` (channels.test.ts total: 41 tests,
up from 29):
- `resolveDisplayNames`: batches into one `IN` query, de-dupes, empty input
  short-circuits with no query, unmatched id absent from the map.
- `withDisplayNames`: dm shows the other member's name; match shows the
  opponent's name the same way; group shows its title + member count;
  unresolvable dm degrades to `Direct message`, never a uuid; exactly two
  queries total regardless of channel count; empty input short-circuits.
- `humanTime`: today → clock time (with padding), yesterday → `"yesterday"`,
  3 days back → weekday name (`Thursday`, verified against the real
  `Date.toDateString()` for the fixture dates), 17 days back → short date
  (`Aug 20`), and the exact microsecond timestamp from the bug report never
  produces `94682` or an ISO-shaped time pattern.

`app/src/components/__tests__/chat-dock.test.tsx` (11 tests, up from 5):
- Updated the pre-existing tests to look up rail rows by their new
  `aria-label` (`Open chat with Ally` / `Squad` / `Rival`) instead of the
  old kind-fallback text.
- New: dm row's title is the other member's display name; group row's
  title + `"group · 4 people"` sub-line; short accessible name proven both
  by an exact-string match and by asserting `aria-label.length <
  textContent.length` (proving it isn't just the blob repeated); a same-day
  message renders as `HH:MM` and a much-older one matches neither an ISO
  pattern nor the raw uuid; a dedicated test asserting `c1`/`c2`/`c3` and any
  `YYYY-MM-DDTHH:MM:SS` pattern never appear anywhere in `container.textContent`.

`app/src/screens/__tests__/friends-screen.test.tsx` (13 tests, up from 11):
- Extended the file's `../../lib/supabase` mock to distinguish the "find a
  trainer" search (`.ilike()`) from `resolveDisplayNames`'s own lookup
  (`.in()`), defaulting the latter to echo each id back as its own name
  (so every pre-existing assertion on, e.g., `Remove mate` keeps passing
  unchanged — "mate" resolves to "mate" by default).
- New: a friend whose profile resolves to `Buddy` shows `Remove Buddy`, and
  the raw id `mate` never appears in the document.
- New: a friend whose profile cannot be resolved falls back to
  `Remove Unknown trainer`, never the uuid.

## Commands run, verbatim

```
$ npm run check > check1.log 2>&1; echo "EXIT=$?"
EXIT=1
```
`check1.log` tail: `Test Files  4 failed | 86 passed (90)` / `Tests  7 failed | 1293 passed (1300)`.
All 7 failures were in files this change never touched
(`interactions.test.tsx`, `screen-controls.test.tsx`, `team-builder.test.tsx`
×2, `team-saves.test.tsx` ×3), all either `Test timed out in 5000ms` or
`no search result for "azumarill"` — the exact starvation signature called
out in the brief. `tsc -b`, `oxlint`, `themes`, `tokens`, `verify`,
`audit:spreads`, `rules:node` and `verify:coordinator-bundle` all passed
(the `&&`-chained `check` script only reaches `vitest run` if every prior
step succeeded).

```
$ npm run test -- --run > check2.log 2>&1; echo "EXIT=$?"
EXIT=1
```
`check2.log` tail: `Test Files  7 failed | 83 passed (90)` / `Tests  9 failed | 1291 passed (1300)`.
A **different** set of 9 failures this time (`interactions.test.tsx`,
`matchmaking.test.tsx`, `screen-leaves.test.tsx`, `screens.smoke.test.tsx`,
`team-builder.test.tsx`, `team-saves.test.tsx` ×3, `info-popover.test.tsx`) —
the set wandering between runs, as the brief warned, confirming starvation
rather than a real regression. **Never touched or raised a timeout.**

In both runs, every file this change touched passed completely:
- `src/lib/__tests__/channels.test.ts` — 41/41
- `src/components/__tests__/chat-dock.test.tsx` — 11/11
- `src/screens/__tests__/friends-screen.test.tsx` — 13/13

Total test count went from 1277 to 1300 (23 new tests: 12 in channels.test.ts,
6 in chat-dock.test.tsx, 2 in friends-screen.test.tsx — plus the pre-existing
tests in those files that needed updating for the new accessible names, which
were edited, not added).

## Files touched

- `app/src/lib/channels.ts`
- `app/src/lib/__tests__/channels.test.ts`
- `app/src/components/ChatDock.tsx`
- `app/src/components/__tests__/chat-dock.test.tsx`
- `app/src/screens/FriendsScreen.tsx`
- `app/src/screens/__tests__/friends-screen.test.tsx`

`app/src/components/ChatPane.tsx` and its test were deliberately left
unchanged (see above). Nothing under `supabase/` was touched.

## Concerns / things not done

- **Repeated cost per poll.** `withDisplayNames` re-runs its 2 queries on
  every 15s poll, even though display names essentially never change
  between polls. Not optimized (e.g. caching resolved names across polls,
  or only re-resolving when the channel id set changes) — the brief asked
  for "not N+1 per channel," which this satisfies, but did not ask for
  cross-poll caching, and adding it would have meant a larger, more stateful
  change than the scope here called for.
- **Display-name collisions.** Two friends (or two DM partners) sharing the
  same `display_name` would now produce two buttons with the same
  accessible name (e.g. two `Remove Alex` buttons) — the exact class of bug
  the earlier per-row-uuid fix was designed to prevent. The brief's own
  examples (`Accept ALICE`) call for exactly this trade (name over uuid),
  and disambiguating same-named people wasn't in scope here; flagging it as
  a known edge case rather than solving it.
- **`ChatPane` inconsistency.** After this fix, the rail correctly shows
  "Ally" for a DM, but opening that conversation's pane still headers it
  generically as "Direct message" (`channelLabel`, unchanged). This wasn't
  named as a defect in the brief (which focused on the rail's own
  `innerText`/accessible name) and was left alone to keep the diff scoped,
  but it's a visible inconsistency a follow-up could close by threading
  `displayTitle` into `ChatPane` too.
