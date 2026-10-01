import { describe, it, expect } from 'vitest';
import { PRESET_FORMATS, type Cup } from '../presetFormats';
import { everyRefFor, opponentCandidatesFor, parseRef, speciesOf } from '../data';
import { lintFormat, resolvePool } from '../../rules';

/** PvPoke's rule, stated directly and by exact ref: in if it matches an include, out if it matches an exclude. */
function expected(base: Parameters<typeof opponentCandidatesFor>[0], cup: Cup): string[] {
  const inc = cup.include, exc = cup.exclude;
  const hasInc = !!(inc?.types?.length || inc?.ids?.length);
  return (cup.every ? everyRefFor(base) : opponentCandidatesFor(base)).filter((ref) => {
    const s = speciesOf(ref)!;
    const shadow = parseRef(ref).shadow;
    if (hasInc && !(inc?.types?.some((t) => s.types.includes(t as never)) || inc?.ids?.includes(ref))) return false;
    if (exc?.types?.some((t) => s.types.includes(t as never))) return false;
    if (exc?.tags?.includes('shadow') && shadow) return false;
    if (exc?.tags?.some((t) => s.tags.includes(t))) return false;
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
    expect(size('mega-color')).toBeLessThan(size('mega-great'));
    expect(size('laic-2027')).toBeLessThan(size('mega-great'));
  });

  it('the Mega cups admit Megas and unranked species; the ranked cups admit neither', () => {
    const legal = (k: string) => new Set(resolvePool(PRESET_FORMATS.find((p) => p.key === k)!.format).legal);
    expect(legal('mega-great').has('venusaur_mega')).toBe(true);
    expect(legal('great').has('venusaur_mega')).toBe(false);
    expect(legal('mega-master').has('rayquaza_mega')).toBe(true);
    expect(legal('mega-great').has('rayquaza_mega')).toBe(false);
    expect(legal('battlefrontier-master').has('rayquaza_mega')).toBe(false);
    expect(legal('battlefrontier-master').has('venusaur_mega')).toBe(true);
  });

  it('no Mega or Primal is offered as a Shadow', () => {
    const legal = resolvePool(PRESET_FORMATS.find((p) => p.key === 'mega-great')!.format).legal;
    expect(legal.filter((r) => /_mega|_primal/.test(r) && r.endsWith('_shadow'))).toEqual([]);
    expect(legal).toContain('venusaur_shadow');
  });

  it('Mega Color Cup keeps a Mega only if one of its types is fire, water, grass or electric', () => {
    const legal = new Set(resolvePool(PRESET_FORMATS.find((p) => p.key === 'mega-color')!.format).legal);
    expect(legal.has('blastoise_mega_x') || legal.has('blastoise_mega')).toBe(true);
    expect(legal.has('gengar_mega')).toBe(false);
  });

  it('is listed in the order of PvPoke\'s dropdown', () => {
    expect(PRESET_FORMATS.map((p) => p.name).slice(0, 4)).toEqual(['Great League', 'Ultra League', 'Master League', 'Mega Great League']);
  });

  it('a Shadow is banned only where the list names its ref', () => {
    const cauldron = resolvePool(PRESET_FORMATS.find((p) => p.key === 'battlefrontier-cauldron')!.format).legal;
    expect(cauldron).not.toContain('forretress');
    expect(cauldron).toContain('forretress_shadow');
  });
});
