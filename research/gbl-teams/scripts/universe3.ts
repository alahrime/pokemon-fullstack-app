// Step 2 input: universe2 plus the kept moveset variants (variants.json). Old rows are copied, new rows and columns played.
import { readFileSync, writeFileSync } from 'node:fs';
import { speciesOf } from '../../../app/src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../../../app/src/lib/engine';
import { rating, startingEnergy } from '../../../app/src/lib/scenarios';
import { mon } from './g3';
const S = process.env.S!;
const u2 = JSON.parse(readFileSync(`${S}/universe2.json`, 'utf8'));
const kept = JSON.parse(readFileSync(`${S}/variants.json`, 'utf8')).kept as { ref: string; moves: string[] }[];
const U: string[] = [...u2.U, ...kept.map((k) => k.ref)], moves = [...u2.moves, ...kept.map((k) => k.moves)], n0 = u2.U.length;
const M = U.map((u, i) => {
  if (i < n0) return mon(u);
  const id = u.split('#')[0], sp = speciesOf(id)!, [f, ...c] = moves[i];
  return mkBattleMon(bestSpreadFor(id, 'great', true), sp.fastMoves.find((x) => x.name === f)!, c.map((x) => sp.chargeMoves.find((y) => y.name === x)!), sp.types);
});
const one = (A: any, B: any, sa: number, sb: number, ka = 0, kb = 0) => { let s = 0; for (const pol of ['always', 'read'] as const)
  s += rating(battle(A, B, sa, sb, startingEnergy(A, ka), startingEnergy(B, kb), false, true, undefined, undefined, pol, pol), sa, sb); return s / 2; };
const SC: Record<string, [number, number, number, number]> = { s00: [0, 0, 0, 0], s01: [0, 1, 0, 0], s11: [1, 1, 0, 0], s22: [2, 2, 0, 0], sw: [1, 1, 0, 1], ch: [1, 1, 1, 0], c0e: [0, 0, 1, 0] };
const R: Record<string, number[][]> = {};
for (const [k, [sa, sb, ka, kb]] of Object.entries(SC))
  R[k] = M.map((a, i) => M.map((b, j) => (i < n0 && j < n0 ? u2.R[k][i][j] : Math.round(one(a, b, sa, sb, ka, kb)))));
// spot check: replaying a few old cells must give the stored numbers
for (const [i, j] of [[0, 1], [4, 30], [50, 162]]) if (Math.round(one(M[i], M[j], 1, 1)) !== u2.R.s11[i][j]) throw new Error(`old cell ${U[i]} vs ${U[j]} changed`);
writeFileSync(`${S}/universe3.json`, JSON.stringify({ U, moves, R, rank: U.map((u) => u2.rank[u2.U.indexOf(u)] ?? u2.rank[u2.U.indexOf(u.split('#')[0])] ?? 0) }));
console.log(U.length, 'pieces');
