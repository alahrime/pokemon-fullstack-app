// Scratch: full 3v3 games with HP, energy and shields carried between fights, searched for the best play.
import { readFileSync, writeFileSync } from 'node:fs';
import { speciesOf, movesFor } from '../../../app/src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../../../app/src/lib/engine';
const lg = 'great' as const;
const S = process.env.S!;
const uni = JSON.parse(readFileSync(`${S}/${process.env.UNI ?? "universe2.json"}`, "utf8"));
const MV: Record<string, string[]> = Object.fromEntries(uni.U.map((u: string, i: number) => [u, uni.moves[i]]));
const cache = new Map<string, any>();
export function mon(ref: string) {
  if (cache.has(ref)) return cache.get(ref);
  const [id, fo] = ref.split('#'); const sp = speciesOf(id)!; const names = MV[ref];
  let fast = sp.fastMoves.find((f) => f.name === names?.[0]); let ch = names?.slice(1).map((n) => sp.chargeMoves.find((c) => c.name === n));
  if (!fast || !ch || ch.some((c) => !c)) { const m = movesFor(sp, lg, id.endsWith('_shadow')); fast = fo ? sp.fastMoves.find((f) => f.id === fo)! : m.fast; ch = m.charges; }
  const m = mkBattleMon(bestSpreadFor(id, lg, true), fast, ch as any, sp.types); cache.set(ref, m); return m;
}
type Side = { mons: any[]; names: string[]; hp: number[]; en: number[]; act: number; sh: number; swapped: boolean };
// Disguise (Mimikyu) does not come back on switching, as in PvPoke's team battles: once broken, the Busted form is used.
const disguised = (m: any) => !!m.forms && m.forms.by[m.form]?.rule?.trigger === 'charged_move_damage';
const bustedCache = new Map<any, any>();
function busted(m: any) {
  if (bustedCache.has(m)) return bustedCache.get(m);
  const from = m.forms.by[m.form], id = from.rule.to, to = m.forms.by[id];
  const swap = (x: any, was: any[], now: any[]) => now[was.findIndex((y: any) => y.id === x.id)] ?? x;
  const b = { ...m, form: id, atk: to.atk, cmpAtk: to.cmpAtk, def: to.def, types: to.types, fast: swap(m.fast, from.fastMoves, to.fastMoves), charges: m.charges.map((c: any) => swap(c, from.chargeMoves, to.chargeMoves)) };
  bustedCache.set(m, b); return b;
}
const clone = (s: Side): Side => ({ ...s, hp: s.hp.slice(), en: s.en.slice(), mons: s.mons.slice() });
const alive = (s: Side) => s.hp.map((h, i) => [h, i]).filter(([h]) => h > 0).map(([, i]) => i);
export let sims = 0;
// one fight between the active pair. stopAtCharge: cut right after the first charged move (a planned switch).
function fight(A: Side, B: Side, polA: string, polB: string, stopAtCharge: boolean) {
  const a = A.act, b = B.act; sims++;
  const shA = polA === 'save' ? 0 : A.sh, shB = polB === 'save' ? 0 : B.sh;
  const dA = disguised(A.mons[a]), dB = disguised(B.mons[b]);
  const r = battle(A.mons[a], B.mons[b], shA, shB, A.en[a], B.en[b], stopAtCharge || dA || dB, true, A.hp[a], B.hp[b],
    polA === 'save' ? 'always' : 'read', polB === 'save' ? 'always' : 'read');
  const nA = clone(A), nB = clone(B);
  const bust = (upTo: number) => {
    const L = r.log.slice(0, upTo);
    if (dA && L.some((e: any) => e.kind === 'charge' && e.actor === 'B' && !e.shielded)) nA.mons[a] = busted(A.mons[a]);
    if (dB && L.some((e: any) => e.kind === 'charge' && e.actor === 'A' && !e.shielded)) nB.mons[b] = busted(B.mons[b]);
  };
  if (stopAtCharge) {
    const k = r.log.findIndex((e) => e.kind === 'charge');
    if (k >= 0) {
      const e = r.log[k];
      nA.hp[a] = e.hpA; nB.hp[b] = e.hpB; nA.en[a] = e.energyA; nB.en[b] = e.energyB;
      if (e.shielded) { if (e.actor === 'A') nB.sh--; else nA.sh--; }
      bust(k + 1);
      return [nA, nB, true] as const;
    }
  }
  nA.hp[a] = Math.max(0, r.hpA); nB.hp[b] = Math.max(0, r.hpB); nA.en[a] = r.energyA; nB.en[b] = r.energyB;
  nA.sh -= shA - r.shieldsA; nB.sh -= shB - r.shieldsB;
  bust(r.log.length);
  return [nA, nB, false] as const;
}
// value of a simultaneous choice: mixed-strategy solve by fictitious play (row maximises)
export function solveMixed(g: number[][], iters = 1500) {
  const m = g.length, n = g[0].length;
  if (m === 1) return { v: Math.min(...g[0]), x: [1] };
  if (n === 1) { const c = g.map((r) => r[0]); return { v: Math.max(...c), x: c.map((v) => (v === Math.max(...c) ? 1 : 0)) }; }
  const rc = new Float64Array(m), cc = new Float64Array(n), cr = new Float64Array(n), cnt = new Float64Array(m);
  let i = 0, j = 0;
  for (let t = 0; t < iters; t++) {
    cnt[i]++; for (let q = 0; q < n; q++) cr[q] += g[i][q]; for (let q = 0; q < m; q++) rc[q] += g[q][j];
    let bi = 0; for (let q = 1; q < m; q++) if (rc[q] > rc[bi]) bi = q;
    let bj = 0; for (let q = 1; q < n; q++) if (cr[q] < cr[bj]) bj = q;
    i = bi; j = bj;
  }
  const v = (Math.max(...rc) + Math.min(...cr)) / 2 / iters;
  return { v, x: Array.from(cnt, (c) => c / iters) };
}
const mm = (grid: number[][]) => solveMixed(grid, 400).v;
// after a faint: the fainted side picks its next Pokemon. Value = A's win chance (1, 0, 0.5 for a double KO end).
function cont(A: Side, B: Side, depth: number, trace?: string[]): number {
  const la = alive(A), lb = alive(B);
  if (!la.length && !lb.length) return 0.5;
  const left = (s: Side) => s.hp.reduce((t, h, i) => t + Math.max(0, h) / s.mons[i].hp, 0) / 3;
  if (!lb.length) return 0.55 + 0.45 * left(A); if (!la.length) return 0.45 - 0.45 * left(B);
  const needA = A.hp[A.act] <= 0, needB = B.hp[B.act] <= 0;
  const optsA = needA ? la : [A.act], optsB = needB ? lb : [B.act];
  const grid = optsA.map((i) => optsB.map((j) => {
    const a = clone(A), b = clone(B); a.act = i; b.act = j;
    const [na, nb] = fight(a, b, 'read', 'read', false);
    return cont(na, nb, depth + 1);
  }));
  return mm(grid);
}
// lead phase: each side may stay, switch at once, or switch after the first charged move; and shield or save shields.
export function game(TA: string[], TB: string[], explain = false) {
  const side = (t: string[]): Side => ({ mons: t.map(mon), names: t, hp: t.map((r) => mon(r).hp), en: [0, 0, 0], act: 0, sh: 2, swapped: false });
  const A0 = side(TA), B0 = side(TB);
  const opts = (s: Side) => { const o: [string, number, string][] = [];
    for (const pol of ['read', 'save']) { o.push(['stay', 0, pol]); for (const t of [1, 2]) { o.push(['now', t, pol]); o.push(['after', t, pol]); } } return o; };
  const OA = opts(A0), OB = opts(B0);
  const grid = OA.map(([ka, ta, pa]) => OB.map(([kb, tb, pb]) => {
    let A = clone(A0), B = clone(B0);
    if (ka === 'now') A.act = ta; if (kb === 'now') B.act = tb;
    const cut = ka === 'after' || kb === 'after';
    const [na, nb, cutHappened] = fight(A, B, pa, pb, cut);
    A = na; B = nb;
    if (cutHappened) { if (ka === 'after') A.act = ta; if (kb === 'after') B.act = tb;
      // the fight continues with the new pair; shields now spent normally
      const [xa, xb] = fight(A, B, 'read', 'read', false); return cont(xa, xb, 1); }
    return cont(A, B, 1);
  }));
  const sol = solveMixed(grid);
  // B's mix too, for what A is playing against
  const solB = solveMixed(grid[0].map((_, j) => grid.map((r) => 1 - r[j])));
  return { v: sol.v, xA: sol.x, xB: solB.x, OA, OB, grid };
}

export function line(TA: string[], TB: string[], oa: [string, number, string], ob: [string, number, string]) {
  const side = (t: string[]): Side => ({ mons: t.map(mon), names: t, hp: t.map((r) => mon(r).hp), en: [0, 0, 0], act: 0, sh: 2, swapped: false });
  let A = side(TA), B = side(TB); const out: any[] = [];
  const rec = (a: Side, b: Side, na: Side, nb: Side, tag: string) => out.push({ a: a.names[a.act], b: b.names[b.act], tag, hpA: na.hp[a.act] / a.mons[a.act].hp, hpB: nb.hp[b.act] / b.mons[b.act].hp,
    enA: a.en[a.act], enB: b.en[b.act], shA: a.sh, shB: b.sh, shAafter: na.sh, shBafter: nb.sh });
  if (oa[0] === 'now') A.act = oa[1]; if (ob[0] === 'now') B.act = ob[1];
  const cut = oa[0] === 'after' || ob[0] === 'after';
  let [na, nb, c] = fight(A, B, oa[2], ob[2], cut); rec(A, B, na, nb, cut && c ? 'until first charged move' : 'lead'); A = na; B = nb;
  if (c) { if (oa[0] === 'after') A.act = oa[1]; if (ob[0] === 'after') B.act = ob[1]; const [xa, xb] = fight(A, B, 'read', 'read', false); rec(A, B, xa, xb, 'after the switch'); A = xa; B = xb; }
  for (let guard = 0; guard < 8; guard++) {
    const la = alive(A), lb = alive(B); if (!la.length || !lb.length) break;
    const optsA = A.hp[A.act] <= 0 ? la : [A.act], optsB = B.hp[B.act] <= 0 ? lb : [B.act];
    let best: any = null;
    for (const i of optsA) for (const j of optsB) { const a = clone(A), b = clone(B); a.act = i; b.act = j; const [x, y] = fight(a, b, 'read', 'read', false); const v = cont(x, y, 2);
      // A maximises over its pick, B minimises over its pick
      const score = (optsA.length > 1 ? v : 0) - (optsB.length > 1 ? v : 0);
      if (!best || score > best.score) best = { score, a, b, x, y }; }
    rec(best.a, best.b, best.x, best.y, 'next'); A = best.x; B = best.y;
  }
  return { out, win: alive(B).length === 0 && alive(A).length > 0 };
}
