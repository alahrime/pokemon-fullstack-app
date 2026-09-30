import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Notice } from '../../lib/notifications';
import { AppStateProvider } from '../../state/AppState';
import { ChatDockRequestProvider } from '../../state/ChatDockContext';

const TID = '0b8f3c1e-1111-4222-8333-444455556666';
let state: { notices: Notice[]; fresh: Notice[] };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('../../state/NotificationsContext', () => ({ useNotificationsContext: () => state }));

import { NotificationBell } from '../NotificationBell';
import { Toaster } from '../Toaster';

const n: Notice = {
  id: 'tr:p', kind: 'round', title: 'Cup', detail: 'Round 1: you play Ann',
  target: { screen: 'tournaments', tournamentId: TID },
};
const ui = (
  <AppStateProvider><ChatDockRequestProvider><NotificationBell /><Toaster /></ChatDockRequestProvider></AppStateProvider>
);

beforeEach(() => { window.location.hash = '#/play/matchmaking'; });
afterEach(cleanup);

describe('tournament notices open the tournament', () => {
  it('bell click', () => {
    state = { notices: [n], fresh: [] };
    render(ui);
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Cup/ }));
    expect(window.location.hash).toBe(`#/play/tournaments/${TID}`);
  });
  it('toast click', () => {
    state = { notices: [], fresh: [n] };
    render(ui);
    fireEvent.click(screen.getByText('Cup'));
    expect(window.location.hash).toBe(`#/play/tournaments/${TID}`);
  });
});
