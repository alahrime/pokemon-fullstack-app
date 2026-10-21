import { describe, expect, it } from 'vitest';
import { layoutMessages } from '../ChatPane';
import { matchStatus } from '../MatchCard';
import { headToHead } from '../FriendCard';
import type { Message } from '../../lib/channels';
import type { RecordRow } from '../../lib/records';

const msg = (id: string, authorId: string, createdAt: string, kind: Message['kind'] = 'text'): Message => ({
  id, channelId: 'c', authorId, body: id, createdAt, editedAt: null, deletedAt: null, kind, offerId: null,
});

describe('layoutMessages', () => {
  it('groups one author inside five minutes, breaks on a gap, a new day, or a challenge card', () => {
    const rows = layoutMessages([
      msg('a', 'u1', '2026-10-20T10:00:00Z'),
      msg('b', 'u1', '2026-10-20T10:03:00Z'),
      msg('c', 'u1', '2026-10-20T10:20:00Z'),
      msg('d', 'u1', '2026-10-21T10:21:00Z'),
      msg('e', 'u1', '2026-10-21T10:22:00Z', 'challenge'),
    ], 'u1', null);
    expect(rows.map((r) => [r.m.id, r.first, r.last, r.newDay])).toEqual([
      ['a', true, false, true],
      ['b', false, true, false],
      ['c', true, true, false],
      ['d', true, true, true],
      ['e', true, true, false],
    ]);
  });

  it('puts the New divider above the first message from someone else after the read mark, once', () => {
    const rows = layoutMessages([
      msg('a', 'u2', '2026-10-21T10:00:00Z'),
      msg('b', 'me', '2026-10-21T10:05:00Z'),
      msg('c', 'u2', '2026-10-21T10:06:00Z'),
      msg('d', 'u2', '2026-10-21T10:07:00Z'),
    ], 'me', '2026-10-21T10:01:00Z');
    expect(rows.map((r) => r.unread)).toEqual([false, false, true, false]);
    // The divider starts a fresh group even inside one author's run.
    expect(rows[2].first).toBe(true);
  });
});

describe('matchStatus', () => {
  it('puts a match on you exactly when the next report is yours', () => {
    expect(matchStatus('paired', undefined).needsYou).toBe(true);
    expect(matchStatus('mismatch', undefined)).toMatchObject({ needsYou: true, cta: 'Amend report' });
    expect(matchStatus('reported', false)).toMatchObject({ needsYou: true, cta: 'Report result' });
    expect(matchStatus('reported', true)).toMatchObject({ needsYou: false, cta: 'Waiting on opponent' });
    // Until we know whose report is in, it is not called yours.
    expect(matchStatus('reported', undefined).needsYou).toBe(false);
    for (const s of ['confirmed', 'disputed', 'unverified', 'abandoned'] as const) expect(matchStatus(s, undefined).needsYou).toBe(false);
  });
});

describe('headToHead', () => {
  it('counts only this opponent, newest first, last five', () => {
    const row = (opponentId: string, won: boolean, playedAt: string) => ({ opponentId, won, playedAt }) as RecordRow;
    const rows = [row('x', true, 't7'), row('y', false, 't6'), row('x', false, 't5'), row('x', true, 't4'), row('x', true, 't3'), row('x', true, 't2'), row('x', false, 't1')];
    expect(headToHead(rows, 'x')).toEqual({ wins: 4, losses: 2, last5: [true, false, true, true, true], lastPlayed: 't7' });
    expect(headToHead(rows, 'z')).toEqual({ wins: 0, losses: 0, last5: [], lastPlayed: null });
  });
});
