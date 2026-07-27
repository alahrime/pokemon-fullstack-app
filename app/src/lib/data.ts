import speciesRaw from '../data/species.json';
import opponentsRaw from '../data/opponents.json';
import opponentCandidatesRaw from '../data/opponentCandidates.json';
import type { League, LeagueId, Species } from './types';

export const SPECIES: Species[] = speciesRaw as Species[];

export const SPECIES_BY_ID: Map<string, Species> = new Map(SPECIES.map((s) => [s.id, s]));

export const OPPONENTS: Record<LeagueId, string[]> = opponentsRaw as Record<LeagueId, string[]>;

// A much broader pool than SPECIES (top 300/league vs. top 60) used only for
// scanning which matchups are worth surfacing as breakpoint/bulkpoint
// opponents - a species can matter for a real threshold (e.g. Toxapex, ranked
// ~100 in Great League) without being meta-relevant enough for the main
// selectable roster.
export const OPPONENT_CANDIDATES: Species[] = opponentCandidatesRaw as Species[];

// Merged lookup for anything used purely as an opponent: the curated roster
// first (richer/likelier to be picked elsewhere too), then the broader pool.
export const OPPONENT_POOL_BY_ID: Map<string, Species> = new Map([
  ...OPPONENT_CANDIDATES.map((s): [string, Species] => [s.id, s]),
  ...SPECIES.map((s): [string, Species] => [s.id, s]),
]);

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

export function opponentCandidatesFor(league: LeagueId): Species[] {
  return OPPONENT_CANDIDATES.filter((s) => s.leagues.includes(league));
}
