import { opponentCandidatesFor } from '../lib/data';
import { resolvePool } from './pool';
import { compileSelector } from './selector';
import type { Diagnostic, Format } from './types';

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

  if (legal.length === 0) {
    out.push({ level: 'error', kind: 'empty-pool' });
    return out;
  }

  // A clause is dead when it decided nothing — either it matched no ref at all,
  // or every ref it matched was overruled by a later clause. Both read the same
  // to an author ("rule 3 does nothing") and both are nearly always a typo, so
  // they warn rather than block.
  const decisive = new Set(decidedBy.values());
  format.pool.forEach((_, i) => {
    if (!decisive.has(i) && compileSelector(format.pool[i].select)) {
      out.push({ level: 'warn', kind: 'dead-clause', clause: i });
    }
  });

  const size = format.composition.size;
  if (format.selection.mode === 'random' && legal.length < size * RANDOM_POOL_MULTIPLE) {
    out.push({
      level: 'error',
      kind: 'pool-too-small',
      need: size * RANDOM_POOL_MULTIPLE,
      have: legal.length,
    });
  }

  if (legal.length < Math.max(MIN_POOL_ABSOLUTE, leagueSize * NARROW_POOL_FRACTION)) {
    out.push({ level: 'warn', kind: 'narrow-pool', have: legal.length, leagueSize });
  }

  return out;
}
