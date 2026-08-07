import { describe, it, expect } from 'vitest';
import {
  ANSWER_LINE, EVIDENCE_N, META_FLOOR_PCT, META_POWER, SHARED_WEAK_COST, WIN_LINE,
  coreStrength, relevanceWeights, sharedTypePairs, typeCoverage, typePressure, worstSharedWeakness,
} from '../synergy';

describe('relevanceWeights', () => {
  const overall = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100];
  it('gives the strongest opponent the full weight', () =>
    expect(relevanceWeights(overall)[0]).toBeCloseTo(1, 6));
  it('zeroes the bottom half outright — beating them should not count', () => {
    const w = Array.from(relevanceWeights(overall));
    expect(w.slice(Math.floor(w.length * META_FLOOR_PCT)).every((x) => x === 0)).toBe(true);
  });
  it('is monotonic above the floor', () => {
    const w = Array.from(relevanceWeights(overall));
    for (let i = 1; i < 5; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
  });
  it('steepens as the power rises', () => {
    expect(Array.from(relevanceWeights(overall, 8))[2])
      .toBeLessThan(Array.from(relevanceWeights(overall, 1))[2]);
  });
  it('survives a flat field without dividing by zero', () =>
    expect(Array.from(relevanceWeights([500, 500, 500, 500])).every(Number.isFinite)).toBe(true));
  it('exposes sane tuning constants', () => {
    expect(META_POWER).toBeGreaterThan(0);
    expect(META_FLOOR_PCT).toBeGreaterThan(0);
    expect(META_FLOOR_PCT).toBeLessThan(1);
  });
});

describe('typeCoverage', () => {
  it('takes the whole team and returns a share', () => {
    const v = typeCoverage([['water'], ['grass'], ['fire']]);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
  it('rates a varied team above three of the same typing', () => {
    expect(typeCoverage([['water'], ['grass'], ['fire']]))
      .toBeGreaterThan(typeCoverage([['water'], ['water'], ['water']]));
  });
  it('handles dual types and a single member', () => {
    expect(Number.isFinite(typeCoverage([['steel', 'fairy'], ['water', 'ground']]))).toBe(true);
    expect(Number.isFinite(typeCoverage([['normal']]))).toBe(true);
  });
});

describe('sharedTypePairs', () => {
  it('counts members sharing a type', () => {
    expect(sharedTypePairs([['water'], ['water'], ['fire']])).toBe(1);
    expect(sharedTypePairs([['water'], ['water'], ['water']])).toBe(3);
  });
  it('is zero for an ABC line, which is the point of the rule', () =>
    expect(sharedTypePairs([['water'], ['fire'], ['grass']])).toBe(0));
  it('counts a shared half of a dual type', () =>
    expect(sharedTypePairs([['steel', 'fairy'], ['steel', 'flying']])).toBe(1));
});

describe('typePressure', () => {
  it('weighs how much of the field attacks with each type', () => {
    const w = Float64Array.from([1, 1, 0]);
    const p = typePressure([['fighting'], ['fighting'], ['water']], w);
    expect(p.get('fighting')).toBeGreaterThan(0);
    // Weighted to zero, so water contributes nothing.
    expect(p.get('water') ?? 0).toBe(0);
  });
  it('seeds every type, so a lookup never returns undefined', () => {
    const p = typePressure([], Float64Array.from([]));
    expect(p.size).toBe(18);
    expect([...p.values()].every((v) => v === 0)).toBe(true);
  });
});

describe('worstSharedWeakness', () => {
  const pressure = new Map([['fighting', 1], ['fire', 0.5]]);
  it('names a weakness both members share, above the pressure floor', () => {
    const w = worstSharedWeakness([['steel'], ['steel']], pressure, 0);
    expect(w).not.toBeNull();
    expect(w!.count).toBeGreaterThanOrEqual(2);
    expect(typeof w!.type).toBe('string');
  });
  it('reports the WORST weakness by count, leaving the threshold to the caller', () => {
    // Deliberately not null for an unshared weakness: build-teams asks
    // `w.count > cap`, so the function's job is to name the maximum and the
    // caller's job is to decide how many is too many.
    const w = worstSharedWeakness([['water'], ['electric']], pressure, 0)!;
    expect(w).not.toBeNull();
    expect(w.count).toBeLessThanOrEqual(1);
  });
  it('reports a higher count when the team really does stack a weakness', () => {
    const shared = worstSharedWeakness([['steel'], ['steel'], ['steel']], pressure, 0)!;
    const varied = worstSharedWeakness([['water'], ['electric']], pressure, 0)!;
    expect(shared.count).toBeGreaterThan(varied.count);
  });
  it('respects the minimum-pressure floor', () => {
    expect(worstSharedWeakness([['steel'], ['steel']], pressure, 99)).toBeNull();
  });
});

describe('coreStrength', () => {
  const row = (v: number[]) => Float64Array.from(v);
  it('rewards a partner that wins exactly where the other loses', () => {
    const a = row([900, 900, 100, 100]);
    const b = row([100, 100, 900, 900]);
    expect(coreStrength(a, b)).toBeGreaterThan(coreStrength(a, a));
  });
  it('scores a passenger near nothing however strong the carrier', () => {
    const strong = row([900, 900, 900, 900]);
    const weak = row([100, 100, 100, 100]);
    // Rescue is mutual by construction, so one-way cover cannot score well.
    expect(coreStrength(strong, weak)).toBeLessThan(coreStrength(row([900, 900, 100, 100]), row([100, 100, 900, 900])));
  });
  it('discounts a pair that shares a weakness', () => {
    const a = row([900, 900, 100, 100]);
    const b = row([100, 100, 900, 900]);
    expect(coreStrength(a, b, undefined, 1, 1, 1)).toBeLessThan(coreStrength(a, b, undefined, 1, 1, 0));
  });
  it('scales with each member’s own strength', () => {
    const a = row([900, 900, 100, 100]);
    const b = row([100, 100, 900, 900]);
    expect(coreStrength(a, b, undefined, 1, 1)).toBeGreaterThan(coreStrength(a, b, undefined, 0.25, 0.25));
  });
  it('honours a weight vector, so tail opponents can be discounted', () => {
    const a = row([900, 900, 100, 100]);
    const b = row([100, 100, 900, 900]);
    const flat = coreStrength(a, b, Float64Array.from([1, 1, 1, 1]));
    const headOnly = coreStrength(a, b, Float64Array.from([1, 1, 0, 0]));
    expect(Number.isFinite(flat)).toBe(true);
    expect(Number.isFinite(headOnly)).toBe(true);
    expect(headOnly).not.toBe(flat);
  });
  it('is finite and non-negative across degenerate input', () => {
    for (const [x, y] of [[row([0,0]), row([0,0])], [row([1000,1000]), row([0,0])]]) {
      const v = coreStrength(x, y);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it('exposes the thresholds it judges by', () => {
    expect(WIN_LINE).toBeLessThan(ANSWER_LINE);
    expect(SHARED_WEAK_COST).toBeGreaterThan(0);
    expect(EVIDENCE_N).toBeGreaterThan(0);
  });
});
