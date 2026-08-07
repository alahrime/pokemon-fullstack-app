import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BASE_ROSTER,
  ROSTER,
  SPECIES,
  SPECIES_BY_ID,
  UNSIMULATED_IDS,
  displayName,
  type RosterEntry,
} from '../lib/data';
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
const ROW_H = 52;
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
  /**
   * Start empty and return to empty, rather than showing the current
   * selection.
   *
   * The landing page's search is a starting point, not a readout: arriving
   * home to find "Azumarill" already typed means clearing it before you can
   * search, and it makes the page look like it is mid-task when it is not.
   * The screen remounts on navigation, so going home genuinely resets it.
   *
   * The nav's copy keeps the old behaviour, where showing the current species
   * is the whole point.
   */
  startEmpty = false,
}: {
  value: string;
  onChange: (ref: string) => void;
  placeholder?: string;
  id: string;
  style?: CSSProperties;
  className?: string;
  includeShadow?: boolean;
  restrictTo?: ReadonlySet<string>;
  startEmpty?: boolean;
}) {
  const base = includeShadow ? ROSTER : BASE_ROSTER;
  const pool = useMemo(
    () => (restrictTo ? base.filter((r) => restrictTo.has(r.ref)) : base),
    [base, restrictTo],
  );
  const selectedName = displayName(value);
  // What the box shows when it is not being edited.
  const resting = startEmpty ? '' : selectedName;
  const [text, setText] = useState(resting);
  const [debounced, setDebounced] = useState(resting);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (!open) setText(resting);
  }, [resting, open]);

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

  /**
   * Which held-out species this query was reaching for, if any.
   *
   * The note at the foot of the list exists to explain an absence you actually
   * hit. Rendering it unconditionally — which is what it used to do — meant an
   * exact match on a present species still came with a paragraph about three
   * unrelated ones. Matched the same way the roster is matched, so "mimi",
   * "778" and "Mimikyu" all count.
   */
  const heldOutHits = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return [];
    return [...UNSIMULATED_IDS].filter((id) => {
      const sp = SPECIES_BY_ID.get(id);
      if (!sp) return false;
      return sp.name.toLowerCase().includes(q) || String(sp.dex) === q;
    });
  }, [debounced]);

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
    setText(startEmpty ? '' : displayName(ref));
  };

  return (
    // `species-search` is the stable hook every variant is styled from, so the
    // field does not depend on whichever class the caller happened to pass.
    <div className={`species-search${className ? ' ' + className : ''}`} style={{ position: 'relative', ...style }}>
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
            setText(resting);
          }
        }}
        onBlur={() => {
          setOpen(false);
          setText(resting);
        }}
      />
      {/* One positioned panel holding the list and the held-out note. The note
          used to sit outside it in normal flow, which put it directly under the
          input and *above* the absolutely-positioned list — reading as a header
          rather than a footnote. Inside the panel it sits at the foot of the
          surface it annotates. */}
      {/* Opens for results, and *also* for a query that found nothing — an
          empty box that simply vanishes leaves you unable to tell a typo from
          a species we hold out. That was the real defect behind the stray
          note: it lived inside a panel gated on `results.length > 0`, so
          searching Mimikyu returned nothing, closed the panel, and took the
          one explanation that mattered with it. The note could only ever
          appear alongside results it had nothing to do with. */}
      {open && (results.length > 0 || debounced.trim().length > 0) && (
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
          className="search-listbox"
          // The rows not rendered still occupy their space, so the scrollbar
          // and scroll position match the full result set.
          style={{
            paddingTop: first * ROW_H,
            paddingBottom: Math.max(0, (results.length - last) * ROW_H),
          }}
        >
          {windowed.map((r, wi) => {
            const i = first + wi;
            const rank = bestRankOf(r);
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
              className={`search-row${i === activeIndex ? ' is-active' : ''}`}
              // The one value that must agree with the windowing arithmetic
              // above, so it is set from the same constant rather than left to
              // drift in a stylesheet.
              style={{ height: ROW_H }}
            >
              <span className="search-row-art">
                <Sprite sprite={r.species.sprite} dex={r.species.dex} size={38} shadow={r.shadow} />
              </span>
              <span className="search-row-id">
                <span className="search-row-name">{r.name}</span>
                {/* Typing is the fastest way to tell near-identical forms apart
                    while scanning; icons carry it without stealing name width. */}
                <span className="search-row-meta">
                  {r.species.types.map((t) => (
                    <TypeIcon key={t} type={t} size={13} />
                  ))}
                  {/* Best rank in any league, labelled. It used to sit bare on
                      the right as "#42", which reads as a Pokédex number and is
                      not one — two different numbers wearing the same hash. */}
                  {rank !== Number.MAX_SAFE_INTEGER && (
                    <span className="numeric search-row-rank">
                      <i>rank</i>{rank}
                    </span>
                  )}
                </span>
              </span>
              {/* The Pokédex number, which is what a bare # should mean. */}
              <span className="numeric search-row-dex">
                {String(r.species.dex).padStart(4, '0')}
              </span>
            </li>
            );
          })}
        </ul>
        </div>
        {/* Nothing matched. Say so, and name the species we hold out if that
            is what was being reached for — those are different problems and
            silence looked identical for both. */}
        {results.length === 0 && (
          <p className="search-empty">
            No match for <strong>{debounced.trim()}</strong>
            {heldOutHits.length === 0 && (
              <span className="search-empty-hint">
                Try a type, a generation, or a move — <code>water</code>, <code>gen1</code>,{' '}
                <code>@counter</code>
              </span>
            )}
          </p>
        )}
        {/* Only when the query was actually reaching for a held-out species. */}
        {heldOutHits.length > 0 && <HeldOutNote compact only={heldOutHits} />}
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
