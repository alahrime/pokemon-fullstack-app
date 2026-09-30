import { supabase } from './supabase';

export type RankedLeague = 'great' | 'ultra' | 'master';
export const RANKED_LEAGUES: readonly RankedLeague[] = ['great', 'ultra', 'master'];

/** Mirror `rating_constants()`; the server applies the gate, these only word the provisional card. */
export const MIN_GAMES = 5;
export const MAX_RD = 110;

export interface Season { id: string; startsAt: string; endsAt: string }
export interface BoardRow { pos: number; userId: string; name: string; rating: number; rd: number; games: number; wins: number }
export interface MyRating { rating: number; rd: number; games: number; wins: number }

export const seasonLabel = (s: Pick<Season, 'startsAt'>): string =>
  new Date(s.startsAt).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function gateStatus(r: Pick<MyRating, 'games' | 'rd'>): { listed: boolean; gamesLeft: number; needsRd: boolean } {
  const gamesLeft = Math.max(0, MIN_GAMES - r.games);
  const needsRd = r.rd > MAX_RD;
  return { listed: gamesLeft === 0 && !needsRd, gamesLeft, needsRd };
}

export async function listSeasons(): Promise<Season[]> {
  const { data, error } = await supabase.from('seasons').select('id, starts_at, ends_at').order('starts_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at }));
}

export async function getLeaderboard(seasonId: string, league: RankedLeague): Promise<BoardRow[]> {
  const { data, error } = await supabase.rpc('leaderboard', { p_season: seasonId, p_league: league, p_limit: 100 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { pos: number; user_id: string; display_name: string; rating: number; rd: number; games: number; wins: number }[])
    .map((r) => ({ pos: Number(r.pos), userId: r.user_id, name: r.display_name, rating: r.rating, rd: r.rd, games: r.games, wins: r.wins }));
}

export async function getMyRating(seasonId: string, league: RankedLeague, me: string): Promise<MyRating | null> {
  const { data, error } = await supabase.from('ratings').select('rating, rd, games, wins')
    .eq('season_id', seasonId).eq('league', league).eq('user_id', me).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { rating: data.rating, rd: data.rd, games: data.games, wins: data.wins } : null;
}
