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
  charge: ChargeMove;
}

export interface BattleResult {
  win: boolean;
  mine: number;
  theirs: number;
  cmpDecided: boolean;
  margin: number;
}
