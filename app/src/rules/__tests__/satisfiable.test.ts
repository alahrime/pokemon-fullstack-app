import { describe, it, expect } from 'vitest';
import { findSatisfyingTeam, lintFormat } from '../lint';
import { RULES_SCHEMA, type Format } from '../types';

function fmt(over: Partial<Format> = {}): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3, uniqueSpecies: true },
    selection: { mode: 'open' },
    ...over,
  };
}

describe('findSatisfyingTeam', () => {
  it('finds a team for an ordinary format', () => {
    const r = findSatisfyingTeam(fmt());
    expect(r.found).not.toBeNull();
    expect(r.found!.length).toBe(3);
  });

  it('finds one under a minimum quota', () => {
    const f = fmt({ composition: { size: 3, uniqueSpecies: true, quotas: [{ select: 'shadow', min: 1 }] } });
    expect(findSatisfyingTeam(f).found).not.toBeNull();
  });

  it('proves a contradiction impossible', () => {
    const f = fmt({
      composition: {
        size: 2,
        uniqueSpecies: true,
        quotas: [{ select: 'shadow', min: 2 }, { select: 'shadow', max: 0 }],
      },
    });
    const r = findSatisfyingTeam(f);
    expect(r.found).toBeNull();
    expect(r.exhausted).toBe(false);
  });

  it('cannot field more members than the pool holds', () => {
    const f = fmt({
      pool: [{ effect: 'deny', select: '!azumarill' }],
      composition: { size: 3, uniqueSpecies: true },
    });
    expect(findSatisfyingTeam(f).found).toBeNull();
  });
});

describe('lintFormat satisfiability', () => {
  it('errors when a format is provably unsatisfiable', () => {
    const f = fmt({
      composition: {
        size: 2,
        uniqueSpecies: true,
        quotas: [{ select: 'shadow', min: 2 }, { select: 'shadow', max: 0 }],
      },
    });
    expect(lintFormat(f).some((d) => d.kind === 'unsatisfiable' && d.level === 'error')).toBe(true);
  });

  it('says nothing about satisfiability for a format that works', () => {
    const ds = lintFormat(fmt());
    expect(ds.some((d) => d.kind === 'unsatisfiable' || d.kind === 'unsatisfiable-unproven')).toBe(false);
  });
});
