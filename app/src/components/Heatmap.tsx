import type { HeatCell } from '../lib/engine';

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
        border: '1px solid var(--color-divider)',
        padding: 3,
        background: 'var(--color-bg)',
      }}
    >
      {cells.map((c) => (
        <div
          key={`${c.a}-${c.d}`}
          title={c.tip}
          onClick={() => onPick(c.a, c.d)}
          style={{
            aspectRatio: '1',
            minWidth: 0,
            background: c.bg,
            cursor: 'pointer',
            outline: c.isYou ? '2px solid var(--color-text)' : undefined,
            outlineOffset: c.isYou ? 0 : undefined,
            zIndex: c.isYou ? 2 : undefined,
            display: showLabel ? 'grid' : undefined,
            placeItems: showLabel ? 'center' : undefined,
            fontSize: 8,
            color: 'color-mix(in srgb, var(--color-text) 45%, transparent)',
          }}
        >
          {c.isYou && showLabel ? '●' : ''}
        </div>
      ))}
    </div>
  );
}
