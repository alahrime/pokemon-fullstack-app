import { useEffect, useRef, useState } from 'react';
import type { IV } from '../lib/types';

const ROWS: [keyof IV, string][] = [
  ['a', 'Attack'],
  ['d', 'Defense'],
  ['s', 'HP'],
];

/**
 * Flags a numeric readout as recently changed so it can flash accent.
 * Duration is deliberately hardcoded rather than read from the motion tokens —
 * this is a state timer, not an animation, and it should still clear itself
 * when motion is disabled (the colour transition is what gets suppressed).
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

function Row({
  label,
  value,
  size,
  onBump,
}: {
  label: string;
  value: number;
  size: number;
  onBump: (delta: number) => void;
}) {
  const changed = useChanged(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="text-muted" style={{ width: 66, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <button
        className="btn btn-secondary"
        style={{ width: size, height: size, padding: 0, justifyContent: 'center' }}
        onClick={() => onBump(-1)}
        aria-label={`Decrease ${label}`}
      >
        –
      </button>
      <span
        className={`numeric tick-value${changed ? ' is-changing' : ''}`}
        style={{ fontWeight: 800, fontSize: 18, width: 26, textAlign: 'center' }}
      >
        {value}
      </span>
      <button
        className="btn btn-secondary"
        style={{ width: size, height: size, padding: 0, justifyContent: 'center' }}
        onClick={() => onBump(1)}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
      <div style={{ flex: 1, height: 6, background: 'var(--color-neutral-300)' }}>
        <div
          style={{
            height: 6,
            background: 'var(--color-accent)',
            width: `${(value / 15) * 100}%`,
            boxShadow: 'var(--glow-accent)',
            transition: 'width var(--dur-3) var(--ease-spring)',
          }}
        />
      </div>
    </div>
  );
}

export function IVAdjuster({ iv, onBump, size = 34 }: { iv: IV; onBump: (key: keyof IV, delta: number) => void; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ROWS.map(([k, label]) => (
        <Row key={k} label={label} value={iv[k]} size={size} onBump={(d) => onBump(k, d)} />
      ))}
    </div>
  );
}
