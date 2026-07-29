import { useEffect, useRef, useState } from 'react';
import { chargeMoveStats, fastMoveCounts, fastMoveStats } from '../lib/engine';
import { isPokemonType, typeIconUrl } from '../lib/pokemonTypes';
import type { ChargeMove, FastMove, Species } from '../lib/types';

const MAX_CHARGES = 2;

/**
 * Fast and charged moves as full tiles rather than name chips.
 *
 * Every comparison a player makes here is a ratio — energy per turn decides
 * how fast you reach a charge move, damage per energy decides whether it was
 * worth reaching — and none of it was visible when these were bare names.
 *
 * Tiles are tinted and iconed by move type, reusing the vendored type icons
 * so a move's typing reads the same way the Pokémon's does.
 */

function typeStyle(type: string) {
  return isPokemonType(type) ? { ['--type' as string]: `var(--type-${type})` } : {};
}

function TypeMark({ type }: { type: string }) {
  if (!isPokemonType(type)) return null;
  return <img className="move-type" src={typeIconUrl(type)} alt="" aria-hidden loading="lazy" />;
}

/**
 * Explicit pick indicator.
 *
 * Tint alone wasn't carrying selection: every tile is already coloured by its
 * own type, so "selected" read as just a slightly stronger version of the same
 * hue. A dedicated control mark says it outright. Round for fast moves, which
 * are single-choice; square for charged, which are a pick-two.
 */
function PickMark({ on, shape }: { on: boolean; shape: 'radio' | 'check' }) {
  return (
    <span className={`move-pick move-pick-${shape}${on ? ' is-on' : ''}`} aria-hidden>
      {on ? (shape === 'check' ? '✓' : '') : ''}
    </span>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="move-stat">
      <span className={`move-stat-value numeric${strong ? ' is-strong' : ''}`}>{value}</span>
      <span className="move-stat-label">{label}</span>
    </div>
  );
}

function FastTile({ move, active, onClick }: { move: FastMove; active: boolean; onClick: () => void }) {
  const s = fastMoveStats(move);
  return (
    <button
      type="button"
      className={`move-tile${active ? ' is-active' : ''}`}
      style={typeStyle(move.type)}
      aria-pressed={active}
      onClick={onClick}
    >
      <div className="move-head">
        <PickMark on={active} shape="radio" />
        <TypeMark type={move.type} />
        <span className="move-name">{move.name}</span>
        {move.stab > 1 && <span className="move-flag">STAB</span>}
      </div>
      <div className="move-stats">
        <Stat label="dmg" value={s.damage.toFixed(0)} />
        <Stat label="energy" value={`+${s.energyGain}`} />
        <Stat label="turns" value={`${s.turns}`} />
      </div>
      <div className="move-stats move-stats-ratio">
        <Stat label="dmg/turn" value={s.dpt.toFixed(2)} strong />
        <Stat label="nrg/turn" value={s.ept.toFixed(2)} strong />
        <Stat label="seconds" value={s.seconds.toFixed(1)} />
      </div>
    </button>
  );
}

function ChargeTile({
  move,
  fast,
  active,
  onClick,
}: {
  move: ChargeMove;
  fast: FastMove;
  active: boolean;
  onClick: () => void;
}) {
  const s = chargeMoveStats(move);
  const counts = fastMoveCounts(fast, move);
  return (
    <button
      type="button"
      className={`move-tile${active ? ' is-active' : ''}`}
      style={typeStyle(move.type)}
      aria-pressed={active}
      onClick={onClick}
    >
      <div className="move-head">
        <PickMark on={active} shape="check" />
        <TypeMark type={move.type} />
        <span className="move-name">{move.name}</span>
        {move.stab > 1 && <span className="move-flag">STAB</span>}
        {move.archetype && <span className="move-arch">{move.archetype}</span>}
      </div>
      <div className="move-stats">
        <Stat label="dmg" value={s.damage.toFixed(0)} />
        <Stat label="energy" value={`${s.energy}`} />
        <Stat label="dmg/nrg" value={s.dpe.toFixed(2)} strong />
      </div>
      {/* Always rendered, even when the fast move generates no energy and there
          is nothing to count. Both tile types then have the same three-row
          skeleton — head, stats, footer — so their heights match because their
          structure matches, rather than because a fixed height forces it. */}
      <div
        className="move-counts"
        title={
          counts.length
            ? `Fast moves needed for each successive ${move.name}. Later throws start with leftover energy, so the count drifts down.`
            : `${fast.name} generates no energy, so it cannot charge this move.`
        }
      >
        <span className="move-counts-label">{counts.length ? `${fast.name} to charge` : 'no energy gain'}</span>
        <span className="move-counts-seq numeric">
          {counts.map((n, i) => (
            <span key={i} className="move-count">
              {n}
            </span>
          ))}
        </span>
      </div>
    </button>
  );
}

/**
 * Past this many options the grid stops being a grid and becomes a wall —
 * Smeargle learns 82 fast and 152 charged moves, Mew 14 and 25.
 *
 * Expanding those inline was the first attempt and it was worse: everything
 * below the panel jumped by hundreds of pixels, so the act of looking for a
 * move destroyed the layout you were reading. A picker overlays instead. The
 * equipped moves stay on show as tiles either way, so the panel is always the
 * same height and always answers "what am I running" without a click.
 *
 * Deliberately low. Anything past a handful of options is better browsed than
 * scanned, and the tiles are not the place to enumerate a movepool — they are
 * the place to show your loadout. So Poliwrath's 7 charged moves and Mew's 25
 * get the same treatment: the recommended pair as tiles, everything else a
 * click away.
 *
 * Fast trips one option sooner than charged because you equip one fast move
 * against two charged. Matching the numbers left the two halves lopsided —
 * Poliwrath has exactly 4 fast, so at a shared threshold of 4 it showed four
 * fast tiles beside two charged ones and a dropdown. Scaling each limit to how
 * many moves that slot actually holds keeps the columns balanced.
 */
const PICKER_THRESHOLD_FAST = 3;
const PICKER_THRESHOLD_CHARGE = 4;

/**
 * Searchable move list, rendered over the panel rather than inside it.
 *
 * Filters on name and type, so "fire" finds every Fire move and "punch" every
 * punching one.
 */
function MovePicker({
  count,
  moves,
  isActive,
  onPick,
}: {
  count: number;
  moves: (FastMove | ChargeMove)[];
  isActive: (m: FastMove | ChargeMove) => boolean;
  onPick: (m: FastMove | ChargeMove) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? moves.filter((m) => m.name.toLowerCase().includes(needle) || m.type?.toLowerCase().includes(needle))
    : moves;

  return (
    <div className="move-picker" ref={box}>
      <button type="button" className="move-picker-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{open ? 'Close' : `Browse all ${count}`}</span>
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="move-picker-panel" role="dialog" aria-label="Choose a move">
          <input
            className="input move-picker-input"
            autoFocus
            value={q}
            placeholder="Filter by name or type…"
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="move-picker-list">
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`move-picker-row${isActive(m) ? ' is-active' : ''}`}
                  onClick={() => onPick(m)}
                >
                  {isPokemonType(m.type) && <img src={typeIconUrl(m.type)} alt="" width={13} height={13} />}
                  <span className="move-picker-name">{m.name}</span>
                  <span className="numeric move-picker-stat">{m.power}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="move-picker-empty">No move matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MovesPanel({
  species,
  moveIdx,
  onMoveIdx,
  chargeIds,
  onChargeIds,
}: {
  species: Species;
  moveIdx: number;
  onMoveIdx: (i: number) => void;
  chargeIds: string[];
  onChargeIds: (ids: string[]) => void;
}) {
  const fast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const recommended = [species.chargeMove.id, species.chargeMove2?.id].filter(Boolean) as string[];
  const active = chargeIds.length ? chargeIds : recommended;
  const isDefault = chargeIds.length === 0;
  // Over the threshold only the equipped moves get tiles; the rest live in the
  // picker. Panel height then depends on how many you have equipped, not on
  // how many the species happens to learn.
  const fastMany = species.fastMoves.length > PICKER_THRESHOLD_FAST;
  const chargeMany = species.chargeMoves.length > PICKER_THRESHOLD_CHARGE;
  const fastTiles = fastMany ? species.fastMoves.filter((m) => m.id === fast.id) : species.fastMoves;
  const chargeTiles = chargeMany ? species.chargeMoves.filter((m) => active.includes(m.id)) : species.chargeMoves;

  const toggle = (id: string) => {
    if (active.includes(id)) {
      const next = active.filter((x) => x !== id);
      // Never leave the mon with nothing to throw.
      onChargeIds(next.length ? next : active);
      return;
    }
    // At the cap, drop the oldest pick so a click always does something.
    onChargeIds(active.length >= MAX_CHARGES ? [...active.slice(1), id] : [...active, id]);
  };

  return (
    <div className="moves-panel">
      <section className="moves-col">
        <div className="moves-head">
          <span className="hud-label" style={{ flex: 1 }}>
            <span>Fast</span>
          </span>
        </div>
        <div className="moves-grid">
          {fastTiles.map((m) => {
            const i = species.fastMoves.indexOf(m);
            return <FastTile key={m.id} move={m} active={moveIdx === i} onClick={() => onMoveIdx(i)} />;
          })}
        </div>
        {fastMany && (
          <MovePicker
            count={species.fastMoves.length}
            moves={species.fastMoves}
            isActive={(m) => m.id === fast.id}
            onPick={(m) => onMoveIdx(species.fastMoves.findIndex((x) => x.id === m.id))}
          />
        )}
      </section>

      <section className="moves-col">
        <div className="moves-head">
          <span className="hud-label" style={{ flex: 1 }}>
            <span>Charged · pick {MAX_CHARGES}</span>
          </span>
          {!isDefault && (
            <button className="btn btn-ghost" style={{ fontSize: 10 }} onClick={() => onChargeIds([])}>
              reset
            </button>
          )}
        </div>
        <div className="moves-grid">
          {chargeTiles.map((m) => (
            <ChargeTile key={m.id} move={m} fast={fast} active={active.includes(m.id)} onClick={() => toggle(m.id)} />
          ))}
        </div>
        {chargeMany && (
          <MovePicker
            count={species.chargeMoves.length}
            moves={species.chargeMoves}
            isActive={(m) => active.includes(m.id)}
            onPick={(m) => toggle(m.id)}
          />
        )}
      </section>
    </div>
  );
}
