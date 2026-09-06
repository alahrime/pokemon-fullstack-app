import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, cleanup, screen, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { renderApp } from '../../test/render';
import { ChatScreen } from '../ChatScreen';

const sendMessage = vi.fn();
const unsubscribe = vi.fn();
const reportMessage = vi.fn();
const markRead = vi.fn();
let onMessage: ((m: unknown) => void) | null = null;

/**
 * `me`'s own message (`m3`, in every channel's transcript) exists so the
 * own-message and cleared-across-channels tests below have something to
 * exercise without a second mocked channel — `listMessages` here ignores
 * `channelId` for anything but choosing which fixed array to return, same as
 * the fixture this replaces, just with one more row.
 */
function transcriptFor(channelId: string) {
  if (channelId !== 'c1') return [];
  return [
    { id: 'm1', channelId: 'c1', authorId: 'them', body: 'hey', createdAt: 't1', editedAt: null, deletedAt: null },
    { id: 'm2', channelId: 'c1', authorId: 'them', body: 'gone now', createdAt: 't2', editedAt: null, deletedAt: 't3' },
    { id: 'm3', channelId: 'c1', authorId: 'me', body: 'my own message', createdAt: 't4', editedAt: null, deletedAt: null },
  ];
}

vi.mock('../../lib/channels', () => ({
  listChannels: async () => [
    { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null },
    { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null },
  ],
  listMessages: async (channelId: string) => transcriptFor(channelId),
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

/**
 * Deliberately no mock of `../../lib/supabase` and no signed-in session, for
 * most of these tests: `ChatScreen`, like the module it reads, does not gate
 * its own render on `useSession()` — `listChannels()` and `markRead()`
 * already refuse to do anything meaningful with no session (see
 * `lib/channels.ts`), and this screen's own tests exercise it purely through
 * the mocked `lib/channels` module above, the same way the task brief's own
 * skeleton does. Under the suite-wide signed-out default, `user` is `null`,
 * so `m3` (authored `'me'`) is never treated as this viewer's OWN message —
 * that identity comparison needs a real session, which the tests that care
 * about it build with the `mount()` harness below (the same shape
 * `team-saves.test.tsx` and `matchmaking.test.tsx` already use).
 */
describe('chat screen', () => {
  it('lists channels labelled by kind, and opens one to show its transcript', async () => {
    renderApp(<ChatScreen />);
    expect(await screen.findByRole('button', { name: /squad/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /direct message/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /direct message/i }));
    expect(await screen.findByText('hey')).toBeInTheDocument();
  });

  it('will not send an empty message, and disables Send while a send is in flight', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /squad/i }));
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

  it('unsubscribes when the open channel changes, keyed on channel id', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /squad/i }));
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
  });

  /**
   * `sendMessage` returns the inserted row AND the subscription delivers the
   * same row (see `lib/channels.ts`'s doc comment on `sendMessage`). Without
   * de-duplication by id, the sender would see their own message twice.
   */
  it('de-duplicates a subscription delivery that repeats a message already appended', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /squad/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /message/i }), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getAllByText('hi')).toHaveLength(1));

    // Realtime delivers the same row back, with the same id.
    act(() => {
      onMessage?.({
        id: 'm9', channelId: 'c2', authorId: 'me', body: 'hi',
        createdAt: 't9', editedAt: null, deletedAt: null,
      });
    });
    expect(screen.getAllByText('hi')).toHaveLength(1);
  });

  it('renders a deleted message as "Message deleted" rather than its body', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.queryByText('gone now')).not.toBeInTheDocument();
  });

  /**
   * The other half of hiding Report on a deleted message: a deleted row must
   * render NEITHER the button nor a stray "Reported" marker — there is
   * nothing behind it to report or to have reported.
   */
  it('never renders a Report control on a deleted message', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    const deleted = (await screen.findByText('Message deleted')).closest('li')!;
    expect(deleted.querySelector('button[aria-label*="Report"]')).toBeNull();
    expect(deleted.textContent).not.toMatch(/Reported/);
  });

  it('opens an inline reason form, submits it, and shows Reported afterwards', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');

    const reportButtons = screen.getAllByRole('button', { name: /^report message/i });
    // Per-row accessible names: several messages must not share one "Report".
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
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /^report message/i })[0]);
    const submit = await screen.findByRole('button', { name: /submit report for message m1/i });
    expect(submit).toBeDisabled();
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('closes the reason form without reporting when Cancel is clicked', async () => {
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /^report message/i })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /report reason for message m1/i }), {
      target: { value: 'spam' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel report for message m1/i }));
    expect(reportMessage).not.toHaveBeenCalled();
    // The form is gone and the plain Report button is back.
    expect(screen.queryByRole('textbox', { name: /report reason for message m1/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^report message m1/i })).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Tests below need a REAL signed-in identity to compare against `m3`'s
// `authorId: 'me'` — `renderApp`'s own `SessionProvider` settles signed-out
// for the whole suite (see its doc comment), so these build the same
// session-bearing harness `team-saves.test.tsx` and `matchmaking.test.tsx`
// already use rather than accepting that default.
// -----------------------------------------------------------------------------
// Signed-out by default, matching `src/test/setup.ts`'s own suite-wide mock —
// the tests in the FIRST `describe` above run through this same
// `vi.mock('@supabase/supabase-js', ...)` (mocks are per-file, and a
// file-level one wins over the global setup mock for every import in this
// file) and never call `fakeClient`, so `pkg.client` must already be a valid
// signed-out client rather than `null` or they would crash in
// `SessionContext`'s effect exactly the way an unmocked `null` client did.
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

/**
 * `lib/supabase` builds its client once at import time, so the mock above
 * only takes effect for an import that happens AFTER `pkg.client` is set —
 * see `team-saves.test.tsx`'s identical harness for why this resets modules
 * and imports dynamically rather than importing at the top of the file.
 * `../../lib/channels` stays mocked at the top of this file: `vi.mock` calls
 * are hoisted module-wide, so the reset below does not undo it.
 */
async function mountSignedIn(id: string) {
  fakeClient(fakeSession(id));
  vi.resetModules();
  const { ThemeProvider } = await import('../../state/ThemeContext');
  const { AppStateProvider } = await import('../../state/AppState');
  const { SessionProvider } = await import('../../state/SessionContext');
  const { ChatScreen: FreshChatScreen } = await import('../ChatScreen');
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <ThemeProvider>
        <SessionProvider>
          <AppStateProvider>
            <FreshChatScreen />
          </AppStateProvider>
        </SessionProvider>
      </ThemeProvider>,
    );
  });
  return view;
}

describe('chat screen, signed in as the author of one message in the transcript', () => {
  beforeEach(() => {
    cleanup();
  });

  it('never renders a Report control (button or "Reported") on the viewer\'s own message', async () => {
    await mountSignedIn('me');
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    const own = (await screen.findByText('my own message')).closest('li')!;
    expect(own.querySelector('button[aria-label*="Report"]')).toBeNull();
    expect(own.textContent).not.toMatch(/Reported/);

    // The other author's message is unaffected by this viewer's identity.
    const theirs = screen.getByText('hey').closest('li')!;
    expect(theirs.querySelector('button[aria-label="Report message m1"]')).not.toBeNull();
  });

  /**
   * `reportedIds` is local UI state, not a server fact — switching to a
   * different conversation and back must not leave a stale "Reported" badge
   * standing for a message this session never actually reported in THIS
   * viewing of the channel.
   */
  it('clears the "Reported" marker when the open channel changes and changes back', async () => {
    await mountSignedIn('me');
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');

    fireEvent.click(screen.getByRole('button', { name: 'Report message m1' }));
    fireEvent.change(screen.getByRole('textbox', { name: /report reason for message m1/i }), {
      target: { value: 'spam' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit report for message m1/i }));
    expect(await screen.findByText('Reported')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /squad/i }));
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    expect(screen.queryByText('Reported')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report message m1' })).toBeInTheDocument();
  });
});
