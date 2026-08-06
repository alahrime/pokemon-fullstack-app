import { ENERGY_CAP, ENERGY_KEPT } from './engine';
import type { BattleMon, BattleResult, ChargeMove } from './types';

/**
 * The scenarios every cross-species comparison is built from, and the scoring
 * that turns a battle into a comparable number.
 *
 * Shared between scripts/build-matrix.ts and the runtime deliberately. The
 * build emits scores that the UI later labels and sorts; if the two disagreed
 * about what "Closers" means, nothing would flag it — the numbers would simply
 * be describing a different question than the heading claims.
 */

/**
 * PvPoke's own rating mechanics, adopted wholesale.
 *
 * Read from their Ranker.js rather than guessed at. Our previous basis and
 * theirs agree on the starting point — health kept plus damage dealt, each
 * worth 500 — and then diverge in three ways that turned out to matter far more
 * than any weight we had been tuning:
 *
 *   1. a win is paid for SHIELD PRESSURE — 100 per opponent shield forced and
 *      100 per shield of your own still held. Nothing in our rating rewarded
 *      making an opponent spend shields, which is most of what the spam and
 *      bait archetype does for a team.
 *   2. wins above 700 are SOFT-CAPPED at 700 + sqrt(excess), so a blowout is
 *      worth almost nothing over a solid win. This is the direct answer to
 *      polarising walls out-scoring even traders: we were paying full price for
 *      crushing wins that a real set converts no better than a comfortable one.
 *   3. bad losses are CURVED DOWN below 300, so failing to trade at all costs
 *      more than losing gracefully.
 *
 * Deliberately NOT adopted: their editor override, which replaces 75% of a
 * published score with a hand-set value. That is curation, and reproducing it
 * would mean copying a judgement rather than computing one.
 */
export const SOFT_CAP = 700;
export const LOSS_CURVE = 300;
/** Rating credit per shield forced, and per shield kept, on a win. */
export const SHIELD_BONUS = 100;

/**
 * What a surviving opponent's banked energy costs you.
 *
 * The missing half of shield pressure. A matchup does not end when it ends: an
 * opponent left standing with a full bar walks into your next Pokemon already
 * holding a charged move, and clearing that costs the next mon HP, a shield, or
 * both. Nothing in the rating priced it, so a loss that left the opponent empty
 * and a loss that handed them 80 energy scored identically.
 *
 * Registeel into Shadow Ninetales is the case that exposed it. Lock On does one
 * damage, so Ninetales farms it freely, shields the one nuke that matters,
 * out-paces to three moves against Registeel's two, and leaves with enough
 * residual energy that the next Pokemon has to spend a shield or take a hit to
 * clear it. On the old rating Registeel lost that matchup no more expensively
 * than it lost a close one.
 *
 * Priced at a full shield for a full bar: both are a resource the loser hands
 * to the winner and the next Pokemon has to answer.
 */
export const ENERGY_DEBT = 100;

/**
 * A battle rating on PvPoke's 0–1000 scale.
 *
 * `startShieldsA/B` are what each side began the scenario with; the shield
 * bonus needs the difference against what is left, and BattleResult only
 * carries the remainder.
 */
export function rating(r: BattleResult, _startShieldsA = 0, startShieldsB = 0): number {
  const healthRating = r.mine;
  const damageRating = 1 - r.theirs;
  let v = Math.floor((healthRating + damageRating) * 500);

  // Shield pressure, paid only on a win — an opponent who spent shields losing
  // to you is an opponent who has none left for your next Pokemon.
  if (r.win) {
    v += SHIELD_BONUS * Math.max(0, startShieldsB - r.shieldsB);
    v += SHIELD_BONUS * Math.max(0, r.shieldsA);
    // Energy you walk out with, on the same footing as a kept shield. This is
    // the credit that makes the engine's farm-down rule rational: holding a
    // bar through a kill costs a little health, and without something on the
    // other side of that trade the correct play would score worse than the
    // careless one. See ENERGY_KEPT and canFarmDown in engine.ts.
    v += ENERGY_KEPT * Math.min(1, r.energyA / ENERGY_CAP);
  }

  // The reverse, and it applies whenever they are left standing: energy they
  // banked is a charged move your next Pokemon walks into. See ENERGY_DEBT.
  if (r.hpB > 0) v -= ENERGY_DEBT * Math.min(1, r.energyB / ENERGY_CAP);

  // A crushing win is barely better than a clean one; a limp loss is much
  // worse than a close one. Both curves compress what we used to pay in full.
  if (v > SOFT_CAP) v = SOFT_CAP + Math.sqrt(v - SOFT_CAP);
  else if (v < LOSS_CURVE) v = Math.pow(LOSS_CURVE, (LOSS_CURVE + v) / (2 * LOSS_CURVE));

  return Math.round(v);
}

/** Energy a mon needs banked to be holding its cheapest charged move. */
export function bankedEnergy(charges: readonly ChargeMove[]): number {
  if (charges.length === 0) return 0;
  return Math.min(...charges.map((c) => c.energy));
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** Shields each side starts with. */
  shieldsA: number;
  shieldsB: number;
  /**
   * Starting energy, as a multiple of that side's cheapest charged move.
   * Expressed relatively because a flat 50 energy means "one move banked" to
   * a Bubble user and "not yet half way" to something running a 70-cost nuke,
   * which would make the same scenario a different question per species.
   */
  bankedA: number;
  bankedB: number;
}

export type ShieldState = 'sh00' | 'sh01' | 'sh02' | 'sh10' | 'sh11' | 'sh12' | 'sh20' | 'sh21' | 'sh22';

export type ScenarioId = ShieldState | 'switch' | 'charger';

/**
 * The full shield lattice, plus the two energy states.
 *
 * Shields in GBL belong to the player for the whole battle — two of them,
 * spent across three matchups — not to each Pokemon. So a mon does not face
 * "the 1-shield scenario"; it faces whatever is left when its turn comes, and
 * over a set that is genuinely every one of the nine combinations. A lead
 * meets 2v2. Something arriving after both players burned one meets 1v1. A
 * closer that got there while the opponent still holds both meets 0v2.
 *
 * Simulating all nine costs more than picking three representative ones, and
 * it buys the thing worth having: a mon that holds up wherever the shield
 * budget landed is reliable in a sense that a single scenario cannot show.
 * That is what Consistency below actually measures.
 */
export const SCENARIOS: readonly Scenario[] = [
  { id: 'sh00', label: '0v0 shields', shieldsA: 0, shieldsB: 0, bankedA: 0, bankedB: 0 },
  { id: 'sh01', label: '0v1 shields', shieldsA: 0, shieldsB: 1, bankedA: 0, bankedB: 0 },
  { id: 'sh02', label: '0v2 shields', shieldsA: 0, shieldsB: 2, bankedA: 0, bankedB: 0 },
  { id: 'sh10', label: '1v0 shields', shieldsA: 1, shieldsB: 0, bankedA: 0, bankedB: 0 },
  { id: 'sh11', label: '1v1 shields', shieldsA: 1, shieldsB: 1, bankedA: 0, bankedB: 0 },
  { id: 'sh12', label: '1v2 shields', shieldsA: 1, shieldsB: 2, bankedA: 0, bankedB: 0 },
  { id: 'sh20', label: '2v0 shields', shieldsA: 2, shieldsB: 0, bankedA: 0, bankedB: 0 },
  { id: 'sh21', label: '2v1 shields', shieldsA: 2, shieldsB: 1, bankedA: 0, bankedB: 0 },
  { id: 'sh22', label: '2v2 shields', shieldsA: 2, shieldsB: 2, bankedA: 0, bankedB: 0 },
  // Coming in off a bad lead: they have been farming you, so they arrive
  // holding a move. This is the state a switch actually walks into.
  { id: 'switch', label: 'into a banked opponent', shieldsA: 1, shieldsB: 1, bankedA: 0, bankedB: 1 },
  { id: 'charger', label: 'holding a move', shieldsA: 1, shieldsB: 1, bankedA: 1, bankedB: 0 },
] as const;

/** The nine shield states, in the order a 3x3 grid reads. */
export const SHIELD_STATES: readonly ShieldState[] = [
  'sh00', 'sh01', 'sh02', 'sh10', 'sh11', 'sh12', 'sh20', 'sh21', 'sh22',
];

export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);

export type CategoryId =
  | 'overall'
  | 'leads'
  | 'closers'
  | 'switches'
  | 'chargers'
  | 'attackers'
  | 'pressure'
  | 'consistency';

export interface Category {
  id: CategoryId;
  label: string;
  blurb: string;
  /** Scenario weights. Empty for categories computed some other way. */
  weights: Partial<Record<ScenarioId, number>>;
}

/**
 * The seven stratifications, each expressed as a weighting over the scenarios.
 *
 * The blurbs are the definitions the categories were built to satisfy, kept
 * next to the weights so a later reader can check that the arithmetic still
 * matches the claim.
 */
export const CATEGORIES: readonly Category[] = [
  {
    id: 'overall',
    label: 'Overall',
    blurb:
      'The best Pokémon overall across multiple roles. They have the typing, moves, and stats to succeed as top contenders.',
    // Weighted by how often each state actually occurs across a set. Even
    // budgets (2v2, 1v1, 0v0) dominate because both players spend shields at a
    // similar rate; lopsided ones happen but are the exception.
    weights: { sh22: 0.2, sh11: 0.2, sh00: 0.15, sh21: 0.08, sh12: 0.08, sh10: 0.06, sh01: 0.06, switch: 0.09, charger: 0.08 },
  },
  {
    id: 'leads',
    label: 'Leads',
    blurb:
      "The best Pokémon with shields in play. Capable of applying pressure or winning extended fights, they're ideal leads in battle.",
    // A lead meets a full shield budget on both sides; 1v1 is the same fight
    // one exchange later.
    weights: { sh22: 0.6, sh11: 0.4 },
  },
  {
    id: 'closers',
    label: 'Closers',
    blurb:
      'The best Pokémon with no shields in play. Bulk or hard-hitting moves allow them to close out matchups.',
    weights: { sh00: 1 },
  },
  {
    id: 'switches',
    label: 'Switches',
    blurb:
      'The best Pokémon to switch to from an unfavorable lead. These Pokémon have safe matchups and can pressure shields or deal heavy damage even in their losses, especially with a starting energy advantage into the counter swap match up.',
    weights: { switch: 1 },
  },
  {
    id: 'chargers',
    label: 'Chargers',
    blurb:
      "The best Pokémon with an energy advantage. Fast energy gain or powerful moves make them dangerous after building up energy. This category also factors in a Pokémon's ability to farm down weakened opponents or overfarm in advantageous matchups.",
    weights: { charger: 1 },
  },
  {
    id: 'attackers',
    label: 'Attackers',
    blurb:
      'The best Pokémon against shielded opponents, while unshielded. Their natural bulk, resistances, and strong attacks allow them to power through a disadvantage.',
    // Was { sh01: 0.4, sh02: 0.6 }, which put 60% of a whole role category on
    // the rarest state on the board. sh02 means holding zero shields against
    // two — you have to have burned both while the opponent burned none, which
    // is not how most games go. It then fed a geometric mean, where one weak
    // term drags the composite hard, so the rarest scenario had outsized say
    // over the ranking.
    //
    // The role still means "behind on shields", because that is what separates
    // it from Leads and Closers. It is just weighted toward the deficit that
    // actually happens: down one is common, down two is not, and sh12 is the
    // same one-shield deficit from the other side of the board.
    weights: { sh01: 0.45, sh12: 0.35, sh02: 0.2 },
  },
  {
    id: 'pressure',
    label: 'Pressure',
    blurb:
      'How reliably this Pokémon can threaten at all, independent of whether it wins: energy generated per turn, how quickly that becomes a charged move, and how much of the field its coverage is not resisted by. A Pokémon that always has a move ready is never a free switch-in.',
    // Not a weighting — see pressureScore in lib/pressure.ts.
    weights: {},
  },
  {
    id: 'consistency',
    label: 'Consistency',
    blurb:
      'These Pokémon perform the most dependably. They provide consistent damage and rely less on baiting shields than other Pokémon. Shorter Fast Moves also help improve consistency.',
    // Not a weighting — see consistencyScore. Left empty so a reader does not
    // mistake this for a blend of the others.
    weights: {},
  },
] as const;

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * What each slot of PvPoke's published `scores` array means.
 *
 * The ranking files carry six numbers per species with no key, so this was
 * recovered by correlating each column against our own categories over the 773
 * Great League species that appear in both. Four land unambiguously — leads
 * 0.835 on col0, closers 0.891 on col1, chargers on col3, attackers 0.858 on
 * col4 — and the remaining two follow by elimination in the same order.
 *
 * One caveat worth keeping visible: col5 correlates with *nothing* we compute
 * (−0.13 to 0.00 across all seven categories), so while its position says
 * consistency, our consistency and theirs are demonstrably not measuring the
 * same thing. Treat that column's side-by-side delta as uninformative until
 * one of the two definitions is pinned down.
 */
export const PVPOKE_SCORE_COLUMNS: readonly CategoryId[] = [
  'leads',
  'closers',
  'switches',
  'chargers',
  'attackers',
  'consistency',
] as const;

/**
 * How little a mon's results depend on things it cannot control.
 *
 * Three sources of dependence, all read off scenarios already simulated:
 *
 *  - shield swing: how far its rating moves between shields up and shields
 *    down. A mon that wins the same matchups either way is dependable; one
 *    that needs the shields gone is a gamble on the opponent's choices.
 *  - bait dependence: the gap between the shielded scenarios and the
 *    attacker scenarios is where baiting lives. Needing your opponent to
 *    guess wrong is the least repeatable way to win a game.
 *  - fast move length: a 4-turn move commits you for 2 seconds and coarsens
 *    every decision after it. Shorter moves land damage on schedule.
 *
 * Returned on the same 0–1000 scale as the others so the categories sort
 * against each other without a second axis.
 */
export function consistencyScore(
  perScenario: Record<ScenarioId, number>,
  // Retained so the call in makeOverall keeps its shape; the fast-move length
  // is no longer priced here, for the reason given below.
  _fastTurns?: number,
): number {
  // Spread across the whole nine-state lattice, which is the honest measure of
  // "does this care how the shields fell". Standard deviation rather than
  // min-to-max: one freak state should not define a mon that is steady across
  // the other eight.
  const vals = SHIELD_STATES.map((s) => perScenario[s]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);

  // Spread alone, deliberately. Two penalties used to sit here and both were
  // charging for something already counted:
  //
  //   baitSwing = |sh11 - sh01|, called "bait dependence". It is not — sh11
  //     against sh01 is a shield DEFICIT, not a bait, and baiting is move
  //     selection. Worse, both of those states are already inside the standard
  //     deviation above, so it billed the same variance twice.
  //
  //   turnPenalty = (fastTurns - 1) * 20. The cost of a slow fast move is
  //     already fully simulated — fewer decision points, longer lock-in, worse
  //     charged-move alignment, more free turns conceded, and damage forfeited
  //     entirely if the user is knocked out before the final turn registers.
  //     All of that lands in `mean`. Subtracting a flat 20 per turn on top gave
  //     every 1-turn move a structural head start no battle had earned.
  //
  // Being uniformly mediocre is still not consistency, so the mean anchors the
  // score to whether it actually wins and the spread is what it gives back.
  return Math.max(0, Math.round(mean - 1.5 * sd));
}

/**
 * PvPoke's composite Overall: a weighted geometric mean of a Pokemon's own
 * category scores, best-first — over scores NORMALISED per category first.
 *
 * The normalisation is not cosmetic and leaving it out was a real bug. Their
 * Ranker.js scales every category to 0–100 against that category's own best
 * before RankerOverall composes them:
 *
 *     rankings[i].score = Math.floor((rankings[i].score / highest) * 1000) / 10;
 *
 * Composing raw battle ratings instead compresses everything, because a rating
 * has a high floor — damage dealt alone earns ~400 — so a Pokemon that is
 * mediocre everywhere reads as uniformly decent. Worse, the sort happens per
 * Pokemon *before* the 12/6/4/2 weights are applied, so normalising changes
 * which category counts as that Pokemon's best role and therefore what the 12x
 * exponent lands on. Skipping it put five unevolved forms in Great's top 24 and
 * undid the very thing the graded pass exists to prevent.
 *
 * Returns a factory rather than a plain function because the maxima are a
 * property of the pool, not of one Pokemon: nothing can be scored until every
 * candidate has been scored.
 */
export function makeOverall(
  perScenario: readonly Record<ScenarioId, number>[],
  fastTurns: readonly number[],
  /** Pressure per variant, 0–1000. See lib/pressure.ts and BACKLOG §1o. */
  pressures: readonly number[],
): (i: number) => number {
  const roleCats = CATEGORIES.filter((c) => c.id !== 'overall');
  const raw = perScenario.map((per, i) =>
    roleCats.map((c) =>
      c.id === 'consistency'
        ? consistencyScore(per, fastTurns[i])
        : c.id === 'pressure'
          ? (pressures[i] ?? 0)
          : weightedScore(per, c.weights),
    ),
  );
  const max = roleCats.map((_, ci) => Math.max(1, ...raw.map((r) => r[ci])));

  return (i: number) => {
    // 0–100 per category, floored at 1 so a zero cannot annihilate the product.
    const norm = raw[i].map((v, ci) => Math.max(1, (v / max[ci]) * 100));
    // Pressure and consistency are both axes rather than roles, so neither
    // competes for the 12/6/4/2 slots — they carry their own exponents. See
    // BACKLOG §1o for why pressure is composed here rather than added to the
    // rating: the simulator already plays energy and resistance out inside a
    // matchup, and pricing them again there would charge twice for one thing.
    const byId = Object.fromEntries(roleCats.map((c, ci) => [c.id, norm[ci]]));
    const pressure = byId.pressure ?? 1;
    const consistency = byId.consistency ?? 1;
    const roles = roleCats
      .filter((c) => c.id !== 'consistency' && c.id !== 'pressure')
      .map((c) => byId[c.id])
      .sort((a, b) => b - a);
    const [s0, s1, s2, s3] = roles;
    const composite = Math.pow(
      Math.pow(s0, 12) * Math.pow(s1, 6) * Math.pow(s2, 4) * Math.pow(s3, 2) *
        Math.pow(consistency, 2) * Math.pow(pressure, 3),
      1 / 29,
    );
    // x10 so Overall shares the 0–1000 axis the category scores are shown on.
    // Ordering is what the composite decides; the scale is presentation.
    return Math.round(composite * 10);
  };
}

/** Blend a scenario record by a category's weights. */
export function weightedScore(
  perScenario: Record<ScenarioId, number>,
  weights: Partial<Record<ScenarioId, number>>,
): number {
  let sum = 0;
  let total = 0;
  for (const [id, w] of Object.entries(weights) as [ScenarioId, number][]) {
    sum += perScenario[id] * w;
    total += w;
  }
  return total === 0 ? 0 : Math.round(sum / total);
}

/** Starting energy for a scenario, resolved against this mon's movepool. */
export function startingEnergy(mon: BattleMon, banked: number): number {
  return banked === 0 ? 0 : Math.min(100, bankedEnergy(mon.charges) * banked);
}
