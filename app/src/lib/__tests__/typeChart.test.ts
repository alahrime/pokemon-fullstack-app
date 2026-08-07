import { describe, it, expect } from 'vitest';
import { typeEffectiveness } from '../typeChart';

const SE = 1.6, NVE = 0.625, IMM = 0.625 * 0.625;

describe('typeEffectiveness', () => {
  it('is neutral by default', () => expect(typeEffectiveness('normal', ['water'])).toBe(1));
  it('uses GO steps, not the main series', () => {
    expect(typeEffectiveness('water', ['fire'])).toBeCloseTo(SE, 6);
    expect(typeEffectiveness('water', ['grass'])).toBeCloseTo(NVE, 6);
  });
  it('models a main-series immunity as a double resist, never zero', () => {
    expect(typeEffectiveness('normal', ['ghost'])).toBeCloseTo(IMM, 6);
    expect(typeEffectiveness('ghost', ['normal'])).toBeCloseTo(IMM, 6);
    expect(typeEffectiveness('electric', ['ground'])).toBeCloseTo(IMM, 6);
  });
  it('multiplies across a dual type', () => {
    expect(typeEffectiveness('grass', ['water', 'ground'])).toBeCloseTo(SE * SE, 6);
    expect(typeEffectiveness('fire', ['water', 'rock'])).toBeCloseTo(NVE * NVE, 6);
  });
  it('cancels when one half resists and the other is weak', () => {
    expect(typeEffectiveness('ground', ['fire', 'flying'])).toBeCloseTo(SE * IMM, 6);
  });
  it('does NOT resist rock with water — a wrong assumption once cost an investigation', () => {
    expect(typeEffectiveness('rock', ['water'])).toBe(1);
  });
  it('never returns zero, because nothing in GO deals no damage', () => {
    const types = ['normal','fire','water','electric','grass','ice','fighting','poison','ground',
      'flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
    for (const a of types) for (const b of types) {
      expect(typeEffectiveness(a, [b])).toBeGreaterThan(0);
      expect(typeEffectiveness(a, [b])).toBeLessThanOrEqual(SE * SE);
    }
  });
  it('is unaffected by the order of a dual type', () => {
    expect(typeEffectiveness('grass', ['water','ground'])).toBeCloseTo(typeEffectiveness('grass', ['ground','water']), 9);
  });
});
