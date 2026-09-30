import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Challenge } from '../../lib/challenges';
import type { Friend } from '../../lib/social';

const myChallenges = vi.fn();
const listFriends = vi.fn();
const myTournamentActivity = vi.fn();
const resolveDisplayNames = vi.fn();
const patch = vi.fn();
let user: { id: string } | null = { id: 'me' };
let channels: unknown[] | null = [];
vi.mock('../../lib/challenges', () => ({ myChallenges: () => myChallenges() }));
vi.mock('../../lib/tournaments', async (orig) => ({ ...(await orig<object>()), myTournamentActivity: () => myTournamentActivity() }));
vi.mock('../../lib/channels', async (orig) => ({ ...(await orig<object>()), resolveDisplayNames: (x: string[]) => resolveDisplayNames(x) }));
vi.mock('../../lib/matchmaking', () => ({ myOffers: () => Promise.resolve([]) }));
vi.mock('../../lib/social', () => ({ listFriends: () => listFriends() }));
vi.mock('../SessionContext', () => ({ useSession: () => ({ user }) }));
vi.mock('../ChannelListContext', () => ({ useChannelList: () => ({ channels }) }));
vi.mock('../AppState', () => ({ useAppState: () => ({ patch }) }));
vi.mock('../ChatDockContext', () => ({ useChatDockRequest: () => ({ requestChannel: vi.fn() }) }));

import { useNotifications, useOpenNotice } from '../useNotifications';
import { useBadges } from '../useBadges';
import { NotificationsProvider } from '../NotificationsContext';
import { NotificationBell } from '../../components/NotificationBell';
import { Toaster } from '../../components/Toaster';
import type { Pairing, Tournament } from '../../lib/tournaments';

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
  myTournamentActivity.mockReset().mockResolvedValue({ tournaments: [], pairings: [], judgeOf: [] });
  resolveDisplayNames.mockReset().mockResolvedValue(new Map([['ann', 'Ann']]));
  patch.mockReset();
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
    expect(myTournamentActivity).not.toHaveBeenCalled();
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

const tour: Tournament = {
  id: 't1', organiserId: 'org', title: 'Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 3,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'running', currentRound: 1,
  roundEndsAt: future, createdAt: '', entrants: 4,
};
const game = (id: string): Pairing => ({
  id, tournamentId: 't1', round: 1, tableNo: 1, playerA: 'me', playerB: 'ann', scoreA: null, scoreB: null,
  state: 'pending', reportedBy: null, reportedAt: null, finalAt: null, note: null,
});
const activity = (ids: string[]) => ({ tournaments: [tour], pairings: ids.map(game), judgeOf: [] });

describe('useNotifications: tournaments', () => {
  it('a round notice names the opponent; the first load is not fresh, a new game is', async () => {
    myTournamentActivity.mockResolvedValue(activity(['g1']));
    const { result } = renderHook(() => useNotifications());
    await settle();
    expect(result.current.notices.find((n) => n.id === 'tr:g1')).toMatchObject({ detail: 'Round 1: you play Ann' });
    expect(result.current.fresh).toEqual([]);
    myTournamentActivity.mockResolvedValue(activity(['g1', 'g2']));
    await poll();
    expect(ids(result.current.fresh)).toEqual(['tr:g2']);
  });

  it('a failed tournament read keeps the last answer', async () => {
    myTournamentActivity.mockResolvedValue(activity(['g1']));
    const { result } = renderHook(() => useNotifications());
    await settle();
    myTournamentActivity.mockRejectedValue(new Error('down'));
    await poll();
    expect(ids(result.current.notices)).toContain('tr:g1');
  });

  it('one myTournamentActivity call per interval with bell, toaster and badges mounted', async () => {
    myTournamentActivity.mockResolvedValue(activity(['g1']));
    const Consumers = () => { useBadges(); return <><NotificationBell /><Toaster /></>; };
    const { unmount } = renderHook(() => null, { wrapper: ({ children }) => <NotificationsProvider>{children}<Consumers /></NotificationsProvider> });
    await settle();
    expect(myTournamentActivity).toHaveBeenCalledTimes(1);
    await poll();
    expect(myTournamentActivity).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('badges: the tournaments count comes from the shared notices', async () => {
    myTournamentActivity.mockResolvedValue(activity(['g1', 'g2']));
    const { result } = renderHook(() => useBadges(), { wrapper: NotificationsProvider });
    await settle();
    expect(result.current.tournaments).toBe(2);
  });

  it('opening a tournament notice sets the screen and the tournament', async () => {
    myTournamentActivity.mockResolvedValue(activity(['g1']));
    const { result } = renderHook(() => ({ n: useNotifications(), open: useOpenNotice() }));
    await settle();
    result.current.open(result.current.n.notices.find((n) => n.id === 'tr:g1')!);
    expect(patch).toHaveBeenCalledWith({ screen: 'tournaments', activeTournamentId: 't1' });
  });
});
