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
const withDisplayNames = vi.fn();
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
  withDisplayNames: (...a: unknown[]) => withDisplayNames(...a),
  // The real four-bucket function, proven independently by its own table in
  // `channels.test.ts` — reimplemented here as a plain pure function (rather
  // than imported real) so this file's mock of `../../lib/channels` stays a
  // single self-contained object literal with no partial-mock interaction to
  // reason about.
  humanTime: (iso: string, now: Date = new Date()) => {
    const then = new Date(iso);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(then, now)) {
      const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
      return `${pad(then.getHours())}:${pad(then.getMinutes())}`;
    }
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(then, yesterday)) return 'yesterday';
    return 'a while ago';
  },
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

/**
 * `withDisplayNames` is mocked at the module boundary too — real name
 * resolution (batching `channel_members` and `profiles`) is `channels.ts`'s
 * own concern, proven independently in `channels.test.ts`. This default
 * stands in for it: a `dm` and a `match` each resolve to a real person's
 * name (never the channel's own uuid), and the `group` gets a member count
 * instead of a timestamp — the same three shapes the real function produces.
 */
function defaultDisplayNames(cs: typeof channelsFixture) {
  return cs.map((c) => {
    if (c.kind === 'group') return { ...c, displayTitle: c.title ?? 'Group', memberCount: 4 };
    if (c.id === 'c3') return { ...c, displayTitle: 'Rival', memberCount: null };
    return { ...c, displayTitle: 'Ally', memberCount: null };
  });
}

beforeEach(() => {
  listChannelsWithActivity.mockReset().mockResolvedValue(channelsFixture);
  withDisplayNames.mockReset().mockImplementation(async (cs: typeof channelsFixture) => defaultDisplayNames(cs));
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
    const dm = await screen.findByRole('button', { name: /open chat with ally/i });
    const group = screen.getByRole('button', { name: /open chat with squad/i });
    const match = screen.getByRole('button', { name: /open chat with rival/i });
    expect(dm.getAttribute('data-kind')).toBe('dm');
    expect(group.getAttribute('data-kind')).toBe('group');
    expect(match.getAttribute('data-kind')).toBe('match');
  });

  it('opens a conversation from the rail and shows its transcript', async () => {
    await mount(fakeSession('me'));
    fireEvent.click(await screen.findByRole('button', { name: /open chat with ally/i }));
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
    const dm = await screen.findByRole('button', { name: /open chat with ally/i });
    const group = screen.getByRole('button', { name: /open chat with squad/i });
    const match = screen.getByRole('button', { name: /open chat with rival/i });
    expect(dm.getAttribute('aria-label')).toMatch(/, 1 unread$/i);
    expect(group.getAttribute('aria-label')).not.toMatch(/unread/i);
    expect(match.getAttribute('aria-label')).not.toMatch(/unread/i);
    expect(dm.textContent).toMatch(/unread/i);
    expect(group.textContent).not.toMatch(/unread/i);
    expect(match.textContent).not.toMatch(/unread/i);
    const badge = container.querySelector('.chat-rail-badge')!;
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('aria-label')).toMatch(/1 unread conversation/i);
  });

  it('closes an open pane, leaving the rail row behind', async () => {
    await mount(fakeSession('me'));
    fireEvent.click(await screen.findByRole('button', { name: /open chat with ally/i }));
    await screen.findByText('hey');
    // The pane's own close button still carries `channelLabel`'s generic
    // kind-based text (`ChatPane` is a separate concern from the rail's
    // display-name resolution) — unaffected by this change.
    fireEvent.click(screen.getByRole('button', { name: /close direct message.*c1/i }));
    await waitFor(() => expect(screen.queryByText('hey')).not.toBeInTheDocument());
    // The rail itself still lists the channel — closing a pane is not the
    // same as the conversation disappearing from the dock entirely.
    expect(screen.getByRole('button', { name: /open chat with ally/i })).toBeInTheDocument();
  });
});

describe('ChatDock rail content', () => {
  beforeEach(() => cleanup());

  it("shows the dm row's title as the other member's display name", async () => {
    await mount(fakeSession('me'));
    const dm = await screen.findByRole('button', { name: /open chat with ally/i });
    expect(dm.querySelector('.chat-rail-title')!.textContent).toBe('Ally');
  });

  it("shows a group's member count in its sub-line, never a timestamp", async () => {
    await mount(fakeSession('me'));
    const group = await screen.findByRole('button', { name: /open chat with squad/i });
    expect(group.querySelector('.chat-rail-title')!.textContent).toBe('Squad');
    expect(group.querySelector('.chat-rail-sub')!.textContent).toBe('group · 4 people');
  });

  /**
   * Pins Finding 4: the row's accessible name used to be the concatenation
   * of every text node inside it (title, sub-line and the "Unread" tag all
   * read together). `aria-label` now carries a short, purpose-built name
   * instead, and the check that it is shorter than the button's full visible
   * text is what proves the two have actually been decoupled, rather than
   * the aria-label simply repeating the blob.
   */
  it('gives the rail row a short accessible name instead of the concatenation of everything inside it', async () => {
    await mount(fakeSession('me'));
    const dm = await screen.findByRole('button', { name: /open chat with ally/i });
    expect(dm.getAttribute('aria-label')).toBe('Open chat with Ally, 1 unread');
    expect(dm.getAttribute('aria-label')!.length).toBeLessThan(dm.textContent!.length);

    const group = screen.getByRole('button', { name: /open chat with squad/i });
    expect(group.getAttribute('aria-label')).toBe('Open chat with Squad');
  });

  it('renders a same-day message as a clock time, and a much older one as neither an ISO string nor microseconds', async () => {
    // Anchored to the actual moment the test runs (not a frozen system
    // clock) — `today` only has to land on the SAME calendar day the test
    // executes, and `longAgo` only has to land outside the last week, both
    // of which hold regardless of exactly when that is.
    const now = new Date();
    const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 4, 0).toISOString();
    const longAgoIso = new Date(now.getFullYear(), now.getMonth() - 2, 10, 9, 0, 0).toISOString();
    listChannelsWithActivity.mockResolvedValue([
      { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: todayIso, lastMessageAt: todayIso },
      { id: 'c3', kind: 'match', title: null, matchId: 'm1', lastReadAt: longAgoIso, lastMessageAt: longAgoIso },
    ]);
    await mount(fakeSession('me'));
    const dm = await screen.findByRole('button', { name: /open chat with ally/i });
    const match = await screen.findByRole('button', { name: /open chat with rival/i });
    expect(dm.querySelector('.chat-rail-sub')!.textContent).toBe('direct · 19:04');
    const matchSub = match.querySelector('.chat-rail-sub')!.textContent!;
    expect(matchSub).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(matchSub.startsWith('match · ')).toBe(true);
  });

  /**
   * The original defect, verbatim: the rail's `innerText` included an ISO
   * timestamp with microsecond precision and the raw channel uuid. Neither
   * may appear anywhere in the dock once a channel has a resolved
   * `displayTitle` and a human sub-line.
   */
  it('never renders a channel uuid or a raw ISO timestamp anywhere in the dock', async () => {
    const { container } = await mount(fakeSession('me'));
    await screen.findByRole('button', { name: /open chat with ally/i });
    expect(container.textContent).not.toContain('c1');
    expect(container.textContent).not.toContain('c2');
    expect(container.textContent).not.toContain('c3');
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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

    fireEvent.click(await screen.findByRole('button', { name: /open chat with ally/i }));
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
