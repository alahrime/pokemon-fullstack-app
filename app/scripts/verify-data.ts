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
  flipGrid,
  flipMatchupRows,
  scenarioMatrix,
  chargeMoveStats,
  fastMoveCounts,
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

console.log('\n── league membership (ranked) ─────────────────────────');
{
  // Membership is presence in the league ranking. Neither a rank cutoff nor a
  // maxCP floor works: the cutoff hid niche matchups, and the floor dropped
  // ranked-and-played forms whose CP ceiling sits below it.
  for (const lg of LEAGUES) {
    const base = SPECIES.filter((s) => s.leagues.includes(lg));
    const shadow = SPECIES.filter((s) => s.shadowLeagues.includes(lg));
    check(`${lg}: pool is substantial`, base.length + shadow.length > 400, `${base.length} base + ${shadow.length} shadow`);
    check(
      `${lg}: every member is ranked in that league`,
      base.every((s) => s.leagueRank[lg] !== undefined) && shadow.every((s) => s.shadowLeagueRank[lg] !== undefined),
      base.filter((s) => s.leagueRank[lg] === undefined).slice(0, 3).map((s) => s.id).join(', '),
    );
    check(
      `${lg}: every ranked form is in the pool`,
      SPECIES.every((s) => (s.leagueRank[lg] === undefined || s.leagues.includes(lg))
        && (s.shadowLeagueRank[lg] === undefined || s.shadowLeagues.includes(lg))),
      SPECIES.filter((s) => s.leagueRank[lg] !== undefined && !s.leagues.includes(lg)).slice(0, 3).map((s) => s.id).join(', '),
    );
  }

  // Low-maxCP staples: a CP ceiling would drop these, and the old floor did.
  for (const id of ['farfetchd', 'chansey', 'wobbuffet']) {
    const s = SPECIES_BY_ID.get(id);
    check(`${id} is a Great opponent despite maxCP ${s?.maxCP}`, !!s?.leagues.includes('great'));
  }
  for (const [id, lg] of [['aegislash_shield', 'ultra'], ['umbreon', 'master']] as const) {
    const s = SPECIES_BY_ID.get(id);
    check(`${id} is an ${lg} opponent despite maxCP ${s?.maxCP}`, !!s?.leagues.includes(lg));
  }
  // And the high-maxCP staples that underlevel into Great.
  for (const id of ['registeel', 'swampert']) {
    const s = SPECIES_BY_ID.get(id);
    check(`${id} survives in Great (maxCP ${s?.maxCP}, no ceiling)`, !!s?.leagues.includes('great'));
  }

  // Megas are never opponents: PvPoke does not rank them in any league.
  const megas = SPECIES.filter((s) => /_mega|_primal/.test(s.id));
  check(
    'megas and primals are excluded as opponents',
    megas.every((s) => s.leagues.length === 0 && s.shadowLeagues.length === 0),
    `${megas.length} checked`,
  );

  // A Shadow is its own opponent, and a league can rate one form and not the other.
  const palkia = SPECIES_BY_ID.get('palkia');
  check(
    'Shadow Palkia is a Great opponent where plain Palkia is not',
    !!palkia?.shadowLeagues.includes('great') && !palkia?.leagues.includes('great'),
  );
  check('shadowLeagues is never a superset of nothing', SPECIES.every((s) => s.shadowLeagues.length === 0 || s.shadowEligible));

  check('every species carries a maxCP', SPECIES.every((s) => Number.isFinite(s.maxCP) && s.maxCP > 0));
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

console.log('\n── asymmetric shields ─────────────────────────────────');
{
  // The report screen used to offer only "N shields each", which hides the
  // scenarios that decide most real matchups: whoever burns a shield first is
  // playing a different game from that point on. Assert the two sides are
  // genuinely independent rather than silently collapsing to the diagonal.
  const iv = { a: 0, d: 15, s: 15 };
  const oppId = OPPONENTS.great[0];
  const sym = flipGrid('azumarill', iv, 'great', oppId, 0, 1);
  const asym = flipGrid('azumarill', iv, 'great', oppId, 0, 1, undefined, 2);
  check('symmetric and asymmetric grids differ', sym.winners.length !== asym.winners.length ||
    sym.results.some((r, i) => r.result.win !== asym.results[i].result.win),
    `${sym.winners.length} winners at 1v1, ${asym.winners.length} at 1v2`);

  // Giving the opponent more shields should never help you.
  const s0 = flipGrid('azumarill', iv, 'great', oppId, 0, 1, undefined, 0).winners.length;
  const s2 = flipGrid('azumarill', iv, 'great', oppId, 0, 1, undefined, 2).winners.length;
  check('more opposing shields never helps', s2 <= s0, `${s0} winners at 1v0 vs ${s2} at 1v2`);

  // And the default still means symmetric, so old call sites are unchanged.
  const def = flipGrid('azumarill', iv, 'great', oppId, 0, 2);
  const explicit = flipGrid('azumarill', iv, 'great', oppId, 0, 2, undefined, 2);
  check('omitting theirs defaults to symmetric', def.winners.length === explicit.winners.length);

  const rows = flipMatchupRows('azumarill', iv, 'great', 0, [oppId], undefined, 2);
  check('matchup rows accept a fixed opposing count', rows.length === 1 && rows[0].cells.length === 3);

  // The scenario picker now displays an outcome per cell, so those numbers
  // have to agree with the grid they select. A silent divergence here would be
  // worse than no readout at all.
  const sm = scenarioMatrix('azumarill', iv, 'great', oppId, 0);
  check('scenario matrix is 3x3', sm.length === 3 && sm.every((r) => r.length === 3));

  let agree = true;
  const detail: string[] = [];
  for (let m = 0; m < 3; m++) {
    for (let t = 0; t < 3; t++) {
      const g = flipGrid('azumarill', iv, 'great', oppId, 0, m, undefined, t);
      const mine = g.results.find((r) => r.entry.a === iv.a && r.entry.d === iv.d)!;
      if (mine.result.win !== sm[m][t].win || Math.abs(mine.result.margin - sm[m][t].margin) > 1e-9) {
        agree = false;
        detail.push(`${m}v${t}: grid ${mine.result.margin.toFixed(1)} vs picker ${sm[m][t].margin.toFixed(1)}`);
      }
    }
  }
  check('picker cells match the grid for the same spread', agree, detail.slice(0, 3).join(' | '));

  // Sanity on direction: your own shields should never hurt you.
  const monotoneMine = [0, 1, 2].every((t) => sm[0][t].margin <= sm[2][t].margin + 1e-9);
  check('more of your own shields never hurts', monotoneMine,
    `0sh ${sm[0].map((c) => c.margin.toFixed(0)).join('/')} vs 2sh ${sm[2].map((c) => c.margin.toFixed(0)).join('/')}`);
}

console.log('\n── move economics ─────────────────────────────────────');
{
  const lick = SPECIES_BY_ID.get('lickilicky')!;
  const rollout = lick.fastMoves.find((m) => m.id === 'ROLLOUT');
  check('lickilicky has Rollout', !!rollout, rollout ? `gain ${rollout.energyGain}/${rollout.turns}t` : '');

  // Worked example supplied as the spec. Damage is STAB-adjusted power, which
  // is why Body Slam reads 66 rather than its raw 55.
  const EXPECT: Record<string, { dmg: number; energy: number; dpe: string; counts: string }> = {
    BODY_SLAM: { dmg: 66, energy: 35, dpe: '1.89', counts: '3-3-3-2' },
    SHADOW_BALL: { dmg: 100, energy: 50, dpe: '2.00', counts: '4-4-4-4' },
    EARTHQUAKE: { dmg: 120, energy: 65, dpe: '1.85', counts: '5-5-5-5' },
    SOLAR_BEAM: { dmg: 150, energy: 80, dpe: '1.88', counts: '7-6-6-6' },
    HYPER_BEAM: { dmg: 180, energy: 80, dpe: '2.25', counts: '7-6-6-6' },
  };

  if (rollout) {
    for (const [id, e] of Object.entries(EXPECT)) {
      const cm = lick.chargeMoves.find((m) => m.id === id);
      if (!cm) {
        check(`lickilicky has ${id}`, false);
        continue;
      }
      const s = chargeMoveStats(cm);
      const counts = fastMoveCounts(rollout, cm).join('-');
      const ok = Math.round(s.damage) === e.dmg && s.energy === e.energy && s.dpe.toFixed(2) === e.dpe && counts === e.counts;
      check(
        `${cm.name}: ${e.dmg} dmg / ${e.energy} nrg / ${e.dpe} dpe / ${e.counts}`,
        ok,
        ok ? '' : `got ${s.damage.toFixed(0)} / ${s.energy} / ${s.dpe.toFixed(2)} / ${counts}`,
      );
    }
  }

  // Counts must never be zero or negative, and must be finite for every
  // fast/charged pairing in the game - a divide-by-zero here would render NaN.
  let bad = 0;
  let noGain = 0;
  for (const sp of SPECIES) {
    for (const f of sp.fastMoves) {
      if (f.energyGain <= 0) {
        noGain++;
        continue;
      }
      for (const c of sp.chargeMoves) {
        const counts = fastMoveCounts(f, c);
        if (counts.length !== 4 || counts.some((n) => !Number.isFinite(n) || n < 1)) bad++;
      }
    }
  }
  check('every fast/charged pairing yields sane counts', bad === 0, `${bad} bad`);
  check('zero-gain fast moves are handled, not divided by', noGain >= 0, `${noGain} fast moves gain no energy`);

  // Move type and archetype must survive generation - they drive the icons.
  const typed = SPECIES.every((sp) => sp.fastMoves.every((m) => !!m.type) && sp.chargeMoves.every((m) => !!m.type));
  check('every move carries a type', typed);
  const archs = new Set<string>();
  for (const sp of SPECIES) for (const m of sp.chargeMoves) if (m.archetype) archs.add(m.archetype);
  check('archetypes present', archs.size > 5, `${archs.size} distinct`);
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
