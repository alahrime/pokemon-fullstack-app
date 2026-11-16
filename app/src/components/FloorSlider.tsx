import { useState } from 'react';
import { useChanged } from './IVAdjuster';

export type FloorTone = 'atk' | 'def' | 'lvl' | 'cp';

/**
 * One stat-floor slider: a minimum, so the rail is lit from the thumb *up* and
 * hatched below it — the lit stretch is what the floor keeps.
 *
 * Deliberately not the appraisal bar's vocabulary. That one is fifteen blocks
 * filling from the left, green to red, with a spinning bubble and a sparkle;
 * this is a continuous ruled rail in one hue per stat, a flat tag that reads
 * "≥ value" while held, and a single sweep through the kept stretch on release.
 * Same amount of motion, nothing that could be mistaken for an IV.
 *
 * The control underneath is a native range input, invisible and stretched over
 * the rail: pointer, keyboard and screen-reader behaviour are the browser's.
 * Its thumb is sized to the drawn one so the grab point and the picture agree.
 */
export function FloorSlider({
  tone,
  label,
  name,
  min,
  max,
  step,
  digits,
  value,
  mark,
  onChange,
}: {
  tone: FloorTone;
  /** The short label on the row: "Atk". */
  label: string;
  /** What the accessible name says is being floored: "attack stat". */
  name: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  value: number;
  /** Your own roll's value, notched on the rail; dimmed once the floor passes it. */
  mark?: number;
  onChange: (v: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  /** Releases so far; keys the lock-in sweep so each one replays it. */
  const [locks, setLocks] = useState(0);
  const changed = useChanged(value);
  const frac = (x: number) => (max > min ? (Math.min(max, Math.max(min, x)) - min) / (max - min) : 0);
  const shown = value.toFixed(digits);

  return (
    <label className={`fs fs-${tone}${dragging ? ' is-dragging' : ''}`} style={{ ['--p' as string]: frac(value) }}>
      <span className="fs-label">{label} ≥</span>
      <span className="fs-rail">
        <input
          type="range"
          className="fs-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => {
            setDragging(true);
            // On the window: a drag released off the rail never reaches the input.
            const end = () => {
              setDragging(false);
              setLocks((n) => n + 1);
              window.removeEventListener('pointerup', end);
              window.removeEventListener('pointercancel', end);
            };
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
          }}
          aria-label={`Minimum ${name}`}
          aria-valuetext={`at least ${shown}`}
        />
        <span className="fs-cut" aria-hidden />
        <span className="fs-keep" aria-hidden />
        {locks > 0 && <span key={locks} className="fs-lock" aria-hidden />}
        {mark !== undefined && (
          <span className={`fs-mark${mark < value ? ' is-out' : ''}`} style={{ ['--m' as string]: frac(mark) }} aria-hidden />
        )}
        <span className="fs-thumb" aria-hidden>
          {dragging && (
            <span className="fs-bubble numeric">
              ≥ <span key={shown} className="fs-num">{shown}</span>
            </span>
          )}
        </span>
      </span>
      <span className={`numeric fs-value${changed ? ' is-changing' : ''}`}>{shown}</span>
    </label>
  );
}
