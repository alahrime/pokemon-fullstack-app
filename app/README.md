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

## Layout

```
src/
  lib/          engine, data loading, query language — no React
    engine.ts   IV tables, breakpoints, the battle simulator
    data.ts     species loading, refs, roster filtering
    query.ts    search query language
    cpm.ts      CP multipliers, level 1–51
  components/   presentational; state comes from props
  screens/      Report (analysis) and Battle (head-to-head)
  state/        AppState — one store, no per-screen state
  styles/       tokens.css first, then components/leagues
  data/         GENERATED — see below
scripts/        data generation and verification
```

## Generated data

`src/data/species.json` is **generated — never hand-edit it.**

```bash
npm run data
```

Four passes, slowest last:

| step | writes | cost |
|---|---|---|
| `build-data.mjs` | `species.json` | seconds |
| `build-best-spreads.ts` | best IV roll per league | seconds |
| `build-matrix.ts` (`npm run matrix`) | `rankings.json`, `matrix.json` | ~165s |
| `build-teams.ts` (`npm run teams`) | `teams.json` | minutes |

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

**Verify by measuring.** For engine changes, diff a wide output surface by hash
before and after. For layout, measure the DOM rather than judging from a
screenshot; several alignment bugs here were under 5px, invisible at screenshot
scale and obvious on the page. See `.claude/skills/paragon-frontend/SKILL.md`.

## Known gaps

`BACKLOG.md` at the repo root tracks open work. The largest is battle-simulator
accuracy against PvPoke, and the three species held out of the roster.
