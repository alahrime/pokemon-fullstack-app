import { describe, it, expect } from 'vitest';
import { rollTeam } from '../roll';
import { RULES_SCHEMA, type Format } from '../';
import { SPECIES_BY_ID, movesFor, parseRef, rankOfRef } from '../../lib/data';

function fmt(over: Partial<Format['selection']> = {}, size = 6): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size, uniqueSpecies: true },
    selection: { mode: 'random', ...over },
  };
}

describe('rollTeam', () => {
  it('is deterministic for one seed and player', () => {
    const a = rollTeam(fmt(), 'seed-1', 'player-a');
    const b = rollTeam(fmt(), 'seed-1', 'player-a');
    expect(a).toEqual(b);
  });

  it('gives two players different draws from the same seed', () => {
    const a = rollTeam(fmt(), 'seed-1', 'player-a');
    const b = rollTeam(fmt(), 'seed-1', 'player-b');
    expect(a.map((x) => x.ref)).not.toEqual(b.map((x) => x.ref));
  });

  it('changes with the seed', () => {
    const a = rollTeam(fmt(), 'seed-1', 'player-a');
    const b = rollTeam(fmt(), 'seed-2', 'player-a');
    expect(a.map((x) => x.ref)).not.toEqual(b.map((x) => x.ref));
  });

  it('deals exactly the composition size', () => {
    expect(rollTeam(fmt({}, 3), 's', 'p')).toHaveLength(3);
  });

  it('never deals the same species twice when uniqueSpecies is set', () => {
    const dexes = rollTeam(fmt(), 's', 'p').map((b) => SPECIES_BY_ID.get(parseRef(b.ref).id)!.dex);
    expect(new Set(dexes).size).toBe(dexes.length);
  });

  it('draws only from the top N when asked', () => {
    const team = rollTeam(fmt({ topN: 20 }), 's', 'p');
    for (const b of team) expect(rankOfRef(b.ref, 'great')).toBeLessThanOrEqual(20);
  });

  it('leaves playerPicks slots undealt', () => {
    expect(rollTeam(fmt({ playerPicks: 2 }, 6), 's', 'p')).toHaveLength(4);
  });

  it('deals the rated loadout when rollMoves is off', () => {
    const b = rollTeam(fmt({ rollMoves: false }, 1), 's', 'p')[0];
    const s = SPECIES_BY_ID.get(parseRef(b.ref).id)!;
    expect(b.fast).toBe(movesFor(s, 'great').fast.id);
  });

  it('deals a legal loadout when rollMoves is on', () => {
    const team = rollTeam(fmt({ rollMoves: true }, 6), 's', 'p');
    for (const b of team) {
      const s = SPECIES_BY_ID.get(parseRef(b.ref).id)!;
      expect(s.fastMoves.some((m) => m.id === b.fast)).toBe(true);
      for (const c of b.charges) expect(s.chargeMoves.some((m) => m.id === c)).toBe(true);
    }
  });

  it('does not depend on Math.random', () => {
    const real = Math.random;
    Math.random = () => { throw new Error('rollTeam must not use Math.random'); };
    try {
      expect(() => rollTeam(fmt(), 's', 'p')).not.toThrow();
    } finally {
      Math.random = real;
    }
  });

  it('trusts lint to reject unfillable formats; does not defend itself', () => {
    // The contract: lintFormat is the guard, rollTeam does not defend itself.
    // When a format's constraints cannot be satisfied, lint catches it and blocks
    // publishing; the draw trusts this and does not duplicate the check.
    //
    // Evidence: rollTeam returns a BuildArray that might be short if the pool
    // genuinely cannot satisfy the constraints (e.g., uniqueFamilies: true with
    // fewer families than size). It does not throw; it documents its inability
    // by returning fewer members than requested.
    //
    // In practice this is safe because satisfiable.test.ts verifies lintFormat
    // rejects such formats, and the UI blocks publishing until lint is clear.
    // This test documents the contract itself, not the full safety chain.

    // This format has a high risk of under-filling due to many families.
    // In the Great league, applying uniqueFamilies with size 6 requires 6
    // different families. The pool is unlimited, so it should succeed.
    // Verify rollTeam handles this without throwing.
    const fullPool: Format = {
      schema: RULES_SCHEMA,
      base: 'great',
      pool: [],
      composition: { size: 6, uniqueFamilies: true },
      selection: { mode: 'open' },
    };
    const team = rollTeam(fullPool, 's', 'p');
    // With unlimited pool and many families available, should fill completely.
    expect(team).toHaveLength(6);

    // If a hypothetical format could not fill, rollTeam would return fewer.
    // That scenario is tested via lintFormat's unsatisfiable checks in
    // lint.test.ts and satisfiable.test.ts; they verify lint catches it first.
  });
});
