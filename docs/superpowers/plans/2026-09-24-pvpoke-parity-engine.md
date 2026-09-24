# PvPoke parity: option A (vendored engine) against option B (our engine)

**Goal:** battles that match PvPoke's, battle for battle. Two routes, built side
by side and compared on the same measure before one becomes the app's engine.

**Measure:** `cd app && npm run parity` — every pair of the top 50 Great species
at 0/1/2 shields (3,675 battles), PvPoke's default IVs, levels and recommended
movesets, scored against PvPoke's own engine (`data-src/pvpoke-sweep-1500.json`,
checksummed). Reports exact end HP, same winner, mean HP gap and ms/battle.

## Where it stands (2026-09-24)

| Engine | Exact end HP | Same winner | ms/battle |
|---|---|---|---|
| A — vendored PvPoke (`app/vendor/pvpoke`, `src/lib/pvpoke.ts`) | 100.0% | 100.0% | 0.217 |
| B — ours, optimised timing (`src/lib/engine.ts` `battle()`) | 40.9% | 86.7% | 0.016 |
| B — ours, immediate timing | 35.2% | 85.1% | 0.010 |

B started at 35.3% / 85.4%; the chance-effect meter and simultaneous CMP ties
(f1d18e1) are already ported. A is PvPoke's code unmodified, so parity is by
construction; its costs are speed, bundle size and features ours has that
PvPoke's does not.

## Option A — remaining

- **A2 Adapter.** `BattleMon`/entry → PvPoke `Pokemon`: species id (Shadow via
  `_shadow`), level and IVs, moves by id, shields, start energy; map PvPoke's
  timeline back to `BattleResult` and `BattleLogEntry`. Parity stays 100% on
  the fixture and must hold for Ultra/Master spot checks.
- **A3 Feature gaps** — decisions, not code:
  - `read` shield policy (ours) — PvPoke has its own `wouldShield`; drop ours or keep it on B only.
  - `startHp` / carried energy for team chains — PvPoke has `startHp`/`startEnergy`; confirm they behave.
  - Immediate timing toggle — PvPoke's `optimizeMoveTiming = false`.
  - Battle log shape (bait flags, stat stages per entry) the screens read.
- **A4 Speed.** 14x slower. Rankings (`build-matrix`, `build-teams`) and the
  per-IV flip grids call `battle()` thousands of times; measure each, decide
  where A is used (e.g. A for the battle screen and rankings, B for the IV grids).
- **A5 Bundle.** PvPoke's gamemaster is 0.9 MB. Lazy-load it with the engine
  only where A runs, or trim it at build time to the fields the engine reads.
- **A6 Wire in** behind one switch, regenerate rankings, compare to the B build.

## Option B — remaining, in parity-impact order

Diagnosed from 24 sampled 0-shield mismatches (first divergence per battle):

1. **Move-timing rules** (ActionLogic 254–365): when to hold a charged move for
   the opponent's registration. Needs the opponent's remaining cooldown and
   PvPoke's turns-to-live search (65–140).
2. **Self-debuffing moves** (890–1000): defer until after survivable hits,
   stack, avoid baiting with them. Top winner flips: Shadow Snorlax,
   Deoxys-D, Malamar, Hisuian Electrode (Superpower, Psycho Boost, Wild Charge).
3. **Move-order planner** (439–804): PvPoke's DP over energy, HP, shields and
   buffs choosing which charged move and when.
4. **Shield decisions** (`wouldShield`, 1154–1260).
5. Cramorant stacking (cd729db) then follows PvPoke's planned move, not ours.

## Decision point

When A2–A5 and B1–B2 are done, compare on: parity, ms/battle, rankings runtime,
bundle size, features kept. Record the numbers here and choose.
