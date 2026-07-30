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
 * A battle rating on PvPoke's 0–1000 scale, where 500 is an even fight.
 *
 * Half the score is damage dealt, half is HP kept. That matters for ranking:
 * winning with 1 HP left and winning untouched are both wins, but only the
 * second says the matchup is safe to rely on, and a team builder that cannot
 * tell them apart recommends coin flips. A plain win/loss bit throws away
 * exactly the information a ranking is for.
 */
export function rating(r: BattleResult): number {
  return Math.round(500 * (1 - r.theirs) + 500 * r.mine);
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

export type ScenarioId =
  | 'lead1'
  | 'lead2'
  | 'close'
  | 'switch'
  | 'charger'
  | 'attacker1'
  | 'attacker2';

/**
 * Seven scenarios, chosen so that each ranking category below is a blend of
 * ones actually simulated rather than an adjustment applied after the fact.
 */
export const SCENARIOS: readonly Scenario[] = [
  { id: 'lead1', label: '1 shield each', shieldsA: 1, shieldsB: 1, bankedA: 0, bankedB: 0 },
  { id: 'lead2', label: '2 shields each', shieldsA: 2, shieldsB: 2, bankedA: 0, bankedB: 0 },
  { id: 'close', label: 'no shields', shieldsA: 0, shieldsB: 0, bankedA: 0, bankedB: 0 },
  // Coming in off a bad lead: they have been farming you, so they arrive
  // holding a move. This is the scenario a switch actually faces.
  { id: 'switch', label: 'into a banked opponent', shieldsA: 1, shieldsB: 1, bankedA: 0, bankedB: 1 },
  { id: 'charger', label: 'holding a move', shieldsA: 1, shieldsB: 1, bankedA: 1, bankedB: 0 },
  { id: 'attacker1', label: 'unshielded vs 1 shield', shieldsA: 0, shieldsB: 1, bankedA: 0, bankedB: 0 },
  { id: 'attacker2', label: 'unshielded vs 2 shields', shieldsA: 0, shieldsB: 2, bankedA: 0, bankedB: 0 },
] as const;

export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);

export type CategoryId =
  | 'overall'
  | 'leads'
  | 'closers'
  | 'switches'
  | 'chargers'
  | 'attackers'
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
    // Every role counts, with the shielded scenarios weighted highest because
    // most turns of a real set are played with shields still up.
    weights: { lead1: 0.3, lead2: 0.15, close: 0.2, switch: 0.15, charger: 0.1, attacker1: 0.1 },
  },
  {
    id: 'leads',
    label: 'Leads',
    blurb:
      "The best Pokémon with shields in play. Capable of applying pressure or winning extended fights, they're ideal leads in battle.",
    weights: { lead1: 0.6, lead2: 0.4 },
  },
  {
    id: 'closers',
    label: 'Closers',
    blurb:
      'The best Pokémon with no shields in play. Bulk or hard-hitting moves allow them to close out matchups.',
    weights: { close: 1 },
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
    weights: { attacker1: 0.6, attacker2: 0.4 },
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
  fastTurns: number,
): number {
  const shieldSwing = Math.abs(perScenario.lead1 - perScenario.close);
  const baitSwing = Math.abs(perScenario.lead1 - perScenario.attacker1);
  const base = (perScenario.lead1 + perScenario.close + perScenario.attacker1) / 3;

  // Each swing is a penalty against the mon's own average result: being
  // uniformly mediocre is not consistency, so the base term keeps the score
  // anchored to whether it actually wins.
  const swingPenalty = 0.5 * shieldSwing + 0.5 * baitSwing;
  // 1 turn is free, 4 turns costs 60 points. Deliberately small next to the
  // swing terms — it is a tiebreaker among comparable mons, not a headline.
  const turnPenalty = (fastTurns - 1) * 20;

  return Math.max(0, Math.round(base - swingPenalty - turnPenalty));
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
