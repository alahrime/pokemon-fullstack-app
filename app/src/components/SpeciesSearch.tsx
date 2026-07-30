import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BASE_ROSTER, ROSTER, SPECIES, displayName, type RosterEntry } from '../lib/data';
import { compileQuery } from '../lib/query';
import { SearchHelp } from './SearchHelp';
import { HeldOutNote } from './HeldOutNote';
import { Sprite } from './Sprite';
import { TypeIcon } from './TypeBadge';

/**
 * Plain <li> rows, no virtualisation, inside a scroll box — 250 is comfortably
 * within what the DOM handles and deep enough that scrolling replaces
 * re-typing. The old 40 truncated common searches: "shadow" alone matches
 * hundreds.
 */
const RESULT_LIMIT = 250;

/**
 * Windowing constants.
 *
 * Every row is exactly ROW_H tall — same sprite size, same single line of text
 * — which is what makes the simple version of this correct. A variable-height
 * list would need measurement; this one does not, so the whole thing is two
 * numbers and a slice.
 *
 * OVERSCAN rows are rendered beyond each edge so a fast scroll or a held arrow
 * key does not reach blank space before React re-renders.
 */
const ROW_H = 36;
const LIST_H = 420;
const OVERSCAN = 6;
const DEBOUNCE_MS = 120;

/**
 * Ranked match over the full ~1100-entry roster.
 *
 * A plain `includes` was fine for 139 curated names but is bad at this size:
 * typing "mar" put "Altamarine"-style substring hits above "Marowak". So hits
 * are scored - exact, then prefix, then word-start, then substring - and a
 * bare number matches the Pokédex entry, which is how people search forms
 * ("105" surfaces both Marowaks side by side).
 */
/** Best rank this species holds in any league; unranked sorts last. */
function bestRankOf(e: RosterEntry): number {
  const r = e.species.leagueRank;
  const ranks = [r.great, r.ultra, r.master].filter((n): n is number => n !== undefined);
  return ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
}

function score(entry: RosterEntry, q: string): number {
  const name = entry.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  // word-start, e.g. "alolan" matching "Marowak (Alolan)"
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) return 2;
  if (name.includes(q)) return 3;
  if (String(entry.species.dex) === q) return 1;
  return -1;
}

export function SpeciesSearch({
  value,
  onChange,
  placeholder = 'Search species…',
  className,
  id,
  style,
  /** Include Shadow variants as their own rows (battle screen picks sides). */
  includeShadow = false,
  /**
   * Limit selectable refs. The team builders pass their league's candidate
   * pool: offering Zacian in Great is not a filter preference, it is an answer
   * to a question nobody asked.
   */
  restrictTo,
}: {
  value: string;
  onChange: (ref: string) => void;
  placeholder?: string;
  id: string;
  style?: CSSProperties;
  className?: string;
  includeShadow?: boolean;
  restrictTo?: ReadonlySet<string>;
}) {
  const base = includeShadow ? ROSTER : BASE_ROSTER;
  const pool = useMemo(
    () => (restrictTo ? base.filter((r) => restrictTo.has(r.ref)) : base),
    [base, restrictTo],
  );
  const selectedName = displayName(value);
  const [text, setText] = useState(selectedName);
  const [debounced, setDebounced] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (!open) setText(selectedName);
  }, [selectedName, open]);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [text]);

  /**
   * What to show before anything is typed.
   *
   * Was pool.slice(0, 40) — the roster is dex-ordered, so opening the box
   * offered Bulbasaur through Wigglytuff and nothing else. Dex number says
   * nothing about whether a species is worth picking.
   *
   * Ordered by best league rank instead, so the list opens on Pokemon that are
   * actually played, best first, with unranked forms after them. Sorted once at
   * module scope rather than per keystroke.
   */
  const defaults = useMemo(() => {
    return pool
      .slice()
      .sort((x, y) => bestRankOf(x) - bestRankOf(y) || x.species.dex - y.species.dex || x.name.localeCompare(y.name))
      .slice(0, RESULT_LIMIT);
  }, [pool]);

  const results = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return defaults;
    const term = compileQuery(q, SPECIES);
    if (!term) return defaults;

    // Filter by the query, then order by name relevance where the query reads
    // as a name and by league rank otherwise. A structural query ("water",
    // "@counter") has no meaningful name score, so ranking it by how well the
    // text matched would be noise — what you want there is the best matches
    // first.
    const scored: { e: RosterEntry; s: number; r: number }[] = [];
    for (const e of pool) {
      if (!term(e.species)) continue;
      const nameScore = score(e, q);
      scored.push({ e, s: nameScore >= 0 ? nameScore : 9, r: bestRankOf(e) });
    }
    scored.sort((a, b) => a.s - b.s || a.r - b.r || a.e.species.dex - b.e.species.dex || a.e.name.localeCompare(b.e.name));
    return scored.slice(0, RESULT_LIMIT).map((x) => x.e);
  }, [debounced, pool, defaults]);

  // Only the rows on screen are rendered. "water" matches 153 species and the
  // box shows twelve, so the other 141 were mounting three images each purely
  // to be scrolled past. Rows are a fixed height, so the window is arithmetic
  // rather than measurement, and the scrollbar stays honest because the list
  // keeps its full height in padding.
  const [scrollTop, setScrollTop] = useState(0);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(results.length, Math.ceil((scrollTop + LIST_H) / ROW_H) + OVERSCAN);
  const windowed = results.slice(first, last);

  // A new query resets the scroll, or the window would open part-way down a
  // list that no longer has those rows.
  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [debounced]);

  // Keep the highlighted row in view when arrowing through a long list.
  // Computed from the index rather than found in the DOM: the element may not
  // be rendered yet, which is exactly when it needs scrolling to.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = activeIndex * ROW_H;
    let next = el.scrollTop;
    if (top < next) next = top;
    else if (top + ROW_H > next + el.clientHeight) next = top + ROW_H - el.clientHeight;
    if (next === el.scrollTop) return;
    el.scrollTop = next;
    // Update the window here rather than waiting for the scroll event to come
    // back. Arrowing past the edge moved the box but left the state behind, so
    // the active row scrolled into view without ever being rendered — the
    // listbox reported an active option that was not in the DOM.
    setScrollTop(next);
  }, [activeIndex]);

  const commit = (ref: string) => {
    onChange(ref);
    setOpen(false);
    setText(displayName(ref));
  };

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <span className="nav-search-glyph" aria-hidden>
        ⌕
      </span>
      <input
        ref={inputRef}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-label={placeholder}
        aria-activedescendant={open && results[activeIndex] ? `${id}-opt-${results[activeIndex].ref}` : undefined}
        placeholder={placeholder}
        value={text}
        onFocus={() => {
          setOpen(true);
          setActiveIndex(0);
          inputRef.current?.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && results[activeIndex]) commit(results[activeIndex].ref);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setText(selectedName);
          }
        }}
        onBlur={() => {
          setOpen(false);
          setText(selectedName);
        }}
      />
      {/* One positioned panel holding the list and the held-out note. The note
          used to sit outside it in normal flow, which put it directly under the
          input and *above* the absolutely-positioned list — reading as a header
          rather than a footnote. Inside the panel it sits at the foot of the
          surface it annotates. */}
      {open && results.length > 0 && (
        <div className="search-dropdown">
        {/* The scroll box is this wrapper, not the list. Padding on the list
            would sit outside its own max-height and the box would grow to the
            full 5,500px instead of clipping at 420. */}
        <div
          ref={listRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          style={{ maxHeight: LIST_H, overflowY: 'auto' }}
        >
        <ul
          id={listboxId}
          role="listbox"
          style={{
            margin: 0,
            listStyle: 'none',
            // The rows not rendered still occupy their space, so the scrollbar
            // and scroll position match the full result set.
            paddingTop: first * ROW_H,
            paddingBottom: Math.max(0, (results.length - last) * ROW_H),
          }}
        >
          {windowed.map((r, wi) => {
            const i = first + wi;
            return (
            <li
              key={r.ref}
              id={`${id}-opt-${r.ref}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(r.ref);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                fontSize: 13,
                cursor: 'pointer',
                background: i === activeIndex ? 'var(--color-accent)' : 'transparent',
                color: i === activeIndex ? 'var(--color-on-accent)' : 'var(--color-text)',
              }}
            >
              <Sprite sprite={r.species.sprite} dex={r.species.dex} size={26} shadow={r.shadow} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </span>
              {/* Typing is the fastest way to tell near-identical forms apart
                  while scanning; icons carry it without stealing name width. */}
              <span style={{ display: 'inline-flex', gap: 2, flex: 'none' }}>
                {r.species.types.map((t) => (
                  <TypeIcon key={t} type={t} size={14} />
                ))}
              </span>
              <span
                className="numeric"
                style={{ fontSize: 10, opacity: i === activeIndex ? 0.75 : 0.45 }}
              >
                #{String(r.species.dex).padStart(3, '0')}
              </span>
            </li>
            );
          })}
        </ul>
        </div>
        <HeldOutNote compact />
        </div>
      )}
      <button
        type="button"
        className="search-help-btn"
        aria-label="Search syntax"
        aria-expanded={helpOpen}
        title="Search syntax"
        onClick={() => {
          setHelpOpen((v) => !v);
          setOpen(false);
        }}
      >
        ?
      </button>
      <SearchHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
