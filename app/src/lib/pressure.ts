import { dmg } from './engine';
import type { ChargeMove, FastMove, Species } from './types';

/**
 * Pressure: how reliably a Pokemon can threaten, independent of whether it wins.
 *
 * Raised from play — people bring Fearow and Empoleon because they are "not
 * walled in energy or charge attack pressure". Measured against the top 100 in
 * Great, that is exactly what separates them:
 *
 *   Lickilicky  4.33 energy/turn   35-energy charge   99% of the field does not resist it
 *   Empoleon    4.00              40                  99%
 *   Fearow      4.00              40                  98%
 *   Skarmory    3.00              50                  69%
 *
 * Those three are the species PvPoke rates furthest above us, and Skarmory —
 * which we rank 923rd — profiles worst. Nothing in the pipeline measured any of
 * it: `consistency` measures variance across shield states, and the five role
 * categories are all blends of scenario ratings.
 *
 * WHY THIS IS NOT DOUBLE-COUNTING
 *
 * The simulator already plays energy and resistance out inside a matchup, so
 * pricing them again as a rating bonus would be charging twice for one thing —
 * the mistake §1l records. This is deliberately a *separate axis*, composed
 * alongside the role scores rather than added to them, and it describes
 * something one matchup cannot: availability. A mon that always has a move
 * ready and always threatens damage is never a free switch-in, never lets an
 * opponent farm it down safely, and forces shields across a whole match. A
 * per-matchup average sees only the win or the loss that resulted and averages
 * the availability away.
 *
 * A plain rating floor does NOT capture this and was tried first: Fearow's
 * floor is poor — 21.3% of its top-100 matchups score under 300, against
 * Lickilicky's 5.0%. The mechanism is pressure availability, not the absence of
 * bad matchups.
 */

/** Energy per turn, which is the rate a threat becomes available at. */
export function energyRate(fast: FastMove): number {
  return fast.turns > 0 ? fast.energyGain / fast.turns : 0;
}

/**
 * Turns to reach the cheapest charged move from empty — the rate above
 * converted into the thing that actually matters, how often you are holding
 * something.
 */
export function turnsToThreat(fast: FastMove, charges: readonly ChargeMove[]): number {
  const rate = energyRate(fast);
  if (rate <= 0 || charges.length === 0) return Infinity;
  return Math.min(...charges.map((c) => c.energy)) / rate;
}

/**
 * Share of a field whose typing does not resist the best charged move
 * available against it.
 *
 * Effectiveness only — the stat line is held fixed at 100/100 so the type term
 * is the only thing that varies, which is what "resisted" means here.
 */
export function coverageBreadth(
  charges: readonly ChargeMove[],
  field: readonly Species[],
  selfId: string,
): number {
  if (charges.length === 0 || field.length === 0) return 0;
  let clear = 0;
  let n = 0;
  for (const foe of field) {
    if (foe.id === selfId) continue;
    n++;
    // Neutral damage for this move's power, to normalise the type term out.
    const best = Math.max(
      ...charges.map((c) => {
        const withType = dmg(100, 100, c, foe.types);
        const neutral = dmg(100, 100, { ...c, type: '__none__' } as ChargeMove, []);
        return neutral > 0 ? withType / neutral : 1;
      }),
    );
    if (best >= 1) clear++;
  }
  return n ? clear / n : 0;
}

/**
 * The three parts, combined onto the same 0–1000 scale the role categories use.
 *
 * Weights are deliberately gentle and the components are bounded before they
 * are blended, so no single term can run away with the score. Coverage carries
 * the most because it is the part a matchup average genuinely cannot express —
 * being resisted by a third of the field is a structural fact about a movepool,
 * whereas a slow fast move at least shows up as lost tempo in the results.
 */
export const PRESSURE_WEIGHTS = { coverage: 0.5, rate: 0.3, speed: 0.2 } as const;

/** Energy per turn seen in practice tops out near 5 (Lock On); 2 is poor. */
const RATE_LO = 2;
const RATE_HI = 5;
/** Turns to the cheapest charge: 8 is fast, 22 is slow. */
const SPEED_FAST = 8;
const SPEED_SLOW = 22;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function pressureScore(
  fast: FastMove,
  charges: readonly ChargeMove[],
  field: readonly Species[],
  selfId: string,
): number {
  const cov = coverageBreadth(charges, field, selfId);
  const rate = clamp01((energyRate(fast) - RATE_LO) / (RATE_HI - RATE_LO));
  const t = turnsToThreat(fast, charges);
  const speed = Number.isFinite(t) ? clamp01((SPEED_SLOW - t) / (SPEED_SLOW - SPEED_FAST)) : 0;
  const blend =
    PRESSURE_WEIGHTS.coverage * cov + PRESSURE_WEIGHTS.rate * rate + PRESSURE_WEIGHTS.speed * speed;
  return Math.round(clamp01(blend) * 1000);
}

/**
 * Opponent weight from pressure, for the graded pass.
 *
 * Beating something that cannot threaten you is worth less than beating
 * something that can, which is the other half of the same observation. The
 * floor is deliberately high at 0.55: this multiplies an opponent weight that
 * is already graded by strength, and stacking two aggressive curves on one axis
 * is exactly what made the log-rank experiment regress every league (§1l).
 * Halving the weakest opponents is a nudge; erasing them is a second cutoff.
 */
export const PRESSURE_FLOOR = 0.55;

export function pressureWeight(score: number): number {
  return PRESSURE_FLOOR + (1 - PRESSURE_FLOOR) * clamp01(score / 1000);
}
