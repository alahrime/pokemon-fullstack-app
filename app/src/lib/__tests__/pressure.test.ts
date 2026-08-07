import { describe, it, expect } from 'vitest';
import {
  coverageBreadth, energyRate, pressureScore, pressureWeight, turnsToThreat, PRESSURE_FLOOR,
} from '../pressure';
import type { ChargeMove, FastMove, Species } from '../types';

const fast = (energyGain: number, turns: number): FastMove =>
  ({ id: 'f', name: 'F', type: 'normal', archetype: null, power: 5, turns, energyGain, stab: 1 });
const charge = (energy: number, type = 'normal'): ChargeMove =>
  ({ id: 'c' + energy + type, name: 'C', type, archetype: null, power: 90, energy, stab: 1 });
const foe = (id: string, types: string[]): Species => ({ id, types } as unknown as Species);

describe('energyRate', () => {
  it('is energy per turn', () => expect(energyRate(fast(13, 3))).toBeCloseTo(4.333, 3));
  it('handles a one-turn move', () => expect(energyRate(fast(5, 1))).toBe(5));
  it('does not divide by zero', () => expect(energyRate(fast(5, 0))).toBe(0));
});

describe('turnsToThreat', () => {
  it('uses the CHEAPEST charge, not the first', () => {
    // 35 / (13/3) = 8.08 — the 60-cost move must not decide this.
    expect(turnsToThreat(fast(13, 3), [charge(60), charge(35)])).toBeCloseTo(8.08, 1);
  });
  it('is Infinity with no charged move at all', () =>
    expect(turnsToThreat(fast(13, 3), [])).toBe(Infinity));
  it('is Infinity when the fast move generates nothing', () =>
    expect(turnsToThreat(fast(0, 3), [charge(35)])).toBe(Infinity));
});

describe('coverageBreadth', () => {
  const field = [foe('a', ['rock']), foe('b', ['steel']), foe('c', ['water']), foe('d', ['normal'])];
  it('counts the share NOT resisting', () => {
    // Normal is resisted by rock and steel, neutral into water and normal.
    expect(coverageBreadth([charge(50, 'normal')], field, 'self')).toBeCloseTo(0.5, 5);
  });
  it('takes the best move available, so coverage is a union', () => {
    // Fighting is super effective on both rock and steel, so nothing resists.
    expect(coverageBreadth([charge(50, 'normal'), charge(50, 'fighting')], field, 'self')).toBe(1);
  });
  it('excludes the Pokemon itself from its own field', () => {
    const self = [foe('self', ['rock']), foe('x', ['water'])];
    // Only 'x' is judged, and normal does not resist water.
    expect(coverageBreadth([charge(50, 'normal')], self, 'self')).toBe(1);
  });
  it('is 0 with no charged moves, and with an empty field', () => {
    expect(coverageBreadth([], field, 'self')).toBe(0);
    expect(coverageBreadth([charge(50)], [], 'self')).toBe(0);
  });
});

describe('pressureScore', () => {
  const field = [foe('a', ['water']), foe('b', ['normal'])];
  it('is bounded to 0..1000', () => {
    const hi = pressureScore(fast(20, 1), [charge(10, 'fighting')], field, 'self');
    const lo = pressureScore(fast(0, 5), [charge(100, 'normal')], [foe('r', ['rock'])], 'self');
    expect(hi).toBeLessThanOrEqual(1000);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
  it('rises with energy rate, all else equal', () => {
    const slow = pressureScore(fast(6, 3), [charge(40)], field, 'self');
    const quick = pressureScore(fast(15, 3), [charge(40)], field, 'self');
    expect(quick).toBeGreaterThan(slow);
  });
  it('rises with coverage, all else equal', () => {
    const walled = pressureScore(fast(12, 3), [charge(40, 'normal')], [foe('r', ['rock']), foe('s', ['steel'])], 'self');
    const clear = pressureScore(fast(12, 3), [charge(40, 'fighting')], [foe('r', ['rock']), foe('s', ['steel'])], 'self');
    expect(clear).toBeGreaterThan(walled);
  });
  it('rises when the cheapest charge gets cheaper', () => {
    const dear = pressureScore(fast(12, 3), [charge(75)], field, 'self');
    const cheap = pressureScore(fast(12, 3), [charge(35)], field, 'self');
    expect(cheap).toBeGreaterThan(dear);
  });
});

describe('pressureWeight', () => {
  it('never drops below the floor, so a weak opponent still counts', () => {
    expect(pressureWeight(0)).toBeCloseTo(PRESSURE_FLOOR, 5);
  });
  it('reaches 1 at full pressure', () => expect(pressureWeight(1000)).toBeCloseTo(1, 5));
  it('is monotonic', () => {
    expect(pressureWeight(800)).toBeGreaterThan(pressureWeight(400));
  });
  it('clamps out-of-range input rather than extrapolating', () => {
    expect(pressureWeight(5000)).toBeCloseTo(1, 5);
    expect(pressureWeight(-100)).toBeCloseTo(PRESSURE_FLOOR, 5);
  });
});
