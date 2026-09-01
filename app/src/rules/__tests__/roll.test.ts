import { describe, it, expect } from 'vitest';
import { rollTeam } from '../roll';
import { lintFormat } from '../lint';
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

  it('fills to the full composition size from a tight but legal topN', () => {
    // Measured: in Great, topN: 12 leaves 11 drawable refs spanning 8 distinct
    // species (a species contributes at most a normal + Shadow ref). That is
    // comfortably more than the 6 uniqueSpecies needs, and held across 500
    // seeds in measurement — this is the tight-but-fillable case, distinct
    // from the starved case below where the pool cannot reach size at all.
    const team = rollTeam(fmt({ topN: 12 }), 's', 'p');
    expect(team).toHaveLength(6);
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
    //
    // Construction: denying the negation of a single evolution family
    // ('!+politoed') is last-match-wins against the whole base pool, so only
    // that family's refs survive. Measured against the current Great data:
    // 6 refs survive (poliwhirl, poliwhirl_shadow, poliwrath, poliwrath_shadow,
    // politoed, politoed_shadow), spanning exactly 1 distinct family. With
    // uniqueFamilies: true and size: 6, at most one of those six refs can ever
    // be picked — the pool cannot reach 6 no matter how it's shuffled.
    //
    // A species contributes at most two refs (normal + Shadow), so
    // uniqueSpecies alone could never starve a size-6 team this way;
    // uniqueFamilies is the only real starvation vector, because one
    // evolution line can collapse many refs into a single legal pick.
    const starved: Format = {
      schema: RULES_SCHEMA,
      base: 'great',
      pool: [{ effect: 'deny', select: '!+politoed' }],
      composition: { size: 6, uniqueFamilies: true },
      selection: { mode: 'open' },
    };

    // Half 1: lint is the guard. It must flag this format as unsatisfiable
    // before it can ever reach a draw.
    const diagnostics = lintFormat(starved);
    expect(diagnostics).toContainEqual({ level: 'error', kind: 'unsatisfiable' });

    // Half 2: the draw does not defend itself. Given the same format anyway,
    // rollTeam does not throw and does not pad the team — it silently returns
    // fewer than the requested size, exactly as documented.
    const team = rollTeam(starved, 'some-seed', 'some-player');
    expect(team.length).toBeLessThan(6);
  });
});
