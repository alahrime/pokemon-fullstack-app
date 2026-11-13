// Scratch: Annihilape lead -> Quagsire safe swap eats one charged move, lands Aqua Tail, leaves -> Melmetal closes at 0-0.
import { movesFor, speciesOf } from '../../../app/src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../../../app/src/lib/engine';
const lg = 'great' as const;
const mon = (r: string, fast?: string, ch?: string[]) => { const sp = speciesOf(r)!; const m = movesFor(sp, lg, r.endsWith('_shadow'));
  const f = fast ? sp.fastMoves.find((x) => x.id === fast)! : m.fast; const c = ch ? ch.map((id) => sp.chargeMoves.find((x) => x.id === id)!) : m.charges;
  return { m: mkBattleMon(bestSpreadFor(r, lg, true), f, c, sp.types), names: [f, ...c].map((x) => x.name).join(' / ') }; };
const ape = mon('annihilape'); const quag = mon('quagsire', 'MUD_SHOT', ['EARTHQUAKE', 'AQUA_TAIL']); const mel = mon('melmetal', 'THUNDER_SHOCK', ['DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH']);
console.log('Annihilape:', ape.names, '| Quagsire:', quag.names, '| Melmetal:', mel.names);
const pct = (h: number, max: number) => `${Math.round(100 * h / max)}%`;
for (const apeShields of [1, 2]) for (const pol of ['always', 'read'] as const) {
  const r = battle(quag.m, ape.m, 0, apeShields, 0, 0, true, true, undefined, undefined, 'always', pol);
  const at = r.log.findIndex((e) => e.actor === 'A' && e.kind === 'charge' && /Aqua Tail/.test(e.moveName));
  if (at < 0) { console.log(`ape ${apeShields} shields/${pol}: no Aqua Tail landed`); continue; }
  const s = r.log[at];
  console.log(`\nApe ${apeShields} shield(s), shield policy ${pol}: Aqua Tail ${s.shielded ? 'shielded' : 'HIT for ' + s.damage}; Ape left ${pct(s.hpB, r.maxHpB)} HP, ${s.energyB} energy; Quag ${pct(s.hpA, r.maxHpA)} HP, ${s.energyA} energy`);
  for (const apeE of [0, s.energyB, Math.min(100, s.energyB + 30)]) {
    const row = [0, 20, 40, 60].map((me) => { const c = battle(mel.m, ape.m, 0, 0, me, apeE, false, true, undefined, s.hpB); return `Mel ${me}e: ${c.win ? 'WIN' : 'loss'}`; });
    console.log(`  endgame 0-0 vs Ape at ${pct(s.hpB, r.maxHpB)} HP with ${apeE} energy -> ${row.join('  ')}`);
  }
}
const full = [0, 20, 40, 60].map((me) => [0, 30].map((ae) => `Mel ${me}e vs Ape ${ae}e: ${battle(mel.m, ape.m, 0, 0, me, ae, false, true).win ? 'WIN' : 'loss'}`).join(', '));
console.log('\nbaseline, full-HP Annihilape at 0-0:\n  ' + full.join('\n  '));
