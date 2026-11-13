// Scratch: every meta piece vs every other, each on its best viable moveset; Dunsparce split by fast move.
import { readFileSync, writeFileSync } from 'node:fs';
import { movesFor, speciesOf } from '../../../app/src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../../../app/src/lib/engine';
import { rating, startingEnergy } from '../../../app/src/lib/scenarios';
const lg = 'great' as const;
const [m4, teamsFile, outFile] = process.argv.slice(2);
const best = JSON.parse(readFileSync(m4, 'utf8')).moves as Record<string, string[]>;
const RANK = JSON.parse(readFileSync('../data-src/rankings-1500.json', 'utf8')) as { speciesId: string }[];
const logged = readFileSync(teamsFile, 'utf8').split(/\s+/).filter(Boolean);
const U = [...new Set([...Object.keys(best), ...RANK.slice(0, 120).map((r) => r.speciesId), ...logged, 'dunsparce', 'dunsparce#ASTONISH', 'dunsparce#ROLLOUT'])].filter((r) => speciesOf(r.split('#')[0]));
const strip = (s: string) => s.replace(/[*+]$/, '');
const mon = (ref: string) => {
  const [id, fastOverride] = ref.split('#'); const sp = speciesOf(id)!;
  let fast, charges, names;
  if (id === 'dunsparce') { const m = movesFor(sp, lg, false); fast = sp.fastMoves.find((f) => f.id === (fastOverride ?? 'BITE'))!; charges = m.charges; }
  else if (best[id]) { const [f, ...c] = best[id].map(strip); fast = sp.fastMoves.find((x) => x.name === f)!; charges = c.map((n) => sp.chargeMoves.find((x) => x.name === n)!);
    if (!fast || charges.some((x) => !x)) { console.log('fallback to default moves:', id, best[id].join(' / ')); const m = movesFor(sp, lg, id.endsWith('_shadow')); fast = m.fast; charges = m.charges; } }
  else { const m = movesFor(sp, lg, id.endsWith('_shadow')); fast = m.fast; charges = m.charges; }
  names = [fast, ...charges].map((x) => x.name);
  return { m: mkBattleMon(bestSpreadFor(id, lg, true), fast, charges, sp.types), names };
};
const M = U.map(mon);
// one scenario, row's perspective: shields, and banked charged moves for each side (PvPoke's switch / charger states)
const one = (A: any, B: any, sa: number, sb: number, ka = 0, kb = 0) => { let s = 0; for (const pol of ['always', 'read'] as const)
  s += rating(battle(A, B, sa, sb, startingEnergy(A, ka), startingEnergy(B, kb), false, true, undefined, undefined, pol, pol), sa, sb); return s / 2; };
const SC: Record<string, [number, number, number, number]> = { s00: [0, 0, 0, 0], s01: [0, 1, 0, 0], s11: [1, 1, 0, 0], s22: [2, 2, 0, 0], sw: [1, 1, 0, 1], ch: [1, 1, 1, 0], c0e: [0, 0, 1, 0] };
const R: Record<string, number[][]> = {};
for (const [k, [sa, sb, ka, kb]] of Object.entries(SC)) R[k] = M.map((a) => M.map((b) => Math.round(one(a.m, b.m, sa, sb, ka, kb))));
writeFileSync(outFile, JSON.stringify({ U, moves: M.map((x) => x.names), R, rank: U.map((u) => RANK.findIndex((r) => r.speciesId === u.split('#')[0]) + 1) }));
console.log(U.length, 'pieces,', U.length ** 2 * 14, 'battles');
