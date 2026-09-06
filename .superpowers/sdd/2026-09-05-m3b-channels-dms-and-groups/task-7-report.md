# Task 7 report: the chat screen, plus the `channel_members[0]` fix

## Summary

- Fixed the measured bug in `app/src/lib/channels.ts`'s `listChannels()`: it now selects `channel_members(user_id, last_read_at)` and picks the row whose `user_id` matches the signed-in id, instead of taking `[0]` (an arbitrary member's row, since `channel_members`' SELECT policy lets every member of a channel see every other member's row).
- Built `app/src/screens/ChatScreen.tsx`: a two-pane chat screen over channels/DMs/groups/match chats, wired to `lib/channels.ts`.
- Registered `chat` in `app/src/lib/screens.ts` (hue `var(--type-bug)`), `Screen` in `app/src/state/AppState.tsx`, and a `case` in `app/src/App.tsx`.
- Added an "Open match chat" control to `app/src/screens/MatchScreen.tsx`.
- Two commits on `main`: `e44cb03` (the fix) and `2d5100c` (the screen).

## Files changed

- `app/src/lib/channels.ts` — `listChannels()` fix.
- `app/src/lib/__tests__/channels.test.ts` — widened one fixture, added two tests.
- `app/src/screens/ChatScreen.tsx` — new.
- `app/src/screens/__tests__/chat-screen.test.tsx` — new.
- `app/src/lib/screens.ts` — registered `chat`.
- `app/src/state/AppState.tsx` — added `'chat'` to the `Screen` union.
- `app/src/App.tsx` — lazy import + `case 'chat'`.
- `app/src/screens/MatchScreen.tsx` — "Open match chat" control.
- `app/src/styles/components.css` — new `.chat-*` classes.

## The `listChannels` fix

### The bug, confirmed

I read the live policy (`is_channel_member(channel_id)` on `channel_members`' SELECT). Every member of a channel can see every other member's `channel_members` row, so the embedded join in `listChannels()` returns one row per member, in whatever order Postgres returns them — not necessarily the viewer's row first. The old code took `r.channel_members[0]`, which in a two-person DM has roughly even odds of being the *other* person's row. `lastReadAt` (and anything built on it) was wrong for essentially every multi-member channel.

### The fix

```ts
export async function listChannels(): Promise<Channel[]> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from('channels')
    .select('id, kind, title, match_id, channel_members(user_id, last_read_at)')
    .order('created_at', { ascending: false });
  ...
  lastReadAt: r.channel_members.find((m) => m.user_id === me)?.last_read_at ?? null,
  ...
}
```

Selects `user_id` alongside `last_read_at` and finds the row matching the signed-in id. `listChannels` is now a function of `me`, so it gets the same `if (!me) return []` guard `myMatches` and `listFriends` carry — with `me` undefined, every `user_id === me` comparison would be false, silently degrading `lastReadAt` to `null` rather than a query that was never guarded at all.

### The TDD experiment (as requested)

1. Wrote the new test first: a two-member channel with the viewer's row placed *second*, asserting `lastReadAt` equals the viewer's own timestamp (`'2026-01-01T00:00:00Z'`), not the other member's (`'2020-01-01T00:00:00Z'`).
2. Ran it against the **unmodified** (buggy) `channels.ts`:

```
cd app && npx vitest run src/lib/__tests__/channels.test.ts > /tmp/pre_fix_channels.log 2>&1; echo "EXIT=$?"
```

Result: `EXIT=1`, 2 failed / 14 passed. The new test failed exactly as predicted:

```
FAIL  src/lib/__tests__/channels.test.ts > listChannels > yields the viewer's own lastReadAt from a two-member channel, not the other member's
AssertionError: expected '2020-01-01T00:00:00Z' to be '2026-01-01T00:00:00Z'
```

i.e. it read back the *other member's* timestamp under the `[0]` version — this is the direct, reproduced failure the bug report described.

3. Applied the fix, reran the same command: `EXIT=0`, 16/16 passed.

**Answer to "did the new test fail against `[0]`?": yes.**

### Fixture widening (legitimate, not weakening)

`app/src/lib/__tests__/channels.test.ts`, the pre-existing `listChannels` test ("maps the channel_members join to lastReadAt, or null with no row") had its `channel_members` rows widened from `{ last_read_at: ... }` to `{ user_id: 'me', last_read_at: ... }` — the type the join now needs a `user_id` on to do the matching at all. `getSession` in this file's `beforeEach` already stubs the session to id `'me'`, so this is exactly the shape the fixed code expects; no assertion in that test was changed or weakened.

Two new tests were added: the two-member "viewer's own row" test above, and a no-session guard test (`getSession` resolves `{ session: null }`) mirroring `markRead`'s own no-session test — asserts `listChannels()` returns `[]` and never even reaches `.from('channels')`.

`app/src/lib/__tests__/channels.test.ts` result: 16/16 passed (was 14/14 before this task).

## The chat screen

### Corrections applied from the brief

Per your note, the brief's Step 1 skeleton uses `render` from `'../../../test/render'` and `@testing-library/user-event`; I used `renderApp` from `'../../test/render'` (per `app/src/screens/__tests__/interactions.test.tsx` and `match-screen.test.tsx`'s own precedent for this exact substitution) and `fireEvent` from `@testing-library/react` throughout. Disabled-button assertions use explicit `.toBeDisabled()`/`.toBeEnabled()` rather than firing a click and inferring nothing happened.

### Design decision: no `useSession()` gate

The brief's own test skeleton mocks only `../../lib/channels` and expects the screen to work immediately via `renderApp` (which settles signed-out by default, per `renderApp`'s own doc comment). Since `listChannels()` and `markRead()` already refuse to do anything meaningful without a session (returning `[]` / no-op respectively — including after this task's fix), I did not add a second `if (!user) ...` gate the way `FriendsScreen` does. A signed-out visitor sees an honest "No conversations yet." from an empty list, never someone else's data — the same principle `FriendsScreen`'s comment articulates, just enforced one layer down since the module itself already does it. This also means the tests need no `lib/supabase` mock or session harness, matching the brief's own (uncorrected) skeleton shape.

### Behavior implemented

- Channel list: one button per channel, labelled by `title` for a `group`, `Direct message` for a `dm`, `Match chat` for a `match`, each with the channel id appended in faint text (`· c1`) for a distinct accessible name per row — the same fix `FriendsScreen`'s rows needed for exactly this reason (see the note below).
- Selecting a channel calls `listMessages`, then opens `subscribeToChannel` inside a `useEffect` keyed on `selectedId`; the cleanup calls the returned teardown, so switching channels tears the old subscription down first.
- Also calls `markRead(selectedId)` when a channel opens (mocked as a no-op in tests; a natural place to stamp "read" given the module exists for it, though nothing in the brief's required test coverage exercises it directly).
- De-duplication by `id`: both the `sendMessage` return value and the subscription delivery run through the same `prev.some((x) => x.id === m.id) ? prev : [...prev, m]` check.
- Textarea labelled "Message" (`aria-label="Message"`, matching `FriendsScreen`'s convention of `aria-label` directly on the control rather than a separate `<label>`); Send button disabled while the trimmed body is empty or `sending` is true.
- Each message has a Report control (`aria-label="Report message ${id}"` for per-row uniqueness), prompting via `window.prompt` for a reason, calling `reportMessage(id, reason)`, then showing "Reported" in place of the button. Cancelling the prompt (`null`) skips the call entirely.
- A message with `deletedAt` renders "Message deleted" (with a faded, italic style) instead of its body.
- `state.activeMatch` (already used by the `match` screen) drives a one-time auto-select of the channel whose `kind === 'match' && matchId === activeMatch.id` when this screen mounts — guarded by a `useRef` so a later manual channel switch is never undone by that effect re-running.

### Tests written (`app/src/screens/__tests__/chat-screen.test.tsx`), all TDD'd

Ran once before `ChatScreen.tsx` existed to confirm the right failure:

```
cd app && npx vitest run src/screens/__tests__/chat-screen.test.tsx
```
→ `EXIT=1`, `Failed to resolve import "../ChatScreen"` (as the brief predicted).

After implementation: `EXIT=0`, 7/7 passed:
1. Lists channels labelled by kind, opens one, shows its transcript.
2. Won't send an empty (or whitespace-only) message; Send disabled/enabled correctly; calls `sendMessage('c2', 'hi')`.
3. Unsubscribes when the open channel changes.
4. De-duplicates a subscription delivery repeating an id already appended via `sendMessage`'s own return.
5. Renders a `deletedAt` message as "Message deleted", not its body.
6. Reports a message after a `window.prompt` reason, shows "Reported" afterward; also asserts all Report buttons in the list have distinct accessible names (the per-row-name check the brief called out from the Friends screen's own correction).
7. Skips the report call when the reason prompt is cancelled.

One `act()` warning surfaced from manually invoking the subscription's `onMessage` callback outside of a React event handler in test 4; wrapped that single call in `act(() => ...)`, after which the suite is clean.

## Hue chosen

`var(--type-bug)`. Free hues at the time of registration (18 Pokémon types minus the 13 already claimed by other screens: dragon, fighting, psychic, water, grass, fairy, steel, electric, dark, ghost, ground, flying, normal): **bug, fire, ice, poison, rock**. Chose bug for the same reasoning style the existing entries use (see `friends`' "flying fits a flock" comment) — a chat screen is the one place all of a person's conversations (DMs, groups, and one channel per match) buzz independently at once, which is what "bug" evokes here. Commented the choice in `screens.ts` next to the `hue` field, matching the existing convention. `screens.test.ts`'s uniqueness assertion (`new Set(hues).size === hues.length`) passed with this choice — ran as part of the full suite (6/6 in that file).

## CSS classes reused vs. added

**Reused verbatim:** `.panel`, `.hud-label`, `.match-list` (as the channel list's `<ul>`), `.text-muted`, `.text-faint`, `.friend-notice` (for load/thread/send errors, following its own doc comment: "the secondary signal colour every theme defines" for a non-destructive alert), `.btn`, `.btn-primary`, `.btn-ghost` (Report control), `.input`/`textarea.input`.

**Added, new to this screen** (`.chat-*` in `components.css`, appended after the `friend-*` block): `.chat-layout` (flex row, wraps below the shell's reading width — same escape `.friend-search-row` uses), `.chat-channel-list`, `.chat-thread`, `.chat-channel-row` (a button row with a 3px accent rail when `.is-active`, the same rail-carries-state convention `.friend-row[data-kind]` uses), `.chat-transcript` (bounded, scrolling list — same shape as `.offer-list`/`.my-offer-list`), `.chat-message` / `.chat-message.is-deleted` (rail switches to `--text-faint` for a deleted message), `.chat-message-body`, `.chat-compose`. All built from `--space-*`/`--text-*`/`--rule-strong`/`--color-accent`/`--text-faint` tokens — no literal px for spacing or type.

### Deviation: no chamfer clip-path

I looked for a reusable generic "chamfered panel" or "chamfered small control" class to apply here, as instructed ("find and reuse the existing classes rather than pasting the polygon"). There isn't one: every `clip-path: polygon(9px ...)` / `polygon(5px ...)` rule in `components.css` (`.form-toggle`, `.pager`, `.mv-kind-btn`/`.mv-kind-panel`, `.pc`, `.sw-track`/`.sw-knob`, `.hv-legend-panel`, `.info-pop-panel`, `.team-slot-mark`, `.species-search .input`) is a component-specific rule with its own baked-in positioning, background, or sizing — reusing one verbatim on a two-pane chat layout would import unrelated rules (e.g. `.mv-kind-panel`'s `position: absolute`) rather than reuse a generic treatment. `.panel` itself — the class the brief explicitly describes ("a 1px `--rule-strong` border with `--space-3` padding") — carries no `clip-path` at all in the current CSS. `FriendsScreen`, the explicit precedent for this screen ("the most recent screen in this vocabulary — follow it"), likewise uses plain `.panel`/`.friend-row` with no chamfer anywhere. I followed that same vocabulary rather than inventing a new chamfer polygon of my own, which the instructions separately forbade. Flagging this as a deviation from the literal chamfer instruction, with the reasoning above, since I could not find a class that both (a) was reusable without side effects and (b) actually fit a two-pane list/thread layout.

## Full gate

```
cd app && npm run check > /tmp/app_check.log 2>&1; echo "EXIT=$?"
```
Result: **EXIT=0**. Test summary from that run: `Test Files 89 passed (89)`, `Tests 1256 passed (1256)` — up from the stated baseline of 1247/1247 by the 9 new tests (2 in `channels.test.ts`, 7 in `chat-screen.test.tsx`). `tsc -b`, `oxlint`, `themes`, `tokens`, `verify`, `audit:spreads`, `rules:node`, `verify:coordinator-bundle` all ran clean ahead of the test step. No new oxlint warnings attributable to this task's files (the two pre-existing `only-export-components` warnings on `MatchScreen.tsx` and `AppState.tsx` predate this change — they're about those files' non-component exports, unrelated to what I added).

Ran every command in the foreground, none backgrounded, per your instruction. No commands touched `supabase/`, `check:db`, or `db:reset`.

## Commits (on `main`, not pushed)

- `e44cb03` — `fix(channels): read the viewer's own last_read_at, not channel_members[0]`
- `2d5100c` — `feat(chat): a screen for dms, groups and match channels`

## Things I'm not fully certain about

- **`markRead` call placement.** I call `markRead(selectedId)` whenever a channel is opened. This isn't exercised by any required test (the brief's mock just no-ops it), and I made a judgment call that "opening a channel marks it read" is the obviously-intended use of the export, but nobody asked for it explicitly and there's no test pinning that behavior — flagging in case that's not the intended UX (e.g. maybe reads should be marked on scroll-to-bottom, or on an interval, rather than on open).
- **Auto-selecting the match channel via `activeMatch`.** This works and is exercised by nothing beyond manual reasoning — I did not write an automated test for the "Open match chat lands on the right channel" path, since doing so would require mocking both `lib/matches`-shaped `Match` data and `lib/channels`' `listChannels` together in a full `App`-level render, which felt like more machinery than the task's stated test surface asked for. If this needs a dedicated regression test, that's the gap.
- **Per-row channel button naming.** I appended the raw channel id (`· c1`) to each channel row's visible text for uniqueness, mirroring `FriendsScreen`'s convention of putting the identifying value directly in visible text rather than only in an `aria-label`. It's honest but not pretty — a real app would likely show the other participant's name for a DM, which `Channel` doesn't currently carry. Flagging as a plausible follow-up rather than something I judged out of scope to fix here.
