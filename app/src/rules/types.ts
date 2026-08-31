import type { LeagueId } from '../lib/types';

/**
 * Schema version of a stored format.
 *
 * Bumped only when a stored document's *meaning* changes. A reader that finds
 * a version it does not know refuses the format rather than guessing, because
 * a misread ruleset silently changes which team is legal.
 */
export const RULES_SCHEMA = 1;

export type Effect = 'allow' | 'deny';

/**
 * One step of the pool pipeline.
 *
 * `select` is a query in the rules subset of the search language (see
 * `selector.ts`). Clause order is significant: the last clause that matches a
 * ref decides its legality, the way .gitignore and iptables resolve.
 */
export interface PoolClause {
  effect: Effect;
  select: string;
  note?: string;
}

/** A count constraint over the members of a team that match `select`. */
export interface Quota {
  select: string;
  min?: number;
  max?: number;
  note?: string;
}

export interface Composition {
  /** Members the roster must hold. */
  size: number;
  /** Members brought into a single battle. Defaults to `size`. */
  bring?: number;
  /** No two members sharing a Pokedex number. */
  uniqueSpecies?: boolean;
  /** No two members from one evolution family. */
  uniqueFamilies?: boolean;
  quotas?: Quota[];
}

export type SelectionMode = 'open' | 'random';

export interface Selection {
  mode: SelectionMode;
  /** Draw only from the top N of the league ranking. Absent → the whole pool. */
  topN?: number;
  /** Slots the player picks; the rest are rolled. Defaults to 0. */
  playerPicks?: number;
  /** Whether the draw also deals each slot's moves. */
  rollMoves?: boolean;
}

export interface Format {
  schema: number;
  base: LeagueId;
  pool: PoolClause[];
  composition: Composition;
  selection: Selection;
}

/**
 * One team member: a ref plus the loadout it is running.
 *
 * The ref carries species and Shadow together (`forretress_shadow`); the moves
 * are what distinguish two builds of the same ref, which is the whole reason a
 * build is not just a ref.
 */
export interface Build {
  ref: string;
  /** Fast move id, as it appears in `Species.fastMoves[].id`. */
  fast: string;
  /** One or two charged move ids. */
  charges: string[];
}

export type Violation =
  | { kind: 'size'; expected: number; actual: number }
  | { kind: 'illegal-ref'; ref: string; clause: number }
  | { kind: 'duplicate-species'; refs: [string, string] }
  | { kind: 'duplicate-family'; refs: [string, string] }
  | { kind: 'quota'; select: string; min?: number; max?: number; actual: number }
  | { kind: 'unknown-move'; ref: string; move: string };

export type Diagnostic =
  | { level: 'error'; kind: 'empty-pool' }
  | { level: 'error'; kind: 'pool-too-small'; need: number; have: number }
  | { level: 'error'; kind: 'unsatisfiable' }
  | { level: 'error'; kind: 'bad-selector'; clause: number; select: string }
  | { level: 'error'; kind: 'random-with-quotas' }
  | { level: 'warn'; kind: 'unsatisfiable-unproven' }
  | { level: 'warn'; kind: 'narrow-pool'; have: number; leagueSize: number }
  | { level: 'warn'; kind: 'dead-clause'; clause: number };
