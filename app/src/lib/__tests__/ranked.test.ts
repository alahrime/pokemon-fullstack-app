import { describe, it, expect } from 'vitest';
import { seasonLabel, gateStatus } from '../ranked';

describe('ranked', () => {
  it('labels a season by its UTC month', () => {
    expect(seasonLabel({ startsAt: '2026-09-01T00:00:00+00:00' })).toBe('September 2026');
    expect(seasonLabel({ startsAt: '2026-01-01T00:00:00+00:00' })).toBe('January 2026');
  });
  it('words the gate: games left and/or a rating still too uncertain', () => {
    expect(gateStatus({ games: 3, rd: 200 })).toEqual({ listed: false, gamesLeft: 2, needsRd: true });
    expect(gateStatus({ games: 5, rd: 110 })).toEqual({ listed: true, gamesLeft: 0, needsRd: false });
    expect(gateStatus({ games: 5, rd: 111 })).toEqual({ listed: false, gamesLeft: 0, needsRd: true });
  });
});
