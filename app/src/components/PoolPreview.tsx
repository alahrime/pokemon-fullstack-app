import { useMemo } from 'react';
import { displayName } from '../lib/data';
import { lintFormat, resolvePool, type Diagnostic, type Format } from '../rules';

interface Props {
  format: Format;
  /** A ref to explain, if the user has asked about one. */
  explain?: string;
}

/**
 * A one-line, human-readable account of a diagnostic.
 *
 * `lintFormat` deals in a closed union of `kind`s so a switch here is
 * exhaustive by construction — TypeScript flags it the moment a new kind is
 * added to `Diagnostic` and this file is not updated to match.
 */
function describeDiagnostic(d: Diagnostic): string {
  switch (d.kind) {
    case 'empty-pool':
      return 'No ref survives the pool pipeline — nothing is legal.';
    case 'pool-too-small':
      return `Random selection needs at least ${d.need} drawable refs; there are only ${d.have}.`;
    case 'unsatisfiable':
      return 'No legal team can satisfy composition and quotas together.';
    case 'bad-selector':
      return `Rule ${d.clause + 1}'s selector does not parse: "${d.select}".`;
    case 'random-with-quotas':
      return 'Random selection cannot honour quotas — pick open selection or drop them.';
    case 'unsatisfiable-unproven':
      return 'The search could not find a legal team within its budget — this may or may not be satisfiable.';
    case 'narrow-pool':
      return `Only ${d.have} of ${d.leagueSize} league refs are legal — an unusually narrow pool.`;
    case 'dead-clause':
      return `Rule ${d.clause + 1} decides nothing — it is fully shadowed by later rules.`;
  }
}

/**
 * The legal pool, as it stands, with each clause's contribution.
 *
 * Recomputed from scratch on every render rather than diffed: the roster is
 * ~1,650 refs and a term compiles to a closure, so a full pass is far below
 * anything worth memoising against a keystroke, and an incremental version
 * would have to reproduce last-match-wins a second time to stay correct.
 *
 * The per-clause delta is what the pipeline costs the author to understand, so
 * it is shown rather than described: a clause that reads as a small exception
 * and removes eighty refs is the mistake this catches.
 */
export function PoolPreview({ format, explain }: Props) {
  const { legal, decidedBy } = useMemo(() => resolvePool(format), [format]);
  const diagnostics = useMemo(() => lintFormat(format), [format]);

  // Each prefix of the clause list, so a delta is the difference one clause made
  // in the position it actually occupies — which is the only place its effect is
  // defined.
  const deltas = useMemo(() => {
    let prev = resolvePool({ ...format, pool: [] }).legal.length;
    return format.pool.map((_, i) => {
      const n = resolvePool({ ...format, pool: format.pool.slice(0, i + 1) }).legal.length;
      const d = n - prev;
      prev = n;
      return d;
    });
  }, [format]);

  const explained = explain ? decidedBy.get(explain) : undefined;

  return (
    <section className="pool-preview">
      <p className="hud-label">Legal pool</p>
      <p data-testid="pool-count" className="pool-count">
        {legal.length}
      </p>

      <ol className="clause-deltas">
        {format.pool.map((c, i) => (
          <li key={i} data-testid="clause-delta">
            <span className="hud-label">rule {i + 1}</span>
            <code>
              {c.effect} {c.select}
            </code>
            <span className={deltas[i] < 0 ? 'delta-down' : 'delta-up'}>
              {deltas[i] > 0 ? `+${deltas[i]}` : deltas[i]}
            </span>
          </li>
        ))}
      </ol>

      {explain && (
        <p data-testid="explain" className="pool-explain">
          {explained === undefined
            ? `${explain} is not in this league.`
            : explained === -1
              ? `${displayName(explain)} is legal — no rule touches it.`
              : `${displayName(explain)}: ${format.pool[explained].effect === 'deny' ? 'denied' : 'allowed'} by rule ${explained + 1} — ${format.pool[explained].select}`}
        </p>
      )}

      <ul className="pool-diagnostics">
        {diagnostics.map((d, i) => (
          <li key={i} data-testid="diagnostic" className={`diag diag-${d.level}`}>
            <span className="hud-label">{d.level}</span> {describeDiagnostic(d)}
          </li>
        ))}
      </ul>
    </section>
  );
}
