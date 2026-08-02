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
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Which tick the pointer is over, from its position along the track.
   *
   * Computed from geometry rather than from whichever tick element happens to
   * be under the cursor: during a drag the pointer is captured by the track, so
   * `event.target` stays the track and per-tick handlers never fire. Reading
   * the offset also lets the value follow a pointer that has slid above or
   * below the row, which is what makes a drag feel attached.
   */
  const tickAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return value;
    const frac = (clientX - r.left) / r.width;
    return Math.max(0, Math.min(MAX_IV, Math.ceil(frac * MAX_IV)));
  };

  return (
    <div className={`iv-row${perfect ? ' is-perfect' : ''}${dragging ? ' is-dragging' : ''}`}>
      <span className="iv-label">{label}</span>

      <div
        ref={trackRef}
        className="iv-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={MAX_IV}
        aria-valuenow={value}
        onPointerDown={(e) => {
          // Left button / touch / pen only.
          if (e.button !== 0) return;
          e.preventDefault();
          setDragging(true);
          // Capture so the drag survives leaving the track, and so a pointerup
          // anywhere still ends it.
          e.currentTarget.setPointerCapture(e.pointerId);
          const hit = tickAt(e.clientX);
          // Pressing the tick already set clears to 0, which is otherwise
          // unreachable from the bar. Only on the press — during a drag it
          // would blank the value every time the pointer crossed its own tick.
          onSet(hit === value ? 0 : hit);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const next = tickAt(e.clientX);
          // Only commit real changes — a move within one tick would otherwise
          // dispatch a state update on every pointer event.
          if (next !== value) onSet(next);
        }}
        onPointerUp={(e) => {
          setDragging(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => setDragging(false)}
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
            // Presentational only. The track handles pointer input as one
            // surface, which is what lets a press become a drag; a per-tick
            // onClick would fire a second time for the same press.
            <span
              key={tick}
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
