import { describe, it, expect } from 'vitest';
import {
  backdatedAt, battlesByDay, daySize, onAccount, battlesToday, byFormat, eloSeries, fromLocalDay, lastElo, localDay, nextTier, recap, seasonTotals, summaryOf,
  tallyOf, tierOf, todaysSets, type GblBattle, type GblSet,
} from '../gbl';

let n = 0;
const battle = (result: GblBattle['result'], opponents: string[], playedAt = new Date().toISOString()): GblBattle =>
  ({ id: `b${n++}`, idx: 1, result, opponents, opponentMoves: opponents.map(() => ({ fast: null, charges: [] })), note: null, playedAt });
const set = (o: Partial<GblSet> & { battles: GblBattle[] }): GblSet =>
  ({ id: `s${n++}`, accountId: null, season: 28, format: 'great', team: [], eloStart: null, eloEnd: null, startedAt: new Date().toISOString(), ...o });

describe('tiers', () => {
  it('puts each band edge in the tier it opens', () => {
    expect([1999, 2000, 2499, 2500, 2749, 2750, 2999, 3000].map((e) => tierOf(e).id))
      .toEqual(['rank', 'ace', 'ace', 'veteran', 'veteran', 'expert', 'expert', 'legend']);
  });
  it('measures the way to the next tier, and has none past Legend', () => {
    expect(nextTier(2612)).toMatchObject({ tier: { id: 'expert' }, gap: 138 });
    expect(nextTier(2612)!.progress).toBeCloseTo(112 / 250);
    expect(nextTier(3100)).toBeNull();
  });
});

describe('a season worked out', () => {
  const s1 = set({ eloStart: 2500, eloEnd: 2540, battles: [battle('win', ['azumarill']), battle('win', ['medicham']), battle('loss', ['azumarill'])] });
  const s2 = set({ eloStart: null, eloEnd: null, battles: [battle('tie', ['azumarill']), battle(null, [])] });
  const s3 = set({ format: 'ultra', eloStart: 2540, eloEnd: 2520, battles: [battle('loss', ['azumarill', 'registeel'])] });
  const all = [s1, s2, s3];

  it('tallies results, counting a battle with no result as played', () => {
    expect(tallyOf(s2.battles)).toEqual({ wins: 0, losses: 0, ties: 1, battles: 2 });
    expect(seasonTotals(all.map(summaryOf))).toEqual({ wins: 2, losses: 2, ties: 1, battles: 6, sets: 3 });
  });

  it('charts only sets with an Elo written down, each against its own start', () => {
    expect(eloSeries(all.map(summaryOf)).map((p) => [p.elo, p.delta])).toEqual([[2540, 40], [2520, -20]]);
  });

  it('starts a new set from the last Elo written down, skipping sets without one', () => {
    expect(lastElo([s1, s2])).toBe(2540);
    expect(lastElo([s2])).toBeNull();
  });

  it('recaps the session: best set, most faced, and what the losses were to', () => {
    const r = recap(all);
    expect(r.bestSet).toMatchObject({ index: 0, tally: { wins: 2, losses: 1 } });
    expect(r.mostFaced).toEqual({ ref: 'azumarill', n: 4 });
    expect(r.lostToMost).toEqual({ ref: 'azumarill', n: 2, of: 2 });
    expect([r.eloFrom, r.eloTo]).toEqual([2500, 2520]);
  });

  it('prices Elo per battle per format from sets with both ends', () => {
    const f = byFormat(all.map(summaryOf));
    expect(f.map((x) => [x.format, x.tally.battles, x.eloPerBattle])).toEqual([['great', 5, 40 / 3], ['ultra', 1, -20]]);
  });

  it('counts today against GO\'s daily 25 by the local calendar day', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const old = set({ startedAt: yesterday, battles: [battle('win', [], yesterday), battle('win', [], yesterday)] });
    expect(battlesToday([old, s1])).toBe(3);
    expect(todaysSets([old, s1])).toEqual([s1]);
  });
});

describe('a day\'s size', () => {
  it('is the size picked, raised to the smallest of 25/50/100 that holds what was logged', () => {
    expect([daySize(0), daySize(25), daySize(26), daySize(36, 25), daySize(10, 100), daySize(69, 50), daySize(120)]).toEqual([25, 25, 50, 50, 100, 100, 100]);
  });
});

describe('the backlog', () => {
  it('round-trips a local calendar day', () => {
    const d = new Date(2026, 9, 3, 22, 30);
    expect(localDay(d)).toBe('2026-10-03');
    expect(fromLocalDay('2026-10-03').getDate()).toBe(3);
  });

  it('counts battles per local day', () => {
    const a = new Date(2026, 9, 3, 10).toISOString(), b = new Date(2026, 9, 4, 10).toISOString();
    expect([...battlesByDay([set({ battles: [battle('win', [], a), battle('loss', [], a), battle('win', [], b)] })])])
      .toEqual([['2026-10-03', 2], ['2026-10-04', 1]]);
  });

  it('stamps a backlogged battle after the day\'s last one, from the morning, and never past midnight', () => {
    const day = new Date(2026, 9, 3);
    expect(new Date(backdatedAt([], day)).getHours()).toBe(9);
    const at = new Date(2026, 9, 3, 14, 0).toISOString();
    expect(Date.parse(backdatedAt([set({ battles: [battle('win', [], at)] })], day)) - Date.parse(at)).toBe(3 * 60_000);
    const late = new Date(2026, 9, 3, 23, 58).toISOString();
    const stamped = new Date(backdatedAt([set({ battles: [battle('win', [], late)] })], day));
    expect([stamped.getDate(), stamped.getHours(), stamped.getMinutes()]).toEqual([3, 23, 59]);
  });
});

describe('accounts', () => {
  it('keeps each account\'s sets apart, null being the main account', () => {
    const main = set({ battles: [] }), alt = set({ accountId: 'a1', battles: [] });
    expect(onAccount([main, alt], null)).toEqual([main]);
    expect(onAccount([main, alt], 'a1')).toEqual([alt]);
  });
});
