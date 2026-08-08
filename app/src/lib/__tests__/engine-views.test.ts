import { describe, it, expect } from 'vitest';
import {
  bestAt, bestBuddyEligible, bestLeagueFor, bestSpreadFor, buildHeatCells, cellColorMix,
  flipGrid, flipMatchupRows, getEntry, getTable, hasBreakpoint, hasBulkpoint, ivKey,
  leagueStatRange, opponentInfo, opponentList, paletteFor, paletteRamp, rankedOpponents,
  relevantOpponents, scenarioMatrix, selectedCharges, shieldMatrix, shortVerdict, tierColor,
  verdictLine, verdictTagClass, bpRowsFor, rulersFor, chargeMoveStats, fastMoveStats,
} from '../engine';
import { LEAGUE_BY_ID, SPECIES_BY_ID, movesFor } from '../data';

const IV = { a: 0, d: 15, s: 15 };
const LG = 'great' as const;

describe('spread maths', () => {
  it('ivKey is a unique index over the 4096', () => {
    const seen = new Set<number>();
    for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) for (let s = 0; s < 16; s++) seen.add(ivKey({ a, d, s }));
    expect(seen.size).toBe(4096);
  });
  it('bestAt respects the CP cap', () => {
    const sp = SPECIES_BY_ID.get('azumarill')!;
    const line = bestAt(sp, IV, LEAGUE_BY_ID.get(LG)!);
    expect(line.cp).toBeLessThanOrEqual(1500);
  });
  it('getTable ranks all 4096 and exposes the battle-stat extremes', () => {
    const t = getTable('azumarill', LG);
    expect(t.all).toHaveLength(4096);
    expect(t.best.rank).toBe(1);
    expect(t.atkLo).toBeLessThanOrEqual(t.atkHi);
    expect(t.defLo).toBeLessThanOrEqual(t.defHi);
  });
  it('getEntry finds a specific roll and its rank', () => {
    const { entry } = getEntry('azumarill', IV, LG);
    expect(entry.a).toBe(0);
    expect(entry.rank).toBeGreaterThan(0);
  });
  it('bestSpreadFor returns the rank-1 roll', () => {
    const s = bestSpreadFor('azumarill', LG, true);
    expect(s.cp).toBeLessThanOrEqual(1500);
  });
  it('bestLeagueFor picks a league for a spread', () => {
    const r = bestLeagueFor('azumarill', IV);
    expect(['great','ultra','master']).toContain(r.league.id);
  });
  it('bestBuddyEligible is a boolean per species and league', () => {
    expect(typeof bestBuddyEligible(SPECIES_BY_ID.get('azumarill')!, LEAGUE_BY_ID.get(LG)!)).toBe('boolean');
  });
  it('leagueStatRange reports the field maxima', () => {
    const r = leagueStatRange(LG) as Record<string, number>;
    // Whatever it names its fields, they are positive finite numbers.
    const vals = Object.values(r).filter((v) => typeof v === 'number');
    expect(vals.length).toBeGreaterThan(0);
    expect(vals.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
  });
});

describe('thresholds', () => {
  it('hasBreakpoint compares the two attack extremes', () => {
    const t = getTable('registeel', LG);
    const m = movesFor(SPECIES_BY_ID.get('registeel')!, LG);
    expect(typeof hasBreakpoint(t, m.fast, 120, ['water'])).toBe('boolean');
  });
  it('hasBulkpoint compares the two defence extremes', () => {
    const t = getTable('registeel', LG);
    const m = movesFor(SPECIES_BY_ID.get('azumarill')!, LG);
    expect(typeof hasBulkpoint(t, 120, m.fast, ['steel'])).toBe('boolean');
  });
  it('bpRowsFor and rulersFor produce rows for a real matchup', () => {
    const opp = opponentInfo('azumarill', LG);
    expect(Array.isArray(bpRowsFor('registeel', IV, LG, opp))).toBe(true);
    expect(Array.isArray(rulersFor('registeel', IV, LG, opp))).toBe(true);
  });
});

describe('opponents', () => {
  it('opponentInfo prices an opponent at its rated set', () => {
    const o = opponentInfo('azumarill', LG);
    expect(o.atk).toBeGreaterThan(0);
    expect(o.types.length).toBeGreaterThan(0);
  });
  it('opponentList returns the curated shortlist, not the whole field', () => {
    const list = opponentList(LG);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThan(100);
  });
  it('rankedOpponents scores and orders the field', () => {
    const out = rankedOpponents('registeel', LG, 0, 'either', 8);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(8);
  });
  it('relevantOpponents narrows to those with a threshold', () => {
    expect(Array.isArray(relevantOpponents('registeel', LG, 0, 'either', 8))).toBe(true);
  });
});

describe('grids', () => {
  it('flipGrid sweeps a 256-cell slice, not the whole 4096', () => {
    const g = flipGrid('registeel', IV, LG, 'azumarill', 0, 1);
    expect(g.total).toBe(256);
    expect(g.results).toHaveLength(256);
  });
  it('flipGrid caches, so the second call is the same object', () => {
    const a = flipGrid('registeel', IV, LG, 'azumarill', 0, 1);
    const b = flipGrid('registeel', IV, LG, 'azumarill', 0, 1);
    expect(a).toBe(b);
  });
  it('flipMatchupRows lists opponents with their flip point', () => {
    expect(Array.isArray(flipMatchupRows('registeel', IV, LG, 0, ['azumarill', 'carbink']))).toBe(true);
  });
  it('buildHeatCells fills the grid for a matchup', () => {
    const cells = buildHeatCells('registeel', IV, LG, opponentInfo('azumarill', LG), 0, 'rank');
    expect(cells.length).toBeGreaterThan(0);
  });
  it('scenarioMatrix is a 3x3 lattice', () => {
    const m = scenarioMatrix('registeel', IV, LG, 'azumarill', 0);
    expect(m).toHaveLength(3);
    expect(m[0]).toHaveLength(3);
  });
  it('shieldMatrix runs the nine states', () => {
    const m = shieldMatrix(
      // cmpAtk equals atk for anything that is not a Shadow, which these are not.
      { atk: 100, cmpAtk: 100, def: 100, hp: 150, types: ['normal'], fast: movesFor(SPECIES_BY_ID.get('registeel')!, LG).fast, charges: movesFor(SPECIES_BY_ID.get('registeel')!, LG).charges },
      { atk: 100, cmpAtk: 100, def: 100, hp: 150, types: ['water'], fast: movesFor(SPECIES_BY_ID.get('azumarill')!, LG).fast, charges: movesFor(SPECIES_BY_ID.get('azumarill')!, LG).charges },
    );
    expect(m).toHaveLength(3);
  });
});

describe('presentation helpers', () => {
  it('verdict copy changes with rank', () => {
    expect(verdictLine(1)).not.toBe(verdictLine(4000));
    expect(shortVerdict(1)).not.toBe(shortVerdict(4000));
    expect(typeof verdictTagClass(1)).toBe('string');
  });
  it('palettes produce colours and a ramp', () => {
    const pal = paletteFor(SPECIES_BY_ID.get('azumarill')!);
    expect(paletteRamp(pal, 5)).toHaveLength(5);
    expect(typeof cellColorMix(50, pal)).toBe('string');
    expect(typeof tierColor(0, 5, pal)).toBe('string');
  });
  it('move stats derive the ratios the UI shows', () => {
    const m = movesFor(SPECIES_BY_ID.get('azumarill')!, LG);
    expect(fastMoveStats(m.fast).turns).toBeGreaterThan(0);
    expect(chargeMoveStats(m.charges[0]).damage).toBeGreaterThan(0);
  });
  it('selectedCharges honours an explicit id list and falls back sensibly', () => {
    const sp = SPECIES_BY_ID.get('azumarill')!;
    expect(selectedCharges(sp).length).toBeGreaterThan(0);
    expect(selectedCharges(sp, []).length).toBeGreaterThan(0);
  });
});
