import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { GblBattle, GblSet } from '../../lib/gbl';
import { backdatedAt, localDay } from '../../lib/gbl';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const G = vi.hoisted(() => ({
  listMySets: vi.fn(), startSet: vi.fn(), addBattle: vi.fn(), deleteBattle: vi.fn(), deleteSet: vi.fn(), updateSet: vi.fn(),
  meta: vi.fn(), leaderboard: vi.fn(), seasonSets: vi.fn(), getPublic: vi.fn(), setPublic: vi.fn(), updateBattle: vi.fn(),
  listAccounts: vi.fn(), addAccount: vi.fn(), renameAccount: vi.fn(), deleteAccount: vi.fn(),
  listGblTeams: vi.fn(), saveGblTeam: vi.fn(), deleteGblTeam: vi.fn(),
}));
vi.mock('../../lib/gbl', async (orig) => ({ ...(await orig<typeof import('../../lib/gbl')>()), ...G }));

import { BattleTrackerScreen } from '../BattleTrackerScreen';
import { AppStateProvider } from '../../state/AppState';

const open = () => render(<AppStateProvider><BattleTrackerScreen /></AppStateProvider>);
const count = () => document.querySelector('.gt-table-count')!.textContent;
const battle = (id: string, idx: number, at: string): GblBattle => ({ id, idx, result: 'win', opponents: [], opponentMoves: [], note: null, playedAt: at });
/** `n` battles in sets of five, all at `at`, on `accountId`. */
function day(n: number, at: string, accountId: string | null = null, tag = 'd'): GblSet[] {
  return Array.from({ length: Math.ceil(n / 5) }, (_, s) => ({
    id: `${tag}${s}`, accountId, season: 28, format: 'great', team: [], eloStart: 2500, eloEnd: 2500, startedAt: at,
    battles: Array.from({ length: Math.min(5, n - s * 5) }, (_, i) => battle(`${tag}${s}b${i}`, i + 1, at)),
  }));
}

beforeEach(() => {
  user = { id: 'me' };
  try { localStorage.clear(); } catch { /* jsdom */ }
  G.listMySets.mockResolvedValue([]);
  G.listAccounts.mockResolvedValue([]);
  G.listGblTeams.mockResolvedValue([]);
  G.saveGblTeam.mockImplementation(async (team: string[]) => ({ id: `t-${team.join('-')}`, team }));
  G.deleteGblTeam.mockResolvedValue(undefined);
  G.startSet.mockImplementation(async (p: { season: number; format: string; team: string[]; eloStart: number | null; accountId?: string | null; startedAt?: string }) =>
    ({ id: `new${Math.random()}`, accountId: p.accountId ?? null, season: p.season, format: p.format, team: p.team, eloStart: p.eloStart, eloEnd: null, startedAt: p.startedAt ?? new Date().toISOString(), battles: [] }));
  let k = 0;
  G.addBattle.mockImplementation(async (_s: string, idx: number, result: string | null, opponents: string[], extra: { playedAt?: string } = {}) =>
    ({ id: `nb${k++}`, idx, result, opponents, opponentMoves: [], note: null, playedAt: extra.playedAt ?? new Date().toISOString() }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('day size', () => {
  it('survives a corrupt remembered size', async () => {
    localStorage.setItem('gbl-tracker-day-size', 'null');
    open();
    await waitFor(() => expect(count()).toBe('0/25 battles'));
  });

  it('survives a remembered size that is not one of 25/50/100', async () => {
    localStorage.setItem('gbl-tracker-day-size', JSON.stringify({ [`main:${localDay(new Date())}`]: 7 }));
    open();
    await waitFor(() => expect(count()).toBe('0/25 battles'));
  });

  it('keeps each account\'s pick to itself', async () => {
    G.listAccounts.mockResolvedValue([{ id: 'alt1', name: 'AltOne' }]);
    open();
    await waitFor(() => expect(count()).toBe('0/25 battles'));
    fireEvent.click(screen.getByRole('button', { name: '50' }));
    fireEvent.click(await screen.findByRole('button', { name: /AltOne/ }));
    await waitFor(() => expect(count()).toBe('0/25 battles'));
    fireEvent.click(screen.getByRole('button', { name: /Main/ }));
    await waitFor(() => expect(count()).toBe('0/50 battles'));
  });

  it('keeps a past day\'s pick to that day, and the calendar shows it', async () => {
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(12);
    G.listMySets.mockResolvedValue(day(30, y.toISOString(), null, 'y'));
    open();
    await waitFor(() => expect(count()).toBe('0/25 battles'));
    fireEvent.click(screen.getByRole('button', { name: /Today/ }));
    fireEvent.click(screen.getByRole('gridcell', { name: new RegExp(`^${localDay(y)}`) }));
    await waitFor(() => expect(count()).toBe('30/50 battles'));
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    expect(count()).toBe('30/100 battles');
    fireEvent.click(screen.getByRole('button', { name: 'Back to today' }));
    await waitFor(() => expect(count()).toBe('0/25 battles'));
    fireEvent.click(screen.getByRole('button', { name: /Today/ }));
    expect(screen.getByRole('gridcell', { name: new RegExp(`^${localDay(y)}`) }).getAttribute('aria-label')).toMatch(/30 of 100/);
  });

  it('logs right up to the picked size and no further', async () => {
    const at = new Date().toISOString();
    G.listMySets.mockResolvedValue(day(49, at));
    localStorage.setItem('gbl-tracker-day-size', JSON.stringify({ [`main:${localDay(new Date())}`]: 50 }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add battle 50' }));
    expect(screen.getByRole('dialog', { name: 'Log battle 50' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Win' }));
    await waitFor(() => expect(count()).toBe('50/50 battles'));
    expect(screen.queryByRole('button', { name: /^Add battle/ })).toBeNull();
    // 100 reopens it.
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByRole('button', { name: 'Add battle 51' })).toBeTruthy();
  });

  it('locks a size below what is logged, counting down what to delete as battles are undone', async () => {
    const at = new Date().toISOString();
    G.listMySets.mockResolvedValue(day(52, at));
    G.deleteBattle.mockResolvedValue(undefined);
    G.deleteSet.mockResolvedValue(undefined);
    localStorage.setItem('gbl-tracker-day-size', JSON.stringify({ [`main:${localDay(new Date())}`]: 100 }));
    open();
    await waitFor(() => expect(count()).toBe('52/100 battles'));
    fireEvent.click(screen.getByRole('button', { name: '25' }));
    expect(screen.getByRole('alert').textContent).toMatch(/more than 25.*delete the last 27 with/);
    fireEvent.click(screen.getByRole('button', { name: '50' }));
    expect(screen.getByRole('alert').textContent).toMatch(/more than 50.*delete the last 2 with/);
    expect(count()).toBe('52/100 battles');
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last battle' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/delete the last 1 with/));
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last battle' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // Now it fits, and 50 takes.
    fireEvent.click(screen.getByRole('button', { name: '50' }));
    expect(count()).toBe('50/50 battles');
  });

  it('keeps the pick after an undo takes the day back under 25', async () => {
    const at = new Date().toISOString();
    G.listMySets.mockResolvedValue(day(26, at));
    G.deleteBattle.mockResolvedValue(undefined);
    G.deleteSet.mockResolvedValue(undefined);
    open();
    await waitFor(() => expect(count()).toBe('26/50 battles'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last battle' }));
    // Never explicitly picked 50: the day was only raised to hold 26. Back to 25 it goes.
    await waitFor(() => expect(count()).toBe('25/25 battles'));
  });
});

describe('backdating a big day', () => {
  it('gives each of 100 battles backlogged into a past day its own moment, in order, on that day', () => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    const sets: GblSet[] = [];
    for (let i = 0; i < 100; i++) {
      const at = backdatedAt(sets, d);
      if (i % 5 === 0) sets.push({ id: `s${i}`, accountId: null, season: 28, format: 'great', team: [], eloStart: null, eloEnd: null, startedAt: at, battles: [] });
      sets.at(-1)!.battles.push(battle(`b${i}`, (i % 5) + 1, at));
    }
    const times = sets.flatMap((s) => s.battles.map((b) => b.playedAt));
    expect(new Set(times).size).toBe(100);
    expect(times.every((t) => localDay(new Date(t)) === localDay(d))).toBe(true);
  });

  it('keeps order when filling the rest of a day that was played into the evening', () => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    const evening = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 30).toISOString();
    const sets: GblSet[] = day(25, evening);
    const before = sets.length;
    for (let i = 0; i < 25; i++) {
      const at = backdatedAt(sets, d);
      if (i % 5 === 0) sets.push({ id: `s${i}`, accountId: null, season: 28, format: 'great', team: [], eloStart: null, eloEnd: null, startedAt: at, battles: [] });
      sets.at(-1)!.battles.push(battle(`b${i}`, (i % 5) + 1, at));
    }
    const starts = sets.slice(before).map((s) => s.startedAt);
    // Each backlogged set must start strictly after the one before it, or reloads may reorder them.
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe('saved teams', () => {
  it('says so when saving fails, and keeps no chip', async () => {
    G.saveGblTeam.mockRejectedValue(new Error('network down'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /^Add battle/ }));
    const yours = within(screen.getByRole('group', { name: 'Your team' }));
    fireEvent.click(yours.getAllByRole('button').find((b) => b.classList.contains('gt-slot'))!);
    const q = [...document.querySelectorAll<HTMLButtonElement>('.gt-quick-mon')];
    q.slice(0, 3).forEach((b) => fireEvent.click(b));
    fireEvent.click(yours.getByRole('button', { name: '＋ Save team' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'network down');
    expect(yours.queryAllByRole('button', { name: /^Use / })).toHaveLength(0);
    expect(yours.getByRole('button', { name: '＋ Save team' })).toBeTruthy();
  });

  it('refuses to save a team with the same Pokémon twice, which GO does not allow', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /^Add battle/ }));
    const yours = within(screen.getByRole('group', { name: 'Your team' }));
    fireEvent.click(yours.getAllByRole('button').find((b) => b.classList.contains('gt-slot'))!);
    const q = document.querySelector<HTMLButtonElement>('.gt-quick-mon')!;
    fireEvent.click(q); fireEvent.click(q); fireEvent.click(q);
    expect(yours.queryByRole('button', { name: '＋ Save team' })).toBeNull();
  });

  it('starts the next set with a saved team picked between sets', async () => {
    G.listGblTeams.mockResolvedValue([{ id: 't1', team: ['medicham', 'azumarill', 'registeel'] }]);
    open();
    fireEvent.click(await screen.findByRole('button', { name: /^Add battle/ }));
    const yours = within(screen.getByRole('group', { name: 'Your team' }));
    fireEvent.click(yours.getByRole('button', { name: /^Use Medicham/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Win' }));
    await waitFor(() => expect(G.startSet).toHaveBeenCalledWith(expect.objectContaining({ team: ['medicham', 'azumarill', 'registeel'] })));
  });
});
