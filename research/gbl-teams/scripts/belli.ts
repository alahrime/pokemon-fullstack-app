// Scratch: every viable moveset per candidate vs the user's logged opponents. Not part of the app.
import { readFileSync, writeFileSync } from 'node:fs';
import { movesFor, speciesOf } from '../../../app/src/lib/data';
import { battle, bestSpreadFor, mkBattleMon, fastMoveStats, chargeMoveStats } from '../../../app/src/lib/engine';
import { rating } from '../../../app/src/lib/scenarios';

const lg = 'great' as const;
const OPP: Record<string, number> = {
  dunsparce: 22, melmetal: 21, diggersby: 16, altaria: 14, cramorant: 12, sableye: 12, azumarill: 10,
  ninetales_alolan: 9, jumpluff: 9, ursaluna: 9, mimikyu: 9, ninetales_shadow: 8, fearow: 8, quagsire: 8,
  corviknight: 7, charjabug: 7, electrode_hisuian: 6, tinkaton: 6, stunfisk: 6, annihilape: 6, florges: 5,
  carbink: 5, clodsire: 4, hydreigon_shadow: 4, clefable: 4, houndoom: 4, araquanid: 3, thievul: 3, malamar: 3,
  hydreigon: 3, marowak: 3, blastoise: 3, walrein: 2, empoleon: 3, gastrodon: 2, forretress: 3, machamp: 3,
  vigoroth: 3, mandibuzz: 2, jellicent: 2, chesnaught: 3, morpeko_full_belly: 2, pangoro: 2, snorlax: 2,
};
const GM = JSON.parse(readFileSync('src/data/pvpoke-gamemaster.json', 'utf8'));
const ELITE = new Map<string, string[]>(GM.pokemon.map((p: any) => [p.speciesId, p.eliteMoves ?? []]));
const RANK = JSON.parse(readFileSync('../data-src/rankings-1500.json', 'utf8')) as { speciesId: string }[];
const cand = [...new Set([...RANK.slice(0, 130).map((r) => r.speciesId), ...Object.keys(OPP), 'dondozo', 'clodsire', 'hydreigon_shadow', 'bellibolt'])].filter((id) => speciesOf(id));
const opps = Object.keys(OPP).filter((id) => speciesOf(id));
const W = opps.reduce((s, o) => s + OPP[o], 0);
const spread = (r: string) => bestSpreadFor(r, lg, true);
const oppMon = Object.fromEntries(opps.map((r) => { const sp = speciesOf(r)!; const m = movesFor(sp, lg, r.endsWith('_shadow')); return [r, mkBattleMon(spread(r), m.fast, m.charges, sp.types)]; }));

function viable(r: string) {
  const sp = speciesOf(r)!; const shadow = r.endsWith('_shadow');
  // shadow forms lose Return and gain Frustration; drop both, neither is ever right in GL
  const fl = sp.fastMoves.map((f) => ({ f, s: fastMoveStats(f) }));
  const mdpt = Math.max(...fl.map((x) => x.s.dpt)), mept = Math.max(...fl.map((x) => x.s.ept));
  const fast = fl.filter((x) => x.s.dpt >= 0.75 * mdpt || x.s.ept >= 0.85 * mept)
    .filter((x) => x.s.dpt + x.s.ept >= 0.8 * Math.max(...fl.map((y) => y.s.dpt + y.s.ept))).map((x) => x.f);
  const cl = sp.chargeMoves.filter((c) => !/^(RETURN|FRUSTRATION)$/.test(c.id)).map((c) => ({ c, s: chargeMoveStats(c) }));
  const mdpe = Math.max(...cl.map((x) => x.s.dpe));
  const charges = cl.filter((x) => x.s.dpe >= 0.7 * mdpe || (x.c.buffs && /Boost|Debuff/.test(x.c.archetype ?? '') && !/Self/.test(x.c.archetype ?? '')) || (x.s.energy <= 40 && x.s.dpe >= 0.55 * mdpe)).map((x) => x.c);
  const sets: { fast: any; charges: any[] }[] = [];
  for (const f of fast) for (let i = 0; i < charges.length; i++) for (let j = i + 1; j < charges.length; j++) sets.push({ fast: f, charges: [charges[i], charges[j]] });
  if (!sets.length) { const m = movesFor(sp, lg, shadow); sets.push(m as any); }
  return { sp, sets };
}
const one = (A: any, b: string, sa: number, sb: number) => { let s = 0; for (const pol of ['always', 'read'] as const)
  s += rating(battle(A, oppMon[b], sa, sb, 0, 0, false, true, undefined, undefined, pol, pol), sa, sb); return s / 2; };
const out: any = { opps, w: opps.map((o) => OPP[o]), moves: {}, alt: {}, r: {} };
let n = 0;
for (const c of ["bellibolt"]) {
  const { sp, sets } = viable(c); const el = ELITE.get(sp.id) ?? [];
  const tried = sets.map((m) => {
    const A = mkBattleMon(spread(c), m.fast, m.charges, sp.types);
    const r = { s00: opps.map((b) => one(A, b, 0, 0)), s11: opps.map((b) => one(A, b, 1, 1)), s22: opps.map((b) => one(A, b, 2, 2)), s01: opps.map((b) => one(A, b, 0, 1)) };
    n += opps.length * 8;
    const score = opps.reduce((s, _, j) => s + OPP[opps[j]] * (r.s00[j] + r.s01[j] + r.s11[j] + r.s22[j]) / 4, 0) / W;
    const name = [m.fast, ...m.charges].map((x: any) => x.name + (el.includes(x.id) ? '*' : ''));
    return { r, score, name };
  }).sort((a, b) => b.score - a.score);
  out.sets = tried.map((t) => ({ name: t.name.join(" / "), score: t.score, r: t.r })); out.moves[c] = tried[0].name;
  out.alt[c] = tried.slice(0, 3).map((t) => [t.name.join(' / '), Math.round(t.score)]);
  out.alt[c].push(['sets tried', tried.length]);
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(cand.length, 'candidates,', n, 'battles');
