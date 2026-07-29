import { CPM, LVL } from './cpm';
import { POKEMON_TYPES } from './pokemonTypes';
import type { Species } from './types';

/**
 * Search query language for the roster.
 *
 *   water                 type, tag, region, dex number or name — resolved in
 *                         that order, so "water" is a type and "wat" a name
 *   184                   Pokedex number
 *   gen1 / kanto          generation, by either name
 *   legendary / alolan    tag
 *   xl                    needs XL candy: best roll sits above level 40
 *   +politoed             every form in that evolution family
 *   @counter              a move by name
 *   @fighting             a move by type
 *   @1fighting            fast moves only
 *   @2mud                 charged moves only
 *   @spam                 a move archetype ("Spam/Bait", "Nuke", …)
 *   !water                negation
 *   water&@fighting       and
 *   water,fighting        or
 *
 * Precedence is or-of-ands, matching how the separators read: commas split
 * alternatives, ampersands narrow within one. Every term is the same shape —
 * a predicate over a species — so they compose without special cases, and
 * negation is a wrapper rather than a parser branch.
 *
 * Terms are compiled to closures once per query, not re-parsed per species.
 * At ~1100 species and a keystroke debounce that is far below anything worth
 * indexing for, and it keeps the whole language in one readable pass.
 */

export type Term = (s: Species) => boolean;

/** Region names alongside genN, since people reach for either. */
const GENERATIONS: Record<string, [number, number]> = {
  gen1: [1, 151], kanto: [1, 151],
  gen2: [152, 251], johto: [152, 251],
  gen3: [252, 386], hoenn: [252, 386],
  gen4: [387, 493], sinnoh: [387, 493],
  gen5: [494, 649], unova: [494, 649],
  gen6: [650, 721], kalos: [650, 721],
  gen7: [722, 809], alola: [722, 809],
  gen8: [810, 905], galar: [810, 905],
  gen9: [906, 1025], paldea: [906, 1025],
};

const TYPES = new Set<string>(POKEMON_TYPES);

/**
 * Needs XL candy to reach its ceiling in some league.
 *
 * Level 40 is the free cap; every power-up past it costs XL. So a species is
 * an XL build wherever it cannot reach the league cap by level 40 — it has to
 * keep levelling to use the CP it is allowed. Computed from the level-40
 * multiplier rather than stored, since it follows entirely from base stats.
 */
const CPM_40 = CPM[78];
if (LVL(78) !== 40) throw new Error(`CPM index 78 is level ${LVL(78)}, expected 40`);
const cpAt40 = (s: Species) => {
  const a = (s.atk + 15) * CPM_40;
  const d = (s.def + 15) * CPM_40;
  const h = (s.hp + 15) * CPM_40;
  return Math.max(10, Math.floor((a * Math.sqrt(d) * Math.sqrt(h)) / 10));
};
function needsXl(s: Species): boolean {
  const cp40 = cpAt40(s);
  // Great and Ultra only: Master is uncapped, where everything wants XL.
  return (cp40 < 1500 && s.maxCP >= 1500) || (cp40 < 2500 && s.maxCP >= 2500);
}

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle);

/** `@…` — anything about the movepool. */
function moveTerm(raw: string): Term {
  let body = raw;
  let slot: 'fast' | 'charge' | 'any' = 'any';
  if (body.startsWith('1')) {
    slot = 'fast';
    body = body.slice(1);
  } else if (body.startsWith('2')) {
    slot = 'charge';
    body = body.slice(1);
  }
  if (!body) return () => false;

  return (s) => {
    const pool =
      slot === 'fast' ? s.fastMoves : slot === 'charge' ? s.chargeMoves : [...s.fastMoves, ...s.chargeMoves];
    return pool.some(
      (m) =>
        m.type?.toLowerCase() === body ||
        has(m.name, body) ||
        has(m.archetype ?? '', body),
    );
  };
}

/** A bare word, resolved most-specific first so exact concepts beat name text. */
function bareTerm(raw: string, familyOf: (id: string) => string | null): Term {
  if (/^\d+$/.test(raw)) {
    const dex = Number(raw);
    return (s) => s.dex === dex;
  }
  if (TYPES.has(raw)) return (s) => s.types.includes(raw);
  const gen = GENERATIONS[raw];
  if (gen) return (s) => s.dex >= gen[0] && s.dex <= gen[1];
  if (raw === 'xl') return needsXl;
  // `shadow` reads as a tag but the data spells it shadoweligible.
  if (raw === 'shadow') return (s) => s.shadowEligible;
  if (raw === 'family') return (s) => s.family !== null;
  return (s) =>
    has(s.name, raw) || has(s.id, raw) || s.tags.some((t) => t === raw) || (familyOf(s.id) === raw ? true : false);
}

function compileTerm(raw: string, familyOf: (id: string) => string | null, familyIdFor: (name: string) => string | null): Term {
  let body = raw.trim().toLowerCase();
  if (!body) return () => true;

  let negate = false;
  while (body.startsWith('!')) {
    negate = !negate;
    body = body.slice(1).trim();
  }
  if (!body) return () => true;

  let term: Term;
  if (body.startsWith('@')) {
    term = moveTerm(body.slice(1));
  } else if (body.startsWith('+')) {
    // Whole evolution line, named by any member of it.
    const want = familyIdFor(body.slice(1));
    term = want ? (s) => s.family === want : () => false;
  } else {
    term = bareTerm(body, familyOf);
  }
  return negate ? (s) => !term(s) : term;
}

/**
 * Compile a query into a single predicate.
 *
 * Returns null for an empty query so the caller can keep its own default
 * ordering rather than being handed a match-everything predicate.
 */
export function compileQuery(query: string, roster: readonly Species[]): Term | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // `+name` needs name -> family id; built lazily, once per compile.
  let byName: Map<string, string> | null = null;
  const familyIdFor = (name: string): string | null => {
    if (!byName) {
      byName = new Map();
      for (const s of roster) {
        if (!s.family) continue;
        if (!byName.has(s.id)) byName.set(s.id, s.family);
        const plain = s.name.toLowerCase();
        if (!byName.has(plain)) byName.set(plain, s.family);
      }
    }
    return byName.get(name) ?? null;
  };
  const familyOf = () => null;

  const alternatives = q
    .split(',')
    .map((clause) =>
      clause
        .split('&')
        .map((t) => compileTerm(t, familyOf, familyIdFor))
        .filter(Boolean),
    )
    .filter((and) => and.length > 0);

  if (!alternatives.length) return null;
  return (s) => alternatives.some((and) => and.every((t) => t(s)));
}

/** Whether a query uses any operator, i.e. is more than a plain name search. */
export function isStructured(query: string): boolean {
  return /[@+!&,]/.test(query) || GENERATIONS[query.trim().toLowerCase()] !== undefined;
}
