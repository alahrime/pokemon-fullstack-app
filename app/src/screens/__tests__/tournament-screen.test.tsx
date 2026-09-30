import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));
const V = vi.hoisted(() => ({ view: vi.fn(), reads: vi.fn() }));
vi.mock('../../state/useTournament', () => ({ useTournament: (id: string) => { V.reads(id); return V.view(); } }));
const T = vi.hoisted(() => ({ withdrawFromTournament: vi.fn() }));
vi.mock('../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../lib/tournaments')>()), ...T }));
vi.mock('../../components/tournament/RosterForm', () => ({
  RosterForm: ({ initial }: { initial?: unknown[] }) => <div role="dialog" aria-label="Your roster">form {initial ? 'edit' : 'new'}</div>,
}));

vi.mock('../../components/tournament/MatchupPanel', () => ({
  MatchupPanel: ({ pairing, me, onChanged }: { pairing: { id: string }; me: string; onChanged: () => void }) => (
    <button type="button" onClick={onChanged}>panel {pairing.id} for {me}</button>
  ),
}));

import { TournamentScreen } from '../TournamentScreen';
import { AppStateProvider, useAppState } from '../../state/AppState';
import { LEAGUE_BY_ID, movesFor, SPECIES_BY_ID } from '../../lib/data';

const ID = '3f2b8a10-5c4d-4e6f-9a1b-0c2d3e4f5a6b';
const NOW = new Date('2026-09-29T12:00:00Z');
const mv = movesFor(SPECIES_BY_ID.get('azumarill')!, 'great');
const roster = (ref: string) => Array.from({ length: 6 }, () => ({
  ref, fast: mv.fast.id, charges: mv.charges.map((c) => c.id), cp: 1400, bestBuddy: false,
}));
const tour = (over = {}) => ({
  id: ID, organiserId: 'org', title: 'Autumn Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 4,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'registration', currentRound: 0,
  roundEndsAt: null, createdAt: '2026-09-01T00:00:00Z', entrants: 3, ...over,
});
const entrant = (playerId: string) => ({ playerId, seed: 1, dropped: false, registeredAt: 'x' });
const pairing = (over = {}) => ({
  id: 'p', round: 2, tableNo: 1, playerA: 'me', playerB: 'rival', scoreA: null, scoreB: null, state: 'pending', ...over,
});
const view = (over: Record<string, unknown> = {}) => {
  const t = (over.tournament ?? tour()) as ReturnType<typeof tour>;
  return {
    tournament: t, entrants: [], pairings: [], rosters: new Map(), judges: ['judge'],
    names: new Map([['org', 'Ash'], ['judge', 'Misty'], ['me', 'Me'], ['rival', 'Gary']]),
    format: { name: 'Cup rules', format: {} }, me: 'me', state: t.state, loading: false, error: null,
    refresh: vi.fn(), ...over,
  };
};

function Probe() {
  const { state } = useAppState();
  return <output data-testid="active">{state.activeTournamentId ?? 'none'}</output>;
}
const mount = () => render(<AppStateProvider><TournamentScreen id={ID} /><Probe /></AppStateProvider>);
const ACTIONS = ['Register', 'Edit roster', 'Withdraw', 'View your matchup'];
const shown = () => ACTIONS.filter((a) => screen.queryByRole('button', { name: a }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  user = { id: 'me' };
  window.location.hash = `#/play/tournaments/${ID}`;
  V.view.mockReset().mockReturnValue(view());
  V.reads.mockReset();
  T.withdrawFromTournament.mockReset().mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('header', () => {
  it('shows the title, hosts, chips, format and league', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Autumn Cup' })).toBeTruthy();
    expect(screen.getByText('Hosted by Ash, Misty')).toBeTruthy();
    for (const c of ['Swiss Bracket', 'Round length: 25 minutes', 'Cup rules', LEAGUE_BY_ID.get('great')!.label]) expect(screen.getByText(c)).toBeTruthy();
  });
  it('the back control clears the active tournament', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '← All tournaments' }));
    expect(screen.getByTestId('active').textContent).toBe('none');
  });
});

describe('signed out', () => {
  it('shows only a sign-in prompt and reads nothing', () => {
    user = null;
    V.view.mockReturnValue(view({ tournament: null, me: null, state: null }));
    mount();
    expect(screen.getByText('Sign in to see this tournament.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Autumn Cup' })).toBeNull();
    expect(V.reads).toHaveBeenCalledTimes(1); // the hook itself no-ops without a session (see useTournament tests)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(window.location.hash).toBe('#/account');
  });
});

describe('banner', () => {
  const cases: [string, Record<string, unknown>, string[]][] = [
    ['registration', { state: 'registration', registrationClosesAt: '2027-01-01T00:00:00Z' }, ['Registration open', 'Closes']],
    ['closed', { state: 'closed' }, ['Registration closed', 'Teams of Pokémon Visible']],
    ['a lapsed deadline', { state: 'registration', registrationClosesAt: '2026-09-01T00:00:00Z' }, ['Registration closed']],
    ['running', { state: 'running', currentRound: 2, roundEndsAt: '2026-09-29T12:10:00Z' }, ['Round 2 of 4', 'Time until round end', '00:10:00']],
    ['complete', { state: 'complete' }, ['Finished']],
    ['cancelled', { state: 'cancelled' }, ['Cancelled']],
  ];
  it.each(cases)('%s', (_n, over, texts) => {
    const { state, ...rest } = over;
    const t = tour({ state, ...rest });
    // The hook derives the effective state; the mock does the same.
    const eff = state === 'registration' && t.registrationClosesAt && new Date(t.registrationClosesAt) <= NOW ? 'closed' : state;
    V.view.mockReturnValue(view({ tournament: t, state: eff }));
    mount();
    for (const x of texts) expect(screen.getByText(new RegExp(x))).toBeTruthy();
  });
});

describe('your matchup', () => {
  const running = (over = {}) => view({
    tournament: tour({ state: 'running', currentRound: 2 }), entrants: [entrant('me')], pairings: [pairing()], ...over,
  });
  it('is closed until asked for, then opens with the pairing and refreshes on change', () => {
    const refresh = vi.fn();
    V.view.mockReturnValue(running({ refresh }));
    mount();
    expect(screen.queryByRole('button', { name: /^panel/ })).toBeNull();
    const open = screen.getByRole('button', { name: 'View your matchup' });
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'panel p for me' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide your matchup' }));
    expect(screen.queryByRole('button', { name: /^panel/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'View your matchup' })).toBeTruthy();
  });
  it('stays open, and closable, after the pairing settles', () => {
    V.view.mockReturnValue(running());
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'View your matchup' }));
    V.view.mockReturnValue(running({ pairings: [pairing({ state: 'settled', scoreA: 2, scoreB: 0 })] }));
    rerender(<AppStateProvider><TournamentScreen id={ID} /><Probe /></AppStateProvider>);
    expect(screen.getByRole('button', { name: 'panel p for me' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide your matchup' }));
    expect(screen.queryByRole('button', { name: /^panel/ })).toBeNull();
  });
});

describe('the primary action', () => {
  const inR = (over = {}) => tour({ state: 'registration', ...over });
  const table: [string, Record<string, unknown>, string[]][] = [
    ['not entered, open', { tournament: inR() }, ['Register']],
    ['not entered, open, full', { tournament: inR({ entrants: 8 }) }, []],
    ['entered, open', { tournament: inR(), entrants: [entrant('me')] }, ['Edit roster', 'Withdraw']],
    ['entered, closed', { tournament: tour({ state: 'closed' }), entrants: [entrant('me')] }, []],
    ['entered, running, live pairing', { tournament: tour({ state: 'running', currentRound: 2 }), entrants: [entrant('me')], pairings: [pairing()] }, ['View your matchup']],
    ['entered, running, only an old pairing', { tournament: tour({ state: 'running', currentRound: 2 }), entrants: [entrant('me')], pairings: [pairing({ round: 1 })] }, []],
    ['entered, running, a bye', { tournament: tour({ state: 'running', currentRound: 2 }), entrants: [entrant('me')], pairings: [pairing({ playerB: null })] }, ['View your matchup']],
    ['not entered, running', { tournament: tour({ state: 'running', currentRound: 2 }), pairings: [pairing({ playerA: 'x', playerB: 'y' })] }, []],
    ['host, not entered, open', { tournament: inR({ organiserId: 'me' }) }, ['Register']],
    ['entered, running, pairing already settled', { tournament: tour({ state: 'running', currentRound: 2 }), entrants: [entrant('me')], pairings: [pairing({ state: 'settled' })] }, ['View your matchup']],
    ['finished', { tournament: tour({ state: 'complete' }), entrants: [entrant('me')] }, []],
  ];
  it.each(table)('%s', (_n, over, expected) => {
    const t = over.tournament as ReturnType<typeof tour>;
    V.view.mockReturnValue(view({ ...over, state: t.state }));
    mount();
    expect(shown()).toEqual(expected);
  });
  it('the host sees the host panel, and other players do not', () => {
    V.view.mockReturnValue(view({ tournament: tour({ organiserId: 'me' }) }));
    mount();
    expect(screen.getByLabelText('Host controls')).toBeTruthy();
    cleanup();
    V.view.mockReturnValue(view());
    mount();
    expect(screen.queryByLabelText('Host controls')).toBeNull();
  });
});

describe('rules unavailable', () => {
  it('explains the disabled action instead of leaving it silent', () => {
    V.view.mockReturnValue(view({ format: null }));
    mount();
    expect(screen.getByText("The tournament's rules could not be loaded — retrying…")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    V.view.mockReturnValue(view());
    mount();
    expect(screen.queryByText(/rules could not be loaded/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('a loading id switch shows loading, not "isn\u2019t available"', () => {
    V.view.mockReturnValue(view({ tournament: tour({ id: 'other' }), loading: true }));
    mount();
    expect(screen.getByText('Loading tournament…')).toBeTruthy();
    expect(screen.queryByText("This tournament isn't available.")).toBeNull();
  });
  it('the bracket tab shows the empty state and the other tabs mount their views', () => {
    V.view.mockReturnValue(view({ tournament: tour({ state: 'running', currentRound: 1 }), state: 'running' }));
    mount();
    expect(screen.getByText('No pairings yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Standings' }));
    expect(screen.getByText('No players yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Players' }));
    expect(screen.getByText('No teams yet')).toBeTruthy();
  });
});

describe('registration', () => {
  it('Register opens the form fresh, Edit roster opens it on the current roster', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(screen.getByText('form new')).toBeTruthy();
    cleanup();
    V.view.mockReturnValue(view({ entrants: [entrant('me')], rosters: new Map([['me', roster('azumarill')]]) }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit roster' }));
    expect(screen.getByText('form edit')).toBeTruthy();
  });
  it('Withdraw asks first, then withdraws and refreshes', async () => {
    const refresh = vi.fn();
    V.view.mockReturnValue(view({ entrants: [entrant('me')], refresh }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); });
    expect(T.withdrawFromTournament).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(T.withdrawFromTournament).toHaveBeenCalledWith(ID);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('shows a withdraw refusal', async () => {
    T.withdrawFromTournament.mockRejectedValue(new Error('registration is closed'));
    V.view.mockReturnValue(view({ entrants: [entrant('me')] }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); });
    expect(screen.getByRole('alert').textContent).toContain('registration is closed');
  });
});

describe('share', () => {
  const link = () => `${window.location.origin}/#/play/tournaments/${ID}`;
  it('writes the link to the clipboard and says Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share tournament page' })); });
    expect(writeText).toHaveBeenCalledWith(link());
    expect(screen.getByText('Copied')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText('Copied')).toBeNull();
  });
  it('falls back to showing the link when there is no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share tournament page' })); });
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByText(link())).toBeTruthy();
  });
});

describe('rosters', () => {
  const rosters = () => new Map([['me', roster('azumarill')], ['rival', roster('registeel')]]);
  const entrants = () => [entrant('me'), entrant('rival')];

  it('See/Hide toggles the contents of my own cards', () => {
    V.view.mockReturnValue(view({ rosters: rosters(), entrants: entrants() }));
    mount();
    expect(screen.getAllByText('Azumarill')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Pokémon' }));
    expect(screen.queryByText('Azumarill')).toBeNull();
    expect(screen.getAllByText('Hidden')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'See your Pokémon' }));
    expect(screen.getAllByText('Azumarill')).toHaveLength(6);
  });
  it.each(['registration', 'draft'])('never renders other players’ rosters while %s, even if a stale map has them', (st) => {
    V.view.mockReturnValue(view({ tournament: tour({ state: st }), state: st, rosters: rosters(), entrants: entrants() }));
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Players' }));
    expect(screen.getByText('Teams are hidden until registration closes')).toBeTruthy();
    expect(screen.queryByText('Registeel')).toBeNull();
    expect(screen.getAllByText('Azumarill')).toHaveLength(12); // my card, twice: the roster section and the Players tab
    fireEvent.click(screen.getByRole('button', { name: 'Hide Pokémon' }));
    expect(screen.queryByText('Azumarill')).toBeNull(); // the toggle governs the tab's copy too
    expect(screen.getAllByText('Hidden')).toHaveLength(12);
  });
  it.each(['closed', 'running', 'complete'])('renders other players’ rosters once %s', (st) => {
    V.view.mockReturnValue(view({ tournament: tour({ state: st, currentRound: 1 }), state: st, rosters: rosters(), entrants: entrants() }));
    mount();
    expect(screen.queryByText('Registeel')).toBeNull(); // rosters live in the Players tab only
    fireEvent.click(screen.getByRole('tab', { name: 'Players' }));
    expect(screen.getAllByText('Registeel')).toHaveLength(6);
    expect(screen.getByRole('heading', { name: /Gary/ })).toBeTruthy();
  });
  it('a lapsed deadline reveals them (the state is the effective one)', () => {
    V.view.mockReturnValue(view({ tournament: tour({ registrationClosesAt: '2026-09-01T00:00:00Z' }), state: 'closed', rosters: rosters(), entrants: entrants() }));
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Players' }));
    expect(screen.getAllByText('Registeel')).toHaveLength(6);
  });
});

describe('loading and failure', () => {
  it('says loading, then unavailable, then a failure', () => {
    V.view.mockReturnValue(view({ tournament: null, state: null, loading: true }));
    mount();
    expect(screen.getByText('Loading tournament…')).toBeTruthy();
    cleanup();
    V.view.mockReturnValue(view({ tournament: null, state: null }));
    mount();
    expect(screen.getByText("This tournament isn't available.")).toBeTruthy();
    cleanup();
    V.view.mockReturnValue(view({ tournament: null, state: null, error: 'offline' }));
    mount();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load");
  });
  it('ignores a tournament left over from another id', () => {
    V.view.mockReturnValue(view({ tournament: tour({ id: 'other' }) }));
    mount();
    expect(screen.queryByRole('heading', { name: 'Autumn Cup' })).toBeNull();
  });
});
