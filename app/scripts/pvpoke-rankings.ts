/**
 * Does our port of PvPoke's ranking method reproduce PvPoke?
 *
 * Ranks PvPoke's own list (default IVs, published movesets) with the method
 * build-matrix uses (scripts/pvpoke-method.ts) and reports rank correlation
 * against PvPoke's computed order - its published score with the editor
 * override undone, (score - 0.75 * editorScore) / 0.25 - and its published
 * order, plus how far each category and consistency land from PvPoke's own
 * sub-scores. --engine=pvpoke runs the battles on PvPoke's engine: that must
 * come out exact, or the port has drifted; on ours it measures the engine.
 *
 *   npm run rank:pvpoke [great|ultra|master] [--engine=pvpoke]
 */
import { parseRef, speciesOf } from '../src/lib/data';
import { battle, getEntry, mkBattleMon } from '../src/lib/engine';
import { pvpokeBattle, type PvPokeSide } from '../src/lib/pvpoke';
import type { BattleMon, LeagueId } from '../src/lib/types';
import {
  PV_CP, PV_SCENARIOS, adjRatings, categoryScore, loadPvPokeNode, normalise, opponentWeight, overallScore,
  pvField, pvStatics, startEnergy,
} from './pvpoke-method';

const pv = loadPvPokeNode();
const onPvPoke = process.argv.includes('--engine=pvpoke');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

interface Ranked { id: string; mon: BattleMon; side: Omit<PvPokeSide, 'shields'>; consistency: number; chargerMult: number; weight: number }

function agreement(ref: string[], ours: string[]): number {
  const pos = new Map(ours.map((x, i) => [x, i]));
  const common = ref.slice(0, 100).filter((x) => pos.has(x));
  const byOurs = new Map([...common].sort((a, b) => pos.get(a)! - pos.get(b)!).map((x, i) => [x, i]));
  const d = common.reduce((acc, x, i) => acc + (i - byOurs.get(x)!) ** 2, 0);
  const n = common.length;
  return 1 - (6 * d) / (n * (n * n - 1));
}

for (const lg of Object.keys(PV_CP) as LeagueId[]) {
  if (only && only !== lg) continue;
  const cp = PV_CP[lg];
  const t0 = performance.now();
  const { list: published, weightOf } = pvField(cp);
  const list: Ranked[] = [];
  const skipped: string[] = [];
  for (const r of published) {
    const sp = speciesOf(parseRef(r.speciesId).id);
    const moves = r.moveset.filter((m) => m && m !== 'none');
    const fast = sp?.fastMoves.find((m) => m.id === moves[0]);
    const charges = moves.slice(1, 3).map((c) => sp?.chargeMoves.find((m) => m.id === c));
    if (!sp || !fast || charges.some((c) => !c)) { skipped.push(r.speciesId); continue; }
    const st = pvStatics(pv, r.speciesId, cp, moves[0], moves.slice(1, 3));
    const e = getEntry(r.speciesId, st.iv, lg, st.lvl > 50).entry;
    list.push({
      id: r.speciesId, mon: mkBattleMon(e, fast, charges as NonNullable<(typeof charges)[number]>[], sp.types),
      side: { ref: r.speciesId, iv: st.iv, lvl: st.lvl, fast: moves[0], charges: moves.slice(1, 3) },
      consistency: st.consistency, chargerMult: st.chargerMult, weight: weightOf(r.speciesId),
    });
  }
  if (skipped.length) console.log(`  ${lg}: skipped ${skipped.length} with moves we do not model: ${skipped.join(', ')}`);
  const n = list.length;
  const cats = PV_SCENARIOS.map((sc) => {
    const adj = Array.from({ length: n }, () => new Float64Array(n));
    const symmetric = sc.shields[0] === sc.shields[1] && sc.energy === 0;
    for (let i = 0; i < n; i++)
      for (let j = symmetric ? i : 0; j < n; j++) {
        const e = startEnergy(list[i].mon.fast, sc.energy);
        const r = onPvPoke
          ? pvpokeBattle(pv, cp, { ...list[i].side, shields: sc.shields[0], energy: e }, { ...list[j].side, shields: sc.shields[1] })
          : battle(list[i].mon, list[j].mon, sc.shields[0], sc.shields[1], e, 0, false, true);
        const [a, b] = adjRatings(r, sc.shields);
        adj[i][j] = a;
        if (symmetric) adj[j][i] = b;
      }
    const base = adj.map((row) => Math.floor(row.reduce((x, y) => x + y, 0) / n));
    const best = Math.max(...base);
    const raw = list.map((r, i) => {
      const w = base.map((b, j) => (i === j ? 0 : opponentWeight(b, best, list[j].weight)));
      const s = categoryScore(adj[i], w, sc.slug === 'switches');
      return sc.slug === 'chargers' ? s * r.chargerMult : s;
    });
    const top = Math.max(...raw);
    return raw.map((s) => normalise(s, top));
  });
  const scores = list.map((r, i) => overallScore(cats.map((c) => c[i]), r.consistency));
  const port = list.map((r, i) => [r.id, scores[i]] as const).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const computed = [...published].sort((a, b) =>
    (b.editorScore ? (b.score - 0.75 * b.editorScore) / 0.25 : b.score) - (a.editorScore ? (a.score - 0.75 * a.editorScore) / 0.25 : a.score))
    .map((p) => p.speciesId);
  const pubBy = new Map(published.map((p) => [p.speciesId, p.scores]));
  const off = (k: number, mine: (i: number) => number) => {
    const d = list.map((r, i) => Math.abs(mine(i) - (pubBy.get(r.id)?.[k] ?? NaN))).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    return `median ${d[d.length >> 1].toFixed(1)}, 90% ${d[Math.floor(d.length * 0.9)].toFixed(1)}`;
  };
  console.log(`${lg.padEnd(7)} ${n} ranked in ${((performance.now() - t0) / 1000).toFixed(0)} s on ${onPvPoke ? "PvPoke's engine" : 'ours'}`);
  console.log(`          top-100 rank correlation: vs PvPoke computed ${agreement(computed, port).toFixed(3)}, vs published ${agreement(published.map((p) => p.speciesId), port).toFixed(3)}`);
  PV_SCENARIOS.forEach((sc, k) => console.log(`          ${sc.slug.padEnd(11)} off by ${off(k, (i) => cats[k][i])}`));
  console.log(`          consistency off by ${off(5, (i) => list[i].consistency)}`);
}
