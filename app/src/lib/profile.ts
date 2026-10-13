import { supabase } from './supabase';
import { wilson } from './records';
import type { LeagueId } from './types';
import type { PlayerGame } from './tournaments';
import type { RosterMember } from '../tournament/roster';

/** What a trainer shows on their profile. Everything past the two names is optional and self-declared. */
export interface Profile {
  displayName: string; goUsername: string; createdAt: string;
  avatar: string | null; region: string | null; trainerLevel: number | null; xp: number | null;
  favoritePokemon: string[]; favoriteLeague: LeagueId | null; faction: string | null; specialty: string | null;
}
export type ProfileEdit = Omit<Profile, 'displayName' | 'goUsername' | 'createdAt'>;

export const FAVORITES = 6;
export const MAX_LEVEL = 80;
export const SPECIALTIES = ['Great League Specialist', 'Ultra League Specialist', 'Master League Specialist', 'Limited Cup Specialist', 'Captain', 'Alternate'];
export const trainerUrl = (slug: string) => `https://play.pokemonshowdown.com/sprites/trainers/${slug}.png`;
/** The 1,500 slugs at play.pokemonshowdown.com/sprites/trainers/, loaded only when the picker opens. */
export const loadTrainers = async (): Promise<string[]> => (await import('../data/trainers.json')).default;

const COLS = 'display_name, go_username, created_at, avatar, region, trainer_level, xp, favorite_pokemon, favorite_league, faction, specialty';

export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select(COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    displayName: r.display_name as string, goUsername: r.go_username as string, createdAt: r.created_at as string,
    avatar: (r.avatar as string | null) ?? null, region: (r.region as string | null) ?? null,
    trainerLevel: (r.trainer_level as number | null) ?? null, xp: r.xp == null ? null : Number(r.xp),
    favoritePokemon: (r.favorite_pokemon as string[] | null) ?? [], favoriteLeague: (r.favorite_league as LeagueId | null) ?? null,
    faction: (r.faction as string | null) ?? null, specialty: (r.specialty as string | null) ?? null,
  };
}

const blank = (s: string | null) => (s?.trim() ? s.trim() : null);

/** Owner only (RLS); zero rows updated means it was not theirs, which must not read as saved. */
export async function saveProfile(id: string, e: ProfileEdit): Promise<void> {
  const { data, error } = await supabase.from('profiles').update({
    avatar: e.avatar, region: blank(e.region), trainer_level: e.trainerLevel, xp: e.xp,
    favorite_pokemon: e.favoritePokemon.slice(0, FAVORITES), favorite_league: e.favoriteLeague,
    faction: blank(e.faction), specialty: blank(e.specialty),
  }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('This profile is not yours to edit.');
}

// ── Show 6 arena breakdown ──

/** Lower bound of the Wilson interval at which each tier starts. */
export const TIERS: readonly { name: string; from: number }[] = [
  { name: 'Initiate', from: 0 }, { name: 'Contender', from: 0.2 }, { name: 'Veteran', from: 0.35 },
  { name: 'Expert', from: 0.5 }, { name: 'Elite', from: 0.6 }, { name: 'Legend', from: 0.7 },
];
export const TIER_MIN_GAMES = 5;

export interface Tier { name: string; /** 0-1 of the way to the next tier; 1 at the top. */ progress: number; next: string | null }

/**
 * A badge of the player's own Show 6 record, never a rating against other players (ratings were removed): the lower
 * bound of the 95% interval, so 3 from 4 does not outrank 60 from 100.
 */
export function tierFor(wins: number, games: number): Tier {
  if (games < TIER_MIN_GAMES) return { name: 'Unranked', progress: games / TIER_MIN_GAMES, next: TIERS[0].name };
  const lb = wilson(wins, games)[0];
  const i = TIERS.findLastIndex((t) => lb >= t.from);
  const next = TIERS[i + 1];
  return { name: TIERS[i].name, next: next?.name ?? null, progress: next ? (lb - TIERS[i].from) / (next.from - TIERS[i].from) : 1 };
}

export interface Bout {
  tournamentId: string; title: string; formatName: string; league: LeagueId;
  roster: RosterMember[] | null; wins: number; losses: number; games: PlayerGame[];
  placement: { place: number; field: number } | null;
}
export interface Showcase {
  wins: number; losses: number; uniqueOpponents: number; tournaments: number; tier: Tier;
  byLeague: Record<LeagueId, { wins: number; losses: number }>;
  /** Newest first, one per tournament. */
  bouts: Bout[];
  /** Podium finishes in finished tournaments. */
  trophies: Bout[];
}

/** Show 6 only: games from a format whose roster is not six are not part of a profile. */
export function showcase(all: readonly PlayerGame[], placements: ReadonlyMap<string, { place: number; field: number }> = new Map()): Showcase {
  const games = all.filter((g) => g.teamSize === 6);
  const bouts = new Map<string, Bout>();
  const byLeague: Showcase['byLeague'] = { great: { wins: 0, losses: 0 }, ultra: { wins: 0, losses: 0 }, master: { wins: 0, losses: 0 } };
  for (const g of games) {
    const b = bouts.get(g.tournamentId) ?? {
      tournamentId: g.tournamentId, title: g.title, formatName: g.formatName, league: g.league, roster: g.myRoster,
      wins: 0, losses: 0, games: [], placement: g.complete ? placements.get(g.tournamentId) ?? null : null,
    };
    b.games.push(g);
    if (g.won) { b.wins++; byLeague[g.league].wins++; } else { b.losses++; byLeague[g.league].losses++; }
    bouts.set(g.tournamentId, b);
  }
  const wins = games.filter((g) => g.won).length;
  const list = [...bouts.values()];
  return {
    wins, losses: games.length - wins, uniqueOpponents: new Set(games.map((g) => g.opponentId)).size,
    tournaments: list.length, tier: tierFor(wins, games.length), byLeague, bouts: list,
    trophies: list.filter((b) => b.placement && b.placement.place <= 3).sort((a, b) => a.placement!.place - b.placement!.place),
  };
}
