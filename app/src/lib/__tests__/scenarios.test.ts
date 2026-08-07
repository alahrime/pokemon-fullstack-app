import { describe, it, expect } from 'vitest';
import {
  CATEGORIES, SCENARIOS, SCENARIO_IDS, SHIELD_STATES, SOFT_CAP, LOSS_CURVE, SHIELD_BONUS,
  ENERGY_DEBT, bankedEnergy, consistencyScore, makeOverall, rating, weightedScore,
} from '../scenarios';
import type { BattleResult } from '../types';
import type { ScenarioId } from '../scenarios';

const res = (o: Partial<BattleResult> = {}): BattleResult => ({
  win: true, mine: 0.5, theirs: 0.5, hpA: 50, hpB: 0, maxHpA: 100, maxHpB: 100,
  cmpDecided: false, margin: 0, energyA: 0, energyB: 0, shieldsA: 0, shieldsB: 0, log: [], ...o,
});

describe('rating', () => {
  it('an even trade lands near the middle of the scale', () => {
    const v = rating(res({ win: false, mine: 0.5, theirs: 0.5, hpB: 50 }), 0, 0);
    expect(v).toBeGreaterThan(400);
    expect(v).toBeLessThan(600);
  });
  it('pays for shields forced and shields kept, but only on a win', () => {
    const won = rating(res({ win: true, shieldsA: 2, shieldsB: 0 }), 2, 2);
    const lost = rating(res({ win: false, hpB: 50, shieldsA: 2, shieldsB: 0 }), 2, 2);
    expect(won).toBeGreaterThan(lost);
  });
  it('credits energy carried out of a win', () => {
    const empty = rating(res({ energyA: 0 }), 1, 1);
    const loaded = rating(res({ energyA: 100 }), 1, 1);
    expect(loaded).toBeGreaterThan(empty);
  });
  it('docks a loss that leaves the opponent holding energy', () => {
    const clean = rating(res({ win: false, hpB: 40, energyB: 0 }), 1, 1);
    const banked = rating(res({ win: false, hpB: 40, energyB: 100 }), 1, 1);
    expect(banked).toBeLessThan(clean);
  });
  it('soft-caps a blowout, so crushing is barely better than clean', () => {
    const clean = rating(res({ mine: 0.75, theirs: 0 }), 0, 0);
    const crush = rating(res({ mine: 1, theirs: 0 }), 0, 0);
    expect(crush).toBeGreaterThan(clean);
    expect(crush - clean).toBeLessThan(20);
    expect(crush).toBeLessThan(SOFT_CAP + 50);
  });
  it('curves a limp loss below the clean-loss line', () => {
    const close = rating(res({ win: false, mine: 0, theirs: 0.45, hpB: 55 }), 0, 0);
    const limp = rating(res({ win: false, mine: 0, theirs: 0.98, hpB: 2 }), 0, 0);
    expect(limp).toBeLessThan(close);
    expect(limp).toBeLessThan(LOSS_CURVE);
  });
  it('never returns a negative or non-finite score', () => {
    for (const m of [0, 0.5, 1]) for (const t of [0, 0.5, 1]) for (const w of [true, false]) {
      const v = rating(res({ win: w, mine: m, theirs: t, hpB: w ? 0 : 10 }), 2, 2);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it('exposes its constants for the team rating to reuse', () => {
    expect(SHIELD_BONUS).toBe(100);
    expect(ENERGY_DEBT).toBe(100);
  });
});

describe('scenario table', () => {
  it('covers the full nine-state shield lattice plus two energy states', () => {
    expect(SHIELD_STATES).toHaveLength(9);
    expect(SCENARIOS).toHaveLength(11);
    expect(SCENARIO_IDS).toContain('switch');
    expect(SCENARIO_IDS).toContain('charger');
  });
  it('the switch scenario arrives against a banked opponent', () => {
    const s = SCENARIOS.find((x) => x.id === 'switch')!;
    expect(s.bankedB).toBeGreaterThan(0);
    expect(s.bankedA).toBe(0);
  });
  it('the charger scenario is the mirror of it', () => {
    const s = SCENARIOS.find((x) => x.id === 'charger')!;
    expect(s.bankedA).toBeGreaterThan(0);
    expect(s.bankedB).toBe(0);
  });
  it('every shield state names a real 0-2 pair', () => {
    for (const id of SHIELD_STATES) {
      const s = SCENARIOS.find((x) => x.id === id)!;
      expect(s.shieldsA).toBe(Number(id[2]));
      expect(s.shieldsB).toBe(Number(id[3]));
    }
  });
});

describe('categories', () => {
  it('has an overall plus the roles and the two axes', () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(ids).toContain('overall');
    expect(ids).toContain('pressure');
    expect(ids).toContain('consistency');
  });
  it('pressure and consistency carry no scenario weights — they are not blends', () => {
    for (const id of ['pressure', 'consistency']) {
      expect(Object.keys(CATEGORIES.find((c) => c.id === id)!.weights)).toHaveLength(0);
    }
  });
  it('every blended category weights only real scenarios, summing to 1', () => {
    for (const c of CATEGORIES) {
      const keys = Object.keys(c.weights);
      if (!keys.length) continue;
      for (const k of keys) expect(SCENARIO_IDS).toContain(k as ScenarioId);
      const sum = Object.values(c.weights).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});

const per = (v: number): Record<ScenarioId, number> =>
  Object.fromEntries(SCENARIO_IDS.map((id) => [id, v])) as Record<ScenarioId, number>;

describe('weightedScore', () => {
  it('blends by the category weights', () => {
    expect(weightedScore(per(600), { sh11: 1 })).toBeCloseTo(600, 6);
  });
  it('is a weighted mean, not a sum', () => {
    const p = { ...per(0), sh11: 800, sh22: 400 } as Record<ScenarioId, number>;
    expect(weightedScore(p, { sh11: 0.5, sh22: 0.5 })).toBeCloseTo(600, 6);
  });
});

describe('consistencyScore', () => {
  it('is the mean when nothing varies', () => {
    expect(consistencyScore(per(600), 1)).toBe(600);
  });
  it('penalises spread across the shield lattice', () => {
    const spread = { ...per(600), sh00: 200, sh22: 1000 } as Record<ScenarioId, number>;
    expect(consistencyScore(spread, 1)).toBeLessThan(consistencyScore(per(600), 1));
  });
  it('no longer prices fast-move length, which the sim already charges for', () => {
    expect(consistencyScore(per(600), 1)).toBe(consistencyScore(per(600), 5));
  });
  it('never goes negative', () => {
    const wild = { ...per(0), sh00: 0, sh22: 1000 } as Record<ScenarioId, number>;
    expect(consistencyScore(wild, 4)).toBeGreaterThanOrEqual(0);
  });
});

describe('makeOverall', () => {
  it('scores a uniformly strong mon above a uniformly weak one', () => {
    const rows = [per(900), per(300)];
    const f = makeOverall(rows, [1, 1], [900, 300]);
    expect(f(0)).toBeGreaterThan(f(1));
  });
  it('rewards pressure, all else equal', () => {
    const rows = [per(600), per(600)];
    const f = makeOverall(rows, [1, 1], [1000, 100]);
    expect(f(0)).toBeGreaterThan(f(1));
  });
  it('a single weak axis drags the geometric mean', () => {
    const rows = [per(900), per(900)];
    const strong = makeOverall(rows, [1, 1], [900, 900]);
    const oneWeak = makeOverall([per(900), { ...per(900), sh00: 1 } as Record<ScenarioId, number>], [1, 1], [900, 900]);
    expect(oneWeak(1)).toBeLessThanOrEqual(strong(1));
  });
  it('never returns NaN even when a category is zero everywhere', () => {
    const f = makeOverall([per(0)], [1], [0]);
    expect(Number.isFinite(f(0))).toBe(true);
  });
});

describe('bankedEnergy', () => {
  it('is the cheapest charged move', () => {
    expect(bankedEnergy([{ energy: 60 } as never, { energy: 35 } as never])).toBe(35);
  });
  it('is 0 with no charged moves', () => expect(bankedEnergy([])).toBe(0));
});
