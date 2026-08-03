/**
 * The landing page's headline numbers, precomputed.
 *
 * The landing screen wants five things it cannot derive from species.json: the
 * team count for a stratum, the engine rev, and the six strongest Pokemon in
 * each league. Reading them from the full artefacts is what it used to do, and
 * it is why `rankings.json` (3.1MB) and `teams.json` (3.8MB) were both in the
 * entry chunk — 6.9MB downloaded to render a count and six names, before the
 * first screen that actually needs either of them is even reachable.
 *
 * So the same values are resolved here instead, at build time, into a file
 * small enough to keep in the entry chunk. The point of doing it in a script
 * rather than writing the numbers into the component is that this bundles the
 * *real* readers — `fieldPool`, `teamCount`, `ENGINE_REV` — so the summary is
 * by construction what the screen would have computed for itself. A rebuild
 * that changes the rankings changes this too, which was the original comment's
 * whole intent; only the moment of evaluation has moved.
 *
 * Regenerate with `npm run data` (or `npm run summary`) after either artefact
 * changes. `verify-data` asserts the summary still matches its sources, so a
 * stale file fails the gate rather than quietly showing last week's numbers.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { LEAGUES } from '../src/lib/data';
import { ENGINE_REV, fieldPool } from '../src/lib/rankings';
import { teamCount } from '../src/lib/teams';
import { LANDING_FEATURED_N, LANDING_STRATUM } from '../src/lib/summarySpec';

// Resolved from cwd, not import.meta.url: esbuild bundles this into
// node_modules/.cache, so a module-relative path lands two directories deep.
const OUT = resolve(process.cwd(), 'src/data');

const summary: Record<string, { engineRev: number; teams: number; featured: string[] }> = {};

for (const { id } of LEAGUES) {
  const { tier, cat, pass, size } = LANDING_STRATUM;
  summary[id] = {
    engineRev: ENGINE_REV(id),
    teams: teamCount(id, tier, cat, pass, size),
    featured: fieldPool(id, tier, LANDING_FEATURED_N),
  };
  console.log(
    `${id.padEnd(7)} rev ${summary[id].engineRev}  ${String(summary[id].teams).padStart(4)} teams/stratum` +
      `  featured: ${summary[id].featured.join(', ')}`,
  );
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary));
console.log(`\nwrote summary.json`);
