import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const L = vi.hoisted(() => ({ listPlayerGames: vi.fn(), listPlacements: vi.fn() }));
const P = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn(), loadTrainers: vi.fn() }));
// The real build picker needs the lazily loaded movepool; a "+" test only needs a commit.
vi.mock('../../components/AddPokemonModal', () => ({
  AddPokemonModal: ({ onCommit, onClose }: { onCommit: (c: { ref: string }) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Add a Pokémon to the team"><button onClick={() => { onCommit({ ref: 'azumarill' }); onClose(); }}>Pick Azumarill</button></div>
  ),
}));
vi.mock('../../lib/profile', async (orig) => ({ ...(await orig<typeof import('../../lib/profile')>()), ...P }));
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
  const t1 = { tournamentId: 't1', title: 'Cerulean Cup', league: 'ultra', formatName: 'Open Ultra', teamSize: 6, complete: true };
  L.listPlayerGames.mockResolvedValue([
    { ...t1, round: 2, opponentId: OPP, myRounds: 2, oppRounds: 1, won: true, myRoster: team('azumarill'), oppRoster: null },
    { ...t1, round: 1, opponentId: OPP, myRounds: 0, oppRounds: 2, won: false, myRoster: team('azumarill'), oppRoster: team('registeel') },
    // A three-member format: never part of a profile.
    { tournamentId: 't2', title: 'Pewter Trio', league: 'great', formatName: 'GBL', teamSize: 3, complete: true, round: 1, opponentId: 'x', myRounds: 2, oppRounds: 0, won: true, myRoster: null, oppRoster: null },
  ]);
  L.listPlacements.mockResolvedValue(new Map([['t1', { place: 1, field: 8 }]]));
  P.getProfile.mockResolvedValue({
    displayName: 'Misty', goUsername: 'MistyW', createdAt: '2026-09-01T00:00:00Z', avatar: 'misty', region: 'Cerulean City',
    trainerLevel: 44, xp: 110811553, favoritePokemon: ['politoed', 'lickilicky'], favoriteLeague: 'ultra', faction: 'Cascade', specialty: 'Ultra League Specialist',
  });
  P.saveProfile.mockResolvedValue(undefined);
  P.loadTrainers.mockResolvedValue(['misty', 'red']);
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

  it('shows the trainer card the player filled in', async () => {
    show();
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Misty');
    expect(screen.getByText('Cerulean City')).toBeTruthy();
    expect(screen.getByText('110,811,553')).toBeTruthy();
    expect(screen.getByText('Unranked · Ultra League Specialist')).toBeTruthy();
    expect((screen.getByAltText("Misty's trainer") as HTMLImageElement).src).toBe('https://play.pokemonshowdown.com/sprites/trainers/misty.png');
    expect(await screen.findByText('Politoed')).toBeTruthy();
    expect(screen.getByText('Cascade')).toBeTruthy();
  });

  it('counts Show 6 games only, and groups them by tournament with the six and the podium', async () => {
    show();
    const stats = await screen.findByLabelText('Show 6 arena');
    expect(stats.textContent).toContain('Unique opponents1');
    expect(stats.textContent).toContain('Ranked tournaments1');
    expect(stats.textContent).toContain('Record1–150.0%');
    expect(screen.queryByText('Pewter Trio')).toBeNull();
    expect(screen.getAllByText('Cerulean Cup')).toHaveLength(2); // trophy and bout
    expect(screen.getAllByText('1st of 8')).toHaveLength(2); // trophy and bout
    expect(L.listPlacements).toHaveBeenCalledWith(ID, ['t1']);
    expect((await screen.findAllByText('Azumarill')).length).toBeGreaterThan(0); // species data loads lazily
    expect(await screen.findByText('Registeel')).toBeTruthy();
    expect(screen.getByText('Brock: not shown.')).toBeTruthy();
  });

  it('lets you edit your own card, and saves what you changed', async () => {
    user = { id: ID };
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit profile' });
    fireEvent.change(screen.getByPlaceholderText('North Carolina'), { target: { value: 'Pallet Town' } });
    fireEvent.change(screen.getByPlaceholderText('1–80'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a trainer' }));
    fireEvent.click(await screen.findByRole('option', { name: 'red' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Politoed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(P.saveProfile).toHaveBeenCalled());
    expect(P.saveProfile.mock.calls[0][0]).toBe(ID);
    expect(P.saveProfile.mock.calls[0][1]).toMatchObject({ region: 'Pallet Town', trainerLevel: 50, avatar: 'red', favoritePokemon: ['lickilicky'] });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(screen.getByText('Pallet Town')).toBeTruthy();
  });

  it('adds a favourite from an empty tile with "+", and removes one with ✕, saving each at once', async () => {
    user = { id: ID };
    show();
    expect(await screen.findAllByRole('button', { name: 'Add a favourite Pokémon' })).toHaveLength(1); // only the next free tile
    fireEvent.click(screen.getByRole('button', { name: 'Add a favourite Pokémon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Azumarill' }));
    await waitFor(() => expect(P.saveProfile).toHaveBeenCalledTimes(1));
    expect(P.saveProfile.mock.calls[0][1].favoritePokemon).toEqual(['politoed', 'lickilicky', 'azumarill']);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Politoed' }));
    await waitFor(() => expect(P.saveProfile).toHaveBeenCalledTimes(2));
    expect(P.saveProfile.mock.calls[1][1].favoritePokemon).toEqual(['lickilicky', 'azumarill']);
  });

  it('says so when a favourite could not be saved, and keeps the tile as it was', async () => {
    user = { id: ID };
    P.saveProfile.mockRejectedValueOnce(new Error('network down'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Politoed' }));
    expect((await screen.findByRole('alert')).textContent).toBe('network down');
    expect(screen.getByText('Politoed')).toBeTruthy();
  });

  it('refuses a trainer level out of range without saving', async () => {
    user = { id: ID };
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByPlaceholderText('1–80'), { target: { value: '81' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/1 to 80/);
    expect(P.saveProfile).not.toHaveBeenCalled();
  });

  it('offers no editing on someone else\'s card', async () => {
    show();
    await screen.findByText('Cerulean City');
    expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a favourite Pokémon' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it("lists only your own matches against this player, with both teams", async () => {
    show();
    expect(await screen.findByText(/Your matches against Misty · 1–0/)).toBeTruthy();
    expect(await screen.findByText('Medicham')).toBeTruthy();
    expect(await screen.findByText('Stunfisk (Galarian)')).toBeTruthy();
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
