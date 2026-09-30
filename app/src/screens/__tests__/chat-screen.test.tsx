import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

let list: { channels: unknown[] | null; refresh: ReturnType<typeof vi.fn> };
let request: { requestedChannelId: string | null; clearRequestedChannel: ReturnType<typeof vi.fn> };
let appScreen = 'chat';
vi.mock('../../state/ChannelListContext', () => ({
  useChannelList: () => ({ ...list, loadError: null, bumpActivity: vi.fn(), bumpRead: vi.fn(), totalUnread: 0 }),
}));
vi.mock('../../state/ChatDockContext', () => ({
  useChatDockRequest: () => ({
    requestedMatchId: null,
    clearRequestedMatchChannel: vi.fn(),
    ...request,
  }),
}));
vi.mock('../../state/AppState', () => ({ useAppState: () => ({ state: { screen: appScreen }, patch: vi.fn() }) }));
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('../../components/ChatPane', () => ({
  ChatPane: (p: { channel: { id: string }; embedded?: boolean }) => (
    <div data-testid="pane" data-embedded={String(!!p.embedded)}>{p.channel.id}</div>
  ),
}));
vi.mock('../../components/OpponentPanel', () => ({ OpponentPanel: () => <aside aria-label="Opponent" /> }));
vi.mock('../../components/ChallengeSheet', () => ({ ChallengeSheet: () => null }));

import { ChatScreen } from '../ChatScreen';
import { ChatDock } from '../../components/ChatDock';

const ch = (id: string, kind: string, over = {}) => ({
  id, kind, title: null, matchId: null, otherId: null, memberCount: null,
  lastReadAt: null, lastMessageAt: null, displayTitle: `T-${id}`, ...over,
});

beforeEach(() => {
  appScreen = 'chat';
  request = { requestedChannelId: null, clearRequestedChannel: vi.fn() };
  list = {
    refresh: vi.fn(),
    channels: [
      ch('c1', 'dm', { otherId: 'u2', lastMessageAt: '2026-01-02T00:00:00Z' }),
      ch('c2', 'group', { memberCount: 4 }),
      ch('c3', 'match', { matchId: 'm1' }),
      ch('c4', 'tournament', { memberCount: 1 }),
    ],
  };
});
afterEach(cleanup);

describe('ChatScreen', () => {
  it('lists channels with kind, sub-line and unread tag, and filters', () => {
    render(<ChatScreen />);
    expect(screen.getByText('T-c1')).toBeTruthy();
    expect(screen.getByText('group · 4 people')).toBeTruthy();
    expect(screen.getAllByText('Unread')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(screen.queryByText('T-c1')).toBeNull();
    expect(screen.getByText('T-c2')).toBeTruthy();
  });

  it('lists a tournament channel under its own filter, with no opponent panel', () => {
    render(<ChatScreen />);
    expect(screen.getByText('tournament · 1 person')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments' }));
    expect(screen.queryByText('T-c2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open chat with T-c4/ }));
    expect(screen.getByTestId('pane').textContent).toBe('c4');
    expect(screen.queryByLabelText('Opponent')).toBeNull();
  });

  it('prompts, then shows an embedded pane for the selected row', () => {
    render(<ChatScreen />);
    expect(screen.getByText('Pick a conversation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open chat with T-c2/ }));
    const pane = screen.getByTestId('pane');
    expect(pane.textContent).toBe('c2');
    expect(pane.dataset.embedded).toBe('true');
    expect(screen.queryByText('Pick a conversation')).toBeNull();
  });

  it('selects a requested channel once listed and clears the request', () => {
    request.requestedChannelId = 'c2';
    render(<ChatScreen />);
    expect(screen.getByTestId('pane').textContent).toBe('c2');
    expect(request.clearRequestedChannel).toHaveBeenCalled();
    expect(list.refresh).toHaveBeenCalled();
  });

  it('keeps a request pending while the channel is absent', () => {
    request.requestedChannelId = 'zzz';
    render(<ChatScreen />);
    expect(screen.queryByTestId('pane')).toBeNull();
    expect(request.clearRequestedChannel).not.toHaveBeenCalled();
  });

  it('shows the opponent panel for a DM and a match, not a group', () => {
    render(<ChatScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Open chat with T-c1/ }));
    expect(screen.getByLabelText('Opponent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open chat with T-c2/ }));
    expect(screen.queryByLabelText('Opponent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open chat with T-c3/ }));
    expect(screen.getByLabelText('Opponent')).toBeTruthy();
  });

  it('clears the selection when the channel disappears', () => {
    const { rerender } = render(<ChatScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Open chat with T-c2/ }));
    list = { ...list, channels: [ch('c1', 'dm')] };
    rerender(<ChatScreen />);
    expect(screen.queryByTestId('pane')).toBeNull();
  });
});

describe('ChatDock on the chat screen', () => {
  it('renders nothing there and does not consume requests, but does elsewhere', () => {
    request.requestedChannelId = 'c1';
    const { container, rerender } = render(<ChatDock />);
    expect(container.querySelector('.chat-dock')).toBeNull();
    expect(request.clearRequestedChannel).not.toHaveBeenCalled();
    expect(list.refresh).not.toHaveBeenCalled();
    appScreen = 'friends';
    act(() => rerender(<ChatDock />));
    expect(container.querySelector('.chat-dock')).not.toBeNull();
  });
});
