import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

const T = vi.hoisted(() => ({
  updateTournament: vi.fn(), openRegistration: vi.fn(), closeRegistration: vi.fn(), cancelTournament: vi.fn(),
  startRound: vi.fn(), settlePairing: vi.fn(), finishTournament: vi.fn(), grantJudge: vi.fn(), revokeJudge: vi.fn(),
  listAudit: vi.fn(),
}));
vi.mock('../../../lib/tournaments', async (orig) => ({ ...(await orig<typeof import('../../../lib/tournaments')>()), ...T }));

import { HostPanel } from '../HostPanel';
import type { Entrant, Pairing, Tournament, TournamentState } from '../../../lib/tournaments';

const NOW = new Date('2026-09-29T12:00:00Z');
const PAST = '2026-09-29T11:00:00Z';
const FUTURE = '2026-09-29T13:00:00Z';
const tour = (over: Partial<Tournament> = {}): Tournament => ({
  id: 't1', organiserId: 'org', title: 'Cup', description: 'D', formatVersionId: 'fv', league: 'great', rounds: 4,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'running', currentRound: 2,
  roundEndsAt: PAST, createdAt: 'x', entrants: 4, ...over,
});
const ent = (id: string, dropped = false): Entrant => ({ playerId: id, seed: 1, dropped, registeredAt: 'x' });
const four = [ent('org'), ent('a'), ent('b'), ent('c')];
const pr = (over: Partial<Pairing> = {}): Pairing => ({
  id: 'p', round: 2, tableNo: 1, playerA: 'a', playerB: 'b', scoreA: null, scoreB: null, state: 'pending',
  reportedBy: null, reportedAt: null, finalAt: null, note: null, ...over,
});
const settled = (id: string, round: number, a: string, b: string | null, sa: number, sb: number): Pairing =>
  pr({ id, round, playerA: a, playerB: b, scoreA: sa, scoreB: sb, state: 'settled', finalAt: PAST });
// Round 1 played: org beat a, b beat c.
const round1 = [settled('r1a', 1, 'org', 'a', 2, 0), settled('r1b', 1, 'b', 'c', 2, 1)];
const names = new Map([['org', 'Olive'], ['a', 'Ash'], ['b', 'Bea'], ['c', 'Cy'], ['j', 'Jo']]);
const changed = vi.fn();

interface O { t?: Partial<Tournament>; state?: TournamentState; entrants?: Entrant[]; pairings?: Pairing[]; judges?: string[]; me?: string | null; isOrganiser?: boolean; now?: Date }
const panel = (o: O = {}) => {
  const t = tour(o.t);
  return <HostPanel tournament={t} state={o.state ?? t.state} entrants={o.entrants ?? four} pairings={o.pairings ?? []} names={names}
    judges={o.judges ?? []} me={o.me === undefined ? 'org' : o.me} isOrganiser={o.isOrganiser ?? false}
    now={o.now ?? NOW} onChanged={changed} />;
};
const mount = (o: O = {}) => render(panel(o));
const asOrg = (o: O = {}) => mount({ ...o, me: 'org', isOrganiser: true });
const asJudge = (o: O = {}) => mount({ ...o, me: 'j', judges: ['j'], isOrganiser: false });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const click = async (name: string | RegExp) => { fireEvent.click(screen.getByRole('button', { name })); await flush(); };
const deferred = <X,>() => { let res!: (v: X) => void; let rej!: (e: Error) => void; const p = new Promise<X>((r, j) => { res = r; rej = j; }); return { p, res, rej }; };

beforeEach(() => {
  for (const f of Object.values(T)) f.mockReset().mockResolvedValue(true);
  T.startRound.mockResolvedValue(3);
  T.listAudit.mockResolvedValue([]);
  changed.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('visibility', () => {
  const states: TournamentState[] = ['draft', 'registration', 'closed', 'running', 'complete', 'cancelled'];
  it.each(states)('organiser and judge see the panel, entrant and stranger see nothing (%s)', (s) => {
    for (const [who, shown] of [['org', true], ['j', true], ['a', false], [null, false]] as const) {
      const { container, unmount } = mount({ state: s, t: { state: s }, me: who, judges: ['j'], isOrganiser: who === 'org' });
      expect(!!screen.queryByRole('region', { name: 'Host controls' })).toBe(shown);
      if (!shown) expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('a judge does not see Judges, Cancel, Finish or Close registration; an organiser does', () => {
    asJudge({ state: 'registration', t: { state: 'registration' } });
    expect(screen.queryByText('Judges')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel tournament' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close registration' })).toBeNull();
    cleanup();
    asOrg({ state: 'registration', t: { state: 'registration' } });
    expect(screen.getByText('Judges')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel tournament' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close registration' })).toBeTruthy();
  });

  it('no cancel once the tournament is over', () => {
    asOrg({ state: 'complete', t: { state: 'complete' } });
    expect(screen.queryByRole('button', { name: 'Cancel tournament' })).toBeNull();
  });
});

describe('lifecycle', () => {
  it('draft offers Open registration', async () => {
    asOrg({ state: 'draft', t: { state: 'draft' } });
    await click('Open registration');
    expect(T.openRegistration).toHaveBeenCalledWith('t1');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('Close registration is disabled with a reason under two players', () => {
    asOrg({ state: 'registration', t: { state: 'registration' }, entrants: [ent('org'), ent('a', true)] });
    expect((screen.getByRole('button', { name: 'Close registration' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('At least two players are needed')).toBeTruthy();
  });

  it('Close registration calls the server with two players', async () => {
    asOrg({ state: 'registration', t: { state: 'registration' }, entrants: [ent('org'), ent('a')] });
    await click('Close registration');
    expect(T.closeRegistration).toHaveBeenCalledWith('t1');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('closed: Start round 1 previews pairings and starts nothing until confirmed', async () => {
    asOrg({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null } });
    await click('Start round 1');
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(T.startRound).not.toHaveBeenCalled();
    expect(within(dlg).getAllByText(/ vs /)).toHaveLength(2);
    await click('Confirm round 1');
    expect(T.startRound).toHaveBeenCalledTimes(1);
    const [id, pairs, force, override] = T.startRound.mock.calls[0];
    expect([id, force, override]).toEqual(['t1', false, false]);
    expect(pairs).toHaveLength(2);
    expect(pairs.flatMap((p: { a: string; b: string | null }) => [p.a, p.b]).sort()).toEqual(['a', 'b', 'c', 'org']);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling the preview starts nothing; dropped players are not paired', async () => {
    asOrg({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null }, entrants: [...four, ent('x', true)] });
    await click('Start round 1');
    expect(screen.queryByText(/Unknown player/)).toBeNull();
    await click('Cancel');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(T.startRound).not.toHaveBeenCalled();
  });

  it('a judge may start a round', async () => {
    asJudge({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null } });
    expect(screen.getByRole('button', { name: 'Start round 1' })).toBeTruthy();
  });

  it('running with everything counted: Progress bracket round starts the next round without force', async () => {
    asOrg({ pairings: [...round1, settled('r2a', 2, 'org', 'b', 2, 0), settled('r2b', 2, 'a', 'c', 2, 0)] });
    await click('Progress bracket round');
    await click('Confirm round 3');
    expect(T.startRound.mock.calls[0].slice(2)).toEqual([false, false]);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('pairs are the Swiss pairing over ALL past games', async () => {
    asOrg({ t: { currentRound: 1 }, pairings: round1 });
    await click('Progress bracket round');
    await click('Confirm round 2');
    const pairs = T.startRound.mock.calls[0][1] as { a: string; b: string }[];
    const key = (p: { a: string; b: string }) => [p.a, p.b].sort().join('-');
    // winners meet winners; nobody replays round 1
    expect(pairs.map(key).sort()).toEqual(['a-c', 'b-org']);
  });

  it('unsettled pairings relabel the button and force after a confirm naming the count', async () => {
    asOrg({ now: new Date('2026-09-29T10:00:00Z'), t: { roundEndsAt: FUTURE }, pairings: [...round1, pr({ id: 'u1' }), pr({ id: 'u2', playerA: 'org', playerB: 'c', tableNo: 2 })] });
    await click('Progress anyway (2 unsettled)');
    expect(T.startRound).not.toHaveBeenCalled();
    await click('Confirm round 3');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 unsettled'));
    expect(T.startRound.mock.calls[0].slice(2)).toEqual([true, false]);
  });

  it('declining the force confirm starts nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    asOrg({ pairings: [...round1, pr()] });
    await click('Progress anyway (1 unsettled)');
    await click('Confirm round 3');
    expect(T.startRound).not.toHaveBeenCalled();
  });

  it('a forced rematch shows the count and needs the tick, which sends override', async () => {
    // two left who already met: the only pairing is a rematch
    asOrg({ t: { currentRound: 1, entrants: 2 }, entrants: [ent('org'), ent('a')], pairings: [settled('r1', 1, 'org', 'a', 2, 0)] });
    await click('Progress bracket round');
    expect(screen.getByText(/1 rematch/)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: 'Confirm round 2' }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow rematches / repeat bye' }));
    expect(confirmBtn.disabled).toBe(false);
    await click('Confirm round 2');
    expect(T.startRound.mock.calls[0].slice(2)).toEqual([false, true]);
  });

  it('no tick box when nothing repeats', async () => {
    asOrg({ t: { currentRound: 1 }, pairings: round1 });
    await click('Progress bracket round');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('last round: Finish tournament once all counted (organiser only), else a wait note', async () => {
    const last = { currentRound: 4 };
    asOrg({ t: last, pairings: [settled('x', 4, 'org', 'a', 2, 0), settled('y', 4, 'b', 'c', 2, 0)] });
    expect(screen.queryByRole('button', { name: /Progress/ })).toBeNull();
    await click('Finish tournament');
    expect(T.finishTournament).toHaveBeenCalledWith('t1');
    cleanup();
    asJudge({ t: last, pairings: [settled('x', 4, 'org', 'a', 2, 0), settled('y', 4, 'b', 'c', 2, 0)] });
    expect(screen.queryByRole('button', { name: 'Finish tournament' })).toBeNull();
    cleanup();
    asOrg({ t: last, pairings: [pr({ round: 4 })] });
    expect(screen.queryByRole('button', { name: 'Finish tournament' })).toBeNull();
    expect(screen.getByText(/last round/i)).toBeTruthy();
  });

  it('shows the round deadline while running', () => {
    asOrg({});
    expect(screen.getByText(/Round 2 ends/)).toBeTruthy();
  });
});

describe('needs attention', () => {
  const live = [
    pr({ id: 'pend', tableNo: 1, playerA: 'a', playerB: 'b' }),
    pr({ id: 'disp', tableNo: 2, playerA: 'org', playerB: 'c', state: 'disputed', reportedBy: 'c', scoreA: 0, scoreB: 2 }),
  ];
  it('appears only when running, after the deadline, with un-counted pairings', () => {
    asOrg({ pairings: [live[0]], t: { roundEndsAt: FUTURE } });
    expect(screen.queryByText('Needs attention')).toBeNull();
    cleanup();
    asOrg({ pairings: [settled('s', 2, 'a', 'b', 2, 0), settled('s2', 2, 'org', 'c', 2, 0)] });
    expect(screen.queryByText('Needs attention')).toBeNull();
    cleanup();
    asOrg({ pairings: live, state: 'complete', t: { state: 'complete' } });
    expect(screen.queryByText('Needs attention')).toBeNull();
    cleanup();
    asOrg({ pairings: live });
    expect(screen.getByText('Needs attention')).toBeTruthy();
  });

  it('a reported result past its dispute window counts and is not listed', () => {
    asOrg({ pairings: [pr({ state: 'reported', scoreA: 2, scoreB: 0, finalAt: PAST })] });
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('lists disputed first and names the reporter', () => {
    asOrg({ pairings: live });
    const rows = screen.getAllByRole('listitem').filter((r) => /Table \d/.test(r.textContent ?? ''));
    expect(rows[0].textContent).toMatch(/Table 2/);
    expect(rows[0].textContent).toMatch(/Disputed.*Cy/);
    expect(rows[1].textContent).toMatch(/No report/);
  });

  it.each([
    ['Award Ash the win', 2, 0], ['Award Bea the win', 0, 2], [/^Double loss/, 0, 0],
  ] as const)('%s settles %i–%i with the optional note', async (label, sa, sb) => {
    asOrg({ pairings: [pr()] });
    fireEvent.change(screen.getByLabelText('Note for table 1'), { target: { value: 'timed out' } });
    await click(label);
    expect(T.settlePairing).toHaveBeenCalledWith('p', sa, sb, 'timed out');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('an empty note is sent as null; double loss confirms first', async () => {
    asOrg({ pairings: [pr()] });
    await click(/^Double loss/);
    expect(window.confirm).toHaveBeenCalled();
    expect(T.settlePairing).toHaveBeenCalledWith('p', 0, 0, null);
    T.settlePairing.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(/^Double loss/);
    expect(T.settlePairing).not.toHaveBeenCalled();
  });

  it('the exact-score picker is oriented to player A / B', async () => {
    asOrg({ pairings: [pr()] });
    fireEvent.change(screen.getByLabelText('Exact result for table 1'), { target: { value: '1,2' } });
    await click(/^Set result/);
    expect(T.settlePairing).toHaveBeenCalledWith('p', 1, 2, null);
  });

  it('hides the buttons on a game the viewer plays and says why', () => {
    asJudge({ pairings: [pr({ playerA: 'j', playerB: 'a' }), pr({ id: 'q', tableNo: 2 })] });
    expect(screen.getAllByRole('button', { name: /^Double loss/ })).toHaveLength(1);
    expect(screen.getByText(/You are playing this game/)).toBeTruthy();
  });

  it('a bye is never listed', () => {
    asOrg({ pairings: [pr({ playerB: null })] });
    expect(screen.queryByText('Needs attention')).toBeNull();
  });
});

describe('judges', () => {
  it('appoints from entrants who are not the organiser or already judges', async () => {
    asOrg({ state: 'registration', t: { state: 'registration' }, judges: ['a'] });
    const sel = screen.getByLabelText('Appoint judge') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Choose a player', 'Bea', 'Cy']);
    fireEvent.change(sel, { target: { value: 'b' } });
    await click('Appoint');
    expect(T.grantJudge).toHaveBeenCalledWith('t1', 'b');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('revokes', async () => {
    asOrg({ state: 'registration', t: { state: 'registration' }, judges: ['a'] });
    await click('Revoke Ash');
    expect(T.revokeJudge).toHaveBeenCalledWith('t1', 'a');
  });

  it('a draft cannot appoint judges yet', () => {
    asOrg({ state: 'draft', t: { state: 'draft' } });
    expect((screen.getByRole('button', { name: 'Appoint' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Open registration before appointing judges')).toBeTruthy();
  });
});

describe('details', () => {
  it('saves only when something changed, sending every field (closes-at must not be cleared)', async () => {
    asOrg({ state: 'registration', t: { state: 'registration', registrationClosesAt: FUTURE } });
    const save = screen.getByRole('button', { name: 'Save details' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Cup' } });
    fireEvent.change(screen.getByLabelText('Max players'), { target: { value: '16' } });
    expect(save.disabled).toBe(false);
    await click('Save details');
    expect(T.updateTournament).toHaveBeenCalledWith('t1', {
      title: 'New Cup', description: 'D', roundMinutes: 25, maxPlayers: 16, closesAt: FUTURE,
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('is hidden once closed or running, and from judges', () => {
    for (const s of ['closed', 'running'] as const) {
      asOrg({ state: s, t: { state: s } });
      expect(screen.queryByLabelText('Title')).toBeNull();
      cleanup();
    }
    asJudge({ state: 'registration', t: { state: 'registration' } });
    expect(screen.queryByLabelText('Title')).toBeNull();
  });
});

describe('audit log', () => {
  const rows = [
    { id: '1', actorId: 'org', action: 'start_round', detail: { round: 2, forced: true, unsettled: 2, override: true }, createdAt: '2026-09-29T11:00:00Z' },
    { id: '2', actorId: 'j', action: 'settle_pairing', detail: { pairing: 'zzz', was_score_a: 2, was_score_b: 0, score_a: 0, score_b: 2, note: 'oops' }, createdAt: '2026-09-29T11:05:00Z' },
    { id: '3', actorId: 'org', action: 'remove_player', detail: { player: 'a', reason: 'no show' }, createdAt: '2026-09-29T11:06:00Z' },
    { id: '4', actorId: 'org', action: 'grant_judge', detail: { user: 'j' }, createdAt: '2026-09-29T11:07:00Z' },
  ];
  it('is collapsed and fetches lazily on expand', async () => {
    T.listAudit.mockResolvedValue(rows);
    asOrg({});
    expect(T.listAudit).not.toHaveBeenCalled();
    await click('Audit log');
    expect(T.listAudit).toHaveBeenCalledWith('t1');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Olive');
    expect(text).toContain('was 2–0');
    expect(text).toContain('forced');
    expect(text).toContain('override');
    expect(text).toContain('no show');
    expect(text).toContain('Ash');
    expect(text).not.toContain('zzz');
  });

  it('keeps the order it is given (newest first from the reader) without trimming', async () => {
    T.listAudit.mockResolvedValue(rows);
    asOrg({});
    await click('Audit log');
    expect(screen.getAllByTestId('audit-row').map((r) => r.textContent?.slice(0, 5))).toEqual(['Olive', 'Jo · ', 'Olive', 'Olive']);
    expect(T.listAudit).toHaveBeenCalledWith('t1');
  });

  it('names the game a settle was for when the pairing is known, else just "a game"', async () => {
    T.listAudit.mockResolvedValue([rows[1]]);
    asOrg({ pairings: [pr({ id: 'zzz', tableNo: 3 })] });
    await click('Audit log');
    expect(screen.getByTestId('audit-row').textContent).toContain('round 2 table 3: Ash vs Bea');
    expect(screen.getByTestId('audit-row').textContent).not.toContain('zzz');
    cleanup();
    asOrg({});
    await click('Audit log');
    expect(screen.getByTestId('audit-row').textContent).toContain('Settled a game');
    expect(screen.getByTestId('audit-row').textContent).not.toContain('round 2 table');
  });

  it('a slow response after collapse does not land', async () => {
    const d = deferred<typeof rows>();
    T.listAudit.mockReturnValue(d.p);
    asOrg({});
    await click('Audit log');
    await click('Audit log');
    await act(async () => { d.res(rows); await d.p; });
    expect(screen.queryByTestId('audit-row')).toBeNull();
  });

  it('a failed read is shown', async () => {
    T.listAudit.mockRejectedValue(new Error('nope'));
    asOrg({});
    await click('Audit log');
    expect(screen.getByRole('alert').textContent).toContain('nope');
  });
});

describe('danger and failures', () => {
  it('Cancel confirms naming the consequence, then cancels', async () => {
    asOrg({});
    await click('Cancel tournament');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/cancel/i));
    expect(T.cancelTournament).toHaveBeenCalledWith('t1');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('declining the confirm cancels nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    asOrg({});
    await click('Cancel tournament');
    expect(T.cancelTournament).not.toHaveBeenCalled();
  });

  it('disables every button while a call is in flight, shows a refusal, and re-enables', async () => {
    const d = deferred<boolean>();
    T.closeRegistration.mockReturnValue(d.p);
    asOrg({ state: 'registration', t: { state: 'registration' } });
    await click('Close registration');
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close registration' }));
    expect(T.closeRegistration).toHaveBeenCalledTimes(1);
    await act(async () => { d.rej(new Error('needs two players')); await d.p.catch(() => {}); });
    expect(screen.getByRole('alert').textContent).toContain('needs two players');
    expect(changed).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Close registration' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a refused round start keeps the dialog open with the error', async () => {
    T.startRound.mockRejectedValue(new Error('every round has been played'));
    asOrg({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null } });
    await click('Start round 1');
    await click('Confirm round 1');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('every round has been played');
  });
});

describe('preview dialog behaviour', () => {
  it('moves focus in, closes on Escape and restores focus', async () => {
    asOrg({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null } });
    const opener = screen.getByRole('button', { name: 'Start round 1' });
    opener.focus();
    await click('Start round 1');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a backdrop press closes it', async () => {
    asOrg({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null } });
    await click('Start round 1');
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape is blocked while a start is in flight', async () => {
    const d = deferred<number>();
    T.startRound.mockReturnValue(d.p);
    asOrg({ state: 'closed', t: { state: 'closed', currentRound: 0, roundEndsAt: null } });
    await click('Start round 1');
    await click('Confirm round 1');
    fireEvent.keyDown(document, { key: 'Escape' });
    await flush();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => { d.res(1); await d.p; });
  });
});

describe('PairingPreview', () => {
  it('a repeated bye alone asks for the tick and says so', async () => {
    const { PairingPreview } = await import('../PairingPreview');
    const onConfirm = vi.fn();
    render(<PairingPreview changed={false} preview={{ round: 3, pairs: [{ a: 'a', b: null }], rematches: 0, repeatBye: true, unsettled: 0 }}
      names={names} busy={false} error={null} onConfirm={onConfirm} onClose={vi.fn()} />);
    expect(screen.getByText(/repeated bye/)).toBeTruthy();
    expect(screen.getByText('Ash has a bye')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm round 3' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});

describe('C1 forced progress counts unfinished games as played', () => {
  // all six pairs met over rounds 1-3; round 3 is unfinished, so only rounds 1-2 count
  const all = [
    settled('r1a', 1, 'org', 'a', 2, 0), settled('r1b', 1, 'b', 'c', 2, 1),
    settled('r2a', 2, 'org', 'b', 2, 0), settled('r2b', 2, 'a', 'c', 2, 0),
    pr({ id: 'r3a', round: 3, tableNo: 1, playerA: 'org', playerB: 'c' }), pr({ id: 'r3b', round: 3, tableNo: 2, playerA: 'a', playerB: 'b' }),
  ];
  it('shows the rematch warning and needs the tick; override only after it', async () => {
    asOrg({ t: { currentRound: 3 }, pairings: all });
    await click('Progress anyway (2 unsettled)');
    expect(screen.getByText(/2 rematches/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm round 4' }) as HTMLButtonElement).disabled).toBe(true);
    expect(T.startRound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow rematches / repeat bye' }));
    await click('Confirm round 4');
    expect(T.startRound.mock.calls[0].slice(2)).toEqual([true, true]);
  });
});

describe('C2 a lapsed deadline still needs close_registration', () => {
  const lapsed = { state: 'closed' as const, t: { state: 'registration' as const, registrationClosesAt: PAST, currentRound: 0, roundEndsAt: null } };
  it('offers Close registration (deadline passed), not Start round 1', async () => {
    asOrg(lapsed);
    expect(screen.queryByRole('button', { name: 'Start round 1' })).toBeNull();
    await click('Close registration (deadline passed)');
    expect(T.closeRegistration).toHaveBeenCalledWith('t1');
  });
  it('still disabled with a reason under two players', () => {
    asOrg({ ...lapsed, entrants: [ent('org')] });
    expect((screen.getByRole('button', { name: 'Close registration (deadline passed)' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('At least two players are needed')).toBeTruthy();
  });
  it('a judge gets neither', () => {
    asJudge(lapsed);
    expect(screen.queryByRole('button', { name: /Close registration|Start round 1/ })).toBeNull();
  });
});

describe('I1 a stale preview is re-checked on Confirm', () => {
  const closed = { state: 'closed' as const, t: { state: 'closed' as const, currentRound: 0, roundEndsAt: null } };
  it('a player dropping while the dialog is open replaces the pairings and needs a second Confirm', async () => {
    const { rerender } = asOrg(closed);
    await click('Start round 1');
    rerender(panel({ me: 'org', isOrganiser: true, ...closed, entrants: [ent('org'), ent('a'), ent('b'), ent('c', true)] }));
    await click('Confirm round 1');
    expect(T.startRound).not.toHaveBeenCalled();
    expect(screen.getByText('The field changed — please review the new pairings')).toBeTruthy();
    expect(screen.getByText(/has a bye/)).toBeTruthy();
    await click('Confirm round 1');
    const pairs = T.startRound.mock.calls[0][1] as { a: string; b: string | null }[];
    expect(pairs.flatMap((p) => [p.a, p.b]).filter(Boolean).sort()).toEqual(['a', 'b', 'org']);
  });
  it('a result settling while the dialog is open drops the force', async () => {
    const open = [...round1, pr({ id: 'u1' }), pr({ id: 'u2', tableNo: 2, playerA: 'org', playerB: 'c' })];
    const { rerender } = asOrg({ pairings: open });
    await click('Progress anyway (2 unsettled)');
    rerender(panel({ me: 'org', isOrganiser: true, pairings: [...round1, settled('u1', 2, 'a', 'b', 2, 0), settled('u2', 2, 'org', 'c', 2, 0)] }));
    await click('Confirm round 3');
    expect(T.startRound).not.toHaveBeenCalled();
    expect(screen.getByText('The field changed — please review the new pairings')).toBeTruthy();
    await click('Confirm round 3');
    expect(T.startRound.mock.calls[0].slice(2)).toEqual([false, false]);
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('an unchanged field goes straight through', async () => {
    asOrg(closed);
    await click('Start round 1');
    await click('Confirm round 1');
    expect(T.startRound).toHaveBeenCalledTimes(1);
  });
});

describe('I2 the clock is read when the host acts', () => {
  it('a report that passed final_at since the last render counts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    asOrg({ pairings: [...round1, pr({ state: 'reported', scoreA: 2, scoreB: 0, finalAt: '2026-09-29T12:00:30Z' }), settled('q', 2, 'org', 'c', 2, 0)] });
    expect(screen.getByRole('button', { name: 'Progress anyway (1 unsettled)' })).toBeTruthy(); // render-time clock
    vi.setSystemTime(new Date('2026-09-29T12:01:00Z'));
    await click('Progress anyway (1 unsettled)');
    expect(screen.queryByText(/still open/)).toBeNull();
    await click('Confirm round 3');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(T.startRound.mock.calls[0].slice(2)).toEqual([false, false]);
    vi.useRealTimers();
  });
});

describe('m3 the note belongs to its own game', () => {
  it('a note typed at one table is not sent for another', async () => {
    asOrg({ pairings: [pr(), pr({ id: 'q', tableNo: 2, playerA: 'c', playerB: 'j' })] });
    fireEvent.change(screen.getByLabelText('Note for table 1'), { target: { value: 'late' } });
    await click('Award Cy the win');
    expect(T.settlePairing).toHaveBeenCalledWith('q', 2, 0, null);
  });
});

describe('A1 games left open by a forced progress can still be settled', () => {
  const future = { roundEndsAt: FUTURE };
  const old = pr({ id: 'old', round: 2, tableNo: 4, playerA: 'a', playerB: 'b' });
  const fresh = [pr({ id: 'n1', round: 3, tableNo: 1, playerA: 'org', playerB: 'c' })];
  it('the old round game is listed with its round, before the new round deadline', async () => {
    asOrg({ now: new Date('2026-09-29T10:00:00Z'), t: { currentRound: 3, ...future }, pairings: [...round1, old, ...fresh] });
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/Round 2 · Table 4: Ash vs Bea/)).toBeTruthy();
    await click('Award Ash the win');
    expect(T.settlePairing).toHaveBeenCalledWith('old', 2, 0, null);
  });
  it('a dispute raised before the deadline is listed', () => {
    asOrg({ now: new Date('2026-09-29T10:00:00Z'), t: future, pairings: [pr({ state: 'disputed', reportedBy: 'a', scoreA: 2, scoreB: 0 })] });
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/Round 2 · Table 1/)).toBeTruthy();
  });
  it('a plain pending game of the current round still waits for the deadline', () => {
    asOrg({ now: new Date('2026-09-29T10:00:00Z'), t: future, pairings: [...round1, pr()] });
    expect(screen.queryByText('Needs attention')).toBeNull();
  });
  it('a settled or counted old game is not listed; own games stay unactionable', () => {
    asJudge({ now: new Date('2026-09-29T10:00:00Z'), t: { currentRound: 3, ...future }, pairings: [...round1, pr({ id: 'mine', round: 2, playerA: 'j', playerB: 'a' })] });
    expect(screen.getByText(/You are playing this game/)).toBeTruthy();
    expect(screen.queryByText(/Round 1 ·/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Double loss/ })).toBeNull();
  });
  it('no list once the tournament is over', () => {
    asOrg({ state: 'complete', t: { state: 'complete', currentRound: 3 }, pairings: [old] });
    expect(screen.queryByText('Needs attention')).toBeNull();
  });
  it('the preview says the games stay open, never "forfeited"', async () => {
    asOrg({ pairings: [...round1, pr()] });
    await click('Progress anyway (1 unsettled)');
    const dlg = screen.getByRole('dialog');
    expect(dlg.textContent).toContain("1 game from round 2 is still open. It doesn't count until a host or judge settles it under Needs attention.");
    expect(dlg.textContent).not.toMatch(/forfeit/i);
  });
});

describe('A2 the override tick does not survive a changed proposal', () => {
  it('is cleared and Confirm is disabled again', async () => {
    const all = [
      settled('r1a', 1, 'org', 'a', 2, 0), settled('r1b', 1, 'b', 'c', 2, 1),
      settled('r2a', 2, 'org', 'b', 2, 0), settled('r2b', 2, 'a', 'c', 2, 0),
    ];
    const r3 = [pr({ id: 'r3a', round: 3, tableNo: 1, playerA: 'org', playerB: 'c' }), pr({ id: 'r3b', round: 3, tableNo: 2, playerA: 'a', playerB: 'b' })];
    const { rerender } = asOrg({ t: { currentRound: 3 }, pairings: [...all, ...r3] });
    await click('Progress anyway (2 unsettled)');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow rematches / repeat bye' }));
    rerender(panel({ me: 'org', isOrganiser: true, t: { currentRound: 3 }, pairings: [...all, settled('r3a', 3, 'org', 'c', 2, 0), r3[1]] }));
    await click('Confirm round 4');
    expect(T.startRound).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox', { name: 'Allow rematches / repeat bye' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Confirm round 4' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
