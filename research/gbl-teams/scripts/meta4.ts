// Step 2: double oracle over every 3-piece team of universe3 (variants included). Each round, the 1v1 lead-swap
// model (oracle.mjs) prefilters all C(n,3) teams against the current mix; the top PROPOSE plus RANDOM sampled
// teams then play full 3v3 games (g3.ts) against the support. Workers cannot load .ts under tsx, so bundle first:
//   npx esbuild ../research/gbl-teams/scripts/meta4.ts --bundle --platform=node --format=esm --outfile=/tmp/meta4.mjs
//   S=$PWD/../research/gbl-teams/data UNI=universe3.json node /tmp/meta4.mjs
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { game } from './g3';
const S = process.env.S!, UNI = process.env.UNI ?? 'universe3.json';
const uni = JSON.parse(readFileSync(`${S}/${UNI}`, 'utf8'));
const U: string[] = uni.U, N = U.length, R = uni.R, id: Record<string, number> = Object.fromEntries(U.map((u, i) => [u, i]));
// ---- the 1v1 lead-swap model, as in oracle.mjs ----
const avg = (...m: number[][][]) => m[0].map((row, i) => row.map((_, j) => m.reduce((s, x) => s + x[i][j], 0) / m.length));
const T = (m: number[][]) => m[0].map((_, j) => m.map((r) => r[j]));
const inv = (m: number[][]) => T(m).map((r) => r.map((x) => 1000 - x));
const LEAD = avg(R.s11, R.s22), SWIN = avg(R.sw, inv(R.sw)), MID = avg(R.s11, R.ch, inv(R.ch)), CLOSE = avg(R.s00, R.s01, R.c0e, inv(R.c0e));
const RA = avg(LEAD, MID, CLOSE), SWAP = 40;
function back(Rm: number[], Q: number[]) {
  const [r0, r1] = Rm, [q0, q1] = Q, val = (f: number, s: number, x: number, y: number) => MID[x][f] + CLOSE[y][s], ord = [[q0, q1], [q1, q0]];
  const minmax = Math.min(...ord.map(([f, s]) => Math.max(val(f, s, r0, r1), val(f, s, r1, r0))));
  const maxmin = Math.max(...[[r0, r1], [r1, r0]].map(([x, y]) => Math.min(...ord.map(([f, s]) => val(f, s, x, y)))));
  return (minmax + maxmin) / 2;
}
function g(A: number[], B: number[]) {
  const opts = [[A[0], 0], [A[1], 1]], topt = [[B[0], 0], [B[1], 1], [B[2], 1]];
  const grid = opts.map(([m, ms]) => topt.map(([t, ts]) => {
    const lead = ms && !ts ? SWIN[m][t] - SWAP : !ms && ts ? SWIN[m][t] + SWAP : LEAD[m][t];
    return (lead + back(A.filter((x) => x !== m), B.filter((x) => x !== t))) / 3;
  }));
  const maxmin = Math.max(...grid.map((r) => Math.min(...r)));
  const minmax = Math.min(...grid[0].map((_, j) => Math.max(...grid.map((r) => r[j]))));
  return (maxmin + minmax) / 2;
}
const P = (A: number[], B: number[]) => { const v = (g(A, B) + 1000 - g(B, A)) / 2; return 1 / (1 + Math.exp(-(v - 500) / 40)); };
const ORD = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
// ABA: lead and closer both lose (RA < 500) to the same meaningful opponent. A penalty, not a cut.
const MEAN = Object.keys(JSON.parse(readFileSync(`${S}/variants.json`, 'utf8')).meaningful).map((u) => id[u]);
const ABA_EACH = 0.005, ABA_CAP = 0.02;
const aba = (A: number[]) => MEAN.filter((o) => RA[A[0]][o] < 500 && RA[A[2]][o] < 500).length;
const base = (u: string) => u.replace('_shadow', '').split('#')[0];
// ridge regression: y ~ b . [1, ...x] + sum of a[p] over the team's pieces p; lambda penalises the piece terms only
function ridge(rows: { x: number[]; p: number[]; y: number }[], nP: number, lambda: number) {
  const nx = rows[0].x.length + 1, n = nx + nP, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
  for (const r of rows) { const f: [number, number][] = [[0, 1], ...r.x.map((v, i) => [i + 1, v] as [number, number]), ...r.p.map((q) => [nx + q, 1] as [number, number])];
    for (const [i, vi] of f) { b[i] += vi * r.y; for (const [j, vj] of f) A[i][j] += vi * vj; } }
  for (let i = nx; i < n; i++) A[i][i] += lambda;
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]; const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c && A[r][c]) { const m = A[r][c] / d; for (let k = c; k < n; k++) A[r][k] -= m * A[c][k]; b[r] -= m * b[c]; } }
  const sol = Array.from(b, (v, i) => v / (A[i][i] || 1e-12));
  return { b: sol.slice(0, nx), a: sol.slice(nx) };
}

if (!isMainThread) {
  const { all, score, order, nw, w } = workerData as any; // shared buffers
  const ALL = new Int16Array(all), SC = new Float32Array(score), OR = new Int8Array(order);
  parentPort!.on('message', (m: any) => {
    if (m.kind === 'games') return parentPort!.postMessage(m.jobs.map(([a, b]: [string[], string[]]) => game(a, b).v));
    const sup: number[][] = m.sup, wts: number[] = m.wts;
    for (let k = w; k < ALL.length / 3; k += nw) {
      const t = [ALL[3 * k], ALL[3 * k + 1], ALL[3 * k + 2]]; let best = -1, bo = 0;
      for (let o = 0; o < 6; o++) { const A = ORD[o].map((x) => t[x]); let s = 0; for (let q = 0; q < sup.length; q++) s += wts[q] * P(A, sup[q]);
        s -= Math.min(ABA_CAP, ABA_EACH * aba(A)); if (s > best) { best = s; bo = o; } }
      SC[k] = best; OR[k] = bo;
    }
    parentPort!.postMessage('done');
  });
} else main();
async function main() {
  const NW = 10, LOGF = `${S}/meta4.log`, PROPOSE = +(process.env.PROPOSE ?? 4000), RANDOM = +(process.env.RANDOM ?? 500), WAVE2 = +(process.env.WAVE2 ?? 1000), ROUNDS = 6;
  const log = (...x: any[]) => { const s = x.join(' '); console.log(s); appendFileSync(LOGF, s + '\n'); };
  writeFileSync(LOGF, '');
  const tri: number[] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++)
    if (new Set([base(U[i]), base(U[j]), base(U[k])]).size === 3) tri.push(i, j, k);
  const nT = tri.length / 3;
  const allB = new SharedArrayBuffer(tri.length * 2), scB = new SharedArrayBuffer(nT * 4), orB = new SharedArrayBuffer(nT);
  new Int16Array(allB).set(tri); const SC = new Float32Array(scB), OR = new Int8Array(orB);
  const workers = Array.from({ length: NW }, (_, w) => new Worker(fileURLToPath(import.meta.url), { env: process.env, workerData: { all: allB, score: scB, order: orB, nw: NW, w } }));
  log(`${N} pieces, ${nT} teams (same-species pairs dropped)`);
  // memo of every game played, keyed by both strategies
  // append-only tab-separated file, so a restart skips every game already played (not committed: large)
  const memo = new Map<string, number>(); const MEMO = `${S}/meta4-memo.tsv`; let fresh: string[] = [];
  if (existsSync(MEMO)) for (const l of readFileSync(MEMO, 'utf8').split('\n')) { const t = l.indexOf('\t'); if (t > 0) memo.set(l.slice(0, t), +l.slice(t + 1)); }
  const gk = (a: string[], b: string[]) => a.join(',') + '|' + b.join(',');
  async function play(pairs: [string[], string[]][]): Promise<number[]> {
    const need = pairs.filter(([a, b]) => !memo.has(gk(a, b)) && !memo.has(gk(b, a)));
    const out = new Array(need.length); const chunk = 40; let next = 0;
    await Promise.all(workers.map((w) => new Promise<void>((done) => {
      const go = () => { if (next >= need.length) return done(); const s = next; next += chunk; const part = need.slice(s, s + chunk);
        w.once('message', (r: number[]) => { r.forEach((v, i) => (out[s + i] = v)); go(); }); w.postMessage({ kind: 'games', jobs: part }); };
      go();
    })));
    need.forEach(([a, b], i) => { memo.set(gk(a, b), out[i]); fresh.push(gk(a, b) + '\t' + out[i]); });
    return pairs.map(([a, b]) => memo.get(gk(a, b)) ?? 1 - memo.get(gk(b, a))!);
  }
  const saveMemo = () => { for (let i = 0; i < fresh.length; i += 50000) appendFileSync(MEMO, fresh.slice(i, i + 50000).join('\n') + '\n'); fresh = []; };
  const m3 = JSON.parse(readFileSync(`${S}/meta3-out.json`, 'utf8'));
  let strat: string[][] = m3.strat.slice();
  const key = (t: string[]) => t.slice().sort().join();
  const seen = new Set(strat.map(key));
  const leads = (t: string[]) => [0, 1, 2].map((L) => [t[L], ...t.filter((_, i) => i !== L)]);
  let pay: number[][] = [];
  async function grow() {
    const pairs: [string[], string[]][] = [], at: [number, number][] = [];
    for (let i = 0; i < strat.length; i++) for (let j = i + 1; j < strat.length; j++) if (pay[i]?.[j] === undefined) { pairs.push([strat[i], strat[j]]); at.push([i, j]); }
    const t0 = Date.now(), before = memo.size; const v = await play(pairs);
    at.forEach(([i, j], k) => { (pay[i] ??= [])[j] = v[k]; (pay[j] ??= [])[i] = 1 - v[k]; });
    for (let i = 0; i < strat.length; i++) (pay[i] ??= [])[i] = 0.5;
    log(`  grow: ${pairs.length} pairs, ${memo.size - before} new games in ${((Date.now() - t0) / 1000).toFixed(0)}s`); saveMemo();
  }
  function solve() {
    const n = strat.length, cum = new Float64Array(n), cnt = new Float64Array(n); let k = 0, Tn = 0;
    for (let it = 0; it < 100000; it++) { cnt[k]++; Tn++; for (let i = 0; i < n; i++) cum[i] += pay[i][k]; let b = 0; for (let i = 1; i < n; i++) if (cum[i] > cum[b]) b = i; k = b; }
    return { x: Array.from(cnt, (c) => c / Tn), edge: Math.max(...cum) / Tn - 0.5 };
  }
  // ---- check: the 214-team, 642-strategy pool of meta3 must give the same top 5 within ±2% share ----
  log(`check: replaying meta3's ${strat.length} strategies`);
  await grow(); let sol = solve();
  const top = (x: number[]) => strat.map((s, i) => ({ s: s.join(' / '), w: x[i] })).sort((a, b) => b.w - a.w).slice(0, 5);
  const old = new Map<string, number>(m3.strat.map((s: string[], i: number) => [s.join(' / '), m3.share[i]]));
  let ok = true; for (const t of top(m3.share)) { const now = sol.x[strat.findIndex((s) => s.join(' / ') === t.s)];
    const good = Math.abs(now - t.w) <= 0.02; ok &&= good; log(`  ${t.s}: meta3 ${(t.w * 100).toFixed(2)}%, now ${(now * 100).toFixed(2)}% ${good ? 'ok' : 'FAIL'}`); }
  if (!ok) { log('check FAILED, stopping'); process.exit(1); }
  const added: any[] = []; let rng = 12345; const rnd = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let round = 1; round <= ROUNDS; round++) {
    const supI = strat.map((_, i) => i).filter((i) => sol.x[i] > 0.004), W = supI.reduce((a, i) => a + sol.x[i], 0);
    log(`round ${round}: ${strat.length / 3} teams, support ${supI.length}, in-pool edge ${(sol.edge * 100).toFixed(2)}%`);
    log(`  mix: ${supI.map((i) => ({ i, w: sol.x[i] })).sort((a, b) => b.w - a.w).slice(0, 6).map((o) => `${strat[o.i].join('/')} ${(o.w * 100).toFixed(1)}%`).join(', ')}`);
    const t0 = Date.now();
    const sup = supI.map((i) => strat[i].map((p) => id[p])), wts = supI.map((i) => sol.x[i] / W);
    await Promise.all(workers.map((w) => new Promise<void>((done) => { w.once('message', () => done()); w.postMessage({ kind: 'pref', sup, wts }); })));
    const idx = Array.from({ length: nT }, (_, k) => k).filter((k) => !seen.has(key([tri[3 * k], tri[3 * k + 1], tri[3 * k + 2]].map((x) => U[x]))));
    idx.sort((a, b) => SC[b] - SC[a]);
    const rankOf = new Map(idx.map((k, r) => [k, r + 1]));
    const pick = idx.slice(0, PROPOSE), rest = idx.slice(PROPOSE);
    for (let q = 0; q < RANDOM && rest.length; q++) pick.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
    log(`  prefilter: ${idx.length} teams in ${((Date.now() - t0) / 1000).toFixed(0)}s, top ${SC[idx[0]].toFixed(3)}, #${PROPOSE} ${SC[idx[PROPOSE - 1]].toFixed(3)}`);
    const teams = pick.map((k) => ORD[OR[k]].map((x) => U[tri[3 * k + x]]));
    const tries = teams.flatMap(leads), pairs: [string[], string[]][] = [];
    tries.forEach((s) => supI.forEach((i) => pairs.push([s, strat[i]])));
    const t1 = Date.now(); const v = await play(pairs);
    log(`  played ${pairs.length} proposal games in ${((Date.now() - t1) / 1000).toFixed(0)}s`); saveMemo();
    const fitOf = (tr: string[][], vv: number[]) => tr.map((_, a) => supI.reduce((s, i, q) => s + sol.x[i] * vv[a * supI.length + q], 0) / W);
    const fit = fitOf(tries, v);
    let res = tries.map((s, a) => ({ s, f: fit[a], k: pick[Math.floor(a / 3)], rand: Math.floor(a / 3) >= PROPOSE, wave: 1 })).sort((a, b) => b.f - a.f);
    // wave 2: the 1v1 prefilter misjudges some pieces (round 1 of the first run added teams from as deep as #3910 of 4000).
    // Fit y = b0 + b1 * prefilter + sum of per-piece terms (ridge) on wave 1's team results, re-rank every team, play the
    // best WAVE2 not yet tried. ponytail: additive per-piece correction only; add pair terms if wave 2 still finds deep teams.
    const teamF = new Map<number, number>(); res.forEach((r) => teamF.set(r.k, Math.max(teamF.get(r.k) ?? 0, r.f)));
    const coef = ridge([...teamF].map(([k, y]) => ({ x: [SC[k]], p: [tri[3 * k], tri[3 * k + 1], tri[3 * k + 2]], y })), N, 0.5);
    const pred = (k: number) => coef.b[0] + coef.b[1] * SC[k] + coef.a[tri[3 * k]] + coef.a[tri[3 * k + 1]] + coef.a[tri[3 * k + 2]];
    const tried = new Set(pick); const byPred = idx.filter((k) => !tried.has(k)).sort((a, b) => pred(b) - pred(a)).slice(0, WAVE2);
    const teams2 = byPred.map((k) => ORD[OR[k]].map((x) => U[tri[3 * k + x]])), tries2 = teams2.flatMap(leads), pairs2: [string[], string[]][] = [];
    tries2.forEach((s) => supI.forEach((i) => pairs2.push([s, strat[i]])));
    const t2 = Date.now(); const v2 = await play(pairs2); saveMemo(); const fit2 = fitOf(tries2, v2);
    const res2 = tries2.map((s, a) => ({ s, f: fit2[a], k: byPred[Math.floor(a / 3)], rand: false, wave: 2 }));
    const tf2 = new Map<number, number>(); res2.forEach((r) => tf2.set(r.k, Math.max(tf2.get(r.k) ?? 0, r.f)));
    const corr = (xs: number[], ys: number[]) => { const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); };
    const w1 = [...teamF], w2 = [...tf2];
    log(`  wave 2: ${byPred.length} teams by corrected score in ${((Date.now() - t2) / 1000).toFixed(0)}s; best ${(Math.max(...w2.map((x) => x[1])) * 100).toFixed(1)}% vs wave 1 best ${(Math.max(...w1.map((x) => x[1])) * 100).toFixed(1)}%; `
      + `corr with result: prefilter ${corr(w1.map((x) => SC[x[0]]), w1.map((x) => x[1])).toFixed(2)} (wave 1), corrected ${corr(w2.map((x) => pred(x[0])), w2.map((x) => x[1])).toFixed(2)} (wave 2, out of sample); `
      + `teams > 51%: wave 1 ${w1.filter((x) => x[1] > 0.51).length}, wave 2 ${w2.filter((x) => x[1] > 0.51).length}`);
    res = [...res, ...res2].sort((a, b) => b.f - a.f);
    const bestRand = res.find((r) => r.rand)!;
    log(`  best: ${res[0].s.join(' / ')} ${(res[0].f * 100).toFixed(1)}% (prefilter #${rankOf.get(res[0].k)}); best random-sample team ${(bestRand.f * 100).toFixed(1)}% (#${rankOf.get(bestRand.k)})`);
    const top50 = res.slice(0, 50).map((r) => rankOf.get(r.k)!).sort((a, b) => a - b);
    log(`  prefilter ranks of the best 50 proposals: median #${top50[25]}, worst #${top50[49]}, ${res.slice(0, 50).filter((r) => r.rand).length} from the random sample`);
    if (res[0].f <= 0.505) { log('  no proposal clears 0.5%: converged'); break; }
    const thr = res[0].f > 0.51 ? 0.51 : 0.505; let n = 0;
    for (const r of res) { if (r.f <= thr || n >= 40) break; const t = r.s; if (seen.has(key(t))) continue; seen.add(key(t)); strat.push(...leads(t)); n++;
      added.push({ round, team: t, f: r.f, prefRank: rankOf.get(r.k), random: r.rand, wave: r.wave }); log(`  + ${t.join(' / ')} ${(r.f * 100).toFixed(1)}% prefilter #${rankOf.get(r.k)}${r.rand ? ' (random)' : r.wave === 2 ? ' (wave 2)' : ''}`); }
    await grow(); sol = solve();
  }
  sol = solve();
  const fitEq = strat.map((_, i) => strat.reduce((a, __, j) => a + sol.x[j] * pay[i][j], 0));
  const fitAll = strat.map((_, i) => pay[i].reduce((a, b) => a + b, 0) / strat.length);
  writeFileSync(`${S}/meta4-out.json`, JSON.stringify({ strat, share: sol.x, fitEq, fitAll, edge: sol.edge, added }));
  log(`done: ${strat.length / 3} teams, ${strat.length} strategies, support ${sol.x.filter((x) => x > 0.004).length}, final in-pool edge ${(sol.edge * 100).toFixed(2)}%`);
  for (const t of strat.map((s, i) => ({ s, w: sol.x[i] })).sort((a, b) => b.w - a.w).slice(0, 12)) log(`  ${(t.w * 100).toFixed(1)}%  ${t.s.join(' / ')}`);
  workers.forEach((w) => w.terminate());
}
