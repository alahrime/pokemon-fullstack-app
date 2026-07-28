/**
 * Data + engine integrity checks.
 *
 *   npm run verify
 *
 * Bundled through esbuild so it runs against the real engine and the real
 * species.json rather than a reimplementation - the point is to catch a bad
 * generator run or a broken Shadow assumption, and a parallel implementation
 * would just encode the same mistake twice.
 */

import { SPECIES, SPECIES_BY_ID, OPPONENTS, ROSTER, parseRef, makeRef } from '../src/lib/data';
import {
  SHADOW_ATK_MULT,
  SHADOW_DEF_MULT,
  battle,
  chargesOf,
  getTable,
  mkBattleMon,
  opponentInfo,
  relevantOpponents,
} from '../src/lib/engine';
import type { LeagueId } from '../src/lib/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const LEAGUES: LeagueId[] = ['great', 'ultra', 'master'];

console.log('\n── roster ─────────────────────────────────────────────');
check('species.json non-empty', SPECIES.length > 1000, `${SPECIES.length} entries`);
check('ids unique', new Set(SPECIES.map((s) => s.id)).size === SPECIES.length);
check('every entry has a sprite slug', SPECIES.every((s) => !!s.sprite));
check('every entry has >=1 fast and >=1 charge move', SPECIES.every((s) => s.fastMoves.length > 0 && s.chargeMoves.length > 0));
check('no NaN base stats', SPECIES.every((s) => [s.atk, s.def, s.hp].every((n) => Number.isFinite(n) && n > 0)));
check(
  'move stats resolved (no zero-turn fast moves)',
  SPECIES.every((s) => s.fastMoves.every((m) => m.turns >= 1 && Number.isFinite(m.power))),
);

const formCount = SPECIES.filter((s) => s.id.includes('_')).length;
check('regional forms present', formCount > 150, `${formCount} alternate forms`);
check('distinct sprites for same-dex forms', SPECIES_BY_ID.get('marowak')!.sprite !== SPECIES_BY_ID.get('marowak_alolan')!.sprite);

console.log('\n── opponents ──────────────────────────────────────────');
for (const lg of LEAGUES) {
  const ids = OPPONENTS[lg];
  check(`${lg}: curated ids all resolve`, ids.every((id) => SPECIES_BY_ID.has(parseRef(id).id)), `${ids.length} ids`);
}

console.log('\n── shadow ─────────────────────────────────────────────');
const shadowEligible = SPECIES.filter((s) => s.shadowEligible);
check('shadow-eligible population', shadowEligible.length > 400, `${shadowEligible.length} species`);
check(
  'ROSTER adds a shadow row per eligible species',
  ROSTER.length === SPECIES.length + shadowEligible.length,
  `${ROSTER.length} rows`,
);

// The load-bearing claim: 1.2 x 5/6 === 1, so Shadow must not move rank or CP.
const SAMPLE = ['azumarill', 'machamp', 'marowak_alolan', 'tyranitar', 'gengar'].filter((id) =>
  SPECIES_BY_ID.get(id)?.shadowEligible,
);
check('sample species are shadow-eligible', SAMPLE.length >= 3, SAMPLE.join(', '));

for (const id of SAMPLE) {
  const norm = getTable(id, 'great');
  const shad = getTable(makeRef(id, true), 'great');

  const rankSame = norm.all.every((e, i) => shad.all[i].rank === e.rank && shad.all[i].a === e.a && shad.all[i].d === e.d && shad.all[i].s === e.s);
  check(`${id}: shadow leaves all 4096 ranks identical`, rankSame);

  const cpSame = norm.all.every((e, i) => shad.all[i].cp === e.cp);
  check(`${id}: shadow leaves CP identical`, cpSame);

  const eN = norm.best;
  const eS = shad.best;
  const atkOk = Math.abs(eS.atk / eN.atk - SHADOW_ATK_MULT) < 1e-9;
  const defOk = Math.abs(eS.def / eN.def - SHADOW_DEF_MULT) < 1e-9;
  check(`${id}: shadow attack x${SHADOW_ATK_MULT.toFixed(4)}`, atkOk, `${eN.atk.toFixed(2)} -> ${eS.atk.toFixed(2)}`);
  check(`${id}: shadow defense x${SHADOW_DEF_MULT.toFixed(4)}`, defOk, `${eN.def.toFixed(2)} -> ${eS.def.toFixed(2)}`);
  check(`${id}: HP untouched`, eS.hp === eN.hp);
}

console.log('\n── engine smoke ───────────────────────────────────────');
// A Shadow should out-damage its normal self against a fixed opponent, and be
// frailer. If the multipliers were applied to the wrong stat this flips.
{
  const id = SAMPLE[0];
  const league: LeagueId = 'great';
  const iv = { a: 0, d: 15, s: 15 };
  const foe = opponentInfo(OPPONENTS[league][0], league);
  const foeMon = mkBattleMon(foe, foe.fastMove, chargesOf(foe.chargeMove, foe.chargeMove2));
  const sp = SPECIES_BY_ID.get(id)!;

  const mk = (shadow: boolean) => {
    const t = getTable(makeRef(id, shadow), league);
    const e = t.map.get(iv.a * 256 + iv.d * 16 + iv.s)!;
    return mkBattleMon(e, sp.fastMoves[0], chargesOf(sp.chargeMove, sp.chargeMove2));
  };
  const n = mk(false);
  const s = mk(true);
  check(`${id}: shadow hits harder`, s.atk > n.atk);
  check(`${id}: shadow is frailer`, s.def < n.def);

  const rN = battle(n, foeMon, 1, 1);
  const rS = battle(s, foeMon, 1, 1);
  check('battle sim runs for both variants', Number.isFinite(rN.margin) && Number.isFinite(rS.margin), `normal ${rN.margin.toFixed(1)}% / shadow ${rS.margin.toFixed(1)}%`);
}

// Opponent relevance scan must not throw across a spread of the roster.
{
  let ok = true;
  let detail = '';
  const stride = Math.floor(SPECIES.length / 40);
  for (let i = 0; i < SPECIES.length; i += stride) {
    const s = SPECIES[i];
    try {
      relevantOpponents(s.id, 'great', 0, 'either', 4);
    } catch (err) {
      ok = false;
      detail = `${s.id}: ${(err as Error).message}`;
      break;
    }
  }
  check('relevantOpponents runs across a roster sample', ok, detail);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
