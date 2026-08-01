import { movesFor, speciesOf } from './data';
import { battle, bestSpreadFor, mkBattleMon } from './engine';
import { fieldPool, overallOf } from './rankings';
import {
  CATEGORIES,
  SCENARIOS,
  rating,
  startingEnergy,
  weightedScore,
  type ScenarioId,
} from './scenarios';
import { pairReport, relevanceWeights, typePressure, type PairReport } from './synergy';
import type { LeagueId } from './types';

/**
 * On-demand core scoring for a pair the shipped list does not contain.
 *
 * The offline build ranks tens of thousands of legal pairs and ships the best
 * few hundred, so a perfectly good pairing is often absent — the cut is at
 * roughly the 99.5th percentile. This recomputes one pair live against the same
 * field, with the same metric, so a looked-up number is directly comparable to
 * a listed one.
 *
 * Cost is two species against the field across eleven scenarios: ~11k battles.
 * The first call also builds the reference distribution — 60 more species — so
 * it runs a second or two; every call after is near-instant. Rows are cached
 * because people compare one candidate against several.
 */

/**
 * Opponents coverage is measured against.
 *
 * The top 500, matching CORE_TIER in scripts/build-teams.ts — not the
 * hundred-strong builder pool. Measuring a core against only the top 100 asks
 * whether it covers the head of the format, when what makes a core is usually
 * covering the ladder. The two must agree or a looked-up score would not be
 * comparable to a listed one.
 */
const CORE_TIER = '500';
const CORE_FIELD_N = 500;
function fieldFor(lg: LeagueId): string[] {
  return fieldPool(lg, CORE_TIER, CORE_FIELD_N);
}

const rowCache = new Map<string, Float64Array>();

function rowFor(ref: string, lg: LeagueId): Float64Array {
  const key = `${ref}|${lg}`;
  const hit = rowCache.get(key);
  if (hit) return hit;

  const sp = speciesOf(ref)!;
  const { fast, charges } = movesFor(sp, lg);
  const me = mkBattleMon(bestSpreadFor(ref, lg, true), fast, charges, sp.types);
  const field = fieldFor(lg);
  const out = new Float64Array(field.length);
  const per = {} as Record<ScenarioId, number>;
  const overall = CATEGORIES.find((c) => c.id === 'overall')!;

  for (let f = 0; f < field.length; f++) {
    // Never scored against itself; a mirror is a draw or a CMP win and
    // "covering" your own species means nothing.
    if (field[f] === ref) { out[f] = 500; continue; }
    const osp = speciesOf(field[f])!;
    const om = movesFor(osp, lg);
    const them = mkBattleMon(bestSpreadFor(field[f], lg, true), om.fast, om.charges, osp.types);
    for (const sc of SCENARIOS) {
      const r = battle(
        me, them, sc.shieldsA, sc.shieldsB,
        startingEnergy(me, sc.bankedA), startingEnergy(them, sc.bankedB),
        // Optimal timing and the reading shield policy, matching the build.
        false, true, undefined, undefined, 'read', 'read',
      );
      per[sc.id] = rating(r);
    }
    out[f] = weightedScore(per, overall.weights);
  }
  rowCache.set(key, out);
  return out;
}

export interface PairLookup extends PairReport {
  a: string;
  b: string;
  /** Where this lands against a sample of the pool's own pairs. */
  percentile: number;
  fieldSize: number;
}

/**
 * A reference distribution, so a raw score can be placed rather than guessed at.
 *
 * "Mutual rescue 147" means nothing on its own. Sampled rather than exhaustive
 * because C(100,2) rows would be 4,950 solo sweeps; a deterministic sample of
 * the pool is enough to place a score to within a percentile or two.
 */
const distCache = new Map<LeagueId, number[]>();

function distribution(lg: LeagueId): number[] {
  const hit = distCache.get(lg);
  if (hit) return hit;
  const pool = fieldFor(lg).slice(0, 60);
  const scores: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = speciesOf(pool[i]);
      const b = speciesOf(pool[j]);
      if (!a || !b || a.dex === b.dex) continue;
      scores.push(pairReport(
        pool[i], pool[j], rowFor(pool[i], lg), rowFor(pool[j], lg), fieldFor(lg), weightsFor(lg),
        strengthFor(lg).get(pool[i]) ?? 0, strengthFor(lg).get(pool[j]) ?? 0, pressureFor(lg),
      ).score);
    }
  }
  scores.sort((x, y) => x - y);
  distCache.set(lg, scores);
  return scores;
}

/**
 * Normalised individual strength across the field, matching the core build.
 *
 * Min-maxed over the same 500 so a looked-up pair's score sits on the same
 * scale as a listed one.
 */
const strengthCache = new Map<LeagueId, Map<string, number>>();
function strengthFor(lg: LeagueId): Map<string, number> {
  const hit = strengthCache.get(lg);
  if (hit) return hit;
  const field = fieldFor(lg);
  const vals = field.map((r) => overallOf(lg, CORE_TIER, r));
  const lo = Math.min(...vals);
  const span = (Math.max(...vals) - lo) || 1;
  const m = new Map(field.map((r, i) => [r, (vals[i] - lo) / span]));
  strengthCache.set(lg, m);
  return m;
}

/** Type pressure over the field, matching the offline core build. */
const pressureCache = new Map<LeagueId, Map<string, number>>();
function pressureFor(lg: LeagueId): Map<string, number> {
  const hit = pressureCache.get(lg);
  if (hit) return hit;
  const field = fieldFor(lg);
  const p = typePressure(
    field.map((r) => {
      const sp = speciesOf(r);
      if (!sp) return [] as string[];
      const rec = movesFor(sp, lg);
      return [...new Set([rec.fast.type, ...rec.charges.map((c) => c.type)])];
    }),
    relevanceWeights(field.map((r) => overallOf(lg, CORE_TIER, r)), 2),
  );
  pressureCache.set(lg, p);
  return p;
}

/** Relevance weights over the field, matching the offline core build. */
const weightCache = new Map<LeagueId, Float64Array>();
function weightsFor(lg: LeagueId): Float64Array {
  const hit = weightCache.get(lg);
  if (hit) return hit;
  const w = relevanceWeights(fieldFor(lg).map((r) => overallOf(lg, CORE_TIER, r)));
  weightCache.set(lg, w);
  return w;
}

export function lookupPair(a: string, b: string, lg: LeagueId): PairLookup {
  const field = fieldFor(lg);
  const str = strengthFor(lg);
  // A Pokemon outside the field still has a strength: clamp to the floor rather
  // than 1, or an unranked pick would score as if it were the best in the game.
  const rep = pairReport(
    a, b, rowFor(a, lg), rowFor(b, lg), field, weightsFor(lg),
    str.get(a) ?? 0, str.get(b) ?? 0, pressureFor(lg),
  );
  const dist = distribution(lg);
  const below = dist.filter((v) => v < rep.score).length;
  return {
    ...rep,
    a,
    b,
    percentile: dist.length ? Math.round((below / dist.length) * 100) : 0,
    fieldSize: field.length,
  };
}
