#!/usr/bin/env node
/**
 * Builds src/data/species.json + opponents.json from PvPoke's game master.
 *
 *   node scripts/build-data.mjs
 *
 * Inputs (see data-src/README.md for where to get them):
 *   ../data-src/pokemon.json           every species/form/shadow entry
 *   ../data-src/moves.json             move stats, keyed by move id
 *   ../data-src/rankings-1500.json     PvPoke overall rankings per league
 *   ../data-src/rankings-2500.json
 *   ../data-src/rankings-10000.json
 *
 * Why a script and not hand-maintained JSON: the previous species.json was a
 * frozen 139-entry snapshot, which is why regional forms and shadows were
 * missing. Re-run this after a game update and everything refreshes.
 *
 * MOVE TABLE. Move objects are interned rather than embedded. The same
 * BODY_SLAM appeared in every species that learns it - 7730 embedded objects
 * across the roster, but only 567 distinct ones. species.json now ships a
 * `moves` table and each species references keys into it, which cuts the file
 * from 1.48MB to 0.56MB. lib/data.ts rehydrates it once at load, so the
 * in-memory shape - and every consumer - is unchanged.
 *
 * SHADOWS. Shadow variants are not emitted as separate rows. A shadow shares
 * its base form's stats, typing and movepool exactly, so it is represented as
 * `shadowEligible` plus a separate rank set, and the engine derives the
 * variant by applying the multipliers. That keeps the file ~1100 rows instead
 * of ~1600 and makes shadow a toggle rather than a parallel roster.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../data-src');
const OUT = path.resolve(HERE, '../src/data');

const LEAGUES = [
  { id: 'great', cp: 1500, file: 'rankings-1500.json' },
  { id: 'ultra', cp: 2500, file: 'rankings-2500.json' },
  { id: 'master', cp: 10000, file: 'rankings-10000.json' },
];

/**
 * League membership is presence in that league's PvPoke ranking.
 *
 * Two earlier rules were both wrong, in opposite directions. Capping at each
 * league's top 300 hid anything niche, and niche is exactly where breakpoints
 * live. Replacing it with a max-CP floor (great 1100 / ultra 2200 / master
 * 2500) over-corrected: a CP ceiling is a maximum, not a minimum, so the floor
 * threw out species that are ranked and played. Aegislash (Shield) tops out at
 * 1746 and is Ultra rank 478; Umbreon maxes at 2416 and is Master rank 393;
 * Morpeko, Wigglytuff and Marowak all sit just under the Ultra floor. In the
 * other direction the floor admitted every Mega and Primal, none of which is
 * ever an opponent.
 *
 * The ranking already encodes both judgements, so it is the membership test.
 * Anything it gets wrong is handled by data-src/pool-exclusions.json.
 */
/**
 * Master alone keeps a CP floor, and it is a floor on *raw power*.
 *
 * Great and Ultra are capped, so a low ceiling is no handicap - you underlevel
 * into the cap either way, and Aegislash (Shield) at 1746 is a real Ultra
 * threat. Master has no cap, so every point of CP a species cannot reach is a
 * point it simply gives away: a 2766 Registeel is outclassed by definition,
 * not by matchup. PvPoke still rates these (they occupy Master ranks 191+),
 * but they are not opponents anyone plans around, and each one costs a full
 * relevance scan.
 */
const MASTER_MIN_MAX_CP = 3000;
/** How many per league become the default opponent chips. */
const CURATED_PER_LEAGUE = 24;

const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));

// ── CP multipliers ─────────────────────────────────────────────────────────
// Lifted from src/lib/cpm.ts rather than duplicated, so the generator and the
// engine can't disagree about what level 50 means.
const CPM = (() => {
  const src = fs.readFileSync(path.resolve(HERE, '../src/lib/cpm.ts'), 'utf8');
  // Anchored on the assignment, not the first bracket — `number[]` in the type
  // annotation comes first and yields an empty match.
  const m = src.match(/CPM\s*:\s*number\[\]\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error('could not locate the CPM array in src/lib/cpm.ts');
  const nums = m[1].match(/[\d.]+/g).map(Number);
  if (nums.length < 90) throw new Error(`cpm.ts parse produced only ${nums.length} multipliers`);
  return nums;
})();
const MAX_CPM = CPM[CPM.length - 1];

/**
 * CP at max level with perfect IVs — the ceiling a species can ever reach.
 *
 * Shadow status does not enter this: the ×6/5 attack and ×5/6 defense are
 * combat multipliers, applied in the battle engine, not to the CP formula. A
 * Shadow and its base form share a CP at the same level and IVs, so both are
 * measured against the league floor with the same number.
 */
function maxCP(base) {
  const a = (base.atk + 15) * MAX_CPM;
  const d = (base.def + 15) * MAX_CPM;
  const h = (base.hp + 15) * MAX_CPM;
  return Math.max(10, Math.floor((a * Math.sqrt(d) * Math.sqrt(h)) / 10));
}

// ── manual pool exclusions ─────────────────────────────────────────────────
const exclusions = read('pool-exclusions.json');
const excludedFor = (league) =>
  new Set([...(exclusions.all ?? []), ...(exclusions[league] ?? [])]);

// ── sprite slugs ───────────────────────────────────────────────────────────
// PvPoke species ids are almost exactly pokemondb slugs with underscores, so
// the default transform is underscore → hyphen. These are the cases where
// that guess is wrong. Anything not covered here still renders: Sprite.tsx
// falls back to the dex-numbered PokeAPI image, which is what the whole app
// used before, so a miss degrades to the old behaviour rather than a hole.
const SPRITE_EXCEPTIONS = {
  nidoran_female: 'nidoran-f',
  nidoran_male: 'nidoran-m',
  darmanitan_standard: 'darmanitan',
  darmanitan_galarian_standard: 'darmanitan-galarian',
  deoxys_normal: 'deoxys',
  zacian_hero: 'zacian-hero-of-many-battles',
  zamazenta_hero: 'zamazenta-hero-of-many-battles',
  basculin_red_striped: 'basculin',
  mimikyu_busted: 'mimikyu',
  mimikyu_disguised: 'mimikyu',
  eiscue_ice: 'eiscue',
  morpeko_full_belly: 'morpeko',
  toxtricity_amped: 'toxtricity',
  wishiwashi_solo: 'wishiwashi',
  meloetta_aria: 'meloetta',
  keldeo_ordinary: 'keldeo',
  giratina_altered: 'giratina',
  shaymin_land: 'shaymin',
  aegislash_shield: 'aegislash',
  pumpkaboo_average: 'pumpkaboo',
  gourgeist_average: 'gourgeist',
  indeedee_male: 'indeedee',
  oinkologne_male: 'oinkologne',
  urshifu_single_strike: 'urshifu',
  enamorus_incarnate: 'enamorus',
  tornadus_incarnate: 'tornadus',
  thundurus_incarnate: 'thundurus',
  landorus_incarnate: 'landorus',
};

function spriteSlug(speciesId) {
  if (SPRITE_EXCEPTIONS[speciesId]) return SPRITE_EXCEPTIONS[speciesId];
  return speciesId.replace(/_/g, '-');
}

// ── load ───────────────────────────────────────────────────────────────────
const pokemon = read('pokemon.json');
const moves = read('moves.json');

const MOVE_BY_ID = new Map(moves.map((m) => [m.moveId, m]));

/** Rank + recommended moveset per league, for both base and shadow ids. */
const rankByLeague = new Map(); // leagueId -> Map<speciesId, {rank, moveset}>
for (const lg of LEAGUES) {
  const rows = read(lg.file);
  const m = new Map();
  rows.forEach((r, i) => m.set(r.speciesId, { rank: i + 1, moveset: r.moveset ?? null }));
  rankByLeague.set(lg.id, m);
}

// ── move resolution ────────────────────────────────────────────────────────
const missingMoves = new Set();

function fastMove(id, types) {
  const m = MOVE_BY_ID.get(id);
  if (!m) return missingMoves.add(id), null;
  return {
    id,
    name: m.name,
    // Move type drives the icon and colour in the UI; archetype is PvPoke's
    // own label ("Spam/Bait", "Nuke") and is what players already talk in.
    type: m.type,
    archetype: m.archetype ?? null,
    power: m.power,
    // PvPoke stores cooldown in ms; turns is the 500ms-tick count the sim uses.
    turns: m.turns ?? Math.max(1, Math.round((m.cooldown ?? 500) / 500)),
    energyGain: m.energyGain ?? 0,
    stab: types.includes(m.type) ? 1.2 : 1.0,
  };
}

function chargeMove(id, types) {
  const m = MOVE_BY_ID.get(id);
  if (!m) return missingMoves.add(id), null;
  return {
    id,
    name: m.name,
    type: m.type,
    archetype: m.archetype ?? null,
    power: m.power,
    energy: m.energy,
    stab: types.includes(m.type) ? 1.2 : 1.0,
  };
}

// ── move interning ─────────────────────────────────────────────────────────
// Keyed by id *and* STAB: the same move is a different object for a species
// that gets same-type bonus and one that doesn't.
const moveTable = {};
const intern = (m) => {
  if (!m) return null;
  const key = `${m.id}|${m.stab}`;
  if (!moveTable[key]) moveTable[key] = m;
  return key;
};

// ── build ──────────────────────────────────────────────────────────────────
const released = pokemon.filter((p) => p.released);
const shadowIds = new Set(released.filter((p) => (p.tags ?? []).includes('shadow')).map((p) => p.speciesId));
const bases = released.filter((p) => !(p.tags ?? []).includes('shadow'));

const species = [];
const skipped = [];

for (const p of bases) {
  const types = (p.types ?? []).filter((t) => t && t !== 'none');
  const fasts = (p.fastMoves ?? []).map((id) => fastMove(id, types)).filter(Boolean);
  const charges = (p.chargedMoves ?? []).map((id) => chargeMove(id, types)).filter(Boolean);

  // A mon with no usable moveset can't be simulated; drop it rather than ship
  // a row that crashes the battle engine.
  if (!fasts.length || !charges.length) {
    skipped.push(p.speciesId);
    continue;
  }

  const leagueRank = {};
  const shadowRank = {};
  const leagues = [];
  const shadowLeagues = [];
  const cap = maxCP(p.baseStats);
  const isShadowEligible = (p.tags ?? []).includes('shadoweligible') || shadowIds.has(`${p.speciesId}_shadow`);
  let recommended = null;

  for (const lg of LEAGUES) {
    const table = rankByLeague.get(lg.id);
    const hit = table.get(p.speciesId);
    if (hit) {
      leagueRank[lg.id] = hit.rank;
      if (!recommended && hit.moveset) recommended = hit.moveset;
    }
    // Membership is the ranking itself — `hit` is exactly "PvPoke rates this
    // form in this league" — plus Master's raw-power floor. Shadow shares the
    // floor because Shadow does not change CP.
    const dropped = excludedFor(lg.id);
    const meetsFloor = lg.id !== 'master' || cap >= MASTER_MIN_MAX_CP;
    if (hit && meetsFloor && !dropped.has(p.speciesId)) {
      leagues.push(lg.id);
    }
    const sHit = table.get(`${p.speciesId}_shadow`);
    if (sHit) shadowRank[lg.id] = sHit.rank;
    // A Shadow is a distinct opponent — ×6/5 attack and ×5/6 defense move its
    // breakpoints and bulkpoints away from the base form's, so it earns its own
    // membership rather than riding along on `leagues`, and its own exclusion
    // ref. Shadow Palkia is Great-ranked where plain Palkia is not.
    if (sHit && isShadowEligible && meetsFloor && !dropped.has(`${p.speciesId}_shadow`)) {
      shadowLeagues.push(lg.id);
    }
  }

  // Default loadout: PvPoke's recommended moveset where we have one (it's the
  // set the community actually runs), otherwise first fast + two cheapest charges.
  const byId = new Map(charges.map((c) => [c.id, c]));
  let defFast = fasts[0];
  let defCharges = [...charges].sort((a, b) => a.energy - b.energy).slice(0, 2);

  if (recommended) {
    const [rf, ...rc] = recommended;
    defFast = fasts.find((f) => f.id === rf) ?? defFast;
    const picked = rc.map((id) => byId.get(id)).filter(Boolean);
    if (picked.length) defCharges = picked.slice(0, 2);
  }

  // Recommended fast move first, so moveIdx 0 is the sensible default.
  const orderedFasts = [defFast, ...fasts.filter((f) => f.id !== defFast.id)];

  species.push({
    id: p.speciesId,
    dex: p.dex,
    name: p.speciesName,
    sprite: spriteSlug(p.speciesId),
    types,
    atk: p.baseStats.atk,
    def: p.baseStats.def,
    hp: p.baseStats.hp,
    maxCP: cap,
    tags: (p.tags ?? []).filter((t) => ['legendary', 'mythical', 'mega', 'regional', 'ultrabeast', 'starter'].includes(t)),
    shadowEligible: isShadowEligible,
    fastMoves: orderedFasts.map(intern),
    chargeMoves: charges.map(intern),
    // Kept for the existing engine/UI shape: the recommended pair.
    chargeMove: intern(defCharges[0]),
    chargeMove2: intern(defCharges[1] ?? null),
    leagues,
    shadowLeagues,
    leagueRank,
    shadowLeagueRank: shadowRank,
  });
}

species.sort((a, b) => a.dex - b.dex || a.id.localeCompare(b.id));

// Curated default opponents per league: the top of each ranking that's in our roster.
const byId = new Map(species.map((s) => [s.id, s]));
const opponents = {};
for (const lg of LEAGUES) {
  const table = rankByLeague.get(lg.id);
  opponents[lg.id] = [...table.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, CURATED_PER_LEAGUE)
    .map(([id]) => id);
}

fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify({ moves: moveTable, species }));
fs.writeFileSync(path.join(OUT, 'opponents.json'), JSON.stringify(opponents, null, 2));

// ── report ─────────────────────────────────────────────────────────────────
const shadowCount = species.filter((s) => s.shadowEligible).length;
const formCount = species.filter((s) => s.id.includes('_')).length;
const embedded = species.reduce((n, s) => n + s.fastMoves.length + s.chargeMoves.length, 0);
console.log(`species.json    ${species.length} entries (${formCount} alternate forms, ${shadowCount} shadow-eligible)`);
console.log(`  moves         ${Object.keys(moveTable).length} interned, ${embedded} references`);
for (const lg of LEAGUES) {
  const n = species.filter((s) => s.leagues.includes(lg.id)).length;
  const sn = species.filter((s) => s.shadowLeagues.includes(lg.id)).length;
  console.log(`  ${lg.id.padEnd(7)} ${String(n + sn).padStart(4)} opponents (${n} base + ${sn} shadow), ${opponents[lg.id].length} curated`);
}
{
  // Exclusion ids are refs: `palkia` drops the base form, `palkia_shadow` the
  // Shadow. Resolve through the suffix before checking an id is real, or every
  // Shadow ref reads as a typo.
  const ids = new Set(species.map((s) => s.id));
  const known = (ref) =>
    ids.has(ref) || (ref.endsWith('_shadow') && ids.has(ref.slice(0, -'_shadow'.length)));
  const listed = [...new Set([...(exclusions.all ?? []), ...LEAGUES.flatMap((l) => exclusions[l.id] ?? [])])];
  const dropped = listed.filter(known);
  const unknown = listed.filter((ref) => !known(ref));
  if (dropped.length) console.log(`manual exclusions: ${dropped.length} applied`);
  if (unknown.length) console.log(`WARNING exclusions matching no species: ${unknown.join(', ')}`);
}
if (skipped.length) console.log(`skipped ${skipped.length} with no usable moveset: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ' …' : ''}`);
if (missingMoves.size) console.log(`WARNING unresolved move ids: ${[...missingMoves].join(', ')}`);
