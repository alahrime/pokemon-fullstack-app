import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, cleanup, screen, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { renderApp } from '../../test/render';
import { ChatPane, channelLabel } from '../ChatPane';
import type { Channel } from '../../lib/channels';

const sendMessage = vi.fn();
const unsubscribe = vi.fn();
const reportMessage = vi.fn();
const markRead = vi.fn();
let onMessage: ((m: unknown) => void) | null = null;

const transcript = [
  { id: 'm1', channelId: 'c1', authorId: 'them', body: 'hey', createdAt: 't1', editedAt: null, deletedAt: null },
  { id: 'm2', channelId: 'c1', authorId: 'them', body: 'gone now', createdAt: 't2', editedAt: null, deletedAt: 't3' },
  { id: 'm3', channelId: 'c1', authorId: 'me', body: 'my own message', createdAt: 't4', editedAt: null, deletedAt: null },
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

const dm: Channel = { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null };
const group: Channel = { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null };

function pane(channel: Channel, overrides: Partial<Parameters<typeof ChatPane>[0]> = {}) {
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

describe('channelLabel', () => {
  it('names a group by its own title, and the two title-less kinds by what they are', () => {
    expect(channelLabel(dm)).toBe('Direct message');
    expect(channelLabel(group)).toBe('Squad');
    expect(channelLabel({ ...group, title: null })).toBe('Group');
    expect(channelLabel({ id: 'c3', kind: 'match', title: null, matchId: 'm1', lastReadAt: null })).toBe('Match chat');
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
    const reasonBox = await screen.findByRole('textbox', { name: /report reason for message m1/i });
    fireEvent.change(reasonBox, { target: { value: 'spam' } });
    fireEvent.click(screen.getByRole('button', { name: /submit report for message m1/i }));
    await waitFor(() => expect(reportMessage).toHaveBeenCalledWith('m1', 'spam'));
    expect(await screen.findByText('Reported')).toBeInTheDocument();
  });

  it('does not submit a report while the reason field is empty', async () => {
    pane(dm);
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /^report message/i })[0]);
    const submit = await screen.findByRole('button', { name: /submit report for message m1/i });
    expect(submit).toBeDisabled();
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('closes the reason form without reporting when Cancel is clicked', async () => {
    pane(dm);
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /^report message/i })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /report reason for message m1/i }), {
      target: { value: 'spam' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel report for message m1/i }));
    expect(reportMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /report reason for message m1/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^report message m1/i })).toBeInTheDocument();
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
    expect(theirs.querySelector('button[aria-label="Report message m1"]')).not.toBeNull();
  });
});
