import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, cleanup, screen, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';

/**
 * The dock's own network calls, mocked at the module boundary the same way
 * `chat-screen.test.tsx` mocked them for the screen this dock replaced —
 * `ChatDock` and `ChatPane` are exercised through their real code, everything
 * they call into `lib/channels.ts` for is a test double. `isChannelUnread` is
 * reimplemented here rather than imported real: it is a four-line pure
 * function already proven by its own table in `channels.test.ts`, and
 * duplicating it keeps this mock a plain object literal with no dependency on
 * how `vi.mock` and `vi.resetModules` interact for a partial mock, which the
 * signed-in harness below already relies on for `@supabase/supabase-js`.
 */
const listChannelsWithActivity = vi.fn();
const listMessages = vi.fn();
const sendMessage = vi.fn();
const markRead = vi.fn();
const reportMessage = vi.fn();
const unsubscribe = vi.fn();
// Keyed by channel id: several panes can be open at once, each with its own
// subscription, and a test driving "a message arrived in c1" must not also
// fire c2's handler.
let onMessageByChannel: Record<string, (m: unknown) => void> = {};

vi.mock('../../lib/channels', () => ({
  listChannelsWithActivity: (...a: unknown[]) => listChannelsWithActivity(...a),
  isChannelUnread: (c: { lastReadAt: string | null; lastMessageAt: string | null }) => {
    if (!c.lastMessageAt) return false;
    if (!c.lastReadAt) return true;
    return c.lastMessageAt > c.lastReadAt;
  },
  listMessages: (...a: unknown[]) => listMessages(...a),
  sendMessage: (...a: unknown[]) => sendMessage(...a),
  markRead: (...a: unknown[]) => markRead(...a),
  reportMessage: (...a: unknown[]) => reportMessage(...a),
  subscribeToChannel: (channelId: string, cb: (m: unknown) => void) => {
    onMessageByChannel[channelId] = cb;
    return () => unsubscribe(channelId);
  },
}));

/** One of each kind, so kind styling and per-kind unread math both have
 *  something to tell apart. `c1` (a DM) is unread — no `lastReadAt` at all,
 *  a message present; `c2` (a group) is read — `lastReadAt` postdates its
 *  last message; `c3` (a match channel) has no messages yet, so it is never
 *  unread regardless of `lastReadAt`. */
const channelsFixture = [
  { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null, lastMessageAt: '2026-01-02T00:00:00Z' },
  { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: '2026-01-05T00:00:00Z', lastMessageAt: '2026-01-01T00:00:00Z' },
  { id: 'c3', kind: 'match', title: null, matchId: 'm1', lastReadAt: null, lastMessageAt: null },
];

beforeEach(() => {
  listChannelsWithActivity.mockReset().mockResolvedValue(channelsFixture);
  listMessages.mockReset().mockResolvedValue([
    { id: 'm1', channelId: 'c1', authorId: 'them', body: 'hey', createdAt: 't1', editedAt: null, deletedAt: null },
  ]);
  sendMessage.mockReset();
  markRead.mockReset().mockResolvedValue(undefined);
  reportMessage.mockReset();
  unsubscribe.mockReset();
  onMessageByChannel = {};
});

// -----------------------------------------------------------------------------
// A signed-in session, the same hoisted `@supabase/supabase-js` mock shape
// `chat-screen.test.tsx` and `team-saves.test.tsx` both use — `lib/supabase`
// builds its client once at import time, so this only takes effect for an
// import that happens AFTER `pkg.client` is set, which is why `mount` below
// resets modules and imports `ChatDock` dynamically rather than at the top of
// the file.
// -----------------------------------------------------------------------------
const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

function fakeSession(id: string): Session {
  return { access_token: 'tok', user: { id, email: `${id}@example.test` } } as unknown as Session;
}

function fakeClient(session: Session | null) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  pkg.client = { auth };
  return auth;
}

async function mount(session: Session | null) {
  fakeClient(session);
  vi.resetModules();
  const { SessionProvider } = await import('../../state/SessionContext');
  const { ChatDockRequestProvider } = await import('../../state/ChatDockContext');
  const { ChatDock: FreshChatDock } = await import('../ChatDock');
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <SessionProvider>
        <ChatDockRequestProvider>
          <FreshChatDock />
        </ChatDockRequestProvider>
      </SessionProvider>,
    );
  });
  return view;
}

describe('ChatDock, signed out', () => {
  beforeEach(() => cleanup());

  it('renders nothing at all — no rail, no header, no empty shell', async () => {
    const { container } = await mount(null);
    expect(container.firstChild).toBeNull();
    expect(listChannelsWithActivity).not.toHaveBeenCalled();
  });
});

describe('ChatDock, signed in', () => {
  beforeEach(() => cleanup());

  it("lists channels in the rail, each carrying its kind on the rail's coloured border", async () => {
    await mount(fakeSession('me'));
    const dm = await screen.findByRole('button', { name: /direct message/i });
    const group = screen.getByRole('button', { name: /squad/i });
    const match = screen.getByRole('button', { name: /match chat/i });
    expect(dm.getAttribute('data-kind')).toBe('dm');
    expect(group.getAttribute('data-kind')).toBe('group');
    expect(match.getAttribute('data-kind')).toBe('match');
  });

  it('opens a conversation from the rail and shows its transcript', async () => {
    await mount(fakeSession('me'));
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    expect(await screen.findByText('hey')).toBeInTheDocument();
    expect(listMessages).toHaveBeenCalledWith('c1');
  });

  /**
   * `c1` is unread (no `lastReadAt`, a message present); `c2` is read (its
   * `lastReadAt` postdates the last message); `c3` has no messages at all, so
   * it can never be unread. The total badge counts exactly the one
   * genuinely-unread channel.
   */
  it('reflects lastReadAt versus the latest message in each row\'s unread badge, and in the rail total', async () => {
    const { container } = await mount(fakeSession('me'));
    const dm = await screen.findByRole('button', { name: /direct message/i });
    const group = screen.getByRole('button', { name: /squad/i });
    const match = screen.getByRole('button', { name: /match chat/i });
    expect(dm.textContent).toMatch(/unread/i);
    expect(group.textContent).not.toMatch(/unread/i);
    expect(match.textContent).not.toMatch(/unread/i);
    const badge = container.querySelector('.chat-rail-badge')!;
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('aria-label')).toMatch(/1 unread conversation/i);
  });

  it('closes an open pane, leaving the rail row behind', async () => {
    await mount(fakeSession('me'));
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    fireEvent.click(screen.getByRole('button', { name: /close direct message.*c1/i }));
    await waitFor(() => expect(screen.queryByText('hey')).not.toBeInTheDocument());
    // The rail itself still lists the channel — closing a pane is not the
    // same as the conversation disappearing from the dock entirely.
    expect(screen.getByRole('button', { name: /direct message/i })).toBeInTheDocument();
  });
});

describe('ChatDock inside the app shell', () => {
  beforeEach(() => cleanup());

  /**
   * The one requirement the whole dock design rests on: `App.tsx` mounts
   * `ChatDock` as a SIBLING of the `key={state.screen}` div, not inside it,
   * so a navigation elsewhere does not remount the dock or tear down an open
   * pane's subscription. Proven here by driving a real navigation (clicking
   * a nav tab, the same way `app-shell.test.tsx` does) and checking that the
   * open pane's transcript is still on screen afterwards AND that opening it
   * never re-ran its data fetch a second time — the signature of a remount,
   * which `listMessages`'s call count would catch even if the text alone
   * happened to look unchanged.
   */
  it('keeps an open pane mounted, subscription and all, across a screen change', async () => {
    fakeClient(fakeSession('me'));
    vi.resetModules();
    const { default: FreshApp } = await import('../../App');
    let view!: RenderResult;
    await act(async () => {
      view = render(<FreshApp />);
    });
    const { container } = view;

    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    expect(listMessages).toHaveBeenCalledTimes(1);

    const rankingsTab = [...container.querySelectorAll('.nav-tab')].find((t) =>
      t.textContent?.includes('Rankings'),
    ) as HTMLElement;
    fireEvent.click(rankingsTab);
    await waitFor(() => expect(container.textContent).toMatch(/Rankings/));

    // Still there, and never re-fetched or re-subscribed.
    expect(screen.getByText('hey')).toBeInTheDocument();
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
