import type { OpponentRelevance } from '../lib/engine';
import { Sprite } from './Sprite';

/**
 * Opponent picker as an auto-fitting grid rather than two long wrapping rows.
 *
 * Each cell carries the reason the matchup was selected, because the list is
 * no longer "the meta" - it's the set of opponents where your IV roll changes
 * the result, which is not self-evident from the name alone.
 */
export function OpponentGrid({
  items,
  activeId,
  onSelect,
}: {
  items: OpponentRelevance[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="stagger"
      style={{
        display: 'grid',
        // Auto-fit: one column on narrow screens, as many as fit on desktop.
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 6,
      }}
    >
      {items.map((r, i) => {
        const active = r.info.id === activeId;
        const flips = r.flipShields.length > 0;
        return (
          <button
            key={r.info.id}
            onClick={() => onSelect(r.info.id)}
            aria-pressed={active}
            title={r.reason || 'Selectable opponent'}
            className={`btn opp-cell${active ? ' is-active' : ''}`}
            style={{ ['--i' as string]: i }}
          >
            <Sprite sprite={r.info.sprite} dex={r.info.dex} size={30} shadow={r.info.shadow} />
            <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
              <span className="opp-name">{r.info.name}</span>
              <span className={`opp-reason${flips ? ' is-flip' : ''}`}>{r.reason || '—'}</span>
            </span>
            {flips ? (
              <span className="opp-flag" title={`Outcome flips at ${r.flipShields.join('/')} shields`}>
                {r.flipShields.join('')}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
