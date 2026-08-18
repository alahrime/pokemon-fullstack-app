import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * The plot — grid or terrain, its viewport controls, the legend and the HP
 * slice.
 *
 * The legend and the rank table used to sit in a column beside it, which cost
 * the plot roughly 300px of the width it is drawn in: a 16×16 field reads by
 * its diagonals, and every pixel of cell size is legibility. The table lives
 * in the report's left column now ({@link HeatmapKey}); the legend rides on
 * the plot itself, top-right, where it costs no layout at all.
 *
 * It does cover the high-attack/high-defense corner, which is the one part of
 * the field this view has always kept clear — hence the reserved strip the
 * viewport controls sit in. Two things make that acceptable: the overlay takes
 * no pointer events, so the cells under it stay clickable, and picking one of
 * those cells sends the legend to the opposite corner. Reaching for a spread
 * you cannot see is the signal that the legend is in the way, so it moves out
 * of the way — and the same click at the far corner sends it back.
 */
export function HeatmapView({
  cells,
  colorBy,
  colorByLabel,
  onPick,
  ivS,
  onIvS,
  palette,
}: {
  cells: HeatCell[];
  colorBy: ColorBy;
  colorByLabel: string;
  onPick: (a: number, d: number) => void;
  ivS: number;
  onIvS: (v: number) => void;
  palette: HeatPalette;
}) {
  // Probed once — if the browser can't give us a context, the 3D toggle never
  // appears and the 2D grid stays the only option.
  const webgl = useMemo(() => hasWebGL(), []);
  const [dim, setDim] = useState<'2d' | '3d'>('2d');
  const show3d = webgl && dim === '3d';

  const legendRef = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<'right' | 'left'>('right');

  /**
   * Send the legend to the other corner when the click landed under it.
   *
   * Geometry rather than IV arithmetic: the panel's size depends on the metric
   * name it is labelled with and on the cell size, so "which spreads does it
   * cover" is a question only the layout can answer. The panel is transparent
   * to pointer events, so this same click has already picked the cell beneath
   * it — the legend moving is the second half of one action, not an alternative
   * to it.
   */
  const dodge = (e: React.MouseEvent) => {
    const el = legendRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const under = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (under) setCorner((c) => (c === 'right' ? 'left' : 'right'));
  };

  const legend = (
    <div
      // Keyed by corner so the arrival replays as it lands rather than the
      // panel teleporting: left and right are different properties, and no
      // transition interpolates between them.
      key={corner}
      ref={legendRef}
      className={`hv-legend-panel${corner === 'left' ? ' is-left' : ''}`}
      aria-label={`Legend — ${colorByLabel}`}
    >
      <div className="panel-title hv-legend-title">Legend — {colorByLabel}</div>
      <HeatmapLegendRows colorBy={colorBy} palette={palette} />
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
        {/* Viewport controls are pinned to this wrapper's top-right, in a
            reserved strip rather than floating over the plot — at 16×16 the
            top-right cells are the high-attack/high-defense corner, the part
            you least want covered. */}
        <div className="hv-plot" onClick={dodge}>
          <div className="hv-controls">
            <MotionToggle className="min-h-[38px]" />
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
          {/* The legend sits inside the plotted field itself, not the wrapper:
              its corners are the field's corners, so it lands flush against
              the cells in either position rather than 24px out over the axis
              labels on one side. */}
          {show3d ? (
            <div className="hv-terrain">
              <HudLabel live>Stat-product terrain</HudLabel>
              <div className="mt-1.5 hv-terrain-canvas">
                {legend}
                <Suspense
                  fallback={
                    <div className="panel hud-frame text-muted hv-terrain-fallback">
                      Loading terrain…
                    </div>
                  }
                >
                  <Heatmap3D cells={cells} onPick={onPick} />
                </Suspense>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="text-muted hv-axis-y">
                <span>15</span>
                <span className="hv-axis-y-label">DEF IV</span>
                <span>0</span>
              </div>
              <div className="hv-grid">
                {legend}
                <Heatmap cells={cells} onPick={onPick} />
                <div className="text-muted hv-axis-x">
                  <span>0</span>
                  <span>ATTACK IV</span>
                  <span>15</span>
                </div>
              </div>
            </div>
          )}
          <div className="hv-slice">
            <span className="text-muted text-xs tracking-[0.08em] uppercase whitespace-nowrap">
              HP IV slice
            </span>
            <input type="range" min={0} max={15} step={1} value={ivS} onChange={(e) => onIvS(Number(e.target.value))} className="flex-1" />
            <span className="numeric hv-slice-value">{ivS}</span>
          </div>
        </div>
    </div>
  );
}

/**
 * Swatch-and-label rows for whichever ramp the grid is currently painted from.
 *
 * The swatches are sampled from the live palette rather than declared in CSS,
 * which is what stops the legend describing a ramp the grid isn't drawing.
 */
function HeatmapLegendRows({ colorBy, palette }: { colorBy: ColorBy; palette: HeatPalette }) {
  const labels = LEGEND_LABELS[colorBy];
  const ramp = paletteRamp(palette, labels.length);
  return (
    <>
      {labels.map((label, i) => (
        <div key={label} className="hv-legend-row">
          <span className="hv-swatch" style={{ background: ramp[i] }} />
          <span>{label}</span>
        </div>
      ))}
    </>
  );
}

/** Spreads shown either side of your own. 7 + you + 7 is the floor. */
const NEIGHBOURS = 7;
const MIN_WINDOW = NEIGHBOURS * 2 + 1;

/**
 * How many rows fit the space the column actually gives the table.
 *
 * The panel stretches to the foot of the report — the board beside it is a
 * 700px square plus its controls, so there is far more room here than fifteen
 * rows use. Rather than leave the panel half empty or pin an arbitrary larger
 * count that overflows on a short window, the window measures itself: rows
 * that fit, always odd so the roll keeps the middle, never fewer than the
 * fifteen the readout is specified around.
 *
 * No feedback loop — the scroller is `flex: 1` with `min-height: 0`, so its
 * height comes from the column, and adding rows cannot change it.
 */
function useRowsThatFit(ref: React.RefObject<HTMLDivElement | null>): number {
  const [fit, setFit] = useState(MIN_WINDOW);
  useEffect(() => {
    const el = ref.current;
    // jsdom lays nothing out and has no ResizeObserver: the floor stands.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const row = el.querySelector('tbody tr');
      const head = el.querySelector('thead');
      if (!row || !head) return;
      const rowH = row.getBoundingClientRect().height;
      const avail = el.clientHeight - head.getBoundingClientRect().height;
      if (rowH <= 0 || avail <= 0) return;
      const n = Math.floor(avail / rowH);
      setFit(Math.max(MIN_WINDOW, n % 2 === 0 ? n - 1 : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}

/**
 * The stretch of the ranking your roll is standing in — or, for the damage
 * metrics, how to read the bands the grid draws.
 *
 * Split from the plot so it can live in the report's left column, under the
 * roll it describes. The legend that used to lead this block now rides on the
 * plot itself; what is left is the readout that needs the width.
 *
 * The table used to be the top twelve, fixed. For anyone outside the top
 * twelve that is a list of spreads they do not have: it says what the ceiling
 * is and nothing about where they are. It follows the roll now — your spread
 * with its seven neighbours either side — so the question it answers is "what
 * would one more point actually buy me", which is the question the adjuster
 * next to it exists for. The pager walks the rest of the 4096 from there.
 */
export function HeatmapKey({
  colorBy,
  onPickSpread,
  table,
  iv,
}: {
  colorBy: ColorBy;
  /** Loads a whole spread — these rows cross HP slices, unlike the grid's. */
  onPickSpread: (a: number, d: number, s: number) => void;
  table: SpeciesTable;
  iv: IV;
}) {
  const all = table.all;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const size = useRowsThatFit(scrollerRef);
  const centre = useMemo(() => {
    const i = all.findIndex((r) => r.a === iv.a && r.d === iv.d && r.s === iv.s);
    return i < 0 ? 0 : i;
  }, [all, iv.a, iv.d, iv.s]);
  const maxStart = Math.max(0, all.length - size);
  // Where the window sits when it is centred on the roll. Clamped at both ends:
  // at rank 3 there is no seventh spread above to show.
  const home = Math.min(Math.max(0, centre - (size >> 1)), maxStart);

  const [start, setStart] = useState(home);
  // Re-centre when the roll moves — and when the window resizes, since a taller
  // panel wants a different top row for the same spread. Adjusted during render
  // rather than in an effect so the table never paints one frame around the old
  // spread, or one frame offset from where the first measurement puts it.
  const [homedAt, setHomedAt] = useState({ centre, size });
  if (homedAt.centre !== centre || homedAt.size !== size) {
    setHomedAt({ centre, size });
    setStart(home);
  }
  // A window that grew past the end of the ranking pulls back to fit it.
  const from = Math.min(start, maxStart);
  const rows = all.slice(from, from + size);

  return (
        <div className="stagger hv-key min-w-0 gap-3">
          {colorBy === 'rank' ? (
            <div className="panel hud-frame hv-top-panel" style={{ ['--i' as string]: 1 }}>
              <div className="panel-title">Around your roll</div>
              <div className="table-scroll hv-top-scroll" ref={scrollerRef}>
                <table className="table text-sm hv-top-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>IV</th>
                      <th>Atk</th>
                      <th>Def</th>
                      <th>HP</th>
                      {/* The stat product itself was two ways of saying this
                          column: a raw figure nobody compares in the absolute,
                          beside the same figure as a share of rank 1. */}
                      <th>SP %</th>
                    </tr>
                  </thead>
                  {/* Keyed on the window, so paging through the ranking
                      replays the cascade rather than swapping the numbers. */}
                  <tbody key={from}>
                    {rows.map((r) => (
                      <tr
                        key={`${r.a}-${r.d}-${r.s}`}
                        onClick={() => onPickSpread(r.a, r.d, r.s)}
                        className={`hv-top-row${r.a === iv.a && r.d === iv.d && r.s === iv.s ? ' is-selected' : ''}`}
                      >
                        <td className="numeric hv-top-rank">{r.rank}</td>
                        <td className="numeric">
                          {r.a}/{r.d}/{r.s}
                        </td>
                        {/* The stats these IVs actually buy, at this spread's
                            own level under the cap — which is the whole reason
                            a lower attack IV can outrank a higher one. */}
                        <td className="numeric">{r.statAtk.toFixed(1)}</td>
                        <td className="numeric">{r.statDef.toFixed(1)}</td>
                        <td className="numeric">{r.hp}</td>
                        <td className="numeric hv-top-pct">{((r.sp / table.best.sp) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Not the shared <Pager>: its readout is derived from page ×
                  size, and this window is centred on your roll rather than cut
                  on a fixed grid, so that readout would name ranks the table is
                  not showing. Same chrome, honest numbers. */}
              <nav className="hv-top-pager" aria-label="Ranking window">
                <button
                  type="button"
                  className="btn pager-step"
                  onClick={() => setStart(Math.max(0, from - size))}
                  disabled={from === 0}
                  aria-label="Previous ranks"
                >
                  ‹
                </button>
                <span className="numeric pager-range">
                  {from + 1}–{from + rows.length} <i>of</i> {all.length.toLocaleString()}
                </span>
                <button
                  type="button"
                  className="btn pager-step"
                  onClick={() => setStart(Math.min(maxStart, from + size))}
                  disabled={from >= maxStart}
                  aria-label="Next ranks"
                >
                  ›
                </button>
                {/* Only once you have paged away from it — otherwise it is a
                    control that does nothing, sitting next to two that do. */}
                {from !== home && (
                  <button type="button" className="btn chip-btn hv-top-home" onClick={() => setStart(home)}>
                    your roll
                  </button>
                )}
              </nav>
            </div>
          ) : (
            <div className="panel hud-frame hv-note" style={{ ['--i' as string]: 1 }}>
              <div className="panel-title">Reading this slice</div>
              {NOTES[colorBy]}
            </div>
          )}
        </div>
  );
}
