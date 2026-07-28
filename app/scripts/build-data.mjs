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

/** Rank cutoff for counting as "present" in a league (drives opponent scans). */
const LEAGUE_MEMBER_CUTOFF = 300;
/** How many per league become the default opponent chips. */
const CURATED_PER_LEAGUE = 24;

const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));

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
    power: m.power,
    energy: m.energy,
    stab: types.includes(m.type) ? 1.2 : 1.0,
  };
}

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
  let recommended = null;

  for (const lg of LEAGUES) {
    const table = rankByLeague.get(lg.id);
    const hit = table.get(p.speciesId);
    if (hit) {
      leagueRank[lg.id] = hit.rank;
      if (hit.rank <= LEAGUE_MEMBER_CUTOFF) leagues.push(lg.id);
      if (!recommended && hit.moveset) recommended = hit.moveset;
    }
    const sHit = table.get(`${p.speciesId}_shadow`);
    if (sHit) shadowRank[lg.id] = sHit.rank;
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
    tags: (p.tags ?? []).filter((t) => ['legendary', 'mythical', 'mega', 'regional', 'ultrabeast', 'starter'].includes(t)),
    shadowEligible: (p.tags ?? []).includes('shadoweligible') || shadowIds.has(`${p.speciesId}_shadow`),
    fastMoves: orderedFasts,
    chargeMoves: charges,
    // Kept for the existing engine/UI shape: the recommended pair.
    chargeMove: defCharges[0],
    chargeMove2: defCharges[1] ?? null,
    leagues,
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

fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify(species));
fs.writeFileSync(path.join(OUT, 'opponents.json'), JSON.stringify(opponents, null, 2));

// ── report ─────────────────────────────────────────────────────────────────
const shadowCount = species.filter((s) => s.shadowEligible).length;
const formCount = species.filter((s) => s.id.includes('_')).length;
console.log(`species.json    ${species.length} entries (${formCount} alternate forms, ${shadowCount} shadow-eligible)`);
for (const lg of LEAGUES) {
  console.log(`  ${lg.id.padEnd(7)} ${species.filter((s) => s.leagues.includes(lg.id)).length} in-league, ${opponents[lg.id].length} curated`);
}
if (skipped.length) console.log(`skipped ${skipped.length} with no usable moveset: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ' …' : ''}`);
if (missingMoves.size) console.log(`WARNING unresolved move ids: ${[...missingMoves].join(', ')}`);
