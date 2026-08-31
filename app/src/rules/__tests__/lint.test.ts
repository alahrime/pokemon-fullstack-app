import { describe, it, expect } from 'vitest';
import { lintFormat, MIN_POOL_ABSOLUTE, NARROW_POOL_FRACTION, RANDOM_POOL_MULTIPLE } from '../lint';
import { RULES_SCHEMA, type Format } from '../types';

function fmt(over: Partial<Format> = {}): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3 },
    selection: { mode: 'open' },
    ...over,
  };
}

describe('lintFormat', () => {
  it('passes a plain league format with nothing to say', () => {
    expect(lintFormat(fmt())).toEqual([]);
  });

  it('errors on a pool emptied by its own clauses', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '!nothingmatchesthisxyz' }] });
    expect(lintFormat(f).some((d) => d.kind === 'empty-pool' && d.level === 'error')).toBe(true);
  });

  it('errors on a selector that will not compile', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '   ' }] });
    expect(lintFormat(f)).toContainEqual({ level: 'error', kind: 'bad-selector', clause: 0, select: '   ' });
  });

  it('warns on a clause that matches nothing', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: 'zzzznotaspecies' }] });
    expect(lintFormat(f).some((d) => d.kind === 'dead-clause' && d.clause === 0)).toBe(true);
  });

  it('warns on a clause fully shadowed by a later one', () => {
    const f = fmt({
      pool: [
        { effect: 'deny', select: 'azumarill' },
        { effect: 'allow', select: 'water' },
      ],
    });
    expect(lintFormat(f).some((d) => d.kind === 'dead-clause' && d.clause === 0)).toBe(true);
  });

  it('reports both empty-pool and dead-clause when a dead rule precedes the emptying rule', () => {
    const f = fmt({
      pool: [
        { effect: 'deny', select: 'zzzznotaspecies' },
        { effect: 'deny', select: '!nothingmatchesthisxyz' },
      ],
    });
    const diags = lintFormat(f);
    expect(diags.some((d) => d.kind === 'empty-pool' && d.level === 'error')).toBe(true);
    expect(diags.some((d) => d.kind === 'dead-clause' && d.clause === 0)).toBe(true);
  });

  it('warns when the pool is a sliver of its league', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '!azumarill' }] });
    expect(lintFormat(f).some((d) => d.kind === 'narrow-pool')).toBe(true);
  });

  it('errors when a random draft has too few to draw from', () => {
    const f = fmt({
      pool: [{ effect: 'deny', select: '!azumarill' }],
      selection: { mode: 'random' },
    });
    expect(lintFormat(f).some((d) => d.kind === 'pool-too-small' && d.level === 'error')).toBe(true);
  });

  it('does not raise pool-too-small for an open-pick format', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '!azumarill' }] });
    expect(lintFormat(f).some((d) => d.kind === 'pool-too-small')).toBe(false);
  });

  it('exposes its thresholds for tuning', () => {
    expect(NARROW_POOL_FRACTION).toBeGreaterThan(0);
    expect(MIN_POOL_ABSOLUTE).toBeGreaterThan(0);
    expect(RANDOM_POOL_MULTIPLE).toBeGreaterThan(1);
  });

  it('errors on a random draft with quotas', () => {
    const f = fmt({
      selection: { mode: 'random' },
      composition: { size: 3, quotas: [{ select: 'water', min: 1 }] },
    });
    expect(lintFormat(f).some((d) => d.kind === 'random-with-quotas' && d.level === 'error')).toBe(true);
  });

  it('does not error on a random draft without quotas', () => {
    const f = fmt({
      selection: { mode: 'random' },
      composition: { size: 3 },
    });
    expect(lintFormat(f).some((d) => d.kind === 'random-with-quotas')).toBe(false);
  });

  it('does not error on an open-pick format with quotas', () => {
    const f = fmt({
      selection: { mode: 'open' },
      composition: { size: 3, quotas: [{ select: 'water', min: 1 }] },
    });
    expect(lintFormat(f).some((d) => d.kind === 'random-with-quotas')).toBe(false);
  });
});
