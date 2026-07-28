import type { Species } from '../lib/types';
import { ChipButton } from './Seg';

const MAX_CHARGES = 2;

/**
 * Charged-move selection across the full movepool.
 *
 * The generator emits every charged move a species can learn; previously only
 * PvPoke's recommended pair was reachable, which meant you couldn't model the
 * legacy or off-meta sets people actually run. Two is the in-game cap.
 *
 * An empty selection means "use the recommended pair", so existing state and
 * fresh species both behave sensibly without a migration.
 */
export function MovepoolPicker({
  species,
  selected,
  onChange,
}: {
  species: Species;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const pool = species.chargeMoves;
  const recommended = [species.chargeMove.id, species.chargeMove2?.id].filter(Boolean) as string[];
  const active = selected.length ? selected : recommended;
  const isDefault = selected.length === 0;

  const toggle = (id: string) => {
    if (active.includes(id)) {
      const next = active.filter((x) => x !== id);
      // Never leave the mon with nothing to throw.
      onChange(next.length ? next : active);
      return;
    }
    // At the cap, replace the oldest pick so a click always does something.
    onChange(active.length >= MAX_CHARGES ? [...active.slice(1), id] : [...active, id]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Charged moves
        </span>
        <span className="text-faint" style={{ fontSize: 11 }}>
          {pool.length} available · pick up to {MAX_CHARGES}
        </span>
        {!isDefault && (
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onChange([])}>
            Reset to recommended
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {pool.map((m) => (
          <ChipButton
            key={m.id}
            active={active.includes(m.id)}
            onClick={() => toggle(m.id)}
            title={`${m.power} power · ${m.energy} energy${m.stab > 1 ? ' · STAB' : ''}`}
          >
            {m.name}
            <span className="numeric" style={{ opacity: 0.6, marginLeft: 5, fontSize: 10 }}>
              {m.energy}e
            </span>
          </ChipButton>
        ))}
      </div>
    </div>
  );
}
