import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SPECIES, SPECIES_BY_ID } from '../lib/data';

const RESULT_LIMIT = 8;
const DEBOUNCE_MS = 150;

export function SpeciesSearch({
  value,
  onChange,
  placeholder = 'Search species…',
  id,
  style,
}: {
  value: string;
  onChange: (speciesId: string) => void;
  placeholder?: string;
  id: string;
  style?: CSSProperties;
}) {
  const selectedName = SPECIES_BY_ID.get(value)?.name ?? '';
  const [text, setText] = useState(selectedName);
  const [debounced, setDebounced] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `${id}-listbox`;

  // Keep the input's text in sync with the selection while the user isn't actively searching.
  useEffect(() => {
    if (!open) setText(selectedName);
  }, [selectedName, open]);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [text]);

  const results = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const matches = q ? SPECIES.filter((s) => s.name.toLowerCase().includes(q)) : SPECIES.slice();
    return matches.sort((a, b) => a.name.localeCompare(b.name)).slice(0, RESULT_LIMIT);
  }, [debounced]);

  const commit = (speciesId: string) => {
    onChange(speciesId);
    setOpen(false);
    setText(SPECIES_BY_ID.get(speciesId)?.name ?? '');
  };

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-label={placeholder}
        aria-activedescendant={open && results[activeIndex] ? `${id}-opt-${results[activeIndex].id}` : undefined}
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
            if (open && results[activeIndex]) commit(results[activeIndex].id);
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
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 30,
            margin: '2px 0 0',
            padding: 0,
            listStyle: 'none',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-divider)',
            maxHeight: 240,
            overflowY: 'auto',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {results.map((s, i) => (
            <li
              key={s.id}
              id={`${id}-opt-${s.id}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s.id);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: '7px 10px',
                fontSize: 13,
                cursor: 'pointer',
                background: i === activeIndex ? 'var(--color-accent)' : 'transparent',
                color: i === activeIndex ? 'var(--color-bg)' : 'var(--color-text)',
              }}
            >
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
