import { describe, it, expect } from 'vitest';
import { compileSelector } from '../selector';
import { makeRef } from '../../lib/data';

const AZU = 'azumarill';
const AZU_S = makeRef('azumarill', true);

describe('compileSelector', () => {
  it('matches a type across both variants of a species', () => {
    const t = compileSelector('water')!;
    expect(t(AZU)).toBe(true);
    expect(t(AZU_S)).toBe(true);
  });

  it('rebinds `shadow` to mean *is* the Shadow, not *has* one', () => {
    const t = compileSelector('shadow')!;
    expect(t(AZU_S)).toBe(true);
    expect(t(AZU)).toBe(false);
  });

  it('negates the rebound token correctly', () => {
    const t = compileSelector('!shadow')!;
    expect(t(AZU)).toBe(true);
    expect(t(AZU_S)).toBe(false);
  });

  it('composes shadow with a species term to reach one variant', () => {
    const t = compileSelector('azumarill&!shadow')!;
    expect(t(AZU)).toBe(true);
    expect(t(AZU_S)).toBe(false);
  });

  it('keeps `,` as or and `&` as and', () => {
    const or = compileSelector('water,fire')!;
    const and = compileSelector('water&fairy')!;
    expect(or(AZU)).toBe(true);
    expect(and(AZU)).toBe(true);
    expect(compileSelector('water&fire')!(AZU)).toBe(false);
  });

  it('handles shadow inside an or, where it cannot be factored out', () => {
    const t = compileSelector('fire,shadow')!;
    expect(t(AZU_S)).toBe(true);
    expect(t(AZU)).toBe(false);
  });

  it('returns null for an empty selector rather than a match-all', () => {
    expect(compileSelector('')).toBeNull();
    expect(compileSelector('   ')).toBeNull();
  });

  it('is false for a ref whose species does not exist', () => {
    expect(compileSelector('water')!('not_a_species')).toBe(false);
  });
});
