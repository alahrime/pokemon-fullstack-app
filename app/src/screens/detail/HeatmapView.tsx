import { lazy, Suspense, useMemo, useState } from 'react';
import { Heatmap } from '../../components/Heatmap';
import { SegButton, SegGroup } from '../../components/Seg';
import { HudLabel } from '../../components/Hud';
import { MotionToggle } from '../../components/ThemeSwitch';
import { hasWebGL } from '../../lib/cssColor';
import type { ColorBy } from '../../state/AppState';
import { paletteRamp, type HeatCell, type HeatPalette } from '../../lib/engine';
import type { IV, SpeciesTable } from '../../lib/types';

/* three.js + R3F is ~1.1MB of the bundle and 3D is opt-in, so it's split out
   and fetched on first use. The 2D grid stays in the main chunk. */
const Heatmap3D = lazy(() => import('../../components/Heatmap3D').then((m) => ({ default: m.Heatmap3D })));

const NOTES: Record<ColorBy, string> = {
  rank: 'Rank ridges run diagonally: trading one attack point for one defense point barely moves stat product, which is why so many spreads cluster near the top.',
  break:
    'Vertical bands: only attack moves the breakpoint, so every cell in a column deals identical damage. Pick the tallest band you can reach, then maximise rank inside it.',
  bulk: 'Horizontal bands: bulkpoints depend only on defense. A cell one band up survives one more hit before dropping — often worth more than a few rank places.',
};

/* Labels only — the swatch colours are sampled from the live palette so the
   legend can never describe a ramp the grid isn't drawing. */
const LEGEND_LABELS: Record<ColorBy, string[]> = {
  rank: ['Rank 1–10', 'Top 100', 'Top 1000', 'Mid pack', 'Bottom half'],
  break: ['Highest damage tier', 'One breakpoint down', 'Two down', 'Lowest tier'],
  bulk: ['Takes least damage', 'One bulkpoint worse', 'Two worse', 'Takes most'],
};

export function HeatmapView({
  cells,
  colorBy,
  colorByLabel,
  onPick,
  ivS,
  onIvS,
  table,
  iv,
  palette,
}: {
  cells: HeatCell[];
  colorBy: ColorBy;
  colorByLabel: string;
  onPick: (a: number, d: number) => void;
  ivS: number;
  onIvS: (v: number) => void;
  table: SpeciesTable;
  iv: IV;
  palette: HeatPalette;
}) {
  const topRows = table.all.slice(0, 12);
  // Probed once — if the browser can't give us a context, the 3D toggle never
  // appears and the 2D grid stays the only option.
  const webgl = useMemo(() => hasWebGL(), []);
  const [dim, setDim] = useState<'2d' | '3d'>('2d');
  const show3d = webgl && dim === '3d';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Viewport controls are pinned to this wrapper's top-right, in a
            reserved strip rather than floating over the plot — at 16×16 the
            top-right cells are the high-attack/high-defense corner, the part
            you least want covered. */}
        <div style={{ minWidth: 0, flex: '1 1 560px', position: 'relative', paddingTop: 42 }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              zIndex: 5,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <MotionToggle style={{ minHeight: 38 }} />
            {webgl ? (
              <SegGroup>
                <SegButton active={dim === '2d'} onClick={() => setDim('2d')} title="Flat grid">
                  2D
                </SegButton>
                <SegButton active={dim === '3d'} onClick={() => setDim('3d')} title="Stat-product terrain">
                  3D
                </SegButton>
              </SegGroup>
            ) : null}
          </div>
          {show3d ? (
            <div style={{ minWidth: 0, width: '100%' }}>
              <HudLabel live>Stat-product terrain</HudLabel>
              <div style={{ marginTop: 6 }}>
                <Suspense
                  fallback={
                    <div
                      className="panel hud-frame text-muted"
                      style={{ height: 460, display: 'grid', placeItems: 'center', fontSize: 12 }}
                    >
                      Loading terrain…
                    </div>
                  }
                >
                  <Heatmap3D cells={cells} onPick={onPick} />
                </Suspense>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <div
                className="text-muted"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, padding: '14px 0' }}
              >
                <span>15</span>
                <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.1em' }}>DEF IV</span>
                <span>0</span>
              </div>
              <div style={{ minWidth: 0, width: 'min(640px,100%)' }}>
                <Heatmap cells={cells} onPick={onPick} />
                <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 6, letterSpacing: '0.1em' }}>
                  <span>0</span>
                  <span>ATTACK IV</span>
                  <span>15</span>
                </div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 620 }}>
            <span className="text-muted text-xs tracking-[0.08em] uppercase whitespace-nowrap">
              HP IV slice
            </span>
            <input type="range" min={0} max={15} step={1} value={ivS} onChange={(e) => onIvS(Number(e.target.value))} className="flex-1" />
            <span className="numeric" style={{ fontWeight: 800, fontSize: 18, width: 24, textAlign: 'right' }}>{ivS}</span>
          </div>
        </div>
        <div className="stagger flex min-w-[280px] flex-1 flex-col gap-3">
          <div className="panel hud-frame" style={{ ['--i' as string]: 0 }}>
            <div className="panel-title">Legend — {colorByLabel}</div>
            {(() => {
              const labels = LEGEND_LABELS[colorBy];
              const ramp = paletteRamp(palette, labels.length);
              return labels.map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' }}>
                  <span style={{ width: 14, height: 14, flex: 'none', background: ramp[i] }} />
                  <span>{label}</span>
                </div>
              ));
            })()}
          </div>

          {colorBy === 'rank' ? (
            <div className="panel hud-frame" style={{ ['--i' as string]: 1 }}>
              <div className="panel-title">Top of the space</div>
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>IV</th>
                    <th>SP</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.map((r) => (
                    <tr
                      key={`${r.a}-${r.d}-${r.s}`}
                      onClick={() => onPick(r.a, r.d)}
                      className={r.a === iv.a && r.d === iv.d && r.s === iv.s ? 'is-selected' : undefined}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="numeric" style={{ fontWeight: 800 }}>{r.rank}</td>
                      <td className="numeric">
                        {r.a}/{r.d}/{r.s}
                      </td>
                      <td className="numeric">{(r.sp / 1000).toFixed(2)}k</td>
                      <td className="numeric" style={{ color: 'var(--color-accent-700)' }}>{((r.sp / table.best.sp) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel hud-frame" style={{ fontSize: 12, lineHeight: 1.5, ['--i' as string]: 1 }}>
              <div className="panel-title">Reading this slice</div>
              {NOTES[colorBy]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
