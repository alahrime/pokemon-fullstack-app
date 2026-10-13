import { describe, it, expect } from 'vitest';
import { SHIELDS, altRowFor, alternativesFor, duel, threatScore, toneOf, topThreats } from '../matchupMatrix';
import { monFor } from '../teambuild';
import { handOffTeam, takeHandedOffTeam } from '../teamHandoff';

const TEAM = ['azumarill', 'registeel', 'altaria'];

describe('matchup matrix', () => {
  it('bands a rating by its distance from a draw', () => {
    expect(['rout', 'lose', 'close', 'win', 'crush']).toEqual([100, 400, 500, 650, 900].map(toneOf));
    expect(toneOf(450)).toBe('close');
    expect(toneOf(551)).toBe('win');
    expect(toneOf(751)).toBe('crush');
  });

  it('fights a duel at 0, 1 and 2 shields, each rated 0-1000', () => {
    const r = duel(monFor('azumarill', 'great'), monFor('registeel', 'great'));
    expect(SHIELDS).toEqual([0, 1, 2]);
    expect(r).toHaveLength(3);
    for (const x of r) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1000); }
  });

  it('a mirror match is a draw at every shield count', () => {
    const m = monFor('azumarill', 'great');
    expect(duel(m, m)).toEqual([500, 500, 500]);
  });

  it('lists the twenty opponents that press the roster hardest, most first, never a member or its relatives', () => {
    const t = topThreats(TEAM, 'great');
    expect(t).toHaveLength(20);
    expect(t.map((r) => r.pressure)).toEqual([...t.map((r) => r.pressure)].sort((a, b) => b - a));
    for (const r of t) {
      expect(TEAM).not.toContain(r.ref);
      expect(r.cells).toHaveLength(TEAM.length);
      for (const c of r.cells) expect(c).toHaveLength(3);
      expect(r.beats.every((m) => TEAM.includes(m))).toBe(true);
    }
    expect(threatScore(t)).toBeGreaterThan(0);
  });

  it('has nothing to say about an empty roster', () => {
    expect(topThreats([], 'great')).toEqual([]);
    expect(alternativesFor([], [], 'great')).toEqual([]);
  });

  it('ranks alternatives by how they hold the threats, excluding the roster', () => {
    const threats = topThreats(TEAM, 'great');
    const alts = alternativesFor(TEAM, threats, 'great');
    expect(alts).toHaveLength(20);
    expect(alts.map((a) => a.score)).toEqual([...alts.map((a) => a.score)].sort((a, b) => b - a));
    for (const a of alts) {
      expect(TEAM).not.toContain(a.ref);
      expect(a.cells).toHaveLength(threats.length);
      expect(a.answered).toBeLessThanOrEqual(threats.length);
    }
    // Any ref can be compared, and gets the same treatment as a candidate.
    expect(altRowFor(alts[0].ref, threats, 'great')).toEqual(alts[0]);
  });

  it('is deterministic', () => {
    expect(topThreats(TEAM, 'great').map((r) => r.ref)).toEqual(topThreats(TEAM, 'great').map((r) => r.ref));
  });
});

describe('team handoff', () => {
  it('is read once, and only by a builder of the same size', () => {
    handOffTeam(['a', 'b', 'c'], 3);
    expect(takeHandedOffTeam(6)).toBeNull();
    expect(takeHandedOffTeam(3)).toEqual(['a', 'b', 'c']);
    expect(takeHandedOffTeam(3)).toBeNull();
  });
});
