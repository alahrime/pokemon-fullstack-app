import type { CSSProperties } from 'react';
import { spriteUrl } from '../lib/data';

export function Sprite({ dex, size, style }: { dex: number; size: number; style?: CSSProperties }) {
  return (
    <div
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
