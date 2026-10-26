import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { GblSet } from '../../lib/gbl';
import { speciesOf } from '../../lib/data';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const G = vi.hoisted(() => ({
  listMySets: vi.fn(), startSet: vi.fn(), addBattle: vi.fn(), deleteBattle: vi.fn(), deleteSet: vi.fn(), updateSet: vi.fn(),
  meta: vi.fn(), leaderboard: vi.fn(), seasonSets: vi.fn(), getPublic: vi.fn(), setPublic: vi.fn(), updateBattle: vi.fn(),
  listAccounts: vi.fn(), addAccount: vi.fn(), renameAccount: vi.fn(), deleteAccount: vi.fn(),
}));
vi.mock('../../lib/gbl', async (orig) => ({ ...(await orig<typeof import('../../lib/gbl')>()), ...G }));

import { BattleTrackerScreen } from '../BattleTrackerScreen';
import { AppStateProvider } from '../../state/AppState';

const open = () => render(<AppStateProvider><BattleTrackerScreen /></AppStateProvider>);
const now = () => new Date().toISOString();
const closed: GblSet = {
  id: 'old', accountId: null, season: 28, format: 'great', team: [], eloStart: 2580, eloEnd: 2612, startedAt: now(),
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
  G.listAccounts.mockResolvedValue([]);
  G.startSet.mockImplementation(async (p: { season: number; format: string; team: string[]; eloStart: number | null; accountId?: string | null }) =>
    ({ id: 'new', accountId: p.accountId ?? null, season: p.season, format: p.format, team: p.team, eloStart: p.eloStart, eloEnd: null, startedAt: now(), battles: [] }));
  let k = 0;
  G.addBattle.mockImplementation(async (_set: string, idx: number, result: string | null, opponents: string[],
    extra: { moves?: unknown[]; note?: string | null; playedAt?: string } = {}) =>
    ({ id: `nb${k++}`, idx, result, opponents, opponentMoves: extra.moves ?? [], note: extra.note || null, playedAt: extra.playedAt ?? now() }));
  G.updateSet.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** The day's logged battles, as table rows. */
const rows = () => [...document.querySelectorAll<HTMLElement>('.gt-rowgroup > .gt-row')];
/** Open the logging modal from the table's + row. */
async function openAdd() {
  fireEvent.click(await screen.findByRole('button', { name: /^Add battle \d+$/ }));
  await screen.findByRole('dialog');
}

describe('BattleTrackerScreen', () => {
  it('asks a signed-out visitor to sign in and reads nothing', () => {
    user = null;
    open();
    expect(screen.getByText('Sign in to keep your GBL notebook.')).toBeTruthy();
    expect(G.listMySets).not.toHaveBeenCalled();
  });

  it('logs a battle from the + row, opening a set at the last Elo written down', async () => {
    open();
    await openAdd();
    expect(screen.getByRole('dialog', { name: 'Log battle 6' })).toBeTruthy();
    expect(document.querySelector('.gt-set-title')!.textContent).toMatch(/^Set 2/);
    const quick = [...document.querySelectorAll<HTMLButtonElement>('.gt-quick-mon')];
    fireEvent.click(quick[0]);
    fireEvent.click(quick[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Win' }));
    await waitFor(() => expect(G.addBattle).toHaveBeenCalled());
    expect(G.startSet).toHaveBeenCalledWith(expect.objectContaining({ season: 28, format: 'great', eloStart: 2612 }));
    const [, idx, result, opponents] = G.addBattle.mock.calls[0];
    expect([idx, result, opponents.length]).toEqual([1, 'win', 2]);
    // The modal closes and the battle is appended as row 6, after the day's first five.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rows()).toHaveLength(6);
    expect(rows()[5].className).toMatch(/is-win/);
    expect(rows()[5].querySelectorAll('.gt-row-opp .gt-mon')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add battle 7' })).toBeTruthy();
    // The rest of the day's 25 places stand empty below.
    expect(document.querySelectorAll('.gt-row.is-empty')).toHaveLength(25 - 6 - 1);
  });

  it('closes the logging modal on Escape without logging', async () => {
    open();
    await openAdd();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(G.addBattle).not.toHaveBeenCalled();
  });

  it('logs from the keyboard, closes the set at five and asks for the Elo', async () => {
    open();
    // Each key waits for the battle before it to land: a result pressed mid-save is ignored, not queued.
    for (const [i, key] of ['w', 'l', 't', 'w'].entries()) {
      await openAdd();
      fireEvent.keyDown(document.body, { key });
      await waitFor(() => expect(rows()).toHaveLength(6 + i));
    }
    await openAdd();
    fireEvent.click(screen.getByRole('button', { name: 'Skip outcome' }));
    const panel = await screen.findByRole('region', { name: 'Set 2 complete' });
    expect(rows().slice(5).map((r) => r.className.match(/is-(win|loss|tie|none)/)![1])).toEqual(['win', 'loss', 'tie', 'win', 'none']);
    // The next battle waits for the Elo.
    expect(screen.getByRole('button', { name: 'Add battle 11' }).textContent).toMatch(/Set 2's Elo/);
    expect((screen.getByRole('button', { name: 'Add battle 11' }) as HTMLButtonElement).disabled).toBe(true);
    const input = within(panel).getByRole('textbox');
    fireEvent.change(input, { target: { value: '26a5x0' } });
    expect((input as HTMLInputElement).value).toBe('2650');
    expect(panel.textContent).toContain('+38');
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(G.updateSet).toHaveBeenCalledWith('new', { eloEnd: 2650 }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Set 2 complete' })).toBeNull());
    expect((screen.getByRole('button', { name: 'Add battle 11' }) as HTMLButtonElement).disabled).toBe(false);
    // The set's last row carries the Elo it closed on.
    expect(rows()[9].querySelector('.gt-row-elo')!.textContent).toMatch(/\+38 → 2,650/);
  });

  it('undoes the last battle from the table, and with it a set that is left empty', async () => {
    open();
    await openAdd();
    fireEvent.click(document.querySelector<HTMLButtonElement>('.gt-quick-mon')!);
    fireEvent.click(screen.getByRole('button', { name: 'Loss' }));
    await waitFor(() => expect(rows()).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last battle' }));
    await waitFor(() => expect(G.deleteSet).toHaveBeenCalledWith('new'));
    expect(G.deleteBattle).toHaveBeenCalledWith('nb0');
    await waitFor(() => expect(rows()).toHaveLength(5));
    // Its opponent is back in the slot, ready to log again.
    await openAdd();
    expect(document.querySelectorAll('.gt-slot.is-filled')).toHaveLength(1);
  });

  it('records the moves seen and a note with the battle', async () => {
    open();
    await openAdd();
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
    // The note shows on the row, and the next battle starts with a blank one.
    await waitFor(() => expect(rows()[5].querySelector('.gt-row-note')!.textContent).toBe('  baited early  '));
    await openAdd();
    expect((screen.getByPlaceholderText(/Optional — a read/) as HTMLTextAreaElement).value).toBe('');
  });

  it('opens a logged battle\'s row to edit its note and moves', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(rows()[0]);
    fireEvent.change(screen.getByPlaceholderText('Only you can see it.'), { target: { value: 'lag on the swap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(G.updateBattle).toHaveBeenCalledWith('ob1', expect.objectContaining({ note: 'lag on the swap' })));
  });

  it('backlogs a past day from the calendar, stamping the set and battle on that day', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: /Today/ }));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    // Yesterday may sit in last month's grid.
    if (!document.querySelector(`[aria-label^="${key}:"]`)) fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(document.querySelector<HTMLButtonElement>(`[aria-label^="${key}:"]`)!);
    // A new day's table: empty, starting at battle 1.
    expect(rows()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add battle 1' }));
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

  it('stops at GO\'s 25 battles a day: no + row once the table is full', async () => {
    const at = now();
    const day = Array.from({ length: 5 }, (_, s): GblSet => ({
      id: `d${s}`, accountId: null, season: 28, format: 'great', team: [], eloStart: 2500, eloEnd: 2500, startedAt: at,
      battles: Array.from({ length: 5 }, (_, i) => ({ id: `d${s}b${i}`, idx: i + 1, result: 'win' as const, opponents: [], opponentMoves: [], note: null, playedAt: at })),
    }));
    G.listMySets.mockResolvedValue(day);
    open();
    await waitFor(() => expect(rows()).toHaveLength(25));
    expect(screen.queryByRole('button', { name: /^Add battle/ })).toBeNull();
    expect(document.querySelectorAll('.gt-row.is-empty')).toHaveLength(0);
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

  it('logs on the account picked, which has its own sets and Elo', async () => {
    // The alt last played yesterday, so its today is empty.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const altSet: GblSet = {
      ...closed, id: 'alt-old', accountId: 'a1', eloStart: 1900, eloEnd: 1950, startedAt: yesterday,
      battles: closed.battles.map((b) => ({ ...b, id: `alt-${b.id}`, playedAt: yesterday })),
    };
    G.listMySets.mockResolvedValue([closed, altSet]);
    G.listAccounts.mockResolvedValue([{ id: 'a1', name: 'SideTrainer' }]);
    open();
    const alt = await screen.findByRole('button', { name: /SideTrainer/ });
    // The main account shows its own set only.
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(alt);
    await waitFor(() => expect(alt.getAttribute('aria-pressed')).toBe('true'));
    // The alt's own day: none of the main account's battles.
    await waitFor(() => expect(rows()).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Add battle 1' }));
    fireEvent.click(document.querySelector<HTMLButtonElement>('.gt-quick-mon')!);
    fireEvent.click(screen.getByRole('button', { name: 'Win' }));
    await waitFor(() => expect(G.startSet).toHaveBeenCalled());
    // The alt's set starts from the alt's own last Elo, not the main account's 2612.
    expect(G.startSet.mock.calls[0][0]).toMatchObject({ accountId: 'a1', eloStart: 1950 });
    expect(localStorage.getItem('gbl-tracker-account')).toBe('a1');
  });

  it('adds an alt, and says plainly when the server refuses one', async () => {
    G.addAccount.mockRejectedValueOnce(new Error("An alt can't use your main account's trainer name."));
    G.addAccount.mockResolvedValueOnce({ id: 'a2', name: 'Second' });
    open();
    fireEvent.click(await screen.findByRole('button', { name: '＋ Alt account' }));
    const input = screen.getByRole('textbox', { name: "New alt's trainer name" });
    fireEvent.change(input, { target: { value: 'Me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add alt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "An alt can't use your main account's trainer name.");
    fireEvent.change(input, { target: { value: '  Second ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add alt' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Second/, pressed: true })).toBeTruthy());
    expect(G.addAccount).toHaveBeenLastCalledWith('  Second ');
  });

  it('ranks the ladder and opens a player\'s season from it', async () => {
    G.leaderboard.mockResolvedValue([
      { userId: 'p1', accountId: null, accountName: null, name: 'Ash', avatar: null, elo: 3010, peak: 3050, wins: 30, losses: 10, ties: 0, battles: 40, isFriend: true },
      { userId: 'p2', accountId: null, accountName: null, name: 'Gary', avatar: null, elo: 2800, peak: 2800, wins: 5, losses: 5, ties: 0, battles: 10, isFriend: false },
    ]);
    G.seasonSets.mockResolvedValue([{ id: 'x', format: 'great', eloStart: 2990, eloEnd: 3010, startedAt: now(), wins: 3, losses: 2, ties: 0, battles: 5 }]);
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Ladder' }));
    await screen.findByText('Ash');
    expect(screen.queryByText(/alt of/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }));
    expect(screen.queryByText('Gary')).toBeNull();
    fireEvent.click(screen.getByText('Ash').closest('button')!);
    await waitFor(() => expect(G.seasonSets).toHaveBeenCalledWith('p1', 28, null));
    await waitFor(() => expect(document.querySelector('.gt-hero-elo')!.textContent).toBe('3,010'));
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
