import rankingsRaw from '../data/rankings.json';
import matrixRaw from '../data/matrix.json';
import { CATEGORIES, PVPOKE_SCORE_COLUMNS, type CategoryId } from './scenarios';
import type { LeagueId } from './types';

/**
 * Reader for what scripts/build-matrix.ts emits.
 *
 * Scores travel as bare arrays in CATEGORIES order rather than keyed objects —
 * the seven category names repeated ten times per species were outweighing the
 * numbers two to one. Everything is zipped back to names here, once, so no
 * component has to know the wire format.
 */

/** [label, overall score at the default tier]. Index 0 is the rated set. */
export type RawLoadout = [string, number];

interface RawTier {
  /** Scores for the league's rated loadout — the comparable basis. */
  rec: number[];
  /** Scores for the strongest swept loadout, and which one that was. */
  best: number[];
  set: number;
}

interface RawEntry {
  ref: string;
  name: string;
  loadouts: RawLoadout[];
  tiers: Record<string, RawTier>;
  /** Second-derivative scores per tier, each in CATEGORIES order. */
  d2: Record<string, number[]>;
  pvpoke: { score: number; scores: number[] } | null;
}

interface RawLeague {
  engineRev: number;
  tiers: string[];
  defaultTier: string;
  categories: CategoryId[];
  entries: RawEntry[];
}

const RANKINGS = rankingsRaw as unknown as Record<LeagueId, RawLeague>;
const MATRIX = matrixRaw as unknown as Record<LeagueId, { engineRev: number; refs: string[] }>;

export const TIERS = (lg: LeagueId): string[] => RANKINGS[lg].tiers;
export const DEFAULT_TIER = (lg: LeagueId): string => RANKINGS[lg].defaultTier;
export const ENGINE_REV = (lg: LeagueId): number => RANKINGS[lg].engineRev;

/** The team-builder candidate pool: top N by Overall at the default tier. */
export function teamPool(lg: LeagueId): string[] {
  return MATRIX[lg].refs;
}

export interface RankRow {
  ref: string;
  name: string;
  /** Our score for the requested category, on the 0–1000 rating scale. */
  score: number;
  /** Same category with the strongest swept loadout instead of the rated one. */
  bestScore: number;
  /** Label of that strongest loadout, and whether it is the rated one. */
  bestLoadout: string;
  bestIsRecommended: boolean;
  loadouts: RawLoadout[];
  /** Our position in this ordering, 1-based. */
  rank: number;
  /**
   * PvPoke's position in the same ordering, over the same set of species.
   *
   * Deliberately a rank and not a score. Their number is a 0–100 index where
   * the top of the format sits near 93; ours is a mean battle rating where 500
   * is an even fight. Rescaling one onto the other produces a difference that
   * looks like an error term and is nothing of the kind — the two are not
   * measuring the same quantity. Rank order is the part that is genuinely
   * comparable, so that is what is shown.
   *
   * Null for Shadows, which PvPoke does not publish separately.
   */
  pvpokeRank: number | null;
  /** Their rank minus ours: positive means we rate it higher than they do. */
  delta: number | null;
}

const CAT_INDEX = new Map(CATEGORIES.map((c, i) => [c.id, i]));

/**
 * PvPoke publishes Overall as `score` and the other six in `scores`, both on a
 * 0–100 scale where ~93 is the top of the format. Ours is a mean battle rating
 * where 500 is an even fight and the ceiling is nearer 600. The two are not
 * measuring the same thing on the same axis, so the comparison is presented as
 * a rank-order sanity check rather than an equivalence — see the note the
 * Rankings screen carries.
 */
function pvpokeRaw(entry: RawEntry, cat: CategoryId): number | null {
  if (!entry.pvpoke) return null;
  if (cat === 'overall') return entry.pvpoke.score;
  const col = PVPOKE_SCORE_COLUMNS.indexOf(cat);
  const v = entry.pvpoke.scores[col];
  return v === undefined ? null : v;
}

/**
 * Which pass to read.
 *
 * `d1` is the first derivative: every swept loadout, scored against a top-N
 * opponent cutoff where everyone inside it counts equally. `d2` keeps the same
 * cutoff but grades the inside of it by d1's own Overall, so beating the head
 * of the format is worth more than beating its shoulder, and reads only the
 * rated loadout on both sides — a measure of the matchup, not the movepool.
 *
 * Both run at every tier, and the two axes are independent: the tier decides
 * who is in the room, the pass decides whether they all count the same.
 */
export type RankOrder = 'd1' | 'd2';

/**
 * Sorted rankings are memoised per (league, tier, category, order).
 *
 * There are 3 x 5 x 7 x 2 = 210 possible views over ~2300 entries, and the
 * screen re-derives one on every control click. The underlying numbers are a
 * build artefact and never change at runtime, so a view computed once is
 * correct forever — the cache has no invalidation because it has nothing to
 * invalidate.
 */
const viewCache = new Map<string, RankRow[]>();

export function rankingsFor(
  lg: LeagueId,
  tier: string,
  cat: CategoryId,
  order: RankOrder = 'd1',
): RankRow[] {
  const key = `${lg}|${tier}|${cat}|${order}`;
  const hit = viewCache.get(key);
  if (hit) return hit;
  const out = computeRankings(lg, tier, cat, order);
  viewCache.set(key, out);
  return out;
}

function computeRankings(lg: LeagueId, tier: string, cat: CategoryId, order: RankOrder): RankRow[] {
  const league = RANKINGS[lg];
  const ci = CAT_INDEX.get(cat)!;
  const scoreOf = (e: RawEntry) =>
    order === 'd2'
      ? (e.d2[tier] ?? e.d2[league.defaultTier])[ci]
      : (e.tiers[tier] ?? e.tiers[league.defaultTier]).rec[ci];

  // Their ranking is built over only the species they publish, so ours has to
  // be too or the two positions would be counting different populations and
  // every Shadow in our list would silently shift their column down.
  const rated = league.entries.filter((e) => pvpokeRaw(e, cat) !== null);
  const theirOrder = [...rated].sort((a, b) => pvpokeRaw(b, cat)! - pvpokeRaw(a, cat)!);
  const theirRank = new Map(theirOrder.map((e, i) => [e.ref, i + 1]));
  const ourOrder = [...rated].sort((a, b) => scoreOf(b) - scoreOf(a));
  const ourRankAmongRated = new Map(ourOrder.map((e, i) => [e.ref, i + 1]));

  const rows = league.entries.map((e): RankRow => {
    const t = e.tiers[tier] ?? e.tiers[league.defaultTier];
    const their = theirRank.get(e.ref) ?? null;
    const ours = ourRankAmongRated.get(e.ref);
    return {
      ref: e.ref,
      name: e.name,
      score: scoreOf(e),
      // d2 fixes the loadout by definition, so there is no alternative set to
      // gain from; reporting the d1 best there would be comparing two passes.
      bestScore: order === 'd2' ? scoreOf(e) : t.best[ci],
      bestLoadout: e.loadouts[t.set]?.[0] ?? e.loadouts[0]?.[0] ?? '',
      bestIsRecommended: t.set === 0,
      loadouts: e.loadouts,
      rank: 0,
      pvpokeRank: their,
      delta: their === null || ours === undefined ? null : their - ours,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

