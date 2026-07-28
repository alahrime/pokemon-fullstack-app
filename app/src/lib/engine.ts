import { CPM, LVL, MAX_LEVEL_IDX } from './cpm';
import { LEAGUE_BY_ID, OPPONENT_POOL_BY_ID, SPECIES_BY_ID, opponentCandidatesFor, opponentsFor, parseRef } from './data';
import type {
  BattleLogEntry,
  BattleMon,
  BattleResult,
  ChargeMove,
  FastMove,
  IV,
  League,
  LeagueId,
  RankedEntry,
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

export function bestAt(species: Species, iv: IV, league: League): StatLine {
  for (let i = MAX_LEVEL_IDX; i >= 0; i--) {
    const s = statsAt(species, iv, CPM[i]);
    const cp = cpOf(s);
    if (cp <= league.cap) {
      const hp = Math.max(10, s.h);
      return { lvl: LVL(i), cp, atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
    }
  }
  const s = statsAt(species, iv, CPM[0]);
  const hp = Math.max(10, s.h);
  return { lvl: 1, cp: cpOf(s), atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
}

export function dmg(atk: number, def: number, move: FastMove | ChargeMove): number {
  return Math.floor(0.5 * move.power * (atk / def) * move.stab) + 1;
}

/**
 * Shadow multipliers, as the game applies them: ×6/5 attack, ×5/6 defense.
 *
 * Note 1.2 × (5/6) === 1 exactly, so a Shadow's stat product - and therefore
 * its rank within the 4096 - is identical to its non-Shadow counterpart. CP is
 * likewise unchanged, because CP is derived from base stats and IVs before any
 * Shadow adjustment. So the multipliers are applied *after* sp/cp/rank are
 * computed, touching only the battle stats that feed damage, breakpoints,
 * bulkpoints and the simulator.
 *
 * The practical upshot, worth knowing when reading the report: going Shadow
 * never moves your rank. It moves every damage threshold.
 */
export const SHADOW_ATK_MULT = 6 / 5;
export const SHADOW_DEF_MULT = 5 / 6;

const tableCache = new Map<string, SpeciesTable>();

/**
 * Tables are keyed by *ref*, not plain species id - `machamp` and
 * `machamp_shadow` are separate tables. Parsing the suffix here rather than
 * threading a boolean means every existing call site (opponents, flip grids,
 * rulers, the simulator) supports Shadow without a signature change.
 */
export function getTable(ref: string, leagueId: LeagueId): SpeciesTable {
  const key = `${ref}|${leagueId}`;
  const cached = tableCache.get(key);
  if (cached) return cached;

  const { id, shadow } = parseRef(ref);
  const species = OPPONENT_POOL_BY_ID.get(id)!;
  const league = LEAGUE_BY_ID.get(leagueId)!;
  const aMult = shadow ? SHADOW_ATK_MULT : 1;
  const dMult = shadow ? SHADOW_DEF_MULT : 1;
  const all: RankedEntry[] = [];
  for (let a = 0; a < 16; a++) {
    for (let d = 0; d < 16; d++) {
      for (let s = 0; s < 16; s++) {
        const r = bestAt(species, { a, d, s }, league);
        // sp / cp / lvl stay on the unadjusted stats; only the battle stats scale.
        all.push({ a, d, s, ...r, atk: r.atk * aMult, def: r.def * dMult, rank: 0 });
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
  sorted.forEach((e) => map.set(ivKey(e), e));
  const out: SpeciesTable = {
    all: sorted,
    map,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    league,
    species,
  };
  tableCache.set(key, out);
  return out;
}

export function getEntry(ref: string, iv: IV, leagueId: LeagueId): { entry: RankedEntry; table: SpeciesTable } {
  const table = getTable(ref, leagueId);
  return { entry: table.map.get(ivKey(iv))!, table };
}

export function bestLeagueFor(speciesId: string, iv: IV): { rank: number; league: League } {
  let best: { rank: number; league: League } | null = null;
  for (const league of LEAGUE_BY_ID.values()) {
    const { entry } = getEntry(speciesId, iv, league.id);
    if (!best || entry.rank < best.rank) best = { rank: entry.rank, league };
  }
  return best!;
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
  dex: number;
  name: string;
  /** Sprite slug of the underlying form (Shadows reuse the base artwork). */
  sprite: string;
  shadow: boolean;
  types: string[];
  atk: number;
  def: number;
  hp: number;
  fastMove: FastMove;
  chargeMove: ChargeMove;
  chargeMove2: ChargeMove | null;
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

export function opponentInfo(ref: string, leagueId: LeagueId): OpponentInfo {
  const { id, shadow } = parseRef(ref);
  const species = OPPONENT_POOL_BY_ID.get(id)!;
  // best.atk/def already carry the Shadow multipliers when ref is a Shadow.
  const best = getTable(ref, leagueId).best;
  return {
    id: ref,
    dex: species.dex,
    name: shadow ? `${species.name} (Shadow)` : species.name,
    sprite: species.sprite,
    shadow,
    types: species.types,
    atk: best.atk,
    def: best.def,
    hp: best.hp,
    fastMove: species.fastMoves[0],
    chargeMove: species.chargeMove,
    chargeMove2: species.chargeMove2,
  };
}

export function opponentList(leagueId: LeagueId): Species[] {
  return opponentsFor(leagueId);
}

// ── Does a real breakpoint/bulkpoint exist for this pairing, across every
// reachable stat in the 4096 spread? A flat pairing (same rounded damage no
// matter the IV roll) isn't a relevant matchup to surface. ──
export function hasBreakpoint(table: SpeciesTable, move: FastMove, oppDef: number): boolean {
  const seen = new Set<number>();
  for (const e of table.all) {
    seen.add(dmg(e.atk, oppDef, move));
    if (seen.size > 1) return true;
  }
  return false;
}

export function hasBulkpoint(table: SpeciesTable, oppAtk: number, oppFastMove: FastMove): boolean {
  const seen = new Set<number>();
  for (const e of table.all) {
    seen.add(dmg(oppAtk, e.def, oppFastMove));
    if (seen.size > 1) return true;
  }
  return false;
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

function probeSpreads(table: SpeciesTable, oppAtk: number): ProbeSet {
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

  // Best-ranked spread on each side of the priority threshold, over the full
  // space — table.all is already sorted by stat product, so first match wins.
  let cmpWinner: RankedEntry | null = null;
  let cmpLoser: RankedEntry | null = null;
  for (const e of table.all) {
    if (!cmpWinner && e.atk >= oppAtk) cmpWinner = e;
    else if (!cmpLoser && e.atk < oppAtk) cmpLoser = e;
    if (cmpWinner && cmpLoser) break;
  }

  const out: Probe[] = [
    { label: 'rank1', entry: table.best },
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

const relevanceCache = new Map<string, OpponentRelevance[]>();

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
): OpponentRelevance[] {
  const key = `rel|${ref}|${leagueId}|${moveIdx}|${kind}|${limit}|${(chargeIds ?? []).join('+')}`;
  const cached = relevanceCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(parseRef(ref).id)!;
  const move = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const table = getTable(ref, leagueId);
  const myCharges = selectedCharges(species, chargeIds);
  const candidates = opponentCandidatesFor(leagueId).filter((s) => s.id !== parseRef(ref).id);

  const atkLo = Math.min(...table.all.map((e) => e.atk));
  const atkHi = Math.max(...table.all.map((e) => e.atk));

  const scored: OpponentRelevance[] = [];

  for (const c of candidates) {
    const info = opponentInfo(c.id, leagueId);
    const hasBreak = hasBreakpoint(table, move, info.def);
    const hasBulk = hasBulkpoint(table, info.atk, info.fastMove);
    // Contested only if a spread you'd keep wins priority and one loses it —
    // a CMP win that costs rank 3800 is not a decision anyone makes.
    const cmpContested = info.atk > atkLo && info.atk <= atkHi;

    const foe = mkBattleMon(info, info.fastMove, chargesOf(info.chargeMove, info.chargeMove2));
    const { probes, cmpCost } = probeSpreads(table, info.atk);

    const flipShields: number[] = [];
    let closest = Infinity;
    // Which lever turns the matchup: attack, bulk, or charge-move priority.
    let atkDecides = false;
    let bulkDecides = false;
    let cmpDecides = false;

    for (const shields of SHIELD_SCENARIOS) {
      const wins = new Map<ProbeLabel, boolean>();
      for (const p of probes) {
        const r = battle(mkBattleMon(p.entry, move, myCharges), foe, shields, shields, 0, 0, false);
        wins.set(p.label, r.win);
        const m = Math.abs(r.margin);
        if (m < closest) closest = m;
      }
      const vals = [...wins.values()];
      if (vals.some(Boolean) && !vals.every(Boolean)) {
        flipShields.push(shields);
        // Attribution: the attack-heavy roll wins where the bulky one doesn't
        // (or vice versa), and the CMP straddle isolates priority specifically.
        if (wins.get('atk') && wins.get('def') === false) atkDecides = true;
        if (wins.get('def') && wins.get('atk') === false) bulkDecides = true;
        if (wins.has('cmp+') && wins.has('cmp-') && wins.get('cmp+') !== wins.get('cmp-')) cmpDecides = true;
      }
    }

    // Kind filter: when the user is specifically reading breakpoints, don't
    // pad the list with matchups that are only bulk-relevant, and vice versa.
    if (kind === 'break' && !hasBreak && flipShields.length === 0) continue;
    if (kind === 'bulk' && !hasBulk && flipShields.length === 0) continue;

    const rank = c.leagueRank[leagueId] ?? 9999;
    const razor = closest < 3;

    // A knife-edge — decided in some shield scenarios but not all — is more
    // informative than one that swings everywhere, so weight it higher.
    const knifeEdge = flipShields.length > 0 && flipShields.length < SHIELD_SCENARIOS.length;
    const score =
      (flipShields.length > 0 ? 600 : 0) +
      (knifeEdge ? 400 : 0) +
      (cmpDecides ? 500 : 0) +
      // A cheap CMP win is a better tip than an expensive one.
      (cmpCost != null && cmpCost <= 300 ? 120 : 0) +
      (atkDecides || bulkDecides ? 200 : 0) +
      (cmpContested ? 80 : 0) +
      (hasBreak ? 60 : 0) +
      (hasBulk ? 40 : 0) +
      (razor ? 60 : 0) -
      rank * 0.1;

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
  const candidates = opponentCandidatesFor(leagueId).filter((s) => s.id !== speciesId);

  const scored = candidates
    .map((c) => {
      const info = opponentInfo(c.id, leagueId);
      const hb = kind !== 'bulk' && hasBreakpoint(table, move, info.def);
      const hk = kind !== 'break' && hasBulkpoint(table, info.atk, info.fastMove);
      return { info, relevant: hb || hk, rank: c.leagueRank[leagueId] ?? Number.MAX_SAFE_INTEGER };
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
  const rows: Omit<ThresholdRow, 'met' | 'near'>[] = [];

  species.fastMoves.forEach((mv) => {
    const vals = table.all
      .map((x) => ({ atk: x.atk, d: dmg(x.atk, opp.def, mv), e: x }))
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
    .map((x) => ({ def: x.def, d: dmg(opp.atk, x.def, opp.fastMove), e: x }))
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
        const d = dmg(x.atk, opp.def, mv);
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
      const d = dmg(opp.atk, x.def, opp.fastMove);
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
  const { table } = getEntry(speciesId, iv, leagueId);
  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];

  const slice: RankedEntry[] = [];
  for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(table.map.get(a * 256 + d * 16 + iv.s)!);

  const spMax = table.best.sp;
  const spMin = Math.min(...slice.map((e) => e.sp));
  let tiers: number[] = [];
  if (colorBy === 'break') tiers = [...new Set(slice.map((e) => dmg(e.atk, opp.def, mv)))].sort((x, y) => x - y);
  if (colorBy === 'bulk') tiers = [...new Set(slice.map((e) => dmg(opp.atk, e.def, opp.fastMove)))].sort((x, y) => y - x);

  return slice.map((entry) => {
    const isYou = entry.a === iv.a && entry.d === iv.d;
    let bg: string;
    let label: string;
    if (colorBy === 'rank') {
      bg = cellColorMix((entry.sp - spMin) / Math.max(1e-9, spMax - spMin));
      label = `#${entry.rank}`;
    } else if (colorBy === 'break') {
      const dv = dmg(entry.atk, opp.def, mv);
      bg = tierColor(tiers.indexOf(dv), tiers.length);
      label = `${dv} dmg / ${mv.turns}t`;
    } else {
      const dv = dmg(opp.atk, entry.def, opp.fastMove);
      bg = tierColor(tiers.indexOf(dv), tiers.length);
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
// best damage-per-energy, and a *bait* role is only assigned to another move
// if that move is strictly cheaper than main (there's no point baiting with
// a move that costs more energy than the move you're saving up for anyway).
// While the opponent has shields, throw bait as soon as it's ready; once
// shields are gone (or there's no bait role at all), hold every point of
// energy for main and only throw once main's own threshold is met - never
// fire early just because a weaker move happens to be ready first.
interface ChargeRoles {
  main: ChargeMove;
  bait: ChargeMove | null;
}

function classifyCharges(atk: number, oppDef: number, charges: ChargeMove[]): ChargeRoles {
  if (charges.length === 1) return { main: charges[0], bait: null };
  const byDpe = charges.slice().sort((x, y) => dmg(atk, oppDef, y) / y.energy - dmg(atk, oppDef, x) / x.energy);
  const main = byDpe[0];
  const cheaperAlternative = byDpe.slice(1).find((c) => c.energy < main.energy) ?? null;
  return { main, bait: cheaperAlternative };
}

function pickCharge(roles: ChargeRoles, energy: number, oppShields: number): ChargeMove | null {
  if (roles.bait && oppShields > 0 && energy >= roles.bait.energy) return roles.bait;
  if (energy >= roles.main.energy) return roles.main;
  return null;
}

/**
 * `collectLog: false` skips building the per-turn log. The relevance scorer
 * runs thousands of sims and only reads win/margin; allocating a log object
 * per turn dominated that sweep. Same simulation either way - one branch, no
 * parallel implementation to drift.
 */
export function battle(
  a: BattleMon,
  b: BattleMon,
  shieldsA: number,
  shieldsB: number,
  energyA = 0,
  energyB = 0,
  collectLog = true,
): BattleResult {
  let hpA = a.hp;
  let hpB = b.hp;
  let eA = energyA;
  let eB = energyB;
  let sA = shieldsA;
  let sB = shieldsB;
  let tA = a.fast.turns;
  let tB = b.fast.turns;
  let cmpDecided = false;
  const fA = dmg(a.atk, b.def, a.fast);
  const fB = dmg(b.atk, a.def, b.fast);
  const rolesA = classifyCharges(a.atk, b.def, a.charges);
  const rolesB = classifyCharges(b.atk, a.def, b.charges);
  const log: BattleLogEntry[] = [];

  for (let turn = 0; turn < 480 && hpA > 0 && hpB > 0; turn++) {
    const moveA = pickCharge(rolesA, eA, sB);
    const moveB = pickCharge(rolesB, eB, sA);
    if (moveA || moveB) {
      const order: ('A' | 'B')[] = moveA && moveB ? (a.atk >= b.atk ? ['A', 'B'] : ['B', 'A']) : moveA ? ['A'] : ['B'];
      if (moveA && moveB) cmpDecided = true;
      for (const who of order) {
        if (who === 'A' && hpA > 0 && moveA) {
          eA -= moveA.energy;
          const shielded = sB > 0;
          const damage = shielded ? 1 : dmg(a.atk, b.def, moveA);
          if (shielded) sB--;
          hpB -= damage;
          tA = a.fast.turns;
          if (collectLog) log.push({
            turn,
            actor: 'A',
            kind: 'charge',
            moveName: moveA.name,
            bait: shielded && moveA === rolesA.bait,
            shielded,
            damage,
            hpA: Math.max(0, hpA),
            hpB: Math.max(0, hpB),
            energyA: eA,
            energyB: eB,
          });
        }
        if (who === 'B' && hpB > 0 && moveB) {
          eB -= moveB.energy;
          const shielded = sA > 0;
          const damage = shielded ? 1 : dmg(b.atk, a.def, moveB);
          if (shielded) sA--;
          hpA -= damage;
          tB = b.fast.turns;
          if (collectLog) log.push({
            turn,
            actor: 'B',
            kind: 'charge',
            moveName: moveB.name,
            bait: shielded && moveB === rolesB.bait,
            shielded,
            damage,
            hpA: Math.max(0, hpA),
            hpB: Math.max(0, hpB),
            energyA: eA,
            energyB: eB,
          });
        }
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
      });
    }
  }
  const finalHpA = Math.max(0, hpA);
  const finalHpB = Math.max(0, hpB);
  const mine = finalHpA / a.hp;
  const theirs = finalHpB / b.hp;
  const win = hpA <= 0 && hpB <= 0 ? a.atk >= b.atk : mine > theirs;
  return { win, mine, theirs, hpA: finalHpA, hpB: finalHpB, maxHpA: a.hp, maxHpB: b.hp, cmpDecided, margin: (mine - theirs) * 100, log };
}

export function mkBattleMon(entry: { atk: number; def: number; hp: number }, fast: FastMove, charges: ChargeMove[]): BattleMon {
  return { atk: entry.atk, def: entry.def, hp: entry.hp, fast, charges };
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

// ── Heatmap cell color helpers ──
export function cellColorMix(pct: number): string {
  const w = Math.round(Math.pow(Math.max(0, Math.min(1, pct)), 2.2) * 100);
  return `color-mix(in srgb, var(--color-accent) ${w}%, var(--color-neutral-200))`;
}

const TIER_STEPS = [
  'var(--color-neutral-200)',
  'var(--color-accent-200)',
  'var(--color-accent-400)',
  'var(--color-accent-500)',
  'var(--color-accent-600)',
  'var(--color-accent-700)',
];

export function tierColor(i: number, n: number): string {
  if (n <= 1) return TIER_STEPS[2];
  return TIER_STEPS[Math.min(TIER_STEPS.length - 1, Math.round((i / (n - 1)) * (TIER_STEPS.length - 1)))];
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

export function flipGrid(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  oppSpeciesId: string,
  moveIdx: number,
  shields: number,
  chargeIds?: string[],
): FlipGrid {
  const key = [speciesId, leagueId, oppSpeciesId, moveIdx, shields, iv.s, (chargeIds ?? []).join('+')].join('|');
  const cached = flipCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const { table } = getEntry(speciesId, iv, leagueId);
  const opp = opponentInfo(oppSpeciesId, leagueId);
  const opponentMon = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2));
  const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const myCharges = selectedCharges(species, chargeIds);

  const slice: RankedEntry[] = [];
  for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(table.map.get(a * 256 + d * 16 + iv.s)!);

  const results: FlipCellResult[] = slice.map((entry) => ({
    entry,
    result: battle(mkBattleMon(entry, myFast, myCharges), opponentMon, shields, shields),
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

export function flipMatchupRows(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  moveIdx: number,
  opponentIds: string[],
  chargeIds?: string[],
): FlipMatchupRow[] {
  const species = SPECIES_BY_ID.get(parseRef(speciesId).id)!;
  const { entry } = getEntry(speciesId, iv, leagueId);
  const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const you = mkBattleMon(entry, myFast, selectedCharges(species, chargeIds));

  return opponentIds.map((oid) => {
    const opp = opponentInfo(oid, leagueId);
    const foe = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2));
    const cells = [0, 1, 2].map((sh) => {
      const r = battle(you, foe, sh, sh);
      return { win: r.win, margin: r.margin };
    });
    return {
      species: opp,
      cells,
      cmpWin: entry.atk >= foe.atk,
      flips: cells.filter((c) => c.win).length,
    };
  });
}

// ── Head-to-head battle simulator: full 3x3 shield-count matrix ──
export function shieldMatrix(a: BattleMon, b: BattleMon, energyA = 0, energyB = 0): BattleResult[][] {
  return [0, 1, 2].map((sA) => [0, 1, 2].map((sB) => battle(a, b, sA, sB, energyA, energyB)));
}
