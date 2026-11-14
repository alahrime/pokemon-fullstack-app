// Step 1: moveset variants as pieces, kept only when they drastically change a meaningful 1v1 matchup.
// Writes variants.json (kept, aliases, shadow pairs) and prints the kept list with the matchups that justify each.
import { readFileSync, writeFileSync } from 'node:fs';
import { speciesOf } from '../../../app/src/lib/data';
import { battle, bestSpreadFor, mkBattleMon, fastMoveStats, chargeMoveStats } from '../../../app/src/lib/engine';
import { rating, startingEnergy } from '../../../app/src/lib/scenarios';
import { mon } from './g3';
const lg = 'great' as const, S = process.env.S!;
const uni = JSON.parse(readFileSync(`${S}/universe2.json`, 'utf8'));
const U: string[] = uni.U;
const m3 = JSON.parse(readFileSync(`${S}/meta3-out.json`, 'utf8'));
const LOG = readFileSync(`${S}/teams2.txt`, 'utf8').split(/\s+/).filter(Boolean);

// meaningful opponents: top ~60% of equilibrium piece weight, or >= 1% of logged pieces, or any Fighting type
const pw: Record<string, number> = {};
m3.strat.forEach((t: string[], i: number) => t.forEach((p) => (pw[p] = (pw[p] ?? 0) + m3.share[i] / 3)));
const eqSorted = Object.entries(pw).sort((a, b) => b[1] - a[1]);
const eqTop = new Set<string>(); let cum = 0;
for (const [p, w] of eqSorted) { if (cum >= 0.6) break; eqTop.add(p); cum += w; }
const logCnt: Record<string, number> = {}; LOG.forEach((p) => (logCnt[p] = (logCnt[p] ?? 0) + 1));
const why: Record<string, string[]> = {};
for (const u of U) {
  const r: string[] = [];
  if (eqTop.has(u)) r.push('eq'); if ((logCnt[u] ?? 0) / LOG.length >= 0.01) r.push('log');
  if (speciesOf(u.split('#')[0])!.types.includes('fighting')) r.push('fighting');
  if (r.length) why[u] = r;
}
const MEAN = Object.keys(why);

const SC: Record<string, [number, number, number, number]> = { s11: [1, 1, 0, 0], s22: [2, 2, 0, 0], s00: [0, 0, 0, 0], ch: [1, 1, 1, 0] };
const one = (A: any, B: any, [sa, sb, ka, kb]: number[]) => { let s = 0; for (const pol of ['always', 'read'] as const)
  s += rating(battle(A, B, sa, sb, startingEnergy(A, ka), startingEnergy(B, kb), false, true, undefined, undefined, pol, pol), sa, sb); return Math.round(s / 2); };
const row = (A: any) => Object.fromEntries(Object.entries(SC).map(([k, sc]) => [k, MEAN.map((o) => one(A, mon(o), sc))]));
// a matchup is drastic when, in >= 2 scenarios, the rating moves >= 150 and crosses 500 in rb's favour
function drastic(ra: any, rb: any) {
  const out: { opp: string; sc: Record<string, [number, number]> }[] = [];
  MEAN.forEach((o, j) => {
    const sc: Record<string, [number, number]> = {};
    for (const k of Object.keys(SC)) { const a = ra[k][j], b = rb[k][j]; if (Math.abs(a - b) >= 150 && (a - 500) * (b - 500) < 0) sc[k] = [a, b]; }
    // only gains count: a set that just loses matchups the default wins is a worse set, not a new piece
    if (Object.keys(sc).length >= 2 && Object.values(sc).every(([a, b]) => b > a)) out.push({ opp: o, sc });
  });
  return out;
}

function viable(sp: any) {
  const fl = sp.fastMoves.map((f: any) => ({ f, s: fastMoveStats(f) }));
  const mdpt = Math.max(...fl.map((x: any) => x.s.dpt)), mept = Math.max(...fl.map((x: any) => x.s.ept));
  const fast = fl.filter((x: any) => x.s.dpt >= 0.75 * mdpt || x.s.ept >= 0.85 * mept)
    .filter((x: any) => x.s.dpt + x.s.ept >= 0.8 * Math.max(...fl.map((y: any) => y.s.dpt + y.s.ept))).map((x: any) => x.f);
  const cl = sp.chargeMoves.filter((c: any) => !/^(RETURN|FRUSTRATION)$/.test(c.id)).map((c: any) => ({ c, s: chargeMoveStats(c) }));
  const mdpe = Math.max(...cl.map((x: any) => x.s.dpe));
  const charges = cl.filter((x: any) => x.s.dpe >= 0.7 * mdpe || (x.c.buffs && /Boost|Debuff/.test(x.c.archetype ?? '') && !/Self/.test(x.c.archetype ?? '')) || (x.s.energy <= 40 && x.s.dpe >= 0.55 * mdpe)).map((x: any) => x.c);
  const sets: { fast: any; charges: any[] }[] = [];
  for (const f of fast) for (let i = 0; i < charges.length; i++) for (let j = i + 1; j < charges.length; j++) sets.push({ fast: f, charges: [charges[i], charges[j]] });
  return sets;
}

const kept: any[] = [], aliases: any[] = [];
const t0 = Date.now(); let tried = 0;
for (const u of U) {
  if (u.startsWith('dunsparce')) continue; // already split by fast move; tested below
  const sp = speciesOf(u)!; const def = mon(u); const rd = row(def);
  const defKey = uni.moves[U.indexOf(u)].map((n: string) => n.replace(/[*+]$/, '')).sort().join('|');
  const vs = viable(sp).filter((s) => [s.fast, ...s.charges].map((x) => x.name).sort().join('|') !== defKey).map((s) => {
    tried++;
    const m = mkBattleMon(bestSpreadFor(u, lg, true), s.fast, s.charges, sp.types);
    const r = row(m); return { s, m, r, d: drastic(rd, r), lost: drastic(r, rd).length };
  }).sort((a, b) => b.d.length - a.d.length);
  const mine: any[] = [];
  for (const v of vs) {
    const ref = `${u}#${[v.s.fast, ...v.s.charges].map((x) => x.id).join('-')}`, moves = [v.s.fast, ...v.s.charges].map((x) => x.name);
    // must differ drastically from the default and from every variant of this piece already kept
    const vsKept = mine.map((k) => drastic(k.r, v.r).length);
    // and it may not give up more drastic matchups than it gains: a coverage gimmick that loses the rest is a worse set
    if (v.d.length >= 2 && v.d.length >= v.lost && vsKept.every((n) => n >= 2)) mine.push({ ref, base: u, moves, r: v.r, justify: v.d, lost: v.lost });
    else aliases.push({ ref, base: u, moves, gains: v.d.length, losses: v.lost });
  }
  kept.push(...mine);
}
// existing splits and shadow toggles, judged by the same test
// either direction: b's gains over a, then a's gains over b
const check = (a: string, b: string) => { const ra = row(mon(a)), rb = row(mon(b)); return [...drastic(ra, rb), ...drastic(rb, ra)]; };
const dun = ['dunsparce#ASTONISH', 'dunsparce#ROLLOUT'].map((v) => ({ ref: v, justify: check('dunsparce', v) }));
const shadow = U.filter((u) => u.includes('_shadow') && U.includes(u.replace('_shadow', ''))).map((s) => {
  const d = check(s.replace('_shadow', ''), s); return { shadow: s, distinct: d.length >= 2, n: d.length, justify: d };
});
writeFileSync(`${S}/variants.json`, JSON.stringify({ meaningful: why, kept: kept.map(({ r, ...k }) => k), aliases, dunsparce: dun, shadow }, null, 1));
const fmt = (j: any[]) => j.map((x) => `${x.opp} ${Object.entries(x.sc).map(([k, [a, b]]: any) => `${k} ${a}→${b}`).join(' ')}`).join('; ');
console.log(`meaningful opponents ${MEAN.length}; ${tried} variant sets tried in ${((Date.now() - t0) / 1000).toFixed(0)}s; kept ${kept.length}, folded ${aliases.length}`);
for (const k of kept) console.log(`KEEP ${k.ref}  [${k.moves.join(' / ')}]  gains ${k.justify.length}, loses ${k.lost}: ${fmt(k.justify)}`);
for (const d of dun) console.log(`SPLIT ${d.ref}: ${d.justify.length} drastic matchups vs Bite: ${fmt(d.justify)}`);
for (const s of shadow) console.log(`SHADOW ${s.shadow}: ${s.distinct ? 'distinct' : 'folded'} (${s.n})`);
