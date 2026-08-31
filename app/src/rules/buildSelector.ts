import { CHARGE_MOVES, FAST_MOVES } from '../lib/data';
import { compileSelector } from './selector';
import type { Build } from './types';

/** A predicate over a build — a ref plus the loadout it is running. */
export type BuildTerm = (b: Build) => boolean;

const ALL_MOVES = [...FAST_MOVES, ...CHARGE_MOVES];

/** Loose match on a move's name, id or type, the way the search box matches. */
function movesMatching(body: string): Set<string> {
  const want = body.replace(/\s+/g, '');
  const out = new Set<string>();
  for (const m of ALL_MOVES) {
    const name = m.name.toLowerCase().replace(/\s+/g, '');
    const id = m.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name.includes(want) || id.includes(want) || m.type === want) out.add(m.id);
  }
  return out;
}

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
        const ids = movesMatching(body.slice(1));
        const t: BuildTerm = (b) => ids.has(b.fast) || b.charges.some((c) => ids.has(c));
        return negate ? (b) => !t(b) : t;
      }

      const ref = compileSelector(raw);
      return ref ? (b) => ref(b.ref) : () => true;
    }),
  );

  if (!alternatives.length) return null;
  return (b) => alternatives.some((and) => and.every((t) => t(b)));
}
