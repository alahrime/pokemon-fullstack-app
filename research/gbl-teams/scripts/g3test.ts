import { game, sims } from './g3';
const t0 = Date.now();
for (const [a, b] of [[['melmetal','quagsire','altaria'], ['annihilape','dunsparce#ASTONISH','carbink']], [['annihilape','cramorant','registeel'], ['cramorant','annihilape_shadow','clodsire']], [['hydreigon_shadow','dondozo','clodsire'], ['ninetales_alolan','azumarill','araquanid']]]) {
  const r: any = game(a, b, true);
  const lab = (o: any) => `${o[0]}${o[0] === 'stay' ? '' : '->' + o[1]}/${o[2]}`;
  console.log(a.join('/'), 'vs', b.join('/'), 'value', r.v.toFixed(2), r.v > 0.5 ? 'WIN' : 'loss');
  console.log('   my lead mix:', r.OA.map((o: any, i: number) => [lab(o), r.xA[i]]).filter((x: any) => x[1] > 0.05).map((x: any) => `${x[0]} ${(x[1] * 100).toFixed(0)}%`).join(', '),
    '| their mix:', r.OB.map((o: any, i: number) => [lab(o), r.xB[i]]).filter((x: any) => x[1] > 0.05).map((x: any) => `${x[0]} ${(x[1] * 100).toFixed(0)}%`).join(', '));
}
console.log(sims, 'fights in', Date.now() - t0, 'ms');
