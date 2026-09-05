# Task 5 report: the match screen

## Summary

Created `app/src/screens/MatchScreen.tsx` — the screen a paired match now goes
to, where a player reports the rounds they played (client-side gated by
`isCompleteScoreline`, a restatement of the database's `is_valid_scoreline`
check constraint, never the authority) and sees the adjudicated per-round
result once one exists. Registered it as the `match` screen in
`app/src/lib/screens.ts` with hue `var(--type-ground)`. Wired the "Match
paired" row on `MatchmakingScreen.tsx` into an "Open match" button that
navigates there. Wrote `app/src/screens/__tests__/match-screen.test.tsx`
first, watched it fail for the right reason, then implemented.

Commit: `a106bf5` on `feat/m2b-reporting` — **not pushed**, see "Not pushed"
below.

## Files touched

- `app/src/screens/MatchScreen.tsx` — new.
- `app/src/screens/__tests__/match-screen.test.tsx` — new.
- `app/src/lib/screens.ts` — added the `match` entry to `SCREEN_DEFS`.
- `app/src/screens/MatchmakingScreen.tsx` — the match-list row now renders a
  button instead of static text; `useAppState()` now also destructures
  `patch`.
- `app/src/state/AppState.tsx` — deviation, see below.
- `app/src/App.tsx` — deviation, see below.

`app/src/lib/matches.ts` and `app/src/lib/matchmaking.ts` were not touched, as
instructed (another agent was reviewing them). Nothing under `supabase/` was
touched.

## TDD: failing run, then passing run

The brief's test imports `{ render } from '../../../test/render'` — wrong name
and wrong depth, exactly as flagged. I used `renderApp` from
`'../../test/render'` per the correction. I also found the brief's test uses
`@testing-library/user-event`, **which is not a dependency of this project**
(`grep -n "@testing-library" app/package.json` shows only
`@testing-library/jest-dom` and `@testing-library/react`; no other test in the
suite imports `user-event`). I rewrote the three tests to use `fireEvent` from
`@testing-library/react` instead — the house convention used throughout
`interactions.test.tsx` and `screen-leaves.test.tsx` — keeping every assertion
identical to the brief's version. This is a third, previously-unflagged
inaccuracy in the brief, not a weakening of any assertion.

First run, before `MatchScreen.tsx` existed:

```
$ cd app && npx vitest run src/screens/__tests__/match-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"
EXIT=1
...
Error: Failed to resolve import "../MatchScreen" from "src/screens/__tests__/match-screen.test.tsx". Does the file exist?
```

(An earlier attempt with the brief's own `userEvent` import failed one step
earlier, on `Failed to resolve import "@testing-library/user-event"` — this is
what surfaced the missing dependency before the expected "no MatchScreen"
failure could even be reached.)

After implementing `MatchScreen.tsx`:

```
$ cd app && npx vitest run src/screens/__tests__/match-screen.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
EXIT=0
 ✓ src/screens/__tests__/match-screen.test.tsx (3 tests) 111ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Full gate

```
$ cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests  " /tmp/app.log
EXIT=0
 Test Files  85 passed (85)
      Tests  1216 passed (1216)
```

Before this task: 1213/1213 (per the brief). After: 1216/1216 — exactly the 3
new tests added, 0 pre-existing tests modified or widened. `tsc -b` and
`oxlint` both passed clean (oxlint emitted only pre-existing warning classes —
e.g. `react(only-export-components)` for `MatchScreen.tsx` exporting both
`isCompleteScoreline` and the component, the same warning `AppState.tsx` and
`ThemeContext.tsx` already carry for the same reason).

## Hue chosen: `var(--type-ground)`

Verified free by reading `app/src/lib/screens.ts` before editing: the 11
existing entries claim normal, water, electric, grass, fighting, psychic,
ghost, dragon, dark, steel, fairy. `--type-ground` is defined in
`app/src/styles/types.css:26` and not used by any `SCREEN_DEFS` entry.
`src/lib/__tests__/screens.test.ts`'s hue-uniqueness test passed as part of
the full run above (6/6 in that file). Comment explains the choice the same
way the `matchmaking` entry does: not `--type-fighting` (Battle already
carries it), and thematically Ground was chosen deliberately as the
counterpoint to Battle — Battle prices a simulated fight, Match reports the
real one, grounded in what actually happened in Pokémon GO.

## Deviation: `AppState.tsx` and `App.tsx` were also touched

Not in my assigned file list, and I want to be explicit about why.

The brief's interface line — "a `match` screen id registered in `screens.ts`,
reached with a `matchId`" — and the orchestrator's own "SCREEN REGISTRATION"
instructions require adding an entry to `SCREEN_DEFS`. But `ScreenDef.id` is
typed as `Screen`, imported from `AppState.tsx`, and `App.tsx`'s `Nav`
unconditionally renders one clickable top-level tab per `SCREEN_DEFS` entry,
routed by `Screens()`'s `switch (state.screen)`. Concretely, this means:

1. Adding `id: 'match'` to `SCREEN_DEFS` **does not type-check** unless
   `'match'` is added to the `Screen` union — there is no way to register the
   screen in `screens.ts` alone.
2. Once `'match'` is a valid `Screen`, it necessarily becomes a real, live
   Nav tab (the map in `App.tsx`'s `Nav` is unconditional over
   `SCREEN_DEFS`). Leaving `Screens()`'s switch without a `'match'` case
   would make that tab render nothing when clicked — a dead tab shipped in a
   "gate-green" state, which felt like the wrong kind of finished.

So I made the minimal additive changes needed for the tab to actually work:
- `AppState.tsx`: added `'match'` to the `Screen` union, and one new field,
  `activeMatch: Match | null` (default `null`), carrying the whole fetched
  `Match` object rather than just an id — the caller (the row on
  `MatchmakingScreen`) already has it, so storing just an id would force a
  refetch-by-id that `lib/matches.ts` does not even expose (only bulk
  `myMatches()` exists).
- `App.tsx`: imports `MatchScreen` and `myMatches`; `Screens()` now
  destructures `patch` too; added a `case 'match'` that renders
  `<MatchScreen match={state.activeMatch} onChanged={...} />` when
  `activeMatch` is set, refetching the match list and re-selecting the same
  id in `onChanged` (the only way to learn the new `MatchState` after a
  submit, since `lib/matches.ts` exposes no single-match read), and a plain
  `<div className="panel text-muted">` fallback ("No match selected — open
  one from the Matches screen.") for the edge case of reaching the tab
  directly with no active match — mirrors the existing
  `<div className="panel text-muted">` fallback already used for the
  signed-out state elsewhere in `MatchmakingScreen.tsx`.

I verified this doesn't break anything already testing `App.tsx`'s nav or
`AppState.tsx`'s shape: `app-shell.test.tsx` clicks tabs by exact label
("Rankings", "Battle", "Report") and never touches "Match"; `screens.smoke.test.tsx`
enumerates a hardcoded, hand-picked list of no-prop screens (not derived from
`SCREEN_DEFS`) and was already missing `MatchmakingScreen` for the same
reason `MatchScreen` couldn't be added to it (both need props/session this
list doesn't supply). Full run above is 1216/1216 green with these changes
included.

If this deviation is unwanted, the fix is one-line-revertible: drop the
`SCREEN_DEFS` entry and the `AppState.tsx`/`App.tsx` edits, and `MatchScreen`
still works exactly as tested — it is a plain, prop-driven component with no
dependency on global nav at all (see how the test renders it directly).

## Not pushed

`.superpowers/sdd/2026-09-05-m2b-reporting-and-adjudication/progress.md`
(present before I started, not edited by me) shows this plan is being run by
a coordinator across multiple tasks with its own review rounds
(`review-*.diff` files, `task-N-report.md` per task, "fix round" language).
Given that structure is clearly already in place and active, I committed to
`feat/m2b-reporting` but did not push or fast-forward to `main` — that reads
like the coordinator's call to make after its own review pass, not mine to
take unilaterally mid-pipeline.

## Uncertain / worth a second look

- The `HEADLINE` copy for `unverified` and `abandoned` states is inferred
  from `supabase/migrations/20260905122000_sweep_matches.sql` (unverified:
  "silence costs the record... a match neither side reported is kept for
  analytics and excluded from every rating") and from
  `20260904071716_handshake_columns_are_server_only.sql`'s comment that
  "nothing in M2a sets state = 'abandoned'" — i.e. `abandoned` is inherited
  from the M2a `matches` state machine and nothing in M2b's reporting flow
  ever produces it. I described it generically ("this match will not be
  played") rather than guessing at M2a specifics I haven't reviewed.
- "Open match" as the button label on `MatchmakingScreen.tsx` is deliberately
  state-agnostic (it opens the match regardless of whether it's paired,
  reported, mismatched, etc.) rather than mirroring the screen's own
  per-state headline — avoids duplicating `MatchScreen.tsx`'s `HEADLINE`
  knowledge into a second file. Worth reconsidering if a reviewer wants the
  list to preview state before the click.
- No CSS was added. `MatchScreen.tsx` reuses existing classes throughout
  (`.panel`, `.hud-label`, `.btn`, `.btn-primary`, `.btn.seg-btn`,
  `.match-list`, `.match-row`) plus two new, currently-unstyled hooks
  (`.round-row`, `.match-alert`) that fall back to plain block/paragraph
  rendering. Nothing was verified visually in the browser — this was scoped
  and executed as pure TypeScript/TSX with the test suite as the only
  verification surface, per the task's framing.

---

## Fix round: four review findings

Fixed in `app/src/screens/MatchScreen.tsx` and
`app/src/screens/__tests__/match-screen.test.tsx` only. Did not touch
`app/src/lib/matches.ts`, anything under `supabase/`, or any other file.
`App.tsx` and `AppState.tsx` were read (to confirm the static-`key="match"`
mechanism Finding 2 describes and to check `MatchState`/`myMatches`
signatures) but not edited — the fix lives entirely inside `MatchScreen.tsx`.

### Finding 1 — "unanswered" and "they won" were the same state

**Change.** `iWon` is now `Array<RoundResult>` where
`type RoundResult = boolean | null` — `null` means "nobody has answered this
round yet," kept as an explicit value rather than an array hole. `setRound`
now pads any never-touched earlier round with `null` instead of `false`:

```ts
function setRound(i: number, won: boolean) {
  setIWon((prev) => {
    const next = prev.slice(0, i);
    while (next.length < i) next.push(null);
    next[i] = won;
    return next;
  });
}
```

The truncation (`slice(0, i)`, dropping everything from index `i` onward) is
unchanged — that half was already correct and is kept intentionally, per the
brief. `isCompleteScoreline` now takes `RoundResult[]` and returns `false`
immediately if any entry is `null` (`iWon.some((w) => w === null)`) before
running the original best-of-N arithmetic on the narrowed `boolean[]`. Button
`aria-pressed` is now `iWon[i] === true` / `iWon[i] === false` (strict
equality against both possible answers), so an out-of-range index and an
explicit `null` both render as neither button pressed. `send()` guards with
`iWon.filter((w): w is boolean => w !== null)` before calling `toMatchTerms`
— defensive only, since Submit is disabled whenever `complete` is false, but
it lets TypeScript see the narrowed `boolean[]` without an `as` cast.

**Tests added** (`app/src/screens/__tests__/match-screen.test.tsx`):
- `leaves earlier rounds visibly unanswered when a later round is clicked
  first, and blocks submission` — clicks "Round 3: I won" first and asserts
  neither button of rounds 1 or 2 is pressed, and Submit is disabled.
- `a correction to a later round does not leave an earlier backfilled claim
  behind` — see the deviation note below; this is test (b).

**Deviation from the brief's literal test (b), and why.** The brief's test
(b) is described as: click "Round 3: I won", then click "Round 1: I won" to
correct it, and assert the result is not the dishonest `[true, true]`. I
worked through this sequence by hand against both the old and new
`setRound` and found it **cannot discriminate the two implementations**:
`prev.slice(0, 0)` is `[]` regardless of what filled the discarded slots, so
after exactly those two clicks the visible `iWon` is `[true]` under *both*
the buggy and the fixed code — editing index 0 always fully truncates,
which wipes the backfill artifact along with everything else. I confirmed
this empirically (see the revert experiment below): a test asserting the
state after literally those two clicks passed unchanged with the old
`setRound` restored, which by the task's own rule ("a test that passes
either way does not cover the finding") disqualifies it.

I wrote test (b) as: click "Round 3: I won" first, then click "Round 2: they
won" (not round 1) to answer the middle round honestly. Editing an index
other than 0 leaves round 1 *inside* the truncated array's bounds, so the
old code's `false` backfill at index 0 survives into the final state — and
critically, `[false, false]` is a *complete, submittable* scoreline (a
false, clean 2-0 loss the player never reported), whereas the fixed code
correctly leaves round 1 as `null` (a gap), blocking submission. This is the
same class of defect the brief describes (a clean scoreline manufactured
from an unanswered round), reached through a sequence that a revert of the
fix demonstrably fails. Test (a) above is the one that pins the brief's
literal round-3-then-round-1 scenario at the point where it actually is
observable — immediately after the first click, before the correction
truncates the evidence away.

**Revert experiment**, run before writing this report:

```
$ cp src/screens/MatchScreen.tsx /tmp/MatchScreen.tsx.fixed
# setRound's `next.push(null)` changed back to `next.push(false)` only —
# nothing else in the file touched.
$ cd app && npx vitest run src/screens/__tests__/match-screen.test.tsx > /tmp/revert2.log 2>&1; echo "EXIT=$?"
EXIT=1
 × leaves earlier rounds visibly unanswered when a later round is clicked first, and blocks submission
   Expected aria-pressed="false", received "true"
 × a correction to a later round does not leave an earlier backfilled claim behind
   Expected aria-pressed="false", received "true"
 Tests  2 failed | 5 passed (7)
```

Both new Finding-1 tests failed, and only those two — the other five
(pre-existing plus the Finding-2/3 tests written for this fix round) were
unaffected, confirming the failures are specific to the reverted line. Then:

```
$ cp /tmp/MatchScreen.tsx.fixed src/screens/MatchScreen.tsx
$ cd app && npx vitest run src/screens/__tests__/match-screen.test.tsx > /tmp/restored.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### Finding 2 — the screen did not refresh when the match transitioned

**Change.** Added a `liveState` piece of state (`MatchState`, seeded from
`match.state`) that the render now reads instead of `match.state` directly
(`HEADLINE[liveState]`, the `open` gate, and the "Amend my report" label all
switched over). The load effect's dependency array grew to
`[match.id, match.mySide, match.state]`, and the effect body now does two
things on every run (mount, and any dependency change): syncs
`liveState` from the prop immediately, then calls `myMatches()`,
finds this match by id in the result, and overwrites `liveState` with
whatever state that call reports.

**Mechanism chosen, and why over the alternative.** The brief offered two
pieces: (A) add `match.state` to the effect's deps so a transition on the
same mounted instance refetches, and either (B) have the screen reconcile
its own match via `myMatches()` on mount, or (C) have the navigation path
refresh `activeMatch` before handing it to the screen.

I implemented A *and* B together, not A-with-C, because the two staleness
bugs in the finding have different triggers and only B closes both:

- The "same mounted instance" bug (submit flips `mismatch` to `confirmed`,
  headline updates but rounds don't) is fixed by A alone, given the
  `onChanged` callback already wired up in `App.tsx` (from Task 5's original
  implementation): it re-fetches `myMatches()` and patches the result back
  into `activeMatch`, which re-renders this same instance with a new
  `match.state` prop. Adding that prop to the deps array is what makes the
  existing plumbing actually reach this component's effect.
- The "leave and come back" bug is **not** only reachable through the
  `MatchmakingScreen` "Open match" row — Task 5 added `'match'` to
  `SCREEN_DEFS`, so there is also a plain Nav tab for it
  (`App.tsx`'s `Nav` renders one button per `SCREEN_DEFS` entry via
  `onClick={() => set('screen', d.id)}`), which changes only `state.screen`
  and never touches `state.activeMatch`. Refreshing `activeMatch` at the
  point of the "Open match" button click (mechanism C) does nothing for a
  user who leaves via a different tab and returns by clicking the "Match"
  Nav tab directly — `activeMatch` is whatever it last was, however stale,
  and C's refresh point is never revisited. Only a fix inside `MatchScreen`
  itself, that reconciles on every mount regardless of which path led here,
  covers that route. B does this without touching `App.tsx` or
  `MatchmakingScreen.tsx` at all, which also keeps the change contained to
  the one file the task scoped this to.

`myMatches()` is called unconditionally (not just when the prop looks
stale) because there is no cheaper single-match read exposed by
`lib/matches.ts` (only bulk `myMatches()`), and the call is already guarded
by the existing `live` flag against a stale write after unmount or a newer
match arriving mid-flight. In the test environment `myMatches()` runs for
real (not mocked) against the stubbed, signed-out Supabase client that
`setup.ts` installs for the whole suite; `myId()` resolves to `undefined`
there, so `myMatches()` resolves to `[]` and the reconciliation call is a
harmless no-op in every test that doesn't specifically exercise it.

**Test added:** `refetches the adjudicated result when the same mounted
instance transitions state`. Mocks `adjudicatedRounds` as a `vi.fn()`
returning `[]` then a non-empty array on successive calls, renders with
`state: 'mismatch'`, then calls RTL's `rerender` — reusing the *exact same*
`ThemeProvider`/`SessionProvider`/`AppStateProvider` wrapper `renderApp`
uses internally (built by hand in the test file, since `rerender()` replaces
whatever tree was originally passed to `render()`, not just the component
under test) — with `state: 'confirmed'` on the same `<MatchScreen key=...>`
position. Asserts `adjudicatedRounds` was called a second time and that the
"Adjudicated result" list, including "Round 1: they won", now renders. This
does not unmount/remount `MatchScreen` (same component type at the same
tree position across the `rerender` call), which is the specific thing the
brief calls out an unmount/remount test would fail to cover.

### Finding 3 — untested "Amend my report" label

**Change.** None needed to `MatchScreen.tsx` — the code already renders
`'Amend my report'` when `liveState === 'mismatch'`.

**Test added:** `labels the submit control "Amend my report" while
mismatched` — renders with `state: 'mismatch'` and asserts
`getByRole('button', { name: /amend my report/i })` is present.

### Finding 4 — a comment citing the wrong source

**Change.** Replaced the comment above `const open = ...`. It previously
attributed the `paired`/`reported`/`mismatch`/`disputed` list to "the same
migration's sealing-policy comment." That list is actually the
FRIEND-CODE VISIBILITY policy's `state in (...)` clause in
`20260905120000_match_reports_and_rounds.sql` (~lines 108-113), which
governs friend-code readability, not which states accept a report. The new
comment cites `submit_report`'s actual guard instead
(`20260905121000_submit_report.sql`, ~line 21:
`if m.state not in ('paired', 'reported', 'mismatch') then raise
exception`), and drops `disputed` from the prose claim, since `open` — now
`liveState === 'paired' || liveState === 'reported' || liveState ===
'mismatch'` — never included it. No test was added for this one; it is a
comment-only correction with no observable behavior to assert.

### Full gate

```
$ cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  85 passed (85)
      Tests  1220 passed (1220)
```

1216 before this fix round, 1220 after — 4 new tests (two for Finding 1, one
for Finding 2, one for Finding 3), zero pre-existing tests modified,
widened, skipped, or deleted. `tsc -b` and `oxlint` both passed clean; the
only new `oxlint` line touching this file is the pre-existing
`react(only-export-components)` warning class for `MatchScreen.tsx`
exporting both `isCompleteScoreline` and the component (unchanged from
before this fix round, and already called out above).

Commit: see the top-level repo history on `feat/m2b-reporting` for the SHA
(one commit, covering `MatchScreen.tsx` and its test file only).
