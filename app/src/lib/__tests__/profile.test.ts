import { describe, it, expect } from 'vitest';
import { showcase, tierFor, TIER_MIN_GAMES } from '../profile';
import { placeIn, type Pairing, type PlayerGame } from '../tournaments';

const g = (t: string, opp: string, won: boolean, over: Partial<PlayerGame> = {}): PlayerGame => ({
  tournamentId: t, title: t, round: 1, opponentId: opp, myRounds: won ? 2 : 0, oppRounds: won ? 0 : 2, won,
  myRoster: null, oppRoster: null, league: 'great', formatName: 'F', teamSize: 6, complete: true, playedAt: '2026-10-01T00:00:00Z', ...over,
});

describe('tierFor', () => {
  it('is Unranked below the floor, with progress toward it', () => {
    expect(tierFor(4, TIER_MIN_GAMES - 1)).toEqual({ name: 'Unranked', progress: 4 / 5, next: 'Initiate' });
  });
  it('reads the lower bound, so a short perfect run does not outrank a long strong one', () => {
    expect(tierFor(5, 5).name).toBe('Expert'); // lower bound 0.57
    expect(tierFor(80, 100).name).toBe('Legend');
    expect(tierFor(80, 100)).toMatchObject({ next: null, progress: 1 });
    expect(tierFor(0, 20).name).toBe('Initiate');
  });
});

describe('showcase', () => {
  it('counts only Show 6 games, per tournament and per league', () => {
    const s = showcase([
      g('a', 'x', true), g('a', 'y', false), g('b', 'x', true, { league: 'ultra' }),
      g('c', 'z', true, { teamSize: 3 }),
    ], new Map([['a', { place: 2, field: 9 }], ['b', { place: 4, field: 9 }]]));
    expect(s).toMatchObject({ wins: 2, losses: 1, uniqueOpponents: 2, tournaments: 2 });
    expect(s.byLeague).toEqual({ great: { wins: 1, losses: 1 }, ultra: { wins: 1, losses: 0 }, master: { wins: 0, losses: 0 } });
    expect(s.bouts.map((b) => [b.tournamentId, b.wins, b.losses])).toEqual([['a', 1, 1], ['b', 1, 0]]);
    expect(s.trophies.map((t) => t.tournamentId)).toEqual(['a']); // 4th is not a podium
  });
  it('gives an unfinished tournament no placement, so no trophy', () => {
    const s = showcase([g('a', 'x', true, { complete: false })], new Map([['a', { place: 1, field: 2 }]]));
    expect(s.bouts[0].placement).toBeNull();
    expect(s.trophies).toEqual([]);
  });
});

describe('placeIn', () => {
  const p = (round: number, a: string, b: string | null, sa: number, sb: number): Pairing => ({
    id: `${round}${a}`, round, tableNo: 1, playerA: a, playerB: b, scoreA: sa, scoreB: sb, state: 'settled',
    reportedBy: null, reportedAt: null, finalAt: null, note: null,
  });
  it('places a player by the Swiss standings over every counted pairing, byes included', () => {
    const ps = [p(1, 'a', 'b', 2, 0), p(1, 'c', null, 2, 0), p(2, 'a', 'c', 2, 1), p(2, 'b', null, 2, 0)];
    expect(placeIn(ps, 'a', new Date())).toEqual({ place: 1, field: 3 });
    expect(placeIn(ps, 'nobody', new Date())).toBeNull();
  });
});

describe('speciesOnly', () => {
  it('reads a Shadow favourite as its species, once', async () => {
    const { speciesOnly } = await import('../profile');
    expect(speciesOnly(['ninetales_shadow', 'ninetales', 'glaceon', 'entei_shadow'])).toEqual(['ninetales', 'glaceon', 'entei']);
  });
});
