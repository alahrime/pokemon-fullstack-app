import { bestSpreadFor, getEntry, mkBattleMon, selectedCharges } from './engine';
import { conflictsOnTeam, movesFor, speciesOf } from './data';
import { resistancesOf, sharedTypePairs, weaknessesOf } from './synergy';
import { teamBattle, carryoverEdge } from './team';
import { teamPool } from './rankings';
import type { BattleMon, IV, LeagueId } from './types';

/**
 * Team analysis, run live rather than read from a table.
 *
 * Everything here depends on carryover, and carryover cannot be precomputed:
 * once HP, energy and shields persist across matchups the state space is
 * continuous. What makes that affordable is that a battle costs ~10us, so a
 * full 3v3 chain is ~60us and scoring a team against a few hundred opponent
 * teams is tens of milliseconds — comfortably inside a render.
 */

const monCache = new Map<string, BattleMon>();

/**
 * A build chosen by hand, rather than the league's rated set at the rank-1 roll.
 *
 * §1d records that the rated set is often not the played set, and a team of
 * three is where that matters most — so the team builder lets a slot carry its
 * own moves and IVs. Absent, everything behaves exactly as before.
 */
export interface MonBuild {
  fastIdx: number;
  /** Empty means the league's rated charged moves. */
  chargeIds: string[];
  iv: IV;
}

export function monFor(ref: string, lg: LeagueId, build?: MonBuild): BattleMon {
  const sp = speciesOf(ref)!;
  // A custom build must not collide with the cached rated one, so the key
  // carries it. Rated lookups keep the short key and stay a cache hit.
  const key = build
    ? `${ref}|${lg}|${build.fastIdx}|${build.chargeIds.join(',')}|${build.iv.a}.${build.iv.d}.${build.iv.s}`
    : `${ref}|${lg}`;
  const hit = monCache.get(key);
  if (hit) return hit;
  const rated = movesFor(sp, lg);
  const fast = build ? (sp.fastMoves[Math.min(build.fastIdx, sp.fastMoves.length - 1)] ?? rated.fast) : rated.fast;
  const charges = build && build.chargeIds.length ? selectedCharges(sp, build.chargeIds) : rated.charges;
  const entry = build ? getEntry(ref, build.iv, lg).entry : bestSpreadFor(ref, lg, true);
  const mon = mkBattleMon(entry, fast, charges, sp.types);
  monCache.set(key, mon);
  return mon;
}

/**
 * Opponent teams to measure against.
 *
 * Enumerating them is out: C(100,3) is 161,700 and C(100,6) is 1.19 billion.
 * Instead the field is sampled deterministically from the candidate pool —
 * same seed every call, so a score does not drift between renders and two
 * teams are always compared against the identical field.
 */
export function sampleFieldTeams(lg: LeagueId, size: number, count: number): string[][] {
  const pool = teamPool(lg);
  const out: string[][] = [];
  // A cheap LCG. Determinism matters more than statistical quality here: the
  // sample is a fixed yardstick, not a source of randomness.
  let seed = 0x2f6e2b1;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const seen = new Set<string>();
  let guard = 0;
  // The guard is generous because this rejects on GBL's duplicate-species rule
  // as well as on exact repeats: near the top of a small pool a lot of draws are
  // a second form of something already picked. A field containing teams nobody
  // could legally bring is not a weaker yardstick, it is the wrong one.
  while (out.length < count && guard++ < count * 200) {
    const team: string[] = [];
    let tries = 0;
    while (team.length < size && tries++ < 200) {
      const pick = pool[Math.floor(next() * pool.length)];
      if (team.includes(pick)) continue;
      if (team.some((m) => conflictsOnTeam(m, pick))) continue;
      team.push(pick);
    }
    if (team.length < size) continue;
    const key = [...team].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(team);
  }
  return out;
}

export interface TeamReport {
  /** Share of sampled opponent teams beaten. */
  winRate: number;
  /** Mean team HP retained across the field — margin, not just wins. */
  meanHp: number;
  /**
   * Win rate with carryover minus win rate without it.
   *
   * An earlier version compared HP retained, which was worthless: the control
   * heals every survivor to full, so it always retains more and the number was
   * negative for every team ever tried. Comparing *outcomes* is the question
   * that has two answers — a team built on momentum gains when damage and
   * energy persist, one built on three unrelated good matchups does not care,
   * and a fragile one loses ground.
   */
  carryover: number;
  /** Worst matchups: individual opponents that beat this team most often. */
  threats: { ref: string; lossRate: number; meanHpCost: number }[];
}

/**
 * Score a team against a sampled field, with carryover.
 *
 * `threats` is computed per opposing *Pokemon* rather than per opposing team,
 * because "Registeel is a problem" is actionable and "this exact trio is a
 * problem" is not.
 */
export function analyseTeam(
  team: string[],
  lg: LeagueId,
  opts: { size?: number; count?: number; builds?: Record<string, MonBuild> } = {},
): TeamReport {
  const size = opts.size ?? team.length;
  const count = opts.count ?? 240;
  const field = sampleFieldTeams(lg, size, count);
  const mine = team.map((r) => monFor(r, lg, opts.builds?.[r]));

  let wins = 0;
  let hp = 0;
  let carry = 0;
  const threat = new Map<string, { losses: number; seen: number; hpCost: number }>();

  for (const foes of field) {
    const theirs = foes.map((r) => monFor(r, lg));
    const r = teamBattle(mine, theirs);
    if (r.win) wins++;
    hp += r.hpFracA;
    for (const ref of foes) {
      const t = threat.get(ref) ?? { losses: 0, seen: 0, hpCost: 0 };
      t.seen++;
      if (!r.win) t.losses++;
      t.hpCost += 1 - r.hpFracA;
      threat.set(ref, t);
    }
  }

  // Carryover is measured on a smaller slice: it needs two simulations per
  // opponent team and the signal is stable well before the full field.
  const slice = field.slice(0, Math.min(80, field.length));
  let chainedWins = 0;
  let isolatedWins = 0;
  for (const foes of slice) {
    const e = carryoverEdge(mine, foes.map((r) => monFor(r, lg)));
    if (e.chained.win) chainedWins++;
    if (e.isolated.win) isolatedWins++;
  }
  carry = slice.length ? (chainedWins - isolatedWins) / slice.length : 0;

  const threats = [...threat.entries()]
    .filter(([, t]) => t.seen >= 3)
    .map(([ref, t]) => ({ ref, lossRate: t.losses / t.seen, meanHpCost: t.hpCost / t.seen }))
    .sort((a, b) => b.lossRate - a.lossRate || b.meanHpCost - a.meanHpCost)
    .slice(0, 12);

  return {
    winRate: wins / field.length,
    meanHp: hp / field.length,
    carryover: slice.length ? carry / slice.length : 0,
    threats,
  };
}

export interface Suggestion {
  ref: string;
  winRate: number;
  /** Types this pick resists that the existing members are weak to. */
  covers: string[];
  /**
   * Win rate against the median candidate's, not against the partial team's.
   *
   * Measuring the gain over the incomplete team conflated "this pick is good"
   * with "three Pokemon beat two" — every candidate scored +61 to +64 and the
   * column said nothing. Against the median, a pick that is genuinely better
   * than the alternatives is the only thing that shows up.
   */
  gain: number;
}

/**
 * Best completions for a partial team.
 *
 * Every candidate in the pool is tried in the open slot and the whole team
 * re-simulated. That is the only honest way to do it with carryover in play:
 * a candidate cannot be scored on its own matchups, because its value depends
 * on what the rest of the team leaves it.
 */
export function suggestCompletions(
  partial: string[],
  lg: LeagueId,
  targetSize: number,
  opts: { count?: number; limit?: number; builds?: Record<string, MonBuild> } = {},
): Suggestion[] {
  const count = opts.count ?? 90;
  const limit = opts.limit ?? 12;
  const field = sampleFieldTeams(lg, targetSize, count);
  // A completion has to satisfy every rule the offline discovery pass enforces,
  // or the builder recommends teams that discovery would have thrown out:
  // no duplicate species, and no repeated typing on a three (the ABC rule).
  // Filtering here rather than after scoring keeps the gain column honest —
  // the median it is measured against is a median of legal picks.
  const pool = teamPool(lg).filter((r) => {
    if (partial.some((p) => p === r || conflictsOnTeam(p, r))) return false;
    if (targetSize === 3 && sharedTypePairs([...partial, r].map((x) => speciesOf(x)?.types ?? []))) return false;
    return true;
  });

  const score = (team: string[]) => {
    const mine = team.map((r) => monFor(r, lg, opts.builds?.[r]));
    let wins = 0;
    for (const foes of field) if (teamBattle(mine, foes.map((r) => monFor(r, lg))).win) wins++;
    return wins / field.length;
  };

  const scored = pool.map((ref) => ({ ref, winRate: score([...partial, ref]) }));
  const sortedRates = scored.map((s) => s.winRate).sort((a, b) => a - b);
  const median = sortedRates[Math.floor(sortedRates.length / 2)] ?? 0;
  // What the pick actually shores up, so the list says why rather than only
  // how much. A weakness the existing team already answers is not a reason.
  const open = new Set(
    partial.flatMap((p) => weaknessesOf(speciesOf(p)?.types ?? []))
      .filter((w) => !partial.some((p) => resistancesOf(speciesOf(p)?.types ?? []).includes(w))),
  );
  const out = scored.map((s) => ({
    ...s,
    gain: s.winRate - median,
    covers: resistancesOf(speciesOf(s.ref)?.types ?? []).filter((r) => open.has(r)),
  }));
  out.sort((a, b) => b.winRate - a.winRate);
  return out.slice(0, limit);
}

/**
 * Show 6 as the matrix game it actually is.
 *
 * You bring six, but only three enter, and after seeing the opponent's six
 * both players pick. So a 6v6 is not one battle — it is a 20x20 game over each
 * side's C(6,3) subteams, and the value of your six is what you can guarantee
 * when the opponent picks their best answer to whatever you pick.
 *
 * Scored as a maximin: for each of your 20 subteams, find the worst the
 * opponent can do to it; your six is worth the best of those floors. That is
 * the honest read of "bring six, no restrictions on re-picking" — it rewards
 * having an answer to everything rather than one strong line.
 */
export function subteams<T>(six: readonly T[], k = 3): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < six.length; i++) {
      acc.push(six[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

export interface Show6Report {
  /** Guaranteed value against the field when the opponent answers optimally. */
  floor: number;
  /** Value if the opponent picks blind — the gap is how much the read costs. */
  naive: number;
  /** Which of your 20 subteams achieves the floor. */
  bestLine: string[];
  /** Opponent Pokemon that most often appear in the answer that beats you. */
  threats: { ref: string; lossRate: number; meanHpCost: number }[];
}

export function analyseShow6(
  six: string[],
  lg: LeagueId,
  opts: { count?: number; builds?: Record<string, MonBuild> } = {},
): Show6Report {
  const count = opts.count ?? 40;
  const field = sampleFieldTeams(lg, 6, count);
  const myLines = subteams(six);

  let bestFloor = -Infinity;
  let bestLine = myLines[0] ?? [];
  const threat = new Map<string, { losses: number; seen: number; hpCost: number }>();
  let naiveTotal = 0;

  for (const line of myLines) {
    const mine = line.map((r) => monFor(r, lg, opts.builds?.[r]));
    let floor = Infinity;
    let naive = 0;
    for (const theirSix of field) {
      // The opponent answers with their best of 20 against this exact line.
      let worst = Infinity;
      let worstTeam: string[] = [];
      let mean = 0;
      const theirLines = subteams(theirSix);
      for (const answer of theirLines) {
        const r = teamBattle(mine, answer.map((x) => monFor(x, lg)));
        const v = r.hpFracA - r.hpFracB;
        mean += v;
        if (v < worst) { worst = v; worstTeam = answer; }
      }
      naive += mean / theirLines.length;
      if (worst < floor) floor = worst;
      for (const ref of worstTeam) {
        const t = threat.get(ref) ?? { losses: 0, seen: 0, hpCost: 0 };
        t.seen++;
        if (worst < 0) t.losses++;
        t.hpCost += Math.max(0, -worst);
        threat.set(ref, t);
      }
    }
    naiveTotal += naive / field.length;
    if (floor > bestFloor) { bestFloor = floor; bestLine = line; }
  }

  const threats = [...threat.entries()]
    .filter(([, t]) => t.seen >= 3)
    .map(([ref, t]) => ({ ref, lossRate: t.losses / t.seen, meanHpCost: t.hpCost / t.seen }))
    .sort((a, b) => b.lossRate - a.lossRate || b.meanHpCost - a.meanHpCost)
    .slice(0, 12);

  // A six short of three members yields no lines at all, leaving the floor at
  // -Infinity and rendering as such. Report zero rather than a sentinel.
  return {
    floor: Number.isFinite(bestFloor) ? bestFloor : 0,
    naive: myLines.length ? naiveTotal / myLines.length : 0,
    bestLine,
    threats,
  };
}
