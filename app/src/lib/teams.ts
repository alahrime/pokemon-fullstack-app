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

interface RawStratum {
  threes: BestTeam[];
  sixes: BestTeam[];
}

interface RawLeague {
  teamRev: number;
  /** The matrix revision these were built against, for staleness checks. */
  engineRev: number;
  tiers: string[];
  categories: CategoryId[];
  passes: TeamPass[];
  cores: Core[];
  pillars: Pillar[];
  strata: Record<string, RawStratum>;
}

const TEAMS = teamsRaw as unknown as Record<LeagueId, RawLeague>;

export const TEAM_REV = (lg: LeagueId): number => TEAMS[lg].teamRev;
export const TEAM_ENGINE_REV = (lg: LeagueId): number => TEAMS[lg].engineRev;
export const TEAM_TIERS = (lg: LeagueId): string[] => TEAMS[lg].tiers;

/**
 * The discovered teams for one stratum.
 *
 * Returns an empty list rather than throwing when a stratum is missing, so a
 * partially-rebuilt artefact degrades to "nothing to show" instead of taking
 * the screen down. `TEAM_ENGINE_REV` is what surfaces staleness properly.
 */
export const coresFor = (lg: LeagueId): Core[] => TEAMS[lg]?.cores ?? [];
export const pillarsFor = (lg: LeagueId): Pillar[] => TEAMS[lg]?.pillars ?? [];

export function bestTeams(
  lg: LeagueId,
  tier: string,
  cat: CategoryId,
  pass: TeamPass,
  size: 3 | 6,
): BestTeam[] {
  const st = TEAMS[lg]?.strata[`${tier}|${cat}|${pass}`];
  if (!st) return [];
  return size === 3 ? st.threes : st.sixes;
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
  for (const [key, st] of Object.entries(league.strata)) {
    const [tier, category, pass] = key.split('|') as [string, CategoryId, TeamPass];
    for (const [size, list] of [[3, st.threes], [6, st.sixes]] as const) {
      list.forEach((t, i) => {
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
