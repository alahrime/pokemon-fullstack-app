# data-src

Upstream game data from [PvPoke](https://github.com/pvpoke/pvpoke). These files
are inputs to `app/scripts/build-data.mjs`; nothing in the app imports them
directly.

## Refreshing after a game update

```bash
cd data-src
B=https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data
curl -O $B/gamemaster/pokemon.json -O $B/gamemaster/moves.json
curl -O $B/rankings/all/overall/rankings-1500.json \
     -O $B/rankings/all/overall/rankings-2500.json \
     -O $B/rankings/all/overall/rankings-10000.json

cd ../app && npm run data && npm run verify
```

`npm run data` is two passes. `build-data.mjs` runs on plain node and writes
`species.json`; `build-best-spreads.ts` then reads it back and records each
species' rank-1 IV roll per league, so the engine doesn't search all 4096 at
runtime. The second pass is bundled through esbuild — deliberately, so it uses
the real `bestAt` instead of a copy that could drift — which makes **esbuild a
build dependency of the data, not just of `verify`**.

Practical consequence: esbuild ships a platform-specific binary. A
`node_modules` copied or restored from a different OS or architecture fails
with `cannot execute binary file`, and takes `npm run data` down with it. A
fresh `npm install` on the machine you're building on fixes it.

The output is deterministic — same inputs give a byte-identical `species.json`,
so a dirty diff after regenerating means the upstream data actually changed.

| File | Provides |
|---|---|
| `pokemon.json` | Every species, alternate form and Shadow entry: base stats, typing, movepool, tags, release state |
| `moves.json` | Move stats — power, energy, energy gain, turns, type |
| `rankings-1500/2500/10000.json` | PvPoke overall rankings per league, used for `leagueRank`, league membership and the recommended moveset |

## Notes

- **League membership is the ranking**, plus a raw-power floor in Master. A
  form is an opponent in a league iff it appears in that league's
  `rankings-*.json`, giving pools of 1143 / 841 / 361. Master additionally
  requires maxCP ≥ 3000: it is the one uncapped league, so a ceiling below
  3000 is power forfeited outright rather than a matchup question — Registeel
  (2766) and Umbreon (2416) are rated there but outclassed by definition. The
  capped leagues take no such floor. Two earlier rules were wrong in opposite
  directions. Capping at each league's top 300 hid the niche matchups where
  breakpoints live. Replacing it with a max-CP floor (great 1100, ultra 2200,
  master 2500) over-corrected: a CP ceiling is a maximum, not a minimum, so
  the floor dropped 76 ranked-and-played forms — Aegislash (Shield) tops out
  at 1746 and is Ultra rank 478, Umbreon maxes at 2416 and is Master rank 393
  — while admitting every Mega and Primal, none of which is ever an opponent.
  `pool-exclusions.json` is the manual override for anything still wrong.
- **Base and Shadow have separate membership.** `leagues` and `shadowLeagues`
  are tracked apart, because a league can rate one form and not the other —
  Shadow Palkia is Great-ranked where plain Palkia is not — and a Shadow's
  shifted stats give it different breakpoints, so it earns its own cell on the
  matchup board.
- **Move objects are interned.** `species.json` ships a `moves` table and each
  species references keys into it. The same move appeared in every species that
  learns it — 7730 embedded objects for 567 distinct ones, 62% of the file.
  `lib/data.ts` rehydrates it once at load, so the in-memory shape is unchanged.
- **Shadows are not emitted as separate rows.** A Shadow shares its base form's
  stats, typing and movepool exactly, so the generator records `shadowEligible`
  plus the Shadow's ranks, and the engine derives the variant by applying
  ×6/5 attack and ×5/6 defense. That keeps `species.json` at ~1123 rows rather
  than ~1600.
- **Unreleased entries are filtered out** (`released: true`), which drops ~139
  forms that exist in the game master but aren't obtainable.
- Entries with no usable moveset are skipped rather than shipped, since they
  would crash the battle simulator. The generator reports any it drops.
