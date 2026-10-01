import { describe, it, expect } from 'vitest';
import { PRESET_FORMATS, type Cup } from '../presetFormats';
import { opponentCandidatesFor, parseRef, speciesOf } from '../data';
import { lintFormat, resolvePool } from '../../rules';

/** PvPoke's rule, stated directly and by exact ref: in if it matches an include, out if it matches an exclude. */
function expected(base: Parameters<typeof opponentCandidatesFor>[0], cup: Cup): string[] {
  const inc = cup.include, exc = cup.exclude;
  const hasInc = !!(inc?.types?.length || inc?.ids?.length);
  return opponentCandidatesFor(base).filter((ref) => {
    const s = speciesOf(ref)!;
    const shadow = parseRef(ref).shadow;
    if (hasInc && !(inc?.types?.some((t) => s.types.includes(t as never)) || inc?.ids?.includes(ref))) return false;
    if (exc?.types?.some((t) => s.types.includes(t as never))) return false;
    if (exc?.tags?.includes('shadow') && shadow) return false;
    if (exc?.tags?.includes('mega') && /_mega|_primal/.test(s.id)) return false;
    return !exc?.ids?.includes(ref);
  });
}

describe('preset formats', () => {
  for (const p of PRESET_FORMATS) {
    it(`${p.name} resolves to exactly PvPoke's pool`, () => {
      expect(resolvePool(p.format).legal).toEqual(expected(p.base, p.cup));
      expect(resolvePool(p.format).bad).toEqual([]);
    });
    it(`${p.name} has no lint errors`, () => {
      expect(lintFormat(p.format).filter((d) => d.level === 'error')).toEqual([]);
    });
  }

  it('the cups actually restrict: each is smaller than its league, the plain leagues are not', () => {
    const size = (k: string) => resolvePool(PRESET_FORMATS.find((p) => p.key === k)!.format).legal.length;
    expect(size('retro')).toBeLessThan(size('great'));
    expect(size('battlefrontier-spectral')).toBeLessThan(size('great'));
    expect(size('battlefrontier-cauldron')).toBeLessThan(size('ultra'));
    expect(size('battlefrontier-master')).toBe(size('master'));
  });

  it('a Shadow is banned only where the list names its ref', () => {
    const cauldron = resolvePool(PRESET_FORMATS.find((p) => p.key === 'battlefrontier-cauldron')!.format).legal;
    expect(cauldron).not.toContain('forretress');
    expect(cauldron).toContain('forretress_shadow');
  });
});
