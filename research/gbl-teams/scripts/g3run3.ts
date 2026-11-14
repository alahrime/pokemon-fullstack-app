// Step 3 scoring: each candidate (its best lead by fitEq in meta4-out) plays the meta4 equilibrium and the logged
// teams, with lines kept. Run as shards: SHARD=0..9 NSHARD=10 UNI=universe3.json. Writes g3c-<shard>.json (not committed).
import { readFileSync, writeFileSync } from 'node:fs';
import { game, line } from './g3';
const S = process.env.S!, shard = +process.env.SHARD!, nsh = +process.env.NSHARD!, NC = +(process.env.NCAND ?? 300);
const m4 = JSON.parse(readFileSync(`${S}/meta4-out.json`, 'utf8'));
const eq = m4.strat.map((A: string[], i: number) => ({ A, share: m4.share[i] })).filter((t: any) => t.share > 0.003).sort((a: any, b: any) => b.share - a.share);
let cum = 0; const eqTop = eq.filter((t: any) => (cum += t.share) <= 0.92 || cum - t.share < 0.92);
const LOG = readFileSync(`${S}/teams2.txt`, 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((t) => t.length === 3);
// candidates: every pool team on its best lead, best first, plus the previous ranking's teams and the user's team
const key = (t: string[]) => t.slice().sort().join();
const best = new Map<string, { A: string[]; f: number }>();
m4.strat.forEach((A: string[], i: number) => { const k = key(A); if (!best.has(k) || best.get(k)!.f < m4.fitEq[i]) best.set(k, { A, f: m4.fitEq[i] }); });
const cands: string[][] = [...best.values()].sort((a, b) => b.f - a.f).slice(0, NC).map((x) => x.A);
for (const t of [...JSON.parse(readFileSync(`${S}/cands2.json`, 'utf8')), ['clodsire', 'hydreigon_shadow', 'dondozo']]) if (!cands.some((c) => key(c) === key(t))) cands.push(t);
const res: any[] = [];
cands.forEach((A, ci) => {
  if (ci % nsh !== shard) return;
  const vs = (B: string[]) => { const g: any = game(A, B, true);
    const ia = g.xA.indexOf(Math.max(...g.xA)), ib = g.xB.indexOf(Math.max(...g.xB));
    const ln = line(A, B, g.OA[ia], g.OB[ib]);
    return { B, v: g.v, plan: g.OA.map((o: any, i: number) => [o.join(':'), g.xA[i]]).filter((x: any) => x[1] > 0.02), ln }; };
  res.push({ team: A, A, eq: eqTop.map((t: any) => ({ ...vs(t.A), w: t.share })), log: LOG.map((B) => vs(B)) });
});
writeFileSync(`${S}/g3c-${shard}.json`, JSON.stringify(res));
console.log('shard', shard, 'done', res.length, 'of', cands.length);
