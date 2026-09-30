import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { StrictMode } from 'react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../SessionContext', () => ({ useSession: () => ({ user }) }));
const T = vi.hoisted(() => ({
  getTournament: vi.fn(), listEntrants: vi.fn(), listPairings: vi.fn(), listRosters: vi.fn(), listJudges: vi.fn(),
  getTournamentFormat: vi.fn(),
}));
vi.mock('../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../lib/tournaments')>()), ...T }));
const C = vi.hoisted(() => ({ resolveDisplayNames: vi.fn() }));
vi.mock('../../lib/channels', () => C);

import { useTournament } from '../useTournament';

const NOW = new Date('2026-09-29T12:00:00Z');
const tour = (over = {}) => ({
  id: 't1', organiserId: 'org', title: 'Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 3,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'registration', currentRound: 0,
  roundEndsAt: null, createdAt: '2026-09-01T00:00:00Z', entrants: 1, ...over,
});
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const mount = async (id = 't1', strict = false) => {
  const r = renderHook(() => useTournament(id), strict ? { wrapper: StrictMode } : undefined);
  await settle();
  return r;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  user = { id: 'me' };
  T.getTournament.mockReset().mockResolvedValue(tour());
  T.listEntrants.mockReset().mockResolvedValue([{ playerId: 'me', seed: 1, dropped: false, registeredAt: 'x' }]);
  T.listPairings.mockReset().mockResolvedValue([]);
  T.listRosters.mockReset().mockResolvedValue(new Map());
  T.listJudges.mockReset().mockResolvedValue(['j1']);
  T.getTournamentFormat.mockReset().mockResolvedValue({ name: 'Cup rules', format: {} });
  C.resolveDisplayNames.mockReset().mockResolvedValue(new Map([['org', 'Ash'], ['j1', 'Misty']]));
});
afterEach(() => vi.useRealTimers());

describe('useTournament', () => {
  it('loads everything, names the people and derives the state', async () => {
    const { result } = await mount();
    expect(result.current.tournament?.title).toBe('Cup');
    expect(result.current.entrants).toHaveLength(1);
    expect(result.current.judges).toEqual(['j1']);
    expect(result.current.names.get('org')).toBe('Ash');
    expect(result.current.format?.name).toBe('Cup rules');
    expect(result.current.me).toBe('me');
    expect(result.current.state).toBe('registration');
    expect(result.current.loading).toBe(false);
    expect(C.resolveDisplayNames).toHaveBeenCalledWith(expect.arrayContaining(['org', 'j1', 'me']));
  });

  it('polls every 15 s and stops on unmount', async () => {
    const { unmount } = await mount();
    expect(T.getTournament).toHaveBeenCalledTimes(1);
    await tick(15_000);
    expect(T.getTournament).toHaveBeenCalledTimes(2);
    await tick(15_000);
    expect(T.getTournament).toHaveBeenCalledTimes(3);
    unmount();
    await tick(60_000);
    expect(T.getTournament).toHaveBeenCalledTimes(3);
  });

  it('polls every 10 s while running with a pending pairing of mine', async () => {
    T.getTournament.mockResolvedValue(tour({ state: 'running', currentRound: 1 }));
    T.listPairings.mockResolvedValue([{ id: 'p', round: 1, tableNo: 1, playerA: 'me', playerB: 'x', state: 'pending' }]);
    await mount();
    await tick(10_000);
    expect(T.getTournament).toHaveBeenCalledTimes(2);
  });

  it('keeps the last data on a failed read and reports it', async () => {
    const { result } = await mount();
    T.getTournament.mockRejectedValue(new Error('offline'));
    await tick(15_000);
    expect(result.current.tournament?.title).toBe('Cup');
    expect(result.current.error).toBe('offline');
    T.getTournament.mockResolvedValue(tour({ title: 'Cup 2' }));
    await tick(15_000);
    expect(result.current.tournament?.title).toBe('Cup 2');
    expect(result.current.error).toBeNull();
  });

  it('reads a passed registration deadline as closed with no refetch', async () => {
    T.getTournament.mockResolvedValue(tour({ registrationClosesAt: new Date(NOW.getTime() + 5_000).toISOString() }));
    const { result } = await mount();
    expect(result.current.state).toBe('registration');
    await tick(6_000);
    expect(result.current.state).toBe('closed');
    expect(T.getTournament).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while signed out', async () => {
    user = null;
    const { result } = await mount();
    await tick(30_000);
    expect(T.getTournament).not.toHaveBeenCalled();
    expect(result.current.tournament).toBeNull();
    expect(result.current.me).toBeNull();
  });

  it('drops a response that lands after the id changed', async () => {
    let release!: (t: unknown) => void;
    T.getTournament.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const { result, rerender } = renderHook(({ id }) => useTournament(id), { initialProps: { id: 'a' } });
    T.getTournament.mockResolvedValue(tour({ id: 'b', title: 'B' }));
    rerender({ id: 'b' });
    await settle();
    release(tour({ id: 'a', title: 'A' }));
    await settle();
    expect(result.current.tournament?.title).toBe('B');
  });

  it('a null tournament (unreadable) ends loading with no state', async () => {
    T.getTournament.mockResolvedValue(null);
    const { result } = await mount();
    expect(result.current.loading).toBe(false);
    expect(result.current.state).toBeNull();
  });

  it('survives StrictMode without a leaked interval', async () => {
    const { unmount } = await mount('t1', true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries the format on the next poll when its first read fails', async () => {
    T.getTournamentFormat.mockRejectedValueOnce(new Error('offline'));
    const { result } = await mount();
    expect(result.current.format).toBeNull();
    expect(result.current.tournament?.title).toBe('Cup');
    await tick(15_000);
    expect(result.current.format?.name).toBe('Cup rules');
    await tick(15_000);
    expect(T.getTournamentFormat).toHaveBeenCalledTimes(2); // not re-read once it landed
  });

  it('refresh retries a missing format too', async () => {
    T.getTournamentFormat.mockResolvedValueOnce(null);
    const { result } = await mount();
    expect(result.current.format).toBeNull();
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.format?.name).toBe('Cup rules');
  });

  it('ignores an older load that resolves after a newer one', async () => {
    let releaseOld!: (t: unknown) => void;
    const { result } = await mount();
    T.getTournament.mockReturnValueOnce(new Promise((r) => { releaseOld = r; }));
    await tick(15_000); // the old poll starts and hangs
    T.getTournament.mockResolvedValueOnce(tour({ title: 'Fresh' }));
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.tournament?.title).toBe('Fresh');
    releaseOld(tour({ title: 'Stale' }));
    await settle();
    expect(result.current.tournament?.title).toBe('Fresh');
  });

  it('is loading, not empty, on the very first render after the id changes', async () => {
    const seen: [string, boolean][] = [];
    const { rerender } = renderHook(({ id }) => { const v = useTournament(id); seen.push([id, v.loading]); return v; }, { initialProps: { id: 't1' } });
    await settle();
    T.getTournament.mockReturnValue(new Promise(() => {}));
    rerender({ id: 't2' });
    await settle();
    expect(seen.filter(([id]) => id === 't2').every(([, l]) => l)).toBe(true);
  });

  it('a reported (unsettled) pairing of mine keeps the 10 s poll', async () => {
    T.getTournament.mockResolvedValue(tour({ state: 'running', currentRound: 1 }));
    T.listPairings.mockResolvedValue([{ id: 'p', round: 1, tableNo: 1, playerA: 'me', playerB: 'x', state: 'reported' }]);
    await mount();
    await tick(10_000);
    expect(T.getTournament).toHaveBeenCalledTimes(2);
  });

  it('a settled pairing of mine does not count as live (10 s poll needs a live one)', async () => {
    T.getTournament.mockResolvedValue(tour({ state: 'running', currentRound: 1 }));
    T.listPairings.mockResolvedValue([{ id: 'p', round: 1, tableNo: 1, playerA: 'me', playerB: 'x', state: 'settled' }]);
    await mount();
    await tick(10_000);
    expect(T.getTournament).toHaveBeenCalledTimes(1);
    await tick(5_000);
    expect(T.getTournament).toHaveBeenCalledTimes(2);
  });
});
