# Task 8 report — the Matchmaking screen

## Status

Done. `npm run check` is green (EXIT=0), full suite 1125/1125 across 81 files, including the
13 new tests in `src/screens/__tests__/matchmaking.test.tsx`.

## Files

- Created: `app/src/screens/MatchmakingScreen.tsx`
- Created: `app/src/screens/__tests__/matchmaking.test.tsx`
- Modified: `app/src/lib/screens.ts` (new `SCREEN_DEFS` entry)
- Modified: `app/src/App.tsx` (lazy import + `case 'matchmaking'`)
- Modified: `app/src/state/AppState.tsx` (`Screen` union needed `'matchmaking'` added —
  not in the brief's file list, but `screens.ts`/`App.tsx` don't typecheck without it)

## What was built

One screen, gated on `useSession()`, with a local 3-slot roster builder (`SpeciesSearch` +
`PokemonCard`, same pattern as `TeamBuilderScreen`'s `Slot`, scored under the league's rated
moveset — see "roster and format" note below) feeding three panels:

- **Blind queue** — `.queue-join` to `joinQueue`, disabled until the roster holds exactly 3 and
  the caller isn't already queued. Queue status distinguishes `verifiedHash === null`
  ("Queued — awaiting verification.") from a verified entry ("Queued and eligible to pair.").
  Leave asks `window.confirm` first, same idiom as `TeamBuilderScreen`'s `deleteSaved`.
  Matches are listed with the opponent's friend code, fetched per match via
  `opponentFriendCode(m.opponentId)` once matches load; "No friend code on file" when the call
  resolves `null` rather than showing nothing.
- **Open offer board** — `listOpenOffers(league)`, refetched on league change. An offer whose
  `proposerId === user.id` renders no `.offer-accept` control at all (the DB's
  `match_offers_not_self` would refuse it and `accept_offer` raises for it too — a control that
  can only fail isn't offered). Accepting calls `acceptOffer(offer.id, team)`: a non-null return
  shows "Matched!"; a `null` return (a scheduled offer, now `accepted` not yet a match) shows
  "awaiting the proposer's confirmation" and explicitly not "matched."
- **Post an offer / schedule one** — overlaid via `.move-picker`/`.move-picker-btn`/
  `.move-picker-panel` (does not push the board down as offers arrive). Immediate post omits
  `scheduledFor`; scheduling reads a `datetime-local` input into a `Date`. Offers posted this
  session are tracked locally and shown with a Confirm button wired to `confirmOffer(id)`.

## The roster-and-format design decision (read this — it's the one judgment call in this task)

Task 8's brief scopes "Consumes" to Task 7's API, `useSession()`, and `LEAGUE_BY_ID` only — it
does not mention `lib/saves.ts` (saved teams/formats) or `useFormats()`. The Step 1 mocking
instruction backs this up literally: it says to mock `../../lib/matchmaking` and gives no
instruction to also mock `../../lib/saves`. I took that as a real constraint, not an omission,
and built the roster locally on this screen (own `useState<string[]>`, `SpeciesSearch` to add,
`encodeMember(defaultChoice(ref, league), league)` to submit) rather than reusing
`listTeams`/`useFormats`. This kept the test mocking to exactly what the brief specifies.

The consequence is `formatVersionId`. It is a foreign key into `format_versions` in the real
schema (`queue_entries.format_version_id references format_versions(id)`,
`supabase/migrations/20260902204023_queue_and_matches.sql`). I could not find anywhere in this
codebase that produces or discovers a real one for a league's "canonical" ruleset:

- No migration seeds a `formats`/`format_versions` row for Great/Ultra/Master.
- `lib/saves.ts`'s `listServerFormats()` (and its `SavedFormat` type) returns `formats.id`, not
  `format_versions.id`, for a user's own saved custom format — so even reusing that machinery
  would not have produced a usable id.

`MatchmakingScreen.tsx` names this directly in code (`canonicalFormatVersionId`, with a "KNOWN
GAP" comment) rather than silently faking something that would look plausible. As implemented,
`joinQueue`/`createOffer` will fail their foreign key against a real database until this is
resolved. **This is the one thing in this task I'm genuinely unsure is the right call** — the
alternative (reusing `useFormats()`/`listTeams()` despite the brief's narrower scope) would have
had the same underlying problem (the `formats.id`-vs-`format_versions.id` gap) while also pulling
`lib/saves.ts` into this screen's test surface. I'd like a second opinion on whether a canonical
per-league `format_versions` row should be seeded (migration) or whether `lib/saves.ts` should
grow a function that returns one, before this screen can actually queue anyone in production.

## Gap found (not a defect in `matchmaking.ts` itself — reported, not touched)

`lib/matchmaking.ts` has no function to list the offers a signed-in user has proposed. The
confirm handshake needs one: `listOpenOffers` is scoped to `state = 'open'`, and an offer the
proposer's own client just watched get accepted has already left that state, so nothing tells the
proposer their offer now needs `confirmOffer`. I worked around this by tracking offers posted
*this session* client-side (`posted` state in `MatchmakingScreen.tsx`) and always exposing a
Confirm control for them — clicking Confirm before anyone has actually accepted just surfaces
whatever error `confirm_offer` raises, which is honest, not silent, but is not a real "your offer
was accepted" notification. A `myOffers()` (or similar) export from `matchmaking.ts` would close
this properly; I did not add one since I was told not to modify that file.

## TDD — red

```
cd app && ./node_modules/.bin/vitest run src/screens/__tests__/matchmaking.test.tsx > /tmp/red.log 2>&1; echo "EXIT=$?"
EXIT=1
```

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app


⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/screens/__tests__/matchmaking.test.tsx [ src/screens/__tests__/matchmaking.test.tsx ]
Error: Failed to resolve import "../MatchmakingScreen" from "src/screens/__tests__/matchmaking.test.tsx". Does the file exist?
  Plugin: vite:import-analysis
  File: /Users/alilahrime/Downloads/paragon-iv/app/src/screens/__tests__/matchmaking.test.tsx:62:45
  36 |    const { AppStateProvider } = await import("../../state/AppState");
  37 |    const { SessionProvider } = await import("../../state/SessionContext");
  38 |    const { MatchmakingScreen } = await import("../MatchmakingScreen");
     |                                               ^
  39 |    let view;
  40 |    await __vi_import_1__.act(async () => {
 ❯ TransformPluginContext._formatLog node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:29079:43
 ❯ TransformPluginContext.error node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:29076:14
 ❯ normalizeUrl node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:27199:18
 ❯ node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:27257:32
 ❯ TransformPluginContext.transform node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:27225:4
 ❯ EnvironmentPluginContainer.transform node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:28877:14
 ❯ loadAndTransform node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:22746:26

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
```

**Reading it:** the only failure is Vite's import-analysis plugin unable to resolve
`../MatchmakingScreen` — the file didn't exist yet. Not a `ReferenceError` from a stray typo, not
a false pass-through — the suite collected zero tests because the module graph never loaded. This
is the correct, expected reason to be red at this point: exactly the file this task's Step 3
creates. (The milestone's own retro flags a prior case where "confirmed red" masked a
`ReferenceError` from an undefined helper that would have failed identically against correct
code — this isn't that: an unresolvable import fails identically regardless of what
`MatchmakingScreen` will eventually contain, so there's nothing here to misread.)

## TDD — green

```
cd app && ./node_modules/.bin/vitest run src/screens/__tests__/matchmaking.test.tsx > /tmp/green.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ src/screens/__tests__/matchmaking.test.tsx (13 tests) 3103ms
   ✓ signed in — the blind queue > joins the queue with the roster and format on screen  574ms
   ✓ signed in — the open offer board > shows a scheduled offer awaiting confirmation as awaiting, not as a match  522ms
   ✓ signed in — the open offer board > shows a live offer as matched once accepted, since accept_offer returned a match id  523ms
   ✓ signed in — the open offer board > posts an offer to the open board with the roster and format on screen  524ms
   ✓ signed in — the open offer board > schedules an offer for later with a scheduledFor date, and offers a Confirm control once posted  546ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

All 13 passed on the first implementation attempt (vitest's default reporter only prints the
slowest 5 by name; the other 8 — signed-out, incomplete-roster-disables-join, the two
verified/awaiting queue-status tests, leave-asks-first, friend-code-shown,
no-friend-code-on-file, and self-offer-disables-accept — passed silently in the same run).

## The full gate

```
cd app && npm run check > /tmp/task-8-gate.log 2>&1; echo "EXIT=$?"
```

First run: **EXIT=1**. Two pre-existing tests failed —
`src/lib/__tests__/screens.test.ts > gives every screen a distinct hue` and
`src/components/__tests__/interactive.test.tsx > App shell > gives every nav tab its own hue`,
both `expected 10 to be 11`. The brief's suggested `SCREEN_DEFS` entry used
`hue: 'var(--type-fighting)'`, which collides with the existing Battle screen's hue — the app
requires every screen to carry a distinct one. Fixed by using `var(--type-ghost)` instead (an
unused hue; also a reasonable fit — the opponent in a blind queue is unseen until the pairing
lands) and re-ran.

Second run: **EXIT=0**.

```
 Test Files  81 passed (81)
      Tests  1125 passed (1125)
   Duration  29.83s
```

## `npm run check:db` / migrations / dev server

Not touched. No migration, no `db:start`/`db:reset`, no dev server started, per the task
constraints.

## Uncertain / open

1. **`formatVersionId` sourcing** (above) — the central open question. The screen is honest about
   not having a real one; it doesn't yet let anyone actually queue against production.
2. **No `myOffers()`-style listing in `matchmaking.ts`** — worked around client-side (session-only
   tracking of posted offers), not fixed, per "don't modify matchmaking.ts."
3. Roster size is hardcoded to 3 (`ROSTER_SIZE`) for the canonical open queue/board. Nothing in
   Task 7's interface or this task's brief says whether Show 6 rosters should ever reach
   matchmaking; I judged 3 as the only sane default given `matches.rounds check (rounds in (3, 5))`
   and every other GBL-style flow in this app defaulting to 3.
4. Each match row renders the plain text "Match paired" rather than the opponent's display name —
   `Match.opponentId` is a profile id, not a species ref or display name, and no lookup for a
   profile's display name was in scope here.
