import { describe, it, expect } from 'vitest';
import { hashFor, hashForPlayer, hashForTournament, hashForView, playerIdFromHash, screenFromHash, tournamentIdFromHash } from '../route';
import { SCREEN_DEFS } from '../screens';

describe('hash routing', () => {
  it('writes readable paths', () => {
    expect(hashFor('landing')).toBe('#/');
    expect(hashFor('account')).toBe('#/account');
    expect(hashFor('chat')).toBe('#/play/chat');
    expect(hashFor('rankings')).toBe('#/analyze/rankings');
    expect(hashFor('friends')).toBe('#/play/friends');
  });
  it('an open match shares the Matches address, since a match cannot be reopened from a URL', () => {
    expect(hashFor('match')).toBe(hashFor('matchmaking'));
    expect(screenFromHash(hashFor('match'))).toBe('matchmaking');
  });
  it('round-trips every screen except match and player', () => {
    for (const d of SCREEN_DEFS) {
      if (d.id === 'match' || d.id === 'player') continue;
      expect(screenFromHash(hashFor(d.id)), d.id).toBe(d.id);
    }
  });
  it('round-trips a tournament deep link', () => {
    const id = '3f2b8a10-5c4d-4e6f-9a1b-0c2d3e4f5a6b';
    expect(hashFor('tournaments')).toBe('#/play/tournaments');
    expect(hashForTournament(id)).toBe(`#/play/tournaments/${id}`);
    expect(tournamentIdFromHash(hashForTournament(id))).toBe(id);
    expect(screenFromHash(hashForTournament(id))).toBe('tournaments');
    for (const h of ['#/play/tournaments', '#/play/tournaments/nope', '#/play/tournaments/' + id + '/x', 'garbage'])
      expect(tournamentIdFromHash(h), h).toBeNull();
    expect(screenFromHash('#/play/tournaments/nope')).toBe('landing');
    expect(tournamentIdFromHash(`#/play/tournaments/${id.toUpperCase()}`)).toBe(id);
    expect(screenFromHash(`#/play/tournaments/${id}/`)).toBe('landing');
  });
  it('round-trips a player profile link; a bare player screen sits at the Records address', () => {
    const id = '3f2b8a10-5c4d-4e6f-9a1b-0c2d3e4f5a6b';
    expect(hashForPlayer(id)).toBe(`#/play/players/${id}`);
    expect(playerIdFromHash(hashForPlayer(id))).toBe(id);
    expect(screenFromHash(hashForPlayer(id))).toBe('player');
    expect(hashForView('player', null, id)).toBe(hashForPlayer(id));
    expect(hashFor('player')).toBe(hashFor('records'));
    for (const h of ['#/play/players', '#/play/players/nope', `#/play/players/${id}/x`, '#/play/player'])
      expect(playerIdFromHash(h), h).toBeNull();
    expect(screenFromHash('#/play/player')).toBe('landing');
    expect(playerIdFromHash(`#/play/players/${id.toUpperCase()}`)).toBe(id);
  });
  it('sends anything unrecognised to landing', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/analyze/nope', '#/play/rankings', 'garbage'])
      expect(screenFromHash(h), h).toBe('landing');
  });
});
