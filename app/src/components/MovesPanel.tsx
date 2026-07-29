import { useEffect, useState } from 'react';
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
      {counts.length > 0 && (
        <div
          className="move-counts"
          title={`Fast moves needed for each successive ${move.name}. Later throws start with leftover energy, so the count drifts down.`}
        >
          <span className="move-counts-label">{fast.name} to charge</span>
          <span className="move-counts-seq numeric">
            {counts.map((n, i) => (
              <span key={i} className="move-count">
                {n}
              </span>
            ))}
          </span>
        </div>
      )}
    </button>
  );
}

/**
 * Above this many tiles a movepool stops being scannable and starts being a
 * wall. Median is 2 fast and 4 charged, so these thresholds leave the vast
 * majority untouched and catch only the genuinely overloaded: Mew at 14/25,
 * and Smeargle, which learns 82 fast and 152 charged moves.
 *
 * Selected moves are always shown regardless — collapsing your own pick out of
 * sight would be worse than the wall.
 */
const COLLAPSE_FAST = 6;
const COLLAPSE_CHARGE = 8;

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
  const [showAllFast, setShowAllFast] = useState(false);
  const [showAllCharge, setShowAllCharge] = useState(false);

  // A new species resets both, so picking Smeargle after Mew does not inherit
  // an expanded list of 152 tiles.
  useEffect(() => {
    setShowAllFast(false);
    setShowAllCharge(false);
  }, [species.id]);

  /** Trim to a limit, but never hide something currently selected. */
  const trim = <T extends { id: string }>(all: T[], limit: number, keep: (m: T) => boolean, expanded: boolean) => {
    if (expanded || all.length <= limit) return { shown: all, hidden: 0 };
    const picked = all.filter(keep);
    const rest = all.filter((m) => !keep(m)).slice(0, Math.max(0, limit - picked.length));
    const shown = all.filter((m) => picked.includes(m) || rest.includes(m));
    return { shown, hidden: all.length - shown.length };
  };

  const fastView = trim(species.fastMoves, COLLAPSE_FAST, (m) => m.id === fast.id, showAllFast);
  const chargeView = trim(species.chargeMoves, COLLAPSE_CHARGE, (m) => active.includes(m.id), showAllCharge);

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
          {fastView.shown.map((m) => {
            const i = species.fastMoves.indexOf(m);
            return <FastTile key={m.id} move={m} active={moveIdx === i} onClick={() => onMoveIdx(i)} />;
          })}
        </div>
        {(fastView.hidden > 0 || showAllFast) && (
          <button type="button" className="moves-more" onClick={() => setShowAllFast((v) => !v)}>
            {showAllFast ? `Show fewer — ${species.fastMoves.length} fast moves` : `+${fastView.hidden} more fast moves`}
          </button>
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
          {chargeView.shown.map((m) => (
            <ChargeTile key={m.id} move={m} fast={fast} active={active.includes(m.id)} onClick={() => toggle(m.id)} />
          ))}
        </div>
        {(chargeView.hidden > 0 || showAllCharge) && (
          <button type="button" className="moves-more" onClick={() => setShowAllCharge((v) => !v)}>
            {showAllCharge
              ? `Show fewer — ${species.chargeMoves.length} charged moves`
              : `+${chargeView.hidden} more charged moves`}
          </button>
        )}
      </section>
    </div>
  );
}
