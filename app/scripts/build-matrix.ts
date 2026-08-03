/**
 * Cross-species rankings, from every matchup in the league played out.
 *
 * Rankings, the GBL builder and the Show 6 builder are all functions of one
 * artefact: the rating each candidate earns against the field, in each
 * scenario. It is built here rather than in the browser because it is ~100M
 * battles in Great — minutes of work that would otherwise be paid on every
 * page load, to produce a number that only changes when the engine does.
 *
 * WHAT IS SWEPT, AND WHAT IS NOT
 *
 * Each species is simulated at every plausible loadout it can run. Its
 * opponents are not: they run the set their league rates. That is deliberate
 * and not a shortcut for cost. Sweeping both sides asks "how do I fare against
 * Azumarill running Rock Smash and Hydro Pump", and letting sets nobody plays
 * vote in the average makes the ranking describe a game that is not being
 * played. It is also 6.56 billion battles in Great, against 244 million.
 *
 * The team builders are where off-meta sets genuinely matter — a high-level
 * opponent does bring the spice to catch you — and there the pool is 100, so
 * both sides are swept. See buildTeamMatrix.
 *
 * The engine is a moving target: the 2026 PvP rewrite lands after the world
 * championship. Output records ENGINE_REV so a stale artefact is obvious
 * rather than quietly wrong.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { cpus } from 'node:os';
import {
  opponentCandidatesFor,
  speciesOf,
  parseRef,
  displayName,
  movesFor,
  LEAGUES,
} from '../src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../src/lib/engine';
import {
  SCENARIOS,
  SCENARIO_IDS,
  CATEGORIES,
  makeOverall,
  rating,
  startingEnergy,
  weightedScore,
  consistencyScore,
  type ScenarioId,
} from '../src/lib/scenarios';
import type { BattleMon, ChargeMove, FastMove, LeagueId, ShieldPolicy, Species } from '../src/lib/types';

const OUT = resolve(process.cwd(), 'src/data');
const SRC = resolve(process.cwd(), '..', 'data-src');

/**
 * Bump when an engine change would move these numbers.
 *   1  first cut, 7 scenarios, always-shield
 *   2  per-league loadouts, moveset sweep, meta tiers
 *   3  full 9-state shield lattice + both shield policies
 *   4  optimal move timing, second-derivative pass
 *   5  second derivative at every tier, 500 tier added
 *   6  win-weighted rating, energy kept scores alongside HP kept
 *   7  bait no longer loops forever against a defender that declines it
 *   8  PvPoke's rating mechanics: shield pressure, blowout soft cap, loss
 *      curve, and Overall as a weighted geometric mean of the role scores
 *   9  role scores normalised per category before the Overall composite, as
 *      their Ranker.js does; composing raw ratings had let unevolved forms
 *      back into the graded pass
 *  10  residual-energy debt: a surviving opponent's banked energy is a charged
 *      move your next Pokemon walks into, and is now priced like a shield
 *  11  farm-downs: a mon that can finish the job on fast moves alone holds its
 *      energy instead of spending it on a kill it already had, and the bar it
 *      carries out of a win is credited the way a kept shield is
 *  12  attack/defence stat stages: ~90 charged moves raise or lower a stat on
 *      use, and every damage figure, the CMP tiebreak and the farm-down test
 *      now follow them. 104 of the top 200 in Great run one at their rated set
 *  13  two missing PvP mechanics (see BACKLOG §1k): the Trainer Battle x1.3
 *      damage bonus, absent entirely so every hit was ~23% low, and the
 *      guaranteed sneak — a charged throw without priority always concedes the
 *      opponent's next fast move, which we allowed only when its animation
 *      happened to land on that turn. Both favoured grind over burst.
 *      Also: opponent weighting by log of rank rather than normalised score,
 *      the turn penalty and baitSwing dropped from consistency, and the
 *      attackers category reweighted off the rare sh02 state.
 */
const ENGINE_REV = 13;

/**
 * Loadouts considered per species.
 *
 * The full movepool is not a candidate list: Mew alone can field 14 fast moves
 * against 300 charged pairs, 4200 sets, nearly all of them unplayed. The cap
 * is drawn from PvPoke's per-league usage counts, so what survives is what
 * people actually run, and the league's own recommended set is always kept
 * whether or not usage would have selected it.
 */
const FAST_K = 3;
const CHARGE_K = 4;
const MOVESETS_MAX = 12;

/** Rounds of opponent re-weighting when seeding the order. */
const WEIGHT_ROUNDS = 4;

/**
 * Opponent pools the rankings are computed against, as "top N by Overall".
 *
 * One ranking over the whole pool answers "how does this do against every
 * released form", which is not a question anyone has: several hundred of the
 * 1140 in Great are unevolved, unranked or simply outclassed, and beating them
 * says nothing. Restricting the opponent set asks the question people mean,
 * and the answer genuinely differs by N — a mon can farm the mid-field while
 * folding to the top 20. 0 means the whole pool.
 */
const TIERS = [50, 100, 200, 300, 500, 0] as const;
const tierLabel = (n: number) => (n === 0 ? 'all' : String(n));

/** Which tier the UI opens on, and which orders the shipped matrix. */
const DEFAULT_TIER = 100;

/** Team-builder pool size. Beyond this a builder is offering noise. */
const TEAM_POOL_N = 100;

const S = SCENARIOS.length;

/** Position of Overall within CATEGORIES, which score arrays are ordered by. */
const OVERALL = CATEGORIES.findIndex((c) => c.id === 'overall');

/**
 * Both shield policies, simulated for every matchup.
 *
 * You do not get to choose how your opponent plays, so a single number has to
 * account for both. `always` shields whatever comes first, which makes baiting
 * free; `read` eats the bait and saves the shield for the hardest hit, which
 * makes baiting a gamble. 11.4% of matchups flip outright between them, and
 * ~19% of those with a full shield budget — far too many to pick one and call
 * it the answer.
 *
 * Headline scores average the two. The gap between them is itself a signal,
 * and feeds the reliability penalty in consistencyScore: a mon whose record
 * depends on the opponent misplaying is not one to invest in.
 */
const POLICIES: readonly ShieldPolicy[] = ['always', 'read'];

/**
 * Play the charged-move timing properly.
 *
 * This was off, and the only reason was comparability with PvPoke's published
 * ratings — they throw the moment a move is available and say themselves that
 * it is not optimal. Since those numbers are a reference here rather than a
 * target, simulating deliberately worse play than a competent human buys
 * nothing. The engine still abandons the hold when the move kills, when the
 * mon is about to faint, when the opponent is holding one too, when energy
 * would overflow, or when the alignment window can never arrive.
 */
const OPTIMAL_TIMING = true;

/**
 * Second-order weighting.
 *
 * The first pass answers "how does this do against the top N" with every
 * opponent inside the cutoff counting equally — beating rank 98 is worth as
 * much as beating rank 2. The second pass keeps the cutoff but grades the
 * inside of it, weighting each opponent by the first pass's own Overall, so
 * what a mon beats matters as much as how many. Both sides are restricted to
 * their rated loadout, which makes it a measure of the matchup rather than of
 * the movepool.
 *
 * Run at every tier, because the cutoff and the weighting answer different
 * questions and compose: "top 50, graded" is the sharp read of the format's
 * head, "all, graded" is the whole roster with the tail fading out on its own
 * rather than being chopped.
 *
 * Costs no simulation at any tier: same matrix, different weights.
 *
 * ── Weighted by log of RANK, not by score ────────────────────────────────
 * This used to be `((o - min) / span) ** 3` — the first-pass Overall
 * normalised against the field's worst, then cubed. It looked concentrated and
 * measured almost flat, because scores are compressed and the floor is set by
 * the very bottom of the roster. Unown at 166 anchored the span, which put
 * rank 100 at 82% of the way up it; cubing 0.82 is still 0.55.
 *
 * What that produced, in Great:
 *
 *   rank 50 carried 63% of rank 1's weight, rank 200 carried 46%,
 *   and the bottom HALF of the roster held 22% of all weight —
 *   nearly twice what the top 50 held (11.6%).
 *
 * So beating the 200th-best Pokemon counted almost half as much as beating the
 * best one, and the tail collectively outvoted the head. That is not a graded
 * pass, it is an average wearing one.
 *
 * Rank is the honest axis: it is what "top meta" means, and it does not care
 * how compressed the score scale happens to be. `1 - ln(rank)/ln(N)` squared
 * gives rank 1 the full weight, rank 10 about 45%, rank 100 about 12%, rank
 * 500 about 1%, and the last-ranked Pokemon exactly zero. Top 50 now hold
 * 38.7% and the bottom half 3.4% — beating Unown moves the needle by an
 * epsilon, which is the whole point.
 */
const D2_RANK_POWER = 2;

// ── Moveset enumeration ─────────────────────────────────────────────────────

export interface Loadout {
  fast: FastMove;
  charges: ChargeMove[];
  /** True for the set this league rates, which the UI marks as recommended. */
  recommended: boolean;
}

type Usage = Map<string, { fast: Map<string, number>; charge: Map<string, number> }>;

function loadUsage(lg: LeagueId): Usage {
  const file = { great: 'rankings-1500.json', ultra: 'rankings-2500.json', master: 'rankings-10000.json' }[lg];
  const raw = JSON.parse(readFileSync(join(SRC, file), 'utf8')) as {
    speciesId: string;
    moves?: { fastMoves?: { moveId: string; uses: number }[]; chargedMoves?: { moveId: string; uses: number }[] };
  }[];
  return new Map(
    raw.map((e) => [
      e.speciesId,
      {
        fast: new Map((e.moves?.fastMoves ?? []).map((m) => [m.moveId, m.uses])),
        charge: new Map((e.moves?.chargedMoves ?? []).map((m) => [m.moveId, m.uses])),
      },
    ]),
  );
}

/**
 * Plausible loadouts for one species in one league, most-played first.
 *
 * Candidates are the top FAST_K fast moves and every pair drawn from the top
 * CHARGE_K charged moves, ranked by combined usage and truncated to
 * MOVESETS_MAX. Single-charge sets are included only when a species has just
 * one charged move; PvPoke's own recommendations are always two where two
 * exist, and a deliberately empty second slot is a different strategy question
 * than this ranking is asking.
 */
function loadoutsFor(sp: Species, lg: LeagueId, usage: Usage): Loadout[] {
  const u = usage.get(sp.id);
  const uf = (m: FastMove) => u?.fast.get(m.id.split('|')[0]) ?? 0;
  const uc = (m: ChargeMove) => u?.charge.get(m.id.split('|')[0]) ?? 0;

  const rec = movesFor(sp, lg);
  const fasts = [...sp.fastMoves].sort((a, b) => uf(b) - uf(a)).slice(0, FAST_K);
  const charges = [...sp.chargeMoves].sort((a, b) => uc(b) - uc(a)).slice(0, CHARGE_K);
  if (!fasts.some((f) => f.id === rec.fast.id)) fasts.push(rec.fast);
  for (const c of rec.charges) if (!charges.some((x) => x.id === c.id)) charges.push(c);

  const out: Loadout[] = [];
  const seen = new Set<string>();
  const push = (fast: FastMove, cs: ChargeMove[], recommended: boolean) => {
    const key = `${fast.id}|${cs.map((c) => c.id).sort().join('+')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fast, charges: cs, recommended });
  };

  // The rated set leads, so index 0 is always the one people expect.
  push(rec.fast, rec.charges, true);

  const combos: { fast: FastMove; charges: ChargeMove[]; w: number }[] = [];
  for (const f of fasts) {
    if (charges.length === 1) {
      combos.push({ fast: f, charges: [charges[0]], w: uf(f) + uc(charges[0]) });
      continue;
    }
    for (let i = 0; i < charges.length; i++)
      for (let j = i + 1; j < charges.length; j++)
        combos.push({ fast: f, charges: [charges[i], charges[j]], w: uf(f) + uc(charges[i]) + uc(charges[j]) });
  }
  combos.sort((a, b) => b.w - a.w);
  for (const c of combos) {
    if (out.length >= MOVESETS_MAX) break;
    push(c.fast, c.charges, false);
  }
  return out;
}

// ── Pool construction ───────────────────────────────────────────────────────

interface Variant {
  ref: string;
  /** Index into the species' own loadout list. */
  set: number;
  recommended: boolean;
  mon: BattleMon;
  fastTurns: number;
  label: string;
}

function buildPool(lg: LeagueId): { variants: Variant[]; foes: BattleMon[]; refs: string[] } {
  const usage = loadUsage(lg);
  const refs = opponentCandidatesFor(lg);
  const variants: Variant[] = [];
  const foes: BattleMon[] = [];

  for (const ref of refs) {
    const sp = speciesOf(ref)!;
    // Priced exactly as the rest of the app prices an opponent: the rank-1
    // roll at the Best Buddy ceiling, Shadow multipliers already applied.
    const best = bestSpreadFor(ref, lg, true);
    const sets = loadoutsFor(sp, lg, usage);
    sets.forEach((l, i) => {
      variants.push({
        ref,
        set: i,
        recommended: l.recommended,
        mon: mkBattleMon(best, l.fast, l.charges, sp.types),
        fastTurns: l.fast.turns,
        label: `${l.fast.name} · ${l.charges.map((c) => c.name).join(' / ')}`,
      });
    });
    const rec = movesFor(sp, lg);
    foes.push(mkBattleMon(best, rec.fast, rec.charges, sp.types));
  }
  return { variants, foes, refs };
}

// ── The sweep ───────────────────────────────────────────────────────────────

/**
 * Rate every variant against every foe, in every scenario, into `out`.
 *
 * Ratings are stored as a byte: 0–1000 scaled to 0–255 costs ±2 points, far
 * inside the noise of any decision made downstream, and halves a buffer that
 * reaches 109M cells in Great.
 */
function sweep(variants: Variant[], foes: BattleMon[], out: Uint8Array, from: number, to: number) {
  const foeEnergy = foes.map((f) => SCENARIOS.map((s) => startingEnergy(f, s.bankedB)));
  const nF = foes.length;
  for (let i = from; i < to; i++) {
    const me = variants[i].mon;
    const myEnergy = SCENARIOS.map((s) => startingEnergy(me, s.bankedA));
    for (let j = 0; j < nF; j++) {
      for (let s = 0; s < S; s++) {
        const sc = SCENARIOS[s];
        for (let p = 0; p < POLICIES.length; p++) {
          const pol = POLICIES[p];
          const r = battle(
            me, foes[j], sc.shieldsA, sc.shieldsB, myEnergy[s], foeEnergy[j][s],
            false, OPTIMAL_TIMING, undefined, undefined, pol, pol,
          );
          out[((i * nF + j) * S + s) * POLICIES.length + p] =
            Math.round((rating(r, sc.shieldsA, sc.shieldsB) / 1000) * 255);
        }
      }
    }
  }
}

// ── Worker plumbing ─────────────────────────────────────────────────────────

interface Job { league: LeagueId; from: number; to: number; buffer: SharedArrayBuffer }

if (!isMainThread) {
  const { league, from, to, buffer } = workerData as Job;
  const { variants, foes } = buildPool(league);
  sweep(variants, foes, new Uint8Array(buffer), from, to);
  parentPort!.postMessage('done');
}

async function sweepParallel(lg: LeagueId, variants: Variant[], foes: BattleMon[]): Promise<Uint8Array> {
  const cells = variants.length * foes.length * S * POLICIES.length;
  const buffer = new SharedArrayBuffer(cells);
  const view = new Uint8Array(buffer);
  const workers = Math.max(1, Math.min(cpus().length - 1, 8));
  if (workers === 1) {
    sweep(variants, foes, view, 0, variants.length);
    return view;
  }
  const chunk = Math.ceil(variants.length / workers);
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const from = w * chunk;
      const to = Math.min(variants.length, from + chunk);
      if (from >= to) return Promise.resolve();
      return new Promise<void>((res, rej) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: { league: lg, from, to, buffer } satisfies Job,
        });
        worker.on('message', () => res());
        worker.on('error', rej);
      });
    }),
  );
  return view;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

const decode = (b: number) => (b / 255) * 1000;

/** Mean rating per scenario for every variant, against a weighted foe set. */
/**
 * @param policy index into POLICIES, or -1 to average across them.
 */
function scoreAgainst(
  variants: Variant[],
  nF: number,
  matrix: Uint8Array,
  weights: Float64Array,
  selfIdx: Int32Array,
  policy: number,
): Record<ScenarioId, number>[] {
  const P = POLICIES.length;
  const rows: Record<ScenarioId, number>[] = [];
  for (let i = 0; i < variants.length; i++) {
    const acc = new Float64Array(S);
    let wsum = 0;
    const skip = selfIdx[i];
    for (let j = 0; j < nF; j++) {
      if (j === skip) continue;
      const w = weights[j];
      if (w === 0) continue;
      const base = (i * nF + j) * S;
      for (let s = 0; s < S; s++) {
        const cell = (base + s) * P;
        if (policy >= 0) acc[s] += decode(matrix[cell + policy]) * w;
        else {
          let sum = 0;
          for (let p = 0; p < P; p++) sum += decode(matrix[cell + p]);
          acc[s] += (sum / P) * w;
        }
      }
      wsum += w;
    }
    const row = {} as Record<ScenarioId, number>;
    SCENARIO_IDS.forEach((id, s) => {
      row[id] = wsum === 0 ? 0 : acc[s] / wsum;
    });
    rows.push(row);
  }
  return rows;
}

/** Best Overall any loadout of each ref achieves, given per-variant rows. */
function perRefBest(variants: Variant[], rows: Record<ScenarioId, number>[], refIdx: Int32Array, nRefs: number) {
  const best = new Float64Array(nRefs).fill(-Infinity);
  const bestVariant = new Int32Array(nRefs).fill(-1);
  // Overall is normalised against this row set's own maxima, so it has to be
  // built per call — the maxima differ between tiers and between passes.
  const overallOf = makeOverall(rows, variants.map((v) => v.fastTurns));
  for (let i = 0; i < variants.length; i++) {
    const o = overallOf(i);
    if (o > best[refIdx[i]]) {
      best[refIdx[i]] = o;
      bestVariant[refIdx[i]] = i;
    }
  }
  return { best, bestVariant };
}

function loadReference(lg: LeagueId) {
  const file = { great: 'rankings-1500.json', ultra: 'rankings-2500.json', master: 'rankings-10000.json' }[lg];
  const raw = JSON.parse(readFileSync(join(SRC, file), 'utf8')) as {
    speciesId: string;
    score: number;
    scores?: number[];
  }[];
  return new Map(raw.map((e) => [e.speciesId, { score: e.score, scores: e.scores ?? [] }]));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const rankings: Record<string, unknown> = {};
  const matrices: Record<string, unknown> = {};

  for (const league of LEAGUES) {
    const lg = league.id;
    const t0 = performance.now();
    const { variants, foes, refs } = buildPool(lg);
    const nF = foes.length;

    const refPos = new Map(refs.map((r, i) => [r, i]));
    const refIdx = Int32Array.from(variants.map((v) => refPos.get(v.ref)!));
    // A variant must not be scored against its own species: it would be
    // playing a mirror it is guaranteed to draw or win by CMP, which flatters
    // whatever is currently top of the pool.
    const selfIdx = refIdx;

    const matrix = await sweepParallel(lg, variants, foes);
    const tSim = performance.now();

    // Seed an order by re-weighting foes by their own strength until it settles.
    let weights = new Float64Array(nF).fill(1);
    let rows: Record<ScenarioId, number>[] = [];
    for (let round = 0; round < WEIGHT_ROUNDS; round++) {
      rows = scoreAgainst(variants, nF, matrix, weights, selfIdx, -1);
      const { best } = perRefBest(variants, rows, refIdx, nF);
      const max = Math.max(...best);
      const min = Math.min(...best);
      const span = max - min || 1;
      weights = new Float64Array(Array.from(best, (o) => ((o - min) / span) ** 2));
    }
    const seeded = perRefBest(variants, rows, refIdx, nF);
    const order = Array.from({ length: nF }, (_, i) => i).sort((a, b) => seeded.best[b] - seeded.best[a]);

    // Each tier is a flat average over the top N of that seeded order.
    const tierRows: Record<string, Record<ScenarioId, number>[]> = {};
    for (const t of TIERS) {
      const w = new Float64Array(nF);
      const keep = t === 0 ? order : order.slice(0, Math.min(t, nF));
      for (const j of keep) w[j] = 1;
      tierRows[tierLabel(t)] = scoreAgainst(variants, nF, matrix, w, selfIdx, -1);
    }

    // ── Second derivative ───────────────────────────────────────────────────
    // The first pass is now fixed. Feed its Overall back as the opponent
    // weight, so beating the head of the format counts for more than beating
    // its shoulder, and read only the rated loadout on both sides. Run at
    // every tier: the cutoff picks who is in the room, the weighting grades
    // them once they are. Same matrix, so this costs aggregations, no battles.
    const d1 = perRefBest(variants, tierRows[tierLabel(DEFAULT_TIER)], refIdx, nF).best;
    // Rank each opponent by its first-pass Overall, then weight by log of that
    // rank. See the note on D2_RANK_POWER for why rank rather than score.
    const byScore = Array.from(d1, (_, i) => i).sort((x, y) => d1[y] - d1[x]);
    const rankOf = new Float64Array(nF);
    byScore.forEach((idx, r) => { rankOf[idx] = r + 1; });
    const lnN = Math.log(Math.max(2, nF));
    const graded = Array.from(d1, (_, i) =>
      Math.pow(Math.max(0, 1 - Math.log(rankOf[i]) / lnN), D2_RANK_POWER));
    const d2TierRows: Record<string, Record<ScenarioId, number>[]> = {};
    for (const t of TIERS) {
      const w = new Float64Array(nF);
      const keep = t === 0 ? order : order.slice(0, Math.min(t, nF));
      for (const j of keep) w[j] = graded[j];
      d2TierRows[tierLabel(t)] = scoreAgainst(variants, nF, matrix, w, selfIdx, -1);
    }

    const ref = loadReference(lg);
    const byRef = new Map<string, number[]>();
    variants.forEach((v, i) => {
      const list = byRef.get(v.ref);
      if (list) list.push(i);
      else byRef.set(v.ref, [i]);
    });

    // Scores go out as a bare array in CATEGORIES order, not an object. Keyed
    // objects repeated the seven category names ten times per species and blew
    // rankings.json out to 4.9MB — the keys outweighed the numbers roughly two
    // to one. The reader zips them back against CATEGORIES.
    // Overall is no longer a scenario weighting — it is a geometric mean over
    // this species' own role scores after each is normalised against the pool's
    // best in that category. See makeOverall.
    const turnsOf = variants.map((v) => v.fastTurns);
    const overallFor = new Map<Record<ScenarioId, number>[], (i: number) => number>();
    const overallIn = (rws: Record<ScenarioId, number>[]) => {
      let f = overallFor.get(rws);
      if (!f) { f = makeOverall(rws, turnsOf); overallFor.set(rws, f); }
      return f;
    };
    const scoresOf = (rws: Record<ScenarioId, number>[], i: number) =>
      CATEGORIES.map((c) =>
        c.id === 'overall' ? overallIn(rws)(i)
          : c.id === 'consistency' ? consistencyScore(rws[i], turnsOf[i])
          : weightedScore(rws[i], c.weights),
      );

    const entries = refs.map((r) => {
      const mine = byRef.get(r)!;
      const tiers: Record<string, { rec: number[]; best: number[]; set: number }> = {};
      for (const t of TIERS) {
        const key = tierLabel(t);
        const rws = tierRows[key];
        // Two answers, deliberately kept apart.
        //
        // `rec` is the league's rated set — one fixed loadout for everyone, so
        // the column is comparable across species. `best` is the strongest of
        // the swept sets, which answers "what should I put on this mon" but is
        // NOT a fair ranking basis: taking a maximum over 12 draws flatters
        // whoever has the widest movepool, and the score it produces correlates
        // 0.32 with moveset count alone. Ranking on `rec` and offering `best`
        // as its own view keeps both honest.
        const recIdx = mine.find((i) => variants[i].recommended) ?? mine[0];
        let bi = mine[0];
        let bo = -Infinity;
        const ovIn = overallIn(rws);
        for (const i of mine) {
          const o = ovIn(i);
          if (o > bo) { bo = o; bi = i; }
        }
        tiers[key] = {
          rec: scoresOf(rws, recIdx),
          best: scoresOf(rws, bi),
          set: variants[bi].set,
        };
      }
      const { id, shadow } = parseRef(r);
      const pv = shadow ? undefined : ref.get(id);
      const dRows = tierRows[tierLabel(DEFAULT_TIER)];
      const recIdx = mine.find((i) => variants[i].recommended) ?? mine[0];
      // Second derivative, per tier: rated loadout only, opponents inside the
      // cutoff weighted by their first-pass Overall rather than counted flat.
      const d2: Record<string, number[]> = {};
      for (const t of TIERS)
        d2[tierLabel(t)] = scoresOf(d2TierRows[tierLabel(t)], recIdx);
      return {
        ref: r,
        name: displayName(r),
        d2,
        // [label, overall-at-default-tier]. Index 0 is the league's rated set
        // by construction (loadoutsFor pushes it first), so `recommended` does
        // not need storing 28,000 times.
        loadouts: mine.map((i) => [variants[i].label, overallIn(dRows)(i)]),
        tiers,
        pvpoke: pv ? { score: pv.score, scores: pv.scores } : null,
      };
    });

    const dk = tierLabel(DEFAULT_TIER);
    entries.sort((a, b) => b.tiers[dk].rec[OVERALL] - a.tiers[dk].rec[OVERALL]);

    rankings[lg] = {
      engineRev: ENGINE_REV,
      tiers: TIERS.map(tierLabel),
      defaultTier: dk,
      // The key for every `rec` / `best` array below.
      categories: CATEGORIES.map((c) => c.id),
      entries,
    };
    matrices[lg] = { engineRev: ENGINE_REV, refs: entries.slice(0, TEAM_POOL_N).map((e) => e.ref) };

    console.log(
      `${lg.padEnd(7)} ${String(refs.length).padStart(4)} refs x ${(variants.length / refs.length).toFixed(1)} sets` +
        ` = ${String(variants.length).padStart(5)} variants` +
        `  sim ${((tSim - t0) / 1000).toFixed(1).padStart(6)}s` +
        `  ${(variants.length * nF * S / 1e6).toFixed(0).padStart(4)}M battles`,
    );
    console.log(
      `        top@${dk}: ${entries.slice(0, 5).map((e) => `${e.name} ${e.tiers[dk].rec[OVERALL]}`).join(', ')}`,
    );
  }

  writeFileSync(join(OUT, 'rankings.json'), JSON.stringify(rankings));
  writeFileSync(join(OUT, 'matrix.json'), JSON.stringify(matrices));
  console.log(`\nwrote rankings.json and matrix.json (engineRev ${ENGINE_REV})`);
}

if (isMainThread) await main();
