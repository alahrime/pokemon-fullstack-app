export interface FastMove {
  id: string;
  name: string;
  /** Move type, for the icon and colour. */
  type: string;
  /** PvPoke's own label — "Spam/Bait", "Nuke", "Fast Charge"… */
  archetype: string | null;
  power: number;
  /** Duration in 500ms battle turns. */
  turns: number;
  energyGain: number;
  stab: number;
}

export interface ChargeMove {
  id: string;
  name: string;
  type: string;
  archetype: string | null;
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
  /** CP at level 50 with perfect IVs — the ceiling this form can reach. */
  maxCP: number;
  /** Whether a Shadow variant of this form exists in the game. */
  shadowEligible: boolean;
  fastMoves: FastMove[];
  /** Full charged movepool. */
  chargeMoves: ChargeMove[];
  /** Recommended default pair, from PvPoke's ranked moveset. */
  chargeMove: ChargeMove;
  chargeMove2: ChargeMove | null;
  leagues: string[];
  /** Leagues this form's Shadow qualifies for — tracked apart from `leagues`
   *  because a Shadow's shifted stats make it a distinct opponent. */
  shadowLeagues: string[];
  leagueRank: Partial<Record<LeagueId, number>>;
  /** Ranks of this form's Shadow variant, where it's ranked. */
  shadowLeagueRank: Partial<Record<LeagueId, number>>;
  /**
   * ivKey of the rank-1 roll per league, precomputed by the generator so the
   * engine need not search all 4096 to price an opponent. Absent for species
   * that are in no league. The Shadow shares the key — Shadow rescales attack
   * and defense but does not change which roll wins.
   */
  bestIv?: Partial<Record<LeagueId, number>>;
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
  /**
   * No CP cap. With no cap there is no level/IV trade-off: every mon sits at
   * level 50 and stat product rises monotonically with every IV point, so the
   * 4096 ranking carries no information beyond "more is better" and only
   * near-perfect rolls are worth analysing.
   */
  uncapped: boolean;
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
  /**
   * Battle-stat extremes across the whole 4096. Damage is monotonic in attack
   * and in defense, so these turn "does any threshold exist in this matchup?"
   * into two dmg() calls instead of a scan of every spread.
   */
  atkLo: number;
  atkHi: number;
  defLo: number;
  defHi: number;
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
