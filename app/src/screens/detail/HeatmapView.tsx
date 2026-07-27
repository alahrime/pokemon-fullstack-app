import { Heatmap } from '../../components/Heatmap';
import { ChipButton } from '../../components/Seg';
import type { ColorBy } from '../../state/AppState';
import type { HeatCell } from '../../lib/engine';

const COLOR_BY_ITEMS: [ColorBy, string][] = [
  ['rank', 'Rank'],
  ['break', 'Breakpoints'],
  ['bulk', 'Bulkpoints'],
];

const LEGENDS: Record<ColorBy, [string, string][]> = {
  rank: [
    ['Rank 1–10', 'var(--color-accent-700)'],
    ['Top 100', 'var(--color-accent-500)'],
    ['Top 1000', 'var(--color-accent-300)'],
    ['Mid pack', 'var(--color-accent-100)'],
    ['Bottom half', 'var(--color-neutral-200)'],
  ],
  break: [
    ['Highest damage tier', 'var(--color-accent-700)'],
    ['One breakpoint down', 'var(--color-accent-500)'],
    ['Two down', 'var(--color-accent-300)'],
    ['Lowest tier', 'var(--color-neutral-200)'],
  ],
  bulk: [
    ['Takes least damage', 'var(--color-accent-700)'],
    ['One bulkpoint worse', 'var(--color-accent-500)'],
    ['Two worse', 'var(--color-accent-300)'],
    ['Takes most', 'var(--color-neutral-200)'],
  ],
};

const NOTES: Record<ColorBy, string> = {
  rank: 'Rank ridges run diagonally: trading one attack point for one defense point barely moves stat product, which is why so many spreads cluster near the top.',
  break:
    'Vertical bands: only attack moves the breakpoint, so every cell in a column deals identical damage. Pick the tallest band you can reach, then maximise rank inside it.',
  bulk: 'Horizontal bands: bulkpoints depend only on defense. A cell one band up survives one more hit before dropping — often worth more than a few rank places.',
};

export function HeatmapView({
  cells,
  colorBy,
  colorByLabel,
  onColorBy,
  onPick,
  ivS,
  onIvS,
}: {
  cells: HeatCell[];
  colorBy: ColorBy;
  colorByLabel: string;
  onColorBy: (c: ColorBy) => void;
  onPick: (a: number, d: number) => void;
  ivS: number;
  onIvS: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {COLOR_BY_ITEMS.map(([id, label]) => (
            <ChipButton key={id} active={colorBy === id} onClick={() => onColorBy(id)}>
              {label}
            </ChipButton>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div
            className="text-muted"
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 9, padding: '12px 0' }}
          >
            <span>15</span>
            <span>DEF IV</span>
            <span>0</span>
          </div>
          <div style={{ minWidth: 0, width: 'min(560px,100%)' }}>
            <Heatmap cells={cells} onPick={onPick} />
            <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 4 }}>
              <span>0</span>
              <span>ATTACK IV</span>
              <span>15</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            HP IV slice {ivS}
          </span>
          <input
            type="range"
            min={0}
            max={15}
            step={1}
            value={ivS}
            onChange={(e) => onIvS(Number(e.target.value))}
            style={{ flex: 1, minWidth: 140 }}
          />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ border: '1px solid var(--color-divider)', padding: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 8 }}>
            Legend — {colorByLabel}
          </div>
          {LEGENDS[colorBy].map(([label, color]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' }}>
              <span style={{ width: 14, height: 14, flex: 'none', background: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ border: '1px solid var(--color-divider)', padding: 12, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 6 }}>
            Reading this slice
          </div>
          {NOTES[colorBy]}
        </div>
      </div>
    </div>
  );
}
