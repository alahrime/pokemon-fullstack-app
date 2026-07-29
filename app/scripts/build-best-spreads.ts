/**
 * Records which IV roll is a species' best in each league.
 *
 *   npm run data   (runs after build-data.mjs)
 *
 * Opponents need the attack, defense and HP of their rank-1 roll, and finding
 * it meant testing all 4096 rolls per opponent on first scan — 1143 opponents
 * in Great, a ~200ms stall the first time the board is drawn.
 *
 * What gets stored is the winning roll, not its stats: a single 0-4095 key per
 * species per league, from which the engine recomputes the stats with one
 * bestAt call. Storing the stats instead would mean writing floats that must
 * round-trip exactly to keep damage numbers identical, and would cost several
 * times the space.
 *
 * The same key serves the Shadow — the search runs on unadjusted stats and
 * Shadow only rescales attack and defense afterward, so both forms agree on
 * which roll wins.
 *
 * Bundled through esbuild so the search runs against the real bestAt rather
 * than a copy of it in the generator, which would be free to drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SPECIES, LEAGUES } from '../src/lib/data';
import { bestAt, ivKey } from '../src/lib/engine';
import type { LeagueId, StatLine } from '../src/lib/types';

// Anchored on the npm working directory, not import.meta.url: esbuild emits
// the bundle into node_modules/.cache, so a path relative to the module would
// resolve from there rather than from scripts/.
const OUT = path.resolve(process.cwd(), 'src/data/species.json');

const raw = JSON.parse(fs.readFileSync(OUT, 'utf8')) as {
  moves: Record<string, unknown>;
  species: { id: string; leagues: string[]; shadowLeagues: string[]; bestIv?: Record<string, number> }[];
};
const byId = new Map(SPECIES.map((s) => [s.id, s]));

let written = 0;
for (const row of raw.species) {
  const species = byId.get(row.id);
  if (!species) continue;
  // Only leagues where this species is actually an opponent - nothing else
  // ever asks for its best roll.
  const leagues = [...new Set([...row.leagues, ...row.shadowLeagues])] as LeagueId[];
  if (!leagues.length) continue;

  const bestIv: Record<string, number> = {};
  for (const lg of leagues) {
    const league = LEAGUES.find((l) => l.id === lg)!;
    let best: (StatLine & { a: number; d: number; s: number }) | null = null;
    for (let a = 0; a < 16; a++) {
      for (let d = 0; d < 16; d++) {
        for (let s = 0; s < 16; s++) {
          const r = bestAt(species, { a, d, s }, league);
          // Identical predicate and iteration order to bestSpreadFor, so the
          // recorded winner is the one the runtime search would have picked.
          if (!best || r.sp > best.sp || (r.sp === best.sp && a + d + s > best.a + best.d + best.s)) {
            best = { ...r, a, d, s };
          }
        }
      }
    }
    bestIv[lg] = ivKey({ a: best!.a, d: best!.d, s: best!.s });
  }
  row.bestIv = bestIv;
  written++;
}

fs.writeFileSync(OUT, JSON.stringify(raw));
const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`  bestIv        ${written} species indexed, species.json now ${size}MB`);
