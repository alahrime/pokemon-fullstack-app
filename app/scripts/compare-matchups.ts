/**
 * Our per-matchup ratings against PvPoke's published ones.
 *
 * Their ranking entries carry `matchups` (best five) and `counters` (worst
 * five), each an opponent plus a 0–1000 rating on the same scale ours uses.
 * That is a direct, per-battle comparison — the thing BACKLOG §3 asks for
 * before reopening any inversion, and the only test that separates "our
 * aggregation differs" from "our simulation differs".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { movesFor, speciesOf } from '../src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../src/lib/engine';
import { CATEGORIES, SCENARIOS, rating, startingEnergy, weightedScore } from '../src/lib/scenarios';
import type { ScenarioId } from '../src/lib/scenarios';

const RAW = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'data-src', 'rankings-1500.json'), 'utf8')) as {
  speciesId: string;
  matchups?: { opponent: string; rating: number }[];
  counters?: { opponent: string; rating: number }[];
  editorScore?: number;
  score: number;
}[];

const lg = 'great' as const;
const overall = CATEGORIES.find((c) => c.id === 'overall')!;
const mk = (r: string) => {
  const sp = speciesOf(r)!;
  const m = movesFor(sp, lg);
  return mkBattleMon(bestSpreadFor(r, lg, true), m.fast, m.charges, sp.types);
};

/** Our rating for one matchup under several readings of "the scenario". */
function ours(a: string, b: string) {
  const A = mk(a);
  const B = mk(b);
  const per = {} as Record<ScenarioId, number>;
  const one = (sh: number) => {
    let s = 0;
    for (const pol of ['always', 'read'] as const)
      s += rating(battle(A, B, sh, sh, 0, 0, false, true, undefined, undefined, pol, pol), sh, sh);
    return s / 2;
  };
  for (const sc of SCENARIOS) {
    let s = 0;
    for (const pol of ['always', 'read'] as const)
      s += rating(battle(A, B, sc.shieldsA, sc.shieldsB,
        startingEnergy(A, sc.bankedA), startingEnergy(B, sc.bankedB),
        false, true, undefined, undefined, pol, pol), sc.shieldsA, sc.shieldsB);
    per[sc.id] = s / 2;
  }
  return {
    sh00: one(0), sh11: one(1), sh22: one(2),
    blend: weightedScore(per, overall.weights),
    // Their engine throws the moment a move is available and always shields.
    naive: rating(battle(A, B, 1, 1, 0, 0, false, false, undefined, undefined, 'always', 'always'), 1, 1),
  };
}

interface Row { a: string; b: string; theirs: number; ours: ReturnType<typeof ours> }
const rows: Row[] = [];
for (const e of RAW) {
  if (!speciesOf(e.speciesId)) continue;
  for (const m of [...(e.matchups ?? []), ...(e.counters ?? [])]) {
    if (!speciesOf(m.opponent)) continue;
    rows.push({ a: e.speciesId, b: m.opponent, theirs: m.rating, ours: ours(e.speciesId, m.opponent) });
  }
}

const stat = (key: keyof ReturnType<typeof ours>) => {
  const x = rows.map((r) => r.ours[key]);
  const y = rows.map((r) => r.theirs);
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let cov = 0; let sx = 0; let sy = 0; let mae = 0; let agree = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    sx += (x[i] - mx) ** 2;
    sy += (y[i] - my) ** 2;
    mae += Math.abs(x[i] - y[i]);
    // Do we at least agree on who wins?
    if ((x[i] >= 500) === (y[i] >= 500)) agree++;
  }
  return { r: cov / Math.sqrt(sx * sy), mae: mae / x.length, agree: agree / x.length };
};

console.log(`${rows.length} published matchups compared (Great League)\n`);
console.log('our reading            correlation   mean abs error   agree on winner');
for (const k of ['blend', 'sh11', 'sh00', 'sh22', 'naive'] as const) {
  const s = stat(k);
  console.log(`  ${k.padEnd(20)}${s.r.toFixed(3).padStart(10)}${s.mae.toFixed(0).padStart(16)}${(s.agree * 100).toFixed(1).padStart(16)}%`);
}

// Where do we disagree hardest, using the closest reading?
const best = 'sh11' as const;
const worst = [...rows].sort((p, q) => Math.abs(q.ours[best] - q.theirs) - Math.abs(p.ours[best] - p.theirs));
console.log(`\nlargest disagreements (${best}):`);
console.log('  attacker            opponent            theirs   ours    gap');
for (const r of worst.slice(0, 14))
  console.log(`  ${r.a.padEnd(20)}${r.b.padEnd(20)}${String(r.theirs).padStart(6)}${r.ours[best].toFixed(0).padStart(7)}` +
    `${(r.ours[best] - r.theirs).toFixed(0).padStart(7)}`);

// The matchup that started this.
const reg = rows.filter((r) => r.a === 'registeel');
console.log('\nRegisteel, every published matchup:');
for (const r of reg)
  console.log(`  vs ${r.b.padEnd(20)} theirs ${String(r.theirs).padStart(4)}   ours sh11 ${r.ours.sh11.toFixed(0).padStart(4)}` +
    `  sh22 ${r.ours.sh22.toFixed(0).padStart(4)}  blend ${r.ours.blend.toFixed(0).padStart(4)}`);

const overridden = RAW.filter((e) => e.editorScore != null && e.editorScore > 0);
console.log(`\n${overridden.length} of ${RAW.length} Great species carry an editor override (75% of their published score)`);
console.log('  including: ' + overridden.slice(0, 10).map((e) => e.speciesId).join(', '));
const regOverride = RAW.find((e) => e.speciesId === 'registeel');
console.log(`  registeel editorScore: ${regOverride?.editorScore ?? 'none'}  (published score ${regOverride?.score})`);
