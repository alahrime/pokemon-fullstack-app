import { describe, it, expect } from 'vitest';
import { gameFor, type Pairing } from '../tournaments';

const now = new Date('2026-10-01T00:00:00Z');
const p = (o: Partial<Pairing> = {}): Pairing => ({
  id: 'p', round: 1, tableNo: 1, playerA: 'a', playerB: 'b', scoreA: 2, scoreB: 1, state: 'settled',
  reportedBy: null, reportedAt: null, finalAt: null, note: null, ...o,
});

describe('gameFor', () => {
  it('orients a stored score to the player asked about, from either seat', () => {
    expect(gameFor(p(), 'a', now)).toEqual({ opponentId: 'b', myRounds: 2, oppRounds: 1, won: true });
    expect(gameFor(p(), 'b', now)).toEqual({ opponentId: 'a', myRounds: 1, oppRounds: 2, won: false });
  });
  it('is nothing for a bye, an uncounted game, or a player who is not in it', () => {
    expect(gameFor(p({ playerB: null }), 'a', now)).toBeNull();
    expect(gameFor(p({ state: 'pending' }), 'a', now)).toBeNull();
    expect(gameFor(p({ state: 'disputed' }), 'a', now)).toBeNull();
    expect(gameFor(p(), 'c', now)).toBeNull();
  });
  it('counts a reported game only once its dispute window has passed', () => {
    expect(gameFor(p({ state: 'reported', finalAt: '2026-10-02T00:00:00Z' }), 'a', now)).toBeNull();
    expect(gameFor(p({ state: 'reported', finalAt: '2026-09-30T00:00:00Z' }), 'a', now)?.won).toBe(true);
  });
  it('a double loss is a loss for both', () => {
    const g = p({ scoreA: 0, scoreB: 0 });
    expect(gameFor(g, 'a', now)?.won).toBe(false);
    expect(gameFor(g, 'b', now)?.won).toBe(false);
  });
});
