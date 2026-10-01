import { describe, it, expect } from 'vitest';
import { summarise, wilson, byDay, monthGrid, toCsvRows, type RecordRow } from '../records';

const row = (o: Partial<RecordRow> = {}): RecordRow => ({
  matchId: 'm', playedAt: '2026-09-10T12:00:00Z', league: 'great', source: 'queue', ranked: true,
  opponentId: 'o1', opponentName: 'Ash', myRounds: 2, oppRounds: 1, won: true, myTeam: [], oppTeam: [], ...o,
});

describe('records', () => {
  it('summarises wins, unique opponents and rounds', () => {
    const s = summarise([row(), row({ opponentId: 'o2' }), row({ won: false, myRounds: 0, oppRounds: 2 })]);
    expect(s).toEqual({ games: 3, wins: 2, winRate: 2 / 3, uniqueOpponents: 2, roundsWon: 4, roundsLost: 4 });
    expect(summarise([]).winRate).toBeNull();
  });

  it('keeps 3-from-4 from reading as a 75% trait', () => {
    const [lo, hi] = wilson(3, 4);
    expect(lo).toBeCloseTo(0.3, 1);
    expect(hi).toBeCloseTo(0.954, 2);
    const [l2, h2] = wilson(75, 100);
    expect(h2 - l2).toBeLessThan(hi - lo);
  });

  it('puts an 11pm Pacific match on the Pacific day, not the UTC one', () => {
    const r = row({ playedAt: '2026-09-11T06:30:00Z' }); // 23:30 on the 10th in Los Angeles
    expect([...byDay([r], 'America/Los_Angeles').keys()]).toEqual(['2026-09-10']);
    expect([...byDay([r], 'UTC').keys()]).toEqual(['2026-09-11']);
  });

  it('tallies wins and losses per day', () => {
    const d = byDay([row(), row({ won: false }), row({ playedAt: '2026-09-11T12:00:00Z' })], 'UTC');
    expect(d.get('2026-09-10')).toEqual({ wins: 1, losses: 1 });
    expect(d.get('2026-09-11')).toEqual({ wins: 1, losses: 0 });
  });

  it('lays a month out Sunday-first with padding', () => {
    const g = monthGrid(2026, 9); // 1 Sep 2026 is a Tuesday
    expect(g[0].slice(0, 3)).toEqual([null, null, '2026-09-01']);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });

  it('builds CSV rows with the local date', () => {
    const [c] = toCsvRows([row({ playedAt: '2026-09-11T06:30:00Z', won: false })], 'America/Los_Angeles');
    expect(c).toMatchObject({ date: '2026-09-10', result: 'loss', opponent: 'Ash', ranked: 'yes' });
  });
});
