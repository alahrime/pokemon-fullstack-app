import { describe, it, expect } from 'vitest';
import { PRESET_FORMATS, withTeamSize, type Cup } from '../presetFormats';
import { everyRefFor, opponentCandidatesFor, parseRef, speciesOf } from '../data';
import { lintFormat, resolvePool } from '../../rules';
import CUP_POOLS from '../../data/cup-pools.json';

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

  it('every cup is exactly the species PvPoke ranks in it, in its own league', () => {
    const cups = PRESET_FORMATS.filter((p) => p.key !== p.base);
    expect(cups.length).toBe(CUP_POOLS.length);
    for (const [i, p] of cups.entries()) {
      const legal = resolvePool(p.format).legal;
      expect(legal.length, p.name).toBeGreaterThan(0.95 * CUP_POOLS[i].ids.length);
      expect(legal.filter((r) => !CUP_POOLS[i].ids.includes(r)), p.name).toEqual([]);
    }
  });

  it('the Mega cups admit the Megas PvPoke ranks; the plain leagues admit none', () => {
    const legal = (k: string) => new Set(resolvePool(PRESET_FORMATS.find((p) => p.key === k)!.format).legal);
    expect(legal('mega-great').has('venusaur_mega')).toBe(true);
    expect(legal('great').has('venusaur_mega')).toBe(false);
    expect(legal('mega-great').has('rayquaza_mega')).toBe(false);
    expect(legal('mega-great')).not.toEqual(legal('fantasy'));
  });

  it('is listed in the order of PvPoke\'s dropdown, keeping the keys saved selections use', () => {
    expect(PRESET_FORMATS.map((p) => p.name).slice(0, 4)).toEqual(['Great League', 'Ultra League', 'Master League', 'Mega Great League']);
    for (const k of ['mega-great', 'mega-ultra', 'mega-master', 'laic-2027', 'battlefrontier-spectral', 'battlefrontier-cauldron', 'battlefrontier-master', 'fantasy', 'halloweenmega']) {
      expect(PRESET_FORMATS.some((p) => p.key === k), k).toBe(true);
    }
  });

  it('Show 6 is six on the roster and three brought; GBL is three, and either way the pool is untouched', () => {
    const f = PRESET_FORMATS[0].format;
    expect(withTeamSize(f, 6).composition).toMatchObject({ size: 6, bring: 3 });
    expect(withTeamSize(withTeamSize(f, 6), 3).composition).toEqual({ size: 3 });
    expect(withTeamSize(f, 6).pool).toBe(f.pool);
    expect(withTeamSize(f, 6).base).toBe(f.base);
  });
});
