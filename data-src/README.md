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

| File | Provides |
|---|---|
| `pokemon.json` | Every species, alternate form and Shadow entry: base stats, typing, movepool, tags, release state |
| `moves.json` | Move stats — power, energy, energy gain, turns, type |
| `rankings-1500/2500/10000.json` | PvPoke overall rankings per league, used for `leagueRank`, league membership and the recommended moveset |

## Notes

- **Shadows are not emitted as separate rows.** A Shadow shares its base form's
  stats, typing and movepool exactly, so the generator records `shadowEligible`
  plus the Shadow's ranks, and the engine derives the variant by applying
  ×6/5 attack and ×5/6 defense. That keeps `species.json` at ~1123 rows rather
  than ~1600.
- **Unreleased entries are filtered out** (`released: true`), which drops ~139
  forms that exist in the game master but aren't obtainable.
- Entries with no usable moveset are skipped rather than shipped, since they
  would crash the battle simulator. The generator reports any it drops.
