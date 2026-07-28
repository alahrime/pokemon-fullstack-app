import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { spriteFallbackUrl, spriteUrl } from '../lib/data';

/**
 * Form-aware sprite.
 *
 * Takes a slug rather than a dex number. The old dex-only version rendered
 * every regional variant as its base form, because e.g. Alolan and Kantonian
 * Marowak are both dex 105.
 *
 * Slugs are generated mechanically (see scripts/build-data.mjs), so a handful
 * of rare forms - costume Pikachus especially - may not exist at the primary
 * source. Rather than ship a hole, we fall back to the dex-numbered image,
 * which is exactly what the app used before, then to a neutral placeholder.
 */
export function Sprite({
  sprite,
  dex,
  size,
  style,
  className,
  shadow = false,
}: {
  sprite: string;
  dex: number;
  size: number;
  style?: CSSProperties;
  className?: string;
  /** Draws the Shadow aura badge; artwork itself is shared with the base form. */
  shadow?: boolean;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  // A new slug gets a fresh attempt at the primary source.
  useEffect(() => setStage(0), [sprite, dex]);

  const src = stage === 0 ? spriteUrl(sprite) : stage === 1 ? spriteFallbackUrl(dex) : null;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flex: 'none',
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        ...style,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          onError={() => setStage((s) => (s < 2 ? ((s + 1) as 0 | 1 | 2) : s))}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: stage === 1 ? 'pixelated' : 'auto',
          }}
        />
      ) : (
        <span className="text-faint numeric" style={{ fontSize: Math.max(9, size * 0.22) }}>
          #{String(dex).padStart(3, '0')}
        </span>
      )}
      {shadow ? (
        <span
          aria-label="Shadow"
          title="Shadow"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(circle at 50% 55%, transparent 48%, color-mix(in srgb, var(--color-accent) 42%, transparent) 100%)',
            mixBlendMode: 'screen',
          }}
        />
      ) : null}
    </div>
  );
}
