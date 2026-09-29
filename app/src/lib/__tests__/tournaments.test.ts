import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as T from '../tournaments';
import type { Tournament, Pairing } from '../tournaments';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  rows: {} as Record<string, unknown[]>,
  err: null as { message: string } | null,
  calls: [] as { op: string; payload?: unknown }[],
}));
vi.mock('../supabase', () => {
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit', 'in']) {
      q[op] = vi.fn((...a: unknown[]) => { h.calls.push({ op: `${name}.${op}`, payload: a }); return q; });
    }
    q.maybeSingle = vi.fn(async () => ({ data: h.rows[name]?.[0] ?? null, error: h.err }));
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.rows[name] ?? [], error: h.err }).then(res);
    return q;
  };
  return { supabase: { rpc: h.rpc, from: (n: string) => table(n) } };
});

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.rows = {}; h.err = null; h.calls = [];
});

const NOW = new Date('2026-09-29T12:00:00Z');
const PAST = '2026-09-29T11:00:00Z';
const FUTURE = '2026-09-29T13:00:00Z';
const tour = (over: Partial<Tournament>): Tournament => ({
  id: 't', organiserId: 'o', title: 'T', description: '', formatVersionId: 'fv', league: 'great', rounds: 3,
  roundMinutes: 25, maxPlayers: 8, registrationClosesAt: null, state: 'registration', currentRound: 0,
  roundEndsAt: null, createdAt: PAST, entrants: 0, ...over,
});
const pr = (over: Partial<Pairing>): Pairing => ({
  id: 'p', round: 1, tableNo: 1, playerA: 'a', playerB: 'b', scoreA: null, scoreB: null, state: 'pending',
  reportedBy: null, reportedAt: null, finalAt: null, note: null, ...over,
});

describe('effectiveState', () => {
  it('reads a lapsed registration as closed', () => {
    expect(T.effectiveState(tour({ registrationClosesAt: PAST }), NOW)).toBe('closed');
    expect(T.effectiveState(tour({ registrationClosesAt: FUTURE }), NOW)).toBe('registration');
    expect(T.effectiveState(tour({}), NOW)).toBe('registration');
    expect(T.effectiveState(tour({ state: 'running', registrationClosesAt: PAST }), NOW)).toBe('running');
    expect(T.effectiveState(tour({ state: 'draft', registrationClosesAt: PAST }), NOW)).toBe('draft');
  });
});

describe('isCounted / toGames', () => {
  it('counts settled, and reported once final_at has passed', () => {
    expect(T.isCounted(pr({ state: 'settled' }), NOW)).toBe(true);
    expect(T.isCounted(pr({ state: 'reported', finalAt: PAST }), NOW)).toBe(true);
    expect(T.isCounted(pr({ state: 'reported', finalAt: FUTURE }), NOW)).toBe(false);
    expect(T.isCounted(pr({ state: 'reported', finalAt: null }), NOW)).toBe(false);
    expect(T.isCounted(pr({ state: 'pending' }), NOW)).toBe(false);
    expect(T.isCounted(pr({ state: 'disputed', finalAt: PAST }), NOW)).toBe(false);
  });
  it('maps counted pairings to games, byes to b:null, scores as stored', () => {
    const g = T.toGames([
      pr({ state: 'settled', scoreA: 1, scoreB: 2 }),
      pr({ id: 'q', state: 'settled', playerB: null, scoreA: 2, scoreB: 0 }),
      pr({ id: 'r', state: 'pending' }),
    ], NOW);
    expect(g).toEqual([
      { round: 1, a: 'a', b: 'b', scoreA: 1, scoreB: 2 },
      { round: 1, a: 'a', b: null, scoreA: 2, scoreB: 0 },
    ]);
  });
});

describe('rpc wrappers', () => {
  const cases: [string, () => Promise<unknown>, string, Record<string, unknown>][] = [
    ['createTournament', () => T.createTournament({ title: 'x', description: 'd', formatVersionId: 'fv', rounds: 3, roundMinutes: 25, maxPlayers: 8, closesAt: null }),
      'create_tournament', { p_title: 'x', p_description: 'd', p_format_version: 'fv', p_rounds: 3, p_round_minutes: 25, p_max_players: 8, p_closes_at: null }],
    ['updateTournament', () => T.updateTournament('t', { title: 'x', description: 'd', roundMinutes: 25, maxPlayers: 8, closesAt: null }),
      'update_tournament', { p_id: 't', p_title: 'x', p_description: 'd', p_round_minutes: 25, p_max_players: 8, p_closes_at: null }],
    ['openRegistration', () => T.openRegistration('t'), 'open_registration', { p_id: 't' }],
    ['closeRegistration', () => T.closeRegistration('t'), 'close_registration', { p_id: 't' }],
    ['cancelTournament', () => T.cancelTournament('t'), 'cancel_tournament', { p_id: 't' }],
    ['withdrawFromTournament', () => T.withdrawFromTournament('t'), 'withdraw_from_tournament', { p_id: 't' }],
    ['grantJudge', () => T.grantJudge('t', 'u'), 'grant_judge', { p_id: 't', p_user: 'u' }],
    ['revokeJudge', () => T.revokeJudge('t', 'u'), 'revoke_judge', { p_id: 't', p_user: 'u' }],
    ['startRound', () => T.startRound('t', [{ a: 'x', b: null }], true, false), 'start_round',
      { p_tournament: 't', p_pairings: [{ a: 'x', b: null }], p_force: true, p_override: false }],
    ['reportScore', () => T.reportScore('p', 2, 1), 'report_score', { p_pairing: 'p', p_score_a: 2, p_score_b: 1 }],
    ['confirmScore', () => T.confirmScore('p'), 'confirm_score', { p_pairing: 'p' }],
    ['disputeScore', () => T.disputeScore('p'), 'dispute_score', { p_pairing: 'p' }],
    ['settlePairing', () => T.settlePairing('p', 2, 0, 'why'), 'settle_pairing', { p_pairing: 'p', p_score_a: 2, p_score_b: 0, p_note: 'why' }],
    ['dropOut', () => T.dropOut('t'), 'drop_out', { p_id: 't' }],
    ['removePlayer', () => T.removePlayer('t', 'u', 'r'), 'remove_player', { p_id: 't', p_player: 'u', p_reason: 'r' }],
    ['finishTournament', () => T.finishTournament('t'), 'finish_tournament', { p_id: 't' }],
  ];
  it.each(cases)('%s calls %s with the SQL parameter names', async (_n, run, fn, params) => {
    await run();
    expect(h.rpc).toHaveBeenCalledWith(fn, params);
  });
  it.each(cases)('%s throws the server message', async (_n, run) => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'Registration is closed.' } });
    await expect(run()).rejects.toThrow('Registration is closed.');
  });
  it('startRound defaults force and override to false', async () => {
    await T.startRound('t', []);
    expect(h.rpc).toHaveBeenCalledWith('start_round', { p_tournament: 't', p_pairings: [], p_force: false, p_override: false });
  });
  it('registerRoster sends exactly the five keys, never IVs', async () => {
    const m = { ref: 'azumarill', fast: 'f', charges: ['c'], cp: 1400, bestBuddy: false, iv: { a: 0, d: 15, s: 15 } };
    await T.registerRoster('t', [m]);
    expect(h.rpc).toHaveBeenCalledWith('register_roster', {
      p_id: 't', p_roster: [{ ref: 'azumarill', fast: 'f', charges: ['c'], cp: 1400, bestBuddy: false }],
    });
    expect(Object.keys(h.rpc.mock.calls[0][1].p_roster[0]).sort()).toEqual(['bestBuddy', 'charges', 'cp', 'fast', 'ref']);
  });
  it('registerRoster throws the server message', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(T.registerRoster('t', [])).rejects.toThrow('nope');
  });
  it('returns the new id and the round number where the server gives one', async () => {
    h.rpc.mockResolvedValue({ data: 'new-id', error: null });
    await expect(T.createTournament({ title: 'x', description: '', formatVersionId: 'fv', rounds: 1, roundMinutes: 5, maxPlayers: 2, closesAt: null })).resolves.toBe('new-id');
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(T.startRound('t', [])).resolves.toBe(2);
  });
});

describe('readers', () => {
  it('listTournaments maps rows, newest first, limit 100', async () => {
    h.rows.tournaments = [{ id: 't', organiser_id: 'o', title: 'T', description: '', format_version_id: 'fv', league: 'great', rounds: 3, round_minutes: 25, max_players: 8, registration_closes_at: PAST, state: 'closed', current_round: 1, round_ends_at: FUTURE, created_at: PAST, tournament_entrants: [{ count: 5 }] }];
    const [t] = await T.listTournaments();
    expect(t).toEqual(tour({ state: 'closed', registrationClosesAt: PAST, currentRound: 1, roundEndsAt: FUTURE, entrants: 5 }));
    expect(h.calls).toContainEqual({ op: 'tournaments.select', payload: [expect.stringContaining('tournament_entrants(count)')] });
    expect(h.calls).toContainEqual({ op: 'tournaments.order', payload: ['created_at', { ascending: false }] });
    expect(h.calls).toContainEqual({ op: 'tournaments.limit', payload: [100] });
  });
  it('getTournament is null when there is no row', async () => {
    expect(await T.getTournament('x')).toBeNull();
  });
  it('listEntrants and listPairings map snake_case', async () => {
    h.rows.tournament_entrants = [{ player_id: 'p1', seed: 1, dropped: false, registered_at: PAST }];
    h.rows.tournament_pairings = [{ id: 'p', round: 1, table_no: 2, player_a: 'a', player_b: null, score_a: 2, score_b: 0, state: 'settled', reported_by: 'a', reported_at: PAST, final_at: FUTURE, note: null }];
    expect(await T.listEntrants('t')).toEqual([{ playerId: 'p1', seed: 1, dropped: false, registeredAt: PAST }]);
    expect(await T.listPairings('t')).toEqual([pr({ id: 'p', tableNo: 2, playerB: null, scoreA: 2, scoreB: 0, state: 'settled', reportedBy: 'a', reportedAt: PAST, finalAt: FUTURE })]);
  });
  it('listRosters groups by player, empty on no rows', async () => {
    expect((await T.listRosters('t')).size).toBe(0);
    const r = [{ ref: 'a', fast: 'f', charges: ['c'], cp: 1, bestBuddy: false }];
    h.rows.tournament_rosters = [{ player_id: 'p1', roster: r }, { player_id: 'p2', roster: r }];
    const m = await T.listRosters('t');
    expect([...m.keys()]).toEqual(['p1', 'p2']);
    expect(m.get('p1')).toEqual(r);
  });
  it('listJudges and listAudit', async () => {
    h.rows.tournament_roles = [{ user_id: 'j1' }, { user_id: 'j2' }];
    h.rows.tournament_audit = [{ id: 'x', actor_id: null, action: 'settle', detail: { a: 1 }, created_at: PAST }];
    expect(await T.listJudges('t')).toEqual(['j1', 'j2']);
    expect(await T.listAudit('t')).toEqual([{ id: 'x', actorId: null, action: 'settle', detail: { a: 1 }, createdAt: PAST }]);
  });
  it('readers throw on error', async () => {
    h.err = { message: 'denied' };
    await expect(T.listTournaments()).rejects.toThrow('denied');
    await expect(T.listRosters('t')).rejects.toThrow('denied');
  });
});
