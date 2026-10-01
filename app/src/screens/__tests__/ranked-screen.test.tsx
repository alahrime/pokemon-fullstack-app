import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const R = vi.hoisted(() => ({ listSeasons: vi.fn(), getLeaderboard: vi.fn(), getMyRating: vi.fn() }));
vi.mock('../../lib/ranked', async (orig) => ({ ...(await orig<typeof import('../../lib/ranked')>()), ...R }));

import { RankedScreen } from '../RankedScreen';
import { AppStateProvider } from '../../state/AppState';

const season = (id: string, startsAt: string) => ({ id, startsAt, endsAt: startsAt });
const row = (over = {}) => ({ pos: 1, userId: 'u1', name: 'Ash', rating: 1650, rd: 90, games: 10, wins: 7, ...over });
const show = () => render(<AppStateProvider><RankedScreen /></AppStateProvider>);

beforeEach(() => {
  user = { id: 'me' };
  R.listSeasons.mockResolvedValue([season('s2', '2026-09-01T00:00:00Z'), season('s1', '2026-08-01T00:00:00Z')]);
  R.getLeaderboard.mockResolvedValue([row()]);
  R.getMyRating.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RankedScreen', () => {
  it('asks a signed-out visitor to sign in and reads nothing', () => {
    user = null;
    show();
    expect(screen.getByText('Sign in to see the ladder.')).toBeTruthy();
    expect(R.listSeasons).not.toHaveBeenCalled();
  });

  it('shows the newest season, the three leagues and the board rows', async () => {
    show();
    await screen.findByText('Ash');
    expect(R.getLeaderboard).toHaveBeenCalledWith('s2', 'great');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toHaveLength(3);
    expect(screen.getByText('1650 ± 90')).toBeTruthy();
    expect(screen.getByText('7–3')).toBeTruthy();
    expect((screen.getByLabelText('Season') as HTMLSelectElement).value).toBe('s2');
  });

  it('re-reads for another league', async () => {
    show();
    await screen.findByText('Ash');
    fireEvent.click(screen.getAllByRole('tab')[1]);
    await waitFor(() => expect(R.getLeaderboard).toHaveBeenCalledWith('s2', 'ultra'));
  });

  it('says so when nobody has cleared the gate', async () => {
    R.getLeaderboard.mockResolvedValue([]);
    show();
    await screen.findByText('Nobody has cleared the gate yet.');
  });

  it('shows the viewer a provisional card below the gate, and none once listed', async () => {
    R.getMyRating.mockResolvedValue({ rating: 1540, rd: 210, games: 3, wins: 2 });
    show();
    expect((await screen.findByTestId('provisional')).textContent).toContain('3 of 5 games');
    cleanup();
    R.getMyRating.mockResolvedValue({ rating: 1650, rd: 90, games: 10, wins: 7 });
    show();
    await screen.findByText('Ash');
    expect(screen.queryByTestId('provisional')).toBeNull();
  });

  it('does not say "10 of 5 games" once the game gate is met but the rating is still settling', async () => {
    R.getMyRating.mockResolvedValue({ rating: 1547, rd: 157, games: 10, wins: 6 });
    show();
    const t = (await screen.findByTestId('provisional')).textContent;
    expect(t).toContain('10 games');
    expect(t).not.toContain('of 5');
    expect(t).toContain('rating still settling');
  });
});
