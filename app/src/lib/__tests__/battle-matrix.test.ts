import { describe, it, expect } from 'vitest';
import {
  META_SIZE, atRankOne, averageOf, cell, chargesFor, diffsOf, isUsable, matrix, moveAbbr, movesetAbbr, newKey,
  quickFillRefs, quickFills, ratedEntry, recordOf, resolve, resultOf, toneOf, valueOf, type MatrixCell,
} from '../battleMatrix';
import { battle, bestSpreadFor, dmg, getEntry } from '../engine';
import { rating } from '../scenarios';
import { cupLegal } from '../presetFormats';

const L = 'great' as const;
const cram = (a: number, d: number, s: number) => resolve({ ...ratedEntry('cramorant', L), iv: { a, d, s } }, L);

/** A cell with only the fields a test cares about. */
const fake = (o: Partial<MatrixCell>): MatrixCell => ({
  rating: 500, outcome: 'tie', dealt: [3, 50, null], taken: [3, 40, 60], cmp: 'tie', atkDiff: 0, ...o,
});

describe('a matrix cell', () => {
  it('is the engine\'s battle and PvPoke\'s rating, from the row\'s side, at each side\'s shields', () => {
    const a = cram(8, 9, 6);
    const b = resolve(ratedEntry('azumarill', L), L);
    for (const [sa, sb] of [[0, 0], [1, 2], [2, 1]]) {
      const c = cell(a, b, sa, sb);
      const r = battle(a.mon, b.mon, sa, sb, 0, 0, false);
      const tie = r.hpA <= 0 && r.hpB <= 0;
      expect(c.outcome).toBe(tie ? 'tie' : r.win ? 'win' : 'loss');
      expect(c.rating).toBe(tie ? 500 : rating(r, sa, sb));
    }
  });

  it('carries the damage each move deals both ways', () => {
    const a = cram(8, 9, 6);
    const b = resolve(ratedEntry('azumarill', L), L);
    const c = cell(a, b, 1, 1);
    expect(c.dealt[0]).toBe(dmg(a.mon.atk, b.mon.def, a.fast, b.types));
    expect(c.dealt[1]).toBe(dmg(a.mon.atk, b.mon.def, a.charges[0], b.types));
    expect(c.taken[0]).toBe(dmg(b.mon.atk, a.mon.def, b.fast, a.types));
  });

  it('has no charged-move damage for a slot the Pokémon does not fill', () => {
    const one = resolve({ ...ratedEntry('cramorant', L), chargeIds: ['FLY'] }, L);
    expect(one.charges.map((c) => c.id)).toEqual(['FLY']);
    expect(cell(one, cram(1, 1, 1), 0, 0).dealt[2]).toBeNull();
  });

  it('calls CMP on the Attack stat, and a mirror at one roll a CMP tie', () => {
    const lo = cram(0, 15, 15);
    const hi = cram(15, 0, 0);
    expect(cell(hi, lo, 1, 1).cmp).toBe(hi.mon.cmpAtk > lo.mon.cmpAtk ? 'win' : 'loss');
    const same = cell(lo, lo, 1, 1);
    expect(same.cmp).toBe('tie');
    expect(same.atkDiff).toBe(0);
  });

  it('is every row against every column', () => {
    const rows = [cram(8, 9, 6), cram(1, 2, 13)];
    const cols = ['azumarill', 'medicham', 'registeel'].map((r) => resolve(ratedEntry(r, L), L));
    const m = matrix(rows, cols, 1, 1);
    expect(m.length).toBe(2);
    expect(m.every((r) => r.length === 3)).toBe(true);
    expect(m[1][2]).toEqual(cell(rows[1], cols[2], 1, 1));
  });
});

describe('views', () => {
  const c = fake({ rating: 640, outcome: 'win', cmp: 'loss', atkDiff: -1.5 });
  it('reads each view off the one cell', () => {
    expect(valueOf(c, 'rating', 'fast')).toBe(640);
    expect(valueOf(c, 'break', 'charge1')).toBe(50);
    expect(valueOf(c, 'break', 'charge2')).toBeNull();
    expect(valueOf(c, 'bulk', 'charge2')).toBe(60);
    expect(valueOf(c, 'attack', 'fast')).toBe(-1.5);
  });
  it('colours by the battle in every view, and counts CMP on the CMP view', () => {
    expect(toneOf(c)).toBe('win');
    expect(resultOf(c, 'break')).toBe('win');
    expect(resultOf(c, 'attack')).toBe('loss');
    expect(recordOf([c, c], 'attack')).toEqual({ win: 0, loss: 2, tie: 0 });
    expect(recordOf([c, c], 'rating')).toEqual({ win: 2, loss: 0, tie: 0 });
  });
  it('counts records and averages, skipping missing moves', () => {
    const cells = [fake({ outcome: 'win' }), fake({ outcome: 'loss' }), fake({ outcome: 'win', dealt: [5, null, null] })];
    expect(recordOf(cells, 'rating')).toEqual({ win: 2, loss: 1, tie: 0 });
    expect(averageOf(cells, 'break', 'fast')).toBeCloseTo(11 / 3);
    expect(averageOf(cells, 'break', 'charge1')).toBe(50);
    expect(averageOf([], 'rating', 'fast')).toBeNull();
  });
});

describe('differences against the baseline', () => {
  it('names where an outcome moved and where it landed, four ways', () => {
    const base = [fake({ outcome: 'loss' }), fake({ outcome: 'loss' }), fake({ outcome: 'win' }), fake({ outcome: 'win' }), fake({ outcome: 'tie' })];
    const row = [fake({ outcome: 'win' }), fake({ outcome: 'tie' }), fake({ outcome: 'tie' }), fake({ outcome: 'loss' }), fake({ outcome: 'tie' })];
    expect(diffsOf(base, row, 'rating', 'fast')).toEqual([
      { col: 0, kind: 'gain-win' }, { col: 1, kind: 'gain-tie' }, { col: 2, kind: 'drop-tie' }, { col: 3, kind: 'drop-loss' },
    ]);
  });
  it('reads Attack as CMP outcomes', () => {
    expect(diffsOf([fake({ cmp: 'tie' })], [fake({ cmp: 'win' })], 'attack', 'fast')).toEqual([{ col: 0, kind: 'gain-win' }]);
  });
  it('gains a breakpoint on more damage dealt and a bulkpoint on less taken', () => {
    const base = [fake({ dealt: [3, 50, null], taken: [4, 40, 60] })];
    expect(diffsOf(base, [fake({ dealt: [4, 50, null] })], 'break', 'fast')).toEqual([{ col: 0, kind: 'gain', delta: 1 }]);
    expect(diffsOf(base, [fake({ dealt: [3, 49, null] })], 'break', 'charge1')).toEqual([{ col: 0, kind: 'drop', delta: -1 }]);
    expect(diffsOf(base, [fake({ taken: [3, 40, 60] })], 'bulk', 'fast')).toEqual([{ col: 0, kind: 'gain', delta: -1 }]);
    expect(diffsOf(base, [fake({ taken: [5, 40, 60] })], 'bulk', 'fast')).toEqual([{ col: 0, kind: 'drop', delta: 1 }]);
    expect(diffsOf(base, [fake({ dealt: [3, 50, 70] })], 'break', 'charge2')).toEqual([]);
  });
  it('finds the 1-shield matchups two real Cramorant rolls disagree on', () => {
    const rows = [cram(8, 9, 6), cram(1, 2, 13)];
    const cols = quickFillRefs(`meta:${L}`, L).map((r) => resolve(ratedEntry(r, L), L));
    const m = matrix(rows, cols, 1, 1);
    const d = diffsOf(m[0], m[1], 'rating', 'fast');
    for (const x of d) expect(m[0][x.col].outcome).not.toBe(m[1][x.col].outcome);
    expect(diffsOf(m[0], m[0], 'rating', 'fast')).toEqual([]);
  });
});

describe('quick fill', () => {
  it('offers the league\'s meta and only the cups played under its cap', () => {
    expect(quickFills(L)[0]).toMatchObject({ key: 'meta:great', label: 'Great League meta', note: expect.stringMatching(/Top 40/) });
    for (const f of quickFills(L)) expect(f.swatch.length).toBeGreaterThan(0);
    expect(quickFills(L).some((f) => f.key === 'cup:fantasy')).toBe(true);
    expect(quickFills('ultra').some((f) => f.key === 'cup:fantasy')).toBe(false);
  });
  it('takes the top of the league, and of a cup only what the cup allows', () => {
    const meta = quickFillRefs('meta:great', L);
    expect(meta.length).toBe(META_SIZE);
    expect(new Set(meta).size).toBe(meta.length);
    const legal = cupLegal('fantasy')!;
    const retro = quickFillRefs('cup:fantasy', L);
    expect(retro.length).toBeGreaterThan(0);
    expect(retro.every((r) => legal.has(r))).toBe(true);
    expect(quickFillRefs('cup:nope', L)).toEqual([]);
  });
});

describe('entries', () => {
  it('open on the rated moves, and rank 1 is the league\'s rank-1 roll', () => {
    const e = ratedEntry('cramorant', L);
    expect(e.chargeIds).toEqual([]);
    expect(chargesFor(e, L).length).toBeGreaterThan(0);
    const r1 = atRankOne(e, L);
    const best = bestSpreadFor('cramorant', L);
    expect(r1.iv).toEqual({ a: best.a, d: best.d, s: best.s });
    expect(getEntry('cramorant', r1.iv, L).entry.rank).toBe(1);
    expect(r1.key).toBe(e.key);
  });
  it('keys are unique', () => {
    expect(new Set(Array.from({ length: 50 }, newKey)).size).toBe(50);
  });
  it('keeps only stored entries the engine can still field', () => {
    const ok = ratedEntry('cramorant', L);
    expect(isUsable(ok)).toBe(true);
    expect(isUsable({ ...ok, ref: 'not_a_pokemon' })).toBe(false);
    expect(isUsable({ ...ok, iv: { a: 16, d: 0, s: 0 } })).toBe(false);
    expect(isUsable({ ...ok, chargeIds: [3] })).toBe(false);
    expect(isUsable(null)).toBe(false);
  });
});

describe('labels', () => {
  it('abbreviates moves the way a matrix column is headed', () => {
    expect(moveAbbr('Drill Run')).toBe('DR');
    expect(moveAbbr('Surf')).toBe('Sr');
    expect(moveAbbr('Weather Ball (Fire)')).toBe('WB');
    expect(moveAbbr('Power-Up Punch')).toBe('PUP');
    expect(movesetAbbr(cram(1, 1, 1))).toMatch(/^\w+\+\w+(\/\w+)?$/);
  });
});
