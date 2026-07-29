import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { spriteFallbackUrl, spriteUrl } from '../lib/data';
import { BestBuddyRibbon } from './BestBuddyRibbon';

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
  bestBuddy = false,
}: {
  sprite: string;
  dex: number;
  size: number;
  style?: CSSProperties;
  className?: string;
  /** Draws the Shadow aura badge; artwork itself is shared with the base form. */
  shadow?: boolean;
  /** Corner ribbon marking a spread that only a Best Buddy boost can reach. */
  bestBuddy?: boolean;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  // A new slug gets a fresh attempt at the primary source.
  useEffect(() => setStage(0), [sprite, dex]);

  const src = stage === 0 ? spriteUrl(sprite) : stage === 1 ? spriteFallbackUrl(dex) : null;

  // Below ~40px the full corona just smears, so small sprites get a tighter,
  // unanimated variant.
  const shadowClass = shadow ? ` sprite-shadow${size < 40 ? ' is-small' : ''}` : '';

  return (
    <div
      className={`${className ?? ''}${shadowClass}`}
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

      {/* Pinned off the bottom-right corner. Sat mostly *on* the artwork at a
          smaller offset; hanging it further out keeps the sprite readable and
          reads as a tag attached to the frame rather than part of the render.
          Always the full rosette, at every size and in every control, so the
          mark is recognisably one thing wherever it appears — a lone gold disc
          reads as a different badge entirely. */}
      {bestBuddy && (
        <span
          style={{
            position: 'absolute',
            right: -size * 0.2,
            bottom: -size * 0.14,
            lineHeight: 0,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.45))',
          }}
        >
          <BestBuddyRibbon size={Math.max(15, Math.round(size * 0.4))} detail />
        </span>
      )}
    </div>
  );
}
