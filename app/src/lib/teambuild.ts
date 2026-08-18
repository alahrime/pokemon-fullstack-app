import { defaultSpreadFor, getEntry, mkBattleMon, selectedCharges } from './engine';
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
  // The same roll the slot's card displays. These two disagreeing is the one
  // thing this must not do: the card would describe a build the analysis behind
  // it never fielded.
  const entry = build ? getEntry(ref, build.iv, lg).entry : defaultSpreadFor(ref, lg, true);
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

/**
 * An opponent that was on the field when a chain lost, and what the roster can
 * do about it one-on-one.
 *
 * `lossRate` alone says a Pokemon was present for defeats; it does not say
 * whether the team has any answer to it. `answered` and `lost` are the
 * difference between a list to read and a list to act on.
 */
export interface FieldThreat {
  ref: string;
  lossRate: number;
  meanHpCost: number;
  /** Members that beat it one-on-one. */
  answered: string[];
  /** Members that lose to it. */
  lost: string[];
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
  threats: FieldThreat[];
}

/**
 * Who on the roster beats a given opponent, one-on-one.
 *
 * A single matchup rather than a chain: the question is whether this member is
 * an answer to that Pokemon at all, and a chain result would fold in whatever
 * the two before it left behind. Cheap enough to run for every threat against
 * every member — twenty threats and six members is 120 battles, against the
 * sixteen thousand the six's matrix game already costs.
 */
function answerBreakdown(
  team: string[],
  threatRef: string,
  lg: LeagueId,
  builds?: Record<string, MonBuild>,
): { answered: string[]; lost: string[] } {
  const foe = monFor(threatRef, lg);
  const answered: string[] = [];
  const lost: string[] = [];
  for (const ref of team) {
    const r = teamBattle([monFor(ref, lg, builds?.[ref])], [foe]);
    (r.win ? answered : lost).push(ref);
  }
  return { answered, lost };
}

/** Attach the "who answers this" breakdown to a list of scored threats. */
function withAnswers(
  rows: { ref: string; lossRate: number; meanHpCost: number }[],
  team: string[],
  lg: LeagueId,
  builds?: Record<string, MonBuild>,
): FieldThreat[] {
  return rows.map((t) => ({ ...t, ...answerBreakdown(team, t.ref, lg, builds) }));
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

  const threats = withAnswers(
    [...threat.entries()]
      .filter(([, t]) => t.seen >= 3)
      .map(([ref, t]) => ({ ref, lossRate: t.losses / t.seen, meanHpCost: t.hpCost / t.seen }))
      .sort((a, b) => b.lossRate - a.lossRate || b.meanHpCost - a.meanHpCost)
      .slice(0, 12),
    team,
    lg,
    opts.builds,
  );

  return {
    winRate: wins / field.length,
    meanHp: hp / field.length,
    carryover: slice.length ? carry / slice.length : 0,
    threats,
  };
}

export interface Suggestion {
  ref: string;
  /**
   * What the pick is worth, on the scale `metric` names.
   *
   * Two different games are being played here, so one number cannot mean the
   * same thing in both — see `suggestCompletions`.
   */
  value: number;
  /**
   * Which scale `value` and `gain` are on.
   *
   * `winRate` — share of the sampled field this chain beats, 0..1.
   * `floor`   — mean guaranteed value against an opponent who answers your
   *             best line, roughly -0.5..+0.5 and routinely negative.
   *
   * Carried on the row rather than left for the caller to infer from the target
   * size, because a floor rendered as a win rate reads as a catastrophic team
   * rather than as the wrong unit.
   */
  metric: 'winRate' | 'floor';
  /** Types this pick resists that the existing members are weak to. */
  covers: string[];
  /**
   * `value` against the median candidate's, not against the partial team's.
   *
   * Measuring the gain over the incomplete team conflated "this pick is good"
   * with "three Pokemon beat two" — every candidate scored +61 to +64 and the
   * column said nothing. Against the median, a pick that is genuinely better
   * than the alternatives is the only thing that shows up.
   */
  gain: number;
}

/**
 * How many pairs of a roster may share a typing.
 *
 * Discovery's rule, from `MAX_SHARED_TYPES_3`/`_6` in `scripts/build-teams.ts`:
 * zero for a three, which is what an ABC line means and what you actually
 * field; two for a six, which is a menu you pick three from and may carry some
 * overlap while still offering a clean line.
 */
const MAX_SHARED_TYPES: Record<number, number> = { 3: 0, 6: 2 };

export interface CompletionPool {
  /** Candidates legal in the open slot, before any simulation. */
  pool: string[];
  /** The shared-typing allowance actually applied. */
  typeCap: number;
  /** The allowance discovery would use for a roster this size. */
  nominal: number;
  /** Pairs of the existing members that already share a typing. */
  shared: number;
  /** True when even the floored allowance left nothing and had to be loosened. */
  relaxed: boolean;
}

/**
 * Who may be suggested for the open slot.
 *
 * A completion has to satisfy the rules the offline discovery pass builds
 * under, or the builder recommends teams discovery would have thrown out: no
 * duplicate species, and no repeated typing past the allowance for the size.
 * Filtering here rather than after scoring keeps the gain column honest — the
 * median it is measured against is then a median of legal picks.
 *
 * The one place this cannot copy discovery is the floor. Discovery
 * *constructs* teams and may reject any that breaks the rule; here the existing
 * members are the user's, and vetoing them is not on offer. Registeel and
 * Skarmory is an ordinary Great pairing that already repeats Steel, and judging
 * the whole roster against a cap of zero rejected **every** candidate and left
 * an empty panel — as did any Show 6 past its third member, since five
 * arbitrary Pokemon always share more than two typings. So the cap starts at
 * whichever is larger, the size's allowance or what the roster already spends.
 * That asks the candidate not to make things worse, and leaves the rule its
 * teeth exactly where it can still be obeyed.
 *
 * Past that it relaxes one step at a time, as discovery does when a stratum
 * comes out empty: an unexplained empty list and a silently dropped rule are
 * both worse than saying which allowance was used.
 */
export function completionPool(partial: string[], lg: LeagueId, targetSize: number): CompletionPool {
  const typesOf = (r: string) => speciesOf(r)?.types ?? [];
  const legal = teamPool(lg).filter((r) => !partial.some((p) => p === r || conflictsOnTeam(p, r)));
  const nominal = MAX_SHARED_TYPES[targetSize] ?? 0;
  const shared = sharedTypePairs(partial.map(typesOf));
  const base = Math.max(nominal, shared);
  const under = (cap: number) =>
    legal.filter((r) => sharedTypePairs([...partial, r].map(typesOf)) <= cap);
  // Every pair of a full roster — the point at which the rule excludes nothing
  // and the loop must stop.
  const allPairs = (targetSize * (targetSize - 1)) / 2;
  let typeCap = base;
  let pool = under(typeCap);
  while (pool.length === 0 && typeCap < allPairs) pool = under(++typeCap);
  return { pool, typeCap, nominal, shared, relaxed: typeCap > base };
}

/**
 * Best completions for a partial team.
 *
 * Every candidate in the pool is tried in the open slot and the whole roster
 * re-simulated. That is the only honest way to do it with carryover in play: a
 * candidate cannot be scored on its own matchups, because its value depends on
 * what the rest of the team leaves it.
 *
 * **A six is not a longer three, so it is not scored as one.** Filling the
 * fourth slot of a Show 6 by simulating a four-Pokemon chain against sampled
 * threes measures a game nobody plays — only three of the six enter. So once
 * the roster can field a line, the candidate is scored on the matrix game
 * `analyseShow6` scores a finished six on: against each sampled opposing six,
 * you play whichever of your lines best survives their best answer.
 *
 * It differs from `analyseShow6` in one deliberate way. That function picks a
 * single line and asks what it guarantees across the entire field, which is the
 * right question for "what is my strongest line". Here the max sits inside the
 * mean over opponents, because you re-pick against each opponent you meet — and
 * that is the whole reason to bring six. Under the stricter reading the sixth
 * member is worth nothing whenever the existing five already hold one good
 * line, which is precisely when the question gets asked.
 *
 * Two cheaper scorings were measured and rejected. Playing the roster's best
 * line against *unanswered* sampled threes saturates: with five members you
 * have a winning answer to 100% of them, and all 30 candidates tie. Counting
 * the share of opposing sixes held to a positive floor is too coarse at this
 * field size — three distinct values across 30 candidates. The mean floor
 * separates 93 of 97.
 */
export function suggestCompletions(
  partial: string[],
  lg: LeagueId,
  targetSize: number,
  opts: { count?: number; limit?: number; builds?: Record<string, MonBuild> } = {},
): Suggestion[] {
  const limit = opts.limit ?? 12;
  const { pool } = completionPool(partial, lg, targetSize);
  // A roster of fewer than three cannot field a line, so there is no matrix
  // game to play yet and the chain is the only thing left to measure.
  const asSix = targetSize === 6 && partial.length >= 2;
  const score = asSix
    ? sixScorer(lg, opts.count ?? 8, opts.builds)
    : chainScorer(lg, opts.count ?? 90, opts.builds);

  const scored = pool.map((ref) => ({ ref, value: score([...partial, ref]) }));
  const sorted = scored.map((s) => s.value).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  // What the pick actually shores up, so the list says why rather than only
  // how much. A weakness the existing team already answers is not a reason.
  const open = new Set(
    partial.flatMap((p) => weaknessesOf(speciesOf(p)?.types ?? []))
      .filter((w) => !partial.some((p) => resistancesOf(speciesOf(p)?.types ?? []).includes(w))),
  );
  const out: Suggestion[] = scored.map((s) => ({
    ...s,
    metric: asSix ? 'floor' : 'winRate',
    gain: s.value - median,
    covers: resistancesOf(speciesOf(s.ref)?.types ?? []).filter((r) => open.has(r)),
  }));
  out.sort((a, b) => b.value - a.value);
  return out.slice(0, limit);
}

/**
 * Share of a sampled field of threes that this roster, played as a chain, beats.
 *
 * Threes whatever the target size, because three is what enters. Sampling
 * *sixes* for the six's one-member fallback scored every candidate at exactly
 * zero — a two-Pokemon chain never beats six — which is a column of noughts
 * rather than a ranking.
 */
function chainScorer(
  lg: LeagueId,
  count: number,
  builds?: Record<string, MonBuild>,
): (roster: string[]) => number {
  const field = sampleFieldTeams(lg, 3, count);
  return (roster) => {
    const mine = roster.map((r) => monFor(r, lg, builds?.[r]));
    let wins = 0;
    for (const foes of field) if (teamBattle(mine, foes.map((r) => monFor(r, lg))).win) wins++;
    return wins / field.length;
  };
}

/**
 * Mean guaranteed value of a Show 6 roster, re-picking against each opponent.
 *
 * Affordable only because a line's floors depend on the line and the field, not
 * on which roster contains it: the lines the existing members already form are
 * simulated once and reused by every candidate, so a pool of 30 costs 310
 * distinct lines rather than 30 x 20.
 *
 * Measured 165ms at two members to 1.9s at five in Ultra, where nothing is
 * filtered out and 95 candidates each contribute ten new lines. That is the
 * same order as the Analyse button beside it, which is the bar: both are a
 * click that says "Simulating…".
 */
function sixScorer(
  lg: LeagueId,
  count: number,
  builds?: Record<string, MonBuild>,
): (roster: string[]) => number {
  const field = sampleFieldTeams(lg, 6, count);
  // The opponent's twenty answers per six, built once. Their side runs its
  // rated loadout, for the reason the rankings sweep only your own: letting
  // sets nobody plays vote makes the number describe a game nobody is playing.
  const answers = field.map((six) => subteams(six, 3).map((a) => a.map((r) => monFor(r, lg))));
  const cache = new Map<string, Float64Array>();
  const floorsFor = (line: string[]) => {
    const key = [...line].sort().join('|');
    const hit = cache.get(key);
    if (hit) return hit;
    const mine = line.map((r) => monFor(r, lg, builds?.[r]));
    const floors = new Float64Array(field.length);
    for (let i = 0; i < answers.length; i++) {
      let worst = Infinity;
      for (const answer of answers[i]) {
        const r = teamBattle(mine, answer);
        const v = r.hpFracA - r.hpFracB;
        if (v < worst) worst = v;
      }
      floors[i] = worst;
    }
    cache.set(key, floors);
    return floors;
  };

  return (roster) => {
    const lines = subteams(roster, 3).map(floorsFor);
    let total = 0;
    for (let i = 0; i < field.length; i++) {
      let best = -Infinity;
      for (const floors of lines) if (floors[i] > best) best = floors[i];
      total += best;
    }
    return field.length ? total / field.length : 0;
  };
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
  /**
   * What the six is actually weak to, worst first.
   *
   * Not the Pokemon present when the matrix game was lost, which is what this
   * used to report and what made the exported table useless: against a six
   * whose floor is negative, *every* opponent appears in some winning answer,
   * so all twenty rows read 100% and the list ranked nothing. Measured
   * one-on-one against each member instead — the share of your roster a
   * Pokemon beats is a property of your roster, and it is the thing a swap can
   * change.
   */
  weakTo: Weakness[];
}

/** An opponent measured against every member of the roster, one-on-one. */
export interface Weakness {
  ref: string;
  /** Share of the roster that loses to it, 0..1. 1 means nothing answers it. */
  beatShare: number;
  /**
   * Margin of the roster's best answer — HP kept less HP taken, so 0.42 is a
   * comfortable win and a negative value means there is no answer at all, only
   * a least-bad loss.
   */
  bestMargin: number;
  /** Members that beat it. */
  answered: string[];
  /** Members that lose to it. */
  lost: string[];
}

/** One member out, one candidate in, and what the exchange buys. */
export interface SixSwap {
  /** The member to drop. */
  out: string;
  /** The candidate to bring. */
  in: string;
  /**
   * Weighted threat coverage gained, on the same 0..1 scale as `lossRate`.
   *
   * Coverage is the sum of each threat's loss rate over the threats *someone*
   * on the roster beats. The gain is that sum after the exchange minus before
   * it, so a candidate that answers three flagged threats but loses the only
   * answer to a worse one scores negative and is never suggested.
   */
  gain: number;
  /** Threats the roster could not answer before, and can after. */
  covers: string[];
  /** Threats only the departing member answered — the price of the swap. */
  costs: string[];
  /**
   * How many of the flagged threats the incoming pick beats outright.
   *
   * The gain counts only what the roster could not already answer, so several
   * candidates routinely tie on it — filling the same single hole. This breaks
   * that tie towards the pick that also holds the rest of the list, rather
   * than a specialist that happens to answer one thing.
   */
  answers: number;
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

  // The pool the field was drawn from is the field: an opponent nobody brings
  // is not a weakness worth a slot. Ranked by how much of your roster it beats
  // and how thin your best answer is.
  const weakTo = weaknessesAgainst(six, lg, { limit: 20, builds: opts.builds });

  // A six short of three members yields no lines at all, leaving the floor at
  // -Infinity and rendering as such. Report zero rather than a sentinel.
  return {
    floor: Number.isFinite(bestFloor) ? bestFloor : 0,
    naive: myLines.length ? naiveTotal / myLines.length : 0,
    bestLine,
    weakTo,
  };
}

/**
 * What a roster is weak to, one opponent at a time.
 *
 * Every Pokemon in the league's pool is played against every member, alone.
 * That is the measurement a swap can act on: "five of your six lose to
 * Mandibuzz" names a hole, where "Mandibuzz was on the field when you lost"
 * names a coincidence.
 *
 * Sorted by how much of the roster falls to it, then by how thin the best
 * answer is — so an opponent nothing beats leads the list, and below that come
 * the ones held by a single member scraping through.
 *
 * Cost is one battle per pool entry per member: a 300-strong Great pool
 * against a six is 1800 battles, ~40ms, against the 16,000 team battles the
 * matrix game beside it already spends.
 */
export function weaknessesAgainst(
  team: string[],
  lg: LeagueId,
  opts: { limit?: number; builds?: Record<string, MonBuild> } = {},
): Weakness[] {
  if (team.length === 0) return [];
  const limit = opts.limit ?? 20;
  const mine = team.map((r) => ({ ref: r, mon: monFor(r, lg, opts.builds?.[r]) }));
  const rows: Weakness[] = [];
  for (const foeRef of teamPool(lg)) {
    if (team.some((r) => r === foeRef || conflictsOnTeam(r, foeRef))) continue;
    const foe = monFor(foeRef, lg);
    const answered: string[] = [];
    const lost: string[] = [];
    let bestMargin = -Infinity;
    for (const m of mine) {
      const v = answersAt(m.mon, foe);
      if (v.margin > bestMargin) bestMargin = v.margin;
      (v.answers ? answered : lost).push(m.ref);
    }
    rows.push({ ref: foeRef, beatShare: lost.length / mine.length, bestMargin, answered, lost });
  }
  return rows
    .filter((w) => w.lost.length > 0)
    .sort((a, b) => b.beatShare - a.beatShare || a.bestMargin - b.bestMargin)
    .slice(0, limit);
}

/**
 * Does this Pokemon answer that one — at every shield count, not one of them.
 *
 * A single battle at the default shields is not how a matchup is read: shields
 * decide a great many of them, and a mon that wins only when the opponent has
 * none is not an answer to it. Measured across the even counts — 0-0, 1-1, 2-2
 * — and counted as an answer on two of three, which is the same "wins the
 * matchup" a player means.
 *
 * The first pass here used one no-shield battle and reported that every one of
 * twenty opponents beat every member of a perfectly ordinary Great core. Three
 * battles instead of one is the difference between a list that ranks and a
 * list that says everything is on fire.
 */
function answersAt(mine: BattleMon, foe: BattleMon): { answers: boolean; margin: number } {
  let wins = 0;
  let margin = 0;
  for (const shields of [0, 1, 2]) {
    const r = teamBattle([mine], [foe], { shields });
    if (r.win) wins++;
    margin += r.hpFracA - r.hpFracB;
  }
  return { answers: wins >= 2, margin: margin / 3 };
}

/**
 * Swaps that would answer more of what beats you.
 *
 * The threats are already known by the time this runs — `analyseShow6` names
 * them — so the question is narrow enough to answer cheaply and exactly:
 * whether a candidate beats each of those specific Pokemon one-on-one. That is
 * one battle per candidate per threat, and the results are a table the swap
 * scoring then reads rather than re-simulates.
 *
 * Why coverage rather than re-running the matrix game per candidate: the six's
 * floor is a maximin over 20 lines against a sampled field, and re-scoring it
 * for every legal candidate is minutes, not milliseconds. Coverage answers the
 * question actually being asked — "what beats this team, and who fixes that" —
 * and its unit is the same loss rate the threat list is sorted by.
 *
 * The exchange is scored whole. A candidate is credited for the threats it
 * newly answers and charged for any the departing member alone was holding, so
 * a specialist that trades one hole for another nets nothing and does not
 * appear.
 */
export function suggestSwaps(
  six: string[],
  threats: readonly Weakness[],
  lg: LeagueId,
  opts: { limit?: number; builds?: Record<string, MonBuild> } = {},
): SixSwap[] {
  const limit = opts.limit ?? 8;
  if (six.length < 2 || threats.length === 0) return [];

  // Who currently answers what, keyed by threat.
  const answeredBy = new Map<string, Set<string>>(
    threats.map((t) => [t.ref, new Set(t.answered)]),
  );
  // Weighted by how much of the roster the threat beats, so filling a hole
  // nothing answers counts for more than adding a second answer to something
  // half the team already handles.
  const weight = new Map(threats.map((t) => [t.ref, t.beatShare]));
  const covered = (holders: (ref: string) => boolean) =>
    threats.reduce((sum, t) => sum + (holders(t.ref) ? weight.get(t.ref)! : 0), 0);

  const beats = new Map<string, boolean>();
  const candidateBeats = (cand: string, threatRef: string) => {
    // A mirror is not an answer to itself: without this a candidate is
    // credited for "covering" the very Pokemon it is, since the two sides of
    // an identical matchup are decided by a tie-break.
    if (cand === threatRef || conflictsOnTeam(cand, threatRef)) return false;
    const k = `${cand}>${threatRef}`;
    const hit = beats.get(k);
    if (hit !== undefined) return hit;
    const won = answersAt(monFor(cand, lg), monFor(threatRef, lg)).answers;
    beats.set(k, won);
    return won;
  };

  const out: SixSwap[] = [];
  for (const dropped of six) {
    const rest = six.filter((r) => r !== dropped);
    // Same legality the completion picker applies: no duplicate species, and
    // no typing the roster cannot afford to repeat.
    const { pool } = completionPool(rest, lg, 6);
    const restAnswers = (threatRef: string) =>
      rest.some((r) => answeredBy.get(threatRef)?.has(r));
    const before = covered((t) => !!answeredBy.get(t)?.size);
    // What the departing member alone was holding — the price, whoever comes in.
    const orphaned = threats.filter((t) => t.answered.length > 0 && !restAnswers(t.ref)).map((t) => t.ref);

    for (const cand of pool) {
      const after = covered((t) => restAnswers(t) || candidateBeats(cand, t));
      const gain = after - before;
      if (gain <= 0) continue;
      out.push({
        out: dropped,
        in: cand,
        gain,
        covers: threats
          .filter((t) => !answeredBy.get(t.ref)?.size && candidateBeats(cand, t.ref))
          .map((t) => t.ref),
        costs: orphaned.filter((ref) => !candidateBeats(cand, ref)),
        answers: threats.filter((t) => candidateBeats(cand, t.ref)).length,
      });
    }
  }

  out.sort((a, b) => b.gain - a.gain || b.answers - a.answers || a.covers.length - b.covers.length);
  // One row per departing member and one per arriving candidate. Without the
  // second, the strongest single answer in the pool fills the whole list —
  // "drop any of your six for Bellibolt" four times over is one idea, not
  // four.
  const dropped = new Set<string>();
  const brought = new Set<string>();
  return out
    .filter((s) => {
      if (dropped.has(s.out) || brought.has(s.in)) return false;
      dropped.add(s.out);
      brought.add(s.in);
      return true;
    })
    .slice(0, limit);
}
