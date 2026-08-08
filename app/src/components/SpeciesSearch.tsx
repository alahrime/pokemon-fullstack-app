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
/** Breathing room between the bottom of the list and the bottom of the window. */
const LIST_EDGE_GAP = 16;
/** Three rows. Below this the list stops being usable, so it overhangs instead. */
const MIN_LIST_H = ROW_H * 3;
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

/**
 * The nearest ancestor that would clip an overlay, if any.
 *
 * Anything other than `visible` on either axis establishes a clip, and CSS
 * computes a non-visible value on one axis to non-visible on the other — so
 * checking one is enough.
 */
function clippingAncestor(from: HTMLElement): HTMLElement | null {
  let n = from.parentElement;
  while (n && n !== document.body) {
    if (getComputedStyle(n).overflowY !== 'visible') return n;
    n = n.parentElement;
  }
  return null;
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
  /**
   * How tall the results list may be, in px.
   *
   * One number, because it drives two things that must agree: the box's own
   * max-height and the arithmetic deciding which rows to render. Set the box
   * taller than the window believes and the rows past it are simply never
   * mounted — blank space at the bottom of a list that says it has 250 results.
   * Callers with room to spare raise it; the add-to-team modal does.
   */
  listHeight = LIST_H,
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
  listHeight?: number;
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
  /** Bumped each time the box is opened, to re-draw the blank-query list. */
  const [shuffleKey, setShuffleKey] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** The field itself — the stable anchor the dropdown is measured against. */
  const wrapRef = useRef<HTMLDivElement>(null);
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
  /**
   * What an empty box offers: a random draw, not the top of the rankings.
   *
   * Sorted by rank it was the same list every time, headed by whatever sits at
   * rank 1 — so the field read as "defaulting to Azumarill" rather than as an
   * invitation to look around. Drawn only from species that have a league rank
   * at all, because a uniform draw over the whole roster is mostly Pokemon
   * nobody can field.
   *
   * Reshuffled per opening rather than per render: a list that reordered while
   * you were reading it would be unusable.
   */
  const defaults = useMemo(() => {
    const ranked = pool.filter((e) => bestRankOf(e) !== Number.MAX_SAFE_INTEGER);
    const from = ranked.length >= RESULT_LIMIT ? ranked : pool;
    // Fisher-Yates over a copy, then take the window.
    const shuffled = from.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, RESULT_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, shuffleKey]);

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
  const last = Math.min(results.length, Math.ceil((scrollTop + listHeight) / ROW_H) + OVERSCAN);
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

  /**
   * The list, fitted to the room actually below it.
   *
   * `listHeight` is a ceiling, not a height. How much of it the box may use
   * depends on where the input sits on the page and how tall the window is,
   * and CSS cannot see the first of those — so a flat 420px box hung 252px
   * below the fold of a 560px-tall window, with twelve of its rows off screen
   * and unreachable. Measured on open, and again while it is open, because a
   * resize or a scroll moves the anchor under it.
   *
   * Never above `listHeight`: the windowing arithmetic renders rows for that
   * ceiling, so a taller box would end in blank space. Never below
   * `MIN_LIST_H` either — a two-row list is worse than one that overhangs.
   */
  const [boxH, setBoxH] = useState(listHeight);
  const [dropUp, setDropUp] = useState(false);
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      // Measured from the field, not from the list. The list's own top moves
      // when it flips, which would make this chase itself; the field does not.
      const wrap = wrapRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      // The panel is taller than its list: borders, and the held-out note when
      // a query hits one. Measured rather than assumed, because that note is
      // conditional — unaccounted for, a flipped panel started 31px above the
      // top of the window.
      const list = listRef.current;
      const chrome = list?.parentElement ? list.parentElement.offsetHeight - list.offsetHeight : 0;
      // The window is not always the edge that matters. Inside the add-to-team
      // modal the panel is: fitted to the window instead, the list cleared the
      // bottom of the screen and still sat 64px over the Cancel/Add buttons.
      // The nearest ancestor that clips is the honest boundary, and on a plain
      // page there is none, so this falls back to the viewport.
      const clip = clippingAncestor(wrap);
      const cb = clip ? clip.getBoundingClientRect() : null;
      const floor = Math.min(cb ? cb.bottom : Infinity, window.innerHeight);
      const ceiling = Math.max(cb ? cb.top : 0, 0);
      const below = floor - r.bottom - LIST_EDGE_GAP - chrome;
      const above = r.top - ceiling - LIST_EDGE_GAP - chrome;
      // With the field near the bottom of a short window there is no honest
      // way to show a list underneath it — at 1280x560 the team picker had
      // 63px of room and hung 95px below the fold. Open upward instead, which
      // is what every other combobox does and what the space allows.
      const flip = below < MIN_LIST_H && above > below;
      setDropUp(flip);
      setBoxH(Math.max(MIN_LIST_H, Math.min(listHeight, flip ? above : below)));
    };
    fit();
    // Again after the browser has settled. Opening the box can move the field
    // under it — focus scrolls a partly-visible input into view, and the list
    // changes the page's height — and neither of those arrives as a scroll or
    // resize event, so a single measurement at open read a position the field
    // had already left by 70px.
    const raf = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    // Capture: the anchor moves when any scroller between it and the page
    // scrolls, not only the page.
    window.addEventListener('scroll', fit, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
    // `debounced` and the result count are in here because a new query changes
    // the panel's own chrome — the held-out note appears and disappears — and
    // the field above it can grow or shrink with it.
  }, [open, listHeight, debounced, results.length]);

  const commit = (ref: string) => {
    onChange(ref);
    setOpen(false);
    setText(startEmpty ? '' : displayName(ref));
  };

  return (
    // `species-search` is the stable hook every variant is styled from, so the
    // field does not depend on whichever class the caller happened to pass.
    <div ref={wrapRef} className={`species-search${className ? ' ' + className : ''}`} style={{ position: 'relative', ...style }}>
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
          setShuffleKey((k) => k + 1);
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
        <div className={`search-dropdown${dropUp ? ' is-up' : ''}`}>
        {/* The scroll box is this wrapper, not the list. Padding on the list
            would sit outside its own max-height and the box would grow to the
            full 5,500px instead of clipping at `listHeight`. */}
        <div
          ref={listRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          style={{ maxHeight: boxH, overflowY: 'auto' }}
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
