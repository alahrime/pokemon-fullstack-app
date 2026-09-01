import { describe, it, expect } from 'vitest';
import { MINIMUM_AGE, isOldEnough } from '../age';

/** A fixed clock. Computing "today" here would make the boundary cases rot. */
const TODAY = new Date(2026, 8, 1); // 1 September 2026, local time

describe('the age gate', () => {
  it('refuses under-13s and admits everyone else', () => {
    expect(MINIMUM_AGE).toBe(13);
  });

  it('admits someone who turns 13 today', () => {
    expect(isOldEnough('2013-09-01', TODAY)).toBe(true);
  });

  it('refuses someone one day short of 13', () => {
    expect(isOldEnough('2013-09-02', TODAY)).toBe(false);
  });

  it('admits someone who turned 13 yesterday', () => {
    expect(isOldEnough('2013-08-31', TODAY)).toBe(true);
  });

  it('admits an adult', () => {
    expect(isOldEnough('1990-04-17', TODAY)).toBe(true);
  });

  it('refuses a twelve-year-old', () => {
    expect(isOldEnough('2014-01-01', TODAY)).toBe(false);
  });

  it('refuses a date in the future', () => {
    expect(isOldEnough('2030-01-01', TODAY)).toBe(false);
  });

  it('refuses an empty or malformed date rather than guessing', () => {
    expect(isOldEnough('', TODAY)).toBe(false);
    expect(isOldEnough('2013', TODAY)).toBe(false);
    expect(isOldEnough('01/09/2013', TODAY)).toBe(false);
    expect(isOldEnough('2013-9-1', TODAY)).toBe(false);
  });

  it('refuses a day that does not exist', () => {
    expect(isOldEnough('2001-02-30', TODAY)).toBe(false);
    expect(isOldEnough('2001-13-01', TODAY)).toBe(false);
  });

  /**
   * The timezone trap. `new Date('2013-09-01')` is UTC midnight, which is the
   * 31st of August anywhere west of Greenwich — so a parser using it would
   * admit someone a day early. This asserts the local-parts reading holds.
   */
  it('reads the date in local time, not UTC', () => {
    // One day short is one day short regardless of the machine's offset.
    expect(isOldEnough('2013-09-02', new Date(2026, 8, 1))).toBe(false);
    expect(isOldEnough('2013-09-02', new Date(2026, 8, 2))).toBe(true);
  });

  /** A leap-day birthday has no 29 February to turn 13 on in 2026. */
  it('puts a 29 February birthday on 1 March in a non-leap year', () => {
    expect(isOldEnough('2013-02-28', new Date(2026, 1, 28))).toBe(true);
    expect(isOldEnough('2012-02-29', new Date(2025, 1, 28))).toBe(false);
    expect(isOldEnough('2012-02-29', new Date(2025, 2, 1))).toBe(true);
  });

  it('takes the minimum as a parameter, so a different one can be asked for', () => {
    expect(isOldEnough('2010-09-01', TODAY, 16)).toBe(true);
    expect(isOldEnough('2011-09-01', TODAY, 16)).toBe(false);
  });
});
