import { describe, it, expect } from 'vitest';
import {
  BASE_ROSTER, OPPONENTS, ROSTER, SPECIES, SPECIES_BY_ID, UNSIMULATED_IDS,
  conflictsOnTeam, displayName, isSimulated, makeRef, movesFor, opponentCandidatesFor,
  parseRef, pickableFor, speciesOf, teamIsLegal,
} from '../data';

describe('refs', () => {
  it('round-trips a plain species', () => {
    expect(parseRef('azumarill')).toEqual({ id: 'azumarill', shadow: false });
    expect(makeRef('azumarill', false)).toBe('azumarill');
  });
  it('round-trips a shadow', () => {
    expect(parseRef('azumarill_shadow')).toEqual({ id: 'azumarill', shadow: true });
    expect(makeRef('azumarill', true)).toBe('azumarill_shadow');
  });
  it('does not mistake a form suffix for a shadow', () => {
    expect(parseRef('ninetales_alolan').shadow).toBe(false);
    expect(parseRef('ninetales_alolan_shadow')).toEqual({ id: 'ninetales_alolan', shadow: true });
  });
  it('names a shadow distinctly', () => {
    expect(displayName('azumarill_shadow')).toContain('Shadow');
    expect(displayName('azumarill')).not.toContain('Shadow');
  });
  it('resolves a species from either form of ref', () => {
    expect(speciesOf('azumarill')?.id).toBe('azumarill');
    expect(speciesOf('azumarill_shadow')?.id).toBe('azumarill');
    expect(speciesOf('not_a_species')).toBeUndefined();
  });
});

describe('roster', () => {
  it('is populated and internally consistent', () => {
    expect(SPECIES.length).toBeGreaterThan(1000);
    expect(SPECIES_BY_ID.size).toBe(SPECIES.length);
  });
  it('ROSTER includes shadows and BASE_ROSTER does not', () => {
    expect(ROSTER.length).toBeGreaterThan(BASE_ROSTER.length);
    expect(BASE_ROSTER.every((r) => !r.shadow)).toBe(true);
  });
  it('excludes every unsimulated species from every picker', () => {
    const rosterIds = new Set(ROSTER.map((r) => r.ref));
    for (const id of UNSIMULATED_IDS) {
      expect(isSimulated(id)).toBe(false);
      expect(rosterIds.has(id)).toBe(false);
      expect(opponentCandidatesFor('great')).not.toContain(id);
    }
  });
  it('gives every league a substantial opponent list', () => {
    for (const lg of ['great','ultra','master'] as const) {
      expect(OPPONENTS[lg].length).toBeGreaterThan(0);
      expect(pickableFor(lg).length).toBeGreaterThan(100);
    }
  });
});

describe('movesFor', () => {
  it('returns a fast move and at least one charge', () => {
    const m = movesFor(SPECIES_BY_ID.get('azumarill')!, 'great');
    expect(m.fast).toBeTruthy();
    expect(m.charges.length).toBeGreaterThan(0);
  });
  it('never exceeds two charged moves', () => {
    for (const sp of SPECIES.slice(0, 120)) {
      expect(movesFor(sp, 'great').charges.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('team legality', () => {
  it('blocks a species against itself', () => expect(conflictsOnTeam('azumarill','azumarill')).toBe(true));
  it('blocks regional forms sharing a dex', () => {
    expect(conflictsOnTeam('ninetales','ninetales_alolan')).toBe(true);
    expect(conflictsOnTeam('stunfisk','stunfisk_galarian')).toBe(true);
  });
  it('blocks a Pokemon and its own shadow', () => {
    expect(conflictsOnTeam('registeel','registeel_shadow')).toBe(true);
  });
  it('allows genuinely different species', () => {
    expect(conflictsOnTeam('azumarill','registeel')).toBe(false);
  });
  it('teamIsLegal applies the rule pairwise across the whole team', () => {
    expect(teamIsLegal(['azumarill','registeel','medicham'])).toBe(true);
    expect(teamIsLegal(['azumarill','registeel','registeel_shadow'])).toBe(false);
    expect(teamIsLegal([])).toBe(true);
  });
});
