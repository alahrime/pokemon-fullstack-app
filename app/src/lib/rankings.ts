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
  /** Latent strength per tier from the Bradley-Terry fit, log-odds. See btFit.
   *  null where the ref is outside that tier. */
  bt?: Record<string, number | null>;
}

/**
 * How well a single number can describe the format at all.
 *
 * Emitted by the Bradley-Terry fit in scripts/bradley-terry.ts. `cyclicPct` is
 * the load-bearing figure: 0% would mean a perfectly transitive format where a
 * ranking is a complete description, and 25% is what independent coin flips
 * would produce. See BACKLOG §1n.
 */
export interface BTFitSummary {
  r2: number;
  rmse: number;
  cyclicPct: number;
  total: number;
  /** Refs inside this tier — the population the fit was run over. */
  n: number;
  worst: { a: string; b: string; observed: number; predicted: number }[];
}

interface RawLeague {
  engineRev: number;
  tiers: string[];
  defaultTier: string;
  categories: CategoryId[];
  entries: RawEntry[];
  btFit?: Record<string, BTFitSummary>;
}

const RANKINGS = rankingsRaw as unknown as Record<LeagueId, RawLeague>;
const MATRIX = matrixRaw as unknown as Record<LeagueId, { engineRev: number; refs: string[] }>;

export const TIERS = (lg: LeagueId): string[] => RANKINGS[lg].tiers;
export const DEFAULT_TIER = (lg: LeagueId): string => RANKINGS[lg].defaultTier;
export const ENGINE_REV = (lg: LeagueId): number => RANKINGS[lg].engineRev;

/** The Bradley-Terry diagnostics for a league and tier, if the build emitted them. */
export const btFitFor = (lg: LeagueId, tier: string): BTFitSummary | undefined =>
  RANKINGS[lg].btFit?.[tier];

/**
 * Cyclic share at every tier, which is the finding a single whole-field fit
 * hid: transitivity is not uniform. The head of a format is where Pokemon are
 * picked to check each other, so it is where cycles concentrate — every tier
 * measures MORE cyclic than the full roster, whose long transitive tail (bad
 * Pokemon lose to everything, which is perfectly orderable) dilutes it.
 */
export function btCyclicByTier(lg: LeagueId): { tier: string; cyclicPct: number; n: number }[] {
  const fit = RANKINGS[lg].btFit;
  if (!fit) return [];
  return RANKINGS[lg].tiers
    .filter((t) => fit[t])
    .map((t) => ({ tier: t, cyclicPct: fit[t].cyclicPct, n: fit[t].n }));
}

/**
 * Both rankings side by side: the composite Overall and the Bradley-Terry
 * strength, each with its own position, for the Diagnostics screen.
 */
export function btComparison(lg: LeagueId, tier: string) {
  // Both sides restricted to the same tier, so the comparison is like with
  // like. The fit is run per tier for exactly this reason.
  const ent = RANKINGS[lg].entries.filter(
    (e) => e.d2[tier] && e.bt?.[tier] !== undefined && e.bt?.[tier] !== null,
  );
  const byComposite = [...ent].sort((a, b) => b.d2[tier][0] - a.d2[tier][0]);
  const byBt = [...ent].sort((a, b) => (b.bt![tier] ?? 0) - (a.bt![tier] ?? 0));
  const cPos = new Map(byComposite.map((e, i) => [e.ref, i + 1]));
  const bPos = new Map(byBt.map((e, i) => [e.ref, i + 1]));
  const rows = byComposite.map((e) => ({
    ref: e.ref,
    name: e.name,
    composite: e.d2[tier][0],
    compositeRank: cPos.get(e.ref)!,
    bt: e.bt![tier] ?? 0,
    btRank: bPos.get(e.ref)!,
    delta: cPos.get(e.ref)! - bPos.get(e.ref)!,
  }));
  // Spearman between the two orderings, which is the headline "do these agree".
  const n = rows.length;
  let d2 = 0;
  for (const r of rows) d2 += (r.compositeRank - r.btRank) ** 2;
  const rho = n > 1 ? 1 - (6 * d2) / (n * (n * n - 1)) : 1;
  return { rows, rho };
}

/** The team-builder candidate pool: top N by Overall at the default tier. */
export function teamPool(lg: LeagueId): string[] {
  return MATRIX[lg].refs;
}

/**
 * Top `n` by Overall at a tier — the opponent field coverage is measured over.
 *
 * `teamPool` is the top 100 and is the right pool to *build from*; it is the
 * wrong field to measure coverage *against*, because a core is frequently two
 * mid-ladder Pokemon answering things a hundred-strong field never contains.
 * Kept here so the live pair checker and the offline core build ask the same
 * question of the same opponents.
 */
export function fieldPool(lg: LeagueId, tier: string, n: number): string[] {
  const league = RANKINGS[lg];
  const ci = CAT_INDEX.get('overall')!;
  const at = (e: RawEntry) => (e.tiers[tier] ?? e.tiers[league.defaultTier]).rec[ci];
  return [...league.entries].sort((a, b) => at(b) - at(a)).slice(0, n).map((e) => e.ref);
}

/** One species' Overall at a tier — the relevance weight cores are graded by. */
export function overallOf(lg: LeagueId, tier: string, ref: string): number {
  const league = RANKINGS[lg];
  const e = league.entries.find((x) => x.ref === ref);
  if (!e) return 0;
  return (e.tiers[tier] ?? e.tiers[league.defaultTier]).rec[CAT_INDEX.get('overall')!];
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
   * is the win/loss line. Rescaling one onto the other produces a difference that
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
 * where the category columns are battle ratings and Overall is a normalised
   * composite. The two are not
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

/**
 * The whole league as one nested object, for export.
 *
 * Kept nested rather than flattened: the same species appears in 84 strata, so
 * a rectangle would repeat every name and loadout list 84 times to say what the
 * structure says once. The per-view CSV export is the flat counterpart, and
 * between them a reader gets whichever shape their tool wants.
 */
export function exportAll(lg: LeagueId) {
  const league = RANKINGS[lg];
  return {
    league: lg,
    engineRev: league.engineRev,
    tiers: league.tiers,
    defaultTier: league.defaultTier,
    categories: league.categories,
    passes: ['d1', 'd2'] as RankOrder[],
    scale: 'Category columns are 0-1000 battle ratings (health kept + damage dealt, with PvPoke shield-pressure credit, a soft cap on blowouts above 700 and a curve on losses below 300). Overall is NOT a battle rating: it is a weighted geometric mean of the five role scores, each normalised against the best in its category, strongest role weighted 12x, shown x10. Only its order is meaningful.',
    species: league.entries.map((e) => ({
      ref: e.ref,
      name: e.name,
      pvpoke: e.pvpoke,
      loadouts: e.loadouts.map(([label, score]) => ({ label, score })),
      // Scores zipped back to their category names — the wire format is a bare
      // array in CATEGORIES order and nothing outside this module should have
      // to know that.
      tiers: Object.fromEntries(
        Object.entries(e.tiers).map(([t, v]) => [
          t,
          {
            d1: Object.fromEntries(league.categories.map((c, i) => [c, v.rec[i]])),
            best: Object.fromEntries(league.categories.map((c, i) => [c, v.best[i]])),
            bestSet: v.set,
            d2: Object.fromEntries(league.categories.map((c, i) => [c, e.d2[t][i]])),
          },
        ]),
      ),
    })),
  };
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

