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

vi.mock('../TournamentScreen', () => ({
  TournamentScreen: ({ id }: { id: string }) => {
    const { patch } = useAppState();
    return (
      <div>
        <button type="button" onClick={() => patch({ activeTournamentId: null })}>← All tournaments</button>
        <p>Tournament {id}</p>
      </div>
    );
  },
}));
import { TournamentsScreen } from '../TournamentsScreen';
import { AppStateProvider, useAppState } from '../../state/AppState';

const ID = '3f2b8a10-5c4d-4e6f-9a1b-0c2d3e4f5a6b';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEW = uuid(99);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const PAST = '2020-01-01T00:00:00Z';
const tour = (over = {}) => ({
  id: uuid(1), organiserId: 'o', title: 'Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 4,
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
    tour({ id: uuid(2), title: 'Late', registrationClosesAt: PAST }),
    tour({ id: uuid(3), title: 'Going', state: 'running', currentRound: 2 }),
    tour({ id: uuid(4), title: 'Over', state: 'complete' }),
  ]);
  T.createTournament.mockReset().mockResolvedValue(NEW);
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
    expect(screen.getByText('Late')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Cup')).toBeTruthy();
    expect(screen.queryByText('Late')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finished' }));
    expect(screen.getByText('Over')).toBeTruthy();
  });

  it('opening a card sets the id and the hash once', async () => {
    await mount();
    const before = history.length;
    fireEvent.click(await screen.findByRole('button', { name: /Cup/ }));
    await flush();
    expect(screen.getByTestId('active').textContent).toBe(uuid(1));
    expect(window.location.hash).toBe(`#/play/tournaments/${uuid(1)}`);
    expect(history.length).toBe(before + 1);
  });

  it('signed out: no read, a sign-in prompt instead of list or empty state', async () => {
    user = null;
    await mount();
    expect(screen.getByText('Sign in to see and host tournaments.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Host a tournament' })).toBeNull();
    expect(screen.queryByText(/No tournaments/)).toBeNull();
    expect(T.listTournaments).not.toHaveBeenCalled();
  });

  it('shows a loading line until the first read resolves', async () => {
    let done!: (v: unknown[]) => void;
    T.listTournaments.mockReturnValue(new Promise((r) => (done = r)));
    await mount();
    expect(screen.getByText('Loading tournaments…')).toBeTruthy();
    await act(async () => done([tour()]));
    expect(screen.queryByText('Loading tournaments…')).toBeNull();
    expect(screen.getByText('Cup')).toBeTruthy();
  });

  it('signing in reads at once', async () => {
    user = null;
    const { rerender } = render(<AppStateProvider><TournamentsScreen /><Probe /></AppStateProvider>);
    expect(T.listTournaments).not.toHaveBeenCalled();
    user = { id: 'me' };
    rerender(<AppStateProvider><TournamentsScreen /><Probe /></AppStateProvider>);
    expect(await screen.findByText('Cup')).toBeTruthy();
    expect(T.listTournaments).toHaveBeenCalledTimes(1);
  });

  it('an open tournament does not keep the list polling', async () => {
    window.location.hash = `#/play/tournaments/${ID}`;
    await mount();
    expect(T.listTournaments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /All tournaments/ }));
    expect(await screen.findByText('Cup')).toBeTruthy();
    expect(T.listTournaments).toHaveBeenCalledTimes(1);
  });

  it('the open-tournament view has a way back to Browse', async () => {
    window.location.hash = `#/play/tournaments/${ID}`;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /All tournaments/ }));
    expect(screen.getByTestId('active').textContent).toBe('none');
    expect(await screen.findByText('Cup')).toBeTruthy();
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
    await act(async () => {
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
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(NEW));
    await flush();
    expect(screen.getByTestId('active').textContent).toBe(NEW);
    expect(window.location.hash).toBe(`#/play/tournaments/${NEW}`);
    expect(T.createTournament).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Cup', formatVersionId: 'v-a', rounds: 4, roundMinutes: 25, maxPlayers: 64, closesAt: null,
    }));
    expect(T.openRegistration).toHaveBeenCalledWith(NEW);
  });

  it('unticked: does not open registration', async () => {
    await openSheet();
    await fill();
    fireEvent.click(screen.getByLabelText('Open registration now'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(NEW));
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
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(NEW));
    expect(T.createTournament).toHaveBeenCalledTimes(1);
    expect(T.openRegistration).toHaveBeenCalledTimes(2);
  });

  it('Escape closes before anything is created', async () => {
    await openSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('active').textContent).toBe('none');
  });

  it('closing after created-but-not-opened lands on the tournament; no second create', async () => {
    T.openRegistration.mockRejectedValueOnce(new Error('boom'));
    await openSheet();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('alert');
    fireEvent.keyDown(document, { key: 'Escape' });
    await flush();
    expect(screen.getByTestId('active').textContent).toBe(NEW);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(T.createTournament).toHaveBeenCalledTimes(1);
  });

  it('leaving mid-flight does nothing', async () => {
    let done!: (v: string) => void;
    T.createTournament.mockReturnValue(new Promise((r) => (done = r)));
    await openSheet();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => done(NEW));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(NEW));
  });
});
