import { describe, it, expect } from 'vitest';
import { getEntry, opponentInfo, SHADOW_ATK_MULT, SHADOW_DEF_MULT } from '../engine';
import { makeRef } from '../data';

/**
 * A Shadow's stats are its base form's.
 *
 * The 6/5 attack and 5/6 defence are multipliers applied inside the damage
 * formula. They are not changes to Attack or Defense, which is why CP does not
 * move when the form does and why charge-move priority between a Shadow and
 * its base form is always a tie.
 *
 * The report was displaying the multiplied figures as the stats: Venusaur read
 * 119.8/122.8 as normal and 143.7/102.3 as Shadow, beside an unchanged CP of
 * 1477 — two numbers that cannot both be right.
 */

const IV = { a: 10, d: 10, s: 10 };

describe('Shadow does not change a stat', () => {
  const plain = getEntry(makeRef('venusaur', false), IV, 'great').entry;
  const shadow = getEntry(makeRef('venusaur', true), IV, 'great').entry;

  it('reports the same Attack and Defense stat for both forms', () => {
    expect(shadow.statAtk).toBeCloseTo(plain.statAtk, 6);
    expect(shadow.statDef).toBeCloseTo(plain.statDef, 6);
    expect(shadow.hp).toBe(plain.hp);
  });

  it('leaves CP, level and rank alone, because those read the stats', () => {
    expect(shadow.cp).toBe(plain.cp);
    expect(shadow.lvl).toBe(plain.lvl);
    // Attack x6/5 and defence x5/6 cancel in stat product, so the rank holds.
    expect(shadow.rank).toBe(plain.rank);
  });

  it('still carries the multipliers on the damage figures', () => {
    // `atk`/`def` are what the damage formula consumes, and those do move.
    expect(shadow.atk).toBeCloseTo(plain.statAtk * SHADOW_ATK_MULT, 6);
    expect(shadow.def).toBeCloseTo(plain.statDef * SHADOW_DEF_MULT, 6);
    expect(shadow.atk).toBeGreaterThan(shadow.statAtk);
    expect(shadow.def).toBeLessThan(shadow.statDef);
  });

  it('gives an opponent the same split, so CMP can be judged on the stat', () => {
    const a = opponentInfo(makeRef('murkrow', false), 'great');
    const b = opponentInfo(makeRef('murkrow', true), 'great');
    // The report's flip view compares statAtk against the foe's cmpAtk; both
    // sides must be stats or a Shadow reads as winning ties it cannot win.
    expect(b.statAtk).toBeCloseTo(a.statAtk, 6);
    expect(b.atk).toBeGreaterThan(a.atk);
  });
});
