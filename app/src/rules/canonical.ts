import type { Format, PoolClause, Quota } from './types';

/**
 * The canonical string form of a format.
 *
 * This is the value a `rules_hash` is taken over once matchmaking exists, so
 * two people who independently author the same rules produce the same string
 * and land in the same queue. That makes three things load-bearing:
 *
 *   - Key order must not matter, so every object is written field by field
 *     rather than handed to JSON.stringify.
 *   - Notes must not matter. They are commentary; a format is not a different
 *     format because someone explained it.
 *   - Clause order *must* matter. Under last-match-wins the same clauses in a
 *     different order are a different ruleset, and collapsing that would pool
 *     two genuinely different formats into one queue.
 *
 * Optional fields are written at their defaults rather than omitted, so an
 * explicit `false` and an absent flag agree.
 *
 * Word boundaries within selectors are significant to the grammar: species and
 * move names are matched as raw multi-word substrings. Canonicalization may
 * normalize runs of whitespace but must not delete them, or two different
 * rulesets — `deny tapu koko` vs. `deny tapukoko` — would collapse onto one
 * identity.
 */
function normSelect(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function clause(c: PoolClause): string {
  return `${c.effect}:${normSelect(c.select)}`;
}

function quota(q: Quota): string {
  return `${normSelect(q.select)}:${q.min ?? 0}:${q.max ?? -1}`;
}

export function canonicalize(f: Format): string {
  const c = f.composition;
  const s = f.selection;
  const parts = [
    `schema=${f.schema}`,
    `base=${f.base}`,
    `start=${f.start ?? 'league'}`,
    `pool=[${f.pool.map(clause).join('|')}]`,
    `size=${c.size}`,
    `bring=${c.bring ?? c.size}`,
    `uniqueSpecies=${c.uniqueSpecies ?? false}`,
    `uniqueFamilies=${c.uniqueFamilies ?? false}`,
    // Quotas are a set, not a sequence — unlike pool clauses, they all apply
    // at once and their order cannot change an outcome. Sorted so two authors
    // who added the same quotas in a different order still agree.
    `quotas=[${(c.quotas ?? []).map(quota).sort().join('|')}]`,
    `mode=${s.mode}`,
    `topN=${s.topN ?? 0}`,
    `playerPicks=${s.playerPicks ?? 0}`,
    `rollMoves=${s.rollMoves ?? false}`,
  ];
  return parts.join(';');
}
