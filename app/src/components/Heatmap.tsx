import type { CSSProperties } from 'react';
import type { HeatCell } from '../lib/engine';

/**
 * 2D heatmap of the 4096-space (one HP slice at a time).
 *
 * The reveal is a diagonal wipe: each cell's delay is derived from its own
 * position, expressed as a CSS custom property and multiplied by
 * --stagger-step in motion.css. That keeps the animation entirely on the
 * compositor — no timers, no per-cell JS, and the whole thing collapses to
 * zero when motion is off because --stagger-step scales with --motion-scale.
 */
export function Heatmap({
  cells,
  onPick,
  showLabel = true,
  gap = 2,
}: {
  cells: HeatCell[];
  onPick: (a: number, d: number) => void;
  showLabel?: boolean;
  gap?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(16,minmax(0,1fr))',
        gap,
        border: 'var(--border-hairline) solid var(--rule-strong)',
        padding: 3,
        background: 'var(--surface-1)',
      }}
    >
      {cells.map((c) => (
        <div
          key={`${c.a}-${c.d}`}
          title={c.tip}
          onClick={() => onPick(c.a, c.d)}
          className={`heat-cell${c.isYou ? ' is-you' : ''}`}
          style={
            {
              aspectRatio: '1',
              minWidth: 0,
              background: c.bg,
              cursor: 'pointer',
              outline: c.isYou ? 'var(--border-strong) solid var(--color-text)' : undefined,
              outlineOffset: c.isYou ? 0 : undefined,
              zIndex: c.isYou ? 2 : undefined,
              display: showLabel ? 'grid' : undefined,
              placeItems: showLabel ? 'center' : undefined,
              fontSize: 8,
              color: 'var(--text-faint)',
              // Diagonal sweep from the low-attack/low-defense corner.
              '--cell-delay': c.a + (15 - c.d),
            } as CSSProperties
          }
        >
          {c.isYou && showLabel ? '●' : ''}
        </div>
      ))}
    </div>
  );
}
