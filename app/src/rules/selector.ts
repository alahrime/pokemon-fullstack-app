import { termCompiler } from '../lib/query';
import { SPECIES, parseRef, speciesOf } from '../lib/data';
import type { Species } from '../lib/types';

/** A predicate over a ref, which is what a rule actually constrains. */
export type RefTerm = (ref: string) => boolean;

/**
 * Tokens whose meaning differs between search and rules.
 *
 * `shadow` is the only one. In search it maps to `shadowEligible` and asks
 * "does a Shadow of this exist"; in a rule it must ask "is this ref the Shadow
 * one", because the whole point of resolving to refs is that a ban can be more
 * specific than a species. Everything else — types, tags, generations, families,
 * movepools — is a property of the species and needs no rebinding.
 */
function reboundTerm(body: string): RefTerm | null {
  if (body === 'shadow') return (ref) => parseRef(ref).shadow;
  return null;
}

/**
 * Compile one `&`-separated term, ref-aware.
 *
 * Negation is stripped here so a rebound token can be negated too, and the
 * original raw text (leading `!` included) is handed to the shared compiler for
 * everything else, so `!water` keeps being negated by the code that already
 * knows how.
 */
function refTerm(raw: string, term: (r: string) => (s: Species) => boolean): RefTerm {
  let body = raw.trim().toLowerCase();
  let negate = false;
  while (body.startsWith('!')) {
    negate = !negate;
    body = body.slice(1).trim();
  }

  const rebound = reboundTerm(body);
  if (rebound) return negate ? (ref) => !rebound(ref) : rebound;

  const t = term(raw);
  return (ref) => {
    const s = speciesOf(ref);
    return !!s && t(s);
  };
}

/**
 * Compile a rules selector into a predicate over refs.
 *
 * The `,`-then-`&` split mirrors `compileQuery` exactly — or-of-ands, matching
 * how the separators read — and the terms come from the same compiler, so the
 * language a user already knows from the search box is the language a rule
 * speaks. Returns null for an empty selector so a caller can skip the clause
 * rather than being handed a predicate that matches everything.
 */
export function compileSelector(
  select: string,
  roster: readonly Species[] = SPECIES,
): RefTerm | null {
  const q = select.trim().toLowerCase();
  if (!q) return null;

  const term = termCompiler(roster);
  const alternatives = q
    .split(',')
    .map((clause) => clause.split('&').map((raw) => refTerm(raw, term)))
    .filter((and) => and.length > 0);

  if (!alternatives.length) return null;
  return (ref) => alternatives.some((and) => and.every((t) => t(ref)));
}
