/**
 * Best teams of 3 and best Show 6s, discovered rather than scored.
 *
 * The team builders answer "how good is this team". This answers the question
 * people actually open a builder to ask — "what should I bring" — across every
 * stratification the rankings already carry: league, opponent tier, the seven
 * categories, and both weighting passes. 252 strata, each with its own top
 * threes and its own top sixes.
 *
 * WHY THIS IS NOT A SEARCH
 *
 * The obvious shape is a search — beam, greedy, hill-climb — and every one of
 * them reports a local optimum with no way to tell how local. That is a bad
 * trade here because the objective is cheap to tabulate: what a team is worth
 * depends only on how each of its *lines* fares against each opponent line, and
 * there are far fewer distinct lines than teams. Tabulate line-vs-line once and
 * every team in the stratum is an exhaustive lookup — every legal three from
 * 24 candidate species and every legal six from 16, all of them, no beam width
 * to defend.
 *
 * LEGALITY IS A CONSTRUCTION RULE, NOT A FILTER
 *
 * GBL forbids duplicate species, by Pokedex number — so Alolan Ninetales bars
 * Kanto Ninetales, a Mega bars its base form, and a Shadow bars its plain one.
 * That is enforced while combinations are generated and while the opposing
 * field is sampled, never by filtering results afterwards: filtering the output
 * would leave the top ten short and, worse, would leave every score computed
 * against a field containing teams nobody could bring.
 *
 * Show 6 falls out of the same table. You bring six, three enter, and both
 * players choose after seeing the other six, so a six is worth
 *
 *     mean over opponent sixes S of  max over my 20 lines  min over their 20
 *
 * — a 20x20 matrix game per opponent, averaged over the field. Once the table
 * exists that is 20 x |field| lookups per six.
 *
 * WHAT IS SWEPT
 *
 * Both sides at their rated loadout, priced exactly as everything else in the
 * app prices an opponent. Unlike the rankings this does NOT sweep movesets:
 * a team is already a choice of three from a hundred, and letting each member
 * also range over twelve sets multiplies the space by 1728 to answer a question
 * nobody asked — you pick the team first and tune the moves after.
 *
 * COST
 *
 * ~10.8us per 3v3 chain, so the table is the whole budget — a few hundred
 * million chains per league, minutes on eight workers.
 *
 * There was a prefilter here: score every triple against a small field, keep
 * the best 250, re-score those against the full one. It was removed. Once the
 * candidate lists were widened to hold 24 distinct *species* the row counts
 * tripled, and against a 208-column field the two-pass funnel only saved about
 * 1.8x — while `--validate` caught it dropping 3 of Ultra's true top 12. Paying
 * 1.8x for an exhaustive answer with nothing to defend is the better trade.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { cpus } from 'node:os';
import { LEAGUES, conflictsOnTeam, movesFor, speciesOf } from '../src/lib/data';
import { monFor } from '../src/lib/teambuild';
import { teamBattle, teamRating } from '../src/lib/team';
import { battle, bestSpreadFor } from '../src/lib/engine';
import {
  ANSWER_LINE,
  WIN_LINE,
  coreStrength,
  relevanceWeights,
  rescue,
  sharedExposure,
  sharedTypePairs,
  typePressure,
  worstSharedWeakness,
  resistancesOf,
  synergyOf,
  weaknessesOf,
  type Core,
  type SoloRatings,
  type Synergy,
} from '../src/lib/synergy';
import {
  CATEGORIES,
  SCENARIOS,
  SHIELD_STATES,
  consistencyScore,
  rating,
  startingEnergy,
  weightedScore,
  type CategoryId,
  type ScenarioId,
} from '../src/lib/scenarios';
import type { BattleMon, LeagueId, ShieldPolicy } from '../src/lib/types';

const OUT = resolve(process.cwd(), 'src/data');

/**
 * Bump when a change would move these numbers. Tracked apart from the matrix's
 * ENGINE_REV because a team artefact can go stale on its own — a change to
 * teamBattle moves teams and leaves the rankings untouched.
 *   1  first cut: line-vs-line tables, 11 team scenarios, exhaustive per tier
 *   2  150 teams per stratum on a compact index wire format; shared-weakness
 *      penalty on cores; wider core evidence
 *   3  ABC rule: no two members of a three may share a typing
 */
const TEAM_REV = 3;

/**
 * Candidate *species* per stratum — distinct Pokedex numbers, not entries.
 *
 * Counted by dex because duplicates are illegal (see conflictsOnTeam). Taking
 * the top 24 rows instead would have spent 3.6 of them on average — and 8 in
 * the worst Master stratum — on a second form of a species already in the list,
 * which can never join it on a team. So the list is widened until it holds this
 * many distinct dexes, and every form of those dexes is kept: full breadth, and
 * the Shadow-versus-plain choice stays something the search actually decides
 * rather than something the candidate cut decides for it.
 */
const CAND_N = 24;
/** Same, for sixes. */
const SIX_N = 16;
/**
 * How many members may share one exploitable weakness.
 *
 * A three is what you actually field, so three-deep into Ground is not a lower
 * score, it is a lost set — one Mud Slap user ends it whatever the chain
 * average says. Two is the limit there. A six is a menu you pick three from, so
 * it can carry one more and still field a legal line.
 *
 * Enforced on every pass, not just synergy. It is a validity rule like the
 * duplicate-species one, not a preference to be traded off against win rate.
 */
const MAX_SHARED_WEAK_3 = 2;
const MAX_SHARED_WEAK_6 = 3;
/** A type must be this present in the field before a shared weakness counts. */
const MIN_TYPE_PRESSURE = 0.04;

/**
 * How many pairs may share a typing — the ABC rule.
 *
 * Zero for a three: that is the definition of an ABC line, and it is what you
 * field. A six is a menu you pick three from, so it may carry some overlap and
 * still offer a clean line; two pairs out of fifteen is the allowance.
 *
 * Enforced separately from the stacked-weakness rule because the two catch
 * different failures — see sharedTypePairs.
 */
const MAX_SHARED_TYPES_3 = 0;
const MAX_SHARED_TYPES_6 = 2;

/** Leads considered for a pillar — a lead is a centrepiece, so this stays tight. */
const PILLAR_LEAD_N = 40;
/** Back-line candidates for a pillar. Wider: support is allowed to be niche. */
const PILLAR_BACK_N = 150;
/** Hard cap on entries, so a dex with many forms cannot inflate the list. */
const CAND_ENTRY_CAP = 2.5;
/** Opponent threes sampled per tier for the exact field. */
const FIELD_THREES = 48;
/** Opponent sixes sampled per tier. Each contributes its 20 lines as columns. */
const FIELD_SIXES = 8;
/**
 * Teams reported per stratum.
 *
 * 150, not 12. The ranking already scores every legal team, so the cut was
 * purely a wire-format cost — and that cost is strings. Emitting refs as
 * indices into a per-league table and scores as bare numbers buys twelve times
 * as many teams for about the same bytes, because a team stops being ~120
 * characters of names and becomes five numbers.
 */
const TOP_OUT = 150;
/**
 * How many carry the full synergy breakdown.
 *
 * The components and the hole list are the expensive part of a row and are only
 * read when one is expanded, which nobody does a hundred rows down. The head
 * keeps them; the tail is refs and scores.
 */
const DETAIL_N = 12;
/**
 * Cores and pillars reported per league.
 *
 * 40 was far too few and hid the answer. Over the top 140 of Great there are
 * ~9,700 legal pairs, so a 40-row list is the 99.6th percentile — and the
 * pairings people actually name sit just under it: Altaria + Empoleon scores
 * 147 (98.9th percentile, rank ~103) and Hisuian Electrode + Carbink 140
 * (98.0th, rank ~190). The metric agreed with them all along; the window did
 * not show them.
 */
const CORES_OUT = 300;
const PILLARS_OUT = 200;
/**
 * How deep the core search looks, per category.
 *
 * Deliberately far deeper than CAND_N. Cores are not a property of the top of
 * the format — the pairings people actually build around are frequently two
 * mid-rank Pokemon that happen to answer each other's counters, and a search
 * restricted to each category's best 24 cannot find them because it never
 * evaluates them. Altaria peaks at rank 76 (Switches), Hisuian Electrode at 68
 * (Closers), Sealeo at 58 (Attackers): all of them famous halves of a core, all
 * of them invisible to a top-24 search.
 *
 * Unioned across categories rather than taken on Overall, because a specialist
 * is exactly the kind of Pokemon that earns its place in a pair.
 */
const CORE_POOL_N = 200;

/**
 * The tier whose field cores are measured against.
 *
 * Not the default tier, and this matters more than it looks. A tier's field is
 * its own top N, so computing cores at tier 100 asks "does this pair cover the
 * top 100" — and a core is very often two mid-ladder Pokemon that cover the
 * things you actually run into, which a hundred-strong field cannot express.
 * Altaria + Empoleon scores 147 against a 500-wide field and falls under the
 * cut against a 100-wide one; the pairing did not change, the question did.
 *
 * 500 is the widest tier that is still a meta rather than a roster.
 */
const CORE_TIER = '500';
/**
 * Opponent species the synergy pass measures coverage against, per tier.
 *
 * Capped because coverage is a question about the meta, not the roster: whether
 * a team answers the 500th-best Pokemon is not something anyone builds around,
 * and letting a thousand irrelevant columns into the mean flattens the very
 * holes this is meant to find. Tiers at or below the cap are exact.
 */
const SYNERGY_FIELD_CAP = 500;

/**
 * Shield policy for both sides.
 *
 * The rankings simulate `always` and `read` and average them, because their job
 * includes sitting next to PvPoke's published numbers and you do not get to
 * choose how a stranger plays. Discovery is a different question: it is asking
 * what to bring, and a team that only looks good because the opponent shields
 * the bait is not an answer worth shipping. Both sides read, for the same
 * reason OPTIMAL_TIMING is on in the matrix build — simulating worse play than
 * a competent human buys nothing here.
 */
const POLICY: ShieldPolicy = 'read';

/** Charged-move timing, matching the rankings build. */
const OPTIMAL_TIMING = true;

// ── Team scenarios ──────────────────────────────────────────────────────────

/**
 * The state a team chain opens in, as the full shield parity matrix.
 *
 * Ids are deliberately the single-matchup ScenarioIds, so CATEGORIES' existing
 * weights apply to teams unchanged and the seven categories keep exactly one
 * definition. "Closers" weights sh00 at 1 whether the thing being weighted is a
 * Pokemon or a team of three, and that is the honest reading: a closer is a
 * closer because it works with the shields gone.
 *
 * Shields here belong to the player for the whole chain, which is what makes
 * the off-diagonal entries mean something a single matchup cannot express —
 * 2v0 is not "a strong position", it is three Pokemon that have to close while
 * the opponent still holds both.
 */
interface TeamScenario {
  id: ScenarioId;
  shieldsA: number;
  shieldsB: number;
  bankedA: number;
  bankedB: number;
}

const TEAM_SCENARIOS: readonly TeamScenario[] = [
  ...SHIELD_STATES.map((id) => ({
    id,
    shieldsA: Number(id[2]),
    shieldsB: Number(id[3]),
    bankedA: 0,
    bankedB: 0,
  })),
  // The two energy states, at the full budget a team actually opens on.
  { id: 'switch', shieldsA: 2, shieldsB: 2, bankedA: 0, bankedB: 1 },
  { id: 'charger', shieldsA: 2, shieldsB: 2, bankedA: 1, bankedB: 0 },
] as const;

const S = TEAM_SCENARIOS.length;

// ── Plan types ──────────────────────────────────────────────────────────────

type Triple = [number, number, number];

interface Job {
  league: LeagueId;
  refs: string[];
  rows: Triple[];
  cols: Triple[];
  from: number;
  to: number;
  buffer: SharedArrayBuffer;
}

// ── The sweep ───────────────────────────────────────────────────────────────

/**
 * Rate every row team against every column team, in every scenario.
 *
 * Stored as a byte: 0–1000 scaled to 0–255 costs +/-2 points, far inside the
 * noise of anything decided downstream, and halves a table that runs to tens of
 * millions of cells.
 */
function sweep(
  mons: BattleMon[],
  rows: Triple[],
  cols: Triple[],
  out: Uint8Array,
  from: number,
  to: number,
) {
  const nC = cols.length;
  const mine: BattleMon[] = [null!, null!, null!];
  const theirs: BattleMon[] = [null!, null!, null!];
  for (let i = from; i < to; i++) {
    const r = rows[i];
    mine[0] = mons[r[0]]; mine[1] = mons[r[1]]; mine[2] = mons[r[2]];
    for (let j = 0; j < nC; j++) {
      const c = cols[j];
      theirs[0] = mons[c[0]]; theirs[1] = mons[c[1]]; theirs[2] = mons[c[2]];
      for (let s = 0; s < S; s++) {
        const sc = TEAM_SCENARIOS[s];
        const res = teamBattle(mine, theirs, {
          shieldsA: sc.shieldsA,
          shieldsB: sc.shieldsB,
          bankedA: sc.bankedA,
          bankedB: sc.bankedB,
          optimizeTiming: OPTIMAL_TIMING,
          policyA: POLICY,
          policyB: POLICY,
        });
        out[(i * nC + j) * S + s] = Math.round((teamRating(res) / 1000) * 255);
      }
    }
  }
}

if (!isMainThread) {
  const { league, refs, rows, cols, from, to, buffer } = workerData as Job;
  const mons = refs.map((r) => monFor(r, league));
  sweep(mons, rows, cols, new Uint8Array(buffer), from, to);
  parentPort!.postMessage('done');
}

async function sweepParallel(
  lg: LeagueId,
  refs: string[],
  rows: Triple[],
  cols: Triple[],
): Promise<Uint8Array> {
  const buffer = new SharedArrayBuffer(rows.length * cols.length * S);
  const view = new Uint8Array(buffer);
  const workers = Math.max(1, Math.min(cpus().length - 1, 8));
  if (workers === 1 || rows.length < workers * 4) {
    sweep(refs.map((r) => monFor(r, lg)), rows, cols, view, 0, rows.length);
    return view;
  }
  const chunk = Math.ceil(rows.length / workers);
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const from = w * chunk;
      const to = Math.min(rows.length, from + chunk);
      if (from >= to) return Promise.resolve();
      return new Promise<void>((res, rej) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: { league: lg, refs, rows, cols, from, to, buffer } satisfies Job,
        });
        worker.on('message', () => res());
        worker.on('error', rej);
      });
    }),
  );
  return view;
}

// ── Solo sweep, for synergy ─────────────────────────────────────────────────

/**
 * Every candidate against every field *species*, one on one.
 *
 * Distinct from the team table on purpose. Coverage, redundancy and swap safety
 * are all questions about an individual member's matchup — "who on this team
 * answers Ground" — and a team-versus-team table cannot express them: it has
 * already summed the three members into one result, which is exactly the step
 * that hides a shared hole.
 *
 * Eleven scenarios, so a category weighting can be applied afterwards and the
 * synergy pass inherits the same seven definitions everything else uses. The
 * switch scenario is kept separately addressable because pricing a swap means
 * entering against something that has been farming, not a fresh matchup.
 */
function soloSweep(
  mons: BattleMon[],
  candIdx: number[],
  fieldIdx: number[],
): Float64Array[] {
  const nS = SCENARIOS.length;
  const out: Float64Array[] = [];
  for (const ci of candIdx) {
    const me = mons[ci];
    const row = new Float64Array(fieldIdx.length * nS);
    const myEnergy = SCENARIOS.map((s) => startingEnergy(me, s.bankedA));
    for (let f = 0; f < fieldIdx.length; f++) {
      const them = mons[fieldIdx[f]];
      // A species never faces itself: a mirror is a draw or a CMP win, and
      // crediting a team for "covering" its own member is meaningless.
      if (fieldIdx[f] === ci) {
        for (let s = 0; s < nS; s++) row[f * nS + s] = WIN_LINE;
        continue;
      }
      for (let s = 0; s < nS; s++) {
        const sc = SCENARIOS[s];
        const r = battle(
          me, them, sc.shieldsA, sc.shieldsB,
          myEnergy[s], startingEnergy(them, sc.bankedB),
          false, OPTIMAL_TIMING, undefined, undefined, POLICY, POLICY,
        );
        row[f * nS + s] = rating(r);
      }
    }
    out.push(row);
  }
  return out;
}

/** Collapse a solo row to one rating per opponent under a category weighting. */
function soloCategory(
  row: Float64Array,
  nF: number,
  cat: (typeof CATEGORIES)[number],
  fastTurns: number,
): Float64Array {
  const nS = SCENARIOS.length;
  const out = new Float64Array(nF);
  const per = {} as Record<ScenarioId, number>;
  for (let f = 0; f < nF; f++) {
    for (let s = 0; s < nS; s++) per[SCENARIOS[s].id] = row[f * nS + s];
    out[f] = cat.id === 'consistency'
      ? consistencyScore(per, fastTurns)
      : weightedScore(per, cat.weights);
  }
  return out;
}

/** The switch scenario alone, which is the honest price of a swap. */
function soloSwitch(row: Float64Array, nF: number): Float64Array {
  const nS = SCENARIOS.length;
  const si = SCENARIOS.findIndex((s) => s.id === 'switch');
  const out = new Float64Array(nF);
  for (let f = 0; f < nF; f++) out[f] = row[f * nS + si];
  return out;
}

// ── Rankings input ──────────────────────────────────────────────────────────

interface RawEntry {
  ref: string;
  name: string;
  tiers: Record<string, { rec: number[]; best: number[]; set: number }>;
  d2: Record<string, number[]>;
}
interface RawLeague {
  engineRev: number;
  tiers: string[];
  defaultTier: string;
  categories: CategoryId[];
  entries: RawEntry[];
}

const RANKINGS = JSON.parse(readFileSync(join(OUT, 'rankings.json'), 'utf8')) as Record<
  LeagueId,
  RawLeague
>;

/**
 * The three readings of the same teams.
 *
 * `d1` and `d2` rank by the simulated chain — flat and strength-graded field
 * respectively. `syn` ranks the identical candidate set by how well the team
 * covers itself. Deliberately a third axis rather than a term blended into the
 * first two: coverage and win rate are different questions, and averaging them
 * would produce one number that answers neither — the same mistake §1 of the
 * backlog is about. Switch axis to switch question.
 *
 * `syn` weights the field flat, as `d1` does; there is no graded variant,
 * because a hole is a hole whoever is standing in it.
 */
type Pass = 'd1' | 'd2' | 'syn';

const PASSES: readonly Pass[] = ['d1', 'd2', 'syn'];

/** The stratum's ordering: species best-first under (tier, category, pass). */
function ordered(lg: LeagueId, tier: string, ci: number, pass: Pass): RawEntry[] {
  const es = RANKINGS[lg].entries;
  // `syn` has no ordering of its own — it ranks teams, not species — so its
  // candidate pool is the category's own d1 ordering, the same 24 species the
  // simulated passes consider. Same candidates, different question asked of them.
  const score = (e: RawEntry) => (pass === 'd2' ? e.d2[tier] : e.tiers[tier].rec)[ci];
  return [...es].sort((a, b) => score(b) - score(a));
}

/**
 * The top `n` distinct species from an ordering, with every form of each kept.
 *
 * Walks in score order counting distinct dexes, so "top 24" means 24 species a
 * team could actually be built from rather than 24 rows that might include the
 * same species twice.
 */
function topSpecies(ord: RawEntry[], n: number): RawEntry[] {
  const seen = new Set<number>();
  const out: RawEntry[] = [];
  const cap = Math.ceil(n * CAND_ENTRY_CAP);
  for (const e of ord) {
    const sp = speciesOf(e.ref);
    if (!sp) continue;
    if (!seen.has(sp.dex)) {
      if (seen.size === n) break;
      seen.add(sp.dex);
    }
    out.push(e);
    if (out.length >= cap) break;
  }
  return out;
}

/** Overall score at a tier, used to weight opponents in the d2 pass. */
function overallAt(lg: LeagueId, tier: string): Map<string, number> {
  const oi = RANKINGS[lg].categories.indexOf('overall');
  return new Map(RANKINGS[lg].entries.map((e) => [e.ref, e.tiers[tier].rec[oi]]));
}

// ── Deterministic sampling ──────────────────────────────────────────────────

/**
 * A cheap LCG, as in lib/teambuild.ts. Determinism matters more than
 * statistical quality: the field is a fixed yardstick, and two teams must
 * always be compared against the identical one or the ranking is meaningless.
 */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/**
 * Sample teams of `size`, rejecting any that break GBL's duplicate-species rule.
 *
 * The opposing field has to obey the rule too. A field containing teams nobody
 * could legally bring is not a weaker yardstick, it is the wrong one — and it
 * would quietly reward whatever happens to beat illegal teams.
 */
function sampleTeams(
  pool: number[],
  size: number,
  count: number,
  seed: number,
  legal: (a: number, b: number) => boolean,
): number[][] {
  const next = lcg(seed);
  const out: number[][] = [];
  const seen = new Set<string>();
  let guard = 0;
  // The guard is generous because rejection sampling near the top of a small
  // tier can fail often — a pool of 50 where several share a dex.
  while (out.length < count && guard++ < count * 400) {
    const team: number[] = [];
    let tries = 0;
    while (team.length < size && tries++ < 200) {
      const pick = pool[Math.floor(next() * pool.length)];
      if (team.includes(pick)) continue;
      if (team.some((m) => !legal(m, pick))) continue;
      team.push(pick);
    }
    if (team.length < size) continue;
    team.sort((a, b) => a - b);
    const key = team.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(team);
  }
  return out;
}

/**
 * All C(n,k) combinations, skipping any that break the duplicate rule.
 *
 * Pruning inside the recursion rather than filtering afterwards: an illegal
 * prefix cannot become legal by adding to it, so the whole subtree goes.
 */
function combos<T>(items: readonly T[], k: number, legal?: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < items.length; i++) {
      if (legal && acc.some((m) => !legal(m, items[i]))) continue;
      acc.push(items[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

const key3 = (t: readonly number[]) => `${t[0]}|${t[1]}|${t[2]}`;

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Collapse a row's per-scenario bytes into one number for a category.
 *
 * Consistency is not a weighting — it reads the spread across the nine shield
 * parities directly, exactly as it does for a single Pokemon, and takes the
 * turn penalty from the team's mean fast-move length because a team that
 * commits two seconds at a time coarsens every decision the same way one
 * Pokemon does.
 */
function categoryValue(
  per: Record<ScenarioId, number>,
  cat: (typeof CATEGORIES)[number],
  fastTurns: number,
): number {
  return cat.id === 'consistency'
    ? consistencyScore(per, fastTurns)
    : weightedScore(per, cat.weights);
}

const decode = (b: number) => (b / 255) * 1000;

/** Opponents B answers that A loses to, strongest margin first. */
function topCovers(aRow: Float64Array, bRow: Float64Array, fieldRefs: string[], k = 6): string[] {
  const out: { ref: string; gain: number }[] = [];
  for (let o = 0; o < aRow.length; o++) {
    if (aRow[o] >= WIN_LINE) continue;
    if (bRow[o] < ANSWER_LINE) continue;
    out.push({ ref: fieldRefs[o], gain: bRow[o] - aRow[o] });
  }
  out.sort((x, y) => y.gain - x.gain);
  return out.slice(0, k).map((x) => x.ref);
}

/** Types A is weak to that B resists — the type-chart half of the story. */
function coveredTypes(aRef: string, bRef: string): string[] {
  const aTypes = speciesOf(aRef)?.types ?? [];
  const bTypes = speciesOf(bRef)?.types ?? [];
  const bResists = new Set(resistancesOf(bTypes));
  return weaknessesOf(aTypes).filter((w) => bResists.has(w));
}

interface Pillar {
  lead: string;
  backs: string[];
  /** Share of the lead's losing matchups that BOTH backs answer, per mille. */
  doubleCover: number;
  leadLosses: number;
  covered: string[];
}

// ── Main ────────────────────────────────────────────────────────────────────

interface TeamOut {
  refs: string[];
  /** The ranking number for this stratum's pass. */
  score: number;
  /** For sixes: the line that most often realises the floor. */
  line?: string[];
  /**
   * Synergy components, attached to every reported team whatever pass ranked
   * it — so a team that won on simulation can still be read for whether it
   * covers itself, which is the comparison the third pass exists to enable.
   */
  syn?: Omit<Synergy, 'holes'> & { holes: string[] };
  /** Simulated chain score, carried alongside when synergy did the ranking. */
  sim?: number;
}

async function main() {
  const validate = process.argv.includes('--validate');
  // `--only=master` keeps the iteration loop short while tuning; the shipped
  // artefact is always all three, so a partial run refuses to overwrite it.
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const out: Record<string, unknown> = {};

  for (const league of LEAGUES) {
    if (only && league.id !== only) continue;
    const lg = league.id;
    const t0 = performance.now();
    const rk = RANKINGS[lg];
    const tiers = rk.tiers;
    const cats = CATEGORIES;
    const perLeague: Record<string, unknown> = {};
    let chains = 0;

    // Index space: every species that any stratum of this league considers.
    const refSet = new Set<string>();
    for (const t of tiers)
      for (let ci = 0; ci < cats.length; ci++)
        for (const pass of PASSES)
          for (const e of topSpecies(ordered(lg, t, ci, pass), CAND_N)) refSet.add(e.ref);
    // The core search reaches deeper than the team search, at the default tier
    // only — see CORE_POOL_N.
    for (let ci = 0; ci < cats.length; ci++)
      for (const e of ordered(lg, CORE_TIER, ci, 'd1').slice(0, CORE_POOL_N)) refSet.add(e.ref);
    // Opponent fields are drawn from the tier itself, so those refs are needed
    // in the index space too — the tier cutoff reaches far past the candidates.
    //
    // Deliberately NOT capped at the team-builder's usual top 100. The tier is
    // the whole point of the axis: if every tier past 100 drew from the same
    // pool, four of the six would be the same number wearing different labels.
    // A tier-500 field does contain teams nobody would bring, exactly as the
    // rankings' tier-500 column contains opponents nobody would bring, and it
    // means the same thing in both places.
    const fieldPoolRefs: Record<string, string[]> = {};
    const oi = rk.categories.indexOf('overall');
    const byOverall: Record<string, RawEntry[]> = {};
    for (const t of tiers) {
      const n = t === 'all' ? rk.entries.length : Number(t);
      byOverall[t] = [...rk.entries]
        .sort((a, b) => b.tiers[t].rec[oi] - a.tiers[t].rec[oi])
        .slice(0, Math.min(n, rk.entries.length));
      for (const e of byOverall[t]) refSet.add(e.ref);
      fieldPoolRefs[t] = byOverall[t].map((e) => e.ref);
    }
    const refs = [...refSet];
    const refPos = new Map(refs.map((r, i) => [r, i]));
    const fieldPool: Record<string, number[]> = {};
    for (const t of tiers) fieldPool[t] = fieldPoolRefs[t].map((r) => refPos.get(r)!);

    const mons = refs.map((r) => monFor(r, lg));
    const fastTurnsOf = (tri: readonly number[]) =>
      tri.reduce((n, i) => n + mons[i].fast.turns, 0) / tri.length;

    // GBL's duplicate-species rule, resolved once per league into an index-space
    // predicate. Every combination and every sample goes through it, so an
    // illegal team cannot reach the table at all — filtering the *output* would
    // leave the top ten short and the scores computed against an illegal field.
    const conflict = new Uint8Array(refs.length * refs.length);
    for (let i = 0; i < refs.length; i++)
      for (let j = i + 1; j < refs.length; j++)
        if (conflictsOnTeam(refs[i], refs[j])) {
          conflict[i * refs.length + j] = 1;
          conflict[j * refs.length + i] = 1;
        }
    const legalPair = (a: number, b: number) => conflict[a * refs.length + b] === 0;

    /**
     * Type pressure, computed once per league over a broad field.
     *
     * Deliberately NOT per tier. Pressure asks "can the game punish this
     * weakness", and the answer does not depend on where we drew a ranking
     * cutoff — a Fire attacker beats triple Steel whether or not it is top 50.
     * Computed per tier it silently under-counted: at tier 50 the severely
     * weighted field held too little Fire to clear the threshold, and 27 shipped
     * threes were Registeel + Tinkaton + Wormadam, three-deep into Fire.
     *
     * Weighted at power 2 rather than the core pass's 4, for the same reason:
     * a Fire attacker at rank 120 still ends that team, so the tail should fade
     * rather than vanish.
     */
    const pressureField = fieldPoolRefs[CORE_TIER] ?? fieldPoolRefs[tiers[tiers.length - 1]];
    const ovrPressure = overallAt(lg, CORE_TIER);
    const pressure = typePressure(
      pressureField.map((r) => {
        const sp = speciesOf(r);
        if (!sp) return [] as string[];
        const rec = movesFor(sp, lg);
        return [...new Set([rec.fast.type, ...rec.charges.map((c) => c.type)])];
      }),
      relevanceWeights(pressureField.map((r) => ovrPressure.get(r) ?? 0), 2),
    );

    /** Pair cores, accumulated at the default tier and ranked at the end. */
    const corePairs: Core[] = [];
    let excludedThrees = 0;
    let excludedSixes = 0;
    let droppedAllThrees = 0;
    let relaxedThrees = 0;
    let relaxedSixes = 0;

    /**
     * "One in front, two in back": a lead with a narrow weakness that *two*
     * teammates independently answer.
     *
     * Tinkaton behind a double-water back line is the shape — when the fire
     * type it fears actually leads, there are two separate ways to flip the
     * matchup and realign Tinkaton onto the rest of the field. One answer is a
     * plan; two is a plan that still works when the opponent has a read on the
     * first. Scored as the share of the lead's losing matchups that *both*
     * backs cover, which is why it rewards redundancy rather than breadth.
     */
    const pillars: Pillar[] = [];

    for (const tier of tiers) {
      const pool = fieldPool[tier];
      // The exact field: threes sampled directly, plus the lines of sampled
      // sixes so the Show 6 game and the threes ranking read one table.
      const fieldThrees = sampleTeams(pool, 3, FIELD_THREES, 0x2f6e2b1, legalPair);
      const fieldSixes = sampleTeams(pool, 6, FIELD_SIXES, 0x51a3d7, legalPair);
      const colMap = new Map<string, number>();
      const cols: Triple[] = [];
      const addCol = (t: readonly number[]) => {
        const k = key3(t);
        let idx = colMap.get(k);
        if (idx === undefined) {
          idx = cols.length;
          colMap.set(k, idx);
          cols.push([t[0], t[1], t[2]]);
        }
        return idx;
      };
      for (const t of fieldThrees) addCol(t);
      // Each opponent six contributes its twenty lines, and remembers where
      // they landed so the maximin can be read back without re-deriving them.
      const sixCols = fieldSixes.map((six) => combos(six, 3).map((l) => addCol(l)));

      // Candidate triples for this tier: the union over its 14 strata. Rows are
      // per tier because a stratum only ever reads its own tier's columns, so
      // sweeping one global row set against every column would pay for cells
      // nothing reads.
      const rowMap = new Map<string, number>();
      const rows: Triple[] = [];
      const addRow = (t: readonly number[]) => {
        const k = key3(t);
        let idx = rowMap.get(k);
        if (idx === undefined) {
          idx = rows.length;
          rowMap.set(k, idx);
          rows.push([t[0], t[1], t[2]]);
        }
        return idx;
      };
      interface Stratum {
        ci: number;
        pass: Pass;
        cand: number[];
        six: number[];
        triples: number[];
      }
      const strata: Stratum[] = [];
      for (let ci = 0; ci < cats.length; ci++) {
        for (const pass of PASSES) {
          const ord = ordered(lg, tier, ci, pass);
          const cand = topSpecies(ord, CAND_N).map((e) => refPos.get(e.ref)!);
          const six = topSpecies(ord, SIX_N).map((e) => refPos.get(e.ref)!);
          const triples = combos(cand, 3, legalPair).map((t) => addRow([...t].sort((a, b) => a - b)));
          // Every line inside the six-candidates must exist as a row or the
          // Show 6 lookup has holes; top-SIX_N is inside top-CAND_N, so this is
          // already covered, but assert rather than assume.
          for (const l of combos(six, 3, legalPair)) {
            const k = key3([...l].sort((a, b) => a - b));
            if (!rowMap.has(k)) throw new Error(`six line missing from rows: ${k}`);
          }
          strata.push({ ci, pass, cand, six, triples });
        }
      }

      // ── Solo tables, for the synergy pass ─────────────────────────────────
      // Rows are every candidate this tier's strata can use; columns are the
      // tier's field species. Built once per tier and read by all 21 of its
      // strata, since the sweep does not depend on category — the category
      // weighting is applied afterwards, to the same eleven scenarios.
      // At the default tier the candidate rows are widened to the core pool, so
      // core discovery can see pairs the team search never shortlists. Costs one
      // extra solo sweep over the extra rows, at one tier.
      const corePool = tier === CORE_TIER
        ? cats.flatMap((_, ci) =>
            ordered(lg, tier, ci, 'd1').slice(0, CORE_POOL_N).map((e) => refPos.get(e.ref)!))
        : [];
      const candUnion = [...new Set([...strata.flatMap((st) => [...st.cand, ...st.six]), ...corePool])];
      const candPos = new Map(candUnion.map((c, i) => [c, i]));
      const synField = pool.slice(0, Math.min(SYNERGY_FIELD_CAP, pool.length));
      const nF = synField.length;
      const soloRaw = soloSweep(mons, candUnion, synField);
      chains += candUnion.length * nF * SCENARIOS.length;

      const synFieldRefs = synField.map((i) => refs[i]);
      const soloSwitchRows = soloRaw.map((row) => soloSwitch(row, nF));
      const soloByCat = cats.map((cat) =>
        soloRaw.map((row, n) =>
          soloCategory(row, nF, cat, mons[candUnion[n]].fast.turns),
        ),
      );

      // Stat product, normalised against the strongest candidate in the tier.
      // A bulk edge is real but marginal next to a matchup, which is why it
      // carries the smallest weight in the composite.
      const spOf = candUnion.map((i) => bestSpreadFor(refs[i], lg, true).sp);
      const spMax = Math.max(...spOf) || 1;
      const bulkNorm = new Map(candUnion.map((c, i) => [c, spOf[i] / spMax]));

      /** Does this team repeat a typing past the ABC allowance? */
      const repeatsTyping = (members: readonly number[], cap: number) =>
        sharedTypePairs(members.map((m) => speciesOf(refs[m])?.types ?? [])) > cap;

      /** Does this team stack an exploitable weakness past the limit? */
      const stacksWeakness = (members: readonly number[], cap: number) => {
        const w = worstSharedWeakness(
          members.map((m) => speciesOf(refs[m])?.types ?? []),
          pressure,
          MIN_TYPE_PRESSURE,
        );
        return !!w && w.count > cap;
      };

      /** Synergy for a team of index members, under one category. */
      const synOf = (members: readonly number[], ci: number): Synergy => {
        const ratings: SoloRatings = {
          field: synFieldRefs,
          neutral: members.map((m) => soloByCat[ci][candPos.get(m)!]),
          switching: members.map((m) => soloSwitchRows[candPos.get(m)!]),
        };
        return synergyOf(members.map((m) => refs[m]), ratings, members.map((m) => bulkNorm.get(m)!));
      };

      // ── The table ─────────────────────────────────────────────────────────
      // Every legal candidate triple this tier's strata can form, against the
      // whole field, in every scenario. Exhaustive: no candidate is dropped on
      // an estimate, so a team's absence from a list means it lost.
      const exact = await sweepParallel(lg, refs, rows, cols);
      chains += rows.length * cols.length * S;
      // Rows are the table's own index space now that nothing is pre-selected.
      const exactRowPos = new Map(rows.map((_, i) => [i, i]));

      // One scratch record, refilled per call. This runs tens of millions of
      // times across a league and a fresh object per cell dominated the profile
      // — the scenario ids are fixed, so there is nothing to allocate.
      const scratch = {} as Record<ScenarioId, number>;
      const acc = new Float64Array(S);

      const perOf = (table: Uint8Array, nC: number, row: number, colIdx: number[], w: number[]) => {
        acc.fill(0);
        let wsum = 0;
        for (let n = 0; n < colIdx.length; n++) {
          const weight = w[n];
          if (weight === 0) continue;
          const base = (row * nC + colIdx[n]) * S;
          for (let s = 0; s < S; s++) acc[s] += decode(table[base + s]) * weight;
          wsum += weight;
        }
        for (let s = 0; s < S; s++) scratch[TEAM_SCENARIOS[s].id] = wsum === 0 ? 0 : acc[s] / wsum;
        return scratch;
      };

      /** One cell — this row against this single column — as a category value. */
      const cellValue = (
        table: Uint8Array,
        nC: number,
        row: number,
        col: number,
        cat: (typeof CATEGORIES)[number],
        turns: number,
      ) => {
        const base = (row * nC + col) * S;
        for (let s = 0; s < S; s++) scratch[TEAM_SCENARIOS[s].id] = decode(table[base + s]);
        return categoryValue(scratch, cat, turns);
      };

      // Opponent weighting: flat for d1, graded by the opposing team's own
      // strength for d2 — the same idea as the rankings' second pass, applied
      // to a team rather than a species. Cubed, as there.
      const ovr = overallAt(lg, tier);
      const teamStrength = (t: readonly number[]) =>
        t.reduce((n, i) => n + (ovr.get(refs[i]) ?? 0), 0) / t.length;
      const colStrength = cols.map((c) => teamStrength(c));
      const sMin = Math.min(...colStrength);
      const sMax = Math.max(...colStrength);
      const sSpan = sMax - sMin || 1;
      const gradedCol = colStrength.map((v) => ((v - sMin) / sSpan) ** 3);

      const allColIdx = cols.map((_, n) => n);
      const flatCol = cols.map(() => 1);

      strata.forEach((st) => {
        const cat = cats[st.ci];
        const w = st.pass === 'd2' ? gradedCol : flatCol;

        // Threes: exhaustive over every legal triple this stratum can form,
        // ranked by whichever question this pass is asking.
        const threes: TeamOut[] = [];
        const simOf = (r: number) =>
          categoryValue(perOf(exact, cols.length, exactRowPos.get(r)!, allColIdx, w), cat, fastTurnsOf(rows[r]));
        // Teams that stack an exploitable weakness past the cap are removed
        // before ranking, on every pass. Filtering here rather than penalising
        // the score keeps it a constraint: no amount of chain win rate buys a
        // team out of having no answer to Ground.
        const sound = st.triples.filter((r) => !stacksWeakness(rows[r], MAX_SHARED_WEAK_3));
        let tCap = MAX_SHARED_TYPES_3;
        let eligible = sound.filter((r) => !repeatsTyping(rows[r], tCap));
        while (eligible.length === 0 && tCap < 3) {
          tCap++;
          eligible = sound.filter((r) => !repeatsTyping(rows[r], tCap));
        }
        if (tCap > MAX_SHARED_TYPES_3 && eligible.length) relaxedThrees++;
        const scoredThrees = (eligible.length ? eligible : st.triples).map((r) => ({
          r,
          v: st.pass === 'syn' ? synOf(rows[r], st.ci).score : simOf(r),
        }));
        if (!eligible.length) droppedAllThrees++;
        excludedThrees += st.triples.length - eligible.length;
        scoredThrees.sort((a, b) => b.v - a.v);
        for (const x of scoredThrees.slice(0, TOP_OUT)) {
          const s = synOf(rows[x.r], st.ci);
          threes.push({
            refs: rows[x.r].map((i) => refs[i]),
            score: Math.round(x.v),
            sim: Math.round(simOf(x.r)),
            // Holes are the actionable part, so they are kept — but capped,
            // because a weak team can be open to hundreds and the list stops
            // being readable long before that.
            syn: { ...s, holes: s.holes.slice(0, 8) },
          });
        }

        // ── Show 6 ────────────────────────────────────────────────────────
        // M[line][opponent six] = the worst that six can do to that line, i.e.
        // the opponent answering optimally. Category-collapsed first so the
        // 8008-six enumeration is one number per cell rather than eleven.
        const sixLines = combos(st.six, 3, legalPair).map((l) => rowMap.get(key3([...l].sort((a, b) => a - b)))!);
        const linePos = new Map(sixLines.map((r, i) => [r, i]));
        const nSix = sixCols.length;
        const M = new Float64Array(sixLines.length * nSix);
        for (let li = 0; li < sixLines.length; li++) {
          const er = exactRowPos.get(sixLines[li])!;
          const turns = fastTurnsOf(rows[sixLines[li]]);
          for (let si = 0; si < nSix; si++) {
            let worst = Infinity;
            for (const c of sixCols[si]) {
              const v = cellValue(exact, cols.length, er, c, cat, turns);
              if (v < worst) worst = v;
            }
            M[li * nSix + si] = worst;
          }
        }
        // Opponent sixes weighted the same way columns are, so d2 grades the
        // Show 6 field by strength exactly as it grades the threes field.
        const sixW = fieldSixes.map((six) => (st.pass === 'd2' ? teamStrength(six) : 1));
        const wMin = Math.min(...sixW);
        const wSpan = (Math.max(...sixW) - wMin) || 1;
        const sixWeight =
          st.pass === 'd2' ? sixW.map((v) => ((v - wMin) / wSpan) ** 3) : sixW;
        const wTotal = sixWeight.reduce((a, b) => a + b, 0) || 1;

        const sixes: TeamOut[] = [];
        const best: { v: number; sim: number; six: number[]; line: number[] }[] = [];
        // The ABC cap can empty a stratum outright: Master's candidates are
        // largely Dragon/Steel/Psychic legendaries, and requiring at most two
        // shared-type pairs out of fifteen leaves nothing. Relax one step at a
        // time until something survives, and count it — shipping an empty
        // stratum, or silently dropping the rule, are both worse than saying so.
        const allSixes = combos(st.six, 6, legalPair)
          .filter((six) => !stacksWeakness(six, MAX_SHARED_WEAK_6));
        let typeCap = MAX_SHARED_TYPES_6;
        let pool = allSixes.filter((six) => !repeatsTyping(six, typeCap));
        while (pool.length === 0 && typeCap < 15) {
          typeCap++;
          pool = allSixes.filter((six) => !repeatsTyping(six, typeCap));
        }
        if (typeCap > MAX_SHARED_TYPES_6 && pool.length) relaxedSixes++;
        excludedSixes += allSixes.length - pool.length;
        for (const six of pool) {
          // The six's own twenty lines, resolved once rather than per opponent.
          const lineSets = combos(six, 3);
          const lines = lineSets.map(
            (l) => linePos.get(rowMap.get(key3([...l].sort((a, b) => a - b)))!)!,
          );
          let total = 0;
          // The line that carries the six: highest weighted mean of its own
          // worst cases, not whichever line happened to peak against one
          // opponent. "Your strongest line" has to mean reliably strongest.
          let bestLine = lineSets[0];
          let bestLineMean = -Infinity;
          const lineTotal = new Float64Array(lines.length);
          for (let si = 0; si < nSix; si++) {
            let mx = -Infinity;
            for (let n = 0; n < lines.length; n++) {
              const v = M[lines[n] * nSix + si];
              lineTotal[n] += v * sixWeight[si];
              if (v > mx) mx = v;
            }
            total += mx * sixWeight[si];
          }
          for (let n = 0; n < lines.length; n++)
            if (lineTotal[n] > bestLineMean) { bestLineMean = lineTotal[n]; bestLine = lineSets[n]; }
          best.push({ v: total / wTotal, sim: total / wTotal, six, line: bestLine });
        }
        // The synergy pass re-ranks the same sixes by how well the six covers
        // itself. A six is six answers to choose from, so coverage is if
        // anything more of the point here than it is for a three.
        if (st.pass === 'syn') best.forEach((x) => { x.v = synOf(x.six, st.ci).score; });
        best.sort((a, b) => b.v - a.v);
        for (const x of best.slice(0, TOP_OUT)) {
          const s = synOf(x.six, st.ci);
          sixes.push({
            refs: x.six.map((i) => refs[i]),
            score: Math.round(x.v),
            line: x.line.map((i) => refs[i]),
            sim: Math.round(x.sim),
            syn: { ...s, holes: s.holes.slice(0, 8) },
          });
        }

        // Compact wire format: indices into the league's ref table, then the
        // two scores. Detail rides alongside for the head only.
        const idx = new Map(refs.map((r, n) => [r, n]));
        const packThree = (x: TeamOut) => [...x.refs.map((r) => idx.get(r)!), x.score, x.sim ?? 0];
        const packSix = (x: TeamOut) => [
          ...x.refs.map((r) => idx.get(r)!),
          ...(x.line ?? []).map((r) => idx.get(r)!),
          x.score, x.sim ?? 0,
        ];
        const packDetail = (list: TeamOut[]) =>
          list.slice(0, DETAIL_N).map((x) => (x.syn
            ? [x.syn.score, x.syn.coverage, x.syn.redundancy, x.syn.swapWorst,
               x.syn.swapMean, x.syn.typeCover, x.syn.bulk,
               ...x.syn.holes.map((r) => idx.get(r) ?? -1).filter((n) => n >= 0)]
            : []));
        perLeague[`${tier}|${cat.id}|${st.pass}`] = {
          t3: threes.map(packThree),
          t6: sixes.map(packSix),
          d3: packDetail(threes),
          d6: packDetail(sixes),
        };
      });

      // ── Cores ─────────────────────────────────────────────────────────────
      // Pair synergy, measured at the default tier under Overall so there is a
      // single comparable table per league rather than 126 incomparable ones.
      // Mutual by construction: `coreStrength` is a geometric mean of the two
      // rescue directions, so "a great Pokemon plus a passenger" scores near
      // zero however good the great one is.
      if (tier === CORE_TIER) {
        const oCi = cats.findIndex((c) => c.id === 'overall');
        const rowsByCand = soloByCat[oCi];
        // The field is 500 wide so mid-ladder pairings are visible at all, and
        // weighted so the tail cannot outvote the meta. See relevanceWeights.
        const coreW = relevanceWeights(synField.map((i) => ovr.get(refs[i]) ?? 0));
        // Individual strength, normalised across the core pool. Without this a
        // pair of weak Pokemon with complementary holes outranks a pair of
        // strong ones — see coreStrength.
        const poolOvr = candUnion.map((i) => ovr.get(refs[i]) ?? 0);
        const sLo = Math.min(...poolOvr);
        const sHi = Math.max(...poolOvr);
        const sSp = (sHi - sLo) || 1;
        const strengthOf = new Map(candUnion.map((c, i) => [c, (poolOvr[i] - sLo) / sSp]));
        for (let a = 0; a < candUnion.length; a++) {
          for (let b = a + 1; b < candUnion.length; b++) {
            if (!legalPair(candUnion[a], candUnion[b])) continue;
            const rowA = rowsByCand[a];
            const rowB = rowsByCand[b];
            // A hole both members share is worse than either having it alone:
            // nothing on the pair answers it. See sharedExposure.
            const shared = sharedExposure(
              speciesOf(refs[candUnion[a]])?.types ?? [],
              speciesOf(refs[candUnion[b]])?.types ?? [],
              pressure,
            );
            const strength = coreStrength(
              rowA, rowB, coreW,
              strengthOf.get(candUnion[a])!, strengthOf.get(candUnion[b])!,
              shared.exposure,
            );
            if (strength <= 0) continue;
            corePairs.push({
              a: refs[candUnion[a]],
              b: refs[candUnion[b]],
              score: Math.round(strength),
              aRescuedByB: Math.round(rescue(rowA, rowB, coreW)),
              bRescuedByA: Math.round(rescue(rowB, rowA, coreW)),
              // The evidence: opponents each one answers that the other cannot,
              // strongest first. This is what makes a core inspectable rather
              // than a number to be taken on trust.
              bCovers: topCovers(rowA, rowB, synFieldRefs),
              aCovers: topCovers(rowB, rowA, synFieldRefs),
              bCoversTypes: coveredTypes(refs[candUnion[a]], refs[candUnion[b]]),
              aCoversTypes: coveredTypes(refs[candUnion[b]], refs[candUnion[a]]),
              sharedWeak: shared.types,
              appearances: 0,
              lift: 0,
            });
          }
        }

        // Pillars. Leads and backs are drawn from different depths on purpose:
        // the lead is the centrepiece being built around, so it comes from the
        // top of the format, while the back line exists to answer one specific
        // weakness and is very often a specialist that no overall ranking
        // rates highly. Enumerating C(top-40, 3) missed those entirely.
        const byOverall = [...candUnion].sort(
          (x, y) => (ovr.get(refs[y]) ?? 0) - (ovr.get(refs[x]) ?? 0),
        );
        const leadPool = byOverall.slice(0, PILLAR_LEAD_N);
        const backPool = byOverall.slice(0, PILLAR_BACK_N);
        for (const lead of leadPool) {
          for (let bi = 0; bi < backPool.length; bi++) {
            for (let bj = bi + 1; bj < backPool.length; bj++) {
              const backs = [backPool[bi], backPool[bj]];
              if (backs[0] === lead || backs[1] === lead) continue;
              if (!legalPair(lead, backs[0]) || !legalPair(lead, backs[1]) || !legalPair(backs[0], backs[1])) continue;
            const leadRow = rowsByCand[candPos.get(lead)!];
            const b0 = rowsByCand[candPos.get(backs[0])!];
            const b1 = rowsByCand[candPos.get(backs[1])!];
            let losses = 0;
            let both = 0;
            const covered: string[] = [];
            for (let o = 0; o < nF; o++) {
              if (leadRow[o] >= WIN_LINE) continue;
              losses++;
              if (b0[o] >= ANSWER_LINE && b1[o] >= ANSWER_LINE) {
                both++;
                if (covered.length < 6) covered.push(synFieldRefs[o]);
              }
            }
            // A lead nothing beats needs no back line, and a lead everything
            // beats is not a lead. Both extremes are excluded rather than
            // allowed to top the list on a technicality.
            if (losses < 8 || losses > nF * 0.6) continue;
              pillars.push({
                lead: refs[lead],
                backs: [refs[backs[0]], refs[backs[1]]],
                doubleCover: Math.round((both / losses) * 1000),
                leadLosses: losses,
                covered,
              });
            }
          }
        }
      }


      if (validate) {
        console.log(
          `        ${lg}/${tier}: rows=${rows.length} cols=${cols.length}` +
            `  ${((rows.length * cols.length * S) / 1e6).toFixed(0)}M chains`,
        );
      }

      // ── Table check ───────────────────────────────────────────────────────
      // The sweep is exhaustive, so there is no longer a shortlist that could
      // drop a winner. What CAN still go wrong is the indexing: a row or
      // scenario stride off by one would produce a confident, wrong table that
      // every downstream number inherits silently.
      //
      // So re-simulate the reported top team from the engine directly — no
      // table, no byte encoding — and compare. Not circular: the only shared
      // input is the mons themselves.
      if (validate && tier === rk.defaultTier) {
        const cat = cats.find((c) => c.id === 'overall')!;
        // Decode from the compact wire format — refs are indices into `refs`.
        const packed = (perLeague[`${tier}|overall|d1`] as { t3: number[][] }).t3[0];
        const topRefs = packed.slice(0, 3).map((n) => refs[n]);
        const mine = topRefs.map((r) => monFor(r, lg));
        const per = {} as Record<ScenarioId, number>;
        TEAM_SCENARIOS.forEach((sc, s) => {
          let sum = 0;
          for (const c of cols) {
            const theirs = [mons[c[0]], mons[c[1]], mons[c[2]]];
            sum += teamRating(
              teamBattle(mine, theirs, {
                shieldsA: sc.shieldsA, shieldsB: sc.shieldsB,
                bankedA: sc.bankedA, bankedB: sc.bankedB,
                optimizeTiming: OPTIMAL_TIMING, policyA: POLICY, policyB: POLICY,
              }),
            );
          }
          per[TEAM_SCENARIOS[s].id] = sum / cols.length;
        });
        const fresh = categoryValue(
          per,
          cat,
          topRefs.reduce((n, r) => n + monFor(r, lg).fast.turns, 0) / topRefs.length,
        );
        // The table stores ratings as a byte, so +/-2 per cell is expected and
        // is the only difference that should survive.
        const drift = Math.abs(fresh - packed[3]);
        console.log(
          `        TABLE CHECK ${lg}/${tier}/overall/d1: ${topRefs.join(' / ')}` +
            ` table ${packed[3]} vs fresh ${fresh.toFixed(1)} — drift ${drift.toFixed(2)}` +
            `${drift <= 4 ? '' : '   <<< TOO LARGE'}`,
        );
      }
    }

    // ── Co-occurrence lift ────────────────────────────────────────────────
    // How often a pair actually turned up together in a stratum's top teams,
    // against what independence predicts. Two individually strong Pokemon
    // co-occur constantly for reasons that have nothing to do with synergy;
    // dividing by the product of their own rates leaves the part that does.
    const memberCount = new Map<string, number>();
    const pairCount = new Map<string, number>();
    let teamsSeen = 0;
    for (const v of Object.values(perLeague) as { t3: number[][]; t6: number[][] }[]) {
      // Co-occurrence over the compact rows: the first 3 (or 6) entries are
      // member indices, the trailing two are scores.
      for (const [rows, n] of [[v.t3, 3], [v.t6, 6]] as const) {
        for (const row of rows) {
          teamsSeen++;
          const members = row.slice(0, n).map((x) => refs[x]);
          for (let i = 0; i < members.length; i++) {
            memberCount.set(members[i], (memberCount.get(members[i]) ?? 0) + 1);
            for (let j = i + 1; j < members.length; j++) {
              const k = [members[i], members[j]].sort().join('|');
              pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
            }
          }
        }
      }
    }
    for (const c of corePairs) {
      const k = [c.a, c.b].sort().join('|');
      c.appearances = pairCount.get(k) ?? 0;
      const pa = (memberCount.get(c.a) ?? 0) / Math.max(1, teamsSeen);
      const pb = (memberCount.get(c.b) ?? 0) / Math.max(1, teamsSeen);
      const expected = pa * pb * teamsSeen;
      c.lift = expected > 0 ? Number((c.appearances / expected).toFixed(2)) : 0;
    }
    // Ranked by mutual rescue, but a core nobody's teams ever used is a
    // curiosity rather than a finding — so observed pairings break ties.
    corePairs.sort((x, y) => y.score - x.score || y.appearances - x.appearances);
    const cores = corePairs.slice(0, CORES_OUT);
    // Best double-cover first; a wider weakness answered twice is worth more
    // than a narrow one, so losses break the tie upward.
    pillars.sort((x, y) => y.doubleCover - x.doubleCover || y.leadLosses - x.leadLosses);
    const topPillars = pillars.slice(0, PILLARS_OUT);

    out[lg] = {
      teamRev: TEAM_REV,
      engineRev: rk.engineRev,
      tiers,
      categories: cats.map((c) => c.id),
      passes: PASSES,
      // Every ref the strata index into. Written once instead of ~150 times
      // per stratum, which is the whole reason 150 teams fit at all.
      refs,
      cores,
      pillars: topPillars,
      strata: perLeague,
    };
    console.log(
      `${lg.padEnd(7)} ${(chains / 1e6).toFixed(0).padStart(5)}M chains  ${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s` +
        `  excluded for stacked weakness: ${excludedThrees.toLocaleString()} threes, ${excludedSixes.toLocaleString()} sixes` +
        (relaxedThrees || relaxedSixes
          ? `  [ABC cap relaxed: ${relaxedThrees} strata for threes, ${relaxedSixes} for sixes]` : '') +
        (droppedAllThrees ? `  [${droppedAllThrees} strata had NO eligible three at all]` : ''),
    );
    if (validate) {
      const show = (k: string) => {
        const v = perLeague[k] as { t3: number[][]; t6: number[][] } | undefined;
        if (!v) return;
        console.log(`   ${k}`);
        for (const r of v.t3.slice(0, 3))
          console.log(`      3: ${r[3]}  ${r.slice(0, 3).map((n) => refs[n]).join(' / ')}`);
        for (const r of v.t6.slice(0, 2))
          console.log(`      6: ${r[9]}  ${r.slice(0, 6).map((n) => refs[n]).join(' / ')}` +
            `\n           line: ${r.slice(6, 9).map((n) => refs[n]).join(' / ')}`);
      };
      show(`${rk.defaultTier}|overall|d1`);
      show(`${rk.defaultTier}|overall|d2`);
      show(`${rk.defaultTier}|closers|d1`);
      show(`50|leads|d2`);
    }
  }

  if (only) {
    // Written somewhere inspectable rather than discarded: a partial run is how
    // this gets iterated on, and re-running a league to look at its output
    // costs minutes.
    const scratch = join(process.cwd(), 'node_modules/.cache/teams-partial.json');
    writeFileSync(scratch, JSON.stringify(out));
    console.log(`\n--only=${only}: wrote ${scratch}, teams.json left alone`);
    return;
  }
  writeFileSync(join(OUT, 'teams.json'), JSON.stringify(out));
  console.log(`\nwrote teams.json (teamRev ${TEAM_REV})`);
}

if (isMainThread) await main();
