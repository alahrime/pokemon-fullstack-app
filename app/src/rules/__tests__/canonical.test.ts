import { describe, it, expect } from 'vitest';
import { canonicalize } from '../canonical';
import { RULES_SCHEMA, type Format } from '../types';

const base: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [
    { effect: 'deny', select: 'flying', note: 'air banned' },
    { effect: 'allow', select: '+mantine' },
  ],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

describe('canonicalize', () => {
  it('is stable across key order', () => {
    const shuffled = {
      selection: base.selection,
      composition: base.composition,
      pool: base.pool,
      base: base.base,
      schema: base.schema,
    } as Format;
    expect(canonicalize(shuffled)).toBe(canonicalize(base));
  });

  it('ignores notes, which are commentary and not rules', () => {
    const noNote: Format = { ...base, pool: [{ effect: 'deny', select: 'flying' }, base.pool[1]] };
    expect(canonicalize(noNote)).toBe(canonicalize(base));
  });

  it('does NOT ignore clause order, because order changes meaning', () => {
    const flipped: Format = { ...base, pool: [base.pool[1], base.pool[0]] };
    expect(canonicalize(flipped)).not.toBe(canonicalize(base));
  });

  it('normalises selector whitespace and case', () => {
    const messy: Format = { ...base, pool: [{ effect: 'deny', select: '  FLYING ' }, base.pool[1]] };
    expect(canonicalize(messy)).toBe(canonicalize(base));
  });

  it('treats an absent optional as identical to its default', () => {
    const explicit: Format = { ...base, composition: { ...base.composition, uniqueFamilies: false } };
    expect(canonicalize(explicit)).toBe(canonicalize(base));
  });
});
