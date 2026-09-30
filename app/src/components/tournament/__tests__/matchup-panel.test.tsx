import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const T = vi.hoisted(() => ({ reportScore: vi.fn(), confirmScore: vi.fn(), disputeScore: vi.fn() }));
vi.mock('../../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../../lib/tournaments')>()), ...T }));
const M = vi.hoisted(() => ({ opponentFriendCode: vi.fn() }));
vi.mock('../../../lib/matchmaking', () => M);
const C = vi.hoisted(() => ({ openDm: vi.fn() }));
vi.mock('../../../lib/channels', () => C);
const D = vi.hoisted(() => ({ requestChannel: vi.fn() }));
vi.mock('../../../state/ChatDockContext', () => ({ useChatDockRequest: () => D }));

import { MatchupPanel } from '../MatchupPanel';
import type { Pairing, Tournament } from '../../../lib/tournaments';
import { movesFor, SPECIES_BY_ID } from '../../../lib/data';

const NOW = new Date('2026-09-29T12:00:00Z');
const mv = movesFor(SPECIES_BY_ID.get('azumarill')!, 'great');
const roster = (cp: number) => Array.from({ length: 6 }, () => ({
  ref: 'azumarill', fast: mv.fast.id, charges: mv.charges.map((c) => c.id), cp, bestBuddy: false,
}));
const tour = (over = {}): Tournament => ({
  id: 't', organiserId: 'org', title: 'Cup', description: '', formatVersionId: 'fv', league: 'great', rounds: 4,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'running', currentRound: 2,
  roundEndsAt: '2026-09-29T12:10:00Z', createdAt: 'x', entrants: 4, ...over,
});
const pr = (over: Partial<Pairing> = {}): Pairing => ({
  id: 'p', round: 2, tableNo: 3, playerA: 'me', playerB: 'rival', scoreA: null, scoreB: null, state: 'pending',
  reportedBy: null, reportedAt: null, finalAt: null, note: null, ...over,
});
const names = new Map([['me', 'Me'], ['rival', 'Gary'], ['other', 'Brock']]);
const rosters = new Map([['me', roster(1111)], ['rival', roster(1222)], ['other', roster(1333)]]);
const changed = vi.fn();
const mount = (pairing: Pairing, o: { now?: Date; tournament?: Tournament; rosters?: Map<string, ReturnType<typeof roster>> } = {}) =>
  render(<MatchupPanel pairing={pairing} me="me" tournament={o.tournament ?? tour()} rosters={o.rosters ?? rosters}
    names={names} now={o.now ?? NOW} onChanged={changed} />);
const flush = () => act(async () => { await Promise.resolve(); });
const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r; }); return { p, res }; };

beforeEach(() => {
  T.reportScore.mockReset().mockResolvedValue('reported');
  T.confirmScore.mockReset().mockResolvedValue('settled');
  T.disputeScore.mockReset().mockResolvedValue('disputed');
  M.opponentFriendCode.mockReset().mockResolvedValue('1234 5678 9012');
  C.openDm.mockReset().mockResolvedValue('chan');
  D.requestChannel.mockReset();
  changed.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('reporting', () => {
  it.each([
    ['I won 2–0', [2, 0], [0, 2]], ['I won 2–1', [2, 1], [1, 2]], ['I lost 1–2', [1, 2], [2, 1]], ['I lost 0–2', [0, 2], [2, 0]],
  ] as const)('%s maps to stored scores for either side', async (label, asA, asB) => {
    mount(pr());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await flush();
    expect(T.reportScore).toHaveBeenLastCalledWith('p', asA[0], asA[1]);
    expect(changed).toHaveBeenCalledTimes(1);
    cleanup();
    render(<MatchupPanel pairing={pr({ playerA: 'rival', playerB: 'me' })} me="me" tournament={tour()} rosters={rosters}
      names={names} now={NOW} onChanged={changed} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await flush();
    expect(T.reportScore).toHaveBeenLastCalledWith('p', asB[0], asB[1]);
  });
  it('a double click submits once; an error shows and the buttons re-enable', async () => {
    const d = deferred<string>();
    T.reportScore.mockReturnValueOnce(d.p);
    mount(pr());
    await flush();
    const b = screen.getByRole('button', { name: 'I won 2–0' });
    fireEvent.click(b); fireEvent.click(b);
    expect(T.reportScore).toHaveBeenCalledTimes(1);
    await act(async () => { d.res('reported'); await d.p; });
    T.reportScore.mockRejectedValueOnce(new Error('that result is final'));
    fireEvent.click(screen.getByRole('button', { name: 'I won 2–0' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('that result is final');
    expect((screen.getByRole('button', { name: 'I won 2–0' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('reported', () => {
  const fin = '2026-09-29T12:30:00Z';
  const fmt = new Date(fin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  it('by me: shows my score from my side, finality, and lets me correct', async () => {
    mount(pr({ playerA: 'rival', playerB: 'me', scoreA: 0, scoreB: 2, state: 'reported', reportedBy: 'me', finalAt: fin }));
    await flush();
    expect(screen.getByText(`You reported 2–0. Waiting for Gary to confirm — final at ${fmt} unless disputed`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Correct result' }));
    fireEvent.click(screen.getByRole('button', { name: 'I lost 1–2' }));
    await flush();
    expect(T.reportScore).toHaveBeenCalledWith('p', 2, 1);
  });
  it('by the opponent: confirm, and dispute behind window.confirm', async () => {
    mount(pr({ scoreA: 0, scoreB: 2, state: 'reported', reportedBy: 'rival', finalAt: fin }));
    await flush();
    expect(screen.getByText(`Gary reported 0–2 — final at ${fmt} unless disputed`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Correct result' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(T.confirmScore).toHaveBeenCalledWith('p');
    const c = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    await flush();
    expect(T.disputeScore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    await flush();
    expect(c).toHaveBeenCalledTimes(2);
    expect(T.disputeScore).toHaveBeenCalledWith('p');
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('hides every action once final, in both roles', async () => {
    const past = new Date('2026-09-29T12:31:00Z');
    for (const by of ['me', 'rival']) {
      mount(pr({ scoreA: 2, scoreB: 0, state: 'reported', reportedBy: by, finalAt: fin }), { now: past });
      await flush();
      expect(screen.getByText('Final score 2–0')).toBeTruthy();
      for (const n of ['Confirm', 'Dispute', 'Correct result', 'I won 2–0']) expect(screen.queryByRole('button', { name: n })).toBeNull();
      cleanup();
    }
  });
  it('an error on confirm shows and re-enables', async () => {
    T.confirmScore.mockRejectedValueOnce(new Error('that round is over'));
    mount(pr({ scoreA: 2, scoreB: 0, state: 'reported', reportedBy: 'rival', finalAt: fin }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('that round is over');
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('other states', () => {
  it('disputed: no actions', async () => {
    mount(pr({ scoreA: 2, scoreB: 0, state: 'disputed', reportedBy: 'me' }));
    await flush();
    expect(screen.getByText('Disputed — the organiser or a judge will settle it')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm|Dispute|Correct|I won/ })).toBeNull();
  });
  it('settled: the final score from my side, no actions, no friend code', async () => {
    mount(pr({ playerA: 'rival', playerB: 'me', scoreA: 1, scoreB: 2, state: 'settled' }));
    await flush();
    expect(screen.getByText('Final score 2–1')).toBeTruthy();
    expect(screen.getByText('Friend code no longer shared')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Message/ })).toBeNull();
    expect(M.opponentFriendCode).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirm|Dispute|I won/ })).toBeNull();
  });
  it('a bye: text only', async () => {
    mount(pr({ playerB: null }));
    await flush();
    expect(screen.getByText('You have a bye this round.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(M.opponentFriendCode).not.toHaveBeenCalled();
  });
  it('no report controls when the tournament is not running', async () => {
    mount(pr(), { tournament: tour({ state: 'complete' }) });
    await flush();
    expect(screen.queryByRole('button', { name: 'I won 2–0' })).toBeNull();
  });
});

describe('rosters', () => {
  it('yours and theirs, never anyone else; absent opponent roster does not crash', async () => {
    const { container } = mount(pr());
    await flush();
    const cps = [...container.querySelectorAll('.roster-card .numeric')].map((n) => n.textContent);
    expect(new Set(cps)).toEqual(new Set(['CP 1111', 'CP 1222']));
    cleanup();
    mount(pr(), { rosters: new Map([['me', roster(1111)], ['other', roster(1333)]]) });
    await flush();
    expect(screen.getByText('Their team is not visible yet')).toBeTruthy();
  });
});

describe('reaching your opponent', () => {
  it('shows the friend code and copies it', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mount(pr());
    await flush();
    expect(M.opponentFriendCode).toHaveBeenCalledWith('rival');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(write).toHaveBeenCalledWith('1234 5678 9012');
    expect(screen.getByText('Copied')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText('Copied')).toBeNull();
  });
  it('falls back to showing the digits without a clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    mount(pr());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(screen.getByText(/Copy these digits: 1234 5678 9012/)).toBeTruthy();
  });
  it('null code, and a failed lookup', async () => {
    M.opponentFriendCode.mockResolvedValueOnce(null);
    mount(pr());
    await flush();
    expect(screen.getByText('No friend code shared')).toBeTruthy();
    cleanup();
    M.opponentFriendCode.mockRejectedValueOnce(new Error('x'));
    mount(pr());
    await flush();
    expect(screen.getByText("Couldn't load a friend code")).toBeTruthy();
  });
  it('Message opens the DM and requests the channel', async () => {
    mount(pr());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Message Gary' }));
    await flush();
    expect(C.openDm).toHaveBeenCalledWith('rival');
    expect(D.requestChannel).toHaveBeenCalledWith('chan');
  });
  it('a DM failure shows an alert', async () => {
    C.openDm.mockRejectedValueOnce(new Error('nope'));
    mount(pr());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Message Gary' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('nope');
    expect(D.requestChannel).not.toHaveBeenCalled();
  });
  it('a late friend code for the previous opponent never shows beside the new name', async () => {
    const d = deferred<string | null>();
    M.opponentFriendCode.mockReturnValueOnce(d.p);
    const { rerender } = mount(pr());
    rerender(<MatchupPanel pairing={pr({ id: 'p2', playerB: 'other' })} me="me" tournament={tour()} rosters={rosters}
      names={names} now={NOW} onChanged={changed} />);
    await flush();
    expect(screen.getByText(/Brock's friend code/)).toBeTruthy();
    await act(async () => { d.res('OLD CODE'); await d.p; });
    expect(screen.queryByText(/OLD CODE/)).toBeNull();
    expect(screen.getByText(/1234 5678 9012/)).toBeTruthy();
  });
  it('a DM opened for the previous opponent is not requested after the opponent changed', async () => {
    const d = deferred<string>();
    C.openDm.mockReturnValueOnce(d.p);
    const { rerender } = mount(pr());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Message Gary' }));
    rerender(<MatchupPanel pairing={pr({ id: 'p2', playerB: 'other' })} me="me" tournament={tour()} rosters={rosters}
      names={names} now={NOW} onChanged={changed} />);
    await act(async () => { d.res('old-chan'); await d.p; });
    expect(D.requestChannel).not.toHaveBeenCalled();
  });
});
