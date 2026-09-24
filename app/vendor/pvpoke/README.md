# PvPoke battle engine (vendored)

Unmodified copies of PvPoke's battle engine, from
https://github.com/pvpoke/pvpoke at commit `9dab4bcc8c` (2026-09-23), under its MIT
license (LICENSE, here). Loaded by `src/lib/pvpoke.ts`, which supplies the few
browser globals the files expect; they are never edited, so refreshing is a
copy:

```bash
B=https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/js
cd app/vendor/pvpoke
curl -O $B/GameMaster.js -O $B/battle/Battle.js -O $B/battle/DamageCalculator.js \
     -O $B/battle/actions/ActionLogic.js -O $B/battle/timeline/TimelineEvent.js \
     -O $B/battle/timeline/TimelineAction.js -O $B/pokemon/Pokemon.js
```

and the data it reads, `data-src/gamemaster.min.json`, from
`$B/../data/gamemaster.min.json`. Then `npm run parity`.
