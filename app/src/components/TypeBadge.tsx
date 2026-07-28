import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { isPokemonType, typeIconUrl } from '../lib/pokemonTypes';

/**
 * Pokémon type badge, using the icons from partywhale/pokemon-type-icons (MIT).
 *
 * Assets live in public/type-icons/ and are referenced by URL rather than
 * bundled, so a checkout without them still builds and runs — the badge just
 * falls back to text. See public/type-icons/README.md for how to fetch them.
 *
 * The glyphs are flat monochrome, and they need to take 18 different colours.
 * A CSS `filter` chain can't hit an arbitrary hue from black with any accuracy,
 * so they're rendered as a CSS mask over a solid background instead: the shape
 * comes from the SVG, the colour from `background-color`, exactly.
 *
 * A mask has no load event, so availability is probed once with a single
 * Image() and shared by every badge, rather than guessing per render.
 */

type Availability = 'probing' | 'present' | 'absent';

let cached: Availability = 'probing';
const listeners = new Set<(a: Availability) => void>();

function probeOnce() {
  if (cached !== 'probing' || typeof window === 'undefined') return;
  const img = new Image();
  const settle = (a: Availability) => {
    cached = a;
    listeners.forEach((fn) => fn(a));
  };
  img.onload = () => settle('present');
  img.onerror = () => settle('absent');
  img.src = typeIconUrl('normal');
}

/** True once we know the vendored icon set is actually served. */
function useTypeIcons(): boolean {
  const [state, setState] = useState<Availability>(cached);
  useEffect(() => {
    if (cached !== 'probing') {
      setState(cached);
      return;
    }
    listeners.add(setState);
    probeOnce();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state === 'present';
}

function glyphStyle(type: string, size: number): CSSProperties {
  const url = `url("${typeIconUrl(type)}")`;
  return {
    width: size,
    height: size,
    flex: 'none',
    display: 'block',
    backgroundColor: 'currentColor',
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
  };
}

export function TypeBadge({ type, style }: { type: string; style?: CSSProperties }) {
  const t = type.toLowerCase();
  const hasIcons = useTypeIcons();
  return (
    <span
      className="type-badge"
      // Unknown types fall back to the default text colour rather than an
      // undefined custom property. Shouldn't happen, but the data is generated.
      style={{ ...(isPokemonType(t) ? { ['--type' as string]: `var(--type-${t})` } : {}), ...style }}
      title={t}
    >
      {hasIcons && isPokemonType(t) ? <span aria-hidden style={glyphStyle(t, 12)} /> : null}
      {t}
    </span>
  );
}

/** Icon on its own, for dense rows where the label would be redundant. */
export function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  const t = type.toLowerCase();
  const hasIcons = useTypeIcons();
  if (!hasIcons || !isPokemonType(t)) return null;
  return (
    <span
      title={t}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        color: `var(--type-${t})`,
      }}
    >
      <span aria-hidden style={glyphStyle(t, size)} />
    </span>
  );
}
