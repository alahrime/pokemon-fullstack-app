export interface FastMove {
  id: string;
  name: string;
  power: number;
  turns: number;
  energyGain: number;
  stab: number;
}

export interface ChargeMove {
  id: string;
  name: string;
  power: number;
  energy: number;
  stab: number;
}

export interface Species {
  id: string;
  dex: number;
  name: string;
  /** Sprite slug (form-aware). See lib/data.ts spriteUrl. */
  sprite: string;
  types: string[];
  atk: number;
  def: number;
  hp: number;
  /** Subset of PvPoke tags worth surfacing: legendary, mythical, mega, etc. */
  tags: string[];
  /** Whether a Shadow variant of this form exists in the game. */
  shadowEligible: boolean;
  fastMoves: FastMove[];
  /** Full charged movepool. */
  chargeMoves: ChargeMove[];
  /** Recommended default pair, from PvPoke's ranked moveset. */
  chargeMove: ChargeMove;
  chargeMove2: ChargeMove | null;
  leagues: string[];
  leagueRank: Partial<Record<LeagueId, number>>;
  /** Ranks of this form's Shadow variant, where it's ranked. */
  shadowLeagueRank: Partial<Record<LeagueId, number>>;
}

/**
 * A roster selection: a species plus whether the Shadow variant is chosen.
 * Serialised as `${id}_shadow` so it round-trips with PvPoke's own ids.
 */
export interface SpeciesRef {
  id: string;
  shadow: boolean;
}

export type LeagueId = 'great' | 'ultra' | 'master';

export interface League {
  id: LeagueId;
  label: string;
  name: string;
  cap: number;
}

export interface IV {
  a: number;
  d: number;
  s: number;
}

export interface StatLine {
  atk: number;
  def: number;
  hp: number;
  cp: number;
  lvl: number;
  sp: number;
}

export interface RankedEntry extends StatLine {
  a: number;
  d: number;
  s: number;
  rank: number;
}

export interface SpeciesTable {
  all: RankedEntry[];
  map: Map<number, RankedEntry>;
  best: RankedEntry;
  worst: RankedEntry;
  league: League;
  species: Species;
}

export interface BattleMon {
  atk: number;
  def: number;
  hp: number;
  fast: FastMove;
  // Every charge move this mon has equipped, cheapest energy cost first.
  // charges[0] is the "bait" candidate when 2+ are present and there's a
  // more expensive, harder-hitting option to save for once shields are gone.
  charges: ChargeMove[];
}

export interface BattleLogEntry {
  turn: number;
  actor: 'A' | 'B';
  kind: 'fast' | 'charge';
  moveName: string;
  bait: boolean;
  shielded: boolean;
  damage: number;
  hpA: number;
  hpB: number;
  energyA: number;
  energyB: number;
}

export interface BattleResult {
  win: boolean;
  mine: number;
  theirs: number;
  hpA: number;
  hpB: number;
  maxHpA: number;
  maxHpB: number;
  cmpDecided: boolean;
  margin: number;
  log: BattleLogEntry[];
}
