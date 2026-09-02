# Task 4 report — saving and loading a roster

## Summary

Implemented save/load/delete for team-builder rosters on
`app/src/screens/TeamBuilderScreen.tsx`, backed by the existing
`app/src/lib/saves.ts` and `app/src/lib/teamCodec.ts`. Wrote
`app/src/screens/__tests__/team-saves.test.tsx` with one `it(...)` per
behaviour enumerated in the brief (7 tests), TDD'd red-to-green, then ran the
full app gate green (1046/1046).

One out-of-scope fix was required to get the gate green: the shared test
render harness (`app/src/test/render.tsx`) did not wrap `SessionProvider`,
which every other screen test using `renderApp` relies on. Since
`TeamBuilderScreen` now calls `useSession()`, every screen test using
`renderApp` (6 files, 33 tests) started throwing "useSession must be used
within SessionProvider". Fixed by adding `SessionProvider` to `renderApp` in
the same nesting order `App.tsx` uses. This is a harness fix, not new
behaviour — the mocked Supabase client in `src/test/setup.ts` settles
signed-out, so nothing about those 33 tests' assertions changed.

## Files changed

- `app/src/screens/TeamBuilderScreen.tsx` — save/load/delete controls, state,
  and handlers.
- `app/src/styles/components.css` — appended `.team-saves*` / `.team-load-*`
  rules at the end of the file (did not touch existing blocks).
- `app/src/test/render.tsx` — added `SessionProvider` to the shared harness
  (see above).
- `app/src/screens/__tests__/team-saves.test.tsx` — new test file, 7 tests.

## Implementation notes

- **Save**: `.hud-label`ed name input (`#team-save-name`) + `.btn.btn-primary`
  "Save roster", disabled when the roster is empty or a save is in flight.
  Every team member is encoded via `encodeMember`. A member added through the
  quick search (not the build modal) has no entry in `builds`, so a new
  `defaultChoice(ref, league)` helper reconstructs the same rated-set/default-
  spread the modal would have opened on (mirrors `AddPokemonModal`'s own
  defaulting logic) — saving never throws or drops a member for that reason.
- **Load**: `loadSaved(t)` builds `nextTeam`/`nextBuilds` from scratch and
  calls `setTeam(nextTeam.slice(0, size))` / `setBuilds(nextBuilds)` directly
  — a full replace, not a merge into the existing state, per the brief's
  concern about TeamBuilderScreen's history with this bug class. Also calls
  `invalidate()` so a stale analysis for the old roster isn't shown.
- **Unknown move**: for each stored member, `decodeMember`'s `unknownMove` is
  checked; if set, a notice naming the species and the literal missing move id
  is appended to `loadNotice` and rendered (`.team-load-notice`, styled like
  `.account-alert` — no `--danger` token exists in this system, so it uses the
  secondary signal colour `--color-accent-2-700` the same way the account
  screen's validation messages do).
- **Delete**: `window.confirm(...)` gates the call; `deleteTeam` is only
  called after a truthy confirm, then the list is refetched.
- **Saved-team list**: overlay, not inline growth — reuses the exact
  `.move-picker` mechanism (`.move-picker-btn` / `.move-picker-panel`
  absolutely positioned relative to `.team-load-picker`), so the list scrolls
  internally (`.team-load-list { max-height: 240px; overflow-y: auto }`)
  rather than pushing the team slots down the page as more teams are saved.
- **Errors**: added a `savesError` state with try/catch around the
  save/delete/list-fetch calls, rendered through the same `.team-load-notice`
  class, so a failed Supabase call surfaces on the page instead of becoming a
  silent unhandled promise rejection. Not one of the 7 enumerated behaviours,
  but a real gap the enumerated tests wouldn't have caught, and small enough
  not to be gold-plating.

## Self-review: are the mock assertions load-bearing?

For each assertion against a mock, what would the mock have to stop doing for
the assertion to fail:

- `saveTeam` call args (order, name) — `saveTeam` is a bare `vi.fn()` that
  records its call; the values asserted come entirely from
  `TeamBuilderScreen`'s own `team.map(...)` and `saveName` state. If the
  screen passed the wrong order or a different string, the assertion fails.
  Not decorative.
- `deleteTeam` call/no-call gated on `window.confirm` — `window.confirm` is a
  real `vi.spyOn` on the global, returning a controlled boolean; the
  production `deleteSaved` reads that return value to decide whether to call
  `deleteTeam` at all. Verified both directions (false → not called, true →
  called with the right id), so the assertion exercises the actual branch.
- Replace-vs-append — deliberately not tested against an empty roster (would
  pass either way). The roster is pre-populated with two different members
  (azumarill, registeel) before the load; the assertion checks the `.team-slots`
  DOM text equals exactly `['Medicham', 'Skarmory']` and that the old members'
  names are gone from that scope. This was caught failing once already during
  development — my first version of that assertion checked
  `container.textContent` (the whole page, including the unrelated "Best
  teams" discovery list below, which legitimately names Azumarill/Registeel)
  and had to be rescoped to `.team-slots` only. Confirms the assertion is
  measuring the roster, not the page.
- Unknown-move notice — `decodeMember` is real (not mocked); the stored
  member's `fast_move` is set to a string (`MADE_UP_MOVE_ID`) that provably
  does not exist in `species.json`, so `unknownMove` is genuinely non-null,
  not manufactured by a mock return value.

No assertion in this file depends on a mock recording something the
production code doesn't actually control.

## RED (before implementation)

7 failing tests. First attempt failed at module load (`Cannot read properties
of null (reading 'auth')`) — `lib/supabase.ts` builds its client eagerly at
import time, so the mock has to be installed via `vi.resetModules()` +
dynamic import before the first import of anything that imports it
(`SessionContext`, `TeamBuilderScreen`), the same pattern `sign-in.test.tsx`
uses. After fixing the harness, the real RED (UI not implemented) was:

```
 ❯ src/screens/__tests__/team-saves.test.tsx (7 tests | 6 failed) 3016ms
   ✓ signed out > renders no save control, and the builder still works  844ms
   × signed in > disables the save control on an empty roster 243ms
     → expected undefined to be truthy
   × signed in > enables saving once there are members, and saves both in slot order 521ms
     → Cannot read properties of undefined (reading 'disabled')
   × signed in > saves the name exactly as typed 410ms
     → Unable to fire a "change" event - please provide a DOM element.
   × signed in > replaces the roster outright when loading a saved team, not appending to it 526ms
     → Unable to fire a "click" event - please provide a DOM element.
   × signed in > names the move when a saved fast move no longer exists, rather than loading a different one silently 217ms
     → Unable to fire a "click" event - please provide a DOM element.
   × signed in > asks for confirmation before deleting, and calls deleteTeam only after confirming 255ms
     → Unable to fire a "click" event - please provide a DOM element.

 Test Files  1 failed (1)
      Tests  6 failed | 1 passed (7)
```

(Full log preserved at `.superpowers/sdd/2026-09-01-m1b-user-owned-saves/task-4-red.log`.)

## GREEN (after implementation)

```
 ✓ src/screens/__tests__/team-saves.test.tsx (7 tests) 3428ms
   ✓ signed out > renders no save control, and the builder still works  869ms
   ✓ signed in > disables the save control on an empty roster
   ✓ signed in > enables saving once there are members, and saves both in slot order  667ms
   ✓ signed in > saves the name exactly as typed  438ms
   ✓ signed in > replaces the roster outright when loading a saved team, not appending to it  679ms
   ✓ signed in > names the move when a saved fast move no longer exists, rather than loading a different one silently  301ms
   ✓ signed in > asks for confirmation before deleting, and calls deleteTeam only after confirming  245ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## App gate

```
cd app && npm run check > /tmp/check8.log 2>&1; echo "EXIT=$?"
EXIT=0
```

tsc, oxlint, themes, token-parity, verify-data, audit:spreads, rules:node all
ran as part of `check` and passed. Full test run:

```
 Test Files  77 passed (77)
      Tests  1046 passed (1046)
```

(1039 pre-existing + 7 new = 1046.)

One benign `stderr` line appeared in `team-builder.test.tsx` ("An update to
SessionProvider inside a test was not wrapped in act(...)") on a synchronous
test that renders and immediately asserts, before `SessionContext`'s
`getSession()` stub promise resolves. It does not fail the test or the gate.
It is a pre-existing async-timing shape in `SessionContext` (the module's own
comment calls the post-unmount case "deliberately untested" for the same
reason — React 19 makes a post-unmount `setState` a silent no-op) newly
visible because `SessionProvider` is now in the shared harness; not something
`team-saves.test.tsx` or `TeamBuilderScreen.tsx` introduces a bug in. Left
as-is rather than touching an unrelated pre-existing test file outside this
task's scope.

## Not done (explicitly out of scope per the task)

Step 5 (browser measurement — confirming the saved-team list doesn't push the
roster below the fold, and confirming a loaded roster in the real app) is
being done by the controller session directly, per the scope note in the
task prompt. No dev server was started by this session.

## Commit

`git add app/src/screens app/src/styles/components.css
app/src/screens/__tests__/team-saves.test.tsx app/src/test/render.tsx` then
committed (see final report for the SHA/subject).
