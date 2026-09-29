import { describe, it, expect } from 'vitest';
import { buildNotices } from '../notifications';
import type { Challenge } from '../challenges';
import type { Friend } from '../social';
import type { ChannelDisplay } from '../channels';

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
