import type { ReactNode } from 'react';
import { speciesOf } from '../lib/data';
import { Sprite } from './Sprite';

/**
 * One Pokémon, big enough to recognise across the room: the sprite on a plate
 * lit by its own two type colours (`--t1`/`--t2`, the same pair `PokemonCard`
 * uses). Shared by every roster surface so a team reads the same on the offer
 * board, in a tournament and in a match record.
 */
export function MonTile({ refId, label, shadow = false, bestBuddy = false, size = 64, nameClass = '', className = '', children }: {
  refId: string; label: string; shadow?: boolean; bestBuddy?: boolean; size?: number; nameClass?: string; className?: string; children?: ReactNode;
}) {
  const s = speciesOf(refId);
  const t1 = s?.types[0];
  const t2 = s?.types[1] ?? t1;
  return (
    <div
      className={`mon-tile group grid min-w-0 justify-items-center gap-1 text-center ${className}`}
      style={t1 ? { ['--t1' as string]: `var(--type-${t1})`, ['--t2' as string]: `var(--type-${t2})` } : undefined}
    >
      <span
        className="relative grid place-items-center border border-[color-mix(in_srgb,var(--t1)_55%,var(--rule-strong))] p-1 shadow-[inset_0_-10px_18px_-12px_color-mix(in_srgb,var(--t2)_70%,transparent)] transition-[transform,border-color] duration-300 [background:radial-gradient(circle_at_50%_60%,color-mix(in_srgb,var(--t1)_38%,transparent),transparent_68%),linear-gradient(160deg,color-mix(in_srgb,var(--t1)_20%,transparent),color-mix(in_srgb,var(--t2)_14%,transparent)_70%),var(--surface-1)] [clip-path:polygon(9px_0,100%_0,100%_calc(100%-9px),calc(100%-9px)_100%,0_100%,0_9px)] group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:border-[var(--t1)] motion-reduce:transition-none"
      >
        {s ? <Sprite sprite={s.sprite} dex={s.dex} size={size} shadow={shadow} bestBuddy={bestBuddy} /> : <span className="text-faint">?</span>}
      </span>
      <span className={`text-[11px] leading-[1.15] font-semibold [overflow-wrap:anywhere] ${nameClass}`}>{label}</span>
      {children}
    </div>
  );
}
