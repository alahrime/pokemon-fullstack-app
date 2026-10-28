import { supabase } from './supabase';
import { downloadCsv, stamp } from './exportData';
import { displayName } from './data';

/**
 * The Battle Tracker: a notebook for GO Battle League, the in-game ladder.
 *
 * GBL is played in sets of five battles, five sets a day, and every set moves
 * the player's in-game Elo. None of it is verifiable — it is what the player
 * writes down — so it lives in its own tables (`gbl_sets`, `gbl_battles`) and
 * never touches the Paragon match record. See the migration for who can read what.
 */

export type GblResult = 'win' | 'loss' | 'tie';

/** The moves seen on one opponent Pokémon. Only what was seen: an unseen move is absent, never guessed. */
export interface OppMoves {
  fast: string | null;
  charges: string[];
}
export const NO_MOVES: OppMoves = { fast: null, charges: [] };
export const knowsAny = (m: OppMoves | undefined): boolean => !!m && (m.fast !== null || m.charges.length > 0);

export interface GblBattle {
  id: string;
  idx: number;
  /** Null: played, no result written down. */
  result: GblResult | null;
  /** The opponent's Pokémon as seen, lead first. */
  opponents: string[];
  /** Moves seen on each, by position in `opponents`. */
  opponentMoves: OppMoves[];
  /** The player's own note on the battle; never shared. */
  note: string | null;
  playedAt: string;
}

export interface GblSet {
  id: string;
  /** The alt it was played on; null for the main account. */
  accountId: string | null;
  season: number;
  /** A preset format key: a league, or a cup such as `retro`. */
  format: string;
  team: string[];
  eloStart: number | null;
  eloEnd: number | null;
  startedAt: string;
  battles: GblBattle[];
}

/** One set as anyone permitted to see it gets it: tallies, not the battles. */
export interface GblSetSummary {
  id: string;
  format: string;
  eloStart: number | null;
  eloEnd: number | null;
  startedAt: string;
  wins: number;
  losses: number;
  ties: number;
  battles: number;
}

export const SET_SIZE = 5;
/** GO allows five sets of five a day. */
export const DAILY_BATTLES = 25;
/** A day's limit: 25, 50 on a GO Battle Thursday, 100 during GO Battle Week. */
export const DAY_SIZES = [DAILY_BATTLES, 50, 100] as const;
/** The day's limit: the one picked, raised to the smallest that holds what was logged. */
export const daySize = (played: number, picked: number = DAILY_BATTLES): number =>
  DAY_SIZES.find((s) => s >= Math.max(played, picked)) ?? DAY_SIZES.at(-1)!;
/** The season the tracker opens on; the stepper reaches any other. */
export const CURRENT_SEASON = 28;
export const ELO_MAX = 4000;

/**
 * GO's Elo tiers. Below 2000 the game shows a rank, not a tier; the tracker
 * still logs the Elo, so it is one band here.
 */
export interface Tier {
  id: 'rank' | 'ace' | 'veteran' | 'expert' | 'legend';
  label: string;
  lo: number;
  /** Inclusive top of the band; null for Legend, which has none. */
  hi: number | null;
}
export const TIERS: Tier[] = [
  { id: 'rank', label: 'Rank 1–20', lo: 0, hi: 1999 },
  { id: 'ace', label: 'Ace', lo: 2000, hi: 2499 },
  { id: 'veteran', label: 'Veteran', lo: 2500, hi: 2749 },
  { id: 'expert', label: 'Expert', lo: 2750, hi: 2999 },
  { id: 'legend', label: 'Legend', lo: 3000, hi: null },
];

export function tierOf(elo: number): Tier {
  return [...TIERS].reverse().find((t) => elo >= t.lo)!;
}

/** The next tier up and how far away it is; null at Legend. */
export function nextTier(elo: number): { tier: Tier; gap: number; progress: number } | null {
  const now = tierOf(elo);
  const i = TIERS.indexOf(now);
  if (i === TIERS.length - 1) return null;
  const next = TIERS[i + 1];
  return { tier: next, gap: next.lo - elo, progress: (elo - now.lo) / (next.lo - now.lo) };
}

// ── Reads and writes ────────────────────────────────────────────────────────

interface RawBattle {
  id: string; idx: number; result: GblResult | null; opponents: string[]; opponent_moves?: OppMoves[] | null; note?: string | null; played_at: string;
}
interface RawSet {
  id: string; account_id?: string | null; season: number; format: string; team: string[]; elo_start: number | null; elo_end: number | null;
  started_at: string; gbl_battles?: RawBattle[];
}

const toMoves = (m: Partial<OppMoves> | null | undefined): OppMoves => ({ fast: m?.fast ?? null, charges: m?.charges ?? [] });
const toBattle = (b: RawBattle): GblBattle => ({
  id: b.id, idx: b.idx, result: b.result, opponents: b.opponents ?? [],
  opponentMoves: (b.opponents ?? []).map((_, i) => toMoves(b.opponent_moves?.[i])), note: b.note ?? null, playedAt: b.played_at,
});
const toSet = (s: RawSet): GblSet => ({
  id: s.id, accountId: s.account_id ?? null, season: s.season, format: s.format, team: s.team ?? [], eloStart: s.elo_start, eloEnd: s.elo_end, startedAt: s.started_at,
  battles: (s.gbl_battles ?? []).map(toBattle).sort((a, b) => a.idx - b.idx),
});

function check(r: { data: unknown; error: { message: string } | null }): unknown {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// ── Alternate accounts ──────────────────────────────────────────────────────

/** An alt GO account: up to two besides the main one, each with its own Elo and its own 25 a day. */
export interface GblAccount { id: string; name: string }
export const MAX_ALTS = 2;

export async function listAccounts(): Promise<GblAccount[]> {
  const data = check(await supabase.from('gbl_accounts').select('id, name').order('created_at'));
  return (data ?? []) as GblAccount[];
}

/** The server enforces the limit and the name rules; these messages say so in the player's terms. */
function accountError(message: string): Error {
  if (/two alternate/.test(message)) return new Error(`You can keep ${MAX_ALTS} alternate accounts at most.`);
  if (/main account/.test(message)) return new Error("An alt can't use your main account's trainer name.");
  if (/duplicate|unique/i.test(message)) return new Error('You already have an alt with that name.');
  return new Error(message);
}

export async function addAccount(name: string): Promise<GblAccount> {
  const r = await supabase.from('gbl_accounts').insert({ name: name.trim() }).select('id, name').single();
  if (r.error) throw accountError(r.error.message);
  return r.data as GblAccount;
}

export async function renameAccount(id: string, name: string): Promise<void> {
  const r = await supabase.from('gbl_accounts').update({ name: name.trim() }).eq('id', id);
  if (r.error) throw accountError(r.error.message);
}

/** Deletes the alt and every set and battle logged on it. */
export async function deleteAccount(id: string): Promise<void> {
  check(await supabase.from('gbl_accounts').delete().eq('id', id));
}

// ── Saved teams ─────────────────────────────────────────────────────────────

/** A team of three, lead first, kept to load with one tap. */
export interface GblTeam { id: string; team: string[] }

export async function listGblTeams(): Promise<GblTeam[]> {
  return (check(await supabase.from('gbl_teams').select('id, team').order('created_at')) ?? []) as GblTeam[];
}

export async function saveGblTeam(team: string[]): Promise<GblTeam> {
  return check(await supabase.from('gbl_teams').insert({ team }).select('id, team').single()) as GblTeam;
}

export async function deleteGblTeam(id: string): Promise<void> {
  check(await supabase.from('gbl_teams').delete().eq('id', id));
}

/** The size picked for each day, keyed `account:YYYY-MM-DD` (`main` for the main account). */
export async function listDaySizes(): Promise<Record<string, number>> {
  const rows = (check(await supabase.from('gbl_day_sizes').select('account_id, day, size')) ?? []) as
    { account_id: string | null; day: string; size: number }[];
  return Object.fromEntries(rows.map((r) => [`${r.account_id ?? 'main'}:${r.day}`, r.size]));
}

export async function setDaySize(accountId: string | null, day: string, size: number): Promise<void> {
  check(await supabase.from('gbl_day_sizes')
    .upsert({ account_id: accountId, day, size }, { onConflict: 'user_id,account_id,day' }));
}

/** The caller's own sets in a season, oldest first, with their battles — every account's; filter with `onAccount`. */
export async function listMySets(season: number): Promise<GblSet[]> {
  const data = check(await supabase.from('gbl_sets').select('*, gbl_battles(*)').eq('season', season).order('started_at'));
  return (data as RawSet[]).map(toSet);
}

/** `startedAt` only when backlogging a past day; a live set is stamped by the server. */
export async function startSet(p: {
  season: number; format: string; team: string[]; eloStart: number | null; startedAt?: string; accountId?: string | null;
}): Promise<GblSet> {
  const data = check(await supabase.from('gbl_sets')
    .insert({
      season: p.season, format: p.format, team: p.team, elo_start: p.eloStart, account_id: p.accountId ?? null,
      ...(p.startedAt ? { started_at: p.startedAt } : {}),
    })
    .select('*').single());
  return toSet(data as RawSet);
}

export async function updateSet(id: string, p: { team?: string[]; eloStart?: number | null; eloEnd?: number | null }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.team) row.team = p.team;
  if (p.eloStart !== undefined) row.elo_start = p.eloStart;
  if (p.eloEnd !== undefined) row.elo_end = p.eloEnd;
  check(await supabase.from('gbl_sets').update(row).eq('id', id));
}

export async function deleteSet(id: string): Promise<void> {
  check(await supabase.from('gbl_sets').delete().eq('id', id));
}

export async function addBattle(
  setId: string, idx: number, result: GblResult | null, opponents: string[],
  extra: { moves?: OppMoves[]; note?: string | null; playedAt?: string } = {},
): Promise<GblBattle> {
  const data = check(await supabase.from('gbl_battles').insert({
    set_id: setId, idx, result, opponents,
    opponent_moves: opponents.map((_, i) => extra.moves?.[i] ?? NO_MOVES),
    note: extra.note?.trim() || null,
    ...(extra.playedAt ? { played_at: extra.playedAt } : {}),
  }).select('*').single());
  return toBattle(data as RawBattle);
}

/** A note or the moves seen, written after the fact. */
export async function updateBattle(id: string, p: { note?: string | null; opponentMoves?: OppMoves[] }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.note !== undefined) row.note = p.note?.trim() || null;
  if (p.opponentMoves) row.opponent_moves = p.opponentMoves;
  check(await supabase.from('gbl_battles').update(row).eq('id', id));
}

export async function deleteBattle(id: string): Promise<void> {
  check(await supabase.from('gbl_battles').delete().eq('id', id));
}

const renumber = async (b: GblBattle, idx: number) => check(await supabase.from('gbl_battles').update({ idx }).eq('id', b.id));

/**
 * Deletes a battle from the middle of its set and closes the gap, so the set stays numbered 1..n.
 * Later battles move up in order, so `unique (set_id, idx)` never sees two at once.
 */
// ponytail: several requests, not one transaction; a failure part-way leaves a gap until a reload. An RPC if that bites.
export async function removeBattle(set: GblSet, b: GblBattle): Promise<GblBattle[]> {
  await deleteBattle(b.id);
  const rest = set.battles.filter((x) => x.id !== b.id);
  for (const x of rest) if (x.idx > b.idx) await renumber(x, x.idx - 1);
  return rest.map((x) => (x.idx > b.idx ? { ...x, idx: x.idx - 1 } : x));
}

/** Puts a removed battle back at its place in `set` (as it is now): the ones after it move down first, from the end. */
export async function restoreBattle(set: GblSet, b: GblBattle): Promise<GblBattle[]> {
  const after = set.battles.filter((x) => x.idx >= b.idx);
  for (const x of [...after].reverse()) await renumber(x, x.idx + 1);
  const back = await addBattle(set.id, b.idx, b.result, b.opponents, { moves: b.opponentMoves, note: b.note, playedAt: b.playedAt });
  return [...set.battles.map((x) => (x.idx >= b.idx ? { ...x, idx: x.idx + 1 } : x)), back].sort((x, y) => x.idx - y.idx);
}

/** One of any player's accounts' season as the caller may see it (null: their main); empty when they may not. */
export async function seasonSets(userId: string, season: number, accountId: string | null = null): Promise<GblSetSummary[]> {
  const data = check(await supabase.rpc('gbl_season_sets', { p_user: userId, p_season: season, p_account: accountId }));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, format: r.format as string, eloStart: r.elo_start as number | null, eloEnd: r.elo_end as number | null,
    startedAt: r.started_at as string, wins: r.wins as number, losses: r.losses as number, ties: r.ties as number, battles: r.battles as number,
  }));
}

export interface LadderRow {
  userId: string;
  /** Null for the main account. */
  accountId: string | null;
  /** The alt's trainer name; null for the main account. */
  accountName: string | null;
  name: string; avatar: string | null; elo: number | null; peak: number | null;
  wins: number; losses: number; ties: number; battles: number; isFriend: boolean;
}

export async function leaderboard(season: number): Promise<LadderRow[]> {
  const data = check(await supabase.rpc('gbl_leaderboard', { p_season: season }));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string, accountId: (r.account_id as string | null) ?? null, accountName: (r.account_name as string | null) ?? null,
    name: r.display_name as string, avatar: r.avatar as string | null, elo: r.elo as number | null,
    peak: r.peak as number | null, wins: r.wins as number, losses: r.losses as number, ties: r.ties as number,
    battles: r.battles as number, isFriend: r.is_friend as boolean,
  }));
}

/** Moves players recorded on one Pokémon, most seen first; shares are of `known`, the sightings with any move recorded. */
export interface MoveUsage { fast: { id: string; n: number }[]; charges: { id: string; n: number }[]; known: number }
export interface MetaRow { ref: string; seen: number; wins: number; losses: number; ties: number; moves: MoveUsage | null }
export interface Meta { rows: MetaRow[]; battles: number; players: number }

export async function meta(format: string, since: Date, band: Tier | null): Promise<Meta> {
  const args = { p_format: format, p_since: since.toISOString(), p_lo: band?.lo ?? null, p_hi: band?.hi ?? null };
  const [usage, moves] = await Promise.all([supabase.rpc('gbl_meta', args), supabase.rpc('gbl_meta_moves', args)]);
  const data = check(usage) as Record<string, number | string>[] | null;
  const byRef = new Map<string, MoveUsage>();
  for (const m of (check(moves) ?? []) as { ref: string; kind: 'fast' | 'charge'; move: string; n: number; known: number }[]) {
    const u = byRef.get(m.ref) ?? { fast: [], charges: [], known: m.known };
    (m.kind === 'fast' ? u.fast : u.charges).push({ id: m.move, n: m.n });
    byRef.set(m.ref, u);
  }
  for (const u of byRef.values()) for (const l of [u.fast, u.charges]) l.sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  const rows = (data ?? []).map((r) => ({
    ref: r.ref as string, seen: r.seen as number, wins: r.wins as number, losses: r.losses as number, ties: r.ties as number,
    moves: byRef.get(r.ref as string) ?? null,
  }));
  return { rows, battles: (data?.[0]?.battles as number) ?? 0, players: (data?.[0]?.players as number) ?? 0 };
}

export async function getPublic(userId: string): Promise<boolean> {
  const data = check(await supabase.from('profiles').select('gbl_public').eq('id', userId).maybeSingle());
  return !!(data as { gbl_public?: boolean } | null)?.gbl_public;
}

export async function setPublic(userId: string, on: boolean): Promise<void> {
  check(await supabase.from('profiles').update({ gbl_public: on }).eq('id', userId));
}

// ── The season, worked out ──────────────────────────────────────────────────

/** One account's sets: null is the main account. */
export const onAccount = (sets: readonly GblSet[], accountId: string | null): GblSet[] =>
  sets.filter((s) => s.accountId === accountId);

export interface Tally { wins: number; losses: number; ties: number; battles: number }

export const tallyOf = (battles: readonly GblBattle[]): Tally => ({
  wins: battles.filter((b) => b.result === 'win').length,
  losses: battles.filter((b) => b.result === 'loss').length,
  ties: battles.filter((b) => b.result === 'tie').length,
  battles: battles.length,
});

/** Battles' own tallies rolled up into the summary shape every viewer shares. */
export const summaryOf = (s: GblSet): GblSetSummary => ({
  id: s.id, format: s.format, eloStart: s.eloStart, eloEnd: s.eloEnd, startedAt: s.startedAt, ...tallyOf(s.battles),
});

export function seasonTotals(sets: readonly GblSetSummary[]): Tally & { sets: number } {
  const sum = (k: keyof Tally) => sets.reduce((n, s) => n + s[k], 0);
  return { wins: sum('wins'), losses: sum('losses'), ties: sum('ties'), battles: sum('battles'), sets: sets.length };
}

/** Elo after each set that has one written down, in order: the season chart's points. */
export function eloSeries(sets: readonly GblSetSummary[]): { set: GblSetSummary; elo: number; delta: number | null }[] {
  const out: { set: GblSetSummary; elo: number; delta: number | null }[] = [];
  for (const s of sets) {
    const elo = s.eloEnd ?? null;
    if (elo === null) continue;
    const from = s.eloStart ?? out.at(-1)?.elo ?? null;
    out.push({ set: s, elo, delta: from === null ? null : elo - from });
  }
  return out;
}

/** The Elo a new set starts at: the last one written down. */
export function lastElo(sets: readonly { eloStart: number | null; eloEnd: number | null }[]): number | null {
  for (let i = sets.length - 1; i >= 0; i--) {
    const e = sets[i].eloEnd ?? sets[i].eloStart;
    if (e !== null) return e;
  }
  return null;
}

/** A local calendar day as `YYYY-MM-DD`, the key the backlog calendar is drawn in. */
export const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromLocalDay = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Battles per local day: how full each day of the backlog calendar is. */
export function battlesByDay(sets: readonly GblSet[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sets) for (const b of s.battles) {
    const k = localDay(new Date(b.playedAt));
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * When a battle logged into a past day happened: a few minutes after the last one
 * that day, else that morning, and never past its end — so backlogged sets keep
 * their order, and sit in the season chart where they were played.
 */
export function backdatedAt(daySets: readonly GblSet[], day: Date): string {
  const last = daySets.flatMap((s) => s.battles.map((b) => Date.parse(b.playedAt))).reduce((a, b) => Math.max(a, b), 0);
  const morning = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59).getTime();
  if (!last) return new Date(morning).toISOString();
  // Past 23:59, a millisecond apart: two battles at one moment would leave their sets' order, and Elo chain, to
  // chance, and the minute holds 60,000 of them, far past the 100 a day can hold.
  return new Date(Math.min(last + 3 * 60_000, Math.max(end, last + 1))).toISOString();
}

/** Battles logged on the local calendar day of `now` — GO's 25 a day. */
export function battlesToday(sets: readonly GblSet[], now = new Date()): number {
  const day = now.toDateString();
  return sets.reduce((n, s) => n + s.battles.filter((b) => new Date(b.playedAt).toDateString() === day).length, 0);
}

export interface Recap {
  tally: Tally;
  sets: number;
  eloFrom: number | null;
  eloTo: number | null;
  bestSet: { index: number; tally: Tally } | null;
  mostFaced: { ref: string; n: number } | null;
  lostToMost: { ref: string; n: number; of: number } | null;
}

/** What a run of sets came to — today's session on the Stats view. */
export function recap(sets: readonly GblSet[]): Recap {
  const battles = sets.flatMap((s) => s.battles);
  const faced = new Map<string, number>();
  const lostTo = new Map<string, number>();
  for (const b of battles) {
    for (const r of new Set(b.opponents)) {
      faced.set(r, (faced.get(r) ?? 0) + 1);
      if (b.result === 'loss') lostTo.set(r, (lostTo.get(r) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const f = top(faced), l = top(lostTo);
  let best: Recap['bestSet'] = null;
  sets.forEach((s, i) => {
    const t = tallyOf(s.battles);
    if (t.battles && (!best || t.wins - t.losses > best.tally.wins - best.tally.losses)) best = { index: i, tally: t };
  });
  const tally = tallyOf(battles);
  return {
    tally, sets: sets.length,
    eloFrom: sets.length ? sets[0].eloStart : null,
    eloTo: lastElo(sets),
    bestSet: best,
    mostFaced: f ? { ref: f[0], n: f[1] } : null,
    lostToMost: l ? { ref: l[0], n: l[1], of: tally.losses } : null,
  };
}

/** Sets started on the local day of `now`. */
export const todaysSets = (sets: readonly GblSet[], now = new Date()) =>
  sets.filter((s) => new Date(s.startedAt).toDateString() === now.toDateString());

/** Per format: tally and Elo moved per battle where both ends were written down. */
export function byFormat(sets: readonly GblSetSummary[]): { format: string; tally: Tally; eloPerBattle: number | null }[] {
  const groups = new Map<string, GblSetSummary[]>();
  for (const s of sets) groups.set(s.format, [...(groups.get(s.format) ?? []), s]);
  return [...groups].map(([format, ss]) => {
    const t = seasonTotals(ss);
    const priced = ss.filter((s) => s.eloStart !== null && s.eloEnd !== null && s.battles > 0);
    const n = priced.reduce((k, s) => k + s.battles, 0);
    return {
      format, tally: t,
      eloPerBattle: n ? priced.reduce((k, s) => k + (s.eloEnd! - s.eloStart!), 0) / n : null,
    };
  }).sort((a, b) => b.tally.battles - a.tally.battles);
}

export function exportSeason(sets: readonly GblSet[], season: number) {
  downloadCsv(`battle-tracker-season-${season}-${stamp()}`, sets.flatMap((s, si) => s.battles.map((b) => ({
    season, set: si + 1, format: s.format, battle: b.idx, result: b.result ?? '',
    opponents: b.opponents.map(displayName).join(' / '), team: s.team.map(displayName).join(' / '),
    elo_start: s.eloStart ?? '', elo_end: s.eloEnd ?? '', played_at: b.playedAt,
  }))));
}
