import { describe, it, expect } from 'vitest';
import { validateTeam } from '../team';
import { RULES_SCHEMA, type Build, type Format } from '../types';
import { SPECIES_BY_ID, makeRef, movesFor } from '../../lib/data';

/** A legal build for a ref, using the league's rated loadout. */
function build(ref: string, league: 'great' | 'ultra' | 'master' = 'great'): Build {
  const id = ref.replace(/_shadow$/, '');
  const s = SPECIES_BY_ID.get(id)!;
  const m = movesFor(s, league);
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
}

function fmt(over: Partial<Format> = {}): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3, uniqueSpecies: true },
    selection: { mode: 'open' },
    ...over,
  };
}

describe('validateTeam', () => {
  it('accepts a legal team of the right size', () => {
    const team = [build('azumarill'), build('registeel'), build('altaria')];
    expect(validateTeam(team, fmt())).toEqual({ ok: true, violations: [] });
  });

  it('rejects the wrong size and says what it wanted', () => {
    const r = validateTeam([build('azumarill')], fmt());
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ kind: 'size', expected: 3, actual: 1 });
  });

  it('rejects a ref the pool banned, naming the clause', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: 'azumarill' }] });
    const r = validateTeam([build('azumarill'), build('registeel'), build('altaria')], f);
    expect(r.violations).toContainEqual({ kind: 'illegal-ref', ref: 'azumarill', clause: 0 });
  });

  it('treats a Pokemon and its own Shadow as the same species', () => {
    // registeel, not azumarill: azumarill.shadowEligible is false in the
    // current generated data, so azumarill_shadow is not a legal ref and
    // would fail on illegal-ref rather than exercising the duplicate check
    // this test is about. registeel is shadow-eligible in Great League.
    const team = [build('registeel'), build(makeRef('registeel', true)), build('altaria')];
    const r = validateTeam(team, fmt());
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === 'duplicate-species')).toBe(true);
  });

  it('allows that pair when uniqueSpecies is off', () => {
    const f = fmt({ composition: { size: 3, uniqueSpecies: false } });
    const team = [build('registeel'), build(makeRef('registeel', true)), build('altaria')];
    expect(validateTeam(team, f).ok).toBe(true);
  });

  it('rejects two members of one evolution family when asked', () => {
    const f = fmt({ composition: { size: 2, uniqueFamilies: true } });
    const r = validateTeam([build('poliwrath'), build('politoed')], f);
    expect(r.violations.some((v) => v.kind === 'duplicate-family')).toBe(true);
  });

  it('rejects a move the species cannot learn', () => {
    const bad: Build = { ...build('azumarill'), fast: 'NOT_A_MOVE' };
    const r = validateTeam([bad, build('registeel'), build('altaria')], fmt());
    expect(r.violations).toContainEqual({ kind: 'unknown-move', ref: 'azumarill', move: 'NOT_A_MOVE' });
  });

  it('collects every violation rather than stopping at the first', () => {
    // registeel, for the same shadow-eligibility reason as above.
    const r = validateTeam([build('registeel'), build(makeRef('registeel', true))], fmt());
    expect(r.violations.length).toBeGreaterThan(1);
  });
});
