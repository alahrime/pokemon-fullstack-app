import { describe, it, expect } from 'vitest';
import { toMatchTerms, toMyTerms } from '../matches';

describe('perspective conversion', () => {
  it('converts what I claim into match terms, from either seat', () => {
    expect(toMatchTerms([true, false, true], 'a')).toEqual(['a', 'b', 'a']);
    expect(toMatchTerms([true, false, true], 'b')).toEqual(['b', 'a', 'b']);
  });

  it('round-trips from both seats', () => {
    const claim = [true, true, false, false, true];
    for (const side of ['a', 'b'] as const) {
      expect(toMyTerms(toMatchTerms(claim, side), side)).toEqual(claim);
    }
  });

  it('reads the same stored array oppositely for the two players', () => {
    const stored = ['a', 'b', 'a'] as const;
    expect(toMyTerms([...stored], 'a')).toEqual([true, false, true]);
    expect(toMyTerms([...stored], 'b')).toEqual([false, true, false]);
  });
});
