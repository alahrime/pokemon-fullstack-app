import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BASE_ROSTER, ROSTER, SPECIES, displayName, type RosterEntry } from '../lib/data';
import { compileQuery } from '../lib/query';
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
}: {
  value: string;
  onChange: (ref: string) => void;
  placeholder?: string;
  id: string;
  style?: CSSProperties;
  className?: string;
  includeShadow?: boolean;
}) {
  const pool = includeShadow ? ROSTER : BASE_ROSTER;
  const selectedName = displayName(value);
  const [text, setText] = useState(selectedName);
  const [debounced, setDebounced] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
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

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
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
      {open && results.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            minWidth: 260,
            zIndex: 30,
            margin: '2px 0 0',
            padding: 0,
            listStyle: 'none',
            background: 'var(--surface-1)',
            border: 'var(--border-hairline) solid var(--rule-strong)',
            maxHeight: 420,
            overflowY: 'auto',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {results.map((r, i) => (
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
          ))}
        </ul>
      )}
      {open && <HeldOutNote compact />}
    </div>
  );
}
