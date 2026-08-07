import { describe, it, expect, vi } from 'vitest';
import {
  SYNERGY_WEIGHTS, pairReport, rescue, resistancesOf, sharedExposure, weaknessesOf,
  synergyOf,
} from "../synergy";
import { download, downloadCsv, downloadJson } from '../exportData';

describe('weaknessesOf and resistancesOf', () => {
  it('names what a typing fears and what it shrugs off', () => {
    const w = weaknessesOf(['steel']);
    expect(w).toContain('fighting');
    expect(w).toContain('fire');
    expect(resistancesOf(['steel'])).toContain('fairy');
  });
  it('accounts for both halves of a dual type', () => {
    // Water cancels steel's fire weakness.
    expect(weaknessesOf(['steel', 'water'])).not.toContain('fire');
  });
  it('never lists a type as both a weakness and a resistance', () => {
    for (const t of [['water'], ['steel','fairy'], ['dragon','flying']]) {
      const w = new Set(weaknessesOf(t));
      expect(resistancesOf(t).some((r) => w.has(r))).toBe(false);
    }
  });
});

describe('rescue', () => {
  const row = (v: number[]) => Float64Array.from(v);
  it('is zero when the partner loses everywhere the other does', () => {
    expect(rescue(row([100, 100]), row([100, 100]))).toBe(0);
  });
  it('is positive when the partner wins where the other loses', () => {
    expect(rescue(row([100, 100]), row([900, 900]))).toBeGreaterThan(0);
  });
  it('ignores matchups the first member already wins', () => {
    // b is brilliant everywhere, but a needs no help in the first slot.
    const helpBoth = rescue(row([100, 100]), row([900, 900]));
    const helpOne = rescue(row([900, 100]), row([900, 900]));
    expect(helpOne).toBeLessThan(helpBoth);
  });
  it('honours a weight vector — a rescue nobody needs counts for less', () => {
    // A loses both; B answers the first strongly and the second barely.
    const a = row([100, 100]), b = row([900, 570]);
    const onlyBig = rescue(a, b, Float64Array.from([1, 0]));
    const onlySmall = rescue(a, b, Float64Array.from([0, 1]));
    expect(onlyBig).toBeGreaterThan(onlySmall);
  });
  it('divides by the whole field, not by A\'s losses', () => {
    // The regression this guards: a ratio over A's losses rewards having few
    // problems. Carbink loses to almost nothing, so any partner covering that
    // handful scored enormously while covering nothing in absolute terms.
    const fewProblems = rescue(row([900, 900, 900, 100]), row([900, 900, 900, 900]));
    const manyProblems = rescue(row([100, 100, 100, 100]), row([900, 900, 900, 900]));
    expect(manyProblems).toBeGreaterThan(fewProblems);
  });
  it('is not symmetric — carrying is not the same as being carried', () => {
    const strong = row([900, 900]), weak = row([100, 100]);
    expect(rescue(weak, strong)).not.toBe(rescue(strong, weak));
  });
});

describe('sharedExposure', () => {
  const pressure = new Map([['fighting', 1], ['ground', 0.5], ['water', 0.1]]);
  it('names types both members fear and scores the exposure', () => {
    const e = sharedExposure(['steel'], ['steel'], pressure);
    expect(e.types).toContain('fighting');
    expect(e.exposure).toBeGreaterThan(0);
  });
  it('is empty when the pair covers each other', () => {
    const e = sharedExposure(['water'], ['grass'], pressure);
    expect(e.exposure).toBe(0);
  });
  it('weighs a well-represented attacking type above a rare one', () => {
    const hi = sharedExposure(['steel'], ['steel'], new Map([['fighting', 1]]));
    const lo = sharedExposure(['steel'], ['steel'], new Map([['fighting', 0.05]]));
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
  });
});

describe('pairReport', () => {
  const row = (v: number[]) => Float64Array.from(v);
  it('reports both directions and the evidence behind them', () => {
    const r = pairReport(
      'azumarill', 'registeel',
      row([100, 100, 900, 900]), row([900, 900, 100, 100]),
      ['a', 'b', 'c', 'd'],
    );
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Array.isArray(r.aCovers)).toBe(true);
    expect(Array.isArray(r.bCovers)).toBe(true);
  });
  it('accepts a pressure map and reports a shared weakness', () => {
    const r = pairReport(
      'registeel', 'registeel', row([500, 500]), row([500, 500]), ['a', 'b'],
      undefined, 1, 1, new Map([['fighting', 1]]),
    );
    expect(Array.isArray(r.sharedWeak)).toBe(true);
  });
});

describe('synergy weights', () => {
  it('sum to one, so the blend is a mean', () => {
    const sum = Object.values(SYNERGY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
  it('weight coverage highest, because raising the floor is the point', () => {
    const vals = Object.entries(SYNERGY_WEIGHTS).sort((a, b) => b[1] - a[1]);
    expect(vals[0][0]).toBe('coverage');
  });
});

describe('download helpers', () => {
  it('creates and revokes an object URL, and clicks a link', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    URL.createObjectURL = (() => { const u = 'blob:' + created.length; created.push(u); return u; }) as never;
    URL.revokeObjectURL = ((u: string) => void revoked.push(u)) as never;
    download('x.txt', 'body', 'text/plain');
    expect(created).toHaveLength(1);
  });
  it('downloadCsv and downloadJson name the file by extension', () => {
    const names: string[] = [];
    URL.createObjectURL = (() => 'blob:x') as never;
    URL.revokeObjectURL = (() => {}) as never;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        Object.defineProperty(el, 'download', { set: (v: string) => names.push(v), get: () => '' });
        el.click = () => {};
      }
      return el;
    });
    downloadCsv('report', [{ a: 1 }]);
    downloadJson('report', { a: 1 });
    expect(names).toEqual(['report.csv', 'report.json']);
  });
});

describe('synergyOf', () => {
  const field = ['x', 'y', 'z', 'w'];
  const solo = (neutral: number[][], switching: number[][]) => ({
    field,
    neutral: neutral.map((r) => Float64Array.from(r)),
    switching: switching.map((r) => Float64Array.from(r)),
  });

  it('scores coverage as the mean of the team\'s best answer per opponent', () => {
    const s = synergyOf(
      ['azumarill', 'registeel'],
      solo([[900, 100, 900, 100], [100, 900, 100, 900]],
           [[900, 100, 900, 100], [100, 900, 100, 900]]),
      [1, 1],
    );
    expect(s.coverage).toBe(900);
    expect(s.holes).toEqual([]);
  });

  it('names the opponents nobody on the team beats', () => {
    const s = synergyOf(
      ['azumarill', 'registeel'],
      solo([[900, 100, 900, 900], [900, 100, 900, 900]],
           [[900, 100, 900, 900], [900, 100, 900, 900]]),
      [1, 1],
    );
    expect(s.holes).toEqual(['y']);
  });

  it('gives full redundancy only when two members answer', () => {
    const two = synergyOf(['azumarill', 'registeel'],
      solo([[900, 900, 900, 900], [900, 900, 900, 900]],
           [[900, 900, 900, 900], [900, 900, 900, 900]]), [1, 1]);
    const one = synergyOf(['azumarill', 'registeel'],
      solo([[900, 900, 900, 900], [100, 100, 100, 100]],
           [[900, 900, 900, 900], [100, 100, 100, 100]]), [1, 1]);
    expect(two.redundancy).toBe(1000);
    expect(one.redundancy).toBe(500);
  });

  it('credits a lead that loses to nothing rather than leaving it undefined', () => {
    // The regression: an undefined recovery score would punish the best leads.
    const s = synergyOf(
      ['azumarill', 'registeel'],
      solo([[900, 900, 900, 900], [900, 900, 900, 900]],
           [[0, 0, 0, 0], [0, 0, 0, 0]]),
      [1, 1],
    );
    expect(s.swapWorst).toBe(1000);
    expect(s.swapMean).toBe(1000);
  });

  it('rates the back line on how it answers what beats the lead', () => {
    const strongBack = synergyOf(['azumarill', 'registeel'],
      solo([[100, 100, 100, 100], [100, 100, 100, 100]],
           [[900, 900, 900, 900], [900, 900, 900, 900]]), [1, 1]);
    const weakBack = synergyOf(['azumarill', 'registeel'],
      solo([[100, 100, 100, 100], [100, 100, 100, 100]],
           [[100, 100, 100, 100], [100, 100, 100, 100]]), [1, 1]);
    expect(strongBack.swapWorst).toBeGreaterThan(weakBack.swapWorst);
    expect(strongBack.score).toBeGreaterThan(weakBack.score);
  });

  it('carries bulk through as a fraction of the pool best', () => {
    const s = synergyOf(['azumarill', 'registeel'],
      solo([[500, 500, 500, 500], [500, 500, 500, 500]],
           [[500, 500, 500, 500], [500, 500, 500, 500]]), [1, 0.5]);
    expect(s.bulk).toBe(750);
  });

  it('returns every component rounded to a whole rating point', () => {
    const s = synergyOf(['azumarill', 'registeel'],
      solo([[513, 447, 601, 388], [402, 655, 411, 590]],
           [[513, 447, 601, 388], [402, 655, 411, 590]]), [0.83, 0.61]);
    for (const v of [s.score, s.coverage, s.redundancy, s.swapWorst, s.swapMean, s.typeCover, s.bulk]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
