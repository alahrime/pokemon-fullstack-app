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
import { PVPOKE_FILES, loadPvPoke, pvpokeBattle } from '../src/lib/pvpoke';

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

// Option A: PvPoke's own engine, vendored (app/vendor/pvpoke), on the same
// inputs. By construction it should score 100%; anything less means the
// vendored copy or the loader has drifted from what produced the fixture.
const root = resolve(process.cwd(), '..');
const pvpoke = loadPvPoke(
  Object.fromEntries(PVPOKE_FILES.map((f) => [f, readFileSync(resolve(root, 'app/vendor/pvpoke', f + '.js'), 'utf8')])) as never,
  // The trimmed copy the app ships (scripts/build-pvpoke-data.mjs), so what is
  // tested is what runs.
  JSON.parse(readFileSync(resolve(root, 'app/src/data/pvpoke-gamemaster.json'), 'utf8')),
);
const vendored = (sh: number, i: number, j: number): number[] => {
  const b = new pvpoke.Battle();
  b.setCP(1500);
  const mk = (t: string[], k: number) => {
    const p = new pvpoke.Pokemon(t[0], k, b);
    p.initialize(1500);
    p.selectMove('fast', t[1]);
    p.selectMove('charged', t[2], 0);
    p.selectMove('charged', t[3], 1);
    p.setShields(sh);
    return p;
  };
  const A = mk(pv.top[i], 0), B = mk(pv.top[j], 1);
  b.setNewPokemon(A, 0);
  b.setNewPokemon(B, 1);
  b.simulate();
  return [A.hp, B.hp];
};
// Option A as the app will call it: our identifiers in (our table's level,
// IVs, move ids), our BattleResult out. Also holds the rebuilt log to account:
// its last HP must be PvPoke's final HP.
const sides = pv.top.map(([id, f, c1, c2]) => {
  const [, a, d, s] = pv.ivs[id];
  return { ref: id, iv: { a, d, s }, lvl: getEntry(id, { a, d, s }, 'great').entry.lvl, fast: f, charges: [c1, c2] };
});
let logDrift = 0;
const adapted = (sh: number, i: number, j: number): number[] => {
  const r = pvpokeBattle(pvpoke, 1500, { ...sides[i], shields: sh }, { ...sides[j], shields: sh });
  const last = r.log[r.log.length - 1];
  if (last && (last.hpA !== r.hpA || last.hpB !== r.hpB)) logDrift++;
  return [r.hpA, r.hpB];
};
// Option B: our engine, ported rule by rule.
const ours = (optimised: boolean) => (sh: number, i: number, j: number): number[] => {
  const r = battle(mons[i], mons[j], sh, sh, 0, 0, false, optimised);
  return [Math.max(0, Math.round(r.hpA)), Math.max(0, Math.round(r.hpB))];
};

// Floors on exact end HP, so a regression fails `npm run check`. Option A is
// PvPoke's own code and must stay exact; option B's floor is where the port
// stands and is raised as it moves (never lowered to get a change through).
const ENGINES: [string, (sh: number, i: number, j: number) => number[], number][] = [
  ['A  vendored PvPoke', vendored, 100],
  ['A  via adapter (our ids)', adapted, 100],
  ['B  ours, optimised timing', ours(true), 93.6],
  ['B  ours, immediate timing', ours(false), 61.9],
];
const failures: string[] = [];

for (const [name, run, floor] of ENGINES) {
  let exact = 0, same = 0, total = 0, gap = 0;
  const perShield: string[] = [];
  const flips = new Map<string, number>();
  const t0 = performance.now();
  for (let sh = 0; sh < 3; sh++) {
    let e = 0, w = 0, n = 0;
    for (let i = 0, p = 0; i < mons.length; i++)
      for (let j = i + 1; j < mons.length; j++, p++) {
        const got = run(sh, i, j);
        const them = theirs[sh][p];
        n++;
        gap += Math.abs(got[0] - them[0]) + Math.abs(got[1] - them[1]);
        if (got[0] === them[0] && got[1] === them[1]) e++;
        if (winner(got) === winner(them)) w++;
        else for (const id of [pv.top[i][0], pv.top[j][0]]) flips.set(id, (flips.get(id) ?? 0) + 1);
      }
    exact += e; same += w; total += n;
    perShield.push(`${sh}sh ${pct(e, n)} / ${pct(w, n)}`);
  }
  const ms = (performance.now() - t0) / total;
  console.log(`${name.padEnd(28)} ${pct(exact, total).padStart(6)} exact end HP  ${pct(same, total).padStart(6)} same winner  gap ${(gap / total).toFixed(1).padStart(4)}  ${ms.toFixed(3)} ms/battle`);
  console.log(`${''.padEnd(28)} ${perShield.join('  ')}`);
  if (Math.round((1000 * exact) / total) / 10 < floor) failures.push(`${name.trim()} ${pct(exact, total)} exact, below its floor of ${floor}%`);
  if (flips.size) console.log(`${''.padEnd(28)} most winner flips: ${[...flips].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => `${id} ${n}`).join(', ')}`);
}

console.log(`adapter log drift: ${logDrift} battles whose rebuilt log disagrees with PvPoke's final HP`);
if (logDrift) failures.push(`${logDrift} rebuilt logs disagree with PvPoke's final HP`);
if (failures.length) {
  console.error('\nPARITY REGRESSED:\n  ' + failures.join('\n  '));
  process.exit(1);
}

function pct(a: number, b: number) {
  return `${((100 * a) / b).toFixed(1)}%`;
}
