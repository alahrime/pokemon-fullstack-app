import { BB_MAX_LEVEL_IDX, CPM, LVL, MAX_LEVEL_IDX } from './cpm';
import { typeEffectiveness } from './typeChart';
import {
  LEAGUE_BY_ID,
  OPPONENT_POOL_BY_ID,
  SPECIES_BY_ID,
  movesFor,
  opponentCandidatesFor,
  opponentsFor,
  parseRef,
  rankOfRef,
} from './data';
import type {
  MoveBuffs,
  BattleForms,
  BattleLogEntry,
  BattleMon,
  BattleResult,
  ChargeMove,
  FastMove,
  IV,
  League,
  LeagueId,
  RankedEntry,
  ShieldPolicy,
  Species,
  SpeciesTable,
  StatLine,
} from './types';

export function ivKey(iv: IV): number {
  return iv.a * 256 + iv.d * 16 + iv.s;
}

function statsAt(species: Species, iv: IV, cpm: number) {
  return {
    atk: (species.atk + iv.a) * cpm,
    def: (species.def + iv.d) * cpm,
    hRaw: (species.hp + iv.s) * cpm,
    h: Math.floor((species.hp + iv.s) * cpm),
  };
}

function cpOf(s: { atk: number; def: number; hRaw: number }): number {
  return Math.max(10, Math.floor((s.atk * Math.sqrt(s.def) * Math.sqrt(s.hRaw)) / 10));
}

export function bestAt(species: Species, iv: IV, league: League, maxIdx = MAX_LEVEL_IDX): StatLine {
  // Uncapped (Master): the top level always fits, so take it without
  // searching. The walk got this in one step and a binary search would spend
  // ~7, which measurably slowed Master's table build.
  {
    const s = statsAt(species, iv, CPM[maxIdx]);
    const cp = cpOf(s);
    if (cp <= league.cap) {
      const hp = Math.max(10, s.h);
      return { lvl: LVL(maxIdx), cp, atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
    }
  }
  // CP rises monotonically with level, so the highest level under the cap is a
  // binary search, not a walk down from 50. The walk cost up to 79 statsAt/cpOf
  // pairs (two sqrt each) for every one of the 4096 spreads in every table;
  // this is ~7. Same answer — the predicate is unchanged, only how we find the
  // boundary.
  let lo = 0;
  let hi = maxIdx;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cpOf(statsAt(species, iv, CPM[mid])) <= league.cap) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found >= 0) {
    const s = statsAt(species, iv, CPM[found]);
    const hp = Math.max(10, s.h);
    return { lvl: LVL(found), cp: cpOf(s), atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
  }
  const s = statsAt(species, iv, CPM[0]);
  const hp = Math.max(10, s.h);
  return { lvl: 1, cp: cpOf(s), atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
}

/**
 * Every form's battle stats for one roll, for a species that changes form.
 *
 * PvPoke's getFormStats: a form with the same base stats (Morpeko, Mimikyu,
 * Cramorant) keeps the roll's stats. Aegislash Blade does not - its level is
 * derived from Shield's (x0.5 + 1 in Great, x0.75 in Ultra), then stepped down
 * a whole level at a time until it fits under the cap. HP never changes.
 */
function formsAt(
  species: Species, iv: IV, line: StatLine, league: League,
): BattleForms | undefined {
  if (!species.forms) return undefined;
  const by: BattleForms['by'] = {};
  for (const [id, f] of Object.entries(species.forms)) {
    let atk = line.atk, def = line.def;
    if (f.atk !== species.atk || f.def !== species.def) {
      let lvl = line.lvl;
      if (id === 'aegislash_blade') {
        lvl = league.cap === 1500 ? Math.ceil(lvl * 0.5) + 1 : league.cap === 2500 ? Math.ceil(lvl * 0.75) : lvl;
      }
      const form = { ...species, atk: f.atk, def: f.def };
      let s = statsAt(form, iv, CPM[(lvl - 1) * 2]);
      while (cpOf(s) > league.cap && lvl > 1) s = statsAt(form, iv, CPM[(--lvl - 1) * 2]);
      atk = s.atk;
      def = s.def;
    }
    // No form-changer has a Shadow, so these are the stats themselves.
    by[id] = { ...f, atk, cmpAtk: atk, def };
  }
  return { start: species.id, by };
}

/**
 * Can a Best Buddy boost actually reach past level 50 here?
 *
 * The highest level any roll attains is the one with the *lowest* CP — 0/0/0 —
 * because level is bought until the cap stops you, so the weakest roll buys the
 * most. If even that cannot clear 50, no roll in the 4096 can, and the boost is
 * inert for this species in this league.
 *
 * This is why the toggle is not simply "add two levels": in Great, four out of
 * five members sit so far below the ceiling (top-rank levels run down to 12.5)
 * that Best Buddy changes nothing, and pretending otherwise would rebuild every
 * table for no difference.
 */
const bbEligibleCache = new Map<string, boolean>();
export function bestBuddyEligible(species: Species, league: League): boolean {
  const key = `${species.id}|${league.id}`;
  const hit = bbEligibleCache.get(key);
  if (hit !== undefined) return hit;
  const out = bestAt(species, { a: 0, d: 0, s: 0 }, league, BB_MAX_LEVEL_IDX).lvl > 50;
  bbEligibleCache.set(key, out);
  return out;
}

/** Level ceiling to build a table with, honouring both the toggle and eligibility. */
function levelCapIdx(species: Species, league: League, bestBuddy: boolean): number {
  return bestBuddy && bestBuddyEligible(species, league) ? BB_MAX_LEVEL_IDX : MAX_LEVEL_IDX;
}

/**
 * Damage for one hit.
 *
 * floor(0.5 * power * atk/def * STAB * effectiveness) + 1. The effectiveness
 * term was missing entirely, which made every off-type move hit for neutral:
 * Lickitung's Lick is a Ghost move and Normal is immune to Ghost, so it was
 * dealing roughly double what it should while also being wrongly granted STAB.
 * Defender typing is required rather than optional so a call site cannot
 * silently fall back to neutral again.
 */
/**
 * Trainer Battle damage bonus.
 *
 * PvP is not the raid formula. The game applies an extra x1.3 to every hit in
 * a Trainer Battle, and PvPoke carries it as `bonusMultiplier` in Battle.js.
 * We did not have it at all, so every damage figure this engine produced was
 * ~23% low and every fight ran correspondingly long — which handed extra fast
 * moves, and therefore extra energy and extra charged moves, to both sides.
 *
 * Caught from a reported matchup: Rollout should hit a 136.6-defence Azumarill
 * for 4, and we said 3. floor(0.5 * 7 * 104.3/136.6 * 1.3) + 1 = 4 exactly,
 * against 3 without it.
 */
//
// The multipliers are the game's float32 values widened to double, exactly as
// PvPoke's DamageMultiplier carries them, and multiplied in PvPoke's order.
// Both matter only when a product lands on an integer before the floor - which
// is exactly when a breakpoint is being asked about.
export const PVP_BONUS = Math.fround(1.3);
const STAB_F32 = Math.fround(1.2);
const SE_F32 = Math.fround(1.6);

export function dmg(
  atk: number,
  def: number,
  move: FastMove | ChargeMove,
  defTypes: readonly string[],
): number {
  const eff = typeEffectiveness(move.type, defTypes, SE_F32);
  const stab = move.stab === 1 ? 1 : STAB_F32;
  return Math.floor(move.power * stab * (atk / def) * eff * 0.5 * PVP_BONUS) + 1;
}

/**
 * Shadow multipliers, as the game applies them: ×6/5 attack, ×5/6 defense.
 *
 * Defense is PvPoke's float32 0.83333331, not an exact 5/6. Neither touches a
 * Shadow's stat product or its rank within the 4096, and CP is derived from
 * base stats and IVs before any Shadow adjustment. So the multipliers are
 * applied *after* sp/cp/rank are
 * computed, touching only the battle stats that feed damage, breakpoints,
 * bulkpoints and the simulator.
 *
 * The practical upshot, worth knowing when reading the report: going Shadow
 * never moves your rank. It moves every damage threshold.
 */
export const SHADOW_ATK_MULT = 6 / 5;
export const SHADOW_DEF_MULT = 0.83333331;

// ── Stat stages (attack/defence buffs and debuffs) ────────────────────────
//
// Roughly 90 charged moves raise or lower a stat on use — Superpower drops
// your own attack and defence, Acid Spray guts the opponent's, Ancient Power
// occasionally raises everything. Modelled as stages rather than multipliers
// because that is what the game tracks: clamped to ±4, with an asymmetric
// table where +1 is 1.25x but -1 is 0.8x rather than 1/1.25.
export const STAGE_MIN = -4;
export const STAGE_MAX = 4;

export function buffMultiplier(stage: number): number {
  const s = Math.max(STAGE_MIN, Math.min(STAGE_MAX, stage));
  return s >= 0 ? (4 + s) / 4 : 4 / (4 - s);
}

const clampStage = (n: number): number => Math.max(STAGE_MIN, Math.min(STAGE_MAX, n));

/**
 * Chance-gated buffs are applied at their expected value, not rolled.
 *
 * 64 of the 145 buff-carrying moves land their effect only some of the time —
 * Ancient Power is 10%, Crunch 30%. The obvious model is a seeded PRNG, and it
 * is wrong here in a way that took a rebuild to see: `battle()` must be a pure
 * function of its inputs (flipGrid calls it once per IV combination, up to 4096
 * times for the same moveset, and those cells are only comparable if the rolls
 * match), so the seed has to be fixed — and a fixed seed means every battle
 * replays the *same* sequence. The first draw from ours was 0.0211, so every
 * 10% move landed its buff on its first throw in every single battle. The
 * distribution was fine at 9.93% over a long run; it was the per-battle
 * restart that made it a systematic bias, and it inflated the Ancient Power
 * carriers by 500+ ranking places before it was caught.
 *
 * A fractional stage (10% of +2 applied as +0.2) replaced the PRNG, and is
 * now replaced in turn by what PvPoke's simulator does (Battle.js): no roll at
 * all, but a meter per move that starts at its chance - at 0 for a 50% move -
 * and gains the chance on every use, the effect landing in full each time the
 * meter crosses a whole number. A 50% move lands on its 2nd use, 30% on its
 * 3rd, 10% on its 10th (in practice never). Deterministic and pure per battle,
 * which is all the PRNG was reaching for, and the same fights PvPoke reports.
 */

/** Human-readable summary of a buff that landed, for the battle log. */
function describeBuff(buffs: MoveBuffs, dAtk: number, dDef: number, selfLabel: string, oppLabel: string): string {
  const fmt = (n: number) => `${n > 0 ? '+' : ''}${n}`;
  const parts: string[] = [];
  if (dAtk) parts.push(`Atk ${fmt(dAtk)}`);
  if (dDef) parts.push(`Def ${fmt(dDef)}`);
  const gated = buffs.chance < 1 ? ` (${Math.round(buffs.chance * 100)}% move)` : '';
  return `${buffs.target === 'self' ? selfLabel : oppLabel} ${parts.join(', ')}${gated}`;
}

const tableCache = new Map<string, SpeciesTable>();

/**
 * Tables are keyed by *ref*, not plain species id - `machamp` and
 * `machamp_shadow` are separate tables. Parsing the suffix here rather than
 * threading a boolean means every existing call site (opponents, flip grids,
 * rulers, the simulator) supports Shadow without a signature change.
 */
export function getTable(ref: string, leagueId: LeagueId, bestBuddy = false): SpeciesTable {
  const key = `${ref}|${leagueId}|${bestBuddy ? 'bb' : ''}`;
  const cached = tableCache.get(key);
  if (cached) return cached;

  const { id, shadow } = parseRef(ref);
  const species = OPPONENT_POOL_BY_ID.get(id)!;
  const league = LEAGUE_BY_ID.get(leagueId)!;
  const maxIdx = levelCapIdx(species, league, bestBuddy);
  const aMult = shadow ? SHADOW_ATK_MULT : 1;
  const dMult = shadow ? SHADOW_DEF_MULT : 1;
  const all: RankedEntry[] = [];
  for (let a = 0; a < 16; a++) {
    for (let d = 0; d < 16; d++) {
      for (let s = 0; s < 16; s++) {
        const r = bestAt(species, { a, d, s }, league, maxIdx);
        // sp / cp / lvl stay on the unadjusted stats; only the battle stats
        // scale. `statAtk`/`statDef` are the Attack and Defense stats
        // themselves: Shadow's 6/5 and 5/6 are damage multipliers, not changes
        // to the stats, so charge-move priority compares these (see
        // BattleMon.cmpAtk) and so does anything that displays a stat.
        all.push({
          a, d, s, ...r,
          atk: r.atk * aMult, statAtk: r.atk,
          def: r.def * dMult, statDef: r.def,
          rank: 0,
          forms: formsAt(species, { a, d, s }, r, league),
        });
      }
    }
  }
  // Stat-product ties are common — HP is floored, so e.g. 15/15/14 and
  // 15/15/15 frequently produce an identical product. A plain `y.sp - x.sp`
  // sort then resolved them by insertion order, which put the *lower* IV
  // first: 211 species reported a rank-1 of 15/15/14 in Master purely as a
  // sort artifact. On a tie, prefer the strictly better roll — higher IV
  // total, then HP, then defense — so rank 1 is the spread you'd actually want.
  const sorted = all
    .slice()
    .sort(
      (x, y) =>
        y.sp - x.sp ||
        y.a + y.d + y.s - (x.a + x.d + x.s) ||
        y.s - x.s ||
        y.d - x.d ||
        y.a - x.a,
    );
  sorted.forEach((e, i) => {
    e.rank = i + 1;
  });
  const map = new Map<number, RankedEntry>();
  let atkLo = Infinity;
  let atkHi = -Infinity;
  let statAtkLo = Infinity;
  let statAtkHi = -Infinity;
  let defLo = Infinity;
  let defHi = -Infinity;
  sorted.forEach((e) => {
    map.set(ivKey(e), e);
    if (e.atk < atkLo) atkLo = e.atk;
    if (e.atk > atkHi) atkHi = e.atk;
    if (e.statAtk < statAtkLo) statAtkLo = e.statAtk;
    if (e.statAtk > statAtkHi) statAtkHi = e.statAtk;
    if (e.def < defLo) defLo = e.def;
    if (e.def > defHi) defHi = e.def;
  });
  const out: SpeciesTable = {
    all: sorted,
    map,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    league,
    species,
    atkLo,
    atkHi,
    statAtkLo,
    statAtkHi,
    defLo,
    defHi,
  };
  tableCache.set(key, out);
  return out;
}

export function getEntry(
  ref: string,
  iv: IV,
  leagueId: LeagueId,
  bestBuddy = false,
): { entry: RankedEntry; table: SpeciesTable } {
  const table = getTable(ref, leagueId, bestBuddy);
  return { entry: table.map.get(ivKey(iv))!, table };
}

// ── Opponent representative — the opponent's own rank-1 stat-product spread
// (not a blanket hundo assumption), primary fast move and charge move as the
// incoming attack. Sourced from the broad opponent pool (top ~300/league),
// not just the curated main roster, so a real but niche threshold isn't
// excluded for being outside the top-60 meta cut. ──
//
// Every species' realistic "best" roll is different - rank 1 is frequently
// NOT 15/15/15 (a low attack IV often trades a hair of damage for enough
// extra bulk/level headroom to raise the overall stat product under a CP
// cap), so representing every opponent with a uniform hundo overstates their
// attack and understates their bulk. Using each species' own table.best
// keeps the comparison "relative to itself."
export interface OpponentInfo {
  /** The ref, Shadow suffix included - round-trips with state and selection. */
  id: string;
  /** Level of this opponent's rank-1 roll; >50 means a Best Buddy boost. */
  lvl: number;
  dex: number;
  name: string;
  /** Sprite slug of the underlying form (Shadows reuse the base artwork). */
  sprite: string;
  shadow: boolean;
  types: string[];
  atk: number;
  /** Attack stat, i.e. `atk` without Shadow's damage multiplier. See BattleMon.cmpAtk. */
  statAtk: number;
  def: number;
  /** Defense stat, i.e. `def` without Shadow's damage multiplier. */
  statDef: number;
  hp: number;
  fastMove: FastMove;
  chargeMove: ChargeMove;
  chargeMove2: ChargeMove | null;
  forms?: BattleForms;
}

// Every charge move a mon actually has equipped, for the battle simulator's
// bait-vs-nuke decision. A single move is returned as-is (no bait choice to
// make).
export function chargesOf(chargeMove: ChargeMove, chargeMove2: ChargeMove | null): ChargeMove[] {
  return chargeMove2 ? [chargeMove, chargeMove2] : [chargeMove];
}

/**
 * Resolve a chosen charged-move set against a species' full movepool.
 *
 * An empty or unresolvable selection falls back to PvPoke's recommended pair,
 * so state that predates movepool selection - or a selection carried over from
 * a different species - still produces a valid mon rather than an empty one.
 */
export function selectedCharges(species: Species, ids?: string[]): ChargeMove[] {
  if (!ids || ids.length === 0) return chargesOf(species.chargeMove, species.chargeMove2);
  const picked = ids
    .map((id) => species.chargeMoves.find((m) => m.id === id))
    .filter((m): m is ChargeMove => !!m);
  return picked.length ? picked : chargesOf(species.chargeMove, species.chargeMove2);
}

// ══════════════════════════════════════════════════════════════════════════
// Move economics
//
// Everything a player compares moves on is a ratio, and all of them fall out
// of four numbers: power, energy, turns and STAB. Displayed damage is always
// STAB-adjusted — Lickilicky's Body Slam reads 66, not its raw 55.
// ══════════════════════════════════════════════════════════════════════════

/** In-game energy ceiling. Overflow past this is lost, not banked. */
export const ENERGY_CAP = 100;


/**
 * What full HP is worth on that same scale — the health term of `rating`.
 *
 * Duplicated as a named constant rather than the literal 500 so the farm-down
 * trade reads as the comparison it is.
 */
export const HP_WEIGHT = 500;

export interface FastMoveStats {
  /** STAB-adjusted power. */
  damage: number;
  /** Battle turns; one turn is 500ms. */
  turns: number;
  seconds: number;
  energyGain: number;
  /** Damage per turn. */
  dpt: number;
  /** Energy per turn — the number that decides how fast you reach a charge move. */
  ept: number;
}

export function fastMoveStats(m: FastMove): FastMoveStats {
  const damage = m.power * m.stab;
  return {
    damage,
    turns: m.turns,
    seconds: m.turns * 0.5,
    energyGain: m.energyGain,
    dpt: damage / m.turns,
    ept: m.energyGain / m.turns,
  };
}

export interface ChargeMoveStats {
  /** STAB-adjusted power. */
  damage: number;
  energy: number;
  /** Damage per energy — the standard efficiency measure. */
  dpe: number;
}

export function chargeMoveStats(m: ChargeMove): ChargeMoveStats {
  const damage = m.power * m.stab;
  return { damage, energy: m.energy, dpe: m.energy > 0 ? damage / m.energy : 0 };
}

/**
 * How many fast moves each successive charge move costs.
 *
 * The first throw starts from empty, but every throw after it begins with
 * whatever energy overflowed the last one — you almost never land exactly on
 * the cost. That residue accumulates, so the count drifts down and eventually
 * cycles.
 *
 * Lickilicky is the worked example: Rollout gains 13, Body Slam costs 35, so
 * the sequence is 3-3-3-2. Three Rollouts bank 39 for the first throw, leaving
 * 4; by the fourth throw enough residue has piled up that two Rollouts suffice.
 * Solar Beam at 80 gives 7-6-6-6 for the same reason.
 *
 * Energy is capped at 100 in game, so surplus past that is dropped rather than
 * carried — it can't matter at these numbers, but the cap is the rule.
 */
export function fastMoveCounts(fast: FastMove, charge: ChargeMove, throws = 4): number[] {
  if (fast.energyGain <= 0) return [];
  const out: number[] = [];
  let energy = 0;
  for (let i = 0; i < throws; i++) {
    const need = Math.max(0, charge.energy - energy);
    const n = Math.ceil(need / fast.energyGain);
    energy = Math.min(ENERGY_CAP, energy + n * fast.energyGain) - charge.energy;
    out.push(n);
  }
  return out;
}

/**
 * The rank-1 spread only, without building the full 4096 table.
 *
 * Opponents need exactly three numbers — the attack, defense and HP of their
 * best roll — but getTable allocates 4096 entry objects, sorts them and builds
 * a lookup Map. That was fine for a 211-species pool; the CP-based pool is 958
 * in Great, where the full tables cost well over a second on first scan.
 *
 * Same search, same tie-break as getTable, no retained structures.
 */
const bestCache = new Map<string, StatLine & { a: number; d: number; s: number; statAtk: number; statDef: number }>();

export function bestSpreadFor(
  ref: string,
  leagueId: LeagueId,
  bestBuddy = false,
): StatLine & { a: number; d: number; s: number; statAtk: number; statDef: number; forms?: BattleForms } {
  const key = `${ref}|${leagueId}|${bestBuddy ? 'bb' : ''}`;
  const hit = bestCache.get(key);
  if (hit) return hit;

  const { id, shadow } = parseRef(ref);
  const species = OPPONENT_POOL_BY_ID.get(id)!;
  const league = LEAGUE_BY_ID.get(leagueId)!;
  const maxIdx = levelCapIdx(species, league, bestBuddy);
  let best: (StatLine & { a: number; d: number; s: number }) | null = null;

  // The generator records which roll wins (scripts/build-best-spreads.ts), so
  // the usual path is one bestAt rather than 4096. Two indexes: the level-50
  // winner and, where the boost moves it, the Best Buddy one. bestIvBB is only
  // stored when it differs, so fall back to bestIv when it is absent. The
  // search below still runs for a species outside every league, or data
  // generated before the index existed.
  const boosted = maxIdx !== MAX_LEVEL_IDX;
  const key4096 = boosted
    ? (species.bestIvBB?.[leagueId] ?? species.bestIv?.[leagueId])
    : species.bestIv?.[leagueId];
  if (key4096 !== undefined) {
    const a = (key4096 >> 8) & 15;
    const d = (key4096 >> 4) & 15;
    const s = key4096 & 15;
    best = { ...bestAt(species, { a, d, s }, league, maxIdx), a, d, s };
  } else {
    for (let a = 0; a < 16; a++) {
      for (let d = 0; d < 16; d++) {
        for (let s = 0; s < 16; s++) {
          const r = bestAt(species, { a, d, s }, league, maxIdx);
          if (
            !best ||
            r.sp > best.sp ||
            // Same tie-break as getTable: prefer the strictly better roll.
            (r.sp === best.sp && a + d + s > best.a + best.d + best.s)
          ) {
            best = { ...r, a, d, s };
          }
        }
      }
    }
  }

  // `statAtk`/`statDef` are the stats themselves, so they are the unmultiplied
  // figures either way.
  const out = shadow
    ? {
        ...best!,
        atk: best!.atk * SHADOW_ATK_MULT, statAtk: best!.atk,
        def: best!.def * SHADOW_DEF_MULT, statDef: best!.def,
      }
    : { ...best!, statAtk: best!.atk, statDef: best!.def };
  const forms = formsAt(species, best!, best!, league);
  if (forms) Object.assign(out, { forms });
  bestCache.set(key, out);
  return out;
}

/**
 * An opponent, always priced at the strongest roll it could actually field.
 *
 * Best Buddy is not optional here, and deliberately not tied to the toggle.
 * The board answers "does my roll decide this matchup", and that has to hold
 * against the bulkiest version of the opponent you might meet — someone
 * walking their Registeel is a thing that happens. Pricing opponents at 50
 * while they can field 51 would quietly overstate your breakpoints.
 *
 * The toggle governs *your* spread only. Opponents that cannot exceed 50 are
 * built at 50, so this is a ceiling, not a blanket boost.
 */
export function opponentInfo(ref: string, leagueId: LeagueId): OpponentInfo {
  const { id, shadow } = parseRef(ref);
  const species = OPPONENT_POOL_BY_ID.get(id)!;
  // Carries the Shadow multipliers already when ref is a Shadow.
  const best = bestSpreadFor(ref, leagueId, true);
  return {
    id: ref,
    lvl: best.lvl,
    dex: species.dex,
    name: shadow ? `${species.name} (Shadow)` : species.name,
    sprite: species.sprite,
    shadow,
    types: species.types,
    atk: best.atk,
    statAtk: best.statAtk,
    def: best.def,
    statDef: best.statDef,
    hp: best.hp,
    forms: best.forms,
    // Resolved per league: an opponent runs the set that league rates, not
    // whichever one happened to be read first when the data was generated.
    ...(() => {
      const { fast, charges } = movesFor(species, leagueId);
      return { fastMove: fast, chargeMove: charges[0], chargeMove2: charges[1] ?? null };
    })(),
  };
}

/**
 * Strongest attack, defence and HP anywhere in a league's pool.
 *
 * Gives the hero bars a reference that means something. Scaling each stat
 * against the other two would only show a shape; scaling against the league
 * says where this Pokemon actually sits — a full attack bar is the hardest
 * hitter in the format, not merely a mon whose attack beats its own defence.
 *
 * Cheap: opponentInfo is already memoised per (ref, league), so the first call
 * walks a list that is almost entirely cache hits.
 */
const leagueRangeCache = new Map<string, { atk: number; def: number; hp: number }>();
export function leagueStatRange(leagueId: LeagueId) {
  const key = leagueId;
  const hit = leagueRangeCache.get(key);
  if (hit) return hit;
  let atk = 0;
  let def = 0;
  let hp = 0;
  for (const ref of opponentCandidatesFor(leagueId)) {
    const i = opponentInfo(ref, leagueId);
    if (i.atk > atk) atk = i.atk;
    if (i.def > def) def = i.def;
    if (i.hp > hp) hp = i.hp;
  }
  const out = { atk, def, hp };
  leagueRangeCache.set(key, out);
  return out;
}

export function opponentList(leagueId: LeagueId): Species[] {
  return opponentsFor(leagueId);
}

// ── Does a real breakpoint/bulkpoint exist for this pairing, across every
// reachable stat in the 4096 spread? A flat pairing (same rounded damage no
// matter the IV roll) isn't a relevant matchup to surface. ──
/**
 * Does any spread in the table deal different damage than any other?
 *
 * dmg() is floor(k * atk / def) + 1 with k positive, so it is monotonic in
 * attack and in defense. "More than one distinct value across the 4096" is
 * therefore exactly "the value at the extreme differs from the value at the
 * other extreme" — two dmg() calls rather than a scan with a Set, which these
 * did once per opponent per scan and which dominated the relevance profile.
 */
export function hasBreakpoint(table: SpeciesTable, move: FastMove, oppDef: number, oppTypes: readonly string[]): boolean {
  return dmg(table.atkLo, oppDef, move, oppTypes) !== dmg(table.atkHi, oppDef, move, oppTypes);
}

export function hasBulkpoint(table: SpeciesTable, oppAtk: number, oppFastMove: FastMove, myTypes: readonly string[]): boolean {
  // Higher defense means less damage taken, so the extremes are swapped.
  return dmg(oppAtk, table.defHi, oppFastMove, myTypes) !== dmg(oppAtk, table.defLo, oppFastMove, myTypes);
}

export type RelevanceKind = 'break' | 'bulk' | 'either';

// ══════════════════════════════════════════════════════════════════════════
// Nuanced opponent selection
//
// The old filter asked "does any damage number change across the 4096?" That
// over-selects (about half of all matchups have *some* bulkpoint) and, worse,
// it under-selects: it threw away matchups with no threshold at all that are
// nonetheless decided by IVs. Two real cases it missed —
//
//   1. CMP. Simultaneous charge moves resolve by raw attack (see battle()'s
//      `a.atk >= b.atk`). So the threshold is *exactly* the opponent's attack
//      stat. If your 4096 attack range straddles it, some spreads throw first
//      and some don't, which can flip a shielded scenario outright. Sableye
//      into Feraligatr is the canonical one.
//   2. HP. Surviving one extra fast hit is a function of total HP, not of
//      damage-per-hit, so a matchup can flip with no breakpoint or bulkpoint
//      anywhere in it.
//
// So instead of asking about thresholds, we ask the question the player
// actually has: *does my IV roll change who wins?* That means simulating.
//
// Cost control: simulating all 4096 spreads against ~200 candidates across 3
// shield scenarios is millions of battles. Outcomes are near-monotonic in the
// underlying stats, so we probe the extremes of the space plus the two
// spreads straddling the CMP threshold — the points where a flip can occur —
// and check whether the verdict differs between them.
// ══════════════════════════════════════════════════════════════════════════

/** Why a matchup is worth a player's attention, strongest signal first. */
export interface OpponentRelevance {
  info: OpponentInfo;
  score: number;
  /** Shield counts (0/1/2, symmetric) where the IV roll changes who wins. */
  flipShields: number[];
  /** Opponent's attack sits inside our reachable attack range, so IVs decide CMP. */
  cmpContested: boolean;
  /** Rank of the best spread that wins charge-move priority, null if unaffordable. */
  cmpCost: number | null;
  hasBreak: boolean;
  hasBulk: boolean;
  /** Tightest absolute HP margin seen across probes, in percent. */
  closest: number;
  /** Short human-readable justification for the chip. */
  reason: string;
}

/**
 * Where probe spreads come from.
 *
 * Two failure modes had to be avoided, and they pull in opposite directions:
 *
 *   Too wide. Probing the true corners (15/0/0 against 0/15/15) flips almost
 *   every matchup — an early run had every candidate reporting "flips at 0, 1
 *   and 2 shields", which is technically true and completely useless.
 *
 *   Too narrow. Restricting to the top 5% by stat product silently discards
 *   the high-attack rolls, because attack costs stat product. That threw away
 *   the single most interesting case: Sableye's cheapest spread that wins CMP
 *   against Feraligatr is rank 247 — clearly keepable — but its attack sits
 *   above everything in the top 5%, so the matchup vanished entirely.
 *
 * So the bulk/attack extremes are drawn from a competitive band, while the CMP
 * straddle is found over the *whole* table and admitted only if the spread
 * that wins it is one you'd actually keep. That also yields the rank you'd
 * have to accept, which is the real decision.
 */
const PROBE_BAND = 0.25;
/** Matches verdictLine's "usable" cutoff — beyond this, it isn't a real option. */
const KEEPABLE_RANK = 1500;

/**
 * Minimum IV worth considering in an uncapped league.
 *
 * Great and Ultra reward a deliberately low attack IV — it buys extra level
 * under the cap — so the whole 4096 is legitimately in play. Master has no cap
 * and no such trade-off: every mon sits at level 50 and every IV point is
 * strictly better, so a sub-perfect roll is never a *choice*, just a worse
 * Pokémon. Probing 15/15/0 against 15/0/15 there would manufacture "flips"
 * between two spreads no serious player would field.
 */
const UNCAPPED_IV_FLOOR = 13;

/**
 * How far down the stat-product ranking a default spread may sit, and how
 * close to the cap it has to be.
 *
 * Rank 1 is a real spread but not always a played one: it maximises stat
 * product, which sometimes means leaving CP on the table. What people actually
 * field is a roll that is both near the top of the ranking and pushed hard
 * against the cap — so the default takes the best-ranked spread inside the top
 * band whose CP is within a few points of the limit.
 */
const DEFAULT_RANK_BAND = 30;
const DEFAULT_CP_SLACK = 5;

/**
 * The spread the app fields when nobody has chosen one.
 *
 * Master is exempt by construction: with no cap there is no level/IV trade-off,
 * every point is strictly better, and rank 1 is 15/15/15 — the band and the CP
 * rule would both select it anyway, but saying so directly is cheaper and
 * cannot drift.
 *
 * Capped leagues: the first spread in the top #{DEFAULT_RANK_BAND} that comes
 * within {DEFAULT_CP_SLACK} CP of the cap. Falling back through the band's
 * highest CP and then rank 1 means a species whose whole table sits well under
 * the cap — anything that maxes out before the limit — still gets its best
 * roll rather than nothing.
 */
export function defaultSpreadFor(ref: string, leagueId: LeagueId, bestBuddy = false): RankedEntry {
  const table = getTable(ref, leagueId, bestBuddy);
  if (table.league.uncapped) return table.map.get(ivKey({ a: 15, d: 15, s: 15 }))!;
  const band = table.all.slice(0, DEFAULT_RANK_BAND);
  const near = band.find((e) => e.cp >= table.league.cap - DEFAULT_CP_SLACK);
  if (near) return near;
  let highest = band[0];
  for (const e of band) if (e.cp > highest.cp) highest = e;
  return highest ?? table.best;
}

type ProbeLabel = 'rank1' | 'atk' | 'def' | 'hp' | 'cmp+' | 'cmp-';

interface Probe {
  label: ProbeLabel;
  entry: RankedEntry;
}

interface ProbeSet {
  probes: Probe[];
  /** Rank of the best spread that wins charge-move priority, if affordable. */
  cmpCost: number | null;
}

/**
 * The band extremes, which depend only on the table.
 *
 * Split out of probeSpreads because only the CMP straddle varies with the
 * opponent — recomputing the band per candidate meant scanning (and
 * re-slicing) the same few hundred spreads once for every opponent in the
 * league, several hundred times per scan.
 */
interface ProbeBand {
  rank1: RankedEntry;
  maxAtk: RankedEntry;
  maxDef: RankedEntry;
  maxHp: RankedEntry;
}

function probeBandFor(table: SpeciesTable): ProbeBand {
  // Uncapped: only near-perfect rolls are real options, so the band is an IV
  // floor rather than a slice of the stat-product ranking.
  const band = table.league.uncapped
    ? table.all.filter((e) => e.a >= UNCAPPED_IV_FLOOR && e.d >= UNCAPPED_IV_FLOOR && e.s >= UNCAPPED_IV_FLOOR)
    : table.all.slice(0, Math.max(8, Math.round(table.all.length * PROBE_BAND)));

  let maxAtk = band[0];
  let maxDef = band[0];
  let maxHp = band[0];
  for (const e of band) {
    if (e.atk > maxAtk.atk) maxAtk = e;
    if (e.def > maxDef.def) maxDef = e;
    if (e.hp > maxHp.hp) maxHp = e;
  }
  return { rank1: table.best, maxAtk, maxDef, maxHp };
}

function probeSpreads(table: SpeciesTable, oppAtk: number, band: ProbeBand): ProbeSet {
  const { rank1, maxAtk, maxDef, maxHp } = band;

  // Best-ranked spread on each side of the priority threshold, over the full
  // space — table.all is already sorted by stat product, so first match wins.
  let cmpWinner: RankedEntry | null = null;
  let cmpLoser: RankedEntry | null = null;
  for (const e of table.all) {
    if (!cmpWinner && e.statAtk >= oppAtk) cmpWinner = e;
    else if (!cmpLoser && e.statAtk < oppAtk) cmpLoser = e;
    if (cmpWinner && cmpLoser) break;
  }

  const out: Probe[] = [
    { label: 'rank1', entry: rank1 },
    { label: 'atk', entry: maxAtk },
    { label: 'def', entry: maxDef },
    { label: 'hp', entry: maxHp },
  ];

  const affordable = cmpWinner && cmpWinner.rank <= KEEPABLE_RANK;
  if (affordable && cmpWinner && cmpLoser) {
    out.push({ label: 'cmp+', entry: cmpWinner });
    out.push({ label: 'cmp-', entry: cmpLoser });
  }

  const seen = new Set<number>();
  const probes = out.filter((p) => {
    const k = ivKey(p.entry);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { probes, cmpCost: affordable && cmpLoser ? cmpWinner!.rank : null };
}

const SHIELD_SCENARIOS = [0, 1, 2];

/**
 * Rank at which an opponent's matchups are worth half what rank 1's are.
 *
 * Tuned against the list it produces rather than by feel: at 120 the median
 * opponent surfaced for Azumarill moves from rank 221 to double figures, and
 * the 500-plus tail drops out, while a genuinely knife-edge matchup against a
 * rank-300 Pokemon can still outscore a dull one against rank 5.
 */
const RANK_HALF = 120;

const relevanceCache = new Map<string, OpponentRelevance[]>();

/**
 * The opponent's battle-side, which depends only on the opponent.
 *
 * Rebuilt for every opponent on every scan, including the charge-move array,
 * though nothing about it varies with who you are or how the scan is filtered.
 * battle() treats its mons as read-only, so one instance is shared.
 */
const foeMonCache = new Map<string, BattleMon>();
function foeMonFor(ref: string, leagueId: LeagueId, info: OpponentInfo): BattleMon {
  // Keyed by league as well as ref: the same species is a different set of
  // battle stats under each cap.
  const key = `${ref}|${leagueId}`;
  let m = foeMonCache.get(key);
  if (!m) {
    m = mkBattleMon(info, info.fastMove, chargesOf(info.chargeMove, info.chargeMove2), info.types);
    foeMonCache.set(key, m);
  }
  return m;
}

/**
 * Scores every candidate in the league by how much the IV roll matters, and
 * returns the most decision-relevant first.
 */
export function rankedOpponents(
  ref: string,
  leagueId: LeagueId,
  moveIdx: number,
  kind: RelevanceKind = 'either',
  limit = 16,
  chargeIds?: string[],
  bestBuddy = false,
): OpponentRelevance[] {
  const key = `rel|${ref}|${leagueId}|${moveIdx}|${kind}|${limit}|${(chargeIds ?? []).join('+')}|${bestBuddy ? 'bb' : ''}`;
  const cached = relevanceCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(parseRef(ref).id)!;
  const move = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const table = getTable(ref, leagueId, bestBuddy);
  const myCharges = selectedCharges(species, chargeIds);
  // Exact ref, not base id: if you're running Altaria, Shadow Altaria is still
  // a real opponent with different thresholds, so only the mirror drops out.
  const candidates = opponentCandidatesFor(leagueId).filter((c) => c !== ref);

  // The CMP band is the Attack-stat band, not the damage-attack one. Reading
  // atkLo/atkHi here compared a Shadow's inflated attack against a plain
  // opponent's stat, so `murkrow` and `murkrow_shadow` — identical rolls,
  // identical CP, identical rank — disagreed about whether Zapdos contests
  // priority with them. 27% of subject/Shadow-opponent pairs in Great.
  const { statAtkLo, statAtkHi } = table;

  const scored: OpponentRelevance[] = [];

  // The band is opponent-independent, so it is built once for the whole scan.
  const band = probeBandFor(table);
  // Your side of each probe depends only on the spread, not on who you're
  // facing or how many shields are up, but it sat in the innermost loop —
  // rebuilt up to 18 times per opponent for at most six distinct spreads, and
  // four of those six are the same for every opponent in the league.
  const myMons = new Map<number, BattleMon>();
  const myMonFor = (entry: RankedEntry): BattleMon => {
    const k = ivKey(entry);
    let m = myMons.get(k);
    if (!m) {
      m = mkBattleMon(entry, move, myCharges, species.types);
      myMons.set(k, m);
    }
    return m;
  };

  for (const c of candidates) {
    const info = opponentInfo(c, leagueId);
    const hasBreak = hasBreakpoint(table, move, info.def, info.types);
    const hasBulk = hasBulkpoint(table, info.atk, info.fastMove, species.types);
    // Contested only if a spread you'd keep wins priority and one loses it —
    // a CMP win that costs rank 3800 is not a decision anyone makes.
    const cmpContested = info.statAtk > statAtkLo && info.statAtk <= statAtkHi;

    const foe = foeMonFor(c, leagueId, info);
    const { probes, cmpCost } = probeSpreads(table, info.statAtk, band);

    const flipShields: number[] = [];
    let closest = Infinity;
    // Which lever turns the matchup: attack, bulk, or charge-move priority.
    let atkDecides = false;
    let bulkDecides = false;
    let cmpDecides = false;

    for (const shields of SHIELD_SCENARIOS) {
      // Scalars rather than a Map plus a spread of its values: this ran three
      // times per opponent and the allocation, not the battles, was the cost.
      // A label stays undefined when its probe deduped away against an earlier
      // one, which the attribution below relies on.
      let nWin = 0;
      let nLoss = 0;
      let wAtk: boolean | undefined;
      let wDef: boolean | undefined;
      let wCmpUp: boolean | undefined;
      let wCmpDown: boolean | undefined;
      for (const p of probes) {
        const r = battle(myMonFor(p.entry), foe, shields, shields, 0, 0, false);
        if (r.win) nWin++;
        else nLoss++;
        if (p.label === 'atk') wAtk = r.win;
        else if (p.label === 'def') wDef = r.win;
        else if (p.label === 'cmp+') wCmpUp = r.win;
        else if (p.label === 'cmp-') wCmpDown = r.win;
        const m = Math.abs(r.margin);
        if (m < closest) closest = m;
      }
      if (nWin > 0 && nLoss > 0) {
        flipShields.push(shields);
        // Attribution: the attack-heavy roll wins where the bulky one doesn't
        // (or vice versa), and the CMP straddle isolates priority specifically.
        if (wAtk && wDef === false) atkDecides = true;
        if (wDef && wAtk === false) bulkDecides = true;
        if (wCmpUp !== undefined && wCmpDown !== undefined && wCmpUp !== wCmpDown) cmpDecides = true;
      }
    }

    // Kind filter: when the user is specifically reading breakpoints, don't
    // pad the list with matchups that are only bulk-relevant, and vice versa.
    if (kind === 'break' && !hasBreak && flipShields.length === 0) continue;
    if (kind === 'bulk' && !hasBulk && flipShields.length === 0) continue;

    const rank = Math.min(rankOfRef(c, leagueId), 9999);
    const razor = closest < 3;

    // A knife-edge — decided in some shield scenarios but not all — is more
    // informative than one that swings everywhere, so weight it higher.
    const knifeEdge = flipShields.length > 0 && flipShields.length < SHIELD_SCENARIOS.length;
    // How much this matchup teaches about your roll.
    const informative =
      (flipShields.length > 0 ? 600 : 0) +
      (knifeEdge ? 400 : 0) +
      (cmpDecides ? 500 : 0) +
      // A cheap CMP win is a better tip than an expensive one.
      (cmpCost != null && cmpCost <= 300 ? 120 : 0) +
      (atkDecides || bulkDecides ? 200 : 0) +
      (cmpContested ? 80 : 0) +
      (hasBreak ? 60 : 0) +
      (hasBulk ? 40 : 0) +
      (razor ? 60 : 0);

    // …times how likely you are to meet it. This was `- rank * 0.1`, a
    // subtraction against bonuses of 400 to 600, so it barely counted: the
    // median opponent surfaced for Azumarill sat at rank 221 and the tail ran
    // to 647 — Celebi, Celesteela, Shadow Staraptor. A decidable matchup
    // against a Pokemon nobody brings is not a relevant matchup, however
    // decidable it is.
    //
    // Multiplicative rather than another additive term, so it scales the whole
    // score instead of being outvoted by it. RANK_HALF is where a matchup is
    // worth half as much as the same matchup against rank 1.
    const score = informative * (1 / (1 + rank / RANK_HALF));

    // Nothing decidable and not even close: not worth a slot.
    if (flipShields.length === 0 && !cmpContested && !hasBreak && !hasBulk && !razor) continue;

    const bits: string[] = [];
    if (cmpDecides) bits.push(cmpCost != null ? `CMP decides it (rank ${cmpCost})` : 'CMP decides it');
    else if (atkDecides && !bulkDecides) bits.push('Needs attack');
    else if (bulkDecides && !atkDecides) bits.push('Needs bulk');
    else if (flipShields.length) bits.push('Spread-decided');

    // Surface the priority tradeoff whenever it's purchasable, even if it
    // wasn't the deciding lever — "you can win CMP for rank 247" is the kind
    // of thing worth knowing before you transfer a spread.
    if (cmpCost != null && !cmpDecides) bits.push(`CMP at rank ${cmpCost}`);

    if (flipShields.length) {
      bits.push(`flips at ${flipShields.map((s) => (s === 1 ? '1 shield' : `${s}sh`)).join('/')}`);
    } else if (razor) {
      bits.push(`within ${closest.toFixed(1)}%`);
    } else if (cmpContested) {
      bits.push('CMP contested');
    } else if (hasBreak) {
      bits.push('breakpoint');
    } else {
      bits.push('bulkpoint');
    }

    scored.push({
      info,
      score,
      cmpCost,
      flipShields,
      cmpContested,
      hasBreak,
      hasBulk,
      closest: closest === Infinity ? 100 : closest,
      reason: bits.join(' · '),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.info.name.localeCompare(b.info.name));
  const out = scored.slice(0, limit);
  relevanceCache.set(key, out);
  return out;
}

const relevantCache = new Map<string, OpponentInfo[]>();

// Scans the broad opponent-candidate pool and keeps only matchups where the
// relevant threshold actually exists - a bulkpoint is common enough (roughly
// half of all matchups have one) that an "either" filter barely narrows
// anything, so when the caller is specifically looking at breakpoints (or
// specifically bulkpoints), only that one threshold type should gate
// inclusion. Toxapex, for example, has a real Psywave breakpoint from
// Malamar but ranks outside the top 60 meta list - so it must be found via
// this scan, not the curated top-N list, or it never surfaces at all.
// Ranked by the candidate's own pvpoke league rank so the most meta-relevant
// *and* actually-relevant matchups surface first.
export function relevantOpponents(
  speciesId: string,
  leagueId: LeagueId,
  moveIdx: number,
  kind: RelevanceKind = 'either',
  limit = 16,
): OpponentInfo[] {
  const key = `${speciesId}|${leagueId}|${moveIdx}|${kind}|${limit}`;
  const cached = relevantCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const move = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const table = getTable(speciesId, leagueId);
  const candidates = opponentCandidatesFor(leagueId).filter((c) => c !== speciesId);

  const scored = candidates
    .map((c) => {
      const info = opponentInfo(c, leagueId);
      const hb = kind !== 'bulk' && hasBreakpoint(table, move, info.def, info.types);
      const hk = kind !== 'break' && hasBulkpoint(table, info.atk, info.fastMove, species.types);
      return { info, relevant: hb || hk, rank: rankOfRef(c, leagueId) };
    })
    .filter((x) => x.relevant)
    .sort((a, b) => a.rank - b.rank || a.info.name.localeCompare(b.info.name));

  const out = scored.slice(0, limit).map((x) => x.info);
  relevantCache.set(key, out);
  return out;
}

// ── Breakpoint / bulkpoint threshold rows ──
export interface ThresholdRow {
  kind: 'Breakpoint' | 'Bulkpoint';
  move: string;
  needLabel: string;
  need: number;
  spread: string;
  dmgLabel: string;
  have: number;
  at: number;
  met: boolean;
  near: boolean;
}

export function bpRowsFor(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  opp: OpponentInfo,
): ThresholdRow[] {
  const { entry, table } = getEntry(speciesId, iv, leagueId);
  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const myTypes = species.types;
  const rows: Omit<ThresholdRow, 'met' | 'near'>[] = [];

  species.fastMoves.forEach((mv) => {
    const vals = table.all
      .map((x) => ({ atk: x.atk, d: dmg(x.atk, opp.def, mv, opp.types), e: x }))
      .sort((x, y) => x.atk - y.atk);
    const seen = new Map<number, (typeof vals)[number]>();
    vals.forEach((v) => {
      if (!seen.has(v.d)) seen.set(v.d, v);
    });
    [...seen.keys()].sort((x, y) => x - y).forEach((d) => {
      const v = seen.get(d)!;
      rows.push({
        kind: 'Breakpoint',
        move: `${mv.name} (${mv.turns}t)`,
        needLabel: `atk ${v.atk.toFixed(2)}`,
        need: v.atk,
        spread: `${v.e.a}/${v.e.d}/${v.e.s}`,
        dmgLabel: `${d} dmg`,
        have: entry.atk,
        at: v.atk,
      });
    });
  });

  const dvals = table.all
    .map((x) => ({ def: x.def, d: dmg(opp.atk, x.def, opp.fastMove, myTypes), e: x }))
    .sort((x, y) => x.def - y.def);
  const seenB = new Map<number, (typeof dvals)[number]>();
  dvals.forEach((v) => {
    if (!seenB.has(v.d)) seenB.set(v.d, v);
  });
  [...seenB.keys()].sort((x, y) => y - x).forEach((d) => {
    const v = seenB.get(d)!;
    rows.push({
      kind: 'Bulkpoint',
      move: `${opp.name} ${opp.fastMove.name}`,
      needLabel: `def ${v.def.toFixed(2)}`,
      need: v.def,
      spread: `${v.e.a}/${v.e.d}/${v.e.s}`,
      dmgLabel: `takes ${d}`,
      have: entry.def,
      at: v.def,
    });
  });

  return rows.map((r) => {
    const met = r.have >= r.at;
    const near = !met && (r.at - r.have) / r.at < 0.03;
    return { ...r, met, near };
  });
}

// ── Ruler bands (damage-per-use vs. attack/defense axis) ──
export interface RulerBand {
  label: string;
  start: number;
  width: number;
  active: boolean;
}
export interface RulerTick {
  pos: number;
}
export interface RulerData {
  title: string;
  sub: string;
  unit: 'atk' | 'def';
  badge: string;
  note: string;
  min: string;
  max: string;
  bands: RulerBand[];
  ticks: RulerTick[];
  youPos: number;
  youLabel: string;
  flat: boolean;
}

export function rulersFor(speciesId: string, iv: IV, leagueId: LeagueId, opp: OpponentInfo): RulerData[] {
  const { entry, table } = getEntry(speciesId, iv, leagueId);
  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const myTypes = species.types;
  const atks = table.all.map((x) => x.atk);
  const aMin = Math.min(...atks);
  const aMax = Math.max(...atks);
  const defs = table.all.map((x) => x.def);
  const dMin = Math.min(...defs);
  const dMax = Math.max(...defs);
  const pos = (v: number, lo: number, hi: number) => ((v - lo) / (hi - lo)) * 100;

  function mk(
    title: string,
    sub: string,
    lo: number,
    hi: number,
    you: number,
    thresholds: { at: number; label: string }[],
    badge: string,
    note: string,
    kind: 'atk' | 'def',
  ): RulerData {
    const bands: RulerBand[] = thresholds.map((th, i) => {
      const start = i === 0 ? 0 : pos(th.at, lo, hi);
      const end = i === thresholds.length - 1 ? 100 : pos(thresholds[i + 1].at, lo, hi);
      const active = you >= th.at && (i === thresholds.length - 1 || you < thresholds[i + 1].at);
      return { label: end - start < 6 ? '' : th.label, start: Math.max(0, start), width: Math.max(0, end - start), active };
    });
    const ticks: RulerTick[] = thresholds.filter((_, i) => i > 0).map((th) => ({ pos: pos(th.at, lo, hi) }));
    const flat = thresholds.length <= 1;
    const bulk = kind === 'def';
    return {
      title,
      sub,
      unit: bulk ? 'def' : 'atk',
      badge: flat ? `No ${bulk ? 'bulkpoint' : 'breakpoint'} in reach` : badge,
      note: flat
        ? bulk
          ? 'The incoming move deals the same damage across every reachable defense value — no bulkpoint exists for this pairing.'
          : "This target's defense flattens the move — every reachable spread deals the same damage. Try another opponent."
        : note,
      min: lo.toFixed(1),
      max: hi.toFixed(1),
      bands,
      ticks,
      youPos: Math.min(99.6, Math.max(0, pos(you, lo, hi))),
      youLabel: you.toFixed(2),
      flat,
    };
  }

  const out: RulerData[] = [];
  species.fastMoves.forEach((mv) => {
    const seen = new Map<number, number>();
    table.all
      .slice()
      .sort((x, y) => x.atk - y.atk)
      .forEach((x) => {
        const d = dmg(x.atk, opp.def, mv, opp.types);
        if (!seen.has(d)) seen.set(d, x.atk);
      });
    const th = [...seen.keys()].sort((x, y) => x - y).map((d) => ({ at: seen.get(d)!, label: `${d} dmg` }));
    const reached = th.filter((x) => entry.atk >= x.at).length;
    out.push(
      mk(
        `${mv.name} → ${opp.name}`,
        `${mv.turns}-turn · ${mv.power} power · target def ${opp.def.toFixed(1)}`,
        aMin,
        aMax,
        entry.atk,
        th,
        `${reached} / ${th.length} breakpoints`,
        'Bands are damage per use; the ruler marks where it steps up',
        'atk',
      ),
    );
  });
  const seenB = new Map<number, number>();
  table.all
    .slice()
    .sort((x, y) => x.def - y.def)
    .forEach((x) => {
      const d = dmg(opp.atk, x.def, opp.fastMove, myTypes);
      if (!seenB.has(d)) seenB.set(d, x.def);
    });
  const thB = [...seenB.keys()].sort((x, y) => y - x).map((d) => ({ at: seenB.get(d)!, label: `takes ${d}` }));
  out.push(
    mk(
      `Bulkpoints vs ${opp.name} ${opp.fastMove.name}`,
      `your defense axis · attacker atk ${opp.atk.toFixed(1)}`,
      dMin,
      dMax,
      entry.def,
      thB,
      `${thB.filter((x) => entry.def >= x.at).length} / ${thB.length} bulkpoints`,
      'Further right takes less damage per hit',
      'def',
    ),
  );
  return out;
}

// ── Heatmap cell data (rank / breakpoint-tier / bulkpoint-tier colouring) ──
export interface HeatCell {
  a: number;
  d: number;
  entry: RankedEntry;
  bg: string;
  label: string;
  tip: string;
  isYou: boolean;
}

export function buildHeatCells(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  opp: OpponentInfo,
  moveIdx: number,
  colorBy: 'rank' | 'break' | 'bulk',
): HeatCell[] {
  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const pal = paletteFor(species);
  const { table } = getEntry(speciesId, iv, leagueId);
  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];

  const myTypes = table.species.types;
  const slice: RankedEntry[] = [];
  for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(table.map.get(a * 256 + d * 16 + iv.s)!);

  const spMax = table.best.sp;
  const spMin = Math.min(...slice.map((e) => e.sp));
  let tiers: number[] = [];
  if (colorBy === 'break') tiers = [...new Set(slice.map((e) => dmg(e.atk, opp.def, mv, opp.types)))].sort((x, y) => x - y);
  if (colorBy === 'bulk') tiers = [...new Set(slice.map((e) => dmg(opp.atk, e.def, opp.fastMove, myTypes)))].sort((x, y) => y - x);

  return slice.map((entry) => {
    const isYou = entry.a === iv.a && entry.d === iv.d;
    let bg: string;
    let label: string;
    if (colorBy === 'rank') {
      bg = cellColorMix((entry.sp - spMin) / Math.max(1e-9, spMax - spMin), pal);
      label = `#${entry.rank}`;
    } else if (colorBy === 'break') {
      const dv = dmg(entry.atk, opp.def, mv, opp.types);
      bg = tierColor(tiers.indexOf(dv), tiers.length, pal);
      label = `${dv} dmg / ${mv.turns}t`;
    } else {
      const dv = dmg(opp.atk, entry.def, opp.fastMove, myTypes);
      bg = tierColor(tiers.indexOf(dv), tiers.length, pal);
      label = `takes ${dv}`;
    }
    return {
      a: entry.a,
      d: entry.d,
      entry,
      bg,
      label,
      isYou,
      tip: `ATK ${entry.a} / DEF ${entry.d} / HP ${iv.s} — #${entry.rank} · ${label}`,
    };
  });
}

// ── Turn-based shield/CMP battle simulator with selective baiting ──
// 1 turn = 500ms; throw-as-soon-as-charged (for the mon's *chosen* move, see
// below); shields absorb a charge move down to 1 damage; simultaneous charge
// moves (CMP) resolve by higher attack stat first.
//
// Baiting: a shielded charge move deals exactly 1 damage no matter which move
// is thrown, so a rational attacker never wants to spend its best (usually
// pricier, higher-DPE) move into a shield - it should spend a cheaper move
// instead, saving the harder-hitting move for when it will land for real.
// This means the mon's real "main" move is whichever charge move has the
// best damage-per-energy, and the *secondary* is the best of the rest by
// damage per energy *squared* — weighting cost twice, so a fast-charging move
// wins over an efficient but slow one. See classifyCharges.
//
// Note the secondary rule is currently unreachable: every path into the engine
// caps a loadout at MAX_CHARGES = 2, so `rest` holds exactly one move and any
// selection rule returns it. Verified by differential test — swapping the rule
// leaves a 52,186-row battle snapshot byte-identical. It matters only if that
// cap is ever raised.
// While the opponent has shields, throw bait as soon as it's ready; once
// shields are gone (or there's no bait role at all), hold every point of
// energy for main and only throw once main's own threshold is met - never
// fire early just because a weaker move happens to be ready first.
interface ChargeRoles {
  main: ChargeMove;
  secondary: ChargeMove | null;
  /** Damage per energy of each, in this matchup. */
  mainDpe: number;
  secondDpe: number;
}


/**
 * Main is the best damage per energy — the most efficient move in this
 * matchup. Secondary is the best damage per energy *squared* among the rest,
 * which weights the cost a second time and so favours a fast-charging move
 * over an efficient-but-slow one. That is deliberate: the secondary exists to
 * be thrown early — into a shield, or to squeeze damage out before fainting —
 * and a move you cannot reach in time is worthless in that role. Picking the
 * cheapest alternative instead, as this used to, ignores how much damage the
 * cheap move actually does.
 */
function classifyCharges(
  atk: number,
  oppDef: number,
  charges: ChargeMove[],
  oppTypes: readonly string[],
): ChargeRoles {
  if (charges.length === 1) {
    const d = dmg(atk, oppDef, charges[0], oppTypes) / charges[0].energy;
    return { main: charges[0], secondary: null, mainDpe: d, secondDpe: 0 };
  }
  // Damage once per move, not once per comparison. A sort comparator that
  // recomputes dmg() calls it O(n log n) times, and dmg() now walks the type
  // chart — this was 7.7% of a relevance scan on its own.
  const scored = charges.map((c) => {
    const d = dmg(atk, oppDef, c, oppTypes);
    return { c, dpe: d / c.energy, dpe2: d / (c.energy * c.energy) };
  });
  scored.sort((x, y) => y.dpe - x.dpe);
  const main = scored[0].c;
  const rest = scored.slice(1);
  const pick = rest.length ? rest.reduce((best, x) => (x.dpe2 > best.dpe2 ? x : best)) : null;
  return {
    main,
    secondary: pick ? pick.c : null,
    mainDpe: scored[0].dpe,
    secondDpe: pick ? pick.dpe : 0,
  };
}

/**
 * `collectLog: false` skips building the per-turn log. The relevance scorer
 * runs thousands of sims and only reads win/margin; allocating a log object
 * per turn dominated that sweep. Same simulation either way - one branch, no
 * parallel implementation to drift.
 */
// ── PvPoke's charged-move preferences (GameMaster.js, Pokemon.js, ActionLogic.js) ──

/** Lowers the user's own stats at least half the time (PvPoke's selfDebuffing). */
const selfDebuffing = (c: ChargeMove) =>
  !!c.buffs && c.buffs.target === 'self' && c.buffs.chance >= 0.5 && c.id !== 'DRAGON_ASCENT' &&
  (c.buffs.atkStage < 0 || c.buffs.defStage < 0);
const selfAttackDebuffing = (c: ChargeMove) => selfDebuffing(c) && c.buffs!.atkStage < 0;
const selfDefenseDebuffing = (c: ChargeMove) => selfDebuffing(c) && c.buffs!.defStage < 0;
/** A guaranteed effect in the user's favour, a debuff on the opponent included. */
const selfBuffing = (c: ChargeMove) =>
  !!c.buffs && c.buffs.chance === 1 &&
  (c.buffs.target === 'opponent' || c.buffs.atkStage > 0 || c.buffs.defStage > 0);

interface Rated { c: ChargeMove; dmg: number; dpe: number }

/**
 * PvPoke's active charged moves, in its order (Pokemon.resetMoves): by energy,
 * then reshuffled by its tie-breaks. [0] is what it treats as the cheap move.
 * Ported with its in-place rotation, so it orders exactly as PvPoke's does.
 * ponytail: skips the Registeel Focus Blast / Zap Cannon clause and Aegislash
 * Shield's "everything self-debuffs" (banking covers that); add if parity
 * shows them.
 */
function activeOrder(charges: ChargeMove[], dmgs: number[]): Rated[] {
  const acm = charges.map((c, i) => ({ c, dmg: dmgs[i], dpe: dmgs[i] / c.energy }))
    .sort((x, y) => (x.c.energy > y.c.energy ? 1 : y.c.energy > x.c.energy ? -1 : 0));
  const rotate = () => acm.push(acm.splice(0, 1)[0]);
  for (let i = 1; i < acm.length; i++) {
    const same = acm[i].c.energy === acm[0].c.energy;
    if (same && !selfDebuffing(acm[i].c) && (acm[i].c.buffs || acm[i].dmg > acm[0].dmg)) rotate();
    const b0 = acm[0].c.buffs, bi = acm[i].c.buffs;
    if (same && b0 && bi && !selfDebuffing(acm[i].c) && bi.chance > b0.chance) rotate();
    const close = acm[i].c.energy - acm[0].c.energy <= 10;
    if (close && !selfDebuffing(acm[i].c) && selfBuffing(acm[i].c) && acm[0].dpe - acm[i].dpe < 0.3) rotate();
    if (close && selfAttackDebuffing(acm[0].c) && !selfDebuffing(acm[i].c)) rotate();
    if (close && selfDebuffing(acm[0].c) && acm[0].c.energy > 50 && !selfDebuffing(acm[i].c)) rotate();
    if (acm[i].c.energy - acm[0].c.energy <= 5 && selfBuffing(acm[i].c)) rotate();
  }
  return acm;
}

/** PvPoke's bestChargedMove over that order. */
function bestCharged(acm: Rated[]): Rated {
  let best = acm[0];
  for (const m of acm) {
    const d = m.dpe - best.dpe;
    if (((d > 0.03 && m.c.id !== 'SUPER_POWER') || d > 0.3) && (!selfBuffing(best.c) || d > 0.3)) best = m;
    if (Math.abs(m.dpe - best.dpe) < 0.03 && best.c.buffs && m.c.buffs && m.c.buffs.chance > best.c.buffs.chance && !selfDebuffing(m.c)) best = m;
    if (m.c.id === 'OBSTRUCT') best = m;
  }
  return best;
}

interface MoveView {
  hp: number; maxHp: number; energy: number; shields: number;
  fastTurns: number; acm: Rated[];
  oppHp: number; oppEnergy: number; oppShields: number; oppFastDmg: number; oppFastTurns: number;
  /** The opponent's best charged move (PvPoke's bestChargedMove) and whether we could survive... */
  oppBest: Rated | null;
  /** A loaded Cramorant across the field: PvPoke stacks against it too. */
  oppLoaded: boolean;
  /** PvPoke's wouldShield: would we shield the opponent's best move now? */
  wouldShieldOppBest: () => boolean;
  /** ...and would the opponent shield this move of ours? */
  oppWouldShield: (c: ChargeMove) => boolean;
}

/**
 * PvPoke's overrides on the move its planner picked (ActionLogic 904-1000),
 * applied to ours: prefer efficient cheap moves with shields up, avoid
 * inefficient self-debuffing moves, never bait with one, defer one until the
 * opponent's survivable charged move has gone, and stack them. Returns the
 * move to throw, or null to take a fast move instead.
 */
function refineChoice(chosen: ChargeMove, v: MoveView): ChargeMove | null {
  const acm = v.acm;
  let m = acm.find((r) => r.c === chosen) ?? acm[0];
  const first = acm[0];
  const many = acm.length > 1;
  if (v.oppShields > 0 && many && first.c.energy <= m.c.energy && first.dpe > m.dpe && !selfDebuffing(first.c)) m = first;
  if (v.oppShields === 0 && many && selfDebuffing(m.c) && m.c.energy > 50 && v.hp / v.maxHp > 0.5 && m.dmg / v.oppHp < 0.8) m = first;
  if (many && first.c.energy === m.c.energy && first.dpe > m.dpe && !selfDebuffing(first.c)) m = first;
  if (many && first.c.energy - 10 <= m.c.energy && first.dpe > m.dpe && selfDebuffing(m.c) && !selfDebuffing(first.c)) m = first;
  if (many && first.c.energy - m.c.energy <= 5 && first.dpe > m.dpe && selfBuffing(first.c)) m = first;
  // PvPoke baits selectively by default (baitShields 1).
  if (v.oppShields > 0 && many)
    for (let i = 1; i < acm.length; i++)
      if (v.energy >= acm[i].c.energy && acm[i].dpe > m.dpe && selfDebuffing(m.c) && !selfDebuffing(acm[i].c)) m = acm[i];
  if (v.oppShields === 0 && many && selfDebuffing(m.c))
    for (let i = 1; i < acm.length; i++) if (acm[i].dpe > m.dpe && !selfDebuffing(acm[i].c)) m = acm[i];
  if (v.oppShields > 0 && many)
    for (let i = 1; i < acm.length; i++)
      if (selfDebuffing(acm[0].c) && !selfDebuffing(acm[i].c) &&
        acm[i].c.energy - acm[0].c.energy <= 10 && acm[i].dpe / acm[0].dpe > 0.7) m = acm[i];
  if (selfDebuffing(m.c) && v.shields === 0 && v.energy < 100 && v.oppBest &&
    v.oppEnergy >= v.oppBest.c.energy && !v.wouldShieldOppBest() && !selfBuffing(first.c)) return null;
  if (selfDebuffing(m.c) || v.oppLoaded) {
    const target = Math.floor(100 / m.c.energy) * m.c.energy;
    if (v.energy < target) {
      if ((v.oppHp > m.dmg || v.oppShields !== 0) &&
        (v.hp > v.oppFastDmg * 2 || (v.oppFastTurns - v.fastTurns) * 500 > 500)) return null;
    } else if (v.oppShields > 0 && first.c.energy - m.c.energy <= 10 && !selfDebuffing(first.c) &&
      (selfBuffing(first.c) || v.oppWouldShield(m.c))) {
      // Bait with the cheaper move if it boosts, or if the bigger one would be shielded.
      m = first;
    }
  }
  return v.energy >= m.c.energy ? m.c : null;
}

/** One side's view of the fight at a decision point, for PvPoke's timing rule. */
interface TimingView {
  hp: number; energy: number; shields: number; cmpAtk: number;
  fast: FastMove; charges: ChargeMove[];
  /** Damage of each of our charged moves to the opponent, now. */
  chargeDmg: number[];
  oppHp: number; oppEnergy: number; oppShields: number; oppCmpAtk: number;
  oppFast: FastMove; oppCharges: ChargeMove[];
  /** Damage the opponent's fast move and each charged move would do to us. */
  oppFastDmg: number; oppChargeDmg: number[];
  /** Milliseconds left in the opponent's current fast move; 0 when it is free. */
  oppCooldown: number;
}

/**
 * PvPoke's turns-to-live search (ActionLogic.decideAction): how many turns
 * until the opponent can knock us out, walking its fast moves, its cheapest
 * charged move into our shields, and its charged moves once they are gone.
 * Ported literally, including the extra turn when we win CMP against a fast
 * move that divides evenly into ours.
 */
function turnsToLive(v: TimingView): number {
  let ttl = Infinity;
  const winsCMP = v.cmpAtk >= v.oppCmpAtk;
  // oppCharges arrive in PvPoke's active order, so [0] is its fastestChargedMove.
  const cheapest = v.oppCharges[0];
  const queue = v.oppCooldown !== 0
    ? [{ hp: v.hp - v.oppFastDmg, opE: v.oppEnergy + v.oppFast.energyGain, turn: v.oppCooldown / 500, sh: v.shields }]
    : [{ hp: v.hp, opE: v.oppEnergy, turn: 0, sh: v.shields }];
  while (queue.length) {
    const s = queue.shift()!;
    if (s.hp > v.oppFastDmg && s.turn > v.fast.turns + (winsCMP ? 0 : 1)) continue;
    if (s.sh !== 0) {
      if (cheapest && s.opE >= cheapest.energy) queue.unshift({ hp: s.hp - 1, opE: s.opE - cheapest.energy, turn: s.turn + 1, sh: s.sh - 1 });
    } else {
      for (let n = 0; n < v.oppCharges.length; n++) {
        if (s.opE < v.oppCharges[n].energy) continue;
        const d = v.oppChargeDmg[n];
        if (d >= s.hp) {
          ttl = Math.min(s.turn, ttl);
          if (v.cmpAtk > v.oppCmpAtk && (v.oppFast.turns * 500) % (v.fast.turns * 500) === 0) ttl++;
          break;
        }
        queue.unshift({ hp: s.hp - d, opE: s.opE - v.oppCharges[n].energy, turn: s.turn + 1, sh: s.sh });
      }
    }
    if (s.hp - v.oppFastDmg <= 0) {
      ttl = Math.min(s.turn + v.oppFast.turns, ttl);
      break;
    }
    queue.unshift({ hp: s.hp - v.oppFastDmg, opE: s.opE + v.oppFast.energyGain, turn: s.turn + v.oppFast.turns, sh: s.sh });
  }
  return ttl;
}

/**
 * PvPoke's move-timing rule (ActionLogic.decideAction, optimizeMoveTiming):
 * true when a charged move that is ready should wait for a fast move, so it
 * lands as the opponent's fast move registers rather than handing it turns.
 */
function holdsForTiming(v: TimingView, ttl: number): boolean {
  const my = v.fast.turns * 500, opp = v.oppFast.turns * 500;
  let target = 500;
  if (my >= 2000) target = 1000;
  if (my >= 1500 && opp === 2500) target = 1000;
  if (my === 1000 && opp === 2000) target = 1000;
  if (my === opp) target = 0;
  if (my % opp === 0 && my > opp) target = 0;
  if (!(target > 0 && (v.oppCooldown === 0 || v.oppCooldown > target))) return false;
  // About to faint from a fast move.
  if (v.hp <= v.oppFastDmg) return false;
  // Would overflow 100 energy with the fast move it would throw instead.
  if (v.energy + v.fast.energyGain > 100) return false;
  // Fewer turns to live than it takes to throw what it has.
  const first = v.charges[0];
  const planned = v.fast.turns + Math.floor(v.energy / first.energy) + (v.cmpAtk < v.oppCmpAtk ? 1 : 0);
  if (planned > ttl) return false;
  // Can knock the opponent out now.
  if (v.oppShields === 0 && v.charges.some((c, i) => v.energy >= c.energy && v.chargeDmg[i] >= v.oppHp)) return false;
  // The opponent can knock us out inside the fast move we would add.
  const fastIn = Math.floor(my / opp);
  for (let n = 0; n < v.oppCharges.length; n++) {
    const c = v.oppCharges[n];
    const turnsFrom = Math.ceil((c.energy - v.oppEnergy) / v.oppFast.energyGain) * v.oppFast.turns + 1;
    const hit = (v.shields > 0 ? 1 : v.oppChargeDmg[n]) + v.oppFastDmg * fastIn;
    if (turnsFrom <= v.fast.turns && hit >= v.hp) return false;
  }
  if (v.hp <= v.oppFastDmg * Math.floor((my + 500) / opp)) return false;
  return true;
}

/**
 * Whether to spend a shield on this hit.
 *
 * `always` is the old unconditional behaviour. `read` spends only on something
 * that would kill, or on the hardest hit the attacker has — which is exactly
 * "call the bait, shield the nuke". A defender that has read the movepool
 * knows the cheap move is coming and eats it to keep the shield for the one
 * that matters.
 *
 * Note this makes the *attacker's* bait a genuine gamble rather than free
 * value, which is the point: at high level the bait only pays when the read is
 * wrong.
 */
function shieldCall(policy: ShieldPolicy, incoming: number, hp: number, worst: number): boolean {
  if (policy === 'always') return true;
  // Nothing is worth dying to prove.
  if (incoming >= hp) return true;
  return incoming >= worst;
}

export function battle(
  a: BattleMon,
  b: BattleMon,
  shieldsA: number,
  shieldsB: number,
  energyA = 0,
  energyB = 0,
  collectLog = true,
  optimizeTiming = false,
  // Starting HP, for a mon carrying damage in from an earlier matchup. Default
  // is full, which is every single-matchup caller.
  startHpA?: number,
  startHpB?: number,
  // Shield policy per side. Defaults to `always`, the behaviour every existing
  // caller was written against.
  policyA: ShieldPolicy = 'always',
  policyB: ShieldPolicy = 'always',
): BattleResult {
  // A form change rewrites the mon in place, so a form-changing mon is copied
  // first: the caller's stays in its starting form, which is also what makes
  // every battle begin there (PvPoke's resetOnSwitch).
  // ponytail: PvPoke keeps Mimikyu Busted across a teamBattle chain (its
  // resetOnSwitch is false); we restore its Disguise each fight. Generate
  // resetOnSwitch and carry the form out in BattleResult if chains need it.
  if (a.forms) a = { ...a };
  if (b.forms) b = { ...b };
  let hpA = startHpA ?? a.hp;
  let hpB = startHpB ?? b.hp;
  let eA = energyA;
  let eB = energyB;
  let sA = shieldsA;
  let sB = shieldsB;
  let tA = a.fast.turns;
  let tB = b.fast.turns;
  let cmpDecided = false;

  // Stat stages. Chance-gated buffs land whole, on PvPoke's meter - see
  // describeBuff's note and applyBuff.
  const stA = { atk: 0, def: 0 };
  const meters = new Map<string, number>();
  const stB = { atk: 0, def: 0 };

  // Effective battle stats at the current stages. Every damage figure below is
  // derived from these rather than from a.atk/b.def directly.
  let atkA = a.atk, defA = a.def, atkB = b.atk, defB = b.def;

  // Damage used to be precomputed once and treated as fixed for the whole
  // battle — "attack, defence and typing do not change" — because recomputing
  // it per turn, per move, walking the type chart each time, dominated a
  // relevance sweep. Stat stages break that premise: after a Superpower the
  // same move hits for less.
  //
  // So it is still computed in one place, just re-derived when a stage
  // actually moves rather than every turn. A battle sees a handful of buffs at
  // most, so this keeps the original optimisation almost entirely intact while
  // being correct under stages.
  let fA = 0, fB = 0;
  // Attack behind charged moves. Differs from atkA/atkB only for Aegislash
  // Shield, whose charged moves hit with Blade's attack (PvPoke damageByStats).
  let catkA = 0, catkB = 0;
  let rolesA!: ChargeRoles, rolesB!: ChargeRoles;
  let chargeDmgA: number[] = [], chargeDmgB: number[] = [];
  // PvPoke's active-move order per side; it only moves when damage does.
  let acmA: Rated[] = [], acmB: Rated[] = [];
  let worstFromA = 0, worstFromB = 0;

  // ── Form changes (see Species.forms) ──
  const rule = (m: BattleMon) => (m.forms ? m.forms.by[m.form!].rule : null);
  const triggers = (m: BattleMon, trigger: string, moveId?: string) => {
    const r = rule(m);
    return !!r && r.trigger === trigger && (r.moves[0] === 'ANY' || (!!moveId && r.moves.includes(moveId)));
  };
  // Stats, typing and moves all swap. Moves pair up by position in each form's
  // movepool, which is how PvPoke's replaceMove pairs Shield's and Blade's.
  const setForm = (m: BattleMon, id: string) => {
    const from = m.forms!.by[m.form!], to = m.forms!.by[id];
    const swap = <T extends { id: string }>(x: T, was: T[], now: T[]) => now[was.findIndex((y) => y.id === x.id)] ?? x;
    Object.assign(m, {
      form: id, atk: to.atk, cmpAtk: to.cmpAtk, def: to.def, types: to.types,
      fast: swap(m.fast, from.fastMoves, to.fastMoves),
      charges: m.charges.map((c) => swap(c, from.chargeMoves, to.chargeMoves)),
    });
  };
  // Called only once the loop is running, by which time syncDerived exists.
  const toForm = (m: BattleMon, hp = 0) => {
    // Cramorant's `variable`: Gulping above half HP, Gorging at or below.
    const to = rule(m)!.to === 'variable' ? `${m.forms!.start}_${hp / m.hp > 0.5 ? 'gulping' : 'gorging'}` : rule(m)!.to;
    setForm(m, to);
    // A form can arrive with stat stages of its own: Mimikyu Busted is def -1.
    const add = m.forms!.by[to].stages, st = m === a ? stA : stB;
    if (add) {
      st.atk = clampStage(st.atk + add.atk);
      st.def = clampStage(st.def + add.def);
    }
    syncDerived();
  };
  // PvPoke: against an intact Disguise with no shield left in front of it,
  // throw the cheapest charged move the moment it is affordable - unless it
  // lowers the thrower's own stats.
  const breaker = (acm: Rated[], e: number, foe: BattleMon, foeShields: number) =>
    foeShields === 0 && triggers(foe, 'charged_move_damage') && e >= acm[0].c.energy && !selfDebuffing(acm[0].c) ? acm[0].c : null;
  // ── Cramorant (PvPoke Battle.js / ActionLogic.js) ──
  const cramorant = (m: BattleMon) => m.forms?.start === 'cramorant';
  // Gulping or Gorging: the only forms whose way out is a Gulp Missile.
  const missileOf = (m: BattleMon) => {
    const r = rule(m);
    return r?.moves[0].startsWith('GULP_MISSILE') ? m.forms!.by[m.form!].chargeMoves.find((c) => c.id === r.moves[0])! : null;
  };
  // Unformed Cramorant throws Dive or Surf as soon as it can, unless another
  // move is meaningfully better. PvPoke's "other move" test reads `moveID`
  // for Surf, so in practice it is the first move that is not Dive.
  const gulper = (m: BattleMon, e: number, oppHp: number, acm: Rated[]) => {
    if (!cramorant(m) || m.form !== m.forms!.start) return null;
    const gulp = acm.find((r) => r.c.id === 'DIVE' || r.c.id === 'SURF');
    const other = acm.find((r) => r.c.id !== 'DIVE');
    if (!gulp || !other || e < gulp.c.energy) return null;
    return oppHp > other.dmg * 1.3 && other.dpe / gulp.dpe < 1.5 ? gulp.c : null;
  };
  // PvPoke's shield overrides beyond Aegislash's: a loaded Cramorant keeps its
  // shields for a hit it can take 2.2 times over, and nobody shields a
  // Cramorant hit worth under a third of their HP.
  const holdsShield = (def: BattleMon, att: BattleMon, raw: number, hp: number) =>
    (triggers(def, 'activate_charged') && raw * 2 < hp) || (!!missileOf(def) && raw * 2.2 < hp) || (cramorant(att) && raw / hp < 0.33);
  const chargeAtk = (m: BattleMon) => (triggers(m, 'activate_charged') ? m.forms!.by[rule(m)!.to].atk : m.atk);
  // ── PvPoke's shielding (ActionLogic.wouldShield, Battle.js) ──
  const sideOf = (att: 'A' | 'B') => att === 'A'
    ? { att: a, def: b, stAtt: stA, stDef: stB, hpAtt: hpA, hpDef: hpB, sAtt: sA, sDef: sB, eAtt: eA, eDef: eB }
    : { att: b, def: a, stAtt: stB, stDef: stA, hpAtt: hpB, hpDef: hpA, sAtt: sB, sDef: sA, eAtt: eB, eDef: eA };
  // Damage from `att` with stage deltas applied to either side, as wouldShield
  // does while it tries a move's buffs on.
  const hitWith = (x: ReturnType<typeof sideOf>, move: FastMove | ChargeMove, charged: boolean,
    dAtt = { atk: 0, def: 0 }, dDef = { atk: 0, def: 0 }) =>
    dmg((charged ? chargeAtk(x.att) : x.att.atk) * buffMultiplier(clampStage(x.stAtt.atk + dAtt.atk)),
      x.def.def * buffMultiplier(clampStage(x.stDef.def + dDef.def)), move, x.def.types);
  /** Would the defender shield `move`? PvPoke's wouldShield, ported literally. */
  const wouldShield = (att: 'A' | 'B', move: ChargeMove, attEnergy: number): boolean => {
    const x = sideOf(att);
    const damage = hitWith(x, move, true);
    const mb = move.buffs ? { atk: move.buffs.atkStage, def: move.buffs.defStage } : { atk: 0, def: 0 };
    // PvPoke tries the move's buffs on the attacker if they raise attack, else on the defender.
    const fast = mb.atk > 0 ? hitWith(x, x.att.fast, false, mb) : hitWith(x, x.att.fast, false, undefined, mb);
    const fastAttacks = Math.ceil((move.energy - Math.max(attEnergy - move.energy, 0)) / x.att.fast.energyGain) + 1;
    const cycle = (fastAttacks * fast + 1) * x.sDef;
    let use = x.hpDef - damage <= cycle;
    const dpt = fast / x.att.fast.turns;
    for (const c of x.att.charges) {
      const cd = hitWith(x, c, true);
      if (cd >= x.hpDef / 1.4 && dpt > 1.5) use = true;
      if (cd >= x.hpDef - cycle) use = true;
    }
    if (selfAttackDebuffing(move) && damage / x.hpDef > 0.55) use = true;
    if (holdsShield(x.def, x.att, damage, x.hpDef)) use = false;
    // PvPoke's "moveID" typo makes this Dive only.
    if (cramorant(x.att) && move.id === 'DIVE' && damage > x.hpDef) use = false;
    return use;
  };
  /**
   * The shield call itself (Battle.js): shield, except where PvPoke defers to
   * wouldShield - an attacker's guaranteed boost, a defender whose best move
   * drops its own defense, and the Aegislash and Cramorant cases.
   */
  const pvpokeShields = (att: 'A' | 'B', move: ChargeMove, raw: number): boolean => {
    const x = sideOf(att);
    let use = true;
    const would = () => wouldShield(att, move, x.eAtt);
    const bf = move.buffs;
    if (bf && selfBuffing(move) && ((bf.target === 'self' && bf.atkStage > 0) || (bf.target === 'opponent' && bf.defStage < 0))) use = would();
    const defAcm = att === 'A' ? acmB : acmA;
    const defBest = defAcm.length ? bestCharged(defAcm) : null;
    if (defBest && selfDefenseDebuffing(defBest.c)) {
      if (x.sAtt > 0) use = would();
      else if (x.att.charges.length) {
        const defFast = dmg(x.def.atk * buffMultiplier(x.stDef.atk), x.att.def * buffMultiplier(x.stAtt.def), x.def.fast, x.att.types);
        const fastToNext = Math.ceil((defBest.c.energy - x.eDef) / x.def.fast.energyGain);
        const cycleDamage = fastToNext * defFast + defBest.dmg;
        const attAcm = att === 'A' ? acmA : acmB;
        let attTurns = Math.ceil((attAcm[0].c.energy - x.eAtt) / x.att.fast.energyGain) * x.att.fast.turns;
        if (x.att.cmpAtk > x.def.cmpAtk) attTurns--;
        if (fastToNext * x.def.fast.turns >= attTurns && x.hpAtt <= cycleDamage) use = would();
      }
    }
    if (holdsShield(x.def, x.att, raw, x.hpDef)) use = false;
    return use;
  };
  // ── PvPoke's charged-move decision (ActionLogic.decideAction), in its order ──
  // PvPoke's turn counter runs one ahead of ours and adds a turn per charged
  // round; turnsToKO is kept per side across decisions, as PvPoke keeps it on
  // each Pokemon.
  let chargedRounds = 0;
  const tko = { A: -1, B: -1 };
  // Damage with an extra attack stage, as the planner tries buffs on.
  const hitAt = (x: ReturnType<typeof sideOf>, move: FastMove | ChargeMove, charged: boolean, buff: number) =>
    dmg((charged ? chargeAtk(x.att) : x.att.atk) * buffMultiplier(clampStage(x.stAtt.atk + buff)),
      x.def.def * buffMultiplier(x.stDef.def), move, x.def.types);
  const boostMove = (m: BattleMon) => {
    let boost: ChargeMove | null = null;
    for (const c of m.charges) if (c.buffs && c.buffs.chance >= 0.5 && !selfDebuffing(c)) boost = c;
    return boost;
  };
  interface DPState { energy: number; oppHealth: number; turn: number; oppShields: number; moves: ChargeMove[]; buffs: number; chance: number }
  /**
   * Which charged move to throw now, or null for a fast move. A port of
   * decideAction after the preamble: last-gasp throw, lethal throw, Mimikyu
   * breaker, move timing, Cramorant's rush, then the planner (a short-cut when
   * the KO is many cycles away, else its DP over energy, opponent HP, shields
   * and attack buffs), its post-plan overrides (refineChoice), and Aegislash
   * banking. The DP keeps PvPoke's JavaScript as it runs: states have no
   * `hp`/`shields`, so those dominance checks never prune; the fast-farm state
   * reads an `opponentShields` that is undefined; and one insertion reads the
   * function-scoped `newEnergy` left by an earlier branch.
   * ponytail: skips the Melmetal-vs-Cresselia special case (needs species
   * ids, which BattleMon does not carry).
   */
  const decide = (me: 'A' | 'B', turn: number): ChargeMove | null => {
    const x = sideOf(me);
    const m = x.att, o = x.def;
    const e = x.eAtt;
    if (!m.charges.length) return null;
    const acm = me === 'A' ? acmA : acmB;
    if (e < acm[0].c.energy) return null;
    const oppAcm = me === 'A' ? acmB : acmA;
    const fastDmg = me === 'A' ? fA : fB, oppFastDmg = me === 'A' ? fB : fA;
    const oppCooldown = me === 'A' ? (tB >= b.fast.turns ? 0 : tB * 500) : (tA >= a.fast.turns ? 0 : tA * 500);
    const v: TimingView = {
      hp: x.hpAtt, energy: e, shields: x.sAtt, cmpAtk: m.cmpAtk, fast: m.fast,
      charges: acm.map((r) => r.c), chargeDmg: acm.map((r) => r.dmg),
      oppHp: x.hpDef, oppEnergy: x.eDef, oppShields: x.sDef, oppCmpAtk: o.cmpAtk, oppFast: o.fast,
      oppCharges: oppAcm.map((r) => r.c), oppFastDmg, oppChargeDmg: oppAcm.map((r) => r.dmg), oppCooldown,
    };
    const winsCMP = m.cmpAtk >= o.cmpAtk;
    const myCd = m.fast.turns * 500, oppFastCd = o.fast.turns * 500;
    const readyIn = acm.map((r) => (e >= r.c.energy ? 0 : Math.ceil((r.c.energy - e) / m.fast.energyGain) * m.fast.turns));
    let ttl = turnsToLive(v);
    // If it cannot throw a fast move and live, throw the most damaging move it can.
    if (x.hpAtt <= oppFastDmg * 2 && oppFastCd === 500) ttl--;
    if (x.hpAtt <= oppFastDmg && oppCooldown > 0 && oppFastCd > 500) {
      ttl = oppCooldown / 500;
      if (x.hpDef > fastDmg) ttl--;
    }
    if (x.hpAtt <= oppFastDmg && oppCooldown === 0 && oppFastCd <= myCd + 500 && x.hpDef > fastDmg) ttl--;
    if (ttl * 500 < myCd || (ttl * 500 === myCd && !winsCMP) || (ttl * 500 === myCd && x.hpAtt <= oppFastDmg)) {
      let pick: ChargeMove | null = null, prev = -1;
      for (let n = acm.length - 1; n >= 0; n--) {
        if (readyIn[n] !== 0) continue;
        if (acm[n].dmg > prev) { pick = acm[n].c; prev = acm[n].dmg; }
        if (e >= acm[n].c.energy * 2 && m.cmpAtk > o.cmpAtk && acm[n].dmg * 2 > prev) { pick = acm[n].c; prev = acm[n].dmg * 2; }
      }
      return pick;
    }
    // A lethal charged move, if the opponent is not about to fall to a fast move.
    if (x.sDef === 0 && e >= acm[0].c.energy && x.hpDef <= acm[0].dmg && !selfDebuffing(acm[0].c) && x.hpDef > fastDmg) return acm[0].c;
    const broken = breaker(acm, e, o, x.sDef);
    if (broken) return broken;
    if (optimizeTiming && holdsForTiming(v, ttl)) return null;
    const gulp = gulper(m, e, x.hpDef, acm);
    if (gulp) return gulp;

    const best = bestCharged(acm), fastest = acm[0];
    const bestCycle = best.dmg + fastDmg * Math.ceil(best.c.energy / m.fast.energyGain);
    const minCycle = selfDebuffing(best.c) && best.c.energy > fastest.c.energy && best.dpe / fastest.dpe < 2 ? 1.1 : 2;
    if (x.hpDef / bestCycle > minCycle) {
      // The KO is cycles away: build to the best move.
      let sel = best;
      if (acm.length > 1)
        for (let i = 0; i < acm.length; i++) {
          if (selfDebuffing(best.c) && !selfDebuffing(acm[i].c) && sel.dpe / acm[i].dpe < 2) sel = acm[i];
          if (x.sDef > 0 && !selfDebuffing(acm[0].c) && wouldShield(me, acm[i].c, e)) sel = acm[0];
        }
      if (e < sel.c.energy) return null;
      if (selfDebuffing(sel.c) && e < e + Math.floor((100 - e) / m.fast.energyGain) * m.fast.energyGain) return null;
      return sel.c;
    }

    // The DP. Priority queue ordered by turn. Damage depends only on the move
    // and the attack stage it is tried at, so each pair is computed once.
    // Indexed by attack stage + 4; one slot per charged move plus the fast move.
    const memo = acm.map(() => new Array<number>(9));
    const fastMemo = new Array<number>(9);
    const hitDP = (n: number, buff: number) => {
      const row = n < 0 ? fastMemo : memo[n];
      return (row[buff + 4] ??= n < 0 ? hitAt(x, m.fast, false, buff) : hitAt(x, acm[n].c, true, buff));
    };
    const Q: DPState[] = [{ energy: e, oppHealth: x.hpDef, turn: 0, oppShields: x.sDef, moves: [], buffs: 0, chance: 1 }];
    const found: DPState[] = [];
    let states = 0;
    let newEnergy = undefined as unknown as number; // PvPoke's function-scoped var
    const place = (st: DPState, until: number, strict: boolean) => {
      if (!Q.length) { Q.unshift(st); return; }
      let i = 0;
      while (strict ? Q[i].turn < until : Q[i].turn <= until) { i++; if (i === Q.length) break; }
      Q.splice(i, 0, st);
    };
    const debuffScore = (moves: ChargeMove[]) => moves.reduce((n, c) =>
      n + (selfDebuffing(c) ? 1 : 0) - (c.buffs && c.buffs.chance === 1 && c.buffs.target === 'self' && c.buffs.atkStage + c.buffs.defStage > 0 ? 1 : 0), 0);
    while (Q.length) {
      if (states >= 500) return null;
      states++;
      const cur = Q.shift()!;
      cur.buffs = Math.max(-4, Math.min(4, cur.buffs));
      if (cur.oppHealth <= 0) {
        found.push(cur);
        if (cur.chance === 1) break;
        continue;
      }
      const rdy = acm.map((r) => (cur.energy >= r.c.energy ? 0 : Math.ceil((r.c.energy - cur.energy) / m.fast.energyGain) * m.fast.turns));
      for (let n = 0; n < acm.length; n++) {
        const mv = acm[n].c;
        const moveDamage = hitDP(n, cur.buffs);
        const fastSim = hitDP(-1, cur.buffs);
        const toFarm = Math.ceil(cur.oppHealth / fastSim);
        place({ energy: cur.energy + m.fast.energyGain * toFarm, oppHealth: 0, turn: cur.turn + toFarm * m.fast.turns,
          oppShields: undefined as unknown as number, moves: cur.moves, buffs: cur.buffs, chance: cur.chance },
          cur.turn + toFarm * m.fast.turns, false);
        let attackMult = cur.buffs;
        if (mv.buffs && mv.buffs.chance === 1) {
          if (mv.buffs.target === 'self') attackMult += mv.buffs.atkStage;
          else attackMult -= mv.buffs.defStage;
        }
        const stackTwo = selfDebuffing(mv) && mv.buffs!.atkStage < 0 && mv.energy * 2 <= 100;
        let newShields = cur.oppShields > 0 ? cur.oppShields - 1 : cur.oppShields;
        if (rdy[n] === 0) {
          let newOppHealth = cur.oppShields > 0 ? cur.oppHealth - 1 : cur.oppHealth - moveDamage;
          let i = 0, insertEl = true;
          while (i < Q.length && Q[i].turn === cur.turn + 1) {
            if (Q[i].oppHealth === newOppHealth && Q[i].buffs === attackMult) {
              if (Q[i].energy === cur.energy - mv.energy && debuffScore(Q[i].moves) > debuffScore([...cur.moves, mv])) Q.splice(i, 1);
              else { insertEl = false; i++; }
            } else i++;
          }
          if (insertEl) {
            // With the queue empty PvPoke inserts the stale newEnergy; otherwise the true one.
            const energy = Q.length ? cur.energy - mv.energy : newEnergy;
            place({ energy, oppHealth: newOppHealth, turn: cur.turn + 1, oppShields: newShields, moves: [...cur.moves, mv], buffs: attackMult, chance: cur.chance }, cur.turn + 1, false);
          }
          if (stackTwo) {
            let newTurn = Math.ceil((mv.energy * 2 - cur.energy) / m.fast.energyGain) * m.fast.turns;
            newEnergy = Math.floor(newTurn / m.fast.turns) * m.fast.energyGain + cur.energy - mv.energy;
            if (newTurn !== 0) {
              newOppHealth = cur.oppHealth - fastSim * (newTurn / m.fast.turns) - (cur.oppShields > 0 ? 1 : moveDamage);
              newTurn += cur.turn + 1;
              place({ energy: newEnergy, oppHealth: newOppHealth, turn: newTurn, oppShields: newShields, moves: [...cur.moves, mv], buffs: attackMult, chance: cur.chance }, newTurn, false);
            }
          }
        } else {
          newEnergy = cur.energy - mv.energy + m.fast.energyGain * (rdy[n] / m.fast.turns);
          let newOppHealth = cur.oppShields > 0
            ? cur.oppHealth - fastSim * (rdy[n] / m.fast.turns) - 1
            : cur.oppHealth - moveDamage - fastSim * (rdy[n] / m.fast.turns);
          let newTurn = cur.turn + rdy[n] + 1;
          newShields = cur.oppShields > 0 ? cur.oppShields - 1 : cur.oppShields;
          place({ energy: newEnergy, oppHealth: newOppHealth, turn: newTurn, oppShields: newShields, moves: [...cur.moves, mv], buffs: attackMult, chance: cur.chance }, newTurn, true);
          if (stackTwo) {
            newTurn = Math.ceil((mv.energy * 2 - cur.energy) / m.fast.energyGain) * m.fast.turns;
            newEnergy = Math.floor(newTurn / m.fast.turns) * m.fast.energyGain + cur.energy - mv.energy;
            newOppHealth = cur.oppHealth - fastSim * (newTurn / m.fast.turns) - (cur.oppShields > 0 ? 1 : moveDamage);
            newTurn += cur.turn + 1;
            place({ energy: newEnergy, oppHealth: newOppHealth, turn: newTurn, oppShields: newShields, moves: [...cur.moves, mv], buffs: attackMult, chance: cur.chance }, newTurn, true);
          }
        }
      }
    }
    if (!found.length) return null;
    const pvTurn = turn + 1 + chargedRounds;
    tko[me] = pvTurn + found[found.length - 1].turn;
    // With more than one plan and the opponent faster, PvPoke compares chance
    // against a state object here (always false), so it keeps the first plan.
    const other = me === 'A' ? 'B' : 'A';
    const plan = found.length === 1 ? found[0] : tko[other] !== -1 && tko[me] > tko[other] ? found[0] : found[found.length - 1];
    const moves = plan.moves.slice();
    if (!moves.length) {
      const boost = boostMove(m);
      if (!boost) return null;
      moves.push(boost);
    }
    const rated = (c: ChargeMove) => acm.find((r) => r.c === c) ?? { c, dmg: 0, dpe: 0 };
    // Bait: build to a more efficient move the opponent would have to shield.
    if (x.sDef > 0 && acm.length > 1)
      for (let i = 1; i < acm.length; i++)
        if (e < acm[i].c.energy && acm[i].dpe > rated(moves[0]).dpe &&
          !(acm[i].dpe / acm[0].dpe <= 1.5 && selfBuffing(acm[0].c))) return null;
    // Don't bait if the opponent won't shield.
    if (x.sDef > 0 && acm.length > 1)
      for (let i = 1; i < acm.length; i++) {
        const ratio = (acm[i].dmg / acm[i].c.energy) / (rated(moves[0]).dmg / moves[0].energy);
        if (e >= acm[i].c.energy && ratio > 1.5 && !wouldShield(me, acm[i].c, e)) moves[0] = acm[i].c;
      }
    if (x.sDef === 0 && !moves.some(selfDebuffing)) moves.sort((p, q) => rated(q).dmg - rated(p).dmg);
    const choice = refineChoice(moves[0], {
      hp: x.hpAtt, maxHp: m.hp, energy: e, shields: x.sAtt, fastTurns: m.fast.turns, acm,
      oppHp: x.hpDef, oppEnergy: x.eDef, oppShields: x.sDef, oppFastDmg, oppFastTurns: o.fast.turns,
      oppBest: oppAcm.length ? bestCharged(oppAcm) : null, oppLoaded: !!missileOf(o),
      wouldShieldOppBest: () => wouldShield(other, bestCharged(oppAcm).c, x.eDef),
      oppWouldShield: (c) => wouldShield(me, c, e),
    });
    if (choice && banking(m, e, best.dmg, x.hpDef)) return null;
    return choice;
  };
  // PvPoke's Aegislash Shield banks energy before it commits to Blade, unless
  // its best charged move would already finish the opponent.
  const banking = (m: BattleMon, e: number, bestDmg: number, oppHp: number) =>
    triggers(m, 'activate_charged') && e < 100 - m.fast.energyGain / 2 && bestDmg < oppHp;

  const syncDerived = () => {
    atkA = a.atk * buffMultiplier(stA.atk);
    defA = a.def * buffMultiplier(stA.def);
    atkB = b.atk * buffMultiplier(stB.atk);
    defB = b.def * buffMultiplier(stB.def);
    catkA = chargeAtk(a) * buffMultiplier(stA.atk);
    catkB = chargeAtk(b) * buffMultiplier(stB.atk);
    fA = dmg(atkA, defB, a.fast, b.types);
    fB = dmg(atkB, defA, b.fast, a.types);
    // Move roles are re-derived too: damage per energy is what decides main
    // from secondary, and a debuff can genuinely reorder them.
    rolesA = classifyCharges(catkA, defB, a.charges, b.types);
    rolesB = classifyCharges(catkB, defA, b.charges, a.types);
    chargeDmgA = a.charges.map((c) => dmg(catkA, defB, c, b.types));
    chargeDmgB = b.charges.map((c) => dmg(catkB, defA, c, a.types));
    acmA = activeOrder(a.charges, chargeDmgA);
    acmB = activeOrder(b.charges, chargeDmgB);
    worstFromA = chargeDmgA.length ? Math.max(...chargeDmgA) : 0;
    worstFromB = chargeDmgB.length ? Math.max(...chargeDmgB) : 0;
  };
  syncDerived();

  /**
   * Apply a charged move's stat effect after it resolves.
   *
   * Deliberately runs whether or not the move was shielded: a shield blocks
   * damage, never the secondary effect, so an Acid Spray eaten on a shield
   * still leaves the defence debuff behind. Returns the log text, or null when
   * the move has no buff or its chance roll missed.
   */
  const applyBuff = (move: ChargeMove, selfIsA: boolean): string | null => {
    const buffs = move.buffs;
    if (!buffs) return null;
    if (buffs.chance < 1) {
      // PvPoke's meter, one per move per side, float ops in its order.
      const key = (selfIsA ? 'A' : 'B') + move.id;
      const was = meters.get(key) ?? (buffs.chance === 0.5 ? 0 : buffs.chance);
      meters.set(key, was + buffs.chance);
      if (Math.floor(was + buffs.chance) <= Math.floor(was)) return null;
    }
    const dAtk = buffs.atkStage;
    const dDef = buffs.defStage;
    if (!dAtk && !dDef) return null;
    const toSelf = buffs.target === 'self';
    const target = (selfIsA ? toSelf : !toSelf) ? stA : stB;
    target.atk = clampStage(target.atk + dAtk);
    target.def = clampStage(target.def + dDef);
    syncDerived();
    return describeBuff(buffs, dAtk, dDef, selfIsA ? 'A' : 'B', selfIsA ? 'B' : 'A');
  };

  const log: BattleLogEntry[] = [];


  for (let turn = 0; turn < 480 && hpA > 0 && hpB > 0; turn++) {
    // A move registers on the last turn of its animation.
    const registersA = tA <= 1;
    const registersB = tB <= 1;
    // You can only start a charged move between fast moves, not mid-animation.
    const freeA = tA >= a.fast.turns;
    const freeB = tB >= b.fast.turns;

    const moveA = freeA ? decide('A', turn) : null;
    const moveB = freeB ? decide('B', turn) : null;

    // A fast move that lands this turn and kills resolves first, ahead of any
    // charged move either side has banked. The charged move costs a turn to
    // throw, so a fast hit that is already registering gets there first and
    // snipes — the kill happens before the charge is ever released. Only a
    // move registering *this* turn qualifies; one still mid-animation does not.
    const snipe = (registersA && fA >= hpB) || (registersB && fB >= hpA);
    if ((moveA || moveB) && !snipe) {
      chargedRounds++;
      // Priority is decided on the Attack *stat*, so this reads `cmpAtk` and
      // not `atkA`/`atkB`: those carry Shadow's x6/5 damage multiplier, which
      // is not part of the stat. Stat stages *are* part of it, and stay.
      // Only computed when both sides are actually throwing, which is the only
      // case the comparison is read in.
      const priorityA = () => a.cmpAtk * buffMultiplier(stA.atk) >= b.cmpAtk * buffMultiplier(stB.atk);
      const order: ('A' | 'B')[] = moveA && moveB ? (priorityA() ? ['A', 'B'] : ['B', 'A']) : moveA ? ['A'] : ['B'];
      // PvPoke uses charge priority only when the Attack stats differ (or in a
      // Cramorant mirror); on a tie both moves resolve, so both can faint.
      const simultaneous = a.cmpAtk === b.cmpAtk && !(cramorant(a) && cramorant(b));
      if (moveA && moveB) cmpDecided = true;
      for (const who of order) {
        if (who === 'A' && (hpA > 0 || simultaneous) && moveA) {
          eA -= moveA.energy;
          if (triggers(a, 'activate_charged', moveA.id)) toForm(a);
          const raw = dmg(atkA, defB, moveA, b.types);
          // Aegislash Shield keeps its shields for Blade against a hit it can take twice.
          const shielded = sB > 0 && (policyB === 'always' ? pvpokeShields('A', moveA, raw) : !holdsShield(b, a, raw, hpB) && shieldCall(policyB, raw, hpB, worstFromA));
          // A bait thrown into a live shield and waved through is a read that
          // came back wrong; stop baiting this opponent.
          // Mimikyu's Disguise takes the first charged move it does not shield.
          const disguisedB = !shielded && triggers(b, 'charged_move_damage');
          const damage = shielded || disguisedB ? 1 : raw;
          if (shielded) sB--;
          if (shielded && triggers(b, 'activate_shield')) toForm(b);
          hpB -= damage;
          // A shield blocks damage, never the secondary effect.
          let buffTextA = applyBuff(moveA, true);
          if (disguisedB) {
            toForm(b);
            buffTextA = [buffTextA, 'Disguise busted'].filter(Boolean).join(' · ');
          }
          // After the move resolves: Morpeko, and Cramorant's Dive or Surf.
          if (triggers(a, 'charged_move', moveA.id)) toForm(a, hpA);
          // The sequence resets both animations — that reset is what grants
          // the defender "free" turns when thrown at the wrong moment.
          tA = a.fast.turns;
          tB = b.fast.turns;
          if (collectLog) log.push({
            turn,
            actor: 'A',
            kind: 'charge',
            moveName: moveA.name,
            bait: shielded && moveA === rolesA.secondary,
            shielded,
            damage,
            hpA: Math.max(0, hpA),
            hpB: Math.max(0, hpB),
            energyA: eA,
            energyB: eB,
            atkStageA: stA.atk,
            defStageA: stA.def,
            atkStageB: stB.atk,
            defStageB: stB.def,
            buffText: buffTextA,
          });
          // Gulp Missile: a loaded Cramorant hit by a charged move it did not
          // shield fires back at once - 15% of the attacker's max HP + 1, no
          // shield, even from 0 HP (PvPoke's instant and ignoresFaint) - then
          // returns to its base form.
          const missileB = shielded ? null : missileOf(b);
          if (missileB) {
            const hit = Math.floor((missileB.power / 100) * a.hp) + 1;
            hpA -= hit;
            const text = applyBuff(missileB, false);
            toForm(b, hpB);
            if (collectLog) log.push({ turn, actor: 'B', kind: 'charge', moveName: missileB.name, bait: false,
              shielded: false, damage: hit, hpA: Math.max(0, hpA), hpB: Math.max(0, hpB), energyA: eA, energyB: eB,
              atkStageA: stA.atk, defStageA: stA.def, atkStageB: stB.atk, defStageB: stB.def, buffText: text });
          }
        }
        if (who === 'B' && (hpB > 0 || simultaneous) && moveB) {
          eB -= moveB.energy;
          if (triggers(b, 'activate_charged', moveB.id)) toForm(b);
          const raw = dmg(atkB, defA, moveB, a.types);
          const shielded = sA > 0 && (policyA === 'always' ? pvpokeShields('B', moveB, raw) : !holdsShield(a, b, raw, hpA) && shieldCall(policyA, raw, hpA, worstFromB));
          const disguisedA = !shielded && triggers(a, 'charged_move_damage');
          const damage = shielded || disguisedA ? 1 : raw;
          if (shielded) sA--;
          if (shielded && triggers(a, 'activate_shield')) toForm(a);
          hpA -= damage;
          let buffTextB = applyBuff(moveB, false);
          if (disguisedA) {
            toForm(a);
            buffTextB = [buffTextB, 'Disguise busted'].filter(Boolean).join(' · ');
          }
          if (triggers(b, 'charged_move', moveB.id)) toForm(b, hpB);
          tA = a.fast.turns;
          tB = b.fast.turns;
          if (collectLog) log.push({
            turn,
            actor: 'B',
            kind: 'charge',
            moveName: moveB.name,
            bait: shielded && moveB === rolesB.secondary,
            shielded,
            damage,
            hpA: Math.max(0, hpA),
            hpB: Math.max(0, hpB),
            energyA: eA,
            energyB: eB,
            atkStageA: stA.atk,
            defStageA: stA.def,
            atkStageB: stB.atk,
            defStageB: stB.def,
            buffText: buffTextB,
          });
          // Gulp Missile: a loaded Cramorant hit by a charged move it did not
          // shield fires back at once - 15% of the attacker's max HP + 1, no
          // shield, even from 0 HP (PvPoke's instant and ignoresFaint) - then
          // returns to its base form.
          const missileA = shielded ? null : missileOf(a);
          if (missileA) {
            const hit = Math.floor((missileA.power / 100) * b.hp) + 1;
            hpB -= hit;
            const text = applyBuff(missileA, true);
            toForm(a, hpA);
            if (collectLog) log.push({ turn, actor: 'A', kind: 'charge', moveName: missileA.name, bait: false,
              shielded: false, damage: hit, hpA: Math.max(0, hpA), hpB: Math.max(0, hpB), energyA: eA, energyB: eB,
              atkStageA: stA.atk, defStageA: stA.def, atkStageB: stB.atk, defStageB: stB.def, buffText: text });
          }
        }
      }
      // The sneak, and it is GUARANTEED rather than incidental.
      //
      // Throwing a charged move without charge-move priority always lets the
      // opponent's fast attack through, resolved after the charged damage. It
      // does not matter where in its animation that fast move happened to be —
      // the throw creates the opening, so the fast hit always comes.
      //
      // This used to be gated on `registersA`: the sneak only landed if the
      // defender's animation happened to complete on that exact turn. The
      // comment reasoned correctly about the mirror-match case, where equal
      // turn counts make the registrations coincide, and wrongly concluded the
      // general rule from it. Everywhere else the defender was silently robbed
      // of a fast move on every single charged throw — damage AND the energy
      // that comes with it.
      //
      // Azumarill vs Lickilicky is the case that exposed it. At turn 49
      // Azumarill sat one turn into a three-turn Bubble, so the old condition
      // denied the sneak; with it, Azumarill reaches 61 energy at turn 49
      // rather than 52, lands Play Rough at 50, and wins on 2 HP instead of
      // dying to one more Rollout.
      //
      // The one exception is a knockout: if the charged move killed, the
      // victim's fast move never lands, which is what `hpA > 0` enforces.
      if (hpA > 0 && !moveA && hpB > 0) {
        hpB -= fA;
        eA = Math.min(100, eA + a.fast.energyGain);
        if (collectLog) log.push({ turn, actor: 'A', kind: 'fast', moveName: a.fast.name, bait: false,
          shielded: false, damage: fA, hpA: Math.max(0, hpA), hpB: Math.max(0, hpB), energyA: eA, energyB: eB,
          atkStageA: stA.atk, defStageA: stA.def, atkStageB: stB.atk, defStageB: stB.def, buffText: null });
      }
      // Mirror of the above for the other side; see the note there.
      if (hpB > 0 && !moveB && hpA > 0) {
        hpA -= fB;
        eB = Math.min(100, eB + b.fast.energyGain);
        if (collectLog) log.push({ turn, actor: 'B', kind: 'fast', moveName: b.fast.name, bait: false,
          shielded: false, damage: fB, hpA: Math.max(0, hpA), hpB: Math.max(0, hpB), energyA: eA, energyB: eB,
          atkStageA: stA.atk, defStageA: stA.def, atkStageB: stB.atk, defStageB: stB.def, buffText: null });
      }
      continue;
    }
    if (--tA <= 0) {
      hpB -= fA;
      eA = Math.min(100, eA + a.fast.energyGain);
      tA = a.fast.turns;
      if (collectLog) log.push({
        turn,
        actor: 'A',
        kind: 'fast',
        moveName: a.fast.name,
        bait: false,
        shielded: false,
        damage: fA,
        hpA: Math.max(0, hpA),
        hpB: Math.max(0, hpB),
        energyA: eA,
        energyB: eB,
        atkStageA: stA.atk,
        defStageA: stA.def,
        atkStageB: stB.atk,
        defStageB: stB.def,
        buffText: null,
      });
    }
    if (--tB <= 0) {
      hpA -= fB;
      eB = Math.min(100, eB + b.fast.energyGain);
      tB = b.fast.turns;
      if (collectLog) log.push({
        turn,
        actor: 'B',
        kind: 'fast',
        moveName: b.fast.name,
        bait: false,
        shielded: false,
        damage: fB,
        hpA: Math.max(0, hpA),
        hpB: Math.max(0, hpB),
        energyA: eA,
        energyB: eB,
        atkStageA: stA.atk,
        defStageA: stA.def,
        atkStageB: stB.atk,
        defStageB: stB.def,
        buffText: null,
      });
    }
  }
  const finalHpA = Math.max(0, hpA);
  const finalHpB = Math.max(0, hpB);
  const mine = finalHpA / a.hp;
  const theirs = finalHpB / b.hp;
  const win = hpA <= 0 && hpB <= 0 ? a.cmpAtk >= b.cmpAtk : mine > theirs;
  return {
    win,
    mine,
    theirs,
    hpA: finalHpA,
    hpB: finalHpB,
    maxHpA: a.hp,
    maxHpB: b.hp,
    cmpDecided,
    margin: (mine - theirs) * 100,
    energyA: eA,
    energyB: eB,
    shieldsA: sA,
    shieldsB: sB,
    log,
  };
}

export function mkBattleMon(
  entry: { atk: number; def: number; hp: number; statAtk?: number; forms?: BattleForms },
  fast: FastMove,
  charges: ChargeMove[],
  types: readonly string[],
): BattleMon {
  // `statAtk` is optional so a hand-built entry in a test can omit it; absent,
  // the mon is not a Shadow and the two are the same number by definition.
  return {
    atk: entry.atk,
    cmpAtk: entry.statAtk ?? entry.atk,
    def: entry.def,
    hp: entry.hp,
    fast,
    charges,
    types,
    ...(entry.forms ? { forms: entry.forms, form: entry.forms.start } : {}),
  };
}

// ── Verdict copy ──
export function verdictLine(rank: number): string {
  if (rank === 1) return 'Rank 1 · maximum stat product at cap';
  if (rank <= 10) return 'Top 10 · elite spread, worth full investment';
  if (rank <= 100) return 'Top 100 · strong spread, safe investment';
  if (rank <= 500) return 'Top 500 · playable, expect small SP losses';
  if (rank <= 1500) return 'Mid pack · replace when a better spread appears';
  return 'Bottom half · not competitive at this cap';
}

export function verdictTagClass(rank: number): string {
  if (rank <= 10) return 'tag tag-accent';
  if (rank <= 500) return 'tag tag-neutral';
  return 'tag tag-outline';
}

export function shortVerdict(rank: number): string {
  if (rank <= 10) return 'Elite';
  if (rank <= 100) return 'Strong';
  if (rank <= 500) return 'Playable';
  if (rank <= 1500) return 'Mid';
  return 'Transfer';
}

// ── Heatmap palette ──────────────────────────────────────────────────────
//
// The ramp used to run from neutral to the app accent, so every species got
// the same orange heatmap regardless of what it was. It now derives from the
// Pokémon's own typing: intensity still encodes the metric, but hue travels
// from the primary type to the secondary as the value climbs, giving each
// species a recognisable palette. Mono-types collapse to a single hue, which
// is the correct degenerate case rather than a special one.
//
// Expressed as nested color-mix() so the values stay CSS: the 3D terrain
// resolves them through the browser (see lib/cssColor.ts), which means the
// flat grid and the terrain can't drift apart.

export interface HeatPalette {
  /** Primary type colour — the low end of the ramp. */
  a: string;
  /** Secondary type colour, or the primary again for mono-types. */
  b: string;
}

export function paletteFor(species: Species): HeatPalette {
  const t = species.types.filter(Boolean);
  const a = t[0] ? `var(--type-${t[0]})` : 'var(--color-accent)';
  return { a, b: t[1] ? `var(--type-${t[1]})` : a };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Hue at position `t` along the ramp, primary → secondary. */
function hueAt(pal: HeatPalette, t: number): string {
  return pal.a === pal.b ? pal.a : `color-mix(in srgb, ${pal.b} ${Math.round(clamp01(t) * 100)}%, ${pal.a})`;
}

export function cellColorMix(pct: number, pal: HeatPalette): string {
  const p = clamp01(pct);
  // Gamma keeps the crowded top of the rank distribution from washing out.
  const w = Math.round(Math.pow(p, 2.2) * 100);
  return `color-mix(in srgb, ${hueAt(pal, p)} ${w}%, var(--color-neutral-200))`;
}

export function tierColor(i: number, n: number, pal: HeatPalette): string {
  const t = n <= 1 ? 0.5 : i / (n - 1);
  // Discrete tiers need a floor, or the lowest band is invisible.
  const w = Math.round(16 + t * 84);
  return `color-mix(in srgb, ${hueAt(pal, t)} ${w}%, var(--color-neutral-200))`;
}

/** Ramp samples for the legend, so swatches and cells can't disagree. */
export function paletteRamp(pal: HeatPalette, steps: number): string[] {
  return Array.from({ length: steps }, (_, i) => tierColor(steps - 1 - i, steps, pal));
}

// ── Matchup flips: which IV spreads flip a shielded/CMP scenario from loss to win ──
export interface FlipCellResult {
  entry: RankedEntry;
  result: BattleResult;
}
export interface FlipGrid {
  results: FlipCellResult[];
  winners: FlipCellResult[];
  cheapest: FlipCellResult | null;
  minAtkWin: FlipCellResult | null;
  total: number;
  opponentMon: BattleMon;
  opponentInfo: OpponentInfo;
}

const flipCache = new Map<string, FlipGrid>();

/**
 * `shieldsTheirs` defaults to `shieldsMine` so existing symmetric callers are
 * unchanged, but the two are independent: shielding is rarely even, and a
 * spread that wins 1v1 can lose 1v2.
 */
export function flipGrid(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  oppSpeciesId: string,
  moveIdx: number,
  shieldsMine: number,
  chargeIds?: string[],
  shieldsTheirs: number = shieldsMine,
): FlipGrid {
  const key = [speciesId, leagueId, oppSpeciesId, moveIdx, shieldsMine, shieldsTheirs, iv.s, (chargeIds ?? []).join('+')].join('|');
  const cached = flipCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const { table } = getEntry(speciesId, iv, leagueId);
  const opp = opponentInfo(oppSpeciesId, leagueId);
  const opponentMon = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2), opp.types);
  const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const myCharges = selectedCharges(species, chargeIds);

  const slice: RankedEntry[] = [];
  for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(table.map.get(a * 256 + d * 16 + iv.s)!);

  const results: FlipCellResult[] = slice.map((entry) => ({
    entry,
    // No log: the grid only ever reads win/margin, but these 256 results are
    // cached indefinitely and a full turn log per cell is a large retained
    // allocation for data nothing looks at.
    result: battle(mkBattleMon(entry, myFast, myCharges, species.types), opponentMon, shieldsMine, shieldsTheirs, 0, 0, false),
  }));
  const winners = results.filter((o) => o.result.win);
  const cheapest = winners.length ? winners.slice().sort((p, q) => p.entry.rank - q.entry.rank)[0] : null;
  const minAtkWin = winners.length ? winners.slice().sort((p, q) => p.entry.atk - q.entry.atk)[0] : null;

  const out: FlipGrid = { results, winners, cheapest, minAtkWin, total: slice.length, opponentMon, opponentInfo: opp };
  flipCache.set(key, out);
  return out;
}

export interface FlipMatchupRow {
  species: OpponentInfo;
  cells: { win: boolean; margin: number }[];
  cmpWin: boolean;
  flips: number;
}

/**
 * One row per opponent, three cells = *your* shield count 0/1/2 against a
 * fixed opponent count. Previously both sides moved together, which could only
 * ever show the symmetric diagonal; holding theirs fixed is what makes the
 * asymmetric scenarios comparable across opponents.
 */
export function flipMatchupRows(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  moveIdx: number,
  opponentIds: string[],
  chargeIds?: string[],
  shieldsTheirs?: number,
): FlipMatchupRow[] {
  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const { entry } = getEntry(speciesId, iv, leagueId);
  const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const you = mkBattleMon(entry, myFast, selectedCharges(species, chargeIds), species.types);

  return opponentIds.map((oid) => {
    const opp = opponentInfo(oid, leagueId);
    const foe = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2), opp.types);
    const cells = [0, 1, 2].map((mine) => {
      const r = battle(you, foe, mine, shieldsTheirs ?? mine, 0, 0, false);
      return { win: r.win, margin: r.margin };
    });
    return {
      species: opp,
      cells,
      cmpWin: entry.statAtk >= foe.cmpAtk,
      flips: cells.filter((c) => c.win).length,
    };
  });
}

// ── Head-to-head battle simulator: full 3x3 shield-count matrix ──
export function shieldMatrix(
  a: BattleMon,
  b: BattleMon,
  energyA = 0,
  energyB = 0,
  optimizeTiming = false,
): BattleResult[][] {
  return [0, 1, 2].map((sA) => [0, 1, 2].map((sB) => battle(a, b, sA, sB, energyA, energyB, true, optimizeTiming)));
}

/** One outcome cell: everything the scenario picker needs to render. */
export interface ScenarioCell {
  win: boolean;
  margin: number;
}

const scenarioCache = new Map<string, ScenarioCell[][]>();

/**
 * All nine shield scenarios for *this exact spread* against one opponent,
 * indexed [yourShields][theirShields].
 *
 * Distinct from flipGrid, which sweeps 256 spreads at one scenario; this is
 * one spread across every scenario. Keyed on the full IV rather than just the
 * HP slice, because unlike the grid it depends on the specific roll.
 *
 * Logs are skipped — nothing here reads them, and nine simulations per
 * keystroke of the IV adjuster is worth keeping cheap.
 */
export function scenarioMatrix(
  ref: string,
  iv: IV,
  leagueId: LeagueId,
  oppRef: string,
  moveIdx: number,
  chargeIds?: string[],
): ScenarioCell[][] {
  const key = [ref, leagueId, oppRef, moveIdx, ivKey(iv), (chargeIds ?? []).join('+')].join('|');
  const cached = scenarioCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(parseRef(ref).id)!;
  const { entry } = getEntry(ref, iv, leagueId);
  const opp = opponentInfo(oppRef, leagueId);
  const you = mkBattleMon(entry, species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)], selectedCharges(species, chargeIds), species.types);
  const foe = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2), opp.types);

  const out = [0, 1, 2].map((mine) =>
    [0, 1, 2].map((theirs) => {
      const r = battle(you, foe, mine, theirs, 0, 0, false);
      return { win: r.win, margin: r.margin };
    }),
  );
  scenarioCache.set(key, out);
  return out;
}
