import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

let user: { id: string } | null = { id: 'me' };
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user }) }));

const T = vi.hoisted(() => ({
  listTournaments: vi.fn(),
  createTournament: vi.fn(),
  openRegistration: vi.fn(),
}));
vi.mock('../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../lib/tournaments')>()), ...T }));
const S = vi.hoisted(() => ({ listServerFormats: vi.fn() }));
vi.mock('../../lib/saves', () => S);

import { TournamentsScreen } from '../TournamentsScreen';
import { AppStateProvider, useAppState } from '../../state/AppState';

const ID = '3f2b8a10-5c4d-4e6f-9a1b-0c2d3e4f5a6b';
const PAST = '2020-01-01T00:00:00Z';
const tour = (over = {}) => ({
  id: 't1', organiserId: 'o', title: 'Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 4,
  roundMinutes: 25, maxPlayers: 64, registrationClosesAt: null, state: 'registration', currentRound: 0,
  roundEndsAt: null, createdAt: PAST, entrants: 7, ...over,
});
const fmt = (id: string, size: number) => ({
  id, name: `F-${id}`, versionId: `v-${id}`, format: { base: 'great', composition: { size } },
});

function Probe() {
  const { state } = useAppState();
  return <output data-testid="active">{state.activeTournamentId ?? 'none'}</output>;
}
// Flush the list read so its state update lands inside act.
const mount = async () => {
  render(<AppStateProvider><TournamentsScreen /><Probe /></AppStateProvider>);
  await act(async () => {});
};

beforeEach(() => {
  user = { id: 'me' };
  window.location.hash = '#/play/tournaments';
  T.listTournaments.mockReset().mockResolvedValue([
    tour(),
    tour({ id: 't2', title: 'Late', registrationClosesAt: PAST }),
    tour({ id: 't3', title: 'Going', state: 'running', currentRound: 2 }),
    tour({ id: 't4', title: 'Over', state: 'complete' }),
  ]);
  T.createTournament.mockReset().mockResolvedValue('new1');
  T.openRegistration.mockReset().mockResolvedValue(true);
  S.listServerFormats.mockReset().mockResolvedValue([fmt('a', 6), fmt('b', 3)]);
});
afterEach(cleanup);

describe('browse', () => {
  it('lists cards with state chips from effectiveState, league and counts', async () => {
    await mount();
    expect(await screen.findByRole('button', { name: /Cup/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Late/ }).textContent).toContain('Registration closed');
    expect(screen.getByRole('button', { name: /Cup/ }).textContent).toMatch(/Registration open.*Great 1500.*7/);
    expect(screen.getByRole('button', { name: /Going/ }).textContent).toContain('Round 2 of 4');
    expect(screen.getByRole('button', { name: /Over/ }).textContent).toContain('Finished');
  });

  it('filters with aria-pressed', async () => {
    await mount();
    await screen.findByText('Cup');
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Cup')).toBeNull();
    expect(screen.getByText('Going')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Cup')).toBeTruthy();
    expect(screen.queryByText('Late')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finished' }));
    expect(screen.getByText('Over')).toBeTruthy();
  });

  it('opening a card sets the id and the hash once', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /Cup/ }));
    expect(screen.getByTestId('active').textContent).toBe('t1');
    await waitFor(() => expect(window.location.hash).toBe('#/play/tournaments/t1'));
  });

  it('signed out: browse works, sign-in prompt replaces Host', async () => {
    user = null;
    await mount();
    await screen.findByText('Cup');
    expect(screen.queryByRole('button', { name: 'Host a tournament' })).toBeNull();
    expect(screen.getByText(/Sign in to host/)).toBeTruthy();
  });
});

describe('hash sync', () => {
  it('a fresh visit with an empty hash writes nothing', async () => {
    window.location.hash = '';
    const before = history.length;
    await mount();
    expect(window.location.hash).toBe('');
    expect(history.length).toBe(before);
  });

  it('deep link loads the id; hashchange follows both ways', async () => {
    window.location.hash = `#/play/tournaments/${ID}`;
    await mount();
    expect(screen.getByTestId('active').textContent).toBe(ID);
    expect(screen.getByText(`Tournament ${ID}`)).toBeTruthy();
    const other = ID.replace('3f2b', 'aaaa');
    act(() => {
      window.location.hash = `#/play/tournaments/${other}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTestId('active').textContent).toBe(other);
    act(() => {
      window.location.hash = '#/play/tournaments';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTestId('active').textContent).toBe('none');
    expect(window.location.hash).toBe('#/play/tournaments');
  });

  it('a garbage deep link falls back without an extra history entry', async () => {
    window.location.hash = '#/play/tournaments/garbage';
    const before = history.length;
    await mount();
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(history.length).toBe(before);
  });
});

describe('host', () => {
  async function openSheet() {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Host a tournament' }));
    return screen.findByRole('dialog');
  }
  const fill = async () => {
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My Cup' } });
    await screen.findByRole('option', { name: 'F-a' });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'a' } });
  };

  it('lists only six-Pokémon formats with the documented defaults', async () => {
    await openSheet();
    await screen.findByRole('option', { name: 'F-a' });
    expect(screen.queryByRole('option', { name: 'F-b' })).toBeNull();
    expect((screen.getByLabelText('Rounds') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText(/Round length/) as HTMLInputElement).value).toBe('25');
    expect((screen.getByLabelText('Max players') as HTMLInputElement).value).toBe('64');
    expect((screen.getByLabelText('Open registration now') as HTMLInputElement).checked).toBe(true);
  });

  it('no six-formats: helper text and Create disabled', async () => {
    S.listServerFormats.mockResolvedValue([fmt('b', 3)]);
    await openSheet();
    expect(await screen.findByText(/Formats screen/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates, opens registration, then navigates', async () => {
    await openSheet();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('new1'));
    expect(T.createTournament).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Cup', formatVersionId: 'v-a', rounds: 4, roundMinutes: 25, maxPlayers: 64, closesAt: null,
    }));
    expect(T.openRegistration).toHaveBeenCalledWith('new1');
  });

  it('unticked: does not open registration', async () => {
    await openSheet();
    await fill();
    fireEvent.click(screen.getByLabelText('Open registration now'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('new1'));
    expect(T.openRegistration).not.toHaveBeenCalled();
  });

  it('a server refusal shows in an alert and the sheet stays', async () => {
    T.createTournament.mockRejectedValue(new Error('nope'));
    await openSheet();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('created but not opened: no second create, an Open button retries', async () => {
    T.openRegistration.mockRejectedValueOnce(new Error('boom'));
    await openSheet();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Tournament created but registration could not be opened: boom');
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open registration' }));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('new1'));
    expect(T.createTournament).toHaveBeenCalledTimes(1);
    expect(T.openRegistration).toHaveBeenCalledTimes(2);
  });

  it('Escape closes', async () => {
    await openSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
