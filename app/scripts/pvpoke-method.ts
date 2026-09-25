/**
 * PvPoke's ranking method (Ranker.js, RankerOverall.js) for the "all" cup,
 * shared by build-matrix, which writes the app's rankings with it, and
 * pvpoke-rankings, which checks it reproduces PvPoke. Battles are the
 * caller's; this is the scoring around them.
 *
 * Five scenarios, a battle rating with the shield bonus, one pass of
 * re-weighting by opponents' own scores (^1.65 above 10% of the best) times
 * the opponent weights in PvPoke's overrides, the rating curve (flattened
 * above 700, curved below 300, switches' losses weighted up), the chargers
 * multiplier, each category normalised to 100 of the best, and the overall as
 * the weighted geometric mean of the sorted categories and consistency.
 * PvPoke's own code (app/vendor/pvpoke) supplies what is not a battle: each
 * species' default IVs and level, and calculateConsistency.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PVPOKE_FILES, loadPvPoke, type PvPoke } from '../src/lib/pvpoke';
import type { BattleResult, FastMove } from '../src/lib/types';

export const PV_SCENARIOS = [
  { slug: 'leads', shields: [1, 1], energy: 0 },
  { slug: 'closers', shields: [0, 0], energy: 0 },
  { slug: 'switches', shields: [1, 1], energy: 4 },
  { slug: 'chargers', shields: [1, 1], energy: 6 },
  { slug: 'attackers', shields: [0, 1], energy: 0 },
] as const;

export const PV_CP = { great: 1500, ultra: 2500, master: 10000 } as const;

const ROOT = resolve(process.cwd(), '..');

/** The vendored engine, on the trimmed gamemaster the app ships. */
export function loadPvPokeNode(): PvPoke {
  return loadPvPoke(
    Object.fromEntries(PVPOKE_FILES.map((f) => [f, readFileSync(resolve(ROOT, 'app/vendor/pvpoke', f + '.js'), 'utf8')])) as never,
    JSON.parse(readFileSync(resolve(ROOT, 'app/src/data/pvpoke-gamemaster.json'), 'utf8')),
  );
}

/** PvPoke's published list for a league, and its override weights (default 1). */
export function pvField(cp: number) {
  const list = JSON.parse(readFileSync(resolve(ROOT, `data-src/rankings-${cp}.json`), 'utf8')) as
    { speciesId: string; moveset: string[]; score: number; editorScore?: number; scores: number[] }[];
  const overrides = JSON.parse(readFileSync(resolve(ROOT, `data-src/overrides-${cp}.json`), 'utf8')) as
    { speciesId: string; weight?: number }[];
  const weightOf = new Map(overrides.map((o) => [o.speciesId, o.weight ?? 1]));
  return { list, weightOf: (id: string) => weightOf.get(id) ?? 1 };
}

/**
 * What PvPoke's engine knows about a species with a moveset that is not a
 * battle: its default IVs and level for the league, its consistency, and the
 * chargers multiplier (fast-move pressure and the energy a charged move
 * leaves over).
 */
export function pvStatics(pv: PvPoke, id: string, cp: number, fast: string, charges: string[]) {
  const b = new pv.Battle();
  b.setCP(cp);
  const p = new pv.Pokemon(id, 0, b);
  p.initialize(cp);
  p.selectMove('fast', fast);
  charges.forEach((c, i) => p.selectMove('charged', c, i));
  if (charges.length < 2) p.selectMove('charged', 'none', 1);
  const fm = p.fastMove;
  const dpt = ((fm.power * fm.stab * p.shadowAtkMult) * (p.stats.atk / 100)) / (fm.cooldown / 500);
  const left = 100 - Math.min(...p.chargedMoves.filter(Boolean).map((m: { energy: number }) => m.energy));
  return {
    iv: { a: p.ivs.atk as number, d: p.ivs.def as number, s: p.ivs.hp as number },
    lvl: p.level as number,
    consistency: p.calculateConsistency() as number,
    chargerMult: Math.pow(Math.pow(left / 100, 1 / 2) * Math.pow(dpt / 5, 1 / 6), 1 / 6),
  };
}

/** Ranker.js: energy a side starts with after `turns` turns of fast moves. */
export const startEnergy = (fast: FastMove, turns: number) =>
  turns ? Math.min(fast.energyGain * Math.max(1, Math.floor((turns * 500) / (fast.turns * 500))), 100) : 0;

/**
 * Ranker.js: each side's adjusted rating for one battle - HP kept plus damage
 * dealt, out of 1000, and 100 per shield burned or kept for the winner.
 */
export function adjRatings(r: BattleResult, shields: readonly number[]): [number, number] {
  const rating = Math.floor((r.hpA / r.maxHpA + (r.maxHpB - r.hpB) / r.maxHpB) * 500);
  const opRating = Math.floor((r.hpB / r.maxHpB + (r.maxHpA - r.hpA) / r.maxHpA) * 500);
  let win = rating > opRating ? 1 : 0, opWin = 1 - win;
  if (rating === 500) win = opWin = 0;
  return [
    rating + 100 * (shields[1] - r.shieldsB) * win + 100 * r.shieldsA * win,
    opRating + 100 * (shields[0] - r.shieldsA) * opWin + 100 * r.shieldsB * opWin,
  ];
}

/** An opponent's weight in the re-weighting pass. */
export const opponentWeight = (base: number, best: number, modifier: number) =>
  Math.pow(Math.max(base / best - 0.1, 0), 1.65) * modifier;

/**
 * One category score from a row of adjusted ratings against the field:
 * floor(sum(curve(adj) * w) / sum(w)). `weights` has the self-match zeroed.
 */
export function categoryScore(adj: ArrayLike<number>, weights: ArrayLike<number>, switches: boolean): number {
  let score = 0, total = 0;
  for (let j = 0; j < adj.length; j++) {
    let w = weights[j];
    if (!w) continue;
    let a = adj[j];
    if (a > 700) a = 700 + Math.pow(a - 700, 0.5);
    if (a < 300) a = Math.pow(300, (300 + a) / 600);
    if (switches && a < 500) w *= 1 + Math.pow(500 - a, 2) / 20000;
    score += a * w;
    total += w;
  }
  return Math.floor(score / total);
}

/** RankerOverall: weighted geometric mean of the sorted categories and consistency. */
export function overallScore(cat: readonly number[], consistency: number): number {
  const sorted = [cat[0], cat[1], Math.max(cat[2], cat[3]), cat[4]].sort((a, b) => b - a);
  let score = Math.pow(Math.pow(sorted[0], 12) * Math.pow(sorted[1], 6) * Math.pow(sorted[2], 4) * Math.pow(sorted[3], 2) * Math.pow(consistency, 2), 1 / 26);
  if (cat[4] <= 75 && consistency <= 75) score = Math.pow(Math.pow(score, 14) * Math.pow(cat[4], 1) * Math.pow(consistency, 1), 1 / 16);
  return Math.floor(score * 10) / 10;
}

/** Normalise a category to 100 of the best, to a tenth, as Ranker.js does. */
export const normalise = (s: number, top: number) => Math.floor((s / top) * 1000) / 10;

