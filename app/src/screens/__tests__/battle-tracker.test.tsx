import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { GblSet } from '../../lib/gbl';
import { speciesOf } from '../../lib/data';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const G = vi.hoisted(() => ({
  listMySets: vi.fn(), startSet: vi.fn(), addBattle: vi.fn(), deleteBattle: vi.fn(), deleteSet: vi.fn(), updateSet: vi.fn(),
  meta: vi.fn(), leaderboard: vi.fn(), seasonSets: vi.fn(), getPublic: vi.fn(), setPublic: vi.fn(), updateBattle: vi.fn(),
}));
vi.mock('../../lib/gbl', async (orig) => ({ ...(await orig<typeof import('../../lib/gbl')>()), ...G }));

import { BattleTrackerScreen } from '../BattleTrackerScreen';
import { AppStateProvider } from '../../state/AppState';

const open = () => render(<AppStateProvider><BattleTrackerScreen /></AppStateProvider>);
const now = () => new Date().toISOString();
const closed: GblSet = {
  id: 'old', season: 28, format: 'great', team: [], eloStart: 2580, eloEnd: 2612, startedAt: now(),
  battles: [1, 2, 3, 4, 5].map((i) => ({
    id: `ob${i}`, idx: i, result: i < 5 ? 'win' as const : 'loss' as const, opponents: ['azumarill'],
    opponentMoves: [{ fast: null, charges: [] }], note: null, playedAt: now(),
  })),
};

beforeEach(() => {
  user = { id: 'me' };
  try { localStorage.clear(); } catch { /* jsdom */ }
  G.listMySets.mockResolvedValue([closed]);
  G.updateBattle.mockResolvedValue(undefined);
  G.startSet.mockImplementation(async (p: { season: number; format: string; team: string[]; eloStart: number | null }) =>
    ({ id: 'new', season: p.season, format: p.format, team: p.team, eloStart: p.eloStart, eloEnd: null, startedAt: now(), battles: [] }));
  let k = 0;
  G.addBattle.mockImplementation(async (_set: string, idx: number, result: string | null, opponents: string[],
    extra: { moves?: unknown[]; note?: string | null; playedAt?: string } = {}) =>
    ({ id: `nb${k++}`, idx, result, opponents, opponentMoves: extra.moves ?? [], note: extra.note || null, playedAt: extra.playedAt ?? now() }));
  G.updateSet.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const pips = () => [...document.querySelectorAll('.gt-pip')].map((p) => p.className.replace('gt-pip', '').trim());

describe('BattleTrackerScreen', () => {
  it('asks a signed-out visitor to sign in and reads nothing', () => {
    user = null;
    open();
    expect(screen.getByText('Sign in to keep your GBL notebook.')).toBeTruthy();
    expect(G.listMySets).not.toHaveBeenCalled();
  });

  it('logs a battle with the opponents picked, opening a set at the last Elo written down', async () => {
    open();
    await waitFor(() => expect(document.querySelector('.gt-set-title')!.textContent).toMatch(/^Set 2/));
    const quick = [...document.querySelectorAll<HTMLButtonElement>('.gt-quick-mon')];
    fireEvent.click(quick[0]);
    fireEvent.click(quick[1]);
    const lead = quick[0].title.replace(/^#1 /, '');
    fireEvent.click(screen.getByRole('button', { name: 'Win' }));
    await waitFor(() => expect(G.addBattle).toHaveBeenCalled());
    expect(G.startSet).toHaveBeenCalledWith(expect.objectContaining({ season: 28, format: 'great', eloStart: 2612 }));
    const [, idx, result, opponents] = G.addBattle.mock.calls[0];
    expect([idx, result, opponents.length]).toEqual([1, 'win', 2]);
    expect(opponents[0]).toBeTruthy();
    expect(quick[0].textContent).toContain(lead);
    await waitFor(() => expect(pips()[0]).toBe('is-win'));
    // The slots clear for the next battle.
    expect(document.querySelectorAll('.gt-slot.is-filled')).toHaveLength(0);
  });

  it('logs from the keyboard, closes the set at five and asks for the Elo', async () => {
    open();
    await waitFor(() => expect(document.querySelector('.gt-set-title')).toBeTruthy());
    // Each key waits for the battle before it to land: a result pressed mid-save is ignored, not queued.
    for (const [i, key] of ['w', 'l', 't', 'w'].entries()) {
      fireEvent.keyDown(document.body, { key });
      await waitFor(() => expect(pips()[i]).toMatch(/^is-(win|loss|tie)$/));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Skip outcome' }));
    const panel = await screen.findByRole('region', { name: 'Set 2 complete' });
    expect(pips()).toEqual(['is-win', 'is-loss', 'is-tie', 'is-win', 'is-none']);
    expect((screen.getByRole('button', { name: 'Win' }) as HTMLButtonElement).disabled).toBe(true);
    const input = within(panel).getByRole('textbox');
    fireEvent.change(input, { target: { value: '26a5x0' } });
    expect((input as HTMLInputElement).value).toBe('2650');
    expect(panel.textContent).toContain('+38');
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(G.updateSet).toHaveBeenCalledWith('new', { eloEnd: 2650 }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Set 2 complete' })).toBeNull());
  });

  it('undoes the last battle, and with it a set that is left empty', async () => {
    open();
    await waitFor(() => expect(document.querySelector('.gt-quick-mon')).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLButtonElement>('.gt-quick-mon')!);
    fireEvent.click(screen.getByRole('button', { name: 'Loss' }));
    await waitFor(() => expect(pips()[0]).toBe('is-loss'));
    fireEvent.click(screen.getByRole('button', { name: '↶ Undo' }));
    await waitFor(() => expect(G.deleteSet).toHaveBeenCalledWith('new'));
    expect(G.deleteBattle).toHaveBeenCalledWith('nb0');
    // The opponent comes back to the slot it was logged from.
    await waitFor(() => expect(document.querySelectorAll('.gt-slot.is-filled')).toHaveLength(1));
  });

  it('records the moves seen and a note with the battle', async () => {
    open();
    await waitFor(() => expect(document.querySelector('.gt-quick-mon')).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLButtonElement>('.gt-quick-mon')!);
    // The pick moved the highlight on; selecting the filled lead opens its moves.
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.gt-slot-grid')[1].querySelectorAll<HTMLButtonElement>('.gt-slot')[0]);
    const editor = screen.getByRole('region', { name: /^Moves seen on/ });
    const fast = within(within(editor).getByRole('group', { name: 'Fast move' })).getAllByRole('button')[0];
    fireEvent.click(fast);
    const charged = within(within(editor).getByRole('group', { name: 'Charged moves' })).getAllByRole('button');
    for (const c of charged.slice(0, 3)) fireEvent.click(c);
    fireEvent.change(screen.getByPlaceholderText(/Optional — a read/), { target: { value: '  baited early  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Win' }));
    await waitFor(() => expect(G.addBattle).toHaveBeenCalled());
    const extra = G.addBattle.mock.calls[0][4];
    expect(extra.note).toBe('  baited early  ');
    // One fast; of three charged taps only the last two are kept.
    const sp = speciesOf(G.addBattle.mock.calls[0][3][0])!;
    const name = (id: string) => [...sp.fastMoves, ...sp.chargeMoves].find((m) => m.id === id)!.name;
    const label = (b: HTMLElement) => b.textContent!.trim();
    expect(name(extra.moves[0].fast)).toBe(label(fast));
    expect(extra.moves[0].charges.map(name)).toEqual(charged.slice(1, 3).map(label));
    await waitFor(() => expect((screen.getByPlaceholderText(/Optional — a read/) as HTMLTextAreaElement).value).toBe(''));
  });

  it('opens a logged battle to edit its note and moves', async () => {
    open();
    await screen.findByRole('region', { name: 'Today' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('button.gt-battle')!);
    fireEvent.change(screen.getByPlaceholderText('Only you can see it.'), { target: { value: 'lag on the swap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(G.updateBattle).toHaveBeenCalledWith('ob1', expect.objectContaining({ note: 'lag on the swap' })));
  });

  it('backlogs a past day from the calendar, stamping the set and battle on that day', async () => {
    open();
    await waitFor(() => expect(document.querySelector('.gt-quick-mon')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Today/ }));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    // Yesterday may sit in last month's grid.
    if (!document.querySelector(`[aria-label^="${key}:"]`)) fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(document.querySelector<HTMLButtonElement>(`[aria-label^="${key}:"]`)!);
    expect(document.querySelector('.gt-set-title')!.textContent).toMatch(/^Set 1 /);
    fireEvent.click(screen.getByRole('button', { name: 'Loss' }));
    await waitFor(() => expect(G.addBattle).toHaveBeenCalled());
    const { startedAt } = G.startSet.mock.calls[0][0];
    const { playedAt } = G.addBattle.mock.calls[0][4];
    expect(new Date(startedAt).toDateString()).toBe(yesterday.toDateString());
    expect(playedAt).toBe(startedAt);
    // Today's closed set started after yesterday's moment, so the backlogged set starts with no Elo before it.
    expect(G.startSet.mock.calls[0][0].eloStart).toBeNull();
    // A future day cannot be picked.
    fireEvent.click(screen.getByRole('button', { name: /Backlog/ }));
    const tomorrow = [...document.querySelectorAll<HTMLButtonElement>('.gt-cal-day')].find((d) => d.classList.contains('is-today'))?.nextElementSibling as HTMLButtonElement | null;
    if (tomorrow?.classList.contains('gt-cal-day')) expect(tomorrow.disabled).toBe(true);
  });

  it('stops at GO\'s 25 battles a day', async () => {
    const at = now();
    const day = Array.from({ length: 5 }, (_, s): GblSet => ({
      id: `d${s}`, season: 28, format: 'great', team: [], eloStart: 2500, eloEnd: 2500, startedAt: at,
      battles: Array.from({ length: 5 }, (_, i) => ({ id: `d${s}b${i}`, idx: i + 1, result: 'win' as const, opponents: [], opponentMoves: [], note: null, playedAt: at })),
    }));
    G.listMySets.mockResolvedValue(day);
    open();
    await screen.findByText(/already has 25 battles/);
    expect((screen.getByRole('button', { name: 'Win' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the meta for the format and filters it by bracket', async () => {
    G.meta.mockResolvedValue({
      rows: [
        { ref: 'azumarill', seen: 6, wins: 4, losses: 2, ties: 0, moves: { fast: [{ id: 'BUBBLE', n: 4 }], charges: [{ id: 'ICE_BEAM', n: 3 }], known: 4 } },
        { ref: 'registeel', seen: 2, wins: 1, losses: 1, ties: 0, moves: null },
      ],
      battles: 10, players: 2,
    });
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Meta' }));
    await screen.findByText('60%');
    // Recorded moves as a share of the sightings that recorded any; the rated set where none did.
    const [azu, steel] = [...document.querySelectorAll('.gt-meta-row')];
    expect(azu.querySelector('.gt-meta-moves')!.textContent).toMatch(/Bubble\s*100%.*Ice Beam\s*75%/);
    expect(steel.querySelector('.gt-meta-moves.is-rated')).toBeTruthy();
    expect(G.meta).toHaveBeenLastCalledWith('great', expect.any(Date), null);
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    await waitFor(() => expect(G.meta).toHaveBeenLastCalledWith('great', expect.any(Date), expect.objectContaining({ id: 'expert', lo: 2750 })));
  });

  it('ranks the ladder and opens a player\'s season from it', async () => {
    G.leaderboard.mockResolvedValue([
      { userId: 'p1', name: 'Ash', avatar: null, elo: 3010, peak: 3050, wins: 30, losses: 10, ties: 0, battles: 40, isFriend: true },
      { userId: 'p2', name: 'Gary', avatar: null, elo: 2800, peak: 2800, wins: 5, losses: 5, ties: 0, battles: 10, isFriend: false },
    ]);
    G.seasonSets.mockResolvedValue([{ id: 'x', format: 'great', eloStart: 2990, eloEnd: 3010, startedAt: now(), wins: 3, losses: 2, ties: 0, battles: 5 }]);
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Ladder' }));
    await screen.findByText('Ash');
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }));
    expect(screen.queryByText('Gary')).toBeNull();
    fireEvent.click(screen.getByText('Ash').closest('button')!);
    await waitFor(() => expect(G.seasonSets).toHaveBeenCalledWith('p1', 28));
    await waitFor(() => expect(document.querySelector('.gt-hero-elo')!.textContent).toBe('3,010'));
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
