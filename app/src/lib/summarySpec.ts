import type { CategoryId } from './scenarios';
import type { TeamPass } from './teams';

/**
 * What the landing page's precomputed summary covers.
 *
 * Kept in its own module, apart from both the reader and the generator, for a
 * boring but load-bearing reason: `scripts/build-summary.ts` needs these
 * constants to *produce* summary.json, so it cannot import them from a module
 * that reads summary.json — on a clean checkout that file does not exist yet.
 * `verify-data` reads them from here too, which is what makes its check of the
 * generated file a real assertion rather than a restatement of the generator.
 *
 * These are type-only imports, so nothing here pulls an artefact into a chunk.
 */

/** The stratum the landing page's "teams / stratum" figure is counted from. */
export const LANDING_STRATUM: { tier: string; cat: CategoryId; pass: TeamPass; size: 3 | 6 } = {
  tier: '100',
  cat: 'overall',
  pass: 'd1',
  size: 3,
};

/** How many strongest-in-league Pokemon the landing page offers as a way in. */
export const LANDING_FEATURED_N = 6;

export interface LeagueSummary {
  engineRev: number;
  teams: number;
  /** Top `LANDING_FEATURED_N` refs by Overall at `LANDING_STRATUM.tier`. */
  featured: string[];
}
