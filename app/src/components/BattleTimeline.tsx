import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { isPokemonType } from '../lib/pokemonTypes';
import type { BattleLogEntry, ChargeMove, FastMove } from '../lib/types';

/** Where the fight stands after every action up to a turn. */
export interface Frame {
  hpA: number;
  hpB: number;
  energyA: number;
  energyB: number;
  shieldsA: number;
  shieldsB: number;
}

/**
 * The fight as of `turn`: the last logged action at or before it, with shields
 * counted down by each shielded hit. The log is in turn order, so this stops
 * at the first action past the turn.
 */
export function frameAt(log: BattleLogEntry[], turn: number, start: Frame): Frame {
  let f = start;
  for (const e of log) {
    if (e.turn > turn) break;
    f = {
      hpA: e.hpA,
      hpB: e.hpB,
      energyA: e.energyA,
      energyB: e.energyB,
      shieldsA: f.shieldsA - (e.shielded && e.actor === 'B' ? 1 : 0),
      shieldsB: f.shieldsB - (e.shielded && e.actor === 'A' ? 1 : 0),
    };
  }
  return f;
}

type Side = 'A' | 'B';
type MoveOf = (side: Side, name: string) => FastMove | ChargeMove | undefined;

/** One mark on a lane: an action, or a shield raised against the other side's. */
interface Mark {
  e: BattleLogEntry;
  shield: boolean;
}

const typeVar = (m: FastMove | ChargeMove | undefined): CSSProperties =>
  m && isPokemonType(m.type) ? ({ ['--type' as string]: `var(--type-${m.type})` } as CSSProperties) : {};

/**
 * PvPoke-style battle timeline: one lane per side, a square for each fast move
 * where it registers, a circle per charged move, a hexagon where a shield went
 * up. Pointing at it scrubs — the caller renders HP, energy and shields at the
 * previewed turn — and a press (or a drag, which is the only way a finger can
 * point) pins it there. Leaving drops the preview and returns to the pin.
 */
export function BattleTimeline({
  log,
  turn,
  onPreview,
  onPin,
  moveOf,
  maxHpA,
  maxHpB,
  nameA,
  nameB,
}: {
  log: BattleLogEntry[];
  /** The turn shown. */
  turn: number;
  onPreview: (turn: number | null) => void;
  onPin: (turn: number) => void;
  moveOf: MoveOf;
  maxHpA: number;
  maxHpB: number;
  nameA: string;
  nameB: string;
}) {
  const total = Math.max(1, log.length ? log[log.length - 1].turn : 1);
  const track = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ mark: Mark; side: Side } | null>(null);
  const lanes: Record<Side, Mark[]> = { A: [], B: [] };
  for (const e of log) {
    lanes[e.actor].push({ e, shield: false });
    if (e.shielded) lanes[e.actor === 'A' ? 'B' : 'A'].push({ e, shield: true });
  }
  const pct = (t: number) => `${(t / total) * 100}%`;

  const point = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const r = track.current!.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * total;
    // The lane under the pointer, then its nearest mark within a few pixels.
    const side: Side = ev.clientY < r.top + r.height / 2 ? 'A' : 'B';
    let best: Mark | null = null;
    let bestD = (8 / r.width) * total;
    for (const m of lanes[side]) {
      const d = Math.abs(m.e.turn - at);
      if (d <= bestD) [best, bestD] = [m, d];
    }
    setTip(best ? { mark: best, side } : null);
    return Math.round(at);
  };

  const tipText = (m: Mark, side: Side): string[] => {
    const { e } = m;
    const defenderMax = e.actor === 'A' ? maxHpB : maxHpA;
    const at = `${(e.turn * 0.5).toFixed(1)}s`;
    if (m.shield) return [`Shield · ${side === 'A' ? nameA : nameB}`, `blocks ${e.moveName}`, at];
    const mv = moveOf(e.actor, e.moveName);
    const lines = [e.moveName];
    lines.push(e.shielded ? `Shielded — 1 damage${e.bait ? ' (bait)' : ''}` : `${e.damage} damage (${((e.damage / defenderMax) * 100).toFixed(1)}%)`);
    if (mv) lines.push(e.kind === 'fast' ? `+${(mv as FastMove).energyGain} energy` : `−${(mv as ChargeMove).energy} energy`);
    if (e.buffText) lines.push(e.buffText);
    lines.push(at);
    return lines;
  };

  return (
    <div
      className="tl"
      role="slider"
      tabIndex={0}
      aria-label="Battle timeline"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={turn}
      aria-valuetext={`${(turn * 0.5).toFixed(1)} seconds`}
      onKeyDown={(ev) => {
        const step = { ArrowLeft: -1, ArrowRight: 1, Home: -total, End: total }[ev.key];
        if (step === undefined) return;
        ev.preventDefault();
        onPin(Math.max(0, Math.min(total, turn + step)));
      }}
      onPointerDown={(ev) => {
        ev.currentTarget.setPointerCapture(ev.pointerId);
        onPin(point(ev));
      }}
      onPointerMove={(ev) => {
        const t = point(ev);
        if (ev.currentTarget.hasPointerCapture(ev.pointerId)) onPin(t);
        else onPreview(t);
      }}
      onPointerLeave={() => {
        setTip(null);
        onPreview(null);
      }}
    >
      <div className="tl-track" ref={track}>
        {(['A', 'B'] as const).map((side) => (
          <div key={side} className={`tl-lane is-${side.toLowerCase()}`}>
            {lanes[side].map((m, i) =>
              m.shield ? (
                <span key={i} className="tl-shield" style={{ left: pct(m.e.turn) }} />
              ) : (
                <span
                  key={i}
                  className={`tl-ev is-${m.e.kind}${m.e.shielded ? ' is-shielded' : ''}${m.e.turn > turn ? ' is-future' : ''}`}
                  style={{ left: pct(m.e.turn), ...typeVar(moveOf(side, m.e.moveName)) }}
                />
              ),
            )}
          </div>
        ))}
        <span className="tl-cursor" style={{ left: pct(turn) }} aria-hidden="true" />
        {tip && (
          <div
            className={`tl-tip is-${tip.side.toLowerCase()}`}
            // Anchored to its mark, pulled inward near either end so it stays on the track.
            style={{ left: pct(tip.mark.e.turn), translate: `${-(tip.mark.e.turn / total) * 100}% 0` }}
          >
            {tipText(tip.mark, tip.side).map((l, i) => (i === 0 ? <b key={i}>{l}</b> : <span key={i}>{l}</span>))}
          </div>
        )}
      </div>
    </div>
  );
}
