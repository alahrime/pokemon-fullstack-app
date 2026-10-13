import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const R = vi.hoisted(() => ({ listMyRecords: vi.fn(), exportRecords: vi.fn() }));
vi.mock('../../lib/records', async (orig) => ({ ...(await orig<typeof import('../../lib/records')>()), ...R }));
const T = vi.hoisted(() => ({ listPlayerGames: vi.fn() }));
vi.mock('../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../lib/tournaments')>()), ...T }));
const C = vi.hoisted(() => ({ resolveDisplayNames: vi.fn() }));
vi.mock('../../lib/channels', async (orig) => ({ ...(await orig<typeof import('../../lib/channels')>()), ...C }));

// The profile is its own screen with its own tests; here it only matters which player Records hands it.
vi.mock('../PlayerScreen', () => ({ PlayerScreen: ({ playerId, embedded }: { playerId: string; embedded: boolean }) => <p>{`profile:${playerId}:${embedded}`}</p> }));

import { RecordsScreen } from '../RecordsScreen';
import { AppStateProvider } from '../../state/AppState';

const now = new Date().toISOString();
const row = (o = {}) => ({
  matchId: Math.random().toString(), playedAt: now, league: 'great', source: 'queue', ranked: true,
  opponentId: 'o1', opponentName: 'Ash', myRounds: 2, oppRounds: 0, won: true,
  myTeam: [{ ref: 'medicham', fast: 'COUNTER', charges: ['ICE_PUNCH'] }], oppTeam: [{ ref: 'azumarill', fast: 'BUBBLE', charges: ['ICE_BEAM'] }], ...o,
});
const open = () => render(<AppStateProvider><RecordsScreen /></AppStateProvider>);
/** Records opens on the profile; the history tests start from Match history. */
const show = () => { const r = open(); fireEvent.click(screen.getByRole('button', { name: 'Match history' })); return r; };

beforeEach(() => {
  user = { id: 'me' };
  T.listPlayerGames.mockResolvedValue([]);
  C.resolveDisplayNames.mockResolvedValue(new Map([['o3', 'Brock']]));
  R.listMyRecords.mockResolvedValue([row(), row({ won: false, myRounds: 0, oppRounds: 2, opponentId: 'o2', opponentName: 'Misty', ranked: false, source: 'offer', league: 'ubl' })]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RecordsScreen', () => {
  it('asks a signed-out visitor to sign in and reads nothing', () => {
    user = null;
    open();
    expect(screen.getByText('Sign in to see your records.')).toBeTruthy();
    expect(R.listMyRecords).not.toHaveBeenCalled();
  });

  it('shows the tiles, and the ranked switch narrows them', async () => {
    show();
    await screen.findByRole('button', { name: 'Misty' });
    expect(screen.getByTestId('win-rate').textContent).toMatch(/^50%/);
    expect(screen.getByText('Opponents').nextSibling?.textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Ranked' }));
    expect(screen.queryByRole('button', { name: 'Misty' })).toBeNull();
    expect(screen.getByTestId('win-rate').textContent).toMatch(/^100%/);
  });

  it('includes tournament games, so a tournament-only player does not see an empty page', async () => {
    R.listMyRecords.mockResolvedValue([]);
    T.listPlayerGames.mockResolvedValue([{
      tournamentId: 't1', title: 'Cup', round: 2, opponentId: 'o3', myRounds: 2, oppRounds: 1, won: true, myRoster: null, oppRoster: null,
      league: 'ultra', formatName: 'Open', teamSize: 6, complete: true, playedAt: now,
    }]);
    show();
    expect(await screen.findByRole('button', { name: 'Brock' })).toBeTruthy();
    expect(T.listPlayerGames).toHaveBeenCalledWith('me');
    expect(screen.queryByText(/^No games here yet/)).toBeNull();
    expect(screen.getByText(/^Ultra.* · ranked$/)).toBeTruthy();
  });

  it('opens on your own profile, and switches between it and the match history', async () => {
    open();
    expect(screen.getByText('profile:me:true')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Match history' }));
    expect(await screen.findByRole('button', { name: 'Ash' })).toBeTruthy();
    expect(screen.queryByText('profile:me:true')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(screen.getByText('profile:me:true')).toBeTruthy();
  });

  it('says so when there is nothing to show, and exports what is shown', async () => {
    R.listMyRecords.mockResolvedValue([]);
    show();
    await screen.findByText(/^No games here yet/);
    cleanup();
    R.listMyRecords.mockResolvedValue([row()]);
    show();
    await screen.findByRole('button', { name: 'Ash' });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(R.exportRecords).toHaveBeenCalledTimes(1);
  });

  it('folds each match\'s two teams under a Pokémon toggle, and links the opponent to their profile', async () => {
    window.location.hash = '#/play/records';
    show();
    const ash = await screen.findByRole('button', { name: 'Ash' });
    expect(screen.getAllByText('Pokémon')).toHaveLength(2);
    expect((await screen.findAllByText('Medicham')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Azumarill')).length).toBeGreaterThan(0);
    fireEvent.click(ash);
    expect(window.location.hash).toMatch(/^#\/play\/players\//);
  });

  it('reads no match history while the Profile view is shown, and reads it once you switch', async () => {
    open();
    await screen.findByText(/^profile:/);
    expect(R.listMyRecords).not.toHaveBeenCalled();
    expect(T.listPlayerGames).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Match history' }));
    await waitFor(() => expect(R.listMyRecords).toHaveBeenCalledTimes(1));
    expect(T.listPlayerGames).toHaveBeenCalledTimes(1);
  });
});
