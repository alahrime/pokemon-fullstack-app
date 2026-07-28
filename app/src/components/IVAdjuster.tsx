import { useEffect, useRef, useState } from 'react';
import type { IV } from '../lib/types';

const ROWS: [keyof IV, string][] = [
  ['a', 'Attack'],
  ['d', 'Defense'],
  ['s', 'HP'],
];

const MAX_IV = 15;
/** Segment boundaries, matching the game's appraisal bar. */
const GROUP = 4;

/**
 * Flags a value as recently changed so it can flash. Deliberately a state
 * timer rather than an animation token — it should still clear itself when
 * motion is disabled; only the colour transition gets suppressed.
 */
function useChanged(value: number, ms = 420): boolean {
  const [changed, setChanged] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setChanged(true);
    const t = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return changed;
}

/**
 * One appraisal-style stat row.
 *
 * Modelled on the in-game appraisal bars: a labelled track split into segments
 * of four, filling warm as the value climbs and lighting up at 15. Unlike the
 * game's read-only display these ticks are the control — clicking tick n sets
 * the IV directly, which beats stepping from 0 to 15 one button press at a
 * time. The -/+ buttons stay for fine adjustment and keyboard use.
 */
function StatRow({
  label,
  value,
  onSet,
  onBump,
  size,
}: {
  label: string;
  value: number;
  onSet: (v: number) => void;
  onBump: (delta: number) => void;
  size: number;
}) {
  const changed = useChanged(value);
  const perfect = value === MAX_IV;

  return (
    <div className={`iv-row${perfect ? ' is-perfect' : ''}`}>
      <span className="iv-label">{label}</span>

      <div
        className="iv-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={MAX_IV}
        aria-valuenow={value}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onBump(1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onBump(-1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            onSet(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            onSet(MAX_IV);
          }
        }}
      >
        {Array.from({ length: MAX_IV }, (_, i) => {
          const tick = i + 1;
          return (
            <button
              key={tick}
              type="button"
              tabIndex={-1}
              // Clicking the tick you're already on clears to 0 — otherwise
              // there'd be no way to reach 0 from the bar itself.
              onClick={() => onSet(value === tick ? 0 : tick)}
              className={`iv-tick${tick <= value ? ' is-on' : ''}${tick % GROUP === 0 && tick !== MAX_IV ? ' is-group-end' : ''}`}
              title={`${label} ${tick}`}
              aria-hidden
            />
          );
        })}
      </div>

      <span className={`iv-value numeric${changed ? ' is-changing' : ''}`}>{value}</span>

      <span className="iv-buttons">
        <button
          type="button"
          className="iv-step"
          style={{ width: size, height: size }}
          onClick={() => onBump(-1)}
          aria-label={`Decrease ${label}`}
          disabled={value === 0}
        >
          –
        </button>
        <button
          type="button"
          className="iv-step"
          style={{ width: size, height: size }}
          onClick={() => onBump(1)}
          aria-label={`Increase ${label}`}
          disabled={value === MAX_IV}
        >
          +
        </button>
      </span>
    </div>
  );
}

export function IVAdjuster({
  iv,
  onBump,
  onSet,
  size = 26,
}: {
  iv: IV;
  onBump: (key: keyof IV, delta: number) => void;
  onSet?: (key: keyof IV, value: number) => void;
  size?: number;
}) {
  return (
    <div className="iv-adjuster">
      {ROWS.map(([k, label]) => (
        <StatRow
          key={k}
          label={label}
          value={iv[k]}
          size={size}
          onBump={(d) => onBump(k, d)}
          onSet={(v) => (onSet ? onSet(k, v) : onBump(k, v - iv[k]))}
        />
      ))}
    </div>
  );
}
