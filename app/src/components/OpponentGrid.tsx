import type { OpponentRelevance } from '../lib/engine';
import { Sprite } from './Sprite';

/**
 * Opponent picker as an auto-fitting grid.
 *
 * The list isn't "the meta" — it's the set of opponents where your IV roll
 * changes the result — so each cell carries the reason it was selected, which
 * isn't inferable from the name.
 *
 * The relevance scan finds far more decidable matchups than fit on screen
 * (48 against 16 cells), so the surplus is paged rather than truncated. An
 * earlier pass auto-rotated the board on a timer; paging replaced it because
 * movement you didn't ask for competes with the numbers for attention, and
 * these are numbers people read carefully.
 */

/** Beyond this many pages, dots stop being a usable control. */
const MAX_DOTS = 12;

export function OpponentGrid({
  items,
  page,
  pageCount,
  total,
  activeId,
  sortLabel,
  sortDesc,
  onSort,
  onPage,
  onSelect,
}: {
  items: OpponentRelevance[];
  page: number;
  pageCount: number;
  total: number;
  activeId: string;
  sortLabel: string;
  sortDesc: boolean;
  onSort: (desc: boolean) => void;
  onPage: (page: number) => void;
  onSelect: (id: string) => void;
}) {
  const first = page * items.length;

  return (
    <div>
      <div className="opp-bar">
        <span className="hud-label" style={{ flex: 1 }}>
          <span>Matchups where your roll decides it</span>
        </span>

        <button
          type="button"
          className="btn chip-btn opp-sort"
          onClick={() => onSort(!sortDesc)}
          title={`Sorted by ${sortLabel}, ${sortDesc ? 'highest' : 'lowest'} first — click to reverse`}
        >
          <span className="opp-sort-arrow" aria-hidden>
            {sortDesc ? '▼' : '▲'}
          </span>
          {sortLabel}
        </button>
      </div>

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
              className={`btn opp-cell${active ? ' is-active' : ''}`}
              style={{ ['--i' as string]: i }}
            >
              <Sprite sprite={r.info.sprite} dex={r.info.dex} size={30} shadow={r.info.shadow} bestBuddy={r.info.lvl > 50} />
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

      {pageCount > 1 && (
        <div className="opp-pager">
          <button
            type="button"
            className="btn chip-btn opp-page-step"
            onClick={() => onPage(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
          >
            ‹
          </button>

          {/* Dots only while they stay countable. The CP-based pool runs to
              several hundred matchups — 50-odd dots is a smear, not a control —
              so past the threshold it becomes a numeric readout with a slider. */}
          {pageCount <= MAX_DOTS ? (
            <span className="opp-dots">
              {Array.from({ length: pageCount }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`opp-dot${i === page ? ' is-on' : ''}`}
                  onClick={() => onPage(i)}
                  aria-label={`Page ${i + 1}`}
                  aria-current={i === page}
                />
              ))}
            </span>
          ) : (
            <>
              <input
                className="opp-page-range"
                type="range"
                min={0}
                max={pageCount - 1}
                step={1}
                value={page}
                onChange={(e) => onPage(Number(e.target.value))}
                aria-label="Page"
              />
              <span className="opp-page-num numeric">
                {page + 1} / {pageCount}
              </span>
            </>
          )}

          <button
            type="button"
            className="btn chip-btn opp-page-step"
            onClick={() => onPage(page + 1)}
            disabled={page === pageCount - 1}
            aria-label="Next page"
          >
            ›
          </button>

          <span className="opp-count numeric">
            {first + 1}–{Math.min(first + items.length, total)} of {total}
          </span>
        </div>
      )}

    </div>
  );
}
