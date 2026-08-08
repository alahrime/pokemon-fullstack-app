# paragon-iv

A Pokémon GO PvP analyser. Pick a species and an IV roll, and it answers the
question the in-game appraisal cannot: **does this roll actually change any
matchup?**

Rank within the 4096 is the easy part. The board on the report screen is the
point — the opponents where your specific spread crosses a breakpoint,
bulkpoint or charge-move priority threshold, and so decides the fight.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # tsc, lint, data + engine verification — run before committing
```

`npm run check` is the gate. It runs `verify-data`, which asserts engine and
data invariants against the real modules rather than a reimplementation. When
it fails, decide whether the assertion or the change is wrong — several
assertions encode rules that were deliberately replaced later, so a failure
sometimes means the fixture is stale. Don't relax one to go green without
making that call explicitly; two of them have caught real bugs.

## Tests

```bash
npm run test          # 630 tests, ~10s
npm run test:watch
npm run coverage
```

`npm run check` ends with the suite, so the gate covers it.

99.0% of statements, 91.0% of branches, and every one of the 523 functions is
executed at least once. Those figures are *of what is included* —
`vitest.config.ts` excludes the generated data, the entry point, and
`Heatmap3D.tsx` (a WebGL canvas that cannot mount in jsdom). That list used to
carry `SpriteAudit.tsx` as well, for convenience rather than necessity; it is an
ordinary React screen behind the `AUDIT === 'sprites'` flag, and it now has a
suite of its own.

Three things about this suite that are not obvious:

**Randomness is seeded.** The battle screen opens on a random matchup and the
empty search offers a random draw, both rolled at module load — before any test
body runs, so a `vi.spyOn(Math, 'random')` inside a test is too late. `src/test/
setup.ts` installs a seeded PRNG instead, which is what makes the suite
reproducible. A test that depends on *which* Pokemon was drawn must pin the
species itself; one battle test does, and says why.

**jsdom applies no stylesheet.** Any assertion about computed layout is
therefore worthless there. Tests assert structure (which element is inside
which, what classes exist); geometry is measured in the browser instead, and
a few rules are asserted by reading `components.css` as text — see the
`.team-slots` guard, which exists because two rules for that selector once
disagreed and the dead one came first in the file.

**Read the signature before writing the test.** Nearly every failure while
building this suite was an assumed API rather than a broken one — `,` is the
query language's *or* and `&` its *and*; `fastMoveCounts` cycles rather than
decreasing; `toCsv` deliberately emits a BOM and CRLF. If a test disagrees with
the code here, the code has usually been right.

## Layout

```
src/
  lib/          engine, data loading, query language — no React
    engine.ts   IV tables, breakpoints, the battle simulator
    data.ts     species loading, refs, roster filtering
    query.ts    search query language
    cpm.ts      CP multipliers, level 1–51
    palette.ts  colour derivation + WCAG rules, shared with scripts/
    artefact.ts checked reads of the generated JSON
    pressure.ts energy rate, coverage breadth, turns-to-threat
  components/   presentational; state comes from props
  screens/      Report (analysis) and Battle (head-to-head)
  state/        AppState — one store, no per-screen state
  styles/       tokens.css first, then components/leagues
  data/         GENERATED — see below
  test/         setup (jsdom stubs, seeded PRNG) and the render helper
scripts/        data generation, theme generation, verification
tools/          layout-snapshot.js — the styling-refactor harness
```

## Generated data

`src/data/species.json` is **generated — never hand-edit it.**

```bash
npm run data
```

Five passes, slowest last. The last one is an hour, not "minutes" — measured
at 524M/547M/423M chains for great/ultra/master — so plan around it rather than
starting it to see what happens:

| step | writes | cost |
|---|---|---|
| `build-data.mjs` | `species.json` | seconds |
| `build-best-spreads.ts` | best IV roll per league | seconds |
| `build-matrix.ts` (`npm run matrix`) | `rankings.json`, `matrix.json` | ~5 min |
| `build-teams.ts` (`npm run teams`) | `teams.json` | **~1 hour** |
| `build-summary.ts` (`npm run summary`) | `summary.json` | seconds |

`build-best-spreads.ts` is bundled through esbuild so it uses the real `bestAt`
rather than a copy. That makes **esbuild a build dependency of the data**, not
just of `verify`: a `node_modules` restored from a different OS or architecture
breaks `npm run data`.

Output is deterministic. Regenerating with unchanged inputs leaves the file
byte-identical, so a dirty diff means the upstream data actually changed.

The last two steps are independent of the first two and of each other's inputs
only in one direction — `build-teams` reads `rankings.json` for its stratum
orderings, so `npm run matrix` must have run first. Each records a revision
(`ENGINE_REV`, `TEAM_REV`) that the UI reads back, so a stale artefact shows up
as a visible warning rather than as numbers that quietly disagree.

See `../data-src/README.md` for where the inputs come from and how league
membership is decided.

## A few rules worth knowing

**Refs, not ids.** A selection is a ref like `machamp` or `machamp_shadow`.
Shadows are not separate rows — they share stats, typing and movepool, so
`parseRef`/`makeRef` carry the flag and the engine applies ×6/5 attack and
×5/6 defence. Those cancel exactly, so Shadow never moves rank or CP; it moves
every damage threshold.

**And nothing but damage thresholds.** Those multipliers are combat modifiers,
not stat changes — the reason a Shadow has its plain form's CP at all. So
anything comparing *stats* rather than computing damage must not see them, and
charge-move priority is exactly that: `BattleMon.cmpAtk` and
`RankedEntry.statAtk` carry the Attack stat, `atk` carries the damage attack,
and the four CMP decision sites read the former. Stat stages are genuine stat
changes and do still count. Reading `atk` there made a Shadow contest priority
its plain form could not, on 10% of board rows — see BACKLOG §1p.

**Two different exclusion mechanisms.** `data-src/pool-exclusions.json`
controls league membership at build time and affects who is an *opponent*.
`UNSIMULATED_IDS` in `lib/data.ts` lists species the engine cannot model at all
(Mimikyu's shield, Morpeko's form change, Aegislash's stance) and filters them
at runtime from *every* picker and pool. Emptying that set restores them with
no other edit.

**Per-species state must reset with the species.** Anything in `AppState`
holding a move or spread selection has to clear in the same `patch` that
changes the species — a carried-over selection silently renders moves the new
species doesn't have.

**Themes are generated, not hand-written.** `scripts/build-themes.ts` bakes the
type themes into `styles/types-themes.css`, deriving every ramp from five
colours and refusing to emit a palette that misses WCAG AA — 4.5:1 for body
text, 3:1 for the faint tier. `npm run check` regenerates and re-checks, so a
hand-edit to that file cannot ship. The derivation lives in `lib/palette.ts`,
shared with the runtime custom-theme editor, so the code deciding whether a
shipped theme is readable is the code deciding it for a user's own.

Two details that look odd until you know why. Each theme block also matches
`.theme-swatch-face[data-theme='…']`, which is how the picker previews a
palette in the palette itself rather than a copy that can drift — and it is on
the *tile* rather than the button because on the button it recoloured the label
too, making every light theme's name unreadable. And `token-parity` reads both
theme stylesheets: it exists to catch a theme missing a token, and the
generated set is no more exempt than the hand-written one.

**Verify by measuring.** For engine changes, diff a wide output surface by hash
before and after. For layout, measure the DOM rather than judging from a
screenshot; several alignment bugs here were under 5px, invisible at screenshot
scale and obvious on the page. See `.claude/skills/paragon-frontend/SKILL.md`.

**A length that is a floor must be able to stop being one.** Every screen used
to scroll sideways on a phone, and every cause was the same shape: a fixed
length a narrow container could not honour — `minmax(360px, 1fr)` in a 327px
column, `min-width: 280px` in a 272px one, three league tabs measuring 410px on
a 375px screen. The rule is `min(Npx, 100%)` for anything acting as a floor;
small floors on numeric cells are left alone deliberately, because the narrowest
column this app produces is ~272px and they can always be honoured.

Past that, two shapes: layouts that **stack** (`.rs-split` at 820px, `.bt-pair`
at 680px — and the rule between a stacked pair has to turn with it) and controls
that **scroll** (`.seg-group`, every wide table inside `.table-scroll`). A
segmented control scrolls rather than wraps because it reads as one switch.
Breakpoints are where *this content* stops fitting, not where a device is.

Heights matter as much as widths, and less obviously. `SpeciesSearch` measures
the room below itself and fits its list to it — the ceiling passed as
`listHeight` is a maximum, not a height — and opens upward when the field sits
too low for any list beneath it. CSS cannot do this: it does not know where on
the page the field is. It fits inside the nearest clipping ancestor rather than
the window, which is what keeps the modal's list off its own footer.

`src/components/__tests__/responsive.test.tsx` holds the shape of each of those
as a text property of the stylesheet. jsdom lays none of it out, so the widths
themselves were measured in the browser, screen by screen, at 320, 375, 768,
1280, 1440 and 1920.

`tools/layout-snapshot.js` is the harness for styling refactors: it records the
computed style of every rendered element on every screen, keyed by position in
the DOM so a renamed class does not register as a change. Copy it to
`public/__snap.js` to use it — it is kept out of `public/` so it never ships.
Establish the noise floor first by diffing two runs of *unmodified* code; on
this app that is 0 of 12,060 elements, which is what makes a later number mean
anything. It caught a real regression during the inline-style refactor: table
headers lost their centring because `.table th` has specificity (0,1,1) and
beats a bare class wherever it sits in the file.

## Known gaps

`BACKLOG.md` at the repo root tracks open work. The largest is battle-simulator
accuracy against PvPoke, and the three species held out of the roster.
