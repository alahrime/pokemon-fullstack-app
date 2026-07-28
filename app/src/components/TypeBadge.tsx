import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { isPokemonType, typeIconUrl } from '../lib/pokemonTypes';

/**
 * Pokémon type badge, using the icons from partywhale/pokemon-type-icons (MIT).
 *
 * Assets live in public/type-icons/ and are referenced by URL rather than
 * bundled, so a checkout without them still builds and runs — the badge just
 * falls back to text. See public/type-icons/README.md.
 *
 * These are full-colour icons: each SVG is a type-coloured disc with a white
 * glyph on top. So they render as plain <img> — no mask, no tint. An earlier
 * pass assumed monochrome glyphs and masked them, which would have flattened
 * every icon into a solid circle. The badge tint in styles/types.css is taken
 * from the disc fills in these very files, so the two can't drift.
 */

function TypeGlyph({ type, className, size }: { type: string; className: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  // Retry the source when the type changes; a previous failure shouldn't
  // permanently blank a badge that later renders a different type.
  useEffect(() => setFailed(false), [type]);
  if (failed) return null;
  return (
    <img
      src={typeIconUrl(type)}
      alt=""
      aria-hidden
      loading="lazy"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      onError={() => setFailed(true)}
    />
  );
}

export function TypeBadge({ type, style }: { type: string; style?: CSSProperties }) {
  const t = type.toLowerCase();
  const known = isPokemonType(t);
  return (
    <span
      className="type-badge"
      // Unknown types fall back to the default text colour rather than an
      // undefined custom property. Shouldn't happen, but the data is generated.
      style={{ ...(known ? { ['--type' as string]: `var(--type-${t})` } : {}), ...style }}
      title={t}
    >
      {known ? <TypeGlyph type={t} className="" /> : null}
      {t}
    </span>
  );
}

/** Icon on its own, for dense rows where the label would be redundant. */
export function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  const t = type.toLowerCase();
  if (!isPokemonType(t)) return null;
  return (
    <span title={t} style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size }}>
      <TypeGlyph type={t} className="type-icon" size={size} />
    </span>
  );
}
