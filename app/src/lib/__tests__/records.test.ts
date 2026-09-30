import { describe, it, expect, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { summarise, wilson, byDay, monthGrid, toCsvRows, gritStatus, myGrit, type RecordRow } from '../records';

const row = (o: Partial<RecordRow> = {}): RecordRow => ({
  matchId: 'm', playedAt: '2026-09-10T12:00:00Z', league: 'great', source: 'queue', ranked: true,
  opponentId: 'o1', opponentName: 'Ash', myRounds: 2, oppRounds: 1, won: true, ...o,
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

describe('gritStatus', () => {
  const g = (o = {}) => ({ postLossGames: 20, postLossWins: 12, tournaments: 3, gate: 10, ...o });
  it('shows a rate and interval once there are enough games and events', () => {
    const s = gritStatus(g());
    expect(s.ready && s.rate).toBe(0.6);
    expect(s.ready && s.interval[0] < 0.6 && s.interval[1] > 0.6).toBe(true);
  });
  it('holds back below the gate, or with a single tournament, and says how far off', () => {
    expect(gritStatus(g({ postLossGames: 9 }))).toEqual({ ready: false, note: 'Not enough tournament play yet (9 of 10 games, 3 of 2 tournaments)' });
    expect(gritStatus(g({ tournaments: 1 })).ready).toBe(false);
    expect(gritStatus(g({ gate: 21 })).ready).toBe(false);
  });
});

describe('myGrit', () => {
  it('maps the row, and throws on an error', async () => {
    rpc.mockResolvedValueOnce({ data: [{ post_loss_games: 4, post_loss_wins: 3, tournaments: 2, gate: 10 }], error: null });
    expect(await myGrit()).toEqual({ postLossGames: 4, postLossWins: 3, tournaments: 2, gate: 10 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(myGrit()).rejects.toThrow('boom');
  });
});
