import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const list = vi.fn();
const names = vi.fn();
let user: { id: string } | null = { id: 'me' };

vi.mock('../../lib/channels', async () => ({
  ...(await vi.importActual<object>('../../lib/channels')),
  listChannelsWithActivity: (...a: unknown[]) => list(...a),
  withDisplayNames: (...a: unknown[]) => names(...a),
}));
vi.mock('../SessionContext', () => ({ useSession: () => ({ user }) }));

import { ChannelListProvider, useChannelList, POLL_MS } from '../ChannelListContext';

type V = ReturnType<typeof useChannelList>;
let seen: V[] = [];
function Reader() {
  seen.push(useChannelList());
  return null;
}
const cur = () => seen[seen.length - 1];
const ch = (id: string, over: object = {}) => ({
  id, kind: 'dm', title: null, matchId: null, lastReadAt: null, lastMessageAt: null, displayTitle: id, memberCount: null, ...over,
});
const mount = async (n = 1) => {
  await act(async () => {
    render(
      <ChannelListProvider>
        {Array.from({ length: n }, (_, i) => (
          <Reader key={i} />
        ))}
      </ChannelListProvider>,
    );
  });
};

beforeEach(() => {
  seen = [];
  user = { id: 'me' };
  list.mockReset().mockResolvedValue([]);
  names.mockReset().mockImplementation(async (cs: unknown) => cs);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ChannelListProvider', () => {
  it('signed out: channels null, no fetch', async () => {
    user = null;
    await mount();
    expect(cur().channels).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('signed in: one fetch on mount, channels populated, totalUnread counts unread rows', async () => {
    list.mockResolvedValue([ch('a', { lastMessageAt: '2026-01-02' }), ch('b', { lastMessageAt: '2026-01-01', lastReadAt: '2026-01-05' })]);
    await mount();
    expect(list).toHaveBeenCalledTimes(1);
    expect(cur().channels?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(cur().totalUnread).toBe(1);
  });

  it('two consumers share one fetch', async () => {
    await mount(2);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('refresh() refetches', async () => {
    await mount();
    await act(async () => cur().refresh());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('a fetch error sets loadError and keeps the previous channels', async () => {
    list.mockResolvedValue([ch('a')]);
    await mount();
    list.mockRejectedValue(new Error('boom'));
    await act(async () => cur().refresh());
    expect(cur().loadError).toBe('boom');
    expect(cur().channels?.map((c) => c.id)).toEqual(['a']);
  });

  it('bumpActivity only moves lastMessageAt forward; bumpRead only lastReadAt', async () => {
    list.mockResolvedValue([ch('a', { lastMessageAt: '2026-01-05', lastReadAt: '2026-01-05' })]);
    await mount();
    await act(async () => cur().bumpActivity('a', '2026-01-01'));
    expect(cur().channels![0].lastMessageAt).toBe('2026-01-05');
    await act(async () => cur().bumpActivity('a', '2026-01-09'));
    expect(cur().channels![0].lastMessageAt).toBe('2026-01-09');
    await act(async () => cur().bumpRead('a', '2026-01-01'));
    expect(cur().channels![0].lastReadAt).toBe('2026-01-05');
    await act(async () => cur().bumpRead('a', '2026-01-08'));
    expect(cur().channels![0].lastReadAt).toBe('2026-01-08');
  });

  it('clears the interval on unmount', async () => {
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ChannelListProvider>
          <Reader />
        </ChannelListProvider>,
      );
    });
    await act(async () => void vi.advanceTimersByTime(POLL_MS));
    expect(list).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => void vi.advanceTimersByTime(POLL_MS * 3));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
