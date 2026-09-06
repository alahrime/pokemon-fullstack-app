import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ChatScreen } from '../ChatScreen';

const sendMessage = vi.fn();
const unsubscribe = vi.fn();
const reportMessage = vi.fn();
const markRead = vi.fn();
let onMessage: ((m: unknown) => void) | null = null;

vi.mock('../../lib/channels', () => ({
  listChannels: async () => [
    { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null },
    { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null },
  ],
  listMessages: async (channelId: string) =>
    channelId === 'c1'
      ? [
          {
            id: 'm1', channelId: 'c1', authorId: 'them', body: 'hey',
            createdAt: 't1', editedAt: null, deletedAt: null,
          },
          {
            id: 'm2', channelId: 'c1', authorId: 'them', body: 'gone now',
            createdAt: 't2', editedAt: null, deletedAt: 't3',
          },
        ]
      : [],
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
 * Deliberately no mock of `../../lib/supabase` and no signed-in session:
 * `ChatScreen`, like the module it reads, does not gate its own render on
 * `useSession()` — `listChannels()` and `markRead()` already refuse to do
 * anything meaningful with no session (see `lib/channels.ts`), and this
 * screen's own tests exercise it purely through the mocked `lib/channels`
 * module above, the same way the task brief's own skeleton does.
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

  it('reports a message after prompting for a reason, and shows Reported afterwards', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('spam');
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');

    const reportButtons = screen.getAllByRole('button', { name: /report/i });
    // Per-row accessible names: ten messages must not share one "Report".
    const names = reportButtons.map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);

    fireEvent.click(reportButtons[0]);
    expect(promptSpy).toHaveBeenCalled();
    await waitFor(() => expect(reportMessage).toHaveBeenCalledWith('m1', 'spam'));
    expect(await screen.findByText('Reported')).toBeInTheDocument();
  });

  it('does not report when the reason prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderApp(<ChatScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /direct message/i }));
    await screen.findByText('hey');
    fireEvent.click(screen.getAllByRole('button', { name: /report/i })[0]);
    expect(reportMessage).not.toHaveBeenCalled();
  });
});
