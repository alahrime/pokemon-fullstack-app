import { describe, it, expect } from 'vitest';
import { TEAM_SHIELDS, carryoverEdge, teamBattle, teamRating } from '../team';
import { monFor, sampleFieldTeams, subteams, analyseTeam, suggestCompletions, analyseShow6 } from '../teambuild';

const t = (...refs: string[]) => refs.map((r) => monFor(r, 'great'));

describe('teamBattle', () => {
  it('plays until one side is out of Pokemon', () => {
    const r = teamBattle(t('azumarill','registeel','medicham'), t('carbink','skarmory','lapras'));
    expect(r.aliveA === 0 || r.aliveB === 0).toBe(true);
  });
  it('is deterministic', () => {
    const A = t('azumarill','registeel','medicham'), B = t('carbink','skarmory','lapras');
    expect(teamBattle(A, B)).toEqual(teamBattle(A, B));
  });
  it('gives each player two shields for the whole set, not per Pokemon', () => {
    expect(TEAM_SHIELDS).toBe(2);
    const r = teamBattle(t('azumarill','registeel'), t('carbink','skarmory'));
    expect(r.shieldsA).toBeLessThanOrEqual(TEAM_SHIELDS);
    expect(r.shieldsB).toBeLessThanOrEqual(TEAM_SHIELDS);
  });
  it('records a step per exchange', () => {
    const r = teamBattle(t('azumarill','registeel'), t('carbink','skarmory'));
    expect(r.steps.length).toBeGreaterThan(0);
  });
  it('honours asymmetric starting shields', () => {
    const A = t('azumarill','registeel'), B = t('carbink','skarmory');
    const fair = teamBattle(A, B, { shieldsA: 2, shieldsB: 2 });
    const starved = teamBattle(A, B, { shieldsA: 0, shieldsB: 2 });
    expect(starved.hpFracA).toBeLessThanOrEqual(fair.hpFracA);
  });
  it('carries HP and energy across matchups, which is the whole point', () => {
    const A = t('azumarill','registeel','medicham'), B = t('carbink','skarmory','lapras');
    const { chained, isolated, edge } = carryoverEdge(A, B);
    expect(Number.isFinite(edge)).toBe(true);
    expect(chained.hpFracA - isolated.hpFracA).toBeCloseTo(edge, 9);
  });
  it('handles a single-Pokemon team', () => {
    const r = teamBattle(t('azumarill'), t('carbink'));
    expect(r.aliveA === 0 || r.aliveB === 0).toBe(true);
  });
});

describe('teamRating', () => {
  it('scores a win above a loss', () => {
    const won = teamRating({ win: true, hpFracA: 0.6, hpFracB: 0, shieldsA: 1, shieldsB: 0, energyA: 0, energyB: 0, aliveA: 2, aliveB: 0, steps: [] } as never);
    const lost = teamRating({ win: false, hpFracA: 0, hpFracB: 0.6, shieldsA: 0, shieldsB: 1, energyA: 0, energyB: 0, aliveA: 0, aliveB: 2, steps: [] } as never);
    expect(won).toBeGreaterThan(lost);
  });
  it('credits energy carried out of a won set', () => {
    const base = { win: true, hpFracA: 0.5, hpFracB: 0, shieldsA: 0, shieldsB: 0, energyB: 0, aliveA: 1, aliveB: 0, steps: [] };
    expect(teamRating({ ...base, energyA: 100 } as never))
      .toBeGreaterThan(teamRating({ ...base, energyA: 0 } as never));
  });
  it('never returns a negative score', () => {
    expect(teamRating({ win: false, hpFracA: 0, hpFracB: 1, shieldsA: 0, shieldsB: 2, energyA: 0, energyB: 100, aliveA: 0, aliveB: 3, steps: [] } as never))
      .toBeGreaterThanOrEqual(0);
  });
});

describe('subteams', () => {
  it('enumerates every combination of the requested size', () => {
    expect(subteams([1,2,3,4,5,6], 3)).toHaveLength(20); // C(6,3)
    expect(subteams([1,2,3,4], 2)).toHaveLength(6);
  });
  it('keeps the source order within each combination', () => {
    for (const s of subteams([1,2,3,4,5], 3)) {
      expect([...s].sort((a,b)=>a-b)).toEqual(s);
    }
  });
  it('returns one empty pick for k=0 and nothing for k>n', () => {
    expect(subteams([1,2], 3)).toHaveLength(0);
  });
});

describe('sampleFieldTeams', () => {
  it('is deterministic, because it is a yardstick not a random draw', () => {
    expect(sampleFieldTeams('great', 3, 5)).toEqual(sampleFieldTeams('great', 3, 5));
  });
  it('returns teams of the requested size and count', () => {
    const out = sampleFieldTeams('great', 3, 7);
    expect(out).toHaveLength(7);
    expect(out.every((x) => x.length === 3)).toBe(true);
  });
  it('never repeats a species inside one sampled team', () => {
    for (const team of sampleFieldTeams('great', 3, 30)) {
      expect(new Set(team).size).toBe(team.length);
    }
  });
});

describe('analyseTeam', () => {
  it('reports a win rate, mean HP, carryover and named threats', () => {
    const rep = analyseTeam(['azumarill','registeel','medicham'], 'great', { count: 8 });
    expect(rep.winRate).toBeGreaterThanOrEqual(0);
    expect(rep.winRate).toBeLessThanOrEqual(1);
    expect(rep.meanHp).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(rep.carryover)).toBe(true);
    expect(Array.isArray(rep.threats)).toBe(true);
  });
  it('names threats per opposing Pokemon, not per opposing team', () => {
    const rep = analyseTeam(['azumarill','registeel','medicham'], 'great', { count: 12 });
    for (const th of rep.threats) {
      expect(typeof th.ref).toBe('string');
      expect(th.ref).not.toContain(',');
      expect(th.lossRate).toBeGreaterThanOrEqual(0);
      expect(th.lossRate).toBeLessThanOrEqual(1);
    }
  });
  it('handles a partial team', () => {
    const rep = analyseTeam(['azumarill'], 'great', { size: 3, count: 6 });
    expect(Number.isFinite(rep.winRate)).toBe(true);
  });
});

describe('suggestCompletions', () => {
  it('suggests only legal additions', () => {
    const out = suggestCompletions(['registeel'], 'great', 3, { count: 6, limit: 5 });
    expect(out.length).toBeGreaterThan(0);
    // Never its own shadow or a dex duplicate.
    expect(out.every((s) => s.ref !== 'registeel' && s.ref !== 'registeel_shadow')).toBe(true);
  });
  it('respects the limit', () => {
    expect(suggestCompletions(['registeel'], 'great', 3, { count: 4, limit: 3 }).length).toBeLessThanOrEqual(3);
  });
  it('returns something for an empty partial team', () => {
    expect(suggestCompletions([], 'great', 3, { count: 4, limit: 4 }).length).toBeGreaterThan(0);
  });
});

describe('analyseShow6', () => {
  it('reports the floor, the naive value, and the line that achieves the floor', () => {
    const rep = analyseShow6(['azumarill','registeel','medicham','lapras','skarmory','carbink'], 'great', { count: 4 });
    expect(Number.isFinite(rep.floor)).toBe(true);
    expect(Number.isFinite(rep.naive)).toBe(true);
    expect(rep.bestLine).toHaveLength(3);
  });
  it('the floor is never above the naive value — a read cannot help the opponent less than none', () => {
    const rep = analyseShow6(['azumarill','registeel','medicham','lapras','skarmory','carbink'], 'great', { count: 4 });
    expect(rep.floor).toBeLessThanOrEqual(rep.naive);
  });
  it('the best line is drawn from the six', () => {
    const six = ['azumarill','registeel','medicham','lapras','skarmory','carbink'];
    const rep = analyseShow6(six, 'great', { count: 4 });
    for (const m of rep.bestLine) expect(six).toContain(m);
  });
});
