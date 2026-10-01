import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const L = vi.hoisted(() => ({ listPlayerGames: vi.fn() }));
vi.mock('../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../lib/tournaments')>()), ...L }));
const R = vi.hoisted(() => ({ listMyRecords: vi.fn() }));
vi.mock('../../lib/records', async (orig) => ({ ...(await orig<typeof import('../../lib/records')>()), ...R }));
const C = vi.hoisted(() => ({ resolveDisplayNames: vi.fn() }));
vi.mock('../../lib/channels', async (orig) => ({ ...(await orig<typeof import('../../lib/channels')>()), ...C }));

import { PlayerScreen } from '../PlayerScreen';
import { AppStateProvider } from '../../state/AppState';

const ID = '3f2b8a10-5c4d-4e6f-9a1b-0c2d3e4f5a6b';
const OPP = '9a1b0c2d-3e4f-4a6b-8f2b-8a105c4d4e6f';
const team = (ref: string) => [{ ref, fast: 'COUNTER', charges: ['ICE_PUNCH'], cp: 1490, bestBuddy: false }];
const show = () => render(<AppStateProvider><PlayerScreen /></AppStateProvider>);

beforeEach(() => {
  user = { id: 'me' };
  window.location.hash = `#/play/players/${ID}`;
  C.resolveDisplayNames.mockResolvedValue(new Map([[ID, 'Misty'], [OPP, 'Brock'], ['me', 'Me']]));
  L.listPlayerGames.mockResolvedValue([
    { tournamentId: 't1', title: 'Cerulean Cup', round: 2, opponentId: OPP, myRounds: 2, oppRounds: 1, won: true, myRoster: team('azumarill'), oppRoster: null },
    { tournamentId: 't1', title: 'Cerulean Cup', round: 1, opponentId: OPP, myRounds: 0, oppRounds: 2, won: false, myRoster: team('azumarill'), oppRoster: team('registeel') },
  ]);
  R.listMyRecords.mockResolvedValue([
    { matchId: 'm1', playedAt: new Date().toISOString(), league: 'great', source: 'queue', ranked: true, opponentId: ID, opponentName: 'Misty',
      myRounds: 2, oppRounds: 0, won: true, myTeam: [{ ref: 'medicham', fast: 'COUNTER', charges: [] }], oppTeam: [{ ref: 'stunfisk_galarian', fast: 'MUD_SHOT', charges: [] }] },
    { matchId: 'm2', playedAt: new Date().toISOString(), league: 'great', source: 'queue', ranked: true, opponentId: 'someone-else', opponentName: 'Other',
      myRounds: 0, oppRounds: 2, won: false, myTeam: [], oppTeam: [] },
  ]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PlayerScreen', () => {
  it('asks a signed-out visitor to sign in and reads nothing', () => {
    user = null;
    show();
    expect(screen.getByText('Sign in to see player profiles.')).toBeTruthy();
    expect(L.listPlayerGames).not.toHaveBeenCalled();
    expect(R.listMyRecords).not.toHaveBeenCalled();
  });

  it('shows the tournament record with both sixes, and says when a roster was not shown', async () => {
    show();
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Misty');
    expect(await screen.findByText(/Tournament games · 1–1/)).toBeTruthy();
    expect(screen.getAllByText('Cerulean Cup')).toHaveLength(2);
    expect(screen.getAllByText('Azumarill').length).toBeGreaterThan(0);
    expect(screen.getByText('Registeel')).toBeTruthy();
    expect(screen.getByText('Brock: not shown.')).toBeTruthy();
  });

  it("lists only your own matches against this player, with both teams", async () => {
    show();
    expect(await screen.findByText(/Your matches against Misty · 1–0/)).toBeTruthy();
    expect(screen.getByText('Medicham')).toBeTruthy();
    expect(screen.getByText('Stunfisk (Galarian)')).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();
  });

  it('on your own profile skips the head-to-head and reads no personal matches', async () => {
    window.location.hash = '#/play/players/me'.replace('me', ID);
    user = { id: ID };
    show();
    expect(await screen.findByText(/This is you/)).toBeTruthy();
    expect(R.listMyRecords).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Your matches')).toBeNull();
  });

  it('opens the tournament and the opponent from a game line', async () => {
    show();
    const opp = (await screen.findAllByRole('button', { name: 'Brock' }))[0];
    fireEvent.click(opp);
    await waitFor(() => expect(window.location.hash).toBe(`#/play/players/${OPP}`));
  });
});
