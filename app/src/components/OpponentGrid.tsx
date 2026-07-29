import { useEffect, useRef, useState } from 'react';
import type { OpponentRelevance } from '../lib/engine';
import { Sprite } from './Sprite';

/**
 * Opponent picker as an auto-fitting grid.
 *
 * The list is no longer "the meta" — it's the set of opponents where your IV
 * roll changes the result — so each cell carries the reason it was selected,
 * which isn't inferable from the name.
 *
 * The relevance scan finds far more decidable matchups than fit on screen, so
 * the surplus is shown over *time* instead of being truncated away: with
 * rotation on, the board advances one row every interval, oldest out and next
 * in, the way a departures board cycles. Off by default — auto-advancing
 * content shouldn't be forced on anyone — and the whole thing pauses on hover
 * or focus so a cell can't slide out from under the pointer.
 */

export const ROTATE_MS = 11000;

export function OpponentGrid({
  items,
  windowSize,
  total,
  activeId,
  rotating,
  onToggleRotate,
  onSelect,
}: {
  items: OpponentRelevance[];
  windowSize: number;
  total: number;
  activeId: string;
  rotating: boolean;
  onToggleRotate: (on: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  // Rows that weren't in the previous render get the enter animation; without
  // this every cell would re-animate whenever any prop changed.
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const now = new Set(items.map((i) => i.info.id));
    const added = new Set([...now].filter((id) => !seen.current.has(id)));
    seen.current = now;
    // First paint shouldn't cascade — only genuine arrivals animate.
    setFresh(added.size === now.size ? new Set() : added);
  }, [items]);

  const showing = Math.min(windowSize, total);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="opp-bar">
        <span className="hud-label" style={{ flex: 1 }}>
          <span>Matchups where your roll decides it</span>
        </span>
        <span className="opp-count numeric" title="Decidable matchups found by the relevance scan">
          {showing} / {total}
        </span>
        <button
          type="button"
          className={`btn chip-btn opp-rotate${rotating ? ' is-active' : ''}`}
          aria-pressed={rotating}
          onClick={() => onToggleRotate(!rotating)}
          title={
            rotating
              ? 'Stop cycling through the remaining matchups'
              : `Cycle one row every ${Math.round(ROTATE_MS / 1000)}s through all ${total}`
          }
        >
          <span className={`opp-rotate-dot${rotating && !paused ? ' is-live' : ''}`} aria-hidden />
          {rotating ? (paused ? 'Paused' : 'Rotating') : 'Rotate'}
        </button>
      </div>

      {rotating && (
        <div className="opp-progress" aria-hidden>
          <span
            className="opp-progress-fill"
            // Restarting the animation on each advance keeps the bar in step
            // with the interval rather than drifting from it.
            key={items[0]?.info.id ?? 'none'}
            style={{ animationDuration: `${ROTATE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
          />
        </div>
      )}

      <div className="opp-board">
        {items.map((r, i) => {
          const active = r.info.id === activeId;
          const flips = r.flipShields.length > 0;
          return (
            <button
              key={r.info.id}
              onClick={() => onSelect(r.info.id)}
              aria-pressed={active}
              title={r.reason || 'Selectable opponent'}
              className={`btn opp-cell${active ? ' is-active' : ''}${fresh.has(r.info.id) ? ' is-arriving' : ''}`}
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
    </div>
  );
}
