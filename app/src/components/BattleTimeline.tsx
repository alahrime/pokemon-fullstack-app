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
    return (
      <g key={`${e.turn}-${e.actor}-${e.moveName}`}>
        {e.buffText && (
          <circle cx={x} cy={y} r={9} fill="none" stroke="var(--color-accent-700)" strokeWidth={1.5} strokeDasharray="2,2" />
        )}
        <circle
          cx={x}
          cy={y}
          r={e.shielded ? 4 : 5.5}
          fill={e.shielded ? 'var(--color-bg)' : side === 'A' ? 'var(--color-accent)' : 'var(--color-neutral-700)'}
          stroke={side === 'A' ? 'var(--color-accent)' : 'var(--color-neutral-700)'}
          strokeWidth={1.5}
        >
          <title>{`t=${seconds(e.turn)}s · ${side === 'A' ? nameA : nameB} · ${label}`}</title>
        </circle>
      </g>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 6, fontSize: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, background: 'var(--color-accent)', display: 'inline-block' }} />
          {nameA} HP/energy
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, background: 'var(--color-neutral-700)', display: 'inline-block' }} />
          {nameB} HP/energy
        </span>
        <span className="text-muted">● filled = real hit &nbsp; ○ hollow = shielded (bait or not)</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${TOTAL_HEIGHT}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* HP chart */}
        <rect x={0} y={0} width={WIDTH} height={HP_HEIGHT} fill="var(--color-surface)" />
        <path d={hpBPath} fill="none" stroke="var(--color-neutral-700)" strokeWidth={2} />
        <path d={hpAPath} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
        {chargeEvents.map((e) => markerFor(e, 'A'))}
        {chargeEvents.map((e) => markerFor(e, 'B'))}
        <text x={4} y={12} fontSize={9} fill="var(--color-text)" opacity={0.55}>
          HP
        </text>

        {/* energy chart */}
        <rect x={0} y={HP_HEIGHT + GAP} width={WIDTH} height={ENERGY_HEIGHT} fill="var(--color-surface)" />
        <g transform={`translate(0, ${HP_HEIGHT + GAP})`}>
          <path d={enBPath} fill="none" stroke="var(--color-neutral-700)" strokeWidth={1.5} strokeDasharray="3,2" />
          <path d={enAPath} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="3,2" />
          <text x={4} y={12} fontSize={9} fill="var(--color-text)" opacity={0.55}>
            Energy
          </text>
        </g>
      </svg>
      <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4 }}>
        <span>0.0s</span>
        <span>{seconds(totalTurns)}s</span>
      </div>
    </div>
  );
}
