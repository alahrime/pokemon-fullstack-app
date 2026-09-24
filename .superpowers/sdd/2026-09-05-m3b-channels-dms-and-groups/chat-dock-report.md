# Chat dock: rebuilding chat as a Messenger-style dock

Branch: `main`. Two commits, not pushed:

- `2691855` `feat(channels): give the rail an unread signal without an N+1 query`
- `9dbb11c` `feat(chat): replace the full-page chat screen with a persistent dock`

## What changed

### Removed

- `app/src/lib/screens.ts` — deleted the `chat` `ScreenDef` entry entirely.
  Its `var(--type-bug)` hue is now unclaimed. `screens.test.ts` needed **no
  edit**: it asserts `SCREEN_DEFS.length >= 6` (not an exact count) and
  distinct hues across whatever entries exist, so removing one entry keeps
  every existing assertion true on its own. I read the whole file to confirm
  this before deciding not to touch it — it is not an oversight.
- `'chat'` removed from the `Screen` union in `app/src/state/AppState.tsx`.
- `case 'chat':` and the `ChatScreen` lazy import removed from `App.tsx`.
- `app/src/screens/ChatScreen.tsx` — deleted outright. Nothing in it survived
  as a standalone export worth keeping; every piece of behaviour it held
  (transcript rendering, composer, the report control, de-duplication by
  message id) was lifted into `app/src/components/ChatPane.tsx` unchanged in
  substance. `channelLabel()` (was `labelOf()`) is the one small helper that
  moved with it and is now exported from `ChatPane.tsx` for `ChatDock.tsx` to
  reuse for rail-row titles.
- `app/src/screens/__tests__/chat-screen.test.tsx` — deleted. Its coverage was
  **moved, not dropped**: every test in it (empty-send guard, disabled-while-
  sending, unsubscribe-on-change, dedup on a repeated realtime delivery,
  "Message deleted" rendering, Report hidden on a deleted/own message, the
  inline report form's submit/empty/cancel paths, per-row accessible Report
  names) now lives in `app/src/components/__tests__/chat-pane.test.tsx`,
  adapted to `ChatPane`'s explicit `channel` prop instead of `ChatScreen`'s
  internal `selectedId` state. One test's *shape* changed for a real,
  deliberate reason: the old suite had a test asserting the "Reported" marker
  clears when you switch channels and switch back — that reset existed
  because one `ChatScreen` instance was reused across channels by mutating
  `selectedId`. In the dock, each open channel gets its **own** `ChatPane`
  instance (`key={id}` in `ChatDock`), so `reportedIds` never has an occasion
  to leak between channels in the first place — there is no shared instance
  for it to leak through. I did not try to force an equivalent test into
  existence for a mechanism that no longer exists; I consider this a
  legitimate removal because the property "reported markers don't leak
  between channels" is now guaranteed **structurally** rather than by a reset
  effect, which is a strictly stronger guarantee than what the deleted test
  checked, not a weaker one.

### Added

- **`app/src/lib/channels.ts`**: `ChannelActivity` (a `Channel` plus
  `lastMessageAt: string | null`), `listChannelsWithActivity()`, and
  `isChannelUnread()`. See "Unread counts" below.
- **`app/src/components/ChatPane.tsx`**: one open conversation. `ChatScreen`'s
  thread panel, parameterized by an explicit `channel: Channel` prop instead
  of an internally-owned `selectedId`, so more than one can be mounted at
  once. Adds two behaviours `ChatScreen` never needed: `onActivity(channelId,
  at)` fires whenever a message is sent or received here, and `onRead
  (channelId, at)` fires whenever this pane marks the channel read (on open,
  and again when a message arrives while the pane is expanded, or when the
  pane transitions from minimised back to expanded) — both let `ChatDock`
  keep its rail current between polls without waiting out a whole interval.
- **`app/src/components/ChatDock.tsx`**: the rail, plus the open panes it
  renders to its left. Gated on `useSession().user`, returning `null` (not an
  empty shell) when signed out.
- **`app/src/state/ChatDockContext.tsx`**: a small one-shot context —
  `requestMatchChannel(matchId)` / `requestedMatchId` /
  `clearRequestedMatchChannel()` — that stands in for the navigation
  `MatchScreen`'s "Open match chat" button used to do (`set('screen',
  'chat')`). There is no `chat` screen to navigate to any more, and the
  button lives several components away from the dock inside the remounting
  screen tree, so this context is the seam between the two. Wired into
  `App.tsx` around `<Shell />`, and into `app/src/test/render.tsx`'s
  `renderApp` so every screen test that renders `MatchScreen` still has the
  context it now needs.
- Tests: `app/src/components/__tests__/chat-dock.test.tsx`,
  `app/src/components/__tests__/chat-pane.test.tsx`, new cases in
  `app/src/lib/__tests__/channels.test.ts` for `listChannelsWithActivity` and
  `isChannelUnread`.
- CSS in `app/src/styles/components.css`: `.chat-dock`, `.chat-dock-panes`,
  `.chat-rail*`, `.chat-pane*`, plus two generic chamfer utilities,
  `.chamfer-9` / `.chamfer-5` (see "Design system" below). Removed
  `.chat-layout` / `.chat-channel-list` / `.chat-thread` / `.chat-channel-row`
  — dead now that the two-panel full-page layout they belonged to
  (`ChatScreen`) is gone; confirmed with a repo-wide grep before deleting.
  Kept `.chat-transcript` / `.chat-message` / `.chat-message-body` /
  `.chat-compose` / `.chat-report-form` — `ChatPane` reuses these verbatim.

### Changed

- `app/src/screens/MatchScreen.tsx`: "Open match chat" now calls
  `requestMatchChannel(match.id)` from `ChatDockContext` instead of
  `set('screen', 'chat')`. `useAppState()` (imported only for `set`) is gone
  from this file; nothing else in it used `set`.
- `app/src/screens/__tests__/match-screen.test.tsx`: its local `wrapped()`
  helper (used for `rerender()` calls, and documented as needing to mirror
  `renderApp`'s own provider tree exactly) now wraps `ChatDockRequestProvider`
  too, matching the same change in `renderApp`.

## Structural requirement: verified

`ChatDock` is mounted in `Shell()` (`App.tsx`) as a **sibling** of the
`<div key={state.screen}>` block, both inside `<div className="hud-content
contents">`:

```tsx
<div className="hud-content contents">
  <Nav />
  <div key={state.screen} className="screen-enter …">
    <Screens />
  </div>
  <SiteFooter />
  <ChatDock />
</div>
```

Verified two ways, not just by reading the JSX:

1. Read `App.tsx` after editing to confirm `<ChatDock />` sits at the same
   level as `<Nav />` / `<SiteFooter />`, outside the keyed div, exactly the
   placement the brief called out as the one thing this design depends on.
2. A dedicated test, `chat-dock.test.tsx` → `ChatDock inside the app shell`
   → `keeps an open pane mounted, subscription and all, across a screen
   change`: renders the real `App`, opens a DM pane, clicks the Rankings nav
   tab (the same mechanism `app-shell.test.tsx` already uses), and asserts
   the pane's transcript is still on screen **and** that `listMessages` was
   called exactly once and `unsubscribeToChannel`'s teardown was never
   called — i.e. `ChatPane` never remounted. A dock mounted inside the keyed
   div would fail this test by re-fetching and re-subscribing (or losing the
   pane outright); it passes.

## Unread counts: how, and whether it needed extra queries

`listChannels()` already returns each channel's own `lastReadAt` (correctly
the viewer's own row, per the recent fix — untouched here). The one missing
fact is when the last message in each channel landed.
`listChannelsWithActivity()` (`lib/channels.ts`) gets it with **one extra
query for every channel at once**: `select('channel_id, created_at').in
('channel_id', allIds).order('created_at', { ascending: false })`, reduced
client-side with a `Map` that keeps the first (i.e. newest) row seen per
channel id. A channel with zero messages never appears in that result and is
left `lastMessageAt: null` rather than dropped — the `.map` runs over
`listChannels()`'s own array, not over the messages query's result.

`isChannelUnread(c)` is a four-line pure function: unread if there's a
`lastMessageAt` and either `lastReadAt` is `null` or `lastMessageAt >
lastReadAt`. Both are ISO 8601 strings from Postgres, so a plain string
compare is exact — no `Date` parsing needed.

This did **not** need a schema change. No migration was written.

Test: `channels.test.ts` → `listChannelsWithActivity` asserts exactly one
`in` call is made against `messages` for both fixture channels together
(the N+1 a per-channel query would produce would show up as one `in` call
per channel instead).

## How the rail learns about messages in a channel with no open pane

Considered and rejected: one Realtime subscription per channel the viewer is
in (not just the ones with an open pane), mirroring what `ChatPane` already
does for its own transcript. `subscribeToChannel` already supports this
mechanically and its teardown is proven idempotent — but doing it for every
channel, all the time, on every screen, is a cost that grows with the size of
someone's friend list and match history rather than with how many
conversations are actually open at once. That felt like the wrong shape for
something that runs on every screen for the lifetime of a session.

What I built instead: `ChatDock` polls `listChannelsWithActivity()` on a
fixed 15-second interval (`POLL_MS` in `ChatDock.tsx`), which costs exactly
one query regardless of how many channels exist. For anything with an
**open** pane, the gap narrows further without an extra subscription: each
`ChatPane` already runs its own `subscribeToChannel` for its own transcript
(required regardless, and covered by the existing idempotent-teardown tests
on `subscribeToChannel` itself), and reports every message it sends or
receives, and every successful `markRead`, back up through
`onActivity`/`onRead` props. `ChatDock` applies those as optimistic local
bumps to its own copy of the channel list, so a conversation with a pane open
updates its badge immediately; only a channel with **no** open pane ever
waits out the full 15s.

Trade-off, stated plainly: a channel nobody has a pane open on can be up to
15 seconds stale before its unread badge lights up. I judged that acceptable
for a background indicator (not the transcript itself, which is only ever
live inside an open pane) against the alternative of an always-on
subscription per conversation. If this needs to be tighter, the interval is
the one knob (`POLL_MS`), or the poll could pause on an inactive tab — I did
not add that; flagging it as a reasonable next step rather than doing it
speculatively.

## Subscriptions and teardown

`ChatPane` subscribes once per mount (effect keyed on `channel.id`, which is
stable for that pane's lifetime — `ChatDock` mounts a fresh `ChatPane` per
open id via `key={id}` rather than reusing one instance across channels, so
there is no "switch channel" case inside a single pane the way `ChatScreen`
had). The existing `subscribeToChannel` idempotent-teardown tests in
`channels.test.ts` were not touched and still pass — I didn't need to change
that function at all.

New pane-level behaviour, on top of what `ChatScreen` did: `onMessage`'s
handler checks a ref for whether the pane is currently minimised
(`minimizedRef`, kept current by a separate effect so the subscription
effect itself doesn't depend on `minimized` and get torn down/reopened on
every minimise/expand click) and calls `markRead` again only when the pane is
expanded — "focused" for a docked pane is defined as "visibly expanded",
since there is no single OS-level focus target across several panes sitting
side by side. A pane minimised while a message arrives still appends it (so
it's there when re-expanded) but does not call `markRead` for it; re-
expanding calls `markRead` once to catch up. Covered by
`chat-pane.test.tsx` → `does not mark the channel read again for a message
that arrives while minimised`.

## Design system

Read `components.css`, `tokens.css`, `hud.css`, and `FriendsScreen.tsx`
before writing anything. Used real tokens throughout (`--space-*`,
`--text-*`, `--font-mono`, `--color-accent`, `--color-accent-2`,
`--rule-strong`, `--text-faint`) — no literal px for spacing or type size in
the new CSS.

- Rail rows carry a 3px `border-left` by kind, the same device
  `.friend-row[data-kind]` and the offer rows use: match → `--color-accent`,
  group → `--color-accent-2`, dm → the default `--rule-strong`.
- `.hud-label` used for "Chat" on the rail header and for the kind label on
  each pane header, unchanged from its existing definition in `hud.css`.
- **Chamfer**: the brief noted no generic chamfer class exists in this
  codebase — the 9px and 5px opposite-corner `clip-path` polygons are pasted
  directly into more than ten separate component rules already. Rather than
  paste an eleventh/twelfth copy for the rail and the panes, I added
  `.chamfer-9` / `.chamfer-5` once in `components.css` (with a comment
  explaining why) and used those two classes on `.chat-rail`, `.chat-pane`,
  and the pane's minimise/close buttons. I did **not** retrofit the ten
  existing pasted copies — that's a separate cleanup this task didn't ask
  for and I didn't want to risk unrelated regressions in files I wasn't
  asked to touch.
- Accessibility: every per-row and per-pane control carries a distinct
  accessible name. Rail rows are buttons whose visible text already includes
  the channel id (same convention `ChatScreen` and `FriendsScreen` used), so
  two DMs or two same-titled groups never collide. A pane's minimise/close
  buttons, and its message textarea/Send button, all carry `aria-label`s
  suffixed with `· {label} · {channel.id}` — needed because, unlike the old
  single-panel screen, several panes with the same kind/title can now be open
  and visible **simultaneously**, so "Send" or "Close" alone would collide
  across them the same way ten `Report` buttons would in a list.

## Commands run, and real output

```
cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
```
Run 1: `EXIT=1` — `Test Files 1 failed | 89 passed (90)`, `Tests 1 failed |
1276 passed (1277)`. The one failure: `team-saves.test.tsx › signed in ›
shows each saved team's league beside its name` — `Test timed out in 5000ms`.

Per the machine-starvation note (`Test timed out in 5000ms` in a file this
task never touched), re-ran once as instructed:

```
cd app && npm run check > /tmp/app2.log 2>&1; echo "EXIT=$?"
```
Run 2: `EXIT=1` — `Test Files 2 failed | 88 passed (90)`, `Tests 3 failed |
1274 passed (1277)`. The three failures this time:
`screen-leaves.test.tsx › CoresScreen …`, and two different tests in
`team-saves.test.tsx` — a **different** wandering set from run 1, in files
this task never touched, exactly the documented pattern. `tsc -b`, `oxlint`,
`themes`, `tokens`, `verify` (data), `audit:spreads`, `rules:node`, and
`verify:coordinator-bundle` all completed successfully in both runs before
the test step ran — the only failures in either run are inside `npm run
test`.

For extra confidence (not required, but worth recording) I ran the suite two
more times: a third `npm run test` alone came back `3 failed | 1274 passed
(1277)` with yet another different wandering set (adding
`info-popover.test.tsx`), and a fourth full `npm run check` came back `2
failed | 1275 passed (1277)` with a different pair again
(`pager.test.tsx`, another `team-saves.test.tsx` case). Total test count held
at 1277 across all four runs; the failing set never repeated and never
touched a file this task modified — consistent with starvation, not
breakage. I did not raise any timeout or otherwise touch those files.

To isolate the actual chat work from that noise, I also ran just the
touched/added files directly:

```
cd app && npx vitest run src/components/__tests__/chat-dock.test.tsx \
  src/components/__tests__/chat-pane.test.tsx \
  src/lib/__tests__/channels.test.ts \
  src/lib/__tests__/screens.test.ts \
  src/screens/__tests__/match-screen.test.tsx \
  src/screens/__tests__/app-shell.test.tsx
```
Result: `EXIT=0` — `Test Files 6 passed (6)`, `Tests 64 passed (64)`.

`tsc -b` alone (after final comment edits): `EXIT=0`, no errors.

## Baseline vs. now

Before: `npm run check` 1262/1262. Now: 1277 total (net +15 — added tests in
`chat-dock.test.tsx`, `chat-pane.test.tsx`, `channels.test.ts` for the new
functions, minus the `chat-screen.test.tsx` file removed whole, whose
coverage moved into `chat-pane.test.tsx` as described above). Did not run
`npm run check:db` or `npm run db:reset` — no SQL was touched, per the
brief.

## Things I'm not fully certain about

- **Poll interval (15s)** is a judgement call, not a measured requirement.
  Nothing in the brief specified a number; I picked something short enough
  to feel responsive for a background badge and long enough to keep the
  query cheap. Easy to change (`POLL_MS` in `ChatDock.tsx`) if the product
  owner wants tighter or looser.
- **Rail default state**: I read "collapse/expand affordance" as toggling
  the row *list* underneath an always-visible header+badge, rather than
  collapsing the whole dock to a bare strip — the brief's own two
  descriptions of "collapsed" (a narrow rail that still "carries unread
  counts", versus a header that's "always visible") read as consistent with
  this if "collapsed" means the resting/default width rather than a second,
  hidden state. Defaulted to expanded (rows visible) rather than collapsed,
  since the brief's coverage list asks for "the rail lists channels" as a
  bare assertion.
- **Order of open panes**: newest-opened sits nearest the rail
  (`flex-direction: row-reverse` in `.chat-dock-panes`), which felt like the
  natural Messenger-ish choice, but nothing in the brief pins this down
  either way.
- I did not add a "pause polling when the tab is hidden" optimization
  (`document.visibilitychange`) — flagging it as a reasonable follow-up
  rather than adding untested scope creep.
