import { useMemo } from 'react';

/**
 * One pager for every paged list in the app.
 *
 * There were three, all hand-rolled and all the same shape: a previous arrow,
 * "3 / 46", a next arrow. That is a control you can only walk. Reaching page
 * 40 of the rankings took forty clicks, and the only way to see more than 25
 * rows at a time was to not want to.
 *
 * So: numbered pages you can jump to, a size control, and a readout of what
 * the window is currently showing. It renders above the list as well as below
 * — a control that only exists at the bottom of a 25-row table asks you to
 * scroll past everything you were reading to change what you are reading.
 */

/** How many numbered buttons to show around the current page. */
const WINDOW = 2;

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The page numbers to draw, with gaps marked.
 *
 * Always the first and last page, plus a window around the current one, so the
 * control keeps a fixed width whatever the page count — 46 pages of rankings
 * would otherwise be 46 buttons, which is a smear rather than a control.
 * `null` is a gap.
 */
export function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 1) return [0];
  const wanted = new Set<number>([0, pages - 1]);
  for (let i = page - WINDOW; i <= page + WINDOW; i++) if (i >= 0 && i < pages) wanted.add(i);
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    // A gap of exactly one is worth spelling out — an ellipsis hiding a single
    // page is wider than the page it hides.
    if (i > 0 && n - sorted[i - 1] === 2) out.push(sorted[i - 1] + 1);
    else if (i > 0 && n - sorted[i - 1] > 2) out.push(null);
    out.push(n);
  });
  return out;
}

export function Pager({
  page,
  pages,
  total,
  size,
  onPage,
  onSize,
  unit = 'rows',
  className,
}: {
  page: number;
  pages: number;
  total: number;
  /** Rows per page. Omit `onSize` to hide the size control. */
  size: number;
  onPage: (n: number) => void;
  onSize?: (n: number) => void;
  /** What is being counted, for the readout: "rows", "teams", "matchups". */
  unit?: string;
  className?: string;
}) {
  const numbers = useMemo(() => pageList(page, pages), [page, pages]);
  // A caller may start at a size of its own — the opponent board opens at 16,
  // which suits its grid. Without this the select has no matching option and
  // renders the first one, so the control sits there claiming 10 while 16 rows
  // are on screen.
  const sizes = useMemo(
    () => (PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number])
      ? [...PAGE_SIZES]
      : [...PAGE_SIZES, size].sort((a, b) => a - b)),
    [size],
  );
  if (pages <= 1 && !onSize) return null;
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);

  return (
    <nav className={`pager${className ? ' ' + className : ''}`} aria-label="Pagination">
      <div className="pager-steps">
        <button
          type="button"
          className="btn pager-step"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          ‹
        </button>

        <ol className="pager-nums">
          {numbers.map((n, i) =>
            n === null ? (
              <li key={`gap-${i}`} className="pager-gap" aria-hidden="true">
                ···
              </li>
            ) : (
              <li key={n}>
                <button
                  type="button"
                  className={`pager-num${n === page ? ' is-on' : ''}`}
                  onClick={() => onPage(n)}
                  aria-current={n === page ? 'page' : undefined}
                  aria-label={`Page ${n + 1}`}
                >
                  {n + 1}
                </button>
              </li>
            ),
          )}
        </ol>

        <button
          type="button"
          className="btn pager-step"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages - 1}
          aria-label="Next page"
        >
          ›
        </button>
      </div>

      <span className="numeric pager-range">
        {from}–{to} <i>of</i> {total.toLocaleString()} {unit}
      </span>

      {onSize && (
        <label className="pager-size">
          <span className="hud-label">Per page</span>
          <select
            className="pager-size-input numeric"
            value={size}
            onChange={(e) => onSize(Number(e.target.value))}
          >
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
