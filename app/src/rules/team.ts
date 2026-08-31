import { conflictsOnTeam, speciesOf } from '../lib/data';
import { compileBuildSelector } from './buildSelector';
import { resolvePool } from './pool';
import type { Build, Format, Violation } from './types';

export interface TeamCheck {
  ok: boolean;
  violations: Violation[];
}

/**
 * Whether a team satisfies a format.
 *
 * Every violation is collected rather than returning on the first, because the
 * caller is a builder UI: showing one problem, then another after it is fixed,
 * then a third, is a worse experience than showing all three at once.
 *
 * This is also the function the coordinator will call server-side once
 * matchmaking exists, and it is the trust boundary — a client's claim that its
 * team is legal is worth nothing until this has said so somewhere the client
 * does not control. That is why it takes the team and the format and reads no
 * ambient state.
 */
export function validateTeam(team: readonly Build[], format: Format): TeamCheck {
  const violations: Violation[] = [];
  const c = format.composition;

  if (team.length !== c.size) {
    violations.push({ kind: 'size', expected: c.size, actual: team.length });
  }

  const { legal, decidedBy } = resolvePool(format);
  const legalSet = new Set(legal);

  for (const b of team) {
    if (!legalSet.has(b.ref)) {
      violations.push({ kind: 'illegal-ref', ref: b.ref, clause: decidedBy.get(b.ref) ?? -1 });
    }
    const s = speciesOf(b.ref);
    if (!s) continue;
    const fasts = new Set(s.fastMoves.map((m) => m.id));
    const charges = new Set(s.chargeMoves.map((m) => m.id));
    if (!fasts.has(b.fast)) violations.push({ kind: 'unknown-move', ref: b.ref, move: b.fast });
    for (const ch of b.charges) {
      if (!charges.has(ch)) violations.push({ kind: 'unknown-move', ref: b.ref, move: ch });
    }
  }

  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const a = team[i].ref;
      const b = team[j].ref;
      // Dex-number comparison, via the data layer. It catches a Pokemon against
      // its own Shadow, a regional form against its base and a Mega against its
      // origin — every one of which carries a distinct id, so `a !== b` would
      // miss all three.
      if (c.uniqueSpecies && conflictsOnTeam(a, b)) {
        violations.push({ kind: 'duplicate-species', refs: [a, b] });
      }
      if (c.uniqueFamilies) {
        const fa = speciesOf(a)?.family;
        const fb = speciesOf(b)?.family;
        if (fa && fb && fa === fb) violations.push({ kind: 'duplicate-family', refs: [a, b] });
      }
    }
  }

  // Quotas are count constraints over the subset of the team matching a
  // selector. A quota whose selector will not compile is skipped rather than
  // failing the team: an unparseable rule is the author's problem and is
  // reported by lintFormat at publish time, not the player's problem here.
  for (const q of format.composition.quotas ?? []) {
    const term = compileBuildSelector(q.select);
    if (!term) continue;
    const actual = team.filter(term).length;
    const under = q.min !== undefined && actual < q.min;
    const over = q.max !== undefined && actual > q.max;
    if (under || over) {
      // Built as one literal rather than assigned field by field: `Violation`
      // is a discriminated union and tsc will not let you set `.min` on a value
      // already narrowed to one member.
      violations.push({
        kind: 'quota',
        select: q.select,
        actual,
        ...(q.min !== undefined ? { min: q.min } : {}),
        ...(q.max !== undefined ? { max: q.max } : {}),
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
