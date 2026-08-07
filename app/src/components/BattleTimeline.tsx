import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { BattleLogEntry } from '../lib/types';

const WIDTH = 640;
const HP_HEIGHT = 130;
const ENERGY_HEIGHT = 46;
const GAP = 18;
const TOTAL_HEIGHT = HP_HEIGHT + GAP + ENERGY_HEIGHT;

interface Point {
  turn: number;
  hpA: number;
  hpB: number;
  energyA: number;
  energyB: number;
}

function buildPoints(log: BattleLogEntry[], maxHpA: number, maxHpB: number, startEnergyA: number, startEnergyB: number): Point[] {
  const points: Point[] = [{ turn: 0, hpA: maxHpA, hpB: maxHpB, energyA: startEnergyA, energyB: startEnergyB }];
  for (const e of log) {
    points.push({ turn: e.turn, hpA: e.hpA, hpB: e.hpB, energyA: e.energyA, energyB: e.energyB });
  }
  return points;
}

/**
 * Sets --path-len from the path's own measured length so the draw-on keyframe
 * in motion.css has a correct dash offset. Measuring beats guessing: a short
 * fight and a 60-turn slugfest need very different dash arrays.
 */
function useDrawLength<T extends SVGPathElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const len = el.getTotalLength();
    el.style.setProperty('--path-len', String(Math.ceil(len)));
    // Restart the animation when the underlying data changes.
    el.style.animation = 'none';
    void el.getBoundingClientRect();
    el.style.animation = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function pathFor(points: Point[], totalTurns: number, height: number, get: (p: Point) => number, max: number): string {
  return points
    .map((p, i) => {
      const x = (p.turn / Math.max(1, totalTurns)) * WIDTH;
      const y = height - (get(p) / max) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function BattleTimeline({
  log,
  maxHpA,
  maxHpB,
  startEnergyA,
  startEnergyB,
  nameA,
  nameB,
}: {
  log: BattleLogEntry[];
  maxHpA: number;
  maxHpB: number;
  startEnergyA: number;
  startEnergyB: number;
  nameA: string;
  nameB: string;
}) {
  const totalTurns = log.length ? log[log.length - 1].turn : 1;
  const points = buildPoints(log, maxHpA, maxHpB, startEnergyA, startEnergyB);
  const hpAPath = pathFor(points, totalTurns, HP_HEIGHT, (p) => p.hpA, maxHpA);
  const hpBPath = pathFor(points, totalTurns, HP_HEIGHT, (p) => p.hpB, maxHpB);
  const enAPath = pathFor(points, totalTurns, ENERGY_HEIGHT, (p) => p.energyA, 100);
  const enBPath = pathFor(points, totalTurns, ENERGY_HEIGHT, (p) => p.energyB, 100);

  const chargeEvents = log.filter((e) => e.kind === 'charge');
  const seconds = (turn: number) => (turn * 0.5).toFixed(1);

  // Only the HP paths draw on; the energy paths fade, so they need no measuring.
  const hpARef = useDrawLength<SVGPathElement>([hpAPath]);
  const hpBRef = useDrawLength<SVGPathElement>([hpBPath]);

  const markerFor = (e: BattleLogEntry, side: 'A' | 'B') => {
    const x = (e.turn / Math.max(1, totalTurns)) * WIDTH;
    const hp = side === 'A' ? e.hpA : e.hpB;
    const max = side === 'A' ? maxHpA : maxHpB;
    const y = HP_HEIGHT - (hp / max) * HP_HEIGHT;
    const isActor = e.actor === side;
    if (!isActor) return null;
    const label =
      (e.shielded
        ? e.bait
          ? `${e.moveName} (bait — shielded, 1 dmg)`
          : `${e.moveName} (shielded, 1 dmg)`
        : `${e.moveName} (${e.damage} dmg)`) + (e.buffText ? ` · ${e.buffText}` : '');
    const delay = { ['--marker-delay' as string]: `${300 + (e.turn / Math.max(1, totalTurns)) * 700}ms` } as CSSProperties;
    return (
      <g key={`${e.turn}-${e.actor}-${e.moveName}`}>
        {/* A dashed ring marks the turn a stat stage actually landed, so the
            point where damage output changes is visible on the curve itself
            rather than only in the log below it. Shares the marker's delay so
            it arrives with its own dot rather than ahead of the line. */}
        {e.buffText && (
          <circle
            className="pop-marker"
            cx={x}
            cy={y}
            r={9}
            fill="none"
            stroke="var(--color-accent-700)"
            strokeWidth={1.5}
            strokeDasharray="2,2"
            style={delay}
          />
        )}
        <circle
          className="pop-marker"
          cx={x}
          cy={y}
          r={e.shielded ? 4 : 5.5}
          fill={e.shielded ? 'var(--surface-1)' : side === 'A' ? 'var(--color-accent)' : 'var(--color-neutral-700)'}
          stroke={side === 'A' ? 'var(--color-accent)' : 'var(--color-neutral-700)'}
          strokeWidth={1.5}
          // Markers land in step with the line as it draws past them.
          style={delay}
        >
          <title>{`t=${seconds(e.turn)}s · ${side === 'A' ? nameA : nameB} · ${label}`}</title>
        </circle>
      </g>
    );
  };

  return (
    <div>
      <div className="tl-legend">
        <span className="flex items-center gap-[5px]">
          <span className="tl-key tl-key-a" />
          {nameA} HP/energy
        </span>
        <span className="flex items-center gap-[5px]">
          <span className="tl-key tl-key-b" />
          {nameB} HP/energy
        </span>
        <span className="text-muted">● filled = real hit &nbsp; ○ hollow = shielded (bait or not)</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${TOTAL_HEIGHT}`} className="tl-svg">
        <defs>
          {/* Telemetry grid, drawn from the theme's grid token. */}
          <pattern id="bt-grid" width={WIDTH / 12} height={26} patternUnits="userSpaceOnUse">
            <path d={`M ${WIDTH / 12} 0 L 0 0 0 26`} fill="none" stroke="var(--grid-line)" strokeWidth={1} />
          </pattern>
        </defs>

        {/* HP chart */}
        <rect x={0} y={0} width={WIDTH} height={HP_HEIGHT} fill="var(--surface-2)" />
        <rect x={0} y={0} width={WIDTH} height={HP_HEIGHT} fill="url(#bt-grid)" />
        <path ref={hpBRef} className="draw-path" d={hpBPath} fill="none" stroke="var(--color-neutral-700)" strokeWidth={2} />
        <path ref={hpARef} className="draw-path" d={hpAPath} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
        {chargeEvents.map((e) => markerFor(e, 'A'))}
        {chargeEvents.map((e) => markerFor(e, 'B'))}
        <text x={4} y={12} fontSize={9} fill="var(--color-text)" opacity={0.55}>
          HP
        </text>

        {/* energy chart */}
        <rect x={0} y={HP_HEIGHT + GAP} width={WIDTH} height={ENERGY_HEIGHT} fill="var(--surface-2)" />
        <g transform={`translate(0, ${HP_HEIGHT + GAP})`}>
          <rect x={0} y={0} width={WIDTH} height={ENERGY_HEIGHT} fill="url(#bt-grid)" />
          {/* Fade, not draw-on: .draw-path drives stroke-dasharray, which would
              overwrite the 3,2 dash that distinguishes energy from HP. */}
          <path className="anim-fade" d={enBPath} fill="none" stroke="var(--color-neutral-700)" strokeWidth={1.5} strokeDasharray="3,2" />
          <path className="anim-fade" d={enAPath} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="3,2" />
          <text x={4} y={12} fontSize={9} fill="var(--color-text)" opacity={0.55}>
            Energy
          </text>
        </g>
      </svg>
      <div className="hud-ticks tl-note">
        <span>0.0s</span>
        <span>{seconds(totalTurns / 2)}s</span>
        <span>{seconds(totalTurns)}s</span>
      </div>
    </div>
  );
}
