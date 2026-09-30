import { supabase } from './supabase';
import type { LeagueId } from './types';
import type { Game, Pairing as SwissPairing } from '../tournament/swiss';
import type { RosterMember } from '../tournament/roster';
import type { Format } from '../rules';

export type TournamentState = 'draft' | 'registration' | 'closed' | 'running' | 'complete' | 'cancelled';
export type PairingState = 'pending' | 'reported' | 'disputed' | 'settled';

export interface Tournament {
  id: string; organiserId: string; title: string; description: string; formatVersionId: string;
  league: LeagueId; rounds: number; roundMinutes: number; maxPlayers: number;
  registrationClosesAt: string | null; state: TournamentState; currentRound: number;
  roundEndsAt: string | null; createdAt: string;
  /** Registered players (count embed, players still in). */
  entrants: number;
}
export interface Entrant { playerId: string; seed: number; dropped: boolean; registeredAt: string }
export interface Pairing {
  id: string; /** Set by `myTournamentActivity`, which spans tournaments. */ tournamentId?: string; round: number; tableNo: number; playerA: string; playerB: string | null;
  scoreA: number | null; scoreB: number | null; state: PairingState; reportedBy: string | null;
  reportedAt: string | null; finalAt: string | null; note: string | null;
}
export interface AuditRow { id: string; actorId: string | null; action: string; detail: unknown; createdAt: string }

/** Server truth (RLS): other players' rosters exist for us only once registration has closed. */
export const ROSTERS_VISIBLE: readonly TournamentState[] = ['closed', 'running', 'complete'];

/** Mirrors the server: a lapsed registration deadline reads as closed. */
export function effectiveState(t: Tournament, now: Date): TournamentState {
  return t.state === 'registration' && t.registrationClosesAt && new Date(t.registrationClosesAt) <= now
    ? 'closed' : t.state;
}
/** A matchup the viewer can still play or answer for: this round's, not a bye, not yet settled. Used for both the page action and the poll rate. */
export function isLivePairing(p: Pairing, t: Pick<Tournament, 'currentRound'>, me: string | null): boolean {
  return !!me && p.round === t.currentRound && p.playerB !== null && p.state !== 'settled' && (p.playerA === me || p.playerB === me);
}
/** Mirrors `_pairing_counts`: settled, or reported and past its dispute window. */
export function isCounted(p: Pairing, now: Date): boolean {
  return p.state === 'settled' || (p.state === 'reported' && !!p.finalAt && new Date(p.finalAt) <= now);
}
/** Scores stay as stored: oriented to playerA/playerB. */
export function toGames(pairings: readonly Pairing[], now: Date): Game[] {
  return pairings.filter((p) => isCounted(p, now)).map((p) => ({
    round: p.round, a: p.playerA, b: p.playerB, scoreA: p.scoreA ?? 0, scoreB: p.scoreB ?? 0,
  }));
}

// ── RPC wrappers ──
async function call<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface TournamentInput {
  title: string; description: string; formatVersionId: string; rounds: number;
  roundMinutes: number; maxPlayers: number; closesAt: string | null;
}
export const createTournament = (i: TournamentInput) =>
  call<string>('create_tournament', {
    p_title: i.title, p_description: i.description, p_format_version: i.formatVersionId, p_rounds: i.rounds,
    p_round_minutes: i.roundMinutes, p_max_players: i.maxPlayers, p_closes_at: i.closesAt,
  });
export const updateTournament = (
  id: string, i: Pick<TournamentInput, 'title' | 'description' | 'roundMinutes' | 'maxPlayers' | 'closesAt'>,
) =>
  call<boolean>('update_tournament', {
    p_id: id, p_title: i.title, p_description: i.description, p_round_minutes: i.roundMinutes,
    p_max_players: i.maxPlayers, p_closes_at: i.closesAt,
  });
export const openRegistration = (id: string) => call<boolean>('open_registration', { p_id: id });
export const closeRegistration = (id: string) => call<boolean>('close_registration', { p_id: id });
export const cancelTournament = (id: string) => call<boolean>('cancel_tournament', { p_id: id });
/** Built key by key: the server refuses extra keys, and IVs must never leave the device. */
export const registerRoster = (id: string, roster: readonly RosterMember[]) =>
  call<number>('register_roster', {
    p_id: id,
    p_roster: roster.map((m) => ({ ref: m.ref, fast: m.fast, charges: [...m.charges], cp: m.cp, bestBuddy: m.bestBuddy })),
  });
export const withdrawFromTournament = (id: string) => call<boolean>('withdraw_from_tournament', { p_id: id });
export const grantJudge = (id: string, user: string) => call<boolean>('grant_judge', { p_id: id, p_user: user });
export const revokeJudge = (id: string, user: string) => call<boolean>('revoke_judge', { p_id: id, p_user: user });
/** Resolves to the round number started. */
export const startRound = (id: string, pairings: readonly SwissPairing[], force = false, override = false) =>
  call<number>('start_round', { p_tournament: id, p_pairings: pairings, p_force: force, p_override: override });
/** Scores are oriented to the pairing's player_a/player_b, whoever reports. Each resolves to the new pairing state. */
export const reportScore = (pairing: string, scoreA: number, scoreB: number) =>
  call<string>('report_score', { p_pairing: pairing, p_score_a: scoreA, p_score_b: scoreB });
export const confirmScore = (pairing: string) => call<string>('confirm_score', { p_pairing: pairing });
export const disputeScore = (pairing: string) => call<string>('dispute_score', { p_pairing: pairing });
export const settlePairing = (pairing: string, scoreA: number, scoreB: number, note: string | null = null) =>
  call<string>('settle_pairing', { p_pairing: pairing, p_score_a: scoreA, p_score_b: scoreB, p_note: note });
export const dropOut = (id: string) => call<boolean>('drop_out', { p_id: id });
export const removePlayer = (id: string, player: string, reason: string) =>
  call<boolean>('remove_player', { p_id: id, p_player: player, p_reason: reason });
export const finishTournament = (id: string) => call<boolean>('finish_tournament', { p_id: id });

// ── Readers ──
interface TRow {
  id: string; organiser_id: string; title: string; description: string; format_version_id: string;
  league: LeagueId; rounds: number; round_minutes: number; max_players: number;
  registration_closes_at: string | null; state: TournamentState; current_round: number;
  round_ends_at: string | null; created_at: string;
  tournament_entrants?: { count: number }[] | null;
}
const toTournament = (r: TRow): Tournament => ({
  id: r.id, organiserId: r.organiser_id, title: r.title, description: r.description,
  formatVersionId: r.format_version_id, league: r.league, rounds: r.rounds, roundMinutes: r.round_minutes,
  maxPlayers: r.max_players, registrationClosesAt: r.registration_closes_at, state: r.state,
  currentRound: r.current_round, roundEndsAt: r.round_ends_at, createdAt: r.created_at,
  entrants: r.tournament_entrants?.[0]?.count ?? 0,
});
const T_COLS =
  'id, organiser_id, title, description, format_version_id, league, rounds, round_minutes, max_players, registration_closes_at, state, current_round, round_ends_at, created_at';

// The embed counts only players still in (the filter applies to the embedded rows).
const T_COUNT_COLS = `${T_COLS}, tournament_entrants(count)`;

export async function listTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase
    .from('tournaments').select(T_COUNT_COLS).eq('tournament_entrants.dropped', false).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as TRow[]).map(toTournament);
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const { data, error } = await supabase.from('tournaments').select(T_COUNT_COLS).eq('id', id).eq('tournament_entrants.dropped', false).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toTournament(data as unknown as TRow) : null;
}

/** The tournament's own pinned format version (readable once it is not a draft, or by its organiser); null when unreadable. */
export async function getTournamentFormat(tournamentId: string): Promise<{ name: string; format: Format } | null> {
  const { data, error } = await supabase
    .from('tournaments').select('format_versions(rules, formats(name))').eq('id', tournamentId).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data as unknown as { format_versions: { rules: Format; formats: { name: string } | null } | null } | null)?.format_versions;
  return v ? { name: v.formats?.name ?? 'Format', format: v.rules } : null;
}

export async function listEntrants(id: string): Promise<Entrant[]> {
  const { data, error } = await supabase
    .from('tournament_entrants').select('player_id, seed, dropped, registered_at')
    .eq('tournament_id', id).order('seed', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ playerId: r.player_id, seed: r.seed, dropped: r.dropped, registeredAt: r.registered_at }));
}

/** PostgREST caps a response (max_rows = 1000): page through with `.range` until a short page. */
const PAGE = 500;
const MAX_PAGES = 20;
async function pageAll<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

// A big event is 12 rounds x 128 tables = 1,536 rows, so this is the one reader that pages.
// Entrants and rosters are <= 512 rows per tournament and audit is limited to 50: all under the cap.
export async function listPairings(id: string): Promise<Pairing[]> {
  const rows = await pageAll((from, to) => supabase
    .from('tournament_pairings')
    .select('id, round, table_no, player_a, player_b, score_a, score_b, state, reported_by, reported_at, final_at, note')
    .eq('tournament_id', id).order('round', { ascending: true }).order('table_no', { ascending: true }).range(from, to));
  return rows.map((r) => ({
    id: r.id, round: r.round, tableNo: r.table_no, playerA: r.player_a, playerB: r.player_b,
    scoreA: r.score_a, scoreB: r.score_b, state: r.state as PairingState, reportedBy: r.reported_by,
    reportedAt: r.reported_at, finalAt: r.final_at, note: r.note,
  }));
}

/** Your own roster is always readable; others' rosters only after registration closes, and only if you are a member. */
export async function listRosters(id: string): Promise<Map<string, RosterMember[]>> {
  const { data, error } = await supabase.from('tournament_rosters').select('player_id, roster').eq('tournament_id', id);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.player_id as string, r.roster as RosterMember[]]));
}

export async function listJudges(id: string): Promise<string[]> {
  const { data, error } = await supabase.from('tournament_roles').select('user_id').eq('tournament_id', id);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.user_id as string);
}

/** The newest `limit` rows, newest first. */
export async function listAudit(id: string, limit = 50): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from('tournament_audit').select('id, actor_id, action, detail, created_at')
    .eq('tournament_id', id).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, actorId: r.actor_id, action: r.action, detail: r.detail, createdAt: r.created_at }));
}

const P_COLS = 'id, tournament_id, round, table_no, player_a, player_b, score_a, score_b, state, reported_by, reported_at, final_at, note';

/** What the notification poll needs, in a fixed five queries however many tournaments: the open
 *  tournaments (registration|closed|running) the viewer organises, judges or plays in; the
 *  current-round pairings of the running ones (the viewer's own, plus every pairing where the
 *  viewer runs the event, so "needs attention" can be counted); and where the viewer judges. */
export async function myTournamentActivity(): Promise<{ tournaments: Tournament[]; pairings: Pairing[]; judgeOf: string[] }> {
  const none = { tournaments: [], pairings: [], judgeOf: [] };
  const { data: s, error: se } = await supabase.auth.getSession();
  if (se) throw new Error(se.message);
  const me = s.session?.user.id;
  if (!me) return none;
  const [ent, roles, org] = await Promise.all([
    supabase.from('tournament_entrants').select('tournament_id').eq('player_id', me).eq('dropped', false),
    supabase.from('tournament_roles').select('tournament_id').eq('user_id', me),
    supabase.from('tournaments').select('id').eq('organiser_id', me),
  ]);
  for (const r of [ent, roles, org]) if (r.error) throw new Error(r.error.message);
  const judgeOf = (roles.data ?? []).map((r) => r.tournament_id as string);
  const ids = [...new Set([
    ...(ent.data ?? []).map((r) => r.tournament_id as string), ...judgeOf, ...(org.data ?? []).map((r) => r.id as string),
  ])];
  if (!ids.length) return none;
  const { data: trs, error: te } = await supabase
    .from('tournaments').select(T_COLS).in('id', ids).in('state', ['registration', 'closed', 'running']);
  if (te) throw new Error(te.message);
  const tournaments = ((trs ?? []) as unknown as TRow[]).map(toTournament);
  const running = tournaments.filter((t) => t.state === 'running');
  if (!running.length) return { tournaments, pairings: [], judgeOf };
  const { data: prs, error: pe } = await supabase
    .from('tournament_pairings').select(P_COLS).in('tournament_id', running.map((t) => t.id))
    // Current rounds only: every round would be ~1,500 rows per big event, past PostgREST's 1,000-row cap.
    .in('round', [...new Set(running.map((t) => t.currentRound))])
    .order('tournament_id').order('table_no');
  if (pe) throw new Error(pe.message);
  const by = new Map(running.map((t) => [t.id, t]));
  const pairings = (prs ?? []).flatMap((r) => {
    const t = by.get(r.tournament_id as string)!;
    const runs = t.organiserId === me || judgeOf.includes(t.id);
    if (r.round !== t.currentRound || !(runs || r.player_a === me || r.player_b === me)) return [];
    return [{
      id: r.id, tournamentId: t.id, round: r.round, tableNo: r.table_no, playerA: r.player_a, playerB: r.player_b,
      scoreA: r.score_a, scoreB: r.score_b, state: r.state as PairingState, reportedBy: r.reported_by,
      reportedAt: r.reported_at, finalAt: r.final_at, note: r.note,
    }];
  });
  return { tournaments, pairings, judgeOf };
}
