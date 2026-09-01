import { parseRef } from '../lib/data';
import { POKEMON_TYPES } from '../lib/pokemonTypes';
import type { Format, PoolClause } from './types';

/** Which forms of a species an add applies to. */
export type SpeciesScope = 'both' | 'normal' | 'shadow';

const TYPES = new Set<string>(POKEMON_TYPES);

/**
 * How a UI gesture becomes a clause.
 *
 * Every control in the builder routes through here rather than composing
 * selector strings of its own. Three components manipulate the same pool, and
 * if each invented its own spelling of "add a type" they would disagree about
 * what a format means — the same class of drift that a shared move vocabulary
 * and a shared drawable pool were introduced to remove elsewhere in this
 * module.
 *
 * Everything is pure: a new Format out, the argument untouched, so React state
 * updates stay predictable.
 */

/** The selector a scope produces for one species id. */
function selectorFor(id: string, scope: SpeciesScope): string {
  if (scope === 'normal') return `${id}&!shadow`;
  if (scope === 'shadow') return `${id}&shadow`;
  return id;
}

function withPool(format: Format, pool: PoolClause[]): Format {
  return { ...format, pool };
}

/**
 * Types currently switched on.
 *
 * A chip is "on" when a clause allows exactly that bare type name. A clause the
 * user typed by hand in the advanced view — `water&!shadow`, say — deliberately
 * does not light the chip, because the chip cannot represent it and pretending
 * otherwise would lose their rule the moment they clicked it.
 */
export function typesOn(format: Format): Set<string> {
  const on = new Set<string>();
  for (const c of format.pool) {
    const sel = c.select.trim().toLowerCase();
    if (c.effect === 'allow' && TYPES.has(sel)) on.add(sel);
  }
  return on;
}

/** Switch a type on or off. */
export function toggleType(format: Format, type: string): Format {
  const t = type.trim().toLowerCase();
  if (typesOn(format).has(t)) {
    return withPool(
      format,
      format.pool.filter((c) => !(c.effect === 'allow' && c.select.trim().toLowerCase() === t)),
    );
  }
  return withPool(format, [...format.pool, { effect: 'allow', select: t }]);
}

/** Add one species, in whichever forms the scope names. */
export function addSpecies(format: Format, ref: string, scope: SpeciesScope): Format {
  const { id } = parseRef(ref);
  const select = selectorFor(id, scope);
  if (format.pool.some((c) => c.effect === 'allow' && c.select === select)) return format;
  return withPool(format, [...format.pool, { effect: 'allow', select }]);
}

/** The selector naming exactly one ref, Shadow-aware. */
function selectorForRef(ref: string): string {
  const { id, shadow } = parseRef(ref);
  return selectorFor(id, shadow ? 'shadow' : 'normal');
}

/**
 * Take one ref out of the set.
 *
 * Undo before deny: if a clause allowed exactly this ref, drop that clause
 * instead of appending a denial. Appending would also be correct — the last
 * matching clause wins either way — but toggling one species on and off would
 * then grow the pool list without bound, and every one of those clauses would
 * show up in the advanced view as noise the author never wrote.
 *
 * The undo only fires on an exact scope match. A clause allowing the whole
 * species (added with scope 'both') covers the other variant too, so dropping
 * it would remove a ref nobody asked to remove — an X on Registeel must not
 * take Shadow Registeel with it. Removing one variant out of such a clause
 * therefore falls through to a scoped deny, which last-match-wins turns into
 * "the species, except this one form." Toggling both variants off one at a
 * time can leave an inert `allow` behind alongside two `deny`s rather than
 * collapsing to nothing; that residue is visible to the author as
 * `lintFormat`'s dead-clause warning, which is the right place to surface it.
 */
export function removeRef(format: Format, ref: string): Format {
  const select = selectorForRef(ref);

  const exact = format.pool.findIndex((c) => c.effect === 'allow' && c.select === select);
  if (exact !== -1) {
    return withPool(format, format.pool.filter((_, i) => i !== exact));
  }

  if (format.pool.some((c) => c.effect === 'deny' && c.select === select)) return format;
  return withPool(format, [...format.pool, { effect: 'deny', select }]);
}
