// Trim PvPoke's gamemaster to what its battle engine reads, for the app.
//
// Drops per-species fields only PvPoke's site uses (family trees, buddy and
// third-move costs, release flags, search helpers, nicknames), default IVs
// for leagues we do not run, and the cup list. `npm run parity` runs the
// vendored engine on this output, so a field the engine turns out to need
// fails the gate rather than a battle. Deterministic: unchanged input, same
// bytes out.
import { readFileSync, writeFileSync } from 'node:fs';

const d = JSON.parse(readFileSync(new URL('../../data-src/gamemaster.min.json', import.meta.url), 'utf8'));
const DROP = ['buddyDistance', 'thirdMoveCost', 'released', 'searchPriority', 'nicknames', 'family'];
const LEAGUES = ['cp1500', 'cp2500', 'cp10000'];
for (const p of d.pokemon) {
  for (const k of DROP) delete p[k];
  if (p.defaultIVs) p.defaultIVs = Object.fromEntries(LEAGUES.filter((k) => p.defaultIVs[k]).map((k) => [k, p.defaultIVs[k]]));
}
delete d.cups;
const out = JSON.stringify(d);
writeFileSync(new URL('../src/data/pvpoke-gamemaster.json', import.meta.url), out);
console.log(`  pvpoke gamemaster  ${(out.length / 1024).toFixed(0)} KB (from ${(readFileSync(new URL('../../data-src/gamemaster.min.json', import.meta.url)).length / 1024).toFixed(0)} KB)`);
