import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Standings } from '../Standings';
import { PlayersTab } from '../PlayersTab';
import { movesFor, SPECIES_BY_ID } from '../../../lib/data';
import type { Entrant, Pairing, TournamentState } from '../../../lib/tournaments';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const NOW = new Date('2026-09-29T12:00:00Z');
const mv = movesFor(SPECIES_BY_ID.get('azumarill')!, 'great');
const six = (ref: string) => Array.from({ length: 6 }, () => ({ ref, fast: mv.fast.id, charges: mv.charges.map((c) => c.id), cp: 1400, bestBuddy: false }));
const ent = (playerId: string, dropped = false): Entrant => ({ playerId, seed: 1, dropped, registeredAt: 'x' });
const names = new Map([['org', 'Ash'], ['me', 'Me'], ['r', 'Gary'], ['x', 'Xena']]);
const rosters = new Map([['org', six('azumarill')], ['me', six('azumarill')], ['r', six('registeel')], ['x', six('azumarill')]]);
const P = (o: Partial<Pairing>): Pairing => ({
  id: 'p', round: 1, tableNo: 1, playerA: 'me', playerB: 'r', scoreA: 2, scoreB: 0, state: 'settled',
  reportedBy: null, reportedAt: null, finalAt: null, note: null, ...o,
});
const pairings = [
  P({}), P({ round: 2, playerA: 'r', playerB: 'me', scoreA: 2, scoreB: 1 }), P({ round: 3, playerA: 'me', playerB: null }),
  P({ round: 4, playerA: 'me', playerB: 'r', state: 'reported', finalAt: '2026-09-29T13:00:00Z' }),
];
const show = (o: Partial<Parameters<typeof PlayersTab>[0]> & { state?: TournamentState } = {}) => render(
  <PlayersTab entrants={[ent('org'), ent('me'), ent('r'), ent('x', true)]} rosters={rosters} names={names} state="running"
    isHost={false} me="me" organiserId="org" pairings={pairings} now={NOW} {...o} />,
);

describe('PlayersTab', () => {
  it.each(['registration', 'draft'] as const)('%s: only my card and the hidden notice, even with a stale map', (state) => {
    show({ state });
    expect(screen.getByText('Teams are hidden until registration closes')).toBeTruthy();
    expect(screen.queryByText('Registeel')).toBeNull();
    expect(screen.queryByText('Gary')).toBeNull();
    expect(screen.getAllByText('Azumarill')).toHaveLength(6);
  });
  it('after close shows every card with moves and CP', () => {
    show();
    expect(screen.getAllByText('Registeel')).toHaveLength(6);
    expect(screen.getAllByText(mv.fast.name).length).toBe(18);
    expect(screen.getAllByText('CP 1400')).toHaveLength(24);
    expect(screen.queryByText(/hidden until/)).toBeNull();
  });
  it('records come from counted games; a bye is a win; uncounted reports are ignored', () => {
    show();
    // me: beat r 2-0, lost to r, bye -> 2 wins 1 loss; r: 1 win 1 loss
    expect(screen.getByText('Wins: 2 - Losses: 1')).toBeTruthy();
    expect(screen.getByText('Wins: 1 - Losses: 1')).toBeTruthy();
    expect(screen.getAllByText('Wins: 0 - Losses: 0')).toHaveLength(2);
  });
  it('a double loss adds a loss to both chips and matches Standings', () => {
    const games = [P({ scoreA: 0, scoreB: 0 })];
    const { unmount } = show({ pairings: games, entrants: [ent('me'), ent('r')] });
    expect(screen.getAllByText('Wins: 0 - Losses: 1')).toHaveLength(2);
    unmount();
    render(<Standings entrants={[ent('me'), ent('r')]} names={names} pairings={games} now={NOW} />);
    expect(screen.getAllByText('0–1')).toHaveLength(2);
  });
  it('hideMine covers my card only', () => {
    show({ hideMine: true });
    expect(screen.getAllByText('Hidden')).toHaveLength(6);
    expect(screen.getAllByText('Azumarill')).toHaveLength(12);
    expect(screen.getAllByText('Registeel')).toHaveLength(6);
  });
  it('Remove is host only, hidden for the organiser, confirmed, and calls onRemove', () => {
    const onRemove = vi.fn();
    const { unmount } = show({ onRemove });
    expect(screen.queryByRole('button', { name: 'Remove player' })).toBeNull();
    unmount();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    show({ isHost: true, me: 'org', onRemove });
    const btns = screen.getAllByRole('button', { name: 'Remove player' });
    expect(btns).toHaveLength(2); // me and r — not the organiser, not the dropped
    fireEvent.click(btns[0]);
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(btns[0]);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenCalledWith('me');
  });
  it.each(['complete', 'cancelled'] as const)('no Remove once %s', (state) => {
    show({ state, isHost: true, me: 'org', onRemove: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Remove player' })).toBeNull();
  });
  it('the confirm names the consequence and a slow removal blocks a second click', async () => {
    let done!: () => void;
    const onRemove = vi.fn(() => new Promise<void>((r) => { done = r; }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    show({ isHost: true, me: 'org', onRemove });
    const btns = screen.getAllByRole('button', { name: 'Remove player' });
    fireEvent.click(btns[0]);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Any unfinished game this round is forfeited.'));
    expect(btns.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(btns[1]);
    expect(onRemove).toHaveBeenCalledTimes(1);
    await act(async () => { done(); await Promise.resolve(); });
    expect(btns.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    cleanup();
    show({ isHost: true, me: 'org', onRemove, state: 'closed' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove player' })[0]);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('They will be removed from the tournament.'));
  });
  it('strikes a dropped player and says so', () => {
    show();
    expect(screen.getByText('Xena').className).toContain('player-dropped');
    expect(screen.getByText('dropped')).toBeTruthy();
  });
});
