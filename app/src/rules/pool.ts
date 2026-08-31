import { opponentCandidatesFor } from '../lib/data';
import { compileSelector, type RefTerm } from './selector';
import type { Format } from './types';

export interface PoolResolution {
  /** Refs that survive the pipeline, in league order. */
  legal: string[];
  /**
   * Every base-league ref mapped to the clause that decided it, or -1 when no
   * clause matched and league membership alone decided. Covers illegal refs
   * too — "why is this banned" is only ever asked about one of those.
   */
  decidedBy: Map<string, number>;
  /** Indices of clauses whose selector would not compile. */
  bad: number[];
}

/**
 * Resolve a format to its legal refs.
 *
 * The base set is `opponentCandidatesFor`, which is already exactly right: it
 * returns refs rather than species ids, includes a Shadow row wherever the
 * Shadow is league-legal in its own right, and has already dropped everything
 * in UNSIMULATED_IDS. Reimplementing league membership here would duplicate a
 * rule that lives in the data layer and would drift from it.
 *
 * Every clause is tested against every ref rather than stopping at the first
 * match, because the *last* match decides. Stopping early would silently
 * implement first-match-wins, which reads identically on simple formats and
 * diverges exactly when a format uses an exception — the case the ordering
 * exists to serve.
 */
export function resolvePool(format: Format): PoolResolution {
  const base = opponentCandidatesFor(format.base);

  const compiled: (RefTerm | null)[] = [];
  const bad: number[] = [];
  format.pool.forEach((c, i) => {
    const t = compileSelector(c.select);
    if (!t) bad.push(i);
    compiled.push(t);
  });

  const legal: string[] = [];
  const decidedBy = new Map<string, number>();

  for (const ref of base) {
    let allowed = true;
    let by = -1;
    for (let i = 0; i < compiled.length; i++) {
      const t = compiled[i];
      if (!t) continue;
      if (t(ref)) {
        allowed = format.pool[i].effect === 'allow';
        by = i;
      }
    }
    decidedBy.set(ref, by);
    if (allowed) legal.push(ref);
  }

  return { legal, decidedBy, bad };
}
