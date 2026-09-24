import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, cleanup, screen, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { renderApp } from '../../test/render';
import { ChatPane } from '../ChatPane';
import type { ChannelDisplay } from '../../lib/channels';

const sendMessage = vi.fn();
const unsubscribe = vi.fn();
const reportMessage = vi.fn();
const markRead = vi.fn();
let onMessage: ((m: unknown) => void) | null = null;

// UUID-shaped on purpose: these ids are what used to leak into every Report
// control's accessible name, and the guard test at the bottom of this file
// cannot catch a regression unless the fixture actually carries the shape.
const M1 = '9b5df0aa-1e0a-42fd-ad95-6a9a7be1412c';
const M2 = '92c75e91-a7d4-4233-8e61-6668cc31a76f';
const M3 = '7c1e4d02-3f55-4a91-9b7e-1d2c3f4a5b6c';

const transcript = [
  { id: M1, channelId: 'c1', authorId: 'them', body: 'hey', createdAt: 't1', editedAt: null, deletedAt: null },
  { id: M2, channelId: 'c1', authorId: 'them', body: 'gone now', createdAt: 't2', editedAt: null, deletedAt: 't3' },
  { id: M3, channelId: 'c1', authorId: 'me', body: 'my own message', createdAt: 't4', editedAt: null, deletedAt: null },
];

vi.mock('../../lib/channels', () => ({
  listMessages: async () => transcript,
  sendMessage: (...a: unknown[]) => sendMessage(...a),
  subscribeToChannel: (_channelId: string, cb: (m: unknown) => void) => {
    onMessage = cb;
    return unsubscribe;
  },
  markRead: (...a: unknown[]) => markRead(...a),
  reportMessage: (...a: unknown[]) => reportMessage(...a),
}));

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue({
    id: 'm9', channelId: 'c1', authorId: 'me', body: 'hi',
    createdAt: 't9', editedAt: null, deletedAt: null,
  });
  unsubscribe.mockReset();
  reportMessage.mockReset().mockResolvedValue('report-1');
  markRead.mockReset().mockResolvedValue(undefined);
  onMessage = null;
});

// `displayTitle`/`memberCount` are what `ChatDock` actually passes down —
// `withDisplayNames`'s own resolved fields, not something `ChatPane` computes
// itself. `dm`'s "Ally" matches `chat-dock.test.tsx`'s fixture of the same
// shape, so a name showing up in the wrong file is easy to spot.
const dm: ChannelDisplay = {
  id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null,
  lastMessageAt: null, displayTitle: 'Ally', memberCount: null,
};
const group: ChannelDisplay = {
  id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null,
  lastMessageAt: null, displayTitle: 'Squad', memberCount: 4,
};

function pane(channel: ChannelDisplay, overrides: Partial<Parameters<typeof ChatPane>[0]> = {}) {
  const onActivity = vi.fn();
  const onRead = vi.fn();
  const onToggleMinimize = vi.fn();
  const onClose = vi.fn();
  const view = renderApp(
    <ChatPane
      channel={channel}
      minimized={false}
      onToggleMinimize={onToggleMinimize}
      onClose={onClose}
      onActivity={onActivity}
      onRead={onRead}
      {...overrides}
    />,
  );
  return { ...view, onActivity, onRead, onToggleMinimize, onClose };
}

describe("the pane header's title and kind badge", () => {
  it("renders the channel's resolved displayTitle, the same value ChatDock's rail row shows — never a recomputed generic label", async () => {
    const { container } = pane(dm);
    await screen.findByText('hey');
    expect(container.querySelector('.chat-pane-title')!.textContent).toBe('Ally');
  });

  it('degrades to the honest fallback, never a uuid, when the channel carries no resolvable name', async () => {
    const unresolved: ChannelDisplay = { ...dm, displayTitle: 'Direct message' };
    const { container } = pane(unresolved);
    await screen.findByText('hey');
    expect(container.querySelector('.chat-pane-title')!.textContent).toBe('Direct message');
    expect(container.textContent).not.toContain(unresolved.id);
  });

  it("labels the kind badge dm/group/match chat — match spelled out, since the header has no sub-line to say what's chatting", async () => {
    const match: ChannelDisplay = {
      id: 'c3', kind: 'match', title: null, matchId: 'm1', lastReadAt: null,
      lastMessageAt: null, displayTitle: 'Rival', memberCount: null,
    };
    // Each render's own `listMessages`/`markRead` promises are awaited out
    // (via the same "hey" the mocked transcript always resolves to) before
    // `cleanup()` tears it down — otherwise one of those promises settles
    // after the next pane has already replaced it, updating an unmounted
    // component outside of `act`.
    const { container: dmContainer } = pane(dm);
    await screen.findByText('hey');
    expect(dmContainer.querySelector('.chat-pane-kind')!.textContent).toBe('dm');
    cleanup();

    const { container: groupContainer } = pane(group);
    await screen.findByText('hey');
    expect(groupContainer.querySelector('.chat-pane-kind')!.textContent).toBe('group');
    cleanup();

    const { container: matchContainer } = pane(match);
    await screen.findByText('hey');
    expect(matchContainer.querySelector('.chat-pane-kind')!.textContent).toBe('match chat');
  });
});

describe('close/minimise control names', () => {
  it('names Close and Minimize after the resolved channel, not the generic word or the raw uuid — unique across two open panes', async () => {
    const other: ChannelDisplay = {
      id: 'c9', kind: 'dm', title: null, matchId: null, lastReadAt: null,
      lastMessageAt: null, displayTitle: 'Buddy', memberCount: null,
    };
    const { container } = renderApp(
      <>
        <ChatPane channel={dm} minimized={false} onToggleMinimize={() => {}} onClose={() => {}} onActivity={() => {}} onRead={() => {}} />
        <ChatPane channel={other} minimized={false} onToggleMinimize={() => {}} onClose={() => {}} onActivity={() => {}} onRead={() => {}} />
      </>,
    );
    // Both panes' `listMessages` mock returns the same fixture transcript
    // regardless of channel id, so two "hey" texts land on screen at once —
    // `findAllByText` (not `findByText`, which requires exactly one match)
    // is what proves both panes actually finished loading before this reads
    // their close buttons.
    await screen.findAllByText('hey');
    const closeButtons = [...container.querySelectorAll('.chat-pane-controls button')].filter(
      (b) => b.getAttribute('aria-label')?.startsWith('Close'),
    );
    expect(closeButtons).toHaveLength(2);
    const names = closeButtons.map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(2);
    expect(names).toContain('Close chat with Ally');
    expect(names).toContain('Close chat with Buddy');
    expect(names.join(' ')).not.toContain('c1');
    expect(names.join(' ')).not.toContain('c9');
  });
});

describe('ChatPane, signed out (the suite-wide default)', () => {
  it('loads and shows the transcript, and marks the channel read on open', async () => {
    pane(dm);
    expect(await screen.findByText('hey')).toBeInTheDocument();
    expect(markRead).toHaveBeenCalledWith('c1');
  });

  it('will not send an empty message, and disables Send while a send is in flight', async () => {
    pane(group);
    const send = await screen.findByRole('button', { name: /send/i });
    expect(send).toBeDisabled();

    const box = screen.getByRole('textbox', { name: /message/i });
    fireEvent.change(box, { target: { value: '   ' } });
    expect(send).toBeDisabled();

    fireEvent.change(box, { target: { value: 'hi' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c2', 'hi'));
  });

  it('reports this pane\'s own activity (send) up through onActivity and onRead', async () => {
    const { onActivity, onRead } = pane(group);
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onActivity).toHaveBeenCalledWith('c2', 't9'));
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('c2', expect.any(String)));
  });

  it('tears its subscription down exactly once on unmount', async () => {
    const { unmount } = pane(dm);
    await screen.findByText('hey');
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates a subscription delivery that repeats a message already appended', async () => {
    pane(group);
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getAllByText('hi')).toHaveLength(1));

    act(() => {
      onMessage?.({
        id: 'm9', channelId: 'c2', authorId: 'me', body: 'hi',
        createdAt: 't9', editedAt: null, deletedAt: null,
      });
    });
    expect(screen.getAllByText('hi')).toHaveLength(1);
  });

  it('renders a deleted message as "Message deleted" rather than its body', async () => {
    pane(dm);
    await screen.findByText('hey');
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.queryByText('gone now')).not.toBeInTheDocument();
  });

  it('never renders a Report control on a deleted message', async () => {
    pane(dm);
    const deleted = (await screen.findByText('Message deleted')).closest('li')!;
    expect(deleted.querySelector('button[aria-label*="Report"]')).toBeNull();
    expect(deleted.textContent).not.toMatch(/Reported/);
  });

  it('opens an inline reason form, submits it, and shows Reported afterwards', async () => {
    pane(dm);
    await screen.findByText('hey');
    const reportButtons = screen.getAllByRole('button', { name: /^report message/i });
    const names = reportButtons.map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);

    fireEvent.click(reportButtons[0]);
    const reasonBox = await screen.findByRole('textbox', { name: /reason for reporting “hey”/i });
    fireEvent.change(reasonBox, { target: { value: 'spam' } });
    fireEvent.click(screen.getByRole('button', { name: /submit report for “hey”/i }));
    await waitFor(() => expect(reportMessage).toHaveBeenCalledWith(M1, 'spam'));
    expect(await screen.findByText('Reported')).toBeInTheDocument();
  });

  it('does not submit a report while the reason field is empty', async () => {
    pane(dm);
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /^report message/i })[0]);
    const submit = await screen.findByRole('button', { name: /submit report for “hey”/i });
    expect(submit).toBeDisabled();
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('closes the reason form without reporting when Cancel is clicked', async () => {
    pane(dm);
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /^report message/i })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /reason for reporting “hey”/i }), {
      target: { value: 'spam' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel reporting “hey”/i }));
    expect(reportMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /reason for reporting “hey”/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^report message “hey”/i })).toBeInTheDocument();
  });

  it('does not mark the channel read again for a message that arrives while minimised', async () => {
    markRead.mockClear();
    pane(dm, { minimized: true });
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1)); // the initial open
    act(() => {
      onMessage?.({
        id: 'm5', channelId: 'c1', authorId: 'them', body: 'while you were away',
        createdAt: 't5', editedAt: null, deletedAt: null,
      });
    });
    // Minimised panes still append the message (it will be there when
    // re-expanded) but must not re-mark-read on THIS viewer's behalf while
    // nobody is actually looking at it.
    expect(markRead).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// A message authored by 'me' needs a real signed-in identity to compare
// against — `renderApp`'s SessionProvider settles signed-out for the whole
// suite (see its own doc comment), so this builds the same session-bearing
// harness `chat-screen.test.tsx` used before it, for the same reason.
// -----------------------------------------------------------------------------
const pkg = vi.hoisted(() => ({
  client: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
  } as unknown,
}));
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

async function mountSignedIn(id: string) {
  fakeClient(fakeSession(id));
  vi.resetModules();
  const { SessionProvider } = await import('../../state/SessionContext');
  const { ChatPane: FreshChatPane } = await import('../ChatPane');
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <SessionProvider>
        <FreshChatPane
          channel={dm}
          minimized={false}
          onToggleMinimize={() => {}}
          onClose={() => {}}
          onActivity={() => {}}
          onRead={() => {}}
        />
      </SessionProvider>,
    );
  });
  return view;
}

describe('ChatPane, signed in as the author of one message in the transcript', () => {
  beforeEach(() => cleanup());

  it('never renders a Report control (button or "Reported") on the viewer\'s own message', async () => {
    await mountSignedIn('me');
    const own = (await screen.findByText('my own message')).closest('li')!;
    expect(own.querySelector('button[aria-label*="Report"]')).toBeNull();
    expect(own.textContent).not.toMatch(/Reported/);

    const theirs = screen.getByText('hey').closest('li')!;
    expect(theirs.querySelector('button[aria-label="Report message “hey”"]')).not.toBeNull();
  });
});

/**
 * The assertion that stops one defect class coming back.
 *
 * Raw uuids reached users four separate times in this project — as visible
 * text on the Friends screen, in the dock's rail sub-line, and twice in
 * `aria-label`s here, where nobody was looking because the visible text was
 * already clean. A screen reader speaks a uuid character by character.
 *
 * This walks everything rendered rather than naming individual controls, so
 * a NEW control that interpolates an id fails it without anyone remembering
 * to extend a list.
 */
describe('the pane never shows anyone a uuid', () => {
  beforeEach(() => cleanup());

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it('leaks no uuid through text, aria-label or title — with the report form open', async () => {
    const view = await mountSignedIn('me');
    fireEvent.click(await screen.findByRole('button', { name: /^report message “hey”/i }));
    await screen.findByRole('textbox', { name: /reason for reporting “hey”/i });

    const root = view.container;
    expect(root.textContent ?? '').not.toMatch(UUID);

    const offenders: string[] = [];
    root.querySelectorAll('*').forEach((el) => {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(attr);
        if (v && UUID.test(v)) offenders.push(`${el.tagName.toLowerCase()}[${attr}]="${v}"`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
