import type { Species } from '../lib/types';
import { ChipButton } from './Seg';

const MAX_CHARGES = 2;

/**
 * Fast and charged moves in one panel.
 *
 * These were two separate stacked rows — a fast-move chip strip and a
 * standalone movepool picker — which between them ate a lot of vertical space
 * for what is one decision: the loadout. Side by side in an auto-fitting grid,
 * they collapse to a single row on desktop and stack only when narrow.
 *
 * An empty charged selection means "PvPoke's recommended pair", so state that
 * predates movepool selection, or carried over from another species, still
 * resolves to a valid moveset.
 */
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
  const pool = species.chargeMoves;
  const recommended = [species.chargeMove.id, species.chargeMove2?.id].filter(Boolean) as string[];
  const active = chargeIds.length ? chargeIds : recommended;
  const isDefault = chargeIds.length === 0;

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
          {species.fastMoves.map((m, i) => (
            <ChipButton
              key={m.id}
              active={moveIdx === i}
              onClick={() => onMoveIdx(i)}
              title={`${m.power} power · ${m.energyGain}e gain · ${m.turns} turn${m.turns > 1 ? 's' : ''}${m.stab > 1 ? ' · STAB' : ''}`}
            >
              <span className="moves-name">{m.name}</span>
              <span className="moves-meta numeric">{m.turns}t</span>
            </ChipButton>
          ))}
        </div>
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
          {pool.map((m) => (
            <ChipButton
              key={m.id}
              active={active.includes(m.id)}
              onClick={() => toggle(m.id)}
              title={`${m.power} power · ${m.energy} energy${m.stab > 1 ? ' · STAB' : ''}`}
            >
              <span className="moves-name">{m.name}</span>
              <span className="moves-meta numeric">{m.energy}e</span>
            </ChipButton>
          ))}
        </div>
      </section>
    </div>
  );
}
