// Double oracle over the full 3-piece team space: solve the pool's equilibrium, add the teams that beat it, repeat.
import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('universe2.json', 'utf8'));
const U = d.U, N = U.length, id = Object.fromEntries(U.map((u, i) => [u, i])), R = d.R;
const avg = (...m) => m[0].map((row, i) => row.map((_, j) => m.reduce((s, x) => s + x[i][j], 0) / m.length));
const T = (m) => m[0].map((_, j) => m.map((r) => r[j]));
const inv = (m) => T(m).map((r) => r.map((x) => 1000 - x));          // their rating in that scenario, seen from my side
const LEAD = avg(R.s11, R.s22);                                     // shields up
const SWIN = avg(R.sw, inv(R.sw));                                  // I come in on a banked lead | they come in on mine
const MID = avg(R.s11, R.ch, inv(R.ch));                            // mid-game, either side may be holding a move
const CLOSE = avg(R.s00, R.s01, R.c0e, inv(R.c0e));                 // shields down; energy saved by pivoting counts
const SWAP = 40;
const LOG = readFileSync('teams2.txt', 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/).map((x) => id[x])).filter((t) => t.length === 3);

function back(Rm, Q) {
  const [r0, r1] = Rm, [q0, q1] = Q, val = (f, s, x, y) => MID[x][f] + CLOSE[y][s], ord = [[q0, q1], [q1, q0]];
  const minmax = Math.min(...ord.map(([f, s]) => Math.max(val(f, s, r0, r1), val(f, s, r1, r0))));
  const maxmin = Math.max(...[[r0, r1], [r1, r0]].map(([x, y]) => Math.min(...ord.map(([f, s]) => val(f, s, x, y)))));
  return (minmax + maxmin) / 2;
}
function g(A, B) {
  let mm = -1e9; const cols = [];
  const opts = [[A[0], 0], [A[1], 1]], topt = [[B[0], 0], [B[1], 1], [B[2], 1]];
  const grid = opts.map(([m, ms]) => topt.map(([t, ts]) => {
    const lead = ms && !ts ? SWIN[m][t] - SWAP : !ms && ts ? SWIN[m][t] + SWAP : LEAD[m][t];
    return (lead + back(A.filter((x) => x !== m), B.filter((x) => x !== t))) / 3;
  }));
  const maxmin = Math.max(...grid.map((r) => Math.min(...r)));
  const minmax = Math.min(...grid[0].map((_, j) => Math.max(...grid.map((r) => r[j]))));
  return (maxmin + minmax) / 2;
}
const P = (A, B) => { const v = (g(A, B) + 1000 - g(B, A)) / 2; return 1 / (1 + Math.exp(-(v - 500) / 40)); };
const ORD = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const base = (u) => u.replace('_shadow', '').split('#')[0];
const ALL = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++)
  if (new Set([base(U[i]), base(U[j]), base(U[k])]).size === 3) ALL.push([i, j, k]);
const RA = avg(LEAD, MID, CLOSE);
const bestOrder = (t, vs, wts) => { let b = null; for (const o of ORD) { const A = o.map((x) => t[x]); let s = 0; for (let q = 0; q < vs.length; q++) s += wts[q] * P(A, vs[q]); if (!b || s > b.f) b = { A, f: s }; } return b; };
const key = (A) => A.slice().sort((a, b) => a - b).join();

// initial pool: the logged teams plus the best 150 against them
const lw = LOG.map(() => 1 / LOG.length);
const pw = new Array(N).fill(0); LOG.flat().forEach((x) => pw[x]++);
function topByPieces(w, n) {
  const opp = w.map((x, i) => [x, i]).filter(([x]) => x > 1e-6);
  return ALL.map((t) => { let s = 0; for (const [x, o] of opp) s += x * Math.max(RA[t[0]][o], RA[t[1]][o], RA[t[2]][o]); return [s, t]; }).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]);
}
let pool = [], seen = new Set();
const add = (A) => { const k = key(A); if (seen.has(k)) return false; seen.add(k); pool.push(A); return true; };
LOG.forEach((A) => add(A));
for (const t of topByPieces(pw, 600).map((t) => bestOrder(t, LOG, lw)).sort((a, b) => b.f - a.f).slice(0, 150)) add(t.A);
let pay = [];
const grow = () => { for (let i = 0; i < pool.length; i++) { pay[i] ??= []; for (let j = pay[i].length; j < pool.length; j++) pay[i][j] = i === j ? 0.5 : (j < i ? 1 - pay[j][i] : P(pool[i], pool[j])); } };
function solve() {
  const n = pool.length, cum = new Float64Array(n), cnt = new Float64Array(n); let k = 0, Tn = 0;
  for (let it = 0; it < 60000; it++) { cnt[k]++; Tn++; for (let i = 0; i < n; i++) cum[i] += pay[i][k]; let b = 0; for (let i = 1; i < n; i++) if (cum[i] > cum[b]) b = i; k = b; }
  return Array.from(cnt, (c) => c / Tn);
}
let x;
for (let iter = 1; iter <= 12; iter++) {
  grow(); x = solve();
  const sup = pool.map((A, i) => [A, x[i]]).filter(([, w]) => w > 0.003), vs = sup.map((s) => s[0]), wts = sup.map((s) => s[1] / sup.reduce((a, b) => a + b[1], 0));
  const piece = new Array(N).fill(0); sup.forEach(([A, w]) => A.forEach((a) => (piece[a] += w)));
  // iterative weighting: pieces are scored against what the equilibrium actually fields
  const cands = topByPieces(piece, 12000).map((t) => bestOrder(t, vs, wts)).sort((a, b) => b.f - a.f);
  let added = 0; for (const c of cands.slice(0, 200)) { if (c.f <= 0.51) break; if (add(c.A)) added++; if (added >= 40) break; }
  console.log(`iter ${iter}: pool ${pool.length}, support ${sup.length}, best outside team wins ${(cands[0].f * 100).toFixed(1)}% vs the mix (${cands[0].A.map((a) => U[a]).join(' / ')}), added ${added}`);
  if (!added) break;
}
grow(); x = solve();
const sup = pool.map((A, i) => [A, x[i], i]).filter(([, w]) => w > 0.003);
const fitEq = pool.map((_, i) => sup.reduce((s, [, w, j]) => s + w * pay[i][j], 0) / sup.reduce((s, [, w]) => s + w, 0));
const fitLog = pool.map((A) => LOG.reduce((s, B) => s + P(A, B), 0) / LOG.length);
const fitPool = pool.map((_, i) => pay[i].reduce((a, b) => a + b, 0) / pool.length);
writeFileSync('oracle-out.json', JSON.stringify({ U, moves: d.moves, pool: pool.map((A, i) => ({ A: A.map((a) => U[a]), share: x[i], fitEq: fitEq[i], fitLog: fitLog[i], fitPool: fitPool[i] })) }));
