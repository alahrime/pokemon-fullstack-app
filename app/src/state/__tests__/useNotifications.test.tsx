import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Challenge } from '../../lib/challenges';
import type { Friend } from '../../lib/social';

const myChallenges = vi.fn();
const listFriends = vi.fn();
let user: { id: string } | null = { id: 'me' };
let channels: unknown[] | null = [];
vi.mock('../../lib/challenges', () => ({ myChallenges: () => myChallenges() }));
vi.mock('../../lib/social', () => ({ listFriends: () => listFriends() }));
vi.mock('../SessionContext', () => ({ useSession: () => ({ user }) }));
vi.mock('../ChannelListContext', () => ({ useChannelList: () => ({ channels }) }));
vi.mock('../AppState', () => ({ useAppState: () => ({ patch: vi.fn() }) }));
vi.mock('../ChatDockContext', () => ({ useChatDockRequest: () => ({ requestChannel: vi.fn() }) }));

import { useNotifications } from '../useNotifications';

const future = new Date(Date.now() + 3600_000).toISOString();
const chal = (id: string): Challenge => ({
  id, proposerId: 'ann', targetId: 'me', league: 'great', state: 'open', scheduledFor: null,
  expiresAt: future, verifiedHash: 'h', matchId: null, rosterSize: 3, formatName: null,
});
const fr = (otherId: string): Friend => ({ otherId, status: 'pending', theyAsked: true, createdAt: '' });
const unreadCh = { id: 'c1', displayTitle: 'Ann', otherId: 'ann', lastMessageAt: '2026-01-01T11:00:00Z', lastReadAt: null };
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
const ids = (n: { id: string }[]) => n.map((x) => x.id);

beforeEach(() => {
  vi.useFakeTimers();
  user = { id: 'me' };
  channels = [];
  myChallenges.mockReset().mockResolvedValue([chal('a')]);
  listFriends.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('useNotifications', () => {
  it('signed out: reads nothing and offers nothing to toast', async () => {
    user = null;
    const { result } = renderHook(() => useNotifications());
    await settle();
    await poll();
    expect(myChallenges).not.toHaveBeenCalled();
    expect(listFriends).not.toHaveBeenCalled();
    expect(result.current.notices).toEqual([]);
    expect(result.current.fresh).toEqual([]);
  });

  it('first load is not fresh; a new id on the next poll is', async () => {
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(ids(result.current.notices)).toEqual(['co:a']);
    expect(result.current.fresh).toEqual([]);
    myChallenges.mockResolvedValue([chal('a'), chal('b')]);
    await poll();
    expect(ids(result.current.fresh)).toEqual(['co:b']);
  });

  it('channels arriving after challenges do not toast the backlog', async () => {
    channels = null;
    const { result, rerender } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.fresh).toEqual([]);
    channels = [unreadCh];
    rerender();
    expect(ids(result.current.notices)).toContain('ch:c1');
    expect(result.current.fresh).toEqual([]);
  });

  it('a failed read keeps the last answer', async () => {
    const { result } = renderHook(() => useNotifications());
    await settle();
    myChallenges.mockRejectedValue(new Error('down'));
    await poll();
    expect(ids(result.current.notices)).toEqual(['co:a']);
    expect(result.current.fresh).toEqual([]);
  });

  it('friend requests arrive as fresh too, and sign-out resets', async () => {
    const { result, rerender } = renderHook(() => useNotifications());
    await settle();
    listFriends.mockResolvedValue([fr('bob')]);
    await poll();
    expect(ids(result.current.fresh)).toEqual(['fr:bob']);
    user = null;
    rerender();
    expect(result.current.notices).toEqual([]);
    expect(result.current.fresh).toEqual([]);
  });
});
