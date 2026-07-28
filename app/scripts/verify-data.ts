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
  rankedOpponents,
  selectedCharges,
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
      rankedOpponents(s.id, 'great', 0, 'either', 4);
    } catch (err) {
      ok = false;
      detail = `${s.id}: ${(err as Error).message}`;
      break;
    }
  }
  check('relevance scan runs across a roster sample', ok, detail);
}

console.log('\n── uncapped (master) ──────────────────────────────────');
{
  // No CP cap means no level/IV trade-off: everything sits at level 50 and
  // stat product rises with every IV point. Rank 1 must therefore be the hundo
  // for every species. It wasn't, before the tie-break fix — floored HP makes
  // 15/15/14 tie with 15/15/15, and insertion order handed rank 1 to the lower
  // roll for 211 species.
  let notHundo = 0;
  let notL50 = 0;
  let nonMono = 0;
  const examples: string[] = [];
  for (const s of SPECIES) {
    const t = getTable(s.id, 'master');
    const b = t.best;
    if (!(b.a === 15 && b.d === 15 && b.s === 15)) {
      notHundo++;
      if (examples.length < 5) examples.push(`${s.id} ${b.a}/${b.d}/${b.s}`);
    }
    if (b.lvl !== 50) notL50++;
    for (const e of t.all) {
      if (e.a < 15 && t.map.get((e.a + 1) * 256 + e.d * 16 + e.s)!.sp < e.sp) {
        nonMono++;
        break;
      }
    }
  }
  check('master rank 1 is always 15/15/15', notHundo === 0, examples.join(', '));
  check('master is always level 50', notL50 === 0, `${notL50} off`);
  check('master stat product is monotonic in IVs', nonMono === 0, `${nonMono} species`);

  // And the capped leagues must NOT be degenerate - a low attack IV genuinely
  // wins there, which is the whole reason the two are treated differently.
  const greatHundo = SPECIES.filter((s) => {
    const b = getTable(s.id, 'great').best;
    return b.a === 15 && b.d === 15 && b.s === 15;
  }).length;
  check('great is not degenerate (hundo is often not rank 1)', greatHundo < SPECIES.length * 0.5, `${greatHundo}/${SPECIES.length} hundo`);
  check('master league is flagged uncapped', getTable(SPECIES[0].id, 'master').league.uncapped === true);
  check('great league is not flagged uncapped', getTable(SPECIES[0].id, 'great').league.uncapped === false);
}

console.log('\n── movepool selection ─────────────────────────────────');
{
  const s = SPECIES_BY_ID.get('azumarill')!;
  check('species expose a full charged movepool', s.chargeMoves.length >= 2, `${s.chargeMoves.length} moves`);
  check('empty selection falls back to recommended', selectedCharges(s, []).length === chargesOf(s.chargeMove, s.chargeMove2).length);
  check('unknown ids fall back rather than emptying the moveset', selectedCharges(s, ['NOT_A_MOVE']).length > 0);
  const pick = [s.chargeMoves[s.chargeMoves.length - 1].id];
  check('explicit selection is honoured', selectedCharges(s, pick)[0].id === pick[0]);
  const multi = SPECIES.filter((x) => x.chargeMoves.length > 2).length;
  check('movepool selection is meaningful across the roster', multi > 300, `${multi} species have >2 charged moves`);
}

console.log('\n── opponent relevance ─────────────────────────────────');
{
  const t0 = Date.now();
  const r = rankedOpponents('azumarill', 'great', 0, 'either', 16);
  const cold = Date.now() - t0;
  check('returns a full slate', r.length === 16, `${r.length} opponents`);
  check('scored descending', r.every((x, i) => i === 0 || r[i - 1].score >= x.score));
  check('every entry carries a reason', r.every((x) => x.reason.length > 0));
  check('completes fast enough to be interactive', cold < 2000, `${cold}ms cold`);

  // Signal quality: an earlier probe design reported "flips at 0/1/2 shields"
  // for nearly everything, which made the ranking meaningless.
  const allThree = r.filter((x) => x.flipShields.length === 3).length;
  check('flip signal is not saturated', allThree < r.length * 0.5, `${allThree}/${r.length} flip in all three scenarios`);
  // Reasons legitimately repeat (several matchups really are "needs bulk,
  // flips at 1 shield"); what matters is that they aren't all the same string.
  const distinct = new Set(r.map((x) => x.reason)).size;
  check('reasons are differentiated', distinct >= 5, `${distinct} distinct reasons across ${r.length}`);

  // The case that drove this feature: Sableye can buy charge-move priority
  // against Feraligatr with a keepable spread, flipping a shielded scenario.
  // Restricting probes to the top 5% by stat product hid this entirely.
  const sab = rankedOpponents('sableye', 'great', 0, 'either', 60);
  const fer = sab.find((x) => x.info.id === 'feraligatr');
  check('Sableye surfaces Feraligatr as decidable', !!fer, fer ? fer.reason : 'not selected');
  check('and prices the CMP tradeoff', !!fer && fer.cmpCost != null && fer.cmpCost <= 1500, fer?.cmpCost != null ? `rank ${fer.cmpCost}` : 'no cost');

  const cmpCases = sab.filter((x) => x.cmpCost != null).length;
  check('CMP-purchasable matchups are found', cmpCases > 0, `${cmpCases} of ${sab.length}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
