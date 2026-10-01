import { conflictsOnTeam } from './data';
import { teamPool } from './rankings';
import { teamBattle } from './team';
import { monFor, type MonBuild } from './monFor';
import type { BattleMon, LeagueId } from './types';

/**
 * Matchups as a matrix of matrices: opponents down the side, your members across the top, and in every cell the
 * same one-on-one fought three times, at 0-0, 1-1 and 2-2 shields. Shields decide a great many matchups, so a cell
 * is read as three results, never one. (Uneven shields are left out on purpose.)
 *
 * A result is a rating from 0 to 1000: 500 is a draw, and the distance from it is the share of the winner's HP that
 * was left — a win that finished on fumes is barely above 500, a clean one near 1000.
 */
export const SHIELDS = [0, 1, 2] as const;
export type Ratings = [number, number, number];

export type Tone = 'rout' | 'lose' | 'close' | 'win' | 'crush';
/** The band a rating falls in, which is what the cell is coloured by. */
export function toneOf(rating: number): Tone {
  if (rating < 250) return 'rout';
  if (rating < 450) return 'lose';
  if (rating <= 550) return 'close';
  if (rating <= 750) return 'win';
  return 'crush';
}

/** One member against one opponent at every shield count. */
export function duel(mine: BattleMon, foe: BattleMon): Ratings {
  return SHIELDS.map((shields) => {
    const r = teamBattle([mine], [foe], { shields });
    return Math.round(Math.max(0, Math.min(1000, 500 + 500 * (r.hpFracA - r.hpFracB))));
  }) as Ratings;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Shield counts won, out of three. A matchup is "answered" where it is won at two or more. */
export const wins = (r: Ratings) => r.filter((x) => x > 500).length;

export interface MatrixRow {
  ref: string;
  /** One entry per member, in roster order. */
  cells: Ratings[];
  /** Mean rating over every member and shield count. */
  mean: number;
  /** Members this opponent beats (lost at two or more shield counts). */
  beats: string[];
  /** 0..1: how hard this opponent presses the roster, weighted by how likely it is to be met. */
  pressure: number;
  /** How likely the opponent is to be met, 0..1 — the weight `pressure` carries. */
  weight: number;
}

const pressureOf = (memberMeans: readonly number[]) => {
  const all = mean(memberMeans);
  const best = memberMeans.length ? Math.max(...memberMeans) : 0;
  // Half how badly the whole roster fares, half how thin the best answer is: an opponent nothing answers
  // outranks one the roster merely loses to on average.
  return 0.5 * (1 - all / 1000) + 0.5 * (1 - best / 1000);
};

/** Likelier opponents (nearer the top of the league's pool) count for more. */
const likelihood = (idx: number) => 1 / (1 + idx / 40);

function rowFor(team: string[], foeRef: string, lg: LeagueId, builds: Record<string, MonBuild> | undefined, idx: number): MatrixRow {
  const foe = monFor(foeRef, lg);
  const cells = team.map((m) => duel(monFor(m, lg, builds?.[m]), foe));
  const means = cells.map(mean);
  const weight = likelihood(idx);
  return {
    ref: foeRef,
    cells,
    mean: mean(means),
    beats: team.filter((_, i) => wins(cells[i]) < 2),
    pressure: pressureOf(means) * weight,
    weight,
  };
}

/** The matrix for opponents of your choosing (any refs, e.g. ones you added to compare). */
export function matrixFor(team: string[], foes: string[], lg: LeagueId, builds?: Record<string, MonBuild>): MatrixRow[] {
  if (team.length === 0) return [];
  const pool = teamPool(lg);
  return foes.map((f) => rowFor(team, f, lg, builds, Math.max(0, pool.indexOf(f))));
}

/** The opponents that press this roster hardest, across all three shield counts. Most threatening first. */
export function topThreats(team: string[], lg: LeagueId, builds?: Record<string, MonBuild>, limit = 20): MatrixRow[] {
  if (team.length === 0) return [];
  const rows: MatrixRow[] = [];
  teamPool(lg).forEach((f, idx) => {
    if (team.some((r) => r === f || conflictsOnTeam(r, f))) return;
    rows.push(rowFor(team, f, lg, builds, idx));
  });
  return rows.sort((a, b) => b.pressure - a.pressure).slice(0, limit);
}

/** The roster's overall exposure: threat pressure summed over the list, scaled to a round number. Lower is better. */
export const threatScore = (threats: readonly MatrixRow[]): number =>
  Math.round(threats.reduce((s, t) => s + t.pressure, 0) * 100);

export interface AltRow {
  ref: string;
  /** One entry per threat, in the order given. */
  cells: Ratings[];
  /** 0..100: mean rating over the threats, each counted by how hard it presses. */
  score: number;
  /** Threats answered (won at two or more shield counts). */
  answered: number;
}

/** How one Pokémon fares against a list of threats — for a candidate, or any ref added to compare. */
export function altRowFor(ref: string, threats: readonly MatrixRow[], lg: LeagueId): AltRow {
  const me = monFor(ref, lg);
  const cells = threats.map((t) => duel(me, monFor(t.ref, lg)));
  const total = threats.reduce((s, t) => s + t.pressure, 0) || 1;
  const score = cells.reduce((s, c, i) => s + (mean(c) / 10) * threats[i].pressure, 0) / total;
  return { ref, cells, score: Math.round(score * 10) / 10, answered: cells.filter((c) => wins(c) >= 2).length };
}

/** Pokémon that would answer what presses the roster, best first. Candidates are the league's pool, minus conflicts. */
export function alternativesFor(team: string[], threats: readonly MatrixRow[], lg: LeagueId, limit = 20): AltRow[] {
  if (team.length === 0 || threats.length === 0) return [];
  return teamPool(lg)
    .filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))
    .map((r) => altRowFor(r, threats, lg))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface Completion {
  ref: string;
  /** The roster's threat score with this Pokémon added. */
  after: number;
  /** Threat score points it removes (negative if it makes things worse). */
  gain: number;
}

/**
 * Who to add. Each candidate is fought against the opponents that press the roster now, and the roster is scored
 * again with it in the line: an opponent is only a problem to the extent nobody on the roster, new member included,
 * answers it. Lowest resulting threat score first.
 */
export function completionsFor(
  team: string[], candidates: readonly string[], lg: LeagueId, builds?: Record<string, MonBuild>, limit = 12,
): Completion[] {
  const threats = topThreats(team, lg, builds);
  if (threats.length === 0) return [];
  const before = threatScore(threats);
  return candidates
    .filter((c) => !team.includes(c))
    .map((cand) => {
      const me = monFor(cand, lg);
      const total = threats.reduce((sum, t) => {
        // A threat that is the candidate itself or its relative is no matchup for it; the roster's own answer stands.
        const means = conflictsOnTeam(cand, t.ref) || cand === t.ref
          ? t.cells.map(mean)
          : [...t.cells, duel(me, monFor(t.ref, lg))].map(mean);
        return sum + pressureOf(means) * t.weight;
      }, 0);
      const after = Math.round(total * 100);
      return { ref: cand, after, gain: before - after };
    })
    .sort((a, b) => a.after - b.after)
    .slice(0, limit);
}
