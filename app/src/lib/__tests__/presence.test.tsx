import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// A fake supabase channel: records its presence `sync` handler and subscribe callback so the test drives them.
const chans: { topic: string; sync?: () => void; subscribed?: (s: string) => void; state: string; presence: Record<string, unknown[]>; track: ReturnType<typeof vi.fn> }[] = [];
const removeChannel = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    removeChannel: (...a: unknown[]) => removeChannel(...a),
    channel: (topic: string) => {
      const c = {
        topic, state: 'joining', presence: {} as Record<string, unknown[]>, track: vi.fn(),
        sync: undefined as undefined | (() => void), subscribed: undefined as undefined | ((s: string) => void),
        on(_t: string, _f: unknown, cb: () => void) { c.sync = cb; return c; },
        subscribe(cb: (s: string) => void) { c.subscribed = cb; return c; },
        presenceState: () => c.presence,
      };
      chans.push(c);
      return c;
    },
  },
}));
// The real shared-channel helper, not setup.ts's inert one.
vi.mock('../realtime', async (orig) => orig());

const { joinShared } = await import('../realtime');
const { joinPresence, holdMatchPresence, statusesFrom } = await import('../presence');
const { TrainerAvatar } = await import('../../components/TrainerBits');
const { ChatRailRow } = await import('../../components/ChatRailRow');
const { capCount } = await import('../../components/chatRow');
const { typingLine, seenMessageId } = await import('../../components/ChatPane');

beforeEach(() => {
  chans.length = 0;
  removeChannel.mockReset();
});

describe('statusesFrom', () => {
  it('folds each trainer’s tabs to one status: any tab in a match wins; an empty key is unknown', () => {
    expect([...statusesFrom({ a: [{ status: 'online' }], b: [{ status: 'online' }, { status: 'match' }], c: [] })])
      .toEqual([['a', 'online'], ['b', 'match']]);
  });
});

describe('joinShared', () => {
  it('creates one channel per topic, and removes it a tick after the last leave unless someone rejoins', async () => {
    vi.useFakeTimers();
    const create = vi.fn(() => ({ id: 'x' }) as never);
    const a = joinShared('t', create, () => {});
    const b = joinShared('t', create, () => {});
    expect(create).toHaveBeenCalledTimes(1);
    a.leave(); a.leave(); b.leave();
    // StrictMode's remount inside the grace tick keeps the channel.
    const c = joinShared('t', create, () => {});
    vi.runAllTimers();
    expect(removeChannel).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    c.leave();
    vi.runAllTimers();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('presence', () => {
  it('tracks online once joined, "match" while held, and shows the dot only for trainers presence knows', async () => {
    const leave = joinPresence('me');
    const ch = chans[0];
    ch.state = 'joined';
    ch.subscribed!('SUBSCRIBED');
    expect(ch.track).toHaveBeenLastCalledWith({ status: 'online' });
    const release = holdMatchPresence();
    expect(ch.track).toHaveBeenLastCalledWith({ status: 'match' });
    release(); release();
    expect(ch.track).toHaveBeenLastCalledWith({ status: 'online' });

    render(<>
      <TrainerAvatar profile={undefined} name="Ally" userId="ally" />
      <TrainerAvatar profile={undefined} name="Bo" userId="bo" />
      <TrainerAvatar profile={undefined} name="Cy" userId="cy" />
    </>);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    ch.presence = { ally: [{ status: 'online' }], bo: [{ status: 'match' }] };
    act(() => ch.sync!());
    expect(screen.getByRole('img', { name: 'Online' }).getAttribute('data-status')).toBe('online');
    expect(screen.getByRole('img', { name: 'In a match' }).getAttribute('data-status')).toBe('match');
    // No "Offline": Cy is simply unknown.
    expect(screen.queryAllByRole('img')).toHaveLength(2);
    act(() => leave());
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});

describe('the inbox row’s unread badge', () => {
  const c = {
    id: 'c1', kind: 'dm' as const, title: null, matchId: null, lastReadAt: null, lastMessageAt: '2026-01-02T00:00:00Z',
    displayTitle: 'Ally', memberCount: null, otherId: 'ally',
  };
  const row = (unreadCount?: number) => render(<ChatRailRow c={{ ...c, unreadCount }} unread open={false} profile={undefined} me="me" onOpen={() => {}} />);

  it('shows the count, capped at 99+, and names it in the row’s label', () => {
    row(3);
    expect(screen.getByRole('button').textContent).toContain('3');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Open chat with Ally, 3 unread');
    expect(capCount(99)).toBe('99');
    expect(capCount(100)).toBe('99+');
  });

  it('falls back to the plain Unread tag when nothing was counted', () => {
    row(undefined);
    expect(screen.getByText('Unread')).toBeTruthy();
  });
});

describe('typingLine', () => {
  it('names one or two typers, then stops naming', () => {
    expect(typingLine([])).toBeNull();
    expect(typingLine(['Ally'])).toBe('Ally is typing…');
    expect(typingLine(['Ally', 'Bo'])).toBe('Ally and Bo are typing…');
    expect(typingLine(['Ally', 'Bo', 'Cy'])).toBe('Several people are typing…');
  });
});

describe('seenMessageId', () => {
  const msg = (id: string, authorId: string, createdAt: string, deletedAt: string | null = null) =>
    ({ id, channelId: 'c', authorId, body: id, createdAt, editedAt: null, deletedAt, kind: 'text' as const, offerId: null });
  it('is your last message when it ends the conversation and their read mark covers it', () => {
    const ms = [msg('a', 'them', 't1'), msg('b', 'me', 't2')];
    expect(seenMessageId(ms, 'me', 't2')).toBe('b');
    expect(seenMessageId(ms, 'me', 't1')).toBeNull();
    expect(seenMessageId(ms, 'me', null)).toBeNull();
    expect(seenMessageId([...ms, msg('c', 'them', 't3')], 'me', 't3')).toBeNull();
    expect(seenMessageId([msg('b', 'me', 't2', 't3')], 'me', 't9')).toBeNull();
  });
});
