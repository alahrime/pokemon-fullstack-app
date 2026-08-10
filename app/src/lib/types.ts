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
  type: string;
  archetype: string | null;
  power: number;
  energy: number;
  stab: number;
  buffs?: MoveBuffs;
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
  /** PvPoke evolution-family id (FAMILY_POLIWAG), null for standalone forms. */
  family: string | null;
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
  /**
   * Per-league loadout, present only for leagues whose recommended set differs
   * from the pair above. PvPoke rates each league separately and the sets are
   * not interchangeable — 166 of the 787 species ranked in both Great and
   * Ultra get different charged moves there, and 49 a different fast move.
   * Resolve through movesFor() rather than reading this directly.
   */
  leagueMoves?: Partial<Record<LeagueId, { fast: FastMove; charge: ChargeMove; charge2: ChargeMove | null }>>;
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
  /**
   * Same, for the Best Buddy ceiling — present only where the boost actually
   * moves the winner. Opponents are always priced at that ceiling, so this is
   * the index the hot path uses.
   */
  bestIvBB?: Partial<Record<LeagueId, number>>;
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
  /** The Attack stat, i.e. `atk` before the Shadow multiplier. See BattleMon. */
  statAtk: number;
  /** The Defense stat, i.e. `def` before the Shadow multiplier. */
  statDef: number;
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
  /**
   * The same extremes for the Attack *stat*, which is what charge-move
   * priority is decided on. Identical to atkLo/atkHi unless this is a Shadow,
   * where they differ by exactly the x6/5 damage multiplier — and comparing a
   * Shadow's inflated `atk` against an opponent's stat is what made the two
   * forms of one species disagree about CMP. See BattleMon.cmpAtk.
   */
  statAtkLo: number;
  statAtkHi: number;
  defLo: number;
  defHi: number;
}

/**
 * How a player decides whether to spend a shield.
 *
 * The choice is most of what separates good play from adequate play, and it is
 * the mechanism by which baiting works at all. Against `always`, a cheap
 * charged move reliably draws a shield and the expensive one lands free — so
 * baiting is strictly free, which is not the game. Against `read`, the bait
 * gets taken on the chin and the shield is kept for what actually hurts, and
 * the attacker's whole plan has to be different.
 *
 * Matchups flip on this. Simulating both is how a flip becomes visible instead
 * of being silently decided by whichever policy the engine happened to hold.
 */
export type ShieldPolicy = 'always' | 'read';

export interface BattleMon {
  atk: number;
  /**
   * The Attack *stat*, which is `atk` without the Shadow damage multiplier.
   *
   * Shadow's x6/5 attack and x5/6 defence are combat modifiers applied in the
   * damage formula, not changes to the stats themselves — which is why a
   * Shadow has exactly its plain form's CP and stat-product rank, as `getTable`
   * already relies on. Charge-move priority is a comparison of Attack *stats*,
   * so it reads this and not `atk`; every damage figure reads `atk`.
   *
   * Equal to `atk` for everything that is not a Shadow.
   */
  cmpAtk: number;
  def: number;
  hp: number;
  /** Defender typing, for the effectiveness term in dmg(). */
  types: readonly string[];
  fast: FastMove;
  // Every charge move this mon has equipped. Order is not significant —
  // classifyCharges sorts by damage per energy to pick main, and takes the
  // secondary from what remains.
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
  /**
   * Energy and shields as the fight ended.
   *
   * A single matchup has no use for these — it is over. A team does: the mon
   * that wins carries its leftover HP and energy into the next opponent, and
   * shields in GBL belong to the player for the whole battle rather than to
   * each Pokemon. Without these a chain has to restart every matchup from
   * scratch, which is a different game from the one being played.
   */
  energyA: number;
  energyB: number;
  shieldsA: number;
  shieldsB: number;
  log: BattleLogEntry[];
}
