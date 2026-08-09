import type { OpponentRelevance } from '../lib/engine';
import { Sprite } from './Sprite';
import { Pager } from './Pager';
import { SwordIcon } from './Icons';

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
  pageSize,
  onPageSize,
  onSelect,
  onBattle,
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
  pageSize: number;
  onPageSize: (n: number) => void;
  onSelect: (id: string) => void;
  /** Open this matchup in the simulator. */
  onBattle: (id: string) => void;
}) {
  return (
    <div>
      <div className="opp-bar">
        <span className="hud-label flex-1">
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

      {/* One pager only, above the board. The board is a few rows tall — its
          foot is on screen alongside its head, so a second copy below would be
          two controls visible at once doing the same job. */}
      <Pager
        page={page}
        pages={pageCount}
        total={total}
        size={pageSize}
        onPage={onPage}
        onSize={onPageSize}
        unit="matchups"
        className="pager-top"
      />

      <div className="opp-board">
        {items.map((r, i) => {
          const active = r.info.id === activeId;
          const flips = r.flipShields.length > 0;
          return (
            /* The cell is a button, so the fight action cannot nest inside it —
               it sits alongside, over the cell's own corner. */
            <span className="opp-cell-wrap" key={r.info.id} style={{ ['--i' as string]: i }}>
            <button
              onClick={() => onSelect(r.info.id)}
              aria-pressed={active}
              title={r.reason || 'Selectable opponent'}
              className={`btn opp-cell${active ? ' is-active' : ''}`}
            >
              <Sprite sprite={r.info.sprite} dex={r.info.dex} size={30} shadow={r.info.shadow} bestBuddy={r.info.lvl > 50} />
              <span className="opp-cell-body">
                <span className="opp-name">{r.info.name}</span>
                <span className={`opp-reason${flips ? ' is-flip' : ''}`}>{r.reason || '—'}</span>
              </span>
              {flips ? (
                <span className="opp-flag" title={`Outcome flips at ${r.flipShields.join('/')} shields`}>
                  {r.flipShields.join('')}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="opp-fight"
              title={`Simulate this matchup against ${r.info.name}`}
              aria-label={`Battle ${r.info.name}`}
              onClick={() => onBattle(r.info.id)}
            >
              <SwordIcon size={13} />
            </button>
            </span>
          );
        })}
      </div>

    </div>
  );
}
