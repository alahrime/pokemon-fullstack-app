/**
 * Our battles against PvPoke's own engine, battle for battle.
 *
 * data-src/pvpoke-sweep-1500.json holds PvPoke's result for every pair of the
 * top 50 Great League species at 0, 1 and 2 shields, produced by running its
 * real Battle/Pokemon classes on pvpoke.com (app/tools/pvpoke-sweep.js). This
 * replays each fight here on identical inputs - PvPoke's default IVs and
 * levels, its recommended movesets - and reports how often we land on the
 * same result.
 *
 * Unlike compare-matchups.ts, which reads PvPoke's published ratings (a blend
 * of scenarios, plus editor overrides), this compares like with like, so a
 * change in the numbers is a change in our engine. It is the acceptance test
 * for porting PvPoke's ActionLogic.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRef, speciesOf } from '../src/lib/data';
import { battle, getEntry, mkBattleMon } from '../src/lib/engine';

const FIXTURE = resolve(process.cwd(), '..', 'data-src', 'pvpoke-sweep-1500.json');
const pv = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  top: string[][];
  ivs: Record<string, number[]>;
  ck: number;
  r: string[];
};

const theirs = pv.r.map((s) => s.split(',').map((x) => x.split(' ').map(Number) as [number, number]));
let ck = 0, k = 0;
for (const r of theirs) for (const [a, b] of r) ck = (ck + ++k * (a * 1000 + b)) % 1000000007;
if (ck !== pv.ck) throw new Error(`fixture checksum ${ck} != ${pv.ck}: the file was altered or truncated`);

const mons = pv.top.map(([id, f, c1, c2]) => {
  const sp = speciesOf(parseRef(id).id)!;
  const [lvl, a, d, s] = pv.ivs[id];
  const e = getEntry(id, { a, d, s }, 'great').entry;
  if (e.lvl !== lvl) throw new Error(`${id}: level ${e.lvl} here, ${lvl} in PvPoke - inputs differ`);
  const fast = sp.fastMoves.find((m) => m.id === f);
  const charges = [c1, c2].map((c) => sp.chargeMoves.find((m) => m.id === c));
  if (!fast || !charges[0] || !charges[1]) throw new Error(`${id}: ${f}/${c1}/${c2} not in its movepool here`);
  return mkBattleMon(e, fast, charges as NonNullable<(typeof charges)[number]>[], sp.types);
});

const winner = ([a, b]: readonly number[]) => (a > 0 && b === 0 ? 'A' : b > 0 && a === 0 ? 'B' : 'draw');

for (const optimised of [true, false]) {
  let exact = 0, same = 0, total = 0, gap = 0;
  const perShield: string[] = [];
  const flips = new Map<string, number>();
  for (let sh = 0; sh < 3; sh++) {
    let e = 0, w = 0, n = 0;
    for (let i = 0, p = 0; i < mons.length; i++)
      for (let j = i + 1; j < mons.length; j++, p++) {
        const r = battle(mons[i], mons[j], sh, sh, 0, 0, false, optimised);
        const ours = [Math.max(0, Math.round(r.hpA)), Math.max(0, Math.round(r.hpB))];
        const them = theirs[sh][p];
        n++;
        gap += Math.abs(ours[0] - them[0]) + Math.abs(ours[1] - them[1]);
        if (ours[0] === them[0] && ours[1] === them[1]) e++;
        if (winner(ours) === winner(them)) w++;
        else for (const id of [pv.top[i][0], pv.top[j][0]]) flips.set(id, (flips.get(id) ?? 0) + 1);
      }
    exact += e; same += w; total += n;
    perShield.push(`${sh} shields ${pct(e, n)} exact, ${pct(w, n)} same winner`);
  }
  console.log(`${optimised ? 'optimised' : 'immediate'} timing: ${pct(exact, total)} exact end HP, ${pct(same, total)} same winner, mean HP gap ${(gap / total).toFixed(1)}  (${total} battles)`);
  console.log(`  ${perShield.join(' | ')}`);
  console.log(`  most winner flips: ${[...flips].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `${id} ${n}`).join(', ')}`);
}

function pct(a: number, b: number) {
  return `${((100 * a) / b).toFixed(1)}%`;
}
