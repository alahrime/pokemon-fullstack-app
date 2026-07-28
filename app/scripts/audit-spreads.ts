/**
 * Cross-checks our computed rank-1 spread against PvPoke's own optimal IVs.
 *
 *   npm run audit:spreads
 *
 * PvPoke's game master carries `defaultIVs` per CP cap in the form
 * [level, atkIV, defIV, hpIV] — its own answer to "the best roll under this
 * cap". That's an independent implementation of the same optimisation, so it
 * is the right thing to check our level search and stat-product maths against.
 *
 * The meaningful test is not "do the IVs match" — ties are common and the
 * tie-break is arbitrary — but "is our stat product at least as high as
 * theirs". If ours is lower we have a genuine bug: we failed to find a spread
 * that demonstrably exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SPECIES, SPECIES_BY_ID } from '../src/lib/data';
import { bestAt, getTable, ivKey } from '../src/lib/engine';
import { CPM } from '../src/lib/cpm';
import { LEAGUE_BY_ID } from '../src/lib/data';
import type { LeagueId } from '../src/lib/types';

const SRC = path.resolve(process.cwd(), '../data-src');
const pokemon = JSON.parse(fs.readFileSync(path.join(SRC, 'pokemon.json'), 'utf8')) as {
  speciesId: string;
  released?: boolean;
  tags?: string[];
  defaultIVs?: Record<string, number[]>;
}[];

const DEFAULTS = new Map<string, Record<string, number[]>>();
for (const p of pokemon) {
  if (p.defaultIVs && !(p.tags ?? []).includes('shadow')) DEFAULTS.set(p.speciesId, p.defaultIVs);
}

// ── First, validate the CP formula itself against a known-exact reference ──
//
// "Ours is better than PvPoke's spread 70% of the time" has two explanations:
// their defaults aren't pure stat-product maxima, or our CP runs low and we're
// reaching levels that aren't legal. Those are very different, so the CP maths
// has to be pinned down before any of the above means anything.
//
// pokemon.json carries `level25CP` — CP at level 25 with 0/0/0 IVs — for every
// species. That is an exact scalar with no tie-breaking or optimisation in it.
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const L25 = 48; // CPM index for level 25: (25 - 1) / 0.5
const cpAtL25 = (atkB: number, defB: number, hpB: number) => {
  const cpm = CPM[L25];
  return Math.max(10, Math.floor(((atkB * cpm) * Math.sqrt(defB * cpm) * Math.sqrt(hpB * cpm)) / 10));
};

{
  let checked = 0;
  const mismatched: string[] = [];
  const inherited: string[] = [];

  // Some forms carry their *base* form's level25CP verbatim — every mega does,
  // and so does Hisuian Electrode despite different base stats. Those are stale
  // reference values in the game master, not arithmetic errors on our side, so
  // they're reported separately rather than counted as failures.
  const byDex = new Map<number, typeof pokemon>();
  for (const p of pokemon) {
    const s = SPECIES_BY_ID.get(p.speciesId);
    if (!s) continue;
    const list = byDex.get(s.dex) ?? [];
    list.push(p);
    byDex.set(s.dex, list);
  }

  for (const p of pokemon) {
    const s = SPECIES_BY_ID.get(p.speciesId);
    const expected = (p as { level25CP?: number }).level25CP;
    if (!s || typeof expected !== 'number') continue;
    checked++;
    const cp = cpAtL25(s.atk, s.def, s.hp);
    if (cp === expected) continue;

    // Blastoise Mega's level25CP is 1000, a placeholder: its base stats
    // (264/237/188) strictly dominate Blastoise's (171/207/188), whose value is
    // 1504, so a *lower* CP is arithmetically impossible. Excluded with cause.
    if (p.speciesId === 'blastoise_mega') {
      inherited.push(`${p.speciesId} (${expected} is a placeholder, impossible for its stats)`);
      continue;
    }

    const sibling = (byDex.get(s.dex) ?? []).some((q) => {
      const qs = SPECIES_BY_ID.get(q.speciesId);
      return qs && qs.id !== s.id && cpAtL25(qs.atk, qs.def, qs.hp) === expected;
    });
    if (sibling) inherited.push(`${p.speciesId} (${expected} is a sibling form's)`);
    else mismatched.push(`${p.speciesId} ours ${cp} vs ${expected}`);
  }

  console.log('\n── CP formula vs level25CP reference ──────────────────');
  console.log(`checked ${checked} species`);
  console.log(`exact ${checked - mismatched.length - inherited.length}`);
  console.log(`stale reference inherited from a sibling form ${inherited.length}  (not our error)`);
  if (inherited.length) console.log(`  ${inherited.slice(0, 8).join(' | ')}`);
  console.log(`UNEXPLAINED MISMATCHES ${mismatched.length}   <- any of these is a bug`);
  if (mismatched.length) {
    failures += mismatched.length;
    console.log(`  ${mismatched.slice(0, 8).join(' | ')}`);
  }
}

const CASES: { league: LeagueId; key: string }[] = [
  { league: 'great', key: 'cp1500' },
  { league: 'ultra', key: 'cp2500' },
];

for (const { league, key } of CASES) {
  const lg = LEAGUE_BY_ID.get(league)!;
  let compared = 0;
  let exact = 0;
  let tie = 0; // different IVs, our stat product >= theirs
  let better = 0; // ours strictly better (>0.01%)
  const worse: { id: string; ours: string; theirs: string; deltaPct: number }[] = [];
  const levelOff: string[] = [];

  for (const s of SPECIES) {
    const d = DEFAULTS.get(s.id)?.[key];
    if (!d || d.length < 4) continue;
    const [pvLvl, a, def, hp] = d;
    if ([a, def, hp].some((v) => v < 0 || v > 15)) continue;
    // [1, 0, 0, 0] is PvPoke's sentinel for "not viable at this cap" - it marks
    // species that blow past the limit at any level (Darkrai, Volcarona,
    // Zygarde Complete in Great). Not a real spread, so not comparable.
    if (pvLvl === 1 && a === 0 && def === 0 && hp === 0) continue;

    const table = getTable(s.id, league);
    const ours = table.best;
    const theirs = table.map.get(ivKey({ a, d: def, s: hp }))!;
    if (!theirs) continue;
    compared++;

    // Does our level search agree with theirs for *their* spread? This isolates
    // the level search from the choice of IVs.
    const atTheirs = bestAt(s, { a, d: def, s: hp }, lg);
    if (Math.abs(atTheirs.lvl - pvLvl) > 0.01) levelOff.push(`${s.id} ${atTheirs.lvl} vs ${pvLvl}`);

    if (ours.a === a && ours.d === def && ours.s === hp) {
      exact++;
    } else {
      const delta = (ours.sp - theirs.sp) / theirs.sp;
      if (delta < -1e-9) {
        failures++;
        worse.push({
          id: s.id,
          ours: `${ours.a}/${ours.d}/${ours.s} L${ours.lvl} sp=${ours.sp.toFixed(0)}`,
          theirs: `${a}/${def}/${hp} L${pvLvl} sp=${theirs.sp.toFixed(0)}`,
          deltaPct: delta * 100,
        });
      } else if (delta > 1e-4) better++;
      else tie++;
    }
  }

  const pct = (n: number) => `${((n / compared) * 100).toFixed(1)}%`;
  console.log(`\n── ${league} (${key}) ─────────────────────────────────`);
  console.log(`compared      ${compared}`);
  console.log(`exact IV match ${exact} (${pct(exact)})`);
  console.log(`tied on stat product, different IVs ${tie} (${pct(tie)})`);
  console.log(`ours strictly better ${better} (${pct(better)})`);
  console.log(`OURS WORSE    ${worse.length} (${pct(worse.length)})   <- any of these is a bug`);
  console.log(`level search disagreements on their own spread: ${levelOff.length}`);
  if (levelOff.length) console.log(`  e.g. ${levelOff.slice(0, 6).join(' | ')}`);
  if (worse.length) {
    console.log('  worst:');
    for (const w of worse.sort((x, y) => x.deltaPct - y.deltaPct).slice(0, 10)) {
      console.log(`   ${w.id.padEnd(24)} ours ${w.ours}  theirs ${w.theirs}  (${w.deltaPct.toFixed(3)}%)`);
    }
  }
}

// Sanity: rank 1 should not be systematically a corner spread. If every
// species reported 0/15/15 that would itself indicate the search is degenerate.
// Concrete side-by-sides, so "ours is better" is inspectable rather than asserted.
console.log('\n── sample comparisons (great) ─────────────────────────');
for (const id of ['azumarill', 'sableye', 'registeel', 'medicham', 'skarmory', 'bastiodon']) {
  const s = SPECIES_BY_ID.get(id);
  const d = DEFAULTS.get(id)?.cp1500;
  if (!s || !d) continue;
  const t = getTable(id, 'great');
  const ours = t.best;
  const theirs = t.map.get(ivKey({ a: d[1], d: d[2], s: d[3] }))!;
  const delta = ((ours.sp - theirs.sp) / theirs.sp) * 100;
  console.log(
    `  ${id.padEnd(12)} ours ${`${ours.a}/${ours.d}/${ours.s}`.padEnd(9)} L${String(ours.lvl).padEnd(4)} CP${String(ours.cp).padEnd(5)} sp=${(ours.sp / 1000).toFixed(2)}k` +
      `   pvpoke ${`${d[1]}/${d[2]}/${d[3]}`.padEnd(9)} L${String(d[0]).padEnd(4)} CP${String(theirs.cp).padEnd(5)} sp=${(theirs.sp / 1000).toFixed(2)}k   (+${delta.toFixed(2)}%)`,
  );
}

console.log('\n── rank-1 spread distribution (great) ─────────────────');
{
  const counts = new Map<string, number>();
  for (const s of SPECIES) {
    const b = getTable(s.id, 'great').best;
    const k = `${b.a}/${b.d}/${b.s}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`${counts.size} distinct rank-1 spreads across ${SPECIES.length} species`);
  for (const [k, n] of top) console.log(`  ${k.padEnd(10)} ${n}`);
  const zeroAtk = [...SPECIES].filter((s) => getTable(s.id, 'great').best.a === 0).length;
  console.log(`rank-1 has 0 attack IV for ${zeroAtk} species (${((zeroAtk / SPECIES.length) * 100).toFixed(1)}%)`);
}

// ── Why "ours is better" is expected, not a bug ────────────────────────────
//
// PvPoke's defaultIVs are floored: across every cp1500 default, not one has an
// attack IV below 1, and the single most common minimum IV is exactly 4 — the
// floor for a weather-boosted wild catch. They are realistic *catchable*
// spreads. Our table ranks all 4096 including 0-attack rolls, which is the
// right domain for a tool that rates a Pokémon you already own: under a CP cap
// a low attack IV buys extra level, and therefore more total stats.
console.log('\n── why ours scores higher ─────────────────────────────');
{
  const mins = new Map<number, number>();
  let zeroAtk = 0;
  let total = 0;
  for (const [, d] of DEFAULTS) {
    const v = d.cp1500;
    if (!v || v.length < 4) continue;
    if (v[0] === 1 && v[1] === 0 && v[2] === 0 && v[3] === 0) continue;
    total++;
    if (v[1] === 0) zeroAtk++;
    const m = Math.min(v[1], v[2], v[3]);
    mins.set(m, (mins.get(m) ?? 0) + 1);
  }
  const floor4 = mins.get(4) ?? 0;
  console.log(`pvpoke cp1500 defaults with attack IV 0: ${zeroAtk} / ${total}`);
  console.log(`pvpoke cp1500 defaults whose minimum IV is exactly 4: ${floor4} (most common)`);
  console.log('→ their defaults are floored at catchable IVs; ours ranks all 4096.');
  console.log(`→ our rank-1 uses a 0 attack IV for ${
    SPECIES.filter((s) => getTable(s.id, 'great').best.a === 0).length
  } species, which their floor forbids by construction.`);
  check('pvpoke defaults are IV-floored (explains the delta)', zeroAtk === 0, `${zeroAtk} with 0 attack`);
}

console.log(`\n${failures === 0 ? 'NO SPREADS WORSE THAN PVPOKE' : `${failures} SPREAD(S) WORSE THAN PVPOKE`}\n`);
process.exit(failures === 0 ? 0 : 1);
