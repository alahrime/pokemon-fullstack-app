import teamsRaw from '../data/teams.json';
import type { CategoryId } from './scenarios';
import type { LeagueId } from './types';
import type { Synergy } from './synergy';

/**
 * The three readings of the same teams: two simulated, one structural.
 *
 * Kept apart from the species-level RankOrder deliberately — synergy is a
 * property of a team and means nothing for a single Pokemon, so widening that
 * type would have put an option on the Rankings screen that cannot be answered.
 */
export type TeamPass = 'd1' | 'd2' | 'syn';

export const TEAM_PASSES: { id: TeamPass; label: string; blurb: string }[] = [
  { id: 'd1', label: 'First derivative', blurb: 'Simulated chain result, every opponent team inside the cutoff counting the same.' },
  { id: 'd2', label: 'Weighted regression', blurb: "Simulated chain result, opponent teams graded by their own members' Overall." },
  { id: 'syn', label: 'Synergy', blurb: 'Ranked by how well the team covers itself: coverage, redundancy, swap safety, type complement and bulk. Not blended with the simulated passes — a different question, asked of the same teams.' },
];

/**
 * Reader for what scripts/build-teams.ts emits.
 *
 * The build discovers the best threes and the best sixes at every stratification
 * the rankings carry — tier, category, and both weighting passes — so this is a
 * lookup, not a computation. Teams that are *scored* live still go through
 * lib/teambuild.ts; this answers the other question, "what should I bring",
 * which cannot be answered live because it ranges over every team in the pool.
 */

export interface BestTeam {
  refs: string[];
  /** The ranking number for whichever pass produced this list. */
  score: number;
  /**
   * For sixes: the three inside it that carries the six — the line with the
   * best weighted-mean worst case, not whichever peaked against one opponent.
   */
  line?: string[];
  /** Simulated chain score, present even when synergy did the ranking. */
  sim?: number;
  /** Synergy components, attached to every team whatever pass ranked it. */
  syn?: Synergy;
}

/**
 * How even a core's two rescue directions are, 0–1.
 *
 * The distinction the raw score cannot make. Carbink + Shadow Corviknight
 * scores 565 off rescue directions of 370 and 910 — Carbink is doing most of
 * the work, which is a strong pairing but not a mutual one. Altaria + Empoleon
 * scores 268 off 495 and 378: lower, but genuinely reciprocal. Both are worth
 * knowing and they are different facts, so balance is shown rather than folded
 * into the score.
 */
export const coreBalance = (c: Core): number => {
  const lo = Math.min(c.aRescuedByB, c.bRescuedByA);
  const hi = Math.max(c.aRescuedByB, c.bRescuedByA);
  return hi === 0 ? 0 : lo / hi;
};

/** A two-Pokemon core: mutual rescue, with the evidence for it. */
export interface Core {
  a: string;
  b: string;
  score: number;
  aRescuedByB: number;
  bRescuedByA: number;
  bCovers: string[];
  aCovers: string[];
  bCoversTypes: string[];
  aCoversTypes: string[];
  sharedWeak: string[];
  appearances: number;
  lift: number;
}

/** A lead whose weakness two teammates independently answer. */
export interface Pillar {
  lead: string;
  backs: string[];
  /** Share of the lead's losing matchups both backs answer, per mille. */
  doubleCover: number;
  leadLosses: number;
  covered: string[];
}

/**
 * The wire format is deliberately compact: refs are indices into the league's
 * own `refs` table and everything else is a bare number.
 *
 *   t3  [i, j, k, score, sim]
 *   t6  [a..f, line0, line1, line2, score, sim]
 *   d3/d6  [synScore, coverage, redundancy, swapWorst, swapMean, typeCover,
 *           bulk, ...holeIndices]   — head only, parallel to t3/t6
 *
 * Written this way because a team as names and a synergy object is ~120 bytes
 * and a team as five numbers is ~16. That difference is what makes 150 teams
 * per stratum affordable where 12 used to be the cap.
 */
interface RawStratum {
  t3: number[][];
  t6: number[][];
  d3: number[][];
  d6: number[][];
}

interface RawLeague {
  teamRev: number;
  /** The matrix revision these were built against, for staleness checks. */
  engineRev: number;
  tiers: string[];
  categories: CategoryId[];
  passes: TeamPass[];
  refs: string[];
  cores: Core[];
  pillars: Pillar[];
  strata: Record<string, RawStratum>;
}

const TEAMS = teamsRaw as unknown as Record<LeagueId, RawLeague>;

export const TEAM_REV = (lg: LeagueId): number => TEAMS[lg].teamRev;
export const TEAM_ENGINE_REV = (lg: LeagueId): number => TEAMS[lg].engineRev;
export const TEAM_TIERS = (lg: LeagueId): string[] => TEAMS[lg].tiers;
export const coresFor = (lg: LeagueId): Core[] => TEAMS[lg]?.cores ?? [];
export const pillarsFor = (lg: LeagueId): Pillar[] => TEAMS[lg]?.pillars ?? [];

/** How many teams a stratum actually holds, without decoding them. */
export function teamCount(lg: LeagueId, tier: string, cat: CategoryId, pass: TeamPass, size: 3 | 6): number {
  const st = TEAMS[lg]?.strata[`${tier}|${cat}|${pass}`];
  if (!st) return 0;
  return (size === 3 ? st.t3 : st.t6).length;
}

/**
 * Decode a slice of a stratum.
 *
 * Sliced rather than decoded whole because a stratum now holds 150 teams and a
 * screen shows a page of them; materialising all of them on every control click
 * was the thing the old 12-team cap was hiding.
 */
export function bestTeams(
  lg: LeagueId,
  tier: string,
  cat: CategoryId,
  pass: TeamPass,
  size: 3 | 6,
  from = 0,
  to = Infinity,
): BestTeam[] {
  const league = TEAMS[lg];
  const st = league?.strata[`${tier}|${cat}|${pass}`];
  if (!st) return [];
  const rows = size === 3 ? st.t3 : st.t6;
  const detail = size === 3 ? st.d3 : st.d6;
  const n = size === 3 ? 3 : 6;
  const out: BestTeam[] = [];
  for (let i = from; i < Math.min(to, rows.length); i++) {
    const row = rows[i];
    const refs = row.slice(0, n).map((x) => league.refs[x]);
    const line = size === 6 ? row.slice(6, 9).map((x) => league.refs[x]) : undefined;
    const d = detail[i];
    out.push({
      refs,
      line,
      score: row[row.length - 2],
      sim: row[row.length - 1],
      syn: d && d.length
        ? {
            score: d[0], coverage: d[1], redundancy: d[2], swapWorst: d[3],
            swapMean: d[4], typeCover: d[5], bulk: d[6],
            holes: d.slice(7).map((x) => league.refs[x]).filter(Boolean),
          }
        : undefined,
    });
  }
  return out;
}

/** Every stratum for a league, flattened — the shape the CSV export wants. */
export function allTeamRows(lg: LeagueId): {
  league: LeagueId;
  tier: string;
  category: CategoryId;
  pass: TeamPass;
  size: 3 | 6;
  rank: number;
  score: number;
  sim: number | '';
  coverage: number | '';
  redundancy: number | '';
  swapWorst: number | '';
  swapMean: number | '';
  typeCover: number | '';
  bulk: number | '';
  holes: string;
  members: string;
  bestLine: string;
}[] {
  const league = TEAMS[lg];
  if (!league) return [];
  const out: ReturnType<typeof allTeamRows> = [];
  for (const key of Object.keys(league.strata)) {
    const [tier, category, pass] = key.split('|') as [string, CategoryId, TeamPass];
    for (const size of [3, 6] as const) {
      bestTeams(lg, tier, category, pass, size).forEach((t, i) => {
        out.push({
          league: lg,
          tier,
          category,
          pass,
          size,
          rank: i + 1,
          score: t.score,
          sim: t.sim ?? '',
          coverage: t.syn?.coverage ?? '',
          redundancy: t.syn?.redundancy ?? '',
          swapWorst: t.syn?.swapWorst ?? '',
          swapMean: t.syn?.swapMean ?? '',
          typeCover: t.syn?.typeCover ?? '',
          bulk: t.syn?.bulk ?? '',
          holes: t.syn?.holes.join(' ') ?? '',
          members: t.refs.join(' / '),
          bestLine: t.line?.join(' / ') ?? '',
        });
      });
    }
  }
  return out;
}
