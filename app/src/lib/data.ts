import speciesRaw from '../data/species.json';
import opponentsRaw from '../data/opponents.json';
import type { League, LeagueId, Species } from './types';

export const SPECIES: Species[] = speciesRaw as Species[];

export const SPECIES_BY_ID: Map<string, Species> = new Map(SPECIES.map((s) => [s.id, s]));

export const OPPONENTS: Record<LeagueId, string[]> = opponentsRaw as Record<LeagueId, string[]>;

export const LEAGUES: League[] = [
  { id: 'great', label: 'Great 1500', name: 'Great League · 1500', cap: 1500 },
  { id: 'ultra', label: 'Ultra 2500', name: 'Ultra League · 2500', cap: 2500 },
  { id: 'master', label: 'Master', name: 'Master League · no cap', cap: 1e9 },
];

export const LEAGUE_BY_ID: Map<LeagueId, League> = new Map(LEAGUES.map((l) => [l.id, l]));

export function spriteUrl(dex: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
}

export function opponentsFor(league: LeagueId): Species[] {
  return OPPONENTS[league].map((id) => SPECIES_BY_ID.get(id)!).filter(Boolean);
}
