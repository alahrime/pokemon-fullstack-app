import { moveMatcher } from '../lib/query';
import { CHARGE_MOVES, FAST_MOVES } from '../lib/data';
import { compileSelector } from './selector';
import type { Build } from './types';

/** A predicate over a build — a ref plus the loadout it is running. */
export type BuildTerm = (b: Build) => boolean;

// Builds store moves by id (`b.fast`, `b.charges`), but `moveMatcher` from
// `lib/query` — the shared vocabulary — matches against move objects, so it
// can see `type`/`name`/`archetype`/slot. These look the id back up in the
// same deduped catalogues search itself is built from.
const FAST_BY_ID = new Map(FAST_MOVES.map((m) => [m.id, m] as const));
const CHARGE_BY_ID = new Map(CHARGE_MOVES.map((m) => [m.id, m] as const));

/**
 * Compile a quota selector, which sees the loadout as well as the ref.
 *
 * One token is rebound relative to both the search language and the pool
 * selector: `@x` in search asks whether a species *can learn* x, and in a quota
 * it asks whether this build is *running* x. That difference is what lets a
 * format say "at most one Volt Switch" without the pool having to ban
 * Forretress outright — which is the placement the spec argues for, since the
 * pool answers whether you may bring Forretress and composition answers whether
 * you may bring that one.
 *
 * The vocabulary itself — name, id, type, archetype, and the `1`/`2` slot
 * prefix — is shared with search via `moveMatcher`, not reimplemented here;
 * only the "running it" vs. "can learn it" application differs.
 *
 * Every other token falls through to the ref selector unchanged.
 */
export function compileBuildSelector(select: string): BuildTerm | null {
  const q = select.trim().toLowerCase();
  if (!q) return null;

  const alternatives = q.split(',').map((clause) =>
    clause.split('&').map((raw): BuildTerm => {
      let body = raw.trim();
      let negate = false;
      while (body.startsWith('!')) {
        negate = !negate;
        body = body.slice(1).trim();
      }

      if (body.startsWith('@')) {
        const matches = moveMatcher(body.slice(1));
        const t: BuildTerm = (b) => {
          const fast = FAST_BY_ID.get(b.fast);
          if (fast && matches(fast)) return true;
          return b.charges.some((c) => {
            const charge = CHARGE_BY_ID.get(c);
            return charge !== undefined && matches(charge);
          });
        };
        return negate ? (b) => !t(b) : t;
      }

      const ref = compileSelector(raw);
      return ref ? (b) => ref(b.ref) : () => true;
    }),
  );

  if (!alternatives.length) return null;
  return (b) => alternatives.some((and) => and.every((t) => t(b)));
}
