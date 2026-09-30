import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const R = vi.hoisted(() => ({ listMyRecords: vi.fn(), exportRecords: vi.fn() }));
vi.mock('../../lib/records', async (orig) => ({ ...(await orig<typeof import('../../lib/records')>()), ...R }));

import { RecordsScreen } from '../RecordsScreen';
import { AppStateProvider } from '../../state/AppState';

const now = new Date().toISOString();
const row = (o = {}) => ({
  matchId: Math.random().toString(), playedAt: now, league: 'great', source: 'queue', ranked: true,
  opponentId: 'o1', opponentName: 'Ash', myRounds: 2, oppRounds: 0, won: true, ...o,
});
const show = () => render(<AppStateProvider><RecordsScreen /></AppStateProvider>);

beforeEach(() => {
  user = { id: 'me' };
  R.listMyRecords.mockResolvedValue([row(), row({ won: false, myRounds: 0, oppRounds: 2, opponentId: 'o2', opponentName: 'Misty', ranked: false, source: 'offer', league: 'ubl' })]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RecordsScreen', () => {
  it('asks a signed-out visitor to sign in and reads nothing', () => {
    user = null;
    show();
    expect(screen.getByText('Sign in to see your records.')).toBeTruthy();
    expect(R.listMyRecords).not.toHaveBeenCalled();
  });

  it('shows the tiles, and the ranked switch narrows them', async () => {
    show();
    await screen.findByText('Misty');
    expect(screen.getByTestId('win-rate').textContent).toMatch(/^50%/);
    expect(screen.getByText('Opponents').nextSibling?.textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Ranked' }));
    expect(screen.queryByText('Misty')).toBeNull();
    expect(screen.getByTestId('win-rate').textContent).toMatch(/^100%/);
  });

  it('says so when there is nothing to show, and exports what is shown', async () => {
    R.listMyRecords.mockResolvedValue([]);
    show();
    await screen.findByText('No confirmed matches here yet.');
    cleanup();
    R.listMyRecords.mockResolvedValue([row()]);
    show();
    await screen.findByText('Ash');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(R.exportRecords).toHaveBeenCalledTimes(1);
  });
});
