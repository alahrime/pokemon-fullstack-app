import { readFileSync, writeFileSync } from 'node:fs';
import { game, line } from './g3';
const S = process.env.S!, shard = +process.env.SHARD!, nsh = +process.env.NSHARD!;
const m3 = JSON.parse(readFileSync(`${S}/meta3-out.json`, 'utf8'));
const eq = m3.strat.map((A: string[], i: number) => ({ A, share: m3.share[i] })).filter((t: any) => t.share > 0.003).sort((a: any, b: any) => b.share - a.share);
let cum = 0; const eqTop = eq.filter((t) => (cum += t.share) <= 0.92 || cum - t.share < 0.92);
const LOG = readFileSync(`${S}/teams2.txt`, 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((t) => t.length === 3);
const cands: string[][] = JSON.parse(readFileSync(`${S}/cands2.json`, 'utf8'));
const res: any[] = [];
cands.forEach((team, ci) => {
  if (ci % nsh !== shard) return;
  { const A = team;
    const vs = (B: string[]) => { const g: any = game(A, B, true);
      const ia = g.xA.indexOf(Math.max(...g.xA)), ib = g.xB.indexOf(Math.max(...g.xB));
      const ln = line(A, B, g.OA[ia], g.OB[ib]);
      return { B, v: g.v, plan: g.OA.map((o: any, i: number) => [o.join(':'), g.xA[i]]).filter((x: any) => x[1] > 0.02), ln }; };
    res.push({ team, A, eq: eqTop.map((t) => ({ ...vs(t.A), w: t.share })), log: LOG.map((B) => vs(B)) });
  }
});
writeFileSync(`${S}/g3b-${shard}.json`, JSON.stringify(res));
console.log('shard', shard, 'done', res.length);
