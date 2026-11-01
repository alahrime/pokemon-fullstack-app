import type { Screen } from '../state/AppState';
import { SECTIONS, sectionOf } from './screens';

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
  const m = /^#\/([a-z]+)\/([a-z0-9]+)$/.exec(hash);
  if (m) {
    const section = SECTIONS.find((s) => s.id === m[1]);
    const screen = section?.screens.find((s) => s === m[2] && s !== 'match' && s !== 'player');
    if (screen) return screen;
  }
  return hash === '#/account' ? 'account' : 'landing';
}
