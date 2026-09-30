import { describe, it, expect } from 'vitest';
import { buildNotices } from '../notifications';
import type { Challenge } from '../challenges';
import type { Friend } from '../social';
import type { ChannelDisplay } from '../channels';
import type { Pairing, Tournament } from '../tournaments';

const now = new Date('2026-01-01T12:00:00Z');
const future = '2026-01-01T13:00:00Z';
const past = '2026-01-01T11:00:00Z';
const ch = (o: Partial<ChannelDisplay>) =>
  ({ id: 'c1', displayTitle: 'Ann', otherId: 'ann', lastMessageAt: '2026-01-01T10:00:00Z', lastReadAt: '2026-01-01T10:00:00Z', ...o }) as ChannelDisplay;
const chal = (o: Partial<Challenge>): Challenge => ({
  id: 'x', proposerId: 'ann', targetId: 'me', league: 'great', state: 'open', scheduledFor: null,
  expiresAt: future, verifiedHash: 'h', matchId: null, rosterSize: 3, formatName: null, ...o,
});
const fr = (o: Partial<Friend>): Friend => ({ otherId: 'bob', status: 'pending', theyAsked: true, createdAt: '', ...o });
const run = (i: Partial<Parameters<typeof buildNotices>[0]>) =>
  buildNotices({ channels: [], challenges: [], friends: [], me: 'me', now, ...i });

describe('buildNotices', () => {
  it('unread channel yields a message notice; read does not', () => {
    const n = run({ channels: [ch({ lastMessageAt: '2026-01-01T11:00:00Z' }), ch({ id: 'c2' })] });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ id: 'ch:c1', kind: 'message', title: 'Ann', target: { screen: 'chat', channelId: 'c1' } });
  });
  it('open challenge to me targets the proposer DM', () => {
    const n = run({ challenges: [chal({ id: 'a' })], channels: [ch({})] });
    expect(n[0]).toMatchObject({ id: 'co:a', kind: 'challenge', target: { screen: 'chat', channelId: 'c1' } });
  });
  it('falls back to chat with no channel', () => {
    expect(run({ challenges: [chal({ id: 'a' })] })[0].target).toEqual({ screen: 'chat' });
  });
  it('my own open challenge yields nothing', () => {
    expect(run({ challenges: [chal({ proposerId: 'me', targetId: 'ann' })] })).toEqual([]);
  });
  it('expired yields nothing', () => {
    expect(run({ challenges: [chal({ expiresAt: past }), chal({ state: 'accepted', proposerId: 'me', expiresAt: past })] })).toEqual([]);
  });
  it('accepted challenge I proposed yields confirm', () => {
    const n = run({ challenges: [chal({ id: 'b', state: 'accepted', proposerId: 'me', targetId: 'ann' })] });
    expect(n[0]).toMatchObject({ id: 'cc:b', kind: 'confirm' });
  });
  it('incoming pending friend yields friend; outgoing does not', () => {
    const n = run({ friends: [fr({}), fr({ otherId: 'z', theyAsked: false }), fr({ otherId: 'y', status: 'accepted' })] });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ id: 'fr:bob', kind: 'friend', target: { screen: 'friends' } });
  });
  it('orders challenge/confirm, friend, message; ids stable', () => {
    const input = {
      channels: [ch({ lastMessageAt: '2026-01-01T11:00:00Z' })],
      friends: [fr({})],
      challenges: [chal({ id: 'a' }), chal({ id: 'b', state: 'accepted', proposerId: 'me', targetId: 'ann' })],
    };
    const n = run(input);
    expect(n.map((x) => x.id)).toEqual(['co:a', 'cc:b', 'fr:bob', 'ch:c1']);
    expect(run(input).map((x) => x.id)).toEqual(n.map((x) => x.id));
  });
});

const T = (o: Partial<Tournament> = {}): Tournament => ({
  id: 't1', organiserId: 'org', title: 'Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 3,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'running', currentRound: 2,
  roundEndsAt: past, createdAt: past, entrants: 4, ...o,
});
const P = (o: Partial<Pairing> = {}): Pairing => ({
  id: 'p1', tournamentId: 't1', round: 2, tableNo: 1, playerA: 'me', playerB: 'ann', scoreA: null, scoreB: null,
  state: 'pending', reportedBy: null, reportedAt: null, finalAt: null, note: null, ...o,
});
const names = new Map([['ann', 'Ann']]);

describe('buildNotices: tournaments', () => {
  it('round: only for a pending current-round game of mine, named, targeting the tournament', () => {
    const n = run({ tournaments: [T()], pairings: [P()], names });
    expect(n).toEqual([{
      id: 'tr:p1', kind: 'round', title: 'Cup', detail: 'Round 2: you play Ann',
      target: { screen: 'tournaments', tournamentId: 't1' },
    }]);
    expect(run({ tournaments: [T()], pairings: [P({ playerB: null })], names })).toEqual([]);
    expect(run({ tournaments: [T()], pairings: [P({ state: 'settled' })], names })).toEqual([]);
    expect(run({ tournaments: [T()], pairings: [P({ round: 1 })], names })).toEqual([]);
    expect(run({ tournaments: [T({ state: 'closed' })], pairings: [P()], names })).toEqual([]);
  });
  it('round: an unresolved opponent reads Someone, never the uuid', () => {
    expect(run({ tournaments: [T()], pairings: [P({ playerB: 'uuid-9' })] })[0].detail).toBe('Round 2: you play Someone');
  });
  it('report: only when the OTHER player reported and it is not final', () => {
    const t = [T()];
    expect(run({ tournaments: t, pairings: [P({ state: 'reported', reportedBy: 'ann', finalAt: future })], names })[0])
      .toMatchObject({ id: 'tp:p1', kind: 'report', detail: 'Ann reported — confirm or dispute' });
    expect(run({ tournaments: t, pairings: [P({ state: 'reported', reportedBy: 'me', finalAt: future })], names })).toEqual([]);
    expect(run({ tournaments: t, pairings: [P({ state: 'reported', reportedBy: 'ann', finalAt: past })], names })).toEqual([]);
    expect(run({ tournaments: t, pairings: [P({ state: 'disputed', reportedBy: 'ann' })], names })).toEqual([]);
  });
  it('attention: run-authority only, past round end, counting un-counted games I do not play', () => {
    const ps = [
      P({ id: 'a', playerA: 'x', playerB: 'y' }),
      P({ id: 'b', playerA: 'x2', playerB: 'y2', state: 'reported', reportedBy: 'x2', finalAt: future }),
      P({ id: 'c', playerA: 'x3', playerB: 'y3', state: 'settled' }),
      P({ id: 'd', playerA: 'x4', playerB: null }),
      P({ id: 'e', playerA: 'me', playerB: 'z' }),
    ];
    const asOrg = run({ me: 'org', tournaments: [T()], pairings: ps });
    expect(asOrg).toEqual([{
      id: 'ta:t1:2', kind: 'attention', title: 'Cup', detail: '3 pairings need attention',
      target: { screen: 'tournaments', tournamentId: 't1' },
    }]);
    expect(run({ tournaments: [T()], pairings: ps, judgeOf: ['t1'] })[0]).toMatchObject({ id: 'ta:t1:2', detail: '2 pairings need attention' });
    expect(run({ tournaments: [T()], pairings: ps }).map((n) => n.kind)).toEqual(['round']); // an entrant: no attention
    expect(run({ me: 'org', tournaments: [T({ roundEndsAt: future })], pairings: ps })).toEqual([]);
    expect(run({ me: 'org', tournaments: [T({ roundEndsAt: null })], pairings: ps })).toEqual([]);
  });
  it('order: attention, challenge, confirm, report, round, friend, message', () => {
    const n = run({
      me: 'org',
      channels: [ch({ lastMessageAt: '2026-01-01T11:00:00Z' })],
      challenges: [chal({ id: 'a', targetId: 'org' }), chal({ id: 'b', state: 'accepted', proposerId: 'org', targetId: 'ann' })],
      friends: [fr({})],
      tournaments: [T(), T({ id: 't2', organiserId: 'x' })],
      pairings: [
        P({ id: 'g', playerA: 'x', playerB: 'y' }),
        P({ id: 'r', tournamentId: 't2', playerA: 'org', playerB: 'ann' }),
        P({ id: 'q', tournamentId: 't2', playerA: 'org', playerB: 'bob', state: 'reported', reportedBy: 'bob', finalAt: future }),
      ],
    });
    expect(n.map((x) => x.id)).toEqual(['ta:t1:2', 'co:a', 'cc:b', 'tp:q', 'tr:r', 'fr:bob', 'ch:c1']);
  });
});
