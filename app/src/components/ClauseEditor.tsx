import { useRef } from 'react';
import type { PoolClause } from '../rules';

interface Props {
  clauses: PoolClause[];
  onChange: (next: PoolClause[]) => void;
}

/**
 * Add, edit, reorder and remove pool clauses.
 *
 * Reordering is offered as explicit buttons rather than only as a drag. Under
 * last-match-wins the order *is* the ruleset — moving rule 2 above rule 1 gives
 * a different legal pool — so it has to be reachable by keyboard and obvious at
 * a glance, not a gesture somebody has to discover.
 *
 * The effect toggle uses `.chip-btn` (a single button with an `.is-active`
 * fill), not `.form-toggle` — that class is a two-pole channel built around a
 * pair of `.form-opt` children (see BestBuddyToggle), and a lone button
 * carrying it would set `display: grid` and a channel background with no
 * second pole to throw against. `.chip-btn` is the same single-button,
 * two-state pattern already used by `Seg.tsx`'s `ChipButton`.
 *
 * Rows key off a stable id, not their array index. `PoolClause` has no id of
 * its own — adding one would flow into `canonicalize` and change every
 * format's hash, well out of scope for a list-rendering concern — so identity
 * is tracked here instead, in a ref-held array kept in lockstep with
 * `clauses` by every mutation below. Without this, swapping two rows leaves
 * React holding the DOM node at each index fixed and re-rendering its
 * contents in place: focus stays on the button, but the button now belongs to
 * a different clause, so a keyboard user moving a row up twice oscillates
 * instead of moving it.
 */
export function ClauseEditor({ clauses, onChange }: Props) {
  const keysRef = useRef<number[]>([]);
  const nextKeyRef = useRef(0);

  // Resync only on a length mismatch — i.e. when something outside this
  // component's own handlers changed the clause count (a different format
  // loaded, say). Our own handlers below keep keysRef exactly in step with
  // `clauses` on every add/remove/swap, so in the common case this is a no-op.
  if (keysRef.current.length !== clauses.length) {
    keysRef.current = clauses.map(() => nextKeyRef.current++);
  }
  const keys = keysRef.current;

  const replace = (i: number, c: PoolClause) =>
    onChange(clauses.map((x, j) => (j === i ? c : x)));

  const swap = (i: number, j: number) => {
    const next = [...clauses];
    [next[i], next[j]] = [next[j], next[i]];
    const nextKeys = [...keys];
    [nextKeys[i], nextKeys[j]] = [nextKeys[j], nextKeys[i]];
    keysRef.current = nextKeys;
    onChange(next);
  };

  const remove = (i: number) => {
    keysRef.current = keys.filter((_, j) => j !== i);
    onChange(clauses.filter((_, j) => j !== i));
  };

  const add = () => {
    keysRef.current = [...keys, nextKeyRef.current++];
    onChange([...clauses, { effect: 'deny', select: '' }]);
  };

  return (
    <div className="clause-editor">
      <ol className="clause-list">
        {clauses.map((c, i) => (
          <li key={keys[i]} data-testid="clause-row" className="clause-row">
            <span className="hud-label">rule {i + 1}</span>

            <button
              type="button"
              data-testid="clause-effect"
              className={`btn chip-btn${c.effect === 'allow' ? ' is-active' : ''}`}
              aria-label={`rule ${i + 1} effect, currently ${c.effect}`}
              aria-pressed={c.effect === 'allow'}
              onClick={() => replace(i, { ...c, effect: c.effect === 'deny' ? 'allow' : 'deny' })}
            >
              {c.effect}
            </button>

            <input
              data-testid="clause-select"
              className="clause-input"
              value={c.select}
              placeholder="flying, +mantine, azumarill&!shadow"
              aria-label={`rule ${i + 1} selector`}
              onChange={(e) => replace(i, { ...c, select: e.target.value })}
            />

            <button
              type="button"
              className="btn chip-btn"
              aria-label={`move up rule ${i + 1}`}
              disabled={i === 0}
              onClick={() => swap(i, i - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn chip-btn"
              aria-label={`move down rule ${i + 1}`}
              disabled={i === clauses.length - 1}
              onClick={() => swap(i, i + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn chip-btn"
              aria-label={`remove rule ${i + 1}`}
              onClick={() => remove(i)}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <button type="button" className="btn chip-btn" onClick={add}>
        Add rule
      </button>
    </div>
  );
}
