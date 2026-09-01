import { describe, it, expect } from 'vitest';
import { resolvePool } from '../pool';
import { RULES_SCHEMA, type Format } from '../types';
import { opponentCandidatesFor, parseRef, speciesOf } from '../../lib/data';

function fmt(pool: Format['pool']): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool,
    composition: { size: 3 },
    selection: { mode: 'open' },
  };
}

describe('resolvePool', () => {
  it('with no clauses, is exactly the league pool', () => {
    const { legal } = resolvePool(fmt([]));
    expect(legal.sort()).toEqual([...opponentCandidatesFor('great')].sort());
  });

  it('a deny removes everything it matches', () => {
    const { legal } = resolvePool(fmt([{ effect: 'deny', select: 'flying' }]));
    expect(legal.some((r) => speciesOf(r)?.types.includes('flying'))).toBe(false);
    expect(legal.length).toBeGreaterThan(0);
  });

  it('the LAST matching clause wins, so a later allow re-admits', () => {
    const denyOnly = resolvePool(fmt([{ effect: 'deny', select: 'water' }]));
    const reAdmit = resolvePool(
      fmt([
        { effect: 'deny', select: 'water' },
        { effect: 'allow', select: 'azumarill' },
      ]),
    );
    expect(denyOnly.legal).not.toContain('azumarill');
    expect(reAdmit.legal).toContain('azumarill');
  });

  it('order changes the result, which is why order is canonical', () => {
    const a = resolvePool(fmt([
      { effect: 'deny', select: 'water' },
      { effect: 'allow', select: 'azumarill' },
    ]));
    const b = resolvePool(fmt([
      { effect: 'allow', select: 'azumarill' },
      { effect: 'deny', select: 'water' },
    ]));
    expect(a.legal).toContain('azumarill');
    expect(b.legal).not.toContain('azumarill');
  });

  it('bans one variant without banning the species', () => {
    const { legal } = resolvePool(fmt([{ effect: 'deny', select: 'shadow' }]));
    expect(legal.every((r) => !parseRef(r).shadow)).toBe(true);
    expect(legal.length).toBeGreaterThan(0);
  });

  it('names the deciding clause for an illegal ref', () => {
    const { decidedBy } = resolvePool(fmt([
      { effect: 'deny', select: 'flying' },
      { effect: 'allow', select: '+mantine' },
    ]));
    const flyer = [...decidedBy.keys()].find(
      (r) => speciesOf(r)?.types.includes('flying') && speciesOf(r)?.family !== 'FAMILY_MANTYKE',
    )!;
    expect(decidedBy.get(flyer)).toBe(0);
  });

  it('uses -1 when no clause matched at all', () => {
    const { decidedBy } = resolvePool(fmt([{ effect: 'deny', select: 'flying' }]));
    expect(decidedBy.get('azumarill')).toBe(-1);
  });

  it('reports an uncompilable clause instead of silently ignoring it', () => {
    const { bad } = resolvePool(fmt([{ effect: 'deny', select: '   ' }]));
    expect(bad).toEqual([0]);
  });

  it('never admits a species the engine cannot simulate', () => {
    const { legal } = resolvePool(fmt([]));
    expect(legal).not.toContain('mimikyu');
  });
});

describe('resolvePool with an empty start', () => {
  it('is empty when nothing is allowed', () => {
    const f = { ...fmt([]), start: 'empty' as const };
    expect(resolvePool(f).legal).toEqual([]);
  });

  it('admits only what a clause allows', () => {
    const f = { ...fmt([{ effect: 'allow' as const, select: 'water' }]), start: 'empty' as const };
    const { legal } = resolvePool(f);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((r) => speciesOf(r)?.types.includes('water'))).toBe(true);
  });

  it('still lets a later deny carve out of an allow', () => {
    const f = {
      ...fmt([
        { effect: 'allow' as const, select: 'water' },
        { effect: 'deny' as const, select: 'azumarill' },
      ]),
      start: 'empty' as const,
    };
    expect(resolvePool(f).legal).not.toContain('azumarill');
  });

  it('leaves a league-start format exactly as it was', () => {
    const withField = { ...fmt([]), start: 'league' as const };
    expect(resolvePool(withField).legal).toEqual(resolvePool(fmt([])).legal);
  });
});
