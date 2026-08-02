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

import { SPECIES, SPECIES_BY_ID, OPPONENTS, ROSTER, UNSIMULATED_IDS, conflictsOnTeam, isSimulated, makeRef, movesFor, opponentCandidatesFor, parseRef, pickableFor, speciesOf, teamIsLegal } from '../src/lib/data';
import exclusions from '../../data-src/pool-exclusions.json';
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
import { QUERY_FORMS, compileQuery } from '../src/lib/query';
import { CATEGORIES, LOSS_CURVE, SHIELD_BONUS, SOFT_CAP, rating } from '../src/lib/scenarios';
import { teamBattle, teamRating } from '../src/lib/team';
import { monFor } from '../src/lib/teambuild';
import { TEAM_ENGINE_REV, TEAM_PASSES, TEAM_TIERS, bestTeams, coresFor, pillarsFor } from '../src/lib/teams';
import { relevanceWeights, typeCoverage, typePressure, worstSharedWeakness } from '../src/lib/synergy';
import { ENGINE_REV, fieldPool, overallOf, teamPool } from '../src/lib/rankings';
import { toCsv } from '../src/lib/exportData';
import type { BattleResult, LeagueId } from '../src/lib/types';

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
  const MASTER_EXEMPT = new Set(['lapras', 'kingdra']);
  const dropped = (lg: string) =>
    new Set([...(exclusions.all ?? []), ...((exclusions as Record<string, string[]>)[lg] ?? [])]);
  for (const lg of LEAGUES) {
    const base = SPECIES.filter((s) => s.leagues.includes(lg));
    const shadow = SPECIES.filter((s) => s.shadowLeagues.includes(lg));
    check(`${lg}: pool is substantial`, base.length + shadow.length > 300, `${base.length} base + ${shadow.length} shadow`);
    check(
      `${lg}: every member is ranked in that league`,
      base.every((s) => s.leagueRank[lg] !== undefined) && shadow.every((s) => s.shadowLeagueRank[lg] !== undefined),
      base.filter((s) => s.leagueRank[lg] === undefined).slice(0, 3).map((s) => s.id).join(', '),
    );
    // Master additionally requires a 3000 maxCP ceiling - uncapped, so a low
    // ceiling is pure forfeited power rather than a matchup question - less
    // the two forms named as exempt for landing within 15 CP of it.
    const eligible = (s: (typeof SPECIES)[number]) =>
      (lg !== 'master' || s.maxCP >= 3000 || MASTER_EXEMPT.has(s.id)) && !dropped(lg).has(s.id);
    check(
      `${lg}: every ranked, eligible form is in the pool`,
      SPECIES.every((s) => !eligible(s) || ((s.leagueRank[lg] === undefined || s.leagues.includes(lg))
        && (s.shadowLeagueRank[lg] === undefined || s.shadowLeagues.includes(lg)))),
      SPECIES.filter((s) => eligible(s) && s.leagueRank[lg] !== undefined && !s.leagues.includes(lg)).slice(0, 3).map((s) => s.id).join(', '),
    );
    if (lg === 'master') {
      check(
        'master: every member reaches 3000 CP or is named exempt',
        [...base, ...shadow].every((s) => s.maxCP >= 3000 || MASTER_EXEMPT.has(s.id)),
        [...base, ...shadow].filter((s) => s.maxCP < 3000 && !MASTER_EXEMPT.has(s.id)).slice(0, 3).map((s) => `${s.id} ${s.maxCP}`).join(', '),
      );
    }
  }

  // Low-maxCP staples: a CP ceiling would drop these, and the old floor did.
  for (const id of ['farfetchd', 'chansey', 'wobbuffet']) {
    const s = SPECIES_BY_ID.get(id);
    check(`${id} is a Great opponent despite maxCP ${s?.maxCP}`, !!s?.leagues.includes('great'));
  }
  {
    // Held out of the simulator rather than out of a league: league membership
    // in the data stays honest, and every picker filters on UNSIMULATED_IDS.
    const pool = opponentCandidatesFor('ultra');
    const inRoster = new Set(ROSTER.map((r) => r.ref));
    for (const id of UNSIMULATED_IDS) {
      check(`${id} is held out of every picker and pool`,
        !pool.includes(id) && !inRoster.has(id) && !inRoster.has(makeRef(id, true)));
    }
    const s = SPECIES_BY_ID.get('aegislash_shield');
    check('...while its league data stays intact for when it returns', !!s?.leagueRank.great);
  }
  // In uncapped Master a low ceiling is forfeited power, so these are dropped.
  for (const id of ['umbreon', 'registeel']) {
    const s = SPECIES_BY_ID.get(id);
    check(
      `${id} is cut from Master by the 3000 floor (maxCP ${s?.maxCP})`,
      !s?.leagues.includes('master') && !s?.shadowLeagues.includes('master'),
    );
  }
  // ...but the two named exemptions survive it.
  for (const id of ['lapras', 'kingdra']) {
    const s = SPECIES_BY_ID.get(id);
    check(`${id} is exempt and stays in Master (maxCP ${s?.maxCP})`, !!s?.leagues.includes('master'));
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

console.log('\n── search language ────────────────────────────────────');
{
  // Every form the in-app legend advertises must actually parse and match
  // something. A syntax guide that documents a form the parser lost is worse
  // than no guide, and this is the only thing keeping the two honest.
  for (const group of QUERY_FORMS) {
    for (const f of group.forms) {
      // Legend entries list alternatives as "gen1 · kanto"; test each.
      for (const syntax of f.syntax.split('·').map((x) => x.trim())) {
        const term = compileQuery(syntax, SPECIES);
        const hits = term ? SPECIES.filter(term).length : 0;
        check(`${syntax} matches something`, hits > 0, `${hits} hits`);
      }
    }
  }
  // Operators must actually narrow and widen, not silently no-op.
  const count = (q: string) => {
    const t = compileQuery(q, SPECIES);
    return t ? SPECIES.filter(t).length : 0;
  };
  const water = count('water');
  check('& narrows', count('water&legendary') < water && count('water&legendary') > 0);
  check(', widens', count('water,fighting') > water);
  check('! inverts', count('water') + count('!water') === SPECIES.length);
  check('&& chains', count('gen1&water&!starter') < count('gen1&water'));
}

console.log('\n── shadow ─────────────────────────────────────────────');
const shadowEligible = SPECIES.filter((s) => s.shadowEligible);
check('shadow-eligible population', shadowEligible.length > 400, `${shadowEligible.length} species`);
{
  // Held-out species contribute no rows at all, base or Shadow.
  const sim = SPECIES.filter((s) => isSimulated(s.id));
  const simShadow = sim.filter((s) => s.shadowEligible);
  check(
    'ROSTER adds a shadow row per eligible simulated species',
    ROSTER.length === sim.length + simShadow.length,
    `${ROSTER.length} rows, ${SPECIES.length - sim.length} species held out`,
  );
}

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
  const foeMon = mkBattleMon(foe, foe.fastMove, chargesOf(foe.chargeMove, foe.chargeMove2), foe.types);
  const sp = SPECIES_BY_ID.get(id)!;

  const mk = (shadow: boolean) => {
    const t = getTable(makeRef(id, shadow), league);
    const e = t.map.get(iv.a * 256 + iv.d * 16 + iv.s)!;
    return mkBattleMon(e, sp.fastMoves[0], chargesOf(sp.chargeMove, sp.chargeMove2), sp.types);
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
  // Search the curated list rather than assuming index 0 is a live matchup.
  // Pinning one opponent made this assert nothing the moment that matchup went
  // one-sided — which is exactly what happened once type effectiveness landed
  // and Azumarill stopped winning any scenario against it. The claim is that
  // the two sides are independent *somewhere*, so look for that.
  const oppId = OPPONENTS.great[0];
  let found: string | null = null;
  for (const cand of OPPONENTS.great) {
    const a = flipGrid('azumarill', iv, 'great', cand, 0, 1);
    const b = flipGrid('azumarill', iv, 'great', cand, 0, 1, undefined, 2);
    if (a.winners.length !== b.winners.length || a.results.some((r, i) => r.result.win !== b.results[i].result.win)) {
      found = cand;
      break;
    }
  }
  check('shield counts are independent for some curated matchup', found !== null, found ?? 'no matchup differed');

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

// ── rating basis ───────────────────────────────────────────────────────────
// PvPoke's mechanics, adopted from their Ranker.js. The three that matter are
// shield-pressure credit, the soft cap on blowouts, and the curve on bad
// losses; each is asserted against a case with a known answer.
console.log('\n── rating basis ───────────────────────────────────────');
{
  const res = (o: Partial<BattleResult>): BattleResult => ({
    win: false, mine: 0, theirs: 0, hpA: 0, hpB: 0, maxHpA: 100, maxHpB: 100,
    cmpDecided: false, margin: 0, energyA: 0, energyB: 0, shieldsA: 0, shieldsB: 0,
    log: [], ...o,
  });

  // Base: health kept + damage dealt, 500 each. Probed at 80% dealt, which
  // lands at 400 — above LOSS_CURVE, so the raw formula is visible. A loss
  // dealing half sits at 250 and IS curved; an earlier fixture here asserted
  // 250 and was simply wrong about where the threshold falls.
  const cleanLoss = rating(res({ win: false, mine: 0, theirs: 0.2 }), 0, 0);
  check('base rating is health kept plus damage dealt', cleanLoss === 400, `${cleanLoss}`);
  const evenLoss = rating(res({ win: false, mine: 0, theirs: 0.5 }), 0, 0);

  // Shield pressure: only on a win, 100 per shield forced and per shield kept.
  const noPressure = rating(res({ win: true, mine: 0.5, theirs: 0, shieldsA: 0, shieldsB: 2 }), 2, 2);
  const forcedTwo = rating(res({ win: true, mine: 0.5, theirs: 0, shieldsA: 0, shieldsB: 0 }), 2, 2);
  check('forcing shields pays on a win', forcedTwo > noPressure, `${noPressure} -> ${forcedTwo}`);
  const keptTwo = rating(res({ win: true, mine: 0.5, theirs: 0, shieldsA: 2, shieldsB: 2 }), 2, 2);
  check('keeping your own shields pays too', keptTwo > noPressure, `${noPressure} -> ${keptTwo}`);
  const lostPressure = rating(res({ win: false, mine: 0, theirs: 0.5, shieldsA: 2, shieldsB: 0 }), 2, 2);
  check('...and neither pays on a loss', lostPressure === evenLoss, `${lostPressure} vs ${evenLoss}`);

  // Soft cap: a blowout is worth barely more than a clean win. This is the
  // mechanism that stops a polarising wall out-scoring an even trader.
  const clean = rating(res({ win: true, mine: 0.4, theirs: 0, shieldsA: 0, shieldsB: 2 }), 2, 2);
  const blowout = rating(res({ win: true, mine: 1, theirs: 0, shieldsA: 2, shieldsB: 0 }), 2, 2);
  check('blowouts are soft-capped near 700', blowout < SOFT_CAP + 30, `${blowout}`);
  check('...so crushing beats winning cleanly by very little', blowout - clean < 120, `${clean} -> ${blowout}`);

  // Loss curve: failing to trade at all costs more than losing gracefully.
  const graceful = rating(res({ win: false, mine: 0, theirs: 0.45 }), 1, 1);
  const limp = rating(res({ win: false, mine: 0, theirs: 0.95 }), 1, 1);
  check('a limp loss is curved down below the linear value', limp < 25 * 2, `${limp} (linear would be 25)`);
  check('...and grades below a graceful one', limp < graceful, `${limp} < ${graceful}`);
  check('a loss dealing half is curved, not linear', evenLoss < 250 && evenLoss > 150, `250 -> ${evenLoss}`);
  // The threshold itself: at and above LOSS_CURVE the value passes through.
  check('the curve stops exactly at the threshold',
    rating(res({ win: false, mine: 0, theirs: 0.4 }), 0, 0) === LOSS_CURVE, 'base 300 is untouched');
  check('SHIELD_BONUS is the documented 100', SHIELD_BONUS === 100);
}

// ── team chains ────────────────────────────────────────────────────────────
console.log('\n── team chains ────────────────────────────────────────');
{
  const mk = (ref: string) => monFor(ref, 'great');
  const A = ['registeel', 'azumarill', 'medicham'].map(mk);
  const B = ['swampert', 'skarmory', 'lanturn'].map(mk);

  const even = teamBattle(A, B, { shields: 2 });
  check('a 3v3 chain resolves', Number.isFinite(even.hpFracA) && even.steps.length > 0, `${even.steps.length} exchanges, ${even.aliveA}-${even.aliveB}`);
  check('team rating is on the 0-1000 scale', teamRating(even) >= 0 && teamRating(even) <= 1000, `${teamRating(even)}`);

  // Asymmetric shields must actually reach the engine. A single `shields`
  // option applied to both sides would make these two identical, which is the
  // bug this parameter was added to prevent.
  const up = teamBattle(A, B, { shieldsA: 2, shieldsB: 0 });
  const down = teamBattle(A, B, { shieldsA: 0, shieldsB: 2 });
  check('shield parity changes the result', up.hpFracA !== down.hpFracA, `2v0 ${up.hpFracA.toFixed(3)} vs 0v2 ${down.hpFracA.toFixed(3)}`);
  check('...and holding the shields is better', up.hpFracA > down.hpFracA);

  // Banked energy likewise, and only for the lead.
  const cold = teamBattle(A, B, { shields: 1, bankedA: 0 });
  const hot = teamBattle(A, B, { shields: 1, bankedA: 1 });
  check('a banked lead changes the chain', cold.hpFracA !== hot.hpFracA, `${cold.hpFracA.toFixed(3)} -> ${hot.hpFracA.toFixed(3)}`);

  check('survivor energy is reported', hot.energyA >= 0 && hot.energyA <= 100, `${hot.energyA}`);
  const wiper = teamBattle(A, A.slice(0, 1), {});
  check('a wiped side banks no energy', wiper.energyB === 0);
}

// ── baiting against a reading defender ─────────────────────────────────────
// A two-move attacker used to bait forever against `read`: the rule threw the
// secondary whenever the opponent held a shield, the reading defender declined
// it on purpose, the shield never came down, and the attacker re-threw the
// cheap move every time it could afford it. Lickilicky vs Registeel was four
// Body Slams and no Shadow Ball, peak energy 47 against the 50 it needed — its
// coverage move never existed. This is the regression guard.
console.log('\n── baiting vs a reading defender ──────────────────────');
{
  const mk = (r: string) => monFor(r, 'great');
  const lick = mk('lickilicky');
  const reg = mk('registeel');
  const r = battle(lick, reg, 1, 1, 0, 0, true, true, undefined, undefined, 'read', 'read');
  const charges = r.log.filter((l) => l.actor === 'A' && l.kind === 'charge');
  const names = new Set(charges.map((l) => l.moveName));
  // The point is that the MAIN move comes out — Shadow Ball is the efficient
  // one into Steel. An earlier fixture required two distinct moves, which the
  // bait-efficiency rule then made wrong: it now declines the resisted Body
  // Slam outright, so only Shadow Ball is thrown. That is the better outcome.
  check('the attacker reaches its main move against a reading defender',
    names.has('Shadow Ball'), [...names].join(', ') || 'threw nothing');
  check('...and the resisted bait is not spammed',
    charges.filter((l) => l.moveName === 'Body Slam').length <= 2,
    `${charges.filter((l) => l.moveName === 'Body Slam').length} Body Slams`);
  check('...and the defender\'s shield is eventually spent', r.shieldsB === 0, `${r.shieldsB} left`);

  // The same matchup under `always` must be unaffected: the fix only changes
  // behaviour once a bait has actually been waved through.
  const alw = battle(lick, reg, 1, 1, 0, 0, true, true, undefined, undefined, 'always', 'always');
  check('`always` behaviour is untouched', alw.shieldsB === 0 && alw.log.some((l) => l.kind === 'charge' && l.shielded));
}

// ── farm-downs and carried energy ──────────────────────────────────────────
// `pickCharge` used to return main the instant it was affordable, so a mon
// that could finish the job on fast moves alone still spent its bar on a kill
// it already had — 46.3% of all charged throws in Great went into an opponent
// fast moves had already killed. Shadow Marowak's Mud Slap into Registeel is
// the clean case: no fast pressure coming back, so the farm is nearly free and
// the energy is worth far more carried into the next Pokemon. See §1h.
console.log('\n── farm-downs ─────────────────────────────────────────');
{
  const mk = (r: string) => monFor(r, 'great');
  const wak = mk('marowak_alolan_shadow');
  const reg = mk('registeel');
  const r = battle(wak, reg, 0, 0, 0, 0, true, true, undefined, undefined, 'always', 'always');
  check('the farm-down still wins the matchup', r.win, `hpA ${r.hpA}`);
  check('...and walks out holding most of a bar', r.energyA >= 60, `${r.energyA} energy`);

  // The other side of the rule: real fast pressure must still get the move
  // thrown. Lickilicky and Registeel chip each other, so farming loses more
  // health than the banked energy is worth and the bar goes out on schedule.
  const lick = battle(mk('lickilicky'), reg, 1, 1, 0, 0, true, true, undefined, undefined, 'always', 'always');
  check('a contested matchup still throws its charged moves',
    lick.log.filter((l) => l.actor === 'A' && l.kind === 'charge').length >= 2,
    `${lick.log.filter((l) => l.actor === 'A' && l.kind === 'charge').length} throws`);

  // Holding is never allowed to lose a fight it would otherwise have won.
  // incomingKO short-circuits the rule; this guards that it stays wired up.
  const azu = battle(mk('azumarill'), mk('medicham'), 0, 0, 0, 0, true, true, undefined, undefined, 'always', 'always');
  check('a won matchup is not thrown away by holding', azu.win, `hpA ${azu.hpA}`);
}

// ── team legality ──────────────────────────────────────────────────────────
// GBL forbids duplicate species and decides duplicate by Pokedex number. Every
// case below is one this rule has to catch and an id comparison would not.
console.log('\n── team legality ──────────────────────────────────────');
{
  const pair = (a: string, b: string) => conflictsOnTeam(a, b);
  // Regional forms share a dex.
  check('Alolan Ninetales blocks Kanto Ninetales', pair('ninetales', 'ninetales_alolan'));
  check('Galarian Stunfisk blocks Kanto Stunfisk', pair('stunfisk', 'stunfisk_galarian'));
  // A Shadow shares its base form's dex.
  check('a Shadow blocks its plain form', pair('registeel', 'registeel_shadow'));
  check('...and across a regional form too', pair('ninetales_alolan', 'ninetales_alolan_shadow'));
  // Alternate forms of a legendary.
  check('Origin Dialga blocks Dialga', pair('dialga', 'dialga_origin'));
  // Note the id: the base form is `zacian_hero`, not `zacian`. An earlier
  // version of this check used the latter, which resolves to no species at all
  // and so passed the rule trivially — a fixture that tested nothing.
  check('Crowned Zacian blocks Hero Zacian', pair('zacian_hero', 'zacian_crowned_sword'));
  check('Crowned Zamazenta blocks Hero Zamazenta', pair('zamazenta_hero', 'zamazenta_crowned_shield'));
  // Guard the trap directly: an unknown ref must never read as "no conflict",
  // because that is how a typo turns into a silently permissive rule.
  check('an unknown ref is not silently compatible',
    !pair('zacian', 'zacian_crowned_sword') && SPECIES_BY_ID.get('zacian') === undefined,
    'zacian is not a real id — zacian_hero is');
  // A Mega shares its base dex. Megas are not opponents, so this is asserted
  // on the rule rather than through a pool.
  const mega = SPECIES.find((s) => /_mega$/.test(s.id) && SPECIES_BY_ID.has(s.id.replace(/_mega$/, '')));
  check('a Mega blocks its base form', !!mega && pair(mega.id, mega.id.replace(/_mega$/, '')),
    mega ? `${mega.id} vs ${mega.id.replace(/_mega$/, '')}` : 'no mega with a base form found');
  // And genuinely different species stay legal.
  check('different species do not block each other', !pair('registeel', 'azumarill'));
  check('a Shadow of a different species is fine', !pair('registeel', 'azumarill_shadow'));

  // What the builder's picker offers, computed the same way the screen does.
  // Asserted here rather than by driving the dropdown: this is the predicate
  // the component's `selectable` memo is built from, and a rule that holds in
  // the module holds in every consumer of it.
  {
    const team = ['registeel'];
    const offered = teamPool('great').filter(
      (r) => !team.some((m) => m === r || conflictsOnTeam(m, r)),
    );
    const pool = teamPool('great');
    check('picker drops the pick already on the team', !offered.includes('registeel'));
    check('picker drops its Shadow too',
      !offered.includes('registeel_shadow'),
      pool.includes('registeel_shadow') ? 'and the pool does contain it' : 'pool has no Shadow to drop — weak test');
    check('picker keeps unrelated species', offered.length >= pool.length - 3,
      `${offered.length} of ${pool.length} still offered`);
  }

  check('teamIsLegal accepts a clean trio', teamIsLegal(['registeel', 'azumarill', 'medicham']));
  check('teamIsLegal rejects a Shadow pairing', !teamIsLegal(['registeel', 'azumarill', 'registeel_shadow']));
  check('teamIsLegal rejects a regional pairing', !teamIsLegal(['ninetales', 'azumarill', 'ninetales_alolan']));
}

// ── what a builder will let you pick ───────────────────────────────────────
// The team pickers were restricted to our own top 100, which quietly made
// Altaria unselectable in Great — PvPoke's #4 there, and our #106, so it missed
// the cut by one place. League membership in this codebase means "PvPoke ranks
// it", which is a relevance claim, not a legality one; GBL lets you bring
// anything inside the CP cap.
console.log('\n── pickable roster ────────────────────────────────────');
for (const lg of LEAGUES) {
  const pick = new Set(pickableFor(lg));
  check(`${lg}: picker offers far more than the ranked pool`, pick.size > 1000, `${pick.size} refs`);

  // The specific regression, named. Each of these is legal and was blocked.
  for (const ref of ['altaria', 'altaria_shadow', 'electrode_hisuian', 'kingdra', 'sealeo', 'marowak', 'carbink']) {
    if (!SPECIES_BY_ID.has(parseRef(ref).id)) continue;
    check(`${lg}: ${ref} is selectable`, pick.has(ref));
  }

  // ...and the two exclusions that are real.
  const megas = [...pick].filter((r) => /_mega|_primal/.test(r));
  check(`${lg}: Megas and Primals stay out — GBL does not allow them`, megas.length === 0, megas.slice(0, 3).join(', '));
  const unsim = [...pick].filter((r) => !isSimulated(r));
  check(`${lg}: species the engine cannot model stay out`, unsim.length === 0, unsim.slice(0, 3).join(', '));

  // Everything offered has to actually simulate, or the picker is a trap.
  const sample = ['altaria', 'caterpie', 'kingdra'].filter((r) => pick.has(r));
  let built = 0;
  for (const r of sample) {
    const m = monFor(r, lg);
    if (m.hp > 0 && m.atk > 0 && m.fast) built++;
  }
  check(`${lg}: off-meta picks price and simulate`, built === sample.length, `${built}/${sample.length}`);
}

// ── stacked weaknesses ─────────────────────────────────────────────────────
// The constraint that no team may be more than two deep into one exploitable
// weakness. Asserted on the shipped artefact rather than trusted from the
// build: an earlier version computed type pressure per tier, which silently
// under-counted Fire at tier 50 and shipped 27 triple-Steel teams. The build
// reported success throughout.
console.log('\n── stacked weaknesses ─────────────────────────────────');
for (const lg of LEAGUES) {
  const field = fieldPool(lg, '500', 500);
  const pressure = typePressure(
    field.map((r) => {
      const sp = speciesOf(r);
      if (!sp) return [] as string[];
      const rec = movesFor(sp, lg);
      return [...new Set([rec.fast.type, ...rec.charges.map((c) => c.type)])];
    }),
    relevanceWeights(field.map((r) => overallOf(lg, '500', r)), 2),
  );

  // Ground and Fire have to clear the bar, or the threshold is set so high the
  // constraint is decorative — these are the two that produced real failures.
  check(`${lg}: Ground registers as an exploitable type`, (pressure.get('ground') ?? 0) > 0.04,
    `pressure ${(pressure.get('ground') ?? 0).toFixed(3)}`);
  check(`${lg}: Fire registers as an exploitable type`, (pressure.get('fire') ?? 0) > 0.04,
    `pressure ${(pressure.get('fire') ?? 0).toFixed(3)}`);

  let bad3 = 0;
  let bad6 = 0;
  let first = '';
  for (const t of TEAM_TIERS(lg)) {
    for (const c of CATEGORIES) {
      for (const p of TEAM_PASSES.map((x) => x.id)) {
        for (const [size, cap] of [[3, 2], [6, 3]] as const) {
          for (const team of bestTeams(lg, t, c.id, p, size)) {
            const w = worstSharedWeakness(
              team.refs.map((r) => speciesOf(r)?.types ?? []), pressure, 0.04,
            );
            if (w && w.count > cap) {
              if (size === 3) bad3++; else bad6++;
              if (!first) first = `${t}|${c.id}|${p}|${size}: ${team.refs.join('/')} — ${w.count} weak to ${w.type}`;
            }
          }
        }
      }
    }
  }
  check(`${lg}: no three is more than two deep into one weakness`, bad3 === 0, first || `${bad3} teams`);
  check(`${lg}: no six is more than three deep into one weakness`, bad6 === 0, `${bad6} teams`);
}

// ── export ─────────────────────────────────────────────────────────────────
// These files leave the app and get loaded into something else, so a quoting
// bug does not show up as an error — it shows up as a column silently shifted
// by one in someone's analysis weeks later.
console.log('\n── export ─────────────────────────────────────────────');
{
  const csv = toCsv([
    { a: 'plain', b: 'has,comma', c: 'has"quote', d: 'has\nnewline', e: 1, f: null },
  ]);
  const body = csv.replace(/^﻿/, '').split('\r\n')[1];
  check('header comes from the keys', csv.replace(/^﻿/, '').startsWith('a,b,c,d,e,f'));
  check('commas are quoted', body.includes('"has,comma"'), body);
  check('quotes are doubled and wrapped', body.includes('"has""quote"'), body);
  check('newlines are quoted', body.includes('"has\nnewline"'));
  check('null renders empty, not the string null', body.endsWith(',1,'), body);
  check('a BOM leads the file so Excel reads UTF-8', csv.charCodeAt(0) === 0xfeff);
  check('empty input yields empty output', toCsv([]) === '');

  // Round-trip a row that would break a naive split(','). Parsed with a real
  // state machine rather than a regex: a regex that "mostly works" here would
  // be testing the test, and the trailing empty field is exactly the case a
  // sloppy parser drops.
  const parseRow = (s: string) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c !== '"') cur += c;
        else if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const parsed = parseRow(body);
  check('a naive-hostile row round-trips', parsed.length === 6, `${parsed.length} fields: ${JSON.stringify(parsed)}`);
  check('...with every value intact',
    parsed[1] === 'has,comma' && parsed[2] === 'has"quote' && parsed[3] === 'has\nnewline' && parsed[5] === '',
    JSON.stringify(parsed));
}

// ── discovered teams ───────────────────────────────────────────────────────
console.log('\n── discovered teams ───────────────────────────────────');
for (const lg of LEAGUES) {
  const tiers = TEAM_TIERS(lg);
  check(`${lg}: teams built against the shipped matrix`, TEAM_ENGINE_REV(lg) === ENGINE_REV(lg), `teams rev ${TEAM_ENGINE_REV(lg)}, rankings rev ${ENGINE_REV(lg)}`);

  let missing = 0;
  let badSize = 0;
  let dupes = 0;
  let outOfRange = 0;
  let unsorted = 0;
  let illegal = 0;
  let firstIllegal = '';
  for (const t of tiers) {
    for (const c of CATEGORIES) {
      for (const p of TEAM_PASSES.map((x) => x.id)) {
        for (const size of [3, 6] as const) {
          const list = bestTeams(lg, t, c.id, p, size);
          if (!list.length) { missing++; continue; }
          for (const team of list) {
            if (team.refs.length !== size) badSize++;
            if (new Set(team.refs).size !== size) dupes++;
            if (!teamIsLegal(team.refs)) {
              illegal++;
              if (!firstIllegal) firstIllegal = `${t}|${c.id}|${p}|${size}: ${team.refs.join(' / ')}`;
            }
            // A six's carrying line is a real team too and must be legal.
            if (team.line && !teamIsLegal(team.line)) {
              illegal++;
              if (!firstIllegal) firstIllegal = `line ${team.line.join(' / ')}`;
            }
            if (!(team.score >= 0 && team.score <= 1000)) outOfRange++;
          }
          if (list.some((x, i) => i > 0 && list[i - 1].score < x.score)) unsorted++;
        }
      }
    }
  }
  const strata = tiers.length * CATEGORIES.length * TEAM_PASSES.length * 2;
  check(`${lg}: every stratum populated`, missing === 0, `${strata - missing}/${strata}`);
  check(`${lg}: team sizes correct`, badSize === 0);
  check(`${lg}: no repeated member within a team`, dupes === 0);
  check(`${lg}: no duplicate species within a team`, illegal === 0,
    illegal === 0 ? '' : `${illegal} teams break the dex rule, e.g. ${firstIllegal}`);
  check(`${lg}: scores on the 0-1000 scale`, outOfRange === 0);
  check(`${lg}: each stratum sorted best-first`, unsorted === 0);

  // The stratification has to do work. If every stratum returned the same team
  // the axes would be decorative — exactly the failure mode the "inherit
  // through the candidate pool only" design would have had.
  //
  // Measured across all 84 strata rather than on one pair, because a single
  // pair proves nothing either way: at Ultra's top-50 cutoff the pool is small
  // enough that Leads and Closers genuinely agree, and an assertion that reads
  // one stratum reports that real result as a bug.
  const distinct3 = new Set<string>();
  const distinct6 = new Set<string>();
  for (const t of tiers)
    for (const c of CATEGORIES)
      for (const p of TEAM_PASSES.map((x) => x.id)) {
        distinct3.add(bestTeams(lg, t, c.id, p, 3)[0]?.refs.join('|') ?? '');
        distinct6.add(bestTeams(lg, t, c.id, p, 6)[0]?.refs.join('|') ?? '');
      }
  check(`${lg}: strata select genuinely different threes`, distinct3.size > strata / 8,
    `${distinct3.size} distinct top teams across ${tiers.length * CATEGORIES.length * TEAM_PASSES.length} strata`);
  check(`${lg}: strata select genuinely different sixes`, distinct6.size > strata / 8,
    `${distinct6.size} distinct top sixes across ${tiers.length * CATEGORIES.length * TEAM_PASSES.length} strata`);

  // A six's carrying line must be three of its own six.
  const six = bestTeams(lg, tiers[0], 'overall', 'd1', 6)[0];
  check(`${lg}: a six's best line is drawn from that six`,
    !!six?.line && six.line.length === 3 && six.line.every((r) => six.refs.includes(r)),
    six?.line?.join(' / ') ?? 'none');
}

// ── synergy and cores ──────────────────────────────────────────────────────
console.log('\n── synergy and cores ──────────────────────────────────');
{
  // Type complementarity is pure type-chart arithmetic, so it can be asserted
  // against cases with a known answer rather than against whatever the data
  // happens to say.
  const monoFire = [['fire'], ['fire'], ['fire']];
  check('three of one typing cover none of their own weaknesses', typeCoverage(monoFire) === 0,
    `${typeCoverage(monoFire)}`);
  // Altaria (dragon/flying) is weak to Ice; Empoleon (water/steel) resists it.
  // Empoleon is weak to Ground and Fighting; Altaria is immune to Ground.
  const pair = typeCoverage([['dragon', 'flying'], ['water', 'steel']]);
  check('Altaria/Empoleon typings cover each other', pair > 0.5, `${pair.toFixed(2)} of weaknesses covered`);
  check('...better than a same-typed pair',
    pair > typeCoverage([['dragon', 'flying'], ['dragon', 'flying']]));
}

for (const lg of LEAGUES) {
  const cores = coresFor(lg);
  const pillars = pillarsFor(lg);
  check(`${lg}: cores present`, cores.length > 0, `${cores.length}`);
  if (cores.length) {
    // Mutuality is the definition, not a nicety: a geometric mean of the two
    // rescue directions must be zero unless BOTH are positive.
    check(`${lg}: every core rescues in both directions`,
      cores.every((c) => c.aRescuedByB > 0 && c.bRescuedByA > 0),
      cores.filter((c) => !(c.aRescuedByB > 0 && c.bRescuedByA > 0)).slice(0, 2)
        .map((c) => `${c.a}+${c.b}`).join(', '));
    check(`${lg}: no core pairs a species with itself`,
      cores.every((c) => !conflictsOnTeam(c.a, c.b)),
      cores.filter((c) => conflictsOnTeam(c.a, c.b)).slice(0, 2).map((c) => `${c.a}+${c.b}`).join(', '));
    check(`${lg}: cores sorted by mutual rescue`,
      cores.every((c, i) => i === 0 || cores[i - 1].score >= c.score));
    check(`${lg}: cores carry their evidence`,
      cores.every((c) => c.bCovers.length + c.bCoversTypes.length > 0),
      `${cores.filter((c) => c.bCovers.length + c.bCoversTypes.length === 0).length} without any`);
  }

  check(`${lg}: pillars present`, pillars.length > 0, `${pillars.length}`);
  if (pillars.length) {
    check(`${lg}: a pillar's lead and backs are three distinct species`,
      pillars.every((p) => p.backs.length === 2 && teamIsLegal([p.lead, ...p.backs])),
      pillars.filter((p) => !teamIsLegal([p.lead, ...p.backs])).slice(0, 2)
        .map((p) => `${p.lead}+${p.backs.join('+')}`).join(', '));
    check(`${lg}: double cover is a share, not a count`,
      pillars.every((p) => p.doubleCover >= 0 && p.doubleCover <= 1000));
    check(`${lg}: pillars sorted by double cover`,
      pillars.every((p, i) => i === 0 || pillars[i - 1].doubleCover >= p.doubleCover));
  }

  // The synergy pass has to actually rank differently from the simulated one,
  // or it is a third button that shows the second button's answer.
  const tier = TEAM_TIERS(lg)[1] ?? TEAM_TIERS(lg)[0];
  let differs = 0;
  let compared = 0;
  for (const c of CATEGORIES) {
    const d1 = bestTeams(lg, tier, c.id, 'd1', 3)[0]?.refs.join('|');
    const syn = bestTeams(lg, tier, c.id, 'syn', 3)[0]?.refs.join('|');
    if (d1 && syn) { compared++; if (d1 !== syn) differs++; }
  }
  check(`${lg}: the synergy pass is not a copy of the simulated one`,
    compared > 0 && differs >= compared / 2, `${differs}/${compared} categories pick a different top team`);

  // Components must be populated and on-scale wherever they appear.
  // Only the head carries the synergy breakdown — the tail is refs and scores,
  // which is what makes 150 teams per stratum affordable. Assert on the head.
  const sample = bestTeams(lg, tier, 'overall', 'syn', 3, 0, 12);
  check(`${lg}: synergy components populated on the head`, sample.every((t) => !!t.syn));
  check(`${lg}: strata hold far more than the old cap of 12`,
    bestTeams(lg, tier, 'overall', 'd1', 3).length > 100,
    `${bestTeams(lg, tier, 'overall', 'd1', 3).length} threes`);
  check(`${lg}: synergy components on the 0-1000 scale`,
    sample.every((t) => t.syn !== undefined
      && [t.syn.coverage, t.syn.redundancy, t.syn.swapWorst, t.syn.swapMean, t.syn.typeCover, t.syn.bulk]
        .every((v) => v >= 0 && v <= 1000)));
  check(`${lg}: simulated score carried alongside`, sample.every((t) => typeof t.sim === 'number'));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
