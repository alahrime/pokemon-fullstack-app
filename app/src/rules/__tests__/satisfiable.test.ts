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

describe('findSatisfyingTeam budget exhaustion', () => {
  // This format carries no quotas at all, so `viable()` has no unconditional
  // min/max contradiction to prune on — the only way `search` can return
  // false is by walking (part of) the space or by running out of budget. At
  // the default budget it is trivially satisfiable (proven above and by the
  // "ordinary format" case), so cutting it off at a tiny budget isolates the
  // exhaustion mechanism itself, independent of any contradiction.
  const bigButOrdinary = fmt({ composition: { size: 6, uniqueSpecies: true } });

  it('reports exhausted, not found, when the budget is too small to search', () => {
    const r = findSatisfyingTeam(bigButOrdinary, 1);
    expect(r.found).toBeNull();
    expect(r.exhausted).toBe(true);
  });

  it('lintFormat reports the exhausted case as unproven, never as disproved', () => {
    // A real call into lintFormat — not a copy of its level-selection ternary
    // evaluated against a local variable — using the same tiny-budget format
    // as the test above (`lintFormat` now threads its optional `budget`
    // parameter straight through to `findSatisfyingTeam`) rather than
    // lowering SEARCH_NODE_BUDGET globally or constructing a format that
    // genuinely burns 20,000 nodes (slow, and fragile to the generated
    // species data). This is the one test that actually executes lintFormat's
    // exhausted -> warn branch; deleting that branch from lintFormat would
    // fail it.
    const ds = lintFormat(bigButOrdinary, 1);
    expect(ds).toContainEqual({ level: 'warn', kind: 'unsatisfiable-unproven' });
    expect(ds.some((d) => d.kind === 'unsatisfiable')).toBe(false);
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
