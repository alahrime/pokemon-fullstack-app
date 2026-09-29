import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { Notice } from '../../lib/notifications';

const patch = vi.fn();
const requestChannel = vi.fn();
let state: { notices: Notice[]; fresh: Notice[] } = { notices: [], fresh: [] };
vi.mock('../../state/useNotifications', async (orig) => ({
  ...(await orig<typeof import('../../state/useNotifications')>()),
  useNotifications: () => state,
}));
vi.mock('../../state/AppState', () => ({ useAppState: () => ({ patch }) }));
vi.mock('../../state/ChatDockContext', () => ({ useChatDockRequest: () => ({ requestChannel }) }));

import { NotificationBell } from '../NotificationBell';
import { Toaster } from '../Toaster';

const msg: Notice = { id: 'ch:1', kind: 'message', title: 'Ann', detail: 'New message', target: { screen: 'chat', channelId: '1' } };
const fr: Notice = { id: 'fr:2', kind: 'friend', title: 'Bob', detail: 'Friend request', target: { screen: 'friends' } };

beforeEach(() => { state = { notices: [], fresh: [] }; patch.mockClear(); requestChannel.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('NotificationBell', () => {
  it('shows a count badge only when there are notices', () => {
    render(<NotificationBell />);
    expect(screen.queryByLabelText('1 notifications')).toBeNull();
    cleanup();
    state = { notices: [msg], fresh: [] };
    render(<NotificationBell />);
    expect(screen.getByLabelText('1 notifications')).toBeTruthy();
  });
  it('empty list says caught up', () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });
  it('item navigates, requests channel for chat, and closes', () => {
    state = { notices: [msg, fr], fresh: [] };
    render(<NotificationBell />);
    const btn = screen.getByRole('button', { name: 'Notifications' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Ann/ }));
    expect(patch).toHaveBeenCalledWith({ screen: 'chat' });
    expect(requestChannel).toHaveBeenCalledWith('1');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('menuitem', { name: /Bob/ }));
    expect(patch).toHaveBeenLastCalledWith({ screen: 'friends' });
    expect(requestChannel).toHaveBeenCalledTimes(1);
  });
  it('Escape and outside mousedown close it', async () => {
    state = { notices: [msg], fresh: [] };
    render(<NotificationBell />);
    const btn = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(btn);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Toaster', () => {
  it('toasts fresh ids in a polite region, expires at 6s, caps at 3, navigates on click', () => {
    vi.useFakeTimers();
    const mk = (i: number): Notice => ({ id: `ch:${i}`, kind: 'message', title: `T${i}`, detail: 'd', target: { screen: 'chat', channelId: `${i}` } });
    state = { notices: [], fresh: [mk(1)] };
    const { rerender, container } = render(<Toaster />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    state = { notices: [], fresh: [mk(2), mk(3), mk(4)] };
    rerender(<Toaster />);
    expect(screen.getAllByRole('status')).toHaveLength(3);
    fireEvent.click(screen.getByText('T4'));
    expect(patch).toHaveBeenCalledWith({ screen: 'chat' });
    expect(requestChannel).toHaveBeenCalledWith('4');
    act(() => { vi.advanceTimersByTime(6001); });
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});
