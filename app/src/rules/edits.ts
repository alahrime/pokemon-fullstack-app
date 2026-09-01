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

/**
 * Take one ref out of the set.
 *
 * Undo before deny: if a clause allowed exactly this ref, drop that clause
 * instead of appending a denial. Appending would also be correct — the last
 * matching clause wins either way — but toggling one species on and off would
 * then grow the pool list without bound, and every one of those clauses would
 * show up in the advanced view as noise the author never wrote.
 *
 * A clause added with scope 'both' allows the bare species id, which covers
 * both forms at once — it is one add, not two. Undoing it via the Normal-form
 * ref (the id's own ref) removes the whole thing, forms and all: that clause
 * *is* the individual add the Normal control made. Undoing it via the Shadow
 * ref must not do the same — the Normal form has to stay legal — so that case
 * falls through to a deny instead, which last-match-wins turns into "allowed,
 * except the Shadow."
 */
export function removeRef(format: Format, ref: string): Format {
  const { id, shadow } = parseRef(ref);
  const select = selectorFor(id, shadow ? 'shadow' : 'normal');

  const exact = format.pool.findIndex((c) => c.effect === 'allow' && c.select === select);
  if (exact !== -1) {
    return withPool(format, format.pool.filter((_, i) => i !== exact));
  }

  if (!shadow) {
    const wholesale = format.pool.findIndex((c) => c.effect === 'allow' && c.select === id);
    if (wholesale !== -1) {
      return withPool(format, format.pool.filter((_, i) => i !== wholesale));
    }
  }

  if (format.pool.some((c) => c.effect === 'deny' && c.select === select)) return format;
  return withPool(format, [...format.pool, { effect: 'deny', select }]);
}
