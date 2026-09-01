import { POKEMON_TYPES } from '../lib/pokemonTypes';
import { toggleType, typesOn, type Format } from '../rules';
import { TypeBadge } from './TypeBadge';

interface Props {
  format: Format;
  onChange: (next: Format) => void;
}

/**
 * The eighteen types, as switches.
 *
 * Switching one on adds every ref of that type to the format; switching it off
 * takes them out again. The type stays *live* — it means "Water", not "the
 * Water species that existed the day you clicked" — so a Water Pokemon added to
 * the game later joins formats that allow the type. That is the spec's rule for
 * semantic categories, and it is why the chips write a bare type selector
 * rather than expanding to a list of names.
 */
export function TypeFilterRow({ format, onChange }: Props) {
  const on = typesOn(format);

  return (
    <div className="type-filter-row" role="group" aria-label="Filter by type">
      {POKEMON_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          data-testid="type-chip"
          className={`btn chip-btn type-chip${on.has(t) ? ' is-active' : ''}`}
          aria-pressed={on.has(t)}
          aria-label={t}
          onClick={() => onChange(toggleType(format, t))}
        >
          <TypeBadge type={t} />
        </button>
      ))}
    </div>
  );
}
