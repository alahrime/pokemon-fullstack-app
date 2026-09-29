import { describe, it, expect } from 'vitest';
import { hashFor, screenFromHash } from '../route';
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
  it('round-trips every screen except match', () => {
    for (const d of SCREEN_DEFS) {
      if (d.id === 'match') continue;
      expect(screenFromHash(hashFor(d.id)), d.id).toBe(d.id);
    }
  });
  it('sends anything unrecognised to landing', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/analyze/nope', '#/play/rankings', 'garbage'])
      expect(screenFromHash(h), h).toBe('landing');
  });
});
