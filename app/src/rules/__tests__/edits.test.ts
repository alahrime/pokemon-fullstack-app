import { describe, it, expect } from 'vitest';
import { addSpecies, removeRef, toggleType, typesOn } from '../edits';
import { resolvePool } from '../pool';
import { RULES_SCHEMA, type Format } from '../types';
import { makeRef, parseRef, speciesOf } from '../../lib/data';

const empty: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  start: 'empty',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

describe('toggleType', () => {
  it('adds a type and reports it on', () => {
    const f = toggleType(empty, 'water');
    expect(typesOn(f).has('water')).toBe(true);
    expect(resolvePool(f).legal.every((r) => speciesOf(r)?.types.includes('water'))).toBe(true);
  });

  it('removes the type again, leaving no residue', () => {
    const f = toggleType(toggleType(empty, 'water'), 'water');
    expect(typesOn(f).has('water')).toBe(false);
    expect(f.pool).toEqual([]);
  });

  it('holds several types at once', () => {
    const f = ['water', 'fire', 'flying'].reduce(toggleType, empty);
    expect([...typesOn(f)].sort()).toEqual(['fire', 'flying', 'water']);
    expect(resolvePool(f).legal.length).toBeGreaterThan(0);
  });

  it('does not mutate the format it is given', () => {
    const before = JSON.stringify(empty);
    toggleType(empty, 'water');
    expect(JSON.stringify(empty)).toBe(before);
  });
});

describe('addSpecies', () => {
  it('adds both variants by default', () => {
    const f = addSpecies(empty, 'registeel', 'both');
    const legal = resolvePool(f).legal;
    expect(legal).toContain('registeel');
    expect(legal).toContain(makeRef('registeel', true));
  });

  it('adds the normal form only', () => {
    const f = addSpecies(empty, 'registeel', 'normal');
    const legal = resolvePool(f).legal;
    expect(legal).toContain('registeel');
    expect(legal).not.toContain(makeRef('registeel', true));
  });

  it('adds the Shadow only', () => {
    const f = addSpecies(empty, 'registeel', 'shadow');
    const legal = resolvePool(f).legal;
    expect(legal).toContain(makeRef('registeel', true));
    expect(legal).not.toContain('registeel');
  });
});

describe('removeRef', () => {
  it('takes one ref out of a type that was added wholesale', () => {
    const water = toggleType(empty, 'water');
    const target = resolvePool(water).legal.find((r) => !parseRef(r).shadow)!;
    const f = removeRef(water, target);
    expect(resolvePool(f).legal).not.toContain(target);
    expect(typesOn(f).has('water')).toBe(true);
  });

  it('removes only the variant asked for', () => {
    const f0 = addSpecies(empty, 'registeel', 'both');
    const f1 = removeRef(f0, makeRef('registeel', true));
    const legal = resolvePool(f1).legal;
    expect(legal).toContain('registeel');
    expect(legal).not.toContain(makeRef('registeel', true));
  });

  it('undoes an individual add rather than piling on a deny', () => {
    const f = removeRef(addSpecies(empty, 'registeel', 'both'), 'registeel');
    expect(f.pool).toEqual([]);
  });

  it('does not mutate the format it is given', () => {
    const water = toggleType(empty, 'water');
    const before = JSON.stringify(water);
    removeRef(water, resolvePool(water).legal[0]);
    expect(JSON.stringify(water)).toBe(before);
  });
});
