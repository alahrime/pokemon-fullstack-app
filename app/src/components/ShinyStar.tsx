import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../state/ThemeContext';

const SPARKS = [
  { a: 0, c: '#ffffff' }, { a: 45, c: '#7fe7ff' }, { a: 90, c: '#ffe58a' }, { a: 135, c: '#ff9be8' },
  { a: 180, c: '#ffffff' }, { a: 225, c: '#ffe58a' }, { a: 270, c: '#7fe7ff' }, { a: 315, c: '#ff9be8' },
];

/**
 * The shiny preference as a bare star in the header. It carries no visible label (an accessible name only), and when
 * it turns on, from here or anywhere else, it throws a ring of sparkles once — the cue a shiny gives in the games.
 */
export function ShinyStar() {
  const { shiny, toggleShiny } = useTheme();
  const [burst, setBurst] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (shiny) setBurst((n) => n + 1);
  }, [shiny]);

  return (
    <span className={`shiny-star${shiny ? ' is-on' : ''}`}>
      <button type="button" role="switch" aria-checked={shiny} aria-label="Shiny sprites" className="shiny-star-btn" onClick={toggleShiny} />
      {burst > 0 && (
        // Keyed on the count, so each switch-on remounts it and the animation runs from the start.
        <span key={burst} className="shiny-burst" aria-hidden="true">
          {SPARKS.map((s, i) => (
            <i key={i} style={{ ['--a' as string]: `${s.a}deg`, ['--c' as string]: s.c, ['--d' as string]: `${(i % 4) * 60}ms` }} />
          ))}
        </span>
      )}
    </span>
  );
}
