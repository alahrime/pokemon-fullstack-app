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
| A — through the adapter, our identifiers (`pvpokeBattle`) | 100.0% | 100.0% | 0.121 |
| B — ours, optimised timing (`src/lib/engine.ts` `battle()`) | 93.6% | 97.7% | 0.062 |
| B — ours, immediate timing | 61.9% | 93.9% | 0.033 |

B started at 35.3% / 85.4%. Ported so far: the chance-effect meter and
simultaneous CMP ties (f1d18e1, to 40.9%), then PvPoke's move-timing rule and
turns-to-live search (B1, to 49.5%), then its charged-move preferences and
self-debuff rules (B2, to 51.4% / 88.8%; 0 shields 68.7% / 94.0%), then its
shield decisions (B4, to 55.3% / 91.2%), then its whole decideAction flow and
move planner (B3, to 93.6% / 97.7%, mean HP gap 1.9). `npm run parity` is in `npm run check`
with floors: A must stay exact, B must not fall below where it stands. A is PvPoke's code unmodified, so parity is by
construction; its costs are speed, bundle size and features ours has that
PvPoke's does not.

## Option A — remaining

- ~~**A2 Adapter.**~~ Done (a66e229): 100% on the fixture; top-30 Ultra and
  Master levels and 870 battles match PvPoke's own runs. Original scope: `BattleMon`/entry → PvPoke `Pokemon`: species id (Shadow via
  `_shadow`), level and IVs, moves by id, shields, start energy; map PvPoke's
  timeline back to `BattleResult` and `BattleLogEntry`. Parity stays 100% on
  the fixture and must hold for Ultra/Master spot checks.
- **A3 Feature gaps** — decisions, not code:
  - `read` shield policy (ours) — PvPoke has its own `wouldShield`; drop ours or keep it on B only.
  - `startHp` / carried energy for team chains — PvPoke has `startHp`/`startEnergy`; confirm they behave.
  - Immediate timing toggle — PvPoke's `optimizeMoveTiming = false`.
  - Battle log shape (bait flags, stat stages per entry) the screens read.
- ~~**A4 Speed.**~~ Measured 2026-09-24: A costs 9.4x B per battle (0.140 vs
  0.015 ms over 3,000 random Great-pool battles at the matrix scenarios). The
  matrix build is 5.7 min on B (245M battles); on A ~54 min, ~27 min with the
  `read` policy it cannot run dropped. Report screen, Medicham: ranking every
  opponent 81 ms on B, ~764 ms on A; flip grid 1 -> ~10 ms; matchup rows
  0 -> ~3 ms. Original note: 14x slower. Rankings (`build-matrix`, `build-teams`) and the
  per-IV flip grids call `battle()` thousands of times; measure each, decide
  where A is used (e.g. A for the battle screen and rankings, B for the IV grids).
- ~~**A5 Bundle.**~~ Done: `scripts/build-pvpoke-data.mjs` (in `npm run data`)
  trims the gamemaster to what the engine reads, 904 -> 661 KB (114 -> 87 KB
  gzipped), and parity runs on that trimmed file. `loadPvPokeLazy()` loads
  engine and data in their own chunk on first call: ~142 KB gzipped against
  ~2.3 MB of app JS today, none of it on first load. Original scope: PvPoke's gamemaster is 0.9 MB. Lazy-load it with the engine
  only where A runs, or trim it at build time to the fields the engine reads.
- **A6 Wire in** behind one switch, regenerate rankings, compare to the B build.

## Option B — remaining, in parity-impact order

Diagnosed from 24 sampled 0-shield mismatches (first divergence per battle):

1. ~~**Move-timing rules**~~ Done (B1). The opponent's cooldown maps to
   `tB * 500` (0 when free); `(tB - 1) * 500` scored 31.7%. Original scope: (ActionLogic 254–365): when to hold a charged move for
   the opponent's registration. Needs the opponent's remaining cooldown and
   PvPoke's turns-to-live search (65–140).
2. ~~**Self-debuffing moves**~~ Done (B2): PvPoke's move order and best move
   (Pokemon.resetMoves), its overrides on the chosen move, defer and stack.
   Two branches assume no shield until B4 ports wouldShield. Original scope: (890–1000): defer until after survivable hits,
   stack, avoid baiting with them. Top winner flips: Shadow Snorlax,
   Deoxys-D, Malamar, Hisuian Electrode (Superpower, Psycho Boost, Wild Charge).
3. ~~**Move-order planner**~~ Done (B3): decideAction ported in order, DP
   included with its JS quirks kept (unprunable `hp`/`shields`, undefined
   `opponentShields`, stale `newEnergy`); our pickCharge and farm-down rule are
   gone. Skips only the Melmetal-vs-Cresselia case. Original scope: (439–804): PvPoke's DP over energy, HP, shields and
   buffs choosing which charged move and when.
4. ~~**Shield decisions**~~ Done (B4): Battle.js's shield call and wouldShield,
   for the `always` policy; our `read` policy is unchanged. (1154–1260)
5. Cramorant stacking (cd729db) then follows PvPoke's planned move, not ours.

## Decision (2026-09-24): option B

B is the app's engine (`battle()`): 93.6% exact / 97.7% same winner at half
A's cost, keeping the `read` policy, the bait marker and the per-turn log.
A stays as the reference: `npm run parity` holds B to it in `npm run check`,
so a regression in the port fails the gate. A3-A6 are not pursued.

## Decision point (as planned)

When A2–A5 and B1–B2 are done, compare on: parity, ms/battle, rankings runtime,
bundle size, features kept. Record the numbers here and choose.
