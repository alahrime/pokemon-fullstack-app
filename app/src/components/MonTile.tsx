import type { ReactNode } from 'react';
import { speciesOf } from '../lib/data';
import { Sprite } from './Sprite';

/**
 * One Pokémon, big enough to recognise across the room: the sprite on a plate
 * lit by its own two type colours (`--t1`/`--t2`, the same pair `PokemonCard`
 * uses). Shared by every roster surface so a team reads the same on the offer
 * board, in a tournament and in a match record.
 */
export function MonTile({ refId, label, shadow = false, bestBuddy = false, size = 64, nameClass = '', children }: {
  refId: string; label: string; shadow?: boolean; bestBuddy?: boolean; size?: number; nameClass?: string; children?: ReactNode;
}) {
  const s = speciesOf(refId);
  const t1 = s?.types[0];
  const t2 = s?.types[1] ?? t1;
  return (
    <div
      className="mon-tile"
      style={t1 ? { ['--t1' as string]: `var(--type-${t1})`, ['--t2' as string]: `var(--type-${t2})` } : undefined}
    >
      <span className="mon-tile-plate">
        {s ? <Sprite sprite={s.sprite} dex={s.dex} size={size} shadow={shadow} bestBuddy={bestBuddy} /> : <span className="text-faint">?</span>}
      </span>
      <span className={`mon-tile-name ${nameClass}`}>{label}</span>
      {children}
    </div>
  );
}
