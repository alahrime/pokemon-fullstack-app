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
import { fitBradleyTerry } from './bradley-terry';
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
import { battle, bestSpreadFor, getEntry, mkBattleMon } from '../src/lib/engine';
import {
  SCENARIOS,
  CATEGORIES,
  rating,
  startingEnergy,
} from '../src/lib/scenarios';
import {
  PV_CP, PV_SCENARIOS, adjRatings, categoryScore, loadPvPokeNode, normalise, opponentWeight, overallScore,
  pvField, pvStatics, startEnergy,
} from './pvpoke-method';
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
 *  14  charge-move priority decided on the Attack *stat* rather than on the
 *      damage attack. Shadow's x6/5 is a damage multiplier, not a stat change
 *      — which is why a Shadow shares its plain form's CP and rank — so it has
 *      no business in a CMP comparison. It was inflating one side of every
 *      priority test involving a Shadow, on either side of the matchup.
 *      Measured at the fix: 1.5% of Shadow-involving battles change, 0.4% of
 *      them changing the winner outright, and 10% of board rows change their
 *      CMP verdict. Stat stages still count, because those are stat changes.
 *  15  PvPoke parity (docs/superpowers/plans/2026-09-24-pvpoke-parity-engine.md):
 *      its float32 damage multipliers; form changes for Aegislash, Morpeko,
 *      Mimikyu and Cramorant; the chance-effect meter in place of fractional
 *      stages; simultaneous CMP ties; and its decision logic - move timing,
 *      charged-move preferences, shielding and the decideAction planner - in
 *      place of our own AI and farm-down rule. Against PvPoke's engine on the
 *      3,675-battle parity fixture: 93.6% exact end HP, 97.7% same winner.
 *  16  the rating's energy-kept bonus removed (single matchups and teams). It
 *      existed to reward the farm-down rule, which rev 15 replaced with
 *      PvPoke's decisions; PvPoke's rating has no such term. Rankings now
 *      use PvPoke's ranking method (scripts/pvpoke-method.ts) against its
 *      ranked field: five scenarios, opponent weights with its overrides,
 *      categories 0-100 of the best and its Overall. Tiers, the graded pass
 *      and Pressure are gone; Return is taught where PvPoke teaches it.
 */
const ENGINE_REV = 16;

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



/**
 * PvPoke's method has no opponent tiers - it weights every opponent by its
 * own score - so the rankings carry one, the whole field.
 */
const ALL = 'all';

/** Team-builder pool size. Beyond this a builder is offering noise. */
const TEAM_POOL_N = 100;

const S = SCENARIOS.length;


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
  // PvPoke teaches Return only where a purified mon (level 25) fits the cap.
  const cap = LEAGUES.find((l) => l.id === lg)!.cap;
  const learnable = sp.chargeMoves.filter((c) => c.id !== 'RETURN' || (sp.level25CP ?? Infinity) <= cap);
  const fasts = [...sp.fastMoves].sort((a, b) => uf(b) - uf(a)).slice(0, FAST_K);
  const charges = [...learnable].sort((a, b) => uc(b) - uc(a)).slice(0, CHARGE_K);
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

// ── Rankings sweep: PvPoke's method (scripts/pvpoke-method.ts) ───────────────

interface PvVariant {
  ref: string;
  set: number;
  recommended: boolean;
  /** False for a field member we do not rank (a Master form under 3000 CP):
   *  it gets a row only so its own score can weight the others. */
  ranked: boolean;
  mon: BattleMon;
  label: string;
  moves: [string, string[]];
}
interface PvPool { variants: PvVariant[]; field: { ref: string; mon: BattleMon; weight: number }[] }

/**
 * Every loadout of every ranked species, at PvPoke's default IVs, and
 * PvPoke's field: its published list with its published movesets. Rebuilt
 * identically in every worker, like buildPool.
 */
function buildPvPool(lg: LeagueId): PvPool {
  const cp = PV_CP[lg];
  const pv = loadPvPokeNode();
  const { list, weightOf } = pvField(cp);
  const usage = loadUsage(lg);
  const entryOf = new Map<string, ReturnType<typeof getEntry>['entry']>();
  const monAt = (ref: string, fast: FastMove, charges: ChargeMove[]) => {
    let e = entryOf.get(ref);
    if (!e) {
      const st = pvStatics(pv, ref, cp, fast.id, charges.map((c) => c.id));
      e = getEntry(ref, st.iv, lg, st.lvl > 50).entry;
      entryOf.set(ref, e);
    }
    return mkBattleMon(e, fast, charges, speciesOf(ref)!.types);
  };
  const field: PvPool['field'] = [];
  for (const r of list) {
    const sp = speciesOf(parseRef(r.speciesId).id);
    const ids = r.moveset.filter((m) => m && m !== 'none');
    const fast = sp?.fastMoves.find((m) => m.id === ids[0]);
    const charges = ids.slice(1, 3).map((c) => sp?.chargeMoves.find((m) => m.id === c));
    if (!sp || !fast || charges.some((c) => !c)) continue;
    field.push({ ref: r.speciesId, mon: monAt(r.speciesId, fast, charges as ChargeMove[]), weight: weightOf(r.speciesId) });
  }
  const variants: PvVariant[] = [];
  const refs = opponentCandidatesFor(lg);
  for (const ref of refs) {
    const sp = speciesOf(ref)!;
    loadoutsFor(sp, lg, usage).forEach((l, set) =>
      variants.push({
        ref, set, recommended: l.recommended, ranked: true,
        mon: monAt(ref, l.fast, l.charges),
        label: `${l.fast.name} · ${l.charges.map((c) => c.name).join(' / ')}`,
        moves: [l.fast.id, l.charges.map((c) => c.id)],
      }));
  }
  const inRefs = new Set(refs);
  for (const f of field)
    if (!inRefs.has(f.ref))
      variants.push({ ref: f.ref, set: 0, recommended: true, ranked: false, mon: f.mon, label: '',
        moves: [f.mon.fast.id, f.mon.charges.map((c) => c.id)] });
  return { variants, field };
}

/** Adjusted rating of every variant against every field member, per scenario. */
function pvSweep(pool: PvPool, out: Uint16Array, from: number, to: number) {
  const nJ = pool.field.length, nS = PV_SCENARIOS.length;
  for (let i = from; i < to; i++) {
    const me = pool.variants[i].mon;
    for (let j = 0; j < nJ; j++)
      for (let s = 0; s < nS; s++) {
        const sc = PV_SCENARIOS[s];
        const r = battle(me, pool.field[j].mon, sc.shields[0], sc.shields[1], startEnergy(me.fast, sc.energy), 0, false, true);
        out[(i * nJ + j) * nS + s] = adjRatings(r, sc.shields)[0];
      }
  }
}

// ── Worker plumbing ─────────────────────────────────────────────────────────

interface Job { kind: 'matrix' | 'pv'; league: LeagueId; from: number; to: number; buffer: SharedArrayBuffer }

if (!isMainThread) {
  const { kind, league, from, to, buffer } = workerData as Job;
  if (kind === 'pv') pvSweep(buildPvPool(league), new Uint16Array(buffer), from, to);
  else {
    const { variants, foes } = buildPool(league);
    sweep(variants, foes, new Uint8Array(buffer), from, to);
  }
  parentPort!.postMessage('done');
}

/** Run `run` over [0, rows) on up to 8 workers sharing `buffer`. */
async function parallel(kind: Job['kind'], lg: LeagueId, rows: number, buffer: SharedArrayBuffer, run: (from: number, to: number) => void) {
  const workers = Math.max(1, Math.min(cpus().length - 1, 8));
  if (workers === 1) return run(0, rows);
  const chunk = Math.ceil(rows / workers);
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const from = w * chunk;
      const to = Math.min(rows, from + chunk);
      if (from >= to) return Promise.resolve();
      return new Promise<void>((res, rej) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { kind, league: lg, from, to, buffer } satisfies Job });
        worker.on('message', () => res());
        worker.on('error', rej);
      });
    }),
  );
}

const decode = (b: number) => (b / 255) * 1000;

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
  const categories = CATEGORIES.map((c) => c.id);
  for (const league of LEAGUES) {
    const lg = league.id;
    const t0 = performance.now();

    // The scenario matrix: every loadout against every rated foe, our eleven
    // scenarios and both shield policies. Teams are built on it, and the
    // Bradley-Terry fit below reads it; the rankings do not.
    const { variants, foes, refs } = buildPool(lg);
    const nF = foes.length;
    const mBuf = new SharedArrayBuffer(variants.length * nF * S * POLICIES.length);
    await parallel('matrix', lg, variants.length, mBuf, (f, t) => sweep(variants, foes, new Uint8Array(mBuf), f, t));
    const matrix = new Uint8Array(mBuf);
    const refPos = new Map(refs.map((r, i) => [r, i]));
    const ratedOf = new Int32Array(nF).fill(-1);
    variants.forEach((v, i) => {
      if (v.recommended && ratedOf[refPos.get(v.ref)!] < 0) ratedOf[refPos.get(v.ref)!] = i;
    });
    const R = new Float64Array(nF * nF);
    const P = POLICIES.length;
    for (let a = 0; a < nF; a++) {
      const i = ratedOf[a];
      if (i < 0) continue;
      for (let b = 0; b < nF; b++) {
        if (a === b) continue;
        let sum = 0;
        const base = (i * nF + b) * S;
        for (let sc = 0; sc < S; sc++) for (let pol = 0; pol < P; pol++) sum += decode(matrix[(base + sc) * P + pol]);
        R[a * nF + b] = sum / (S * P);
      }
    }
    const bt = fitBradleyTerry(R, nF);
    const tSim = performance.now();

    // The rankings: PvPoke's method, every loadout against PvPoke's field.
    const pool = buildPvPool(lg);
    const nV = pool.variants.length, nJ = pool.field.length, nS = PV_SCENARIOS.length;
    const aBuf = new SharedArrayBuffer(nV * nJ * nS * 2);
    await parallel('pv', lg, nV, aBuf, (f, t) => pvSweep(pool, new Uint16Array(aBuf), f, t));
    const adj = new Uint16Array(aBuf);
    const fieldIdx = new Map(pool.field.map((f, j) => [f.ref, j]));
    const recOf = new Map<string, number>();
    pool.variants.forEach((v, i) => { if (v.recommended && !recOf.has(v.ref)) recOf.set(v.ref, i); });
    const pv = loadPvPokeNode();
    const statics = pool.variants.map((v) => pvStatics(pv, v.ref, PV_CP[lg], v.moves[0], v.moves[1]));
    const cat = pool.variants.map(() => new Array<number>(nS));
    const row = new Float64Array(nJ);
    for (let s = 0; s < nS; s++) {
      const mean = (i: number) => { let t = 0; for (let k = 0; k < nJ; k++) t += adj[(i * nJ + k) * nS + s]; return Math.floor(t / nJ); };
      const base = pool.field.map((f) => mean(recOf.get(f.ref)!));
      const best = Math.max(...base);
      const w = base.map((b, j) => opponentWeight(b, best, pool.field[j].weight));
      const raw = pool.variants.map((v, i) => {
        for (let k = 0; k < nJ; k++) row[k] = adj[(i * nJ + k) * nS + s];
        const self = fieldIdx.get(v.ref);
        const wv = self === undefined ? w : w.map((x, k) => (k === self ? 0 : x));
        const sc = categoryScore(row, wv, PV_SCENARIOS[s].slug === 'switches');
        return PV_SCENARIOS[s].slug === 'chargers' ? sc * statics[i].chargerMult : sc;
      });
      // Normalised against the field's own sets, as PvPoke normalises its list.
      const top = Math.max(...pool.field.map((f) => raw[recOf.get(f.ref)!]));
      raw.forEach((x, i) => { cat[i][s] = normalise(x, top); });
    }
    const overall = pool.variants.map((_, i) => overallScore(cat[i], statics[i].consistency));
    // Score arrays follow CATEGORIES: overall, the five roles, consistency.
    const scoresOf = (i: number) => [overall[i], ...cat[i], statics[i].consistency];

    const ref = loadReference(lg);
    const byRef = new Map<string, number[]>();
    pool.variants.forEach((v, i) => { if (v.ranked) (byRef.get(v.ref) ?? byRef.set(v.ref, []).get(v.ref)!).push(i); });
    const entries = refs.map((r) => {
      const mine = byRef.get(r)!;
      const rec = recOf.get(r) ?? mine[0];
      const bestI = mine.reduce((x, y) => (overall[y] > overall[x] ? y : x));
      // PvPoke ranks Shadows as their own entries, under the same ref.
      const pvRef = ref.get(r);
      const strength = bt.strength[refPos.get(r)!];
      return {
        ref: r,
        name: displayName(r),
        bt: { [ALL]: Number.isFinite(strength) ? Math.round(strength * 1000) / 1000 : null },
        loadouts: mine.map((i) => [pool.variants[i].label, overall[i]]),
        tiers: { [ALL]: { rec: scoresOf(rec), best: scoresOf(bestI), set: pool.variants[bestI].set } },
        pvpoke: pvRef ? { score: pvRef.score, scores: pvRef.scores } : null,
      };
    });
    entries.sort((a, b) => b.tiers[ALL].rec[0] - a.tiers[ALL].rec[0]);
    rankings[lg] = {
      engineRev: ENGINE_REV,
      tiers: [ALL],
      defaultTier: ALL,
      categories,
      entries,
      btFit: {
        [ALL]: {
          r2: Math.round(bt.r2 * 1000) / 1000,
          rmse: Math.round(bt.rmse * 1000) / 1000,
          cyclicPct: Math.round((1000 * bt.cycles.cyclic) / (bt.cycles.total || 1)) / 10,
          total: bt.cycles.total,
          n: bt.strength.reduce((acc, v) => acc + (Number.isFinite(v) ? 1 : 0), 0),
          worst: bt.worst.slice(0, 12).map((x) => ({
            a: refs[x.a], b: refs[x.b],
            observed: Math.round(x.observed * 100) / 100, predicted: Math.round(x.predicted * 100) / 100,
          })),
        },
      },
    };
    matrices[lg] = { engineRev: ENGINE_REV, refs: entries.slice(0, TEAM_POOL_N).map((e) => e.ref) };

    console.log(
      `${lg.padEnd(7)} ${String(refs.length).padStart(4)} refs  matrix ${String(variants.length).padStart(5)} variants` +
        ` ${((tSim - t0) / 1000).toFixed(0).padStart(4)}s  |  pvpoke method ${nV} variants x ${nJ} field` +
        ` ${((performance.now() - tSim) / 1000).toFixed(0).padStart(4)}s  |  BT cyclic ${Math.round((1000 * bt.cycles.cyclic) / (bt.cycles.total || 1)) / 10}%`,
    );
    console.log(`        top 5: ${entries.slice(0, 5).map((e) => `${e.name} ${e.tiers[ALL].rec[0]}`).join(', ')}`);
  }

  writeFileSync(join(OUT, 'rankings.json'), JSON.stringify(rankings));
  writeFileSync(join(OUT, 'matrix.json'), JSON.stringify(matrices));
  console.log(`\nwrote rankings.json and matrix.json (engineRev ${ENGINE_REV})`);
}

if (isMainThread) await main();
