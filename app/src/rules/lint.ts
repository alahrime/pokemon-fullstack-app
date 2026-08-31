import { SPECIES_BY_ID, conflictsOnTeam, movesFor, opponentCandidatesFor, parseRef, speciesOf } from '../lib/data';
import { resolvePool, drawablePool } from './pool';
import { compileBuildSelector, type BuildTerm } from './buildSelector';
import { compileSelector } from './selector';
import type { Build, Diagnostic, Format, Quota } from './types';

/**
 * Publish-time thresholds.
 *
 * Relative rather than absolute because the base pools differ by a factor of
 * three — 1,143 refs in Great, 841 in Ultra, 365 in Master — so one flat number
 * is either trivial at the top or crippling at the bottom. Exported so a test
 * can assert them and a tuning pass has exactly one place to edit.
 */
export const NARROW_POOL_FRACTION = 0.1;
export const MIN_POOL_ABSOLUTE = 30;
/** A random draft needs a pool several times its team size to be a draft. */
export const RANDOM_POOL_MULTIPLE = 4;

/**
 * How many partial teams the satisfiability search will consider.
 *
 * Bounded because the search is over a pool of up to ~1,100 refs and a
 * pathological format could otherwise hang the builder on every keystroke.
 * Exhausting the budget is reported as "unproven", never as "unsatisfiable" —
 * see findSatisfyingTeam.
 */
export const SEARCH_NODE_BUDGET = 20000;

/** The rated loadout for a ref, which is what a satisfiability proof fields. */
function ratedBuild(ref: string, format: Format): Build {
  const s = SPECIES_BY_ID.get(parseRef(ref).id)!;
  const m = movesFor(s, format.base);
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
}

/**
 * Look for one team that satisfies every composition rule.
 *
 * Backtracking over slots, with unmet minimum quotas driving the candidate
 * order — a format demanding a Shadow is far more quickly satisfied by trying
 * Shadows first than by walking the pool alphabetically.
 *
 * The distinction between the two failure modes is the whole point. `found:
 * null, exhausted: false` means the search space was covered and nothing works,
 * which is a real error worth blocking a publish. `found: null, exhausted:
 * true` means the budget ran out, which proves nothing at all and must never
 * be reported as unsatisfiable — wrongly blocking a legal format is a worse
 * failure than letting a pathological one through.
 *
 * `budget` defaults to `SEARCH_NODE_BUDGET` and exists as a parameter so a
 * test can force genuine exhaustion on a small, cheap search rather than
 * having to construct a format that burns 20,000 real nodes.
 */
export function findSatisfyingTeam(
  format: Format,
  budget: number = SEARCH_NODE_BUDGET,
): { found: string[] | null; exhausted: boolean } {
  const c = format.composition;
  const { legal } = resolvePool(format);
  if (legal.length < c.size) return { found: null, exhausted: false };

  const quotas = (c.quotas ?? [])
    .map((q) => ({ q, term: compileBuildSelector(q.select) }))
    .filter((x): x is { q: Quota; term: BuildTerm } => x.term !== null);

  const builds = new Map(legal.map((r) => [r, ratedBuild(r, format)]));
  let nodes = 0;
  let exhausted = false;

  const chosen: string[] = [];

  function counts(): number[] {
    return quotas.map(({ term }) => chosen.filter((r) => term(builds.get(r)!)).length);
  }

  function viable(): boolean {
    const remaining = c.size - chosen.length;
    const cs = counts();
    for (let i = 0; i < quotas.length; i++) {
      const { q } = quotas[i];
      if (q.max !== undefined && cs[i] > q.max) return false;
      if (q.min !== undefined && cs[i] + remaining < q.min) return false;
    }
    return true;
  }

  function compatible(ref: string): boolean {
    for (const r of chosen) {
      if (c.uniqueSpecies && conflictsOnTeam(r, ref)) return false;
      if (c.uniqueFamilies) {
        const a = speciesOf(r)?.family;
        const b = speciesOf(ref)?.family;
        if (a && b && a === b) return false;
      }
    }
    return true;
  }

  /**
   * Candidate order, computed once.
   *
   * Members of any minimum quota come first, so a format demanding a Shadow is
   * satisfied in a few nodes rather than after walking the pool alphabetically.
   *
   * Deliberately static rather than recomputed per node. A dynamic reordering
   * would destroy the index ordering that makes this a search over
   * *combinations*, and without it the recursion has to restart from 0 at
   * every level and explores permutations instead — 6! times more work for
   * the same answer, which turns a cheap search into one that only ever
   * reports "unproven".
   */
  const ordered = (() => {
    const wanted: string[] = [];
    const rest: string[] = [];
    const mins = quotas.filter(({ q }) => q.min !== undefined);
    for (const r of legal) {
      (mins.some(({ term }) => term(builds.get(r)!)) ? wanted : rest).push(r);
    }
    return [...wanted, ...rest];
  })();

  function search(startIdx: number): boolean {
    if (!viable()) return false;
    if (chosen.length === c.size) return true;
    if (nodes++ > budget) {
      exhausted = true;
      return false;
    }
    for (let i = startIdx; i < ordered.length; i++) {
      const ref = ordered[i];
      if (!compatible(ref)) continue;
      chosen.push(ref);
      // i + 1, never 0: each ref is considered once per branch, so this walks
      // combinations rather than permutations.
      if (search(i + 1)) return true;
      chosen.pop();
      if (exhausted) return false;
    }
    return false;
  }

  const ok = search(0);
  return { found: ok ? [...chosen] : null, exhausted };
}

/**
 * Everything wrong with a format, before anybody plays it.
 *
 * Errors block publishing; warnings do not. The distinction matters: a format
 * that is merely narrow is a legitimate thing to want, and refusing it would be
 * the tool overruling its user. A format that no legal team can satisfy is not.
 */
export function lintFormat(format: Format): Diagnostic[] {
  const out: Diagnostic[] = [];

  format.pool.forEach((c, i) => {
    if (!compileSelector(c.select)) {
      out.push({ level: 'error', kind: 'bad-selector', clause: i, select: c.select });
    }
  });

  const { legal, decidedBy } = resolvePool(format);
  const leagueSize = opponentCandidatesFor(format.base).length;

  // A clause is dead when it decided nothing — either it matched no ref at all,
  // or every ref it matched was overruled by a later clause. Both read the same
  // to an author ("rule 3 does nothing") and both are nearly always a typo, so
  // they warn rather than block. This check happens before the empty-pool early
  // return so that the author sees which rule did nothing, even when the pool
  // came out empty.
  const decisive = new Set(decidedBy.values());
  format.pool.forEach((_, i) => {
    if (!decisive.has(i) && compileSelector(format.pool[i].select)) {
      out.push({ level: 'warn', kind: 'dead-clause', clause: i });
    }
  });

  if (legal.length === 0) {
    out.push({ level: 'error', kind: 'empty-pool' });
    return out;
  }

  const size = format.composition.size;
  const drawable = drawablePool(format);

  if (format.selection.mode === 'random' && drawable.length < size * RANDOM_POOL_MULTIPLE) {
    out.push({
      level: 'error',
      kind: 'pool-too-small',
      need: size * RANDOM_POOL_MULTIPLE,
      have: drawable.length,
    });
  }

  if (format.selection.mode === 'random' && (format.composition.quotas?.length ?? 0) > 0) {
    out.push({ level: 'error', kind: 'random-with-quotas' });
  }

  if (legal.length < Math.max(MIN_POOL_ABSOLUTE, leagueSize * NARROW_POOL_FRACTION)) {
    out.push({ level: 'warn', kind: 'narrow-pool', have: legal.length, leagueSize });
  }

  const sat = findSatisfyingTeam(format);
  if (!sat.found) {
    out.push(
      sat.exhausted
        ? { level: 'warn', kind: 'unsatisfiable-unproven' }
        : { level: 'error', kind: 'unsatisfiable' },
    );
  }

  return out;
}
