import { typeEffectiveness } from './typeChart';
import { speciesOf } from './data';

/**
 * Team synergy: whether a team holds together, as against how hard it hits.
 *
 * The chain simulation already answers "does this team win fights". It cannot
 * answer the question people actually build around — does this team *cover
 * itself*. A trio of three excellent Pokemon that all fold to Ground is not a
 * team, and a chain average hides that: the losses are spread across three
 * different opponents' columns and never show up as one hole.
 *
 * Everything here is computed from ratings the engine already produces, plus
 * the type chart. Nothing is hand-assigned — there is no table of "good cores"
 * anywhere in this file. Cores fall out of the numbers.
 *
 * Shared between scripts/build-teams.ts and the live builders on purpose, for
 * the same reason scenarios.ts is: if the offline pass and the screen disagreed
 * about what coverage means, nothing would flag it.
 */

/** The rating at which a matchup is won. See scenarios.ts. */
export const WIN_LINE = 500;

/**
 * A rating comfortably clear of the win line.
 *
 * Coverage asks whether a teammate *answers* an opponent, and an answer that
 * wins by a hair is not one you would swap into. 560 is roughly "wins with
 * something left", which is the bar for calling a matchup covered.
 */
export const ANSWER_LINE = 560;

/**
 * Component weights for the composite.
 *
 * Coverage leads because a hole is the failure that ends games — there is no
 * play against an opponent no member beats. Worst-case swap is next: it is the
 * risk the whole idea of a back line exists to manage. Redundancy is the
 * "two answers, not one" term. Type complement is deliberately small: it is
 * derived from the chart rather than from play, so it is a prior, not evidence
 * — it earns its place by catching shared weaknesses the sampled field happened
 * not to punish. Bulk is smallest and is there because a stat-product edge is
 * real but marginal next to a matchup.
 */
/**
 * How sharply opponent relevance is graded, and where it is cut off entirely.
 *
 * Deliberately severe. Coverage of the meta is the question; coverage of the
 * bottom half of a 500-wide field is noise that outvotes it if counted at all.
 * At power 4 the 50th-percentile opponent carries ~6% of the weight of the
 * best, and everything under the floor carries none.
 */
export const META_POWER = 4;
export const META_FLOOR_PCT = 0.5;

export const SYNERGY_WEIGHTS = {
  coverage: 0.34,
  swapWorst: 0.2,
  redundancy: 0.16,
  typeCover: 0.12,
  swapMean: 0.1,
  bulk: 0.08,
} as const;

export type SynergyComponent = keyof typeof SYNERGY_WEIGHTS;

export interface Synergy {
  /** Weighted composite, 0–1000, on the same scale as a battle rating. */
  score: number;
  /** Mean over the field of the team's best answer. The floor-raising term. */
  coverage: number;
  /**
   * Share of the field with at least two answers, half credit for one.
   *
   * This is the "Tinkaton plus two waters" property: when the lead's one
   * weakness walks in, you want two ways to flip it, not one. One answer is a
   * plan; two is a plan that survives the opponent also having a read.
   */
  redundancy: number;
  /**
   * How well the back line answers the single worst opponent each member can
   * open into, arriving off a farm.
   *
   * You do not choose the lead matchup, and a non-zero share of games open
   * badly. This scores the recovery: for every member as lead, find what beats
   * it hardest, then ask what the other two do to that opponent in the switch
   * scenario — coming in against something holding energy.
   */
  swapWorst: number;
  /** The same, averaged over every opponent that beats the lead rather than
   *  only the worst. The gap between the two is how spiky the risk is. */
  swapMean: number;
  /** Share of members' type weaknesses that some teammate resists. */
  typeCover: number;
  /** Mean stat product across members, against the pool's best. */
  bulk: number;
  /** Opponents no member answers. The actionable output. */
  holes: string[];
}

/**
 * Ratings for one team member against the field.
 *
 * Indexed [member][opponent]. `neutral` is the even-shield read used for
 * coverage; `switch` is the same matchup entered off a farm, which is the only
 * honest way to price a swap.
 */
export interface SoloRatings {
  /** Opponent refs, the column order of every row below. */
  field: string[];
  neutral: Float64Array[];
  switching: Float64Array[];
}

const mean = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
};

/**
 * Every type this typing takes super-effective damage from.
 *
 * Read off the same chart the engine uses rather than a second table, so a
 * chart correction cannot leave this disagreeing with actual damage.
 */
const ALL_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy',
] as const;

/**
 * Memoised per typing.
 *
 * There are only a couple of hundred distinct typings in the game, but the six
 * enumeration asks for these hundreds of thousands of times — 18 chart lookups
 * a call was the largest single cost in the synergy pass. Caching on the joined
 * typing makes it a map hit.
 */
const weakCache = new Map<string, string[]>();
const resistCache = new Map<string, string[]>();
/** Same information as a bitmask over ALL_TYPES, for the hot coverage loop. */
const resistMaskCache = new Map<string, number>();
const weakMaskCache = new Map<string, number>();

export function weaknessesOf(types: readonly string[]): string[] {
  const k = types.join('/');
  let hit = weakCache.get(k);
  if (!hit) {
    hit = ALL_TYPES.filter((t) => typeEffectiveness(t, types) > 1);
    weakCache.set(k, hit);
  }
  return hit;
}

export function resistancesOf(types: readonly string[]): string[] {
  const k = types.join('/');
  let hit = resistCache.get(k);
  if (!hit) {
    hit = ALL_TYPES.filter((t) => typeEffectiveness(t, types) < 1);
    resistCache.set(k, hit);
  }
  return hit;
}

const maskOf = (types: readonly string[], cache: Map<string, number>, pick: (t: string) => boolean) => {
  const k = types.join('/');
  let hit = cache.get(k);
  if (hit === undefined) {
    hit = 0;
    ALL_TYPES.forEach((t, i) => { if (pick(t)) hit! |= 1 << i; });
    cache.set(k, hit);
  }
  return hit;
};

const weakMask = (types: readonly string[]) =>
  maskOf(types, weakMaskCache, (t) => typeEffectiveness(t, types) > 1);
const resistMask = (types: readonly string[]) =>
  maskOf(types, resistMaskCache, (t) => typeEffectiveness(t, types) < 1);

/**
 * How much of the field can actually attack with each type.
 *
 * A shared weakness only matters if something in the meta exploits it. Being
 * three-deep weak to Bug is a curiosity; three-deep weak to Ground is a lost
 * game, because Ground is everywhere. Measured from the field's real movesets
 * and weighted by each opponent's relevance, so a type carried only by
 * unplayed Pokemon exerts no pressure.
 */
export function typePressure(
  fieldMoveTypes: readonly (readonly string[])[],
  weights: Float64Array,
): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < fieldMoveTypes.length; i++) total += weights[i];
  for (const t of ALL_TYPES) {
    let carried = 0;
    for (let i = 0; i < fieldMoveTypes.length; i++)
      if (fieldMoveTypes[i].includes(t)) carried += weights[i];
    out.set(t, total === 0 ? 0 : carried / total);
  }
  return out;
}

/**
 * A type that too much of the team is weak to at once.
 *
 * Returned rather than folded into a score because this is a *constraint*, not
 * a preference. Three Pokemon that all fold to Ground are not a team with a
 * lower rating — they are a team with no answer, and one Mud Slap user ends the
 * set whatever the chain simulation says about their average. The simulated
 * passes had no protection against this at all: Great's d2 top three were every
 * one of them three-deep weak to Ground.
 *
 * Only counts types the field can actually punish, via `pressure`.
 */
export interface SharedWeakness {
  type: string;
  count: number;
  pressure: number;
}

export function worstSharedWeakness(
  teamTypes: readonly (readonly string[])[],
  pressure: Map<string, number>,
  minPressure: number,
): SharedWeakness | null {
  let worst: SharedWeakness | null = null;
  for (const t of ALL_TYPES) {
    const p = pressure.get(t) ?? 0;
    if (p < minPressure) continue;
    let count = 0;
    for (const types of teamTypes) if (typeEffectiveness(t, types) > 1) count++;
    if (!worst || count > worst.count) worst = { type: t, count, pressure: p };
  }
  return worst;
}

/**
 * Type complementarity: the share of the team's weaknesses that a teammate
 * resists.
 *
 * This is the Altaria/Empoleon shape stated numerically. Altaria is weak to
 * Ice, Empoleon resists it; Empoleon is weak to Ground, Altaria is immune. A
 * team where every member's soft spot is somebody else's resistance has an
 * answer to swap into whatever walks in, and one where all three share a
 * weakness has none.
 */
export function typeCoverage(teamTypes: readonly (readonly string[])[]): number {
  const weak = teamTypes.map(weakMask);
  const resist = teamTypes.map(resistMask);
  let covered = 0;
  let total = 0;
  for (let i = 0; i < teamTypes.length; i++) {
    // Everything a teammate resists, as one mask — so "does anyone cover this"
    // is a single bit test rather than a scan.
    let others = 0;
    for (let j = 0; j < teamTypes.length; j++) if (j !== i) others |= resist[j];
    const mine = weak[i];
    for (let b = 0; b < ALL_TYPES.length; b++) {
      if (!(mine & (1 << b))) continue;
      total++;
      if (others & (1 << b)) covered++;
    }
  }
  // A team with no weaknesses at all is perfectly covered, vacuously.
  return total === 0 ? 1 : covered / total;
}

/**
 * Score a team's synergy from per-member ratings against the field.
 *
 * `bulkNorm` is each member's stat product as a fraction of the pool's best,
 * supplied by the caller because the two callers price it from different
 * places — the build has the whole pool in hand, the screen does not.
 */
export function synergyOf(
  team: readonly string[],
  solo: SoloRatings,
  bulkNorm: readonly number[],
): Synergy {
  const n = team.length;
  const nF = solo.field.length;

  // ── Coverage and redundancy ───────────────────────────────────────────────
  let coverSum = 0;
  let redundSum = 0;
  const holes: string[] = [];
  for (let o = 0; o < nF; o++) {
    let best = -Infinity;
    let answers = 0;
    for (let i = 0; i < n; i++) {
      const v = solo.neutral[i][o];
      if (v > best) best = v;
      if (v >= ANSWER_LINE) answers++;
    }
    coverSum += best;
    // Two answers is the target; one is half credit; none is a hole.
    redundSum += answers >= 2 ? 1 : answers === 1 ? 0.5 : 0;
    if (best < WIN_LINE) holes.push(solo.field[o]);
  }

  // ── Swap safety ───────────────────────────────────────────────────────────
  // For each member as the lead, look at what beats it and ask what the rest of
  // the team does to that opponent arriving off a farm. Two readings: the
  // single worst opponent, and the average over everything that beats the lead.
  const worstPerLead: number[] = [];
  const meanPerLead: number[] = [];
  for (let lead = 0; lead < n; lead++) {
    let worstOpp = -1;
    let worstRating = Infinity;
    const answersToLosses: number[] = [];
    for (let o = 0; o < nF; o++) {
      const r = solo.neutral[lead][o];
      if (r >= WIN_LINE) continue; // the lead handles it; nothing to recover
      if (r < worstRating) { worstRating = r; worstOpp = o; }
      let bestSwap = 0;
      for (let i = 0; i < n; i++) {
        if (i === lead) continue;
        const s = solo.switching[i][o];
        if (s > bestSwap) bestSwap = s;
      }
      answersToLosses.push(bestSwap);
    }
    // A lead that loses to nothing needs no recovery; credit it fully rather
    // than leaving it undefined, which would otherwise punish the best leads.
    if (worstOpp === -1) {
      worstPerLead.push(1000);
      meanPerLead.push(1000);
      continue;
    }
    let bestSwapWorst = 0;
    for (let i = 0; i < n; i++) {
      if (i === lead) continue;
      const s = solo.switching[i][worstOpp];
      if (s > bestSwapWorst) bestSwapWorst = s;
    }
    worstPerLead.push(bestSwapWorst);
    meanPerLead.push(mean(answersToLosses));
  }

  const coverage = coverSum / nF;
  const redundancy = (redundSum / nF) * 1000;
  const swapWorst = mean(worstPerLead);
  const swapMean = mean(meanPerLead);
  const typeCover = typeCoverage(team.map((r) => speciesOf(r)?.types ?? [])) * 1000;
  const bulk = mean(bulkNorm) * 1000;

  const w = SYNERGY_WEIGHTS;
  const score =
    coverage * w.coverage +
    swapWorst * w.swapWorst +
    redundancy * w.redundancy +
    typeCover * w.typeCover +
    swapMean * w.swapMean +
    bulk * w.bulk;

  return {
    score: Math.round(score),
    coverage: Math.round(coverage),
    redundancy: Math.round(redundancy),
    swapWorst: Math.round(swapWorst),
    swapMean: Math.round(swapMean),
    typeCover: Math.round(typeCover),
    bulk: Math.round(bulk),
    holes,
  };
}

// ── Cores ───────────────────────────────────────────────────────────────────

export interface Core {
  a: string;
  b: string;
  /** Mutual rescue, geometric mean of the two directions. */
  score: number;
  /** How much B lifts A where A is failing, and the reverse. */
  aRescuedByB: number;
  bRescuedByA: number;
  /** Opponents B answers that A cannot, and the reverse — the evidence. */
  bCovers: string[];
  aCovers: string[];
  /** Types A is weak to that B resists, and the reverse. */
  bCoversTypes: string[];
  aCoversTypes: string[];
  /** Types BOTH are weak to — the pair's shared blind spot. */
  sharedWeak: string[];
  /** Times the pair appears together in a stratum's top teams. */
  appearances: number;
  /**
   * Appearances against what independence would predict.
   *
   * A pair of two individually strong Pokemon co-occurs often for reasons that
   * have nothing to do with synergy. Dividing by the product of their own rates
   * leaves the part that is actually about the pairing.
   */
  lift: number;
}

/**
 * How much B rescues A: B's strength precisely where A is failing.
 *
 * Only counts opponents A actually loses to, and only the part of B's rating
 * above the answer line — being mediocre into A's counters is not a rescue.
 *
 * An absolute measure of threat neutralised, not a share of A's problems. The
 * x10 keeps the result on a readable scale after dividing by a 500-wide field.
 */
export function rescue(aRow: Float64Array, bRow: Float64Array, weights?: Float64Array): number {
  let sum = 0;
  let total = 0;
  for (let o = 0; o < aRow.length; o++) {
    const w = weights ? weights[o] : 1;
    // The denominator is the WHOLE field, not just A's losses. Dividing by the
    // losses turns this into a ratio — "of the things that beat me, what share
    // does my partner handle" — and a ratio rewards having few problems rather
    // than solving many. Measured that way, Carbink took 8 of Great's top 10
    // cores: it loses to almost nothing, so any partner covering that handful
    // scored enormously while covering nothing in absolute terms.
    total += w;
    if (aRow[o] >= WIN_LINE) continue;
    if (bRow[o] > ANSWER_LINE) sum += (bRow[o] - ANSWER_LINE) * w;
  }
  return total === 0 ? 0 : (sum / total) * 10;
}

/**
 * Score any two Pokemon on demand, from the engine rather than the artefact.
 *
 * The shipped core list is the best few hundred of tens of thousands of legal
 * pairs, so a pairing worth asking about is frequently not in it — Altaria and
 * Empoleon sit around the 99th percentile and still missed a 40-row cut. Rather
 * than ship every pair, this recomputes one on demand. Two species against a
 * few hundred opponents across eleven scenarios is ~11k battles, which is about
 * a tenth of a second: slow for a render, fine for a button.
 *
 * Deliberately the same `rescue`/`coreStrength` the build uses, so a looked-up
 * pair and a listed one are directly comparable numbers.
 */
export interface PairReport {
  score: number;
  /** Types both members are weak to — the pair's own blind spot. */
  sharedWeak: string[];
  aRescuedByB: number;
  bRescuedByA: number;
  bCovers: string[];
  aCovers: string[];
  bCoversTypes: string[];
  aCoversTypes: string[];
}

export function pairReport(
  a: string,
  b: string,
  rowA: Float64Array,
  rowB: Float64Array,
  field: string[],
  weights?: Float64Array,
  strengthA = 1,
  strengthB = 1,
  /** Field type pressure, so a shared weakness can be priced. */
  pressure?: Map<string, number>,
): PairReport {
  const covers = (mine: Float64Array, theirs: Float64Array) => {
    const out: { ref: string; gain: number }[] = [];
    for (let o = 0; o < mine.length; o++) {
      if (mine[o] >= WIN_LINE || theirs[o] < ANSWER_LINE) continue;
      out.push({ ref: field[o], gain: theirs[o] - mine[o] });
    }
    out.sort((x, y) => y.gain - x.gain);
    // Scoring always spanned the whole field; only this evidence list was
    // short, which made the cores look as though they rested on a handful of
    // matchups. Widened so the breadth of the cover is visible.
    return out.slice(0, EVIDENCE_N).map((x) => x.ref);
  };
  const resistFor = (weakRef: string, resistRef: string) => {
    const w = weaknessesOf(speciesOf(weakRef)?.types ?? []);
    const r = new Set(resistancesOf(speciesOf(resistRef)?.types ?? []));
    return w.filter((x) => r.has(x));
  };
  const shared = pressure
    ? sharedExposure(speciesOf(a)?.types ?? [], speciesOf(b)?.types ?? [], pressure)
    : { types: [] as string[], exposure: 0 };
  return {
    score: Math.round(coreStrength(rowA, rowB, weights, strengthA, strengthB, shared.exposure)),
    sharedWeak: shared.types,
    aRescuedByB: Math.round(rescue(rowA, rowB, weights)),
    bRescuedByA: Math.round(rescue(rowB, rowA, weights)),
    bCovers: covers(rowA, rowB),
    aCovers: covers(rowB, rowA),
    bCoversTypes: resistFor(a, b),
    aCoversTypes: resistFor(b, a),
  };
}

/**
 * How much a pair is jointly exposed: types BOTH members are weak to.
 *
 * A core exists to cover holes, so a hole they share is worse than either
 * member having it alone — there is nothing on the pair that answers it, and
 * whatever exploits it beats both. Nothing in the score noticed this, and it
 * showed: Great's top core was Carbink + Gastrodon, both Grass-weak, at a lift
 * of zero. Diggersby + Carbink is the same shape.
 *
 * Weighted by type pressure, so sharing a weakness to something the field
 * actually brings costs more than sharing one nobody exploits.
 */
export function sharedExposure(
  aTypes: readonly string[],
  bTypes: readonly string[],
  pressure: Map<string, number>,
): { types: string[]; exposure: number } {
  const aw = new Set(weaknessesOf(aTypes));
  const types = weaknessesOf(bTypes).filter((t) => aw.has(t));
  return { types, exposure: types.reduce((n, t) => n + (pressure.get(t) ?? 0), 0) };
}

/**
 * What a shared weakness costs. At 4, a pair jointly weak to something a tenth
 * of the field carries loses ~29% of its score; two shared weaknesses, ~44%.
 * Steep enough to move such pairs off the top without banning them, because a
 * shared weakness is a real cost rather than a disqualification.
 */
export const SHARED_WEAK_COST = 4;

/**
 * Opponents listed as evidence per direction.
 *
 * Presentation only — `rescue` has always integrated over the entire field.
 * Six made a core look like it rested on five hard matchups when it rests on
 * five hundred.
 */
export const EVIDENCE_N = 16;

/**
 * Pair strength: two good Pokemon that cover each other.
 *
 * Both halves are load-bearing and the second was missing for three iterations.
 * Mutual rescue alone says only that two weakness profiles are complementary,
 * which two *bad* Pokemon manage easily — measured that way, Great's top cores
 * came out as Coalossal (rank 182) beside Whimsicott (324) and Quagsire (328),
 * none of which has ever appeared in a top team, while Altaria (22) beside
 * Empoleon (97) fell outside the top 300. Complementary holes are cheap; two
 * viable Pokemon whose holes happen to be complementary are not.
 *
 * Geometric means throughout, so every factor has a veto: one dead-weight
 * member, or one direction that does not rescue, and the pair scores near zero
 * however good the other half is. That is what separates a core from "a good
 * Pokemon plus anything".
 */
export function coreStrength(
  aRow: Float64Array,
  bRow: Float64Array,
  weights?: Float64Array,
  /** Each member's own normalised strength, 0–1. Omit to score rescue alone. */
  strengthA = 1,
  strengthB = 1,
  /** Weighted pressure of the types both are weak to. See sharedExposure. */
  sharedWeakExposure = 0,
): number {
  const mutual = Math.sqrt(rescue(aRow, bRow, weights) * rescue(bRow, aRow, weights));
  return (mutual * Math.sqrt(strengthA * strengthB)) / (1 + SHARED_WEAK_COST * sharedWeakExposure);
}

/**
 * Relevance weights over a field, from each opponent's own Overall.
 *
 * Cores need a *wide* field — the pairings worth finding are usually two
 * mid-ladder Pokemon covering things the top hundred does not contain — but a
 * wide field is mostly tail, and unweighted rescue then rewards covering the
 * tail over covering the meta. Measured flat over Great's top 500, the best
 * "cores" came out as Carbink beside four separate forms of Gourgeist, none of
 * which has ever appeared in a top team.
 *
 * Squaring rather than cubing: enough to make the tail negligible without
 * collapsing the field back onto the top twenty, which would undo the width the
 * wide field was chosen for.
 */
export function relevanceWeights(overall: readonly number[], power = META_POWER): Float64Array {
  const min = Math.min(...overall);
  const span = (Math.max(...overall) - min) || 1;
  const norm = overall.map((v) => (v - min) / span);
  // A hard floor as well as a steep curve. Below the cut an opponent is not
  // "worth less", it is not part of the question: beating something nobody
  // brings should contribute nothing at all rather than a little.
  const sorted = [...norm].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * META_FLOOR_PCT)] ?? 0;
  return Float64Array.from(norm, (v) => (v < floor ? 0 : v ** power));
}
