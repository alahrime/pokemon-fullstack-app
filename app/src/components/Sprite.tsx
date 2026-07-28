import type { CSSProperties } from 'react';
import { spriteUrl } from '../lib/data';

export function Sprite({
  dex,
  size,
  style,
  className,
}: {
  dex: number;
  size: number;
  style?: CSSProperties;
  /** Pass `sprite-holo` to pick up the HUD theme's hologram glow. */
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flex: 'none',
        backgroundImage: `url(${spriteUrl(dex)})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
}
