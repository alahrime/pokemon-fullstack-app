import { describe, it, expect } from 'vitest';
import {
  PVP_BONUS, ENERGY_CAP, ENERGY_KEPT, HP_WEIGHT, SHADOW_ATK_MULT, SHADOW_DEF_MULT,
  STAGE_MIN, STAGE_MAX, buffMultiplier, dmg, battle, mkBattleMon, chargesOf, fastMoveCounts,
} from '../engine';
import type { ChargeMove, FastMove } from '../types';

const F = (o: Partial<FastMove> = {}): FastMove =>
  ({ id: 'f', name: 'Fast', type: 'normal', archetype: null, power: 10, turns: 2, energyGain: 8, stab: 1, ...o });
const C = (o: Partial<ChargeMove> = {}): ChargeMove =>
  ({ id: 'c', name: 'Charge', type: 'normal', archetype: null, power: 90, energy: 50, stab: 1, ...o });
const mon = (o: { atk?: number; def?: number; hp?: number; types?: string[]; fast?: FastMove; charges?: ChargeMove[] } = {}) =>
  mkBattleMon(
    { atk: o.atk ?? 100, def: o.def ?? 100, hp: o.hp ?? 150 },
    o.fast ?? F(), o.charges ?? [C()], o.types ?? ['normal'],
  );

describe('dmg', () => {
  it('applies the PvP bonus multiplier', () => {
    // floor(0.5 * 100 * 1 * 1 * 1 * 1.3) + 1
    expect(dmg(100, 100, C({ power: 100 }), ['normal'])).toBe(66);
  });
  it('never deals zero — there is always the +1', () => {
    expect(dmg(1, 1000, C({ power: 1 }), ['normal'])).toBeGreaterThanOrEqual(1);
  });
  it('scales with the attack-to-defence ratio', () => {
    expect(dmg(200, 100, C(), ['normal'])).toBeGreaterThan(dmg(100, 100, C(), ['normal']));
    expect(dmg(100, 200, C(), ['normal'])).toBeLessThan(dmg(100, 100, C(), ['normal']));
  });
  it('applies STAB', () => {
    expect(dmg(100, 100, C({ stab: 1.2 }), ['normal'])).toBeGreaterThan(dmg(100, 100, C({ stab: 1 }), ['normal']));
  });
  it('applies type effectiveness, including a double resist', () => {
    const neutral = dmg(100, 100, C({ type: 'normal' }), ['water']);
    const resisted = dmg(100, 100, C({ type: 'normal' }), ['rock']);
    const doubled = dmg(100, 100, C({ type: 'normal' }), ['ghost']);
    expect(resisted).toBeLessThan(neutral);
    expect(doubled).toBeLessThan(resisted);
  });
  it('is monotonic in attack, which the breakpoint search relies on', () => {
    let prev = 0;
    for (let a = 50; a <= 200; a += 10) {
      const d = dmg(a, 100, C(), ['normal']);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('constants', () => {
  it('carries the Trainer Battle bonus, not the raid formula', () => expect(PVP_BONUS).toBe(1.3));
  it('caps energy at 100', () => expect(ENERGY_CAP).toBe(100));
  it('prices a kept bar and full HP on the same scale as the rating', () => {
    expect(ENERGY_KEPT).toBe(100);
    expect(HP_WEIGHT).toBe(500);
  });
  it('uses the game shadow multipliers, whose product is exactly 1', () => {
    expect(SHADOW_ATK_MULT * SHADOW_DEF_MULT).toBeCloseTo(1, 12);
  });
});

describe('buffMultiplier', () => {
  it('is 1 at stage zero', () => expect(buffMultiplier(0)).toBe(1));
  it('is asymmetric: +1 is 1.25 but -1 is 0.8, not 1/1.25', () => {
    expect(buffMultiplier(1)).toBe(1.25);
    expect(buffMultiplier(-1)).toBe(0.8);
  });
  it('reaches 2x and 0.5x at the extremes', () => {
    expect(buffMultiplier(STAGE_MAX)).toBe(2);
    expect(buffMultiplier(STAGE_MIN)).toBe(0.5);
  });
  it('clamps beyond the extremes', () => {
    expect(buffMultiplier(99)).toBe(buffMultiplier(STAGE_MAX));
    expect(buffMultiplier(-99)).toBe(buffMultiplier(STAGE_MIN));
  });
  it('accepts fractional stages, which chance-gated buffs produce', () => {
    expect(buffMultiplier(0.2)).toBeGreaterThan(1);
    expect(buffMultiplier(0.2)).toBeLessThan(buffMultiplier(1));
  });
});

describe('battle', () => {
  it('is deterministic — same inputs, same result', () => {
    const a = mon(), b = mon({ atk: 90 });
    const x = battle(a, b, 1, 1, 0, 0, false, false);
    const y = battle(a, b, 1, 1, 0, 0, false, false);
    expect(x).toEqual(y);
  });
  it('the stronger attacker wins an otherwise identical matchup', () => {
    const r = battle(mon({ atk: 160 }), mon({ atk: 80 }), 0, 0, 0, 0, false, false);
    expect(r.win).toBe(true);
  });
  it('terminates — someone always faints', () => {
    const r = battle(mon(), mon(), 2, 2, 0, 0, false, false);
    expect(r.hpA <= 0 || r.hpB <= 0).toBe(true);
  });
  it('a shielded charged move deals exactly 1', () => {
    const r = battle(mon({ atk: 200 }), mon({ hp: 400 }), 0, 2, 0, 0, true, false);
    const shielded = r.log.filter((l) => l.shielded);
    expect(shielded.length).toBeGreaterThan(0);
    expect(shielded.every((l) => l.damage === 1)).toBe(true);
  });
  it('spends shields rather than hoarding them', () => {
    const r = battle(mon({ atk: 200 }), mon({ hp: 500 }), 0, 2, 0, 0, false, false);
    expect(r.shieldsB).toBeLessThan(2);
  });
  it('carries starting HP in, for a chained matchup', () => {
    const full = battle(mon(), mon(), 0, 0, 0, 0, false, false);
    const hurt = battle(mon(), mon(), 0, 0, 0, 0, false, false, 20, undefined);
    expect(hurt.win).not.toBe(full.win);
  });
  it('collectLog off produces no log but the same outcome', () => {
    const withLog = battle(mon(), mon({ atk: 80 }), 1, 1, 0, 0, true, false);
    const without = battle(mon(), mon({ atk: 80 }), 1, 1, 0, 0, false, false);
    expect(without.log).toHaveLength(0);
    expect(without.win).toBe(withLog.win);
    expect(without.hpA).toBe(withLog.hpA);
  });
  it('registers a fast move on its FINAL turn, not before', () => {
    const slow = mon({ fast: F({ turns: 5, power: 20 }) });
    const r = battle(slow, mon({ hp: 900, fast: F({ turns: 5 }) }), 0, 0, 0, 0, true, false);
    const first = r.log.find((l) => l.actor === 'A' && l.kind === 'fast');
    expect(first!.turn).toBe(4); // 0-indexed: the 5th turn
  });
  it('a KO denies the victim the fast move it had begun', () => {
    const killer = mon({ atk: 300, fast: F({ turns: 1, energyGain: 60 }) });
    const doomed = mon({ hp: 1, fast: F({ turns: 5 }) });
    const r = battle(killer, doomed, 0, 0, 0, 0, true, false);
    expect(r.log.filter((l) => l.actor === 'B' && l.kind === 'fast')).toHaveLength(0);
  });
  it('starting energy lets a charged move come out sooner', () => {
    const cold = battle(mon(), mon({ hp: 400 }), 0, 0, 0, 0, true, false);
    const loaded = battle(mon(), mon({ hp: 400 }), 0, 0, 100, 0, true, false);
    const firstCharge = (r: typeof cold) => r.log.find((l) => l.actor === 'A' && l.kind === 'charge')?.turn ?? 1e9;
    expect(firstCharge(loaded)).toBeLessThan(firstCharge(cold));
  });
  it('reports energy and shields at the end, for the chain to carry', () => {
    const r = battle(mon(), mon(), 2, 2, 0, 0, false, false);
    expect(r.energyA).toBeGreaterThanOrEqual(0);
    expect(r.energyA).toBeLessThanOrEqual(ENERGY_CAP);
    expect(r.shieldsA).toBeLessThanOrEqual(2);
  });
});

describe('chargesOf and fastMoveCounts', () => {
  it('drops a null second charge', () => {
    expect(chargesOf(C(), null)).toHaveLength(1);
    expect(chargesOf(C(), C({ id: 'c2' }))).toHaveLength(2);
  });
  it('drifts DOWN as leftover energy accumulates, per the worked examples', () => {
    // Rollout gains 13, Body Slam costs 35: three throws of three, then a two.
    expect(fastMoveCounts(F({ energyGain: 13 }), C({ energy: 35 }), 4)).toEqual([3, 3, 3, 2]);
    // Solar Beam at 80 against the same fast move: 7 then sixes.
    expect(fastMoveCounts(F({ energyGain: 13 }), C({ energy: 80 }), 4)).toEqual([7, 6, 6, 6]);
  });
  it('drifts down and then CYCLES, rather than decreasing forever', () => {
    // gain 8, cost 50: residue runs 6,4,2,0 and the fifth throw needs a full
    // seven again. Neither monotonic direction holds — the doc says so and two
    // assumed-monotonic assertions were wrong before this one.
    const counts = fastMoveCounts(F({ energyGain: 8 }), C({ energy: 50 }), 6);
    expect(counts).toEqual([7, 6, 6, 6, 7, 6]);
    const span = Math.max(...counts) - Math.min(...counts);
    expect(span).toBeLessThanOrEqual(1);
  });
  it('lands exactly when the cost divides the gain, with no drift', () => {
    expect(fastMoveCounts(F({ energyGain: 10 }), C({ energy: 50 }), 4)).toEqual([5, 5, 5, 5]);
  });
  it('returns nothing when the fast move generates no energy', () => {
    expect(fastMoveCounts(F({ energyGain: 0 }), C({ energy: 50 }), 4)).toEqual([]);
  });
});
