import type { Screen } from '../state/AppState';
import { SECTIONS, sectionOf } from './screens';
import { isSimulated, LEAGUE_BY_ID, SPECIES_BY_ID } from './data';
import { LIMITED_CUPS } from './presetFormats';
import type { IV, LeagueId } from './types';

const TID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOURNAMENT_HASH = new RegExp(`^#/play/tournaments/(${TID})$`, 'i');
const PLAYER_HASH = new RegExp(`^#/play/players/(${TID})$`, 'i');

/** `match` shares Matches' address: an open match lives in memory (`activeMatch`)
 *  and a URL cannot recreate it. */
export function hashFor(screen: Screen): string {
  if (screen === 'landing') return '#/';
  if (screen === 'account') return '#/account';
  const id = screen === 'match' ? 'matchmaking' : screen === 'player' ? 'records' : screen;
  return `#/${sectionOf(id)!.id}/${id}`;
}

export const hashForTournament = (id: string): string => `#/play/tournaments/${id}`;

export function tournamentIdFromHash(hash: string): string | null {
  return TOURNAMENT_HASH.exec(hash)?.[1].toLowerCase() ?? null;
}

export const hashForPlayer = (id: string): string => `#/play/players/${id}`;

export function playerIdFromHash(hash: string): string | null {
  return PLAYER_HASH.exec(hash)?.[1].toLowerCase() ?? null;
}

/** The address a screen (and, on Tournaments / Player, the open tournament / profile) lives at. */
export function hashForView(screen: Screen, tournamentId: string | null, playerId: string | null = null): string {
  if (screen === 'player' && playerId) return hashForPlayer(playerId);
  return screen === 'tournaments' && tournamentId ? hashForTournament(tournamentId) : hashFor(screen);
}

/**
 * Supabase's return trip: a Discord sign-in or an email link comes back to the
 * bare origin with the result in the hash (`#access_token=…` or `#error=…`).
 * It belongs on Account, the only screen that reads a failure or asks a new
 * provider account for its profile, and it is not ours to rewrite until
 * supabase-js and `lib/oauthError` have read it.
 */
export const isAuthCallback = (hash: string): boolean => /^#(.*&)?(access_token|error|error_description)=/.test(hash);

export function screenFromHash(hash: string): Screen {
  if (isAuthCallback(hash)) return 'account';
  if (tournamentIdFromHash(hash)) return 'tournaments';
  if (playerIdFromHash(hash)) return 'player';
  // A report link carries its Pokémon in a query (`#/…/report?mon=…`); the screen is the path.
  const m = /^#\/([a-z]+)\/([a-z0-9]+)$/.exec(hash.split('?')[0]);
  if (m) {
    const section = SECTIONS.find((s) => s.id === m[1]);
    const screen = section?.screens.find((s) => s === m[2] && s !== 'match' && s !== 'player');
    if (screen) return screen;
  }
  return hash === '#/account' ? 'account' : 'landing';
}

/** What a shared Analyze link pins: the Pokémon, its roll and the league it is read in. */
export interface ReportView {
  species: string;
  shadow: boolean;
  league: LeagueId;
  /** A limited cup key, played under `league`'s cap; null for the plain league. */
  cup: string | null;
  iv: IV;
  /** Around-your-roll stat floor, or null when the filter is off. */
  statFloor: { atk: number; def: number } | null;
}

/** `?mon=ursaluna&iv=10-8-1&league=great` (+ `&shadow=1`, `&cup=…`, `&atk=128&def=90.4`), appended to the report's hash. */
export function reportQuery(v: ReportView): string {
  const q = new URLSearchParams({ mon: v.species, iv: `${v.iv.a}-${v.iv.d}-${v.iv.s}`, league: v.league });
  if (v.shadow) q.set('shadow', '1');
  if (v.cup) q.set('cup', v.cup);
  if (v.statFloor) {
    q.set('atk', v.statFloor.atk.toFixed(1));
    q.set('def', v.statFloor.def.toFixed(1));
  }
  return `?${q}`;
}

/** The valid parts of a report link; anything missing or malformed is left out, not guessed. */
export function reportFromHash(hash: string): Partial<ReportView> {
  const i = hash.indexOf('?');
  if (i < 0 || screenFromHash(hash) !== 'report') return {};
  const q = new URLSearchParams(hash.slice(i + 1));
  const out: Partial<ReportView> = {};
  const mon = q.get('mon');
  if (mon && SPECIES_BY_ID.has(mon) && isSimulated(mon)) {
    out.species = mon;
    out.shadow = q.get('shadow') === '1';
  }
  const league = q.get('league') as LeagueId | null;
  if (league && LEAGUE_BY_ID.has(league)) out.league = league;
  // A cup decides its own cap, whatever `league` says; a link without one is the plain league.
  const cup = LIMITED_CUPS.find((c) => c.key === q.get('cup'));
  out.cup = cup?.key ?? null;
  if (cup) out.league = cup.base;
  // Absent is "filter off", not "unspecified": every link this app writes says which.
  const atk = Number(q.get('atk')), def = Number(q.get('def'));
  out.statFloor = q.has('atk') && q.has('def') && Number.isFinite(atk) && Number.isFinite(def) ? { atk, def } : null;
  const iv = /^(\d{1,2})-(\d{1,2})-(\d{1,2})$/.exec(q.get('iv') ?? '');
  if (iv && iv.slice(1).every((n) => +n <= 15)) out.iv = { a: +iv[1], d: +iv[2], s: +iv[3] };
  return out;
}
