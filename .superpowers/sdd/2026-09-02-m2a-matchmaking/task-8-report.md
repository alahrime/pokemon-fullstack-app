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

---

# Task 8 — fix round (F1–F5)

Fresh implementer; the original ran on a rate-capped model. Review returned spec ❌ with four
Important findings; F5 was folded in because it depends on the same work.

## Status

Done. `cd app && npm run check > /tmp/task-8-fix-gate.log 2>&1` → **EXIT=0**, 81 files,
**1140 passed** (was 1125; +15 net). Screen suite 22 tests, `lib/matchmaking` 25, `lib/saves` 19.

## The ruling, implemented first, because F2 and F5 both stand on it

M2a queues under a format the person has **saved on the server**. Canonical league formats are
deferred to the ranked milestone. So:

- `app/src/lib/saves.ts` — `listServerFormats` now selects `format_versions(id, …)` and
  `SavedFormat` carries `versionId` (`format_versions.id`, a different table from `id`, which is
  `formats.id`).
- `app/src/screens/MatchmakingScreen.tsx` — the `canonical:${league}` placeholder is **gone**. The
  screen reads `listServerFormats()`, filters to formats whose `format.base` is the league on
  screen, renders them as `.seg-btn` chips, and passes the chosen one's `versionId` and `format`
  to `joinQueue`/`createOffer`. Roster size now comes from the chosen format's
  `composition.size` rather than a constant, and a roster longer than a newly chosen format's size
  is truncated (otherwise members past the size are invisible but still counted, and the roster can
  never be "ready" again).
- With no saved format for this league: a `.no-formats` message, and **no Join and no Post control
  at all** — same rule as F1.

## F1 — a Confirm control that could only fail

Confirm now renders only for `proposed && o.state === 'accepted'`. A live offer goes
`open → converted` on acceptance and never reaches `accepted`, and `confirm_offer` raises
`'only the proposer confirms'` for the taker, so Confirm anywhere else was a button whose whole
behaviour was to print raw Postgres text at someone.

## F2 — the dead end on both sides

New listing function in `app/src/lib/matchmaking.ts`:

```ts
export interface MyOffer extends Offer { matchId: string | null }
export async function myOffers(): Promise<MyOffer[]>
```

`getSession()` (never `getUser()`), throws `new Error(error.message)`, types the PostgREST row at
the boundary, sends no owner column. Filters
`.or('proposer_id.eq.<me>,accepted_by.eq.<me>')` — proposed **or** accepted, in **every** state —
and selects `match_id` on top of `listOpenOffers`'s columns, since a state string alone cannot say
which match a confirmed offer became. Both halves are already readable under the existing policies
("an offer belongs to the person who proposed it" for the proposer, "a public offer is readable by
anyone signed in" for the taker).

The screen's `posted` session state is deleted. The panel (`.my-offer-list`) is driven by
`myOffers()`, loaded on mount and re-read after post / accept / confirm. Status text is written
from the reader's own side — `accepted` is "Confirm it to make it a match" to the proposer and
"awaiting the proposer's confirmation" to the taker; telling either one the other's sentence is how
someone waits for a handshake that was waiting for them.

Also covered in `app/src/lib/__tests__/matchmaking.test.ts` with the existing `harness` (extended
by an `or` recorder, and `select` now records its column list): four new tests — the filter shape,
the full field mapping for both sides, the presence of `match_id`/`scheduled_for`/`accepted_by`/
`state` in the select, and the signed-out refusal.

## F3 — the offer board no longer expands

`app/src/styles/components.css` gains a Matchmaking section. `.offer-list` (and `.my-offer-list`)
now carry `max-height: 240px; overflow-y: auto`, written out as complete standalone rules rather
than grouped with `.match-list`, so the cap lives in the one rule anyone comes here to read (the
`.team-slots` trap). Existing tokens only — `--space-1/2/3`, `--text-sm`, `--font-mono`,
`--color-accent`, `--color-accent-2-700`, `--border-strong`. No new colour literals.

## F4 — mutation evidence

Nothing here was proved by a collective import failure. Each assertion was watched to fail against
a deliberately broken implementation, then watched to pass once restored.

### F1 — `{proposed && o.state === 'accepted' && …}` → `{proposed && …}`

```
./node_modules/.bin/vitest run src/screens/__tests__/matchmaking.test.tsx \
  -t "offers no Confirm on an offer nobody has accepted yet"    EXIT=1

 FAIL  … > offers no Confirm on an offer nobody has accepted yet
AssertionError: expected …(2) to have a length of +0 but got 2
- Expected  0
+ Received  2
 ❯ src/screens/__tests__/matchmaking.test.tsx:511:58
```

Restored → `EXIT=0`, `Tests  1 passed | 21 skipped (22)`.

### F2 — the effect's `myOffers()` → `Promise.resolve([])` (i.e. back to session-only state)

```
… -t "handshake survives a reload"                              EXIT=1
⎯ Failed Tests 4 ⎯
 FAIL  … > rediscovers an offer awaiting your confirmation, and confirms it
Error: offer row not rendered yet
 FAIL  … > tells the taker their acceptance is waiting on the proposer, and gives them no Confirm
Error: offer row not rendered yet
 FAIL  … > offers no Confirm on an offer nobody has accepted yet
Error: not rendered yet
 FAIL  … > shows a confirmed offer as a match rather than as something still to do
Error: offer row not rendered yet
      Tests  4 failed | 18 skipped (22)
```

Restored → `EXIT=0`, `Tests  4 passed | 18 skipped (22)`.

### F2, library half — `.or(proposer|accepted)` → `.eq('proposer_id', me).eq('state','open')`

```
./node_modules/.bin/vitest run src/lib/__tests__/matchmaking.test.ts \
  -t "lists offers I proposed and offers I accepted"             EXIT=1

AssertionError: expected undefined to be 'proposer_id.eq.me,accepted_by.eq.me'
 ❯ src/lib/__tests__/matchmaking.test.ts:241:25
```

Restored → `EXIT=0`, `Tests  1 passed | 24 skipped (25)`.

### F3 — `max-height` and `overflow-y` deleted from `.offer-list`

```
… -t "caps the open board"                                       EXIT=1

AssertionError: expected '.offer-list {\n  list-style: none;\n …' to match /max-height:\s*\d/
+ Received:
".offer-list {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}"
 ❯ src/screens/__tests__/matchmaking.test.tsx:549:18
```

Restored (byte-for-byte, verified with `diff -q`) → `EXIT=0`, `Tests  1 passed | 21 skipped (22)`.

### F5 — `formatVersionId: chosen.versionId` → `` `canonical:${league}` ``

```
… -t "joins the queue with the roster and format on screen"      EXIT=1

AssertionError: expected 'canonical:great' to be 'fv-great-2' // Object.is equality
 ❯ src/screens/__tests__/matchmaking.test.tsx:229:33
```

Restored → `EXIT=0`, `Tests  1 passed | 21 skipped (22)`.

The old assertion (`typeof … === 'string'` and `.length > 0`) passed against `canonical:great`
throughout — which is the point of F5.

## F5 — the join assertion, tightened

`expect(arg.formatVersionId).toBe('fv-great-2')`, plus `.not.toBe('f-great')` (the format id — the
wrong table, and a mistake that would fail the foreign key just as quietly), plus
`expect(arg.format).toEqual(savedFormat().format)`. Two more screen tests: no Join when there are
no saved formats, and "queues under the format that was chosen, not the first one listed" (clicks
the second chip, asserts `fv-cup-7`). In `saves.test.ts`, `listServerFormats` now asserts
`versionId === 'fv-3'` from the winning version's row, `versionId !== id`, and that the embed
actually asks for `format_versions(id …)`.

## Deferred, as instructed — not touched

A successful confirm renders no acknowledgement; `justAccepted` is never cleared; the
scheduled-vs-live negative assertion keys on an exclamation mark.

## Uncertain

1. **The `.or()` filter interpolates the session user id into a PostgREST filter string.** It is a
   uuid from the local session, not user input, and both halves are independently enforced by RLS,
   so a malformed value can only fail the query. It is still the first `.or()` in this codebase —
   if there is a house preference for two round trips over an interpolated filter, this is the
   place it would apply.
2. **Roster size now follows `composition.size`.** Nothing in Task 7's API or the DB validates a
   roster against the format at queue time (`matches.rounds check (rounds in (3,5))` is rounds, not
   roster), so this is the client being honest rather than a constraint being satisfied. A format
   with an unusual size will render that many slots.
3. **`useFormats()` is still not the source here** — it merges local and server formats and drops
   `versionId`, so this screen calls `listServerFormats()` directly. That means a format saved only
   in localStorage (signed out, never migrated) does not appear on this screen. Correct, I think —
   you cannot queue under rules the server has never seen — but it is a visible difference from the
   Formats screen.
4. **`match_offers` has no realtime subscription.** The panel is accurate on load and after every
   action this screen takes, but a proposer sitting on the page while someone accepts still has to
   reload (or act) to see it. That is a strictly better failure than the old one — the state is now
   recoverable at all — but it is not live.
