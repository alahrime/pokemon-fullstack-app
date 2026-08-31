import { SPECIES_BY_ID, conflictsOnTeam, movesFor, parseRef, speciesOf } from '../lib/data';
import { drawablePool } from './pool';
import type { Build, Format } from './types';

/**
 * A seeded generator, so a draw can be recomputed from the seed alone.
 *
 * Math.random is unusable here even though the test setup seeds it: that seeding
 * is scaffolding for the suite, not a property of the running app, and a draw
 * that cannot be reproduced outside a test is a draw nobody can audit. The
 * requirement is not randomness, it is a reproducible arbitrary order.
 *
 * xmur3 to turn the string key into a 32-bit state, then mulberry32 — the same
 * generator the test setup uses, chosen for the same reasons: three lines,
 * uniform enough, identical on every platform.
 */
function seedFrom(key: string): number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function rng(key: string): () => number {
  let a = seedFrom(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal one player's team.
 *
 * The key mixes the seed with the player id, so both sides of a match draw from
 * one agreed seed and still get different teams — and either draw can be
 * checked afterwards by anyone holding the seed.
 *
 * `playerPicks` slots are left undealt: the player fills them. So a six with two
 * picks returns four builds, and the UI is responsible for the rest.
 */
export function rollTeam(format: Format, seed: string, playerId: string): Build[] {
  const next = rng(`${seed}|${playerId}`);
  const pool = drawablePool(format);

  // Fisher-Yates against the seeded generator, so the order is a function of the
  // key and nothing else.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const want = Math.max(0, format.composition.size - (format.selection.playerPicks ?? 0));
  const picked: string[] = [];
  for (const ref of pool) {
    if (picked.length === want) break;
    if (format.composition.uniqueSpecies && picked.some((r) => conflictsOnTeam(r, ref))) continue;
    if (format.composition.uniqueFamilies) {
      const f = speciesOf(ref)?.family;
      if (f && picked.some((r) => speciesOf(r)?.family === f)) continue;
    }
    picked.push(ref);
  }

  return picked.map((ref) => {
    const s = SPECIES_BY_ID.get(parseRef(ref).id)!;
    if (!format.selection.rollMoves) {
      const m = movesFor(s, format.base);
      return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
    }
    const fast = s.fastMoves[Math.floor(next() * s.fastMoves.length)];
    const charges = [...s.chargeMoves];
    for (let i = charges.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [charges[i], charges[j]] = [charges[j], charges[i]];
    }
    return { ref, fast: fast.id, charges: charges.slice(0, Math.min(2, charges.length)).map((c) => c.id) };
  });
}
