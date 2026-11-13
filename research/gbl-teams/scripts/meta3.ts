// Scratch: meta search where every game is a full 3v3 with carried HP/energy/shields. Workers play the games.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { game } from './g3';
const S = process.env.S!;
if (!isMainThread) {
  parentPort!.on('message', (jobs: [string[], string[]][]) => parentPort!.postMessage(jobs.map(([a, b]) => game(a, b).v)));
} else {
  const NW = 10, LOGF = `${S}/meta3.log`;
  const log = (...x: any[]) => { const s = x.join(' '); console.log(s); appendFileSync(LOGF, s + '\n'); };
  writeFileSync(LOGF, '');
  const workers = Array.from({ length: NW }, () => new Worker(fileURLToPath(import.meta.url), { env: process.env }));
  async function play(jobs: [string[], string[]][]): Promise<number[]> {
    const out = new Array(jobs.length); const chunk = 40; let next = 0;
    await Promise.all(workers.map((w) => new Promise<void>((done) => {
      const go = () => { if (next >= jobs.length) return done(); const s = next; next += chunk; const part = jobs.slice(s, s + chunk);
        w.once('message', (r: number[]) => { r.forEach((v, i) => (out[s + i] = v)); go(); }); w.postMessage(part); };
      go();
    })));
    return out;
  }
  const uni = JSON.parse(readFileSync(`${S}/universe2.json`, 'utf8'));
  const U: string[] = uni.U, R = uni.R, id = Object.fromEntries(U.map((u, i) => [u, i]));
  const RA = U.map((_, i) => U.map((_, j) => (R.s11[i][j] + R.s22[i][j] + R.s00[i][j] + R.ch[i][j] + R.c0e[i][j]) / 5));
  const base = (u: string) => u.replace('_shadow', '').split('#')[0];
  const pool = JSON.parse(readFileSync(`${S}/oracle-out.json`, 'utf8')).pool as any[];
  pool.forEach((t) => (t.comp = 0.5 * t.fitEq + 0.3 * t.fitPool + 0.2 * t.fitLog));
  const cands: string[][] = JSON.parse(readFileSync(`${S}/cands.json`, 'utf8'));
  const key = (t: string[]) => t.slice().sort().join();
  const teams: string[][] = []; const seen = new Set<string>();
  const addTeam = (t: string[]) => { const k = key(t); if (seen.has(k)) return false; seen.add(k); teams.push(t); return true; };
  cands.forEach(addTeam); pool.sort((a, b) => b.comp - a.comp).slice(0, 200).forEach((t) => addTeam(t.A));
  // a strategy is a team with a chosen lead (the lead is blind, so it is part of the pick)
  const leads = (t: string[]) => [0, 1, 2].map((L) => [t[L], ...t.filter((_, i) => i !== L)]);
  let strat: string[][] = teams.flatMap(leads);
  const pay: number[][] = [];
  async function grow() {
    const jobs: [string[], string[]][] = [], at: [number, number][] = [];
    for (let i = 0; i < strat.length; i++) { pay[i] ??= []; for (let j = 0; j < strat.length; j++) if (j > i && pay[i][j] === undefined) { jobs.push([strat[i], strat[j]]); at.push([i, j]); } }
    const t0 = Date.now(); const v = await play(jobs);
    at.forEach(([i, j], k) => { pay[i][j] = v[k]; pay[j] ??= []; pay[j][i] = 1 - v[k]; });
    for (let i = 0; i < strat.length; i++) pay[i][i] = 0.5;
    log(`  played ${jobs.length} games in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  function solve() {
    const n = strat.length, cum = new Float64Array(n), cnt = new Float64Array(n); let k = 0, T = 0;
    for (let it = 0; it < 100000; it++) { cnt[k]++; T++; for (let i = 0; i < n; i++) cum[i] += pay[i][k]; let b = 0; for (let i = 1; i < n; i++) if (cum[i] > cum[b]) b = i; k = b; }
    return { x: Array.from(cnt, (c) => c / T), edge: Math.max(...cum) / T - 0.5 };
  }
  log(`start: ${teams.length} teams, ${strat.length} team+lead strategies`);
  await grow();
  let sol = solve();
  for (let round = 1; round <= 4; round++) {
    const sup = strat.map((s, i) => ({ s, w: sol.x[i] })).filter((o) => o.w > 0.004);
    const W = sup.reduce((a, b) => a + b.w, 0);
    log(`round ${round}: support ${sup.length}, best in-pool edge ${(sol.edge * 100).toFixed(2)}%`);
    // propose outside teams: pieces scored against the pieces the equilibrium fields
    const pw = new Array(U.length).fill(0); sup.forEach((o) => o.s.forEach((p) => (pw[id[p]] += o.w / W)));
    const opp = pw.map((x, i) => [x, i]).filter(([x]) => x > 0.005);
    const scored: [number, string[]][] = [];
    for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) for (let k = j + 1; k < U.length; k++) {
      if (new Set([base(U[i]), base(U[j]), base(U[k])]).size < 3) continue;
      const t = [U[i], U[j], U[k]]; if (seen.has(key(t))) continue;
      let s = 0; for (const [x, o] of opp) s += x * Math.max(RA[i][o], RA[j][o], RA[k][o]); scored.push([s, t]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const try_ = scored.slice(0, 120).map((x) => x[1]).flatMap(leads);
    const jobs: [string[], string[]][] = []; try_.forEach((s) => sup.forEach((o) => jobs.push([s, o.s])));
    const v = await play(jobs);
    const fit = try_.map((_, i) => sup.reduce((a, o, q) => a + o.w * v[i * sup.length + q], 0) / W);
    const best = try_.map((s, i) => ({ s, f: fit[i] })).sort((a, b) => b.f - a.f);
    log(`  best outside: ${best[0].s.join(' / ')} ${(best[0].f * 100).toFixed(1)}% vs the mix`);
    let added = 0; for (const b of best) { if (b.f <= 0.52 || added >= 25) break; if (addTeam(b.s)) { strat.push(...leads(b.s)); added++; } }
    log(`  added ${added} teams`);
    if (!added) break;
    await grow(); sol = solve();
  }
  sol = solve();
  const fitEq = strat.map((_, i) => strat.reduce((a, __, j) => a + sol.x[j] * pay[i][j], 0));
  const fitAll = strat.map((_, i) => pay[i].reduce((a, b) => a + b, 0) / strat.length);
  writeFileSync(`${S}/meta3-out.json`, JSON.stringify({ strat, share: sol.x, fitEq, fitAll, edge: sol.edge }));
  log(`done: ${teams.length} teams, ${strat.length} strategies, final in-pool edge ${(sol.edge * 100).toFixed(2)}%`);
  workers.forEach((w) => w.terminate());
}
