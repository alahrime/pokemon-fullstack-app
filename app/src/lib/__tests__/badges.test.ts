import { describe, it, expect } from 'vitest';
import { computeBadges } from '../badges';
import type { Friend } from '../social';
import type { MyOffer } from '../matchmaking';

const f = (over: Partial<Friend>): Friend => ({
  otherId: 'x', status: 'pending', theyAsked: true, createdAt: '2026-01-01', ...over,
});
const o = (over: Partial<MyOffer>): MyOffer => ({
  id: 'o', proposerId: 'me', league: 'great', formatVersionId: 'v', scheduledFor: null,
  expiresAt: '2026-01-01', state: 'open', acceptedBy: null, verifiedHash: null,
  matchId: null, rosterSize: 6, roster: [], ...over,
});

describe('computeBadges', () => {
  it('adds chat only for a positive unread count', () => {
    expect(computeBadges([], [], 'me', 3)).toEqual({ chat: 3 });
    expect(computeBadges([], [], 'me')).toEqual({});
    expect(computeBadges([], [], 'me', 0)).toEqual({});
  });

  it('counts only incoming pending requests', () => {
    const b = computeBadges(
      [f({}), f({ theyAsked: false }), f({ status: 'accepted' })], [], 'me');
    expect(b.friends).toBe(1);
  });
  it('counts accepted offers I proposed that still await my confirmation', () => {
    const b = computeBadges([], [
      o({ state: 'accepted', acceptedBy: 'them' }),
      o({ state: 'accepted', acceptedBy: 'them', matchId: 'm' }),
      o({ state: 'accepted', acceptedBy: 'me', proposerId: 'them' }),
      o({ state: 'open' }),
    ], 'me');
    expect(b.matchmaking).toBe(1);
  });
  it('omits zeros so an empty rail shows nothing', () => {
    expect(computeBadges([], [], 'me')).toEqual({});
  });
});

describe('computeBadges: tournaments', () => {
  it('adds tournaments only for a positive liveRounds', () => {
    expect(computeBadges([], [], 'me', 0, 2)).toEqual({ tournaments: 2 });
    expect(computeBadges([], [], 'me', 0, 0)).toEqual({});
    expect(computeBadges([], [], 'me')).toEqual({});
  });
});
