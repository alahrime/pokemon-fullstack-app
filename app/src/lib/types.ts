export interface FastMove {
  id: string;
  name: string;
  power: number;
  turns: number;
  energyGain: number;
  stab: number;
}

// Stat-stage change a charge move applies on resolution — win or shielded,
// since a shield only blocks damage, never the secondary effect. Stages are
// clamped to ±4 by the sim; `chance` is the move's real per-throw probability
// (1 for guaranteed moves like Superpower, as low as .1 for Ancient Power).
export interface MoveBuffs {
  atkStage: number;
  defStage: number;
  target: 'self' | 'opponent';
  chance: number;
}

export interface ChargeMove {
  id: string;
  name: string;
  power: number;
  energy: number;
  stab: number;
  buffs?: MoveBuffs;
}

export interface Species {
  id: string;
  dex: number;
  name: string;
  types: string[];
  atk: number;
  def: number;
  hp: number;
  fastMoves: FastMove[];
  chargeMove: ChargeMove;
  chargeMove2: ChargeMove | null;
  leagues: string[];
  leagueRank: Partial<Record<LeagueId, number>>;
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
  // Stat stages in effect *after* this action resolves (±4), so a timeline
  // can render the buff/debuff state at every frame, not just its own move.
  atkStageA: number;
  defStageA: number;
  atkStageB: number;
  defStageB: number;
  // Set only when this action's move actually rolled its buff/debuff (chance
  // met) — null when the move has no buff, or its chance roll missed.
  buffText: string | null;
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
