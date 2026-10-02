import { useEffect, useRef, useState } from 'react';
import { useShiny } from '../state/ThemeContext';

const SPARKS = [
  { a: 0, c: '#ffffff' }, { a: 45, c: '#7fe7ff' }, { a: 90, c: '#ffe58a' }, { a: 135, c: '#ff9be8' },
  { a: 180, c: '#ffffff' }, { a: 225, c: '#ffe58a' }, { a: 270, c: '#7fe7ff' }, { a: 315, c: '#ff9be8' },
];

/**
 * A ring of sparkles, thrown once each time shiny turns ON while this is mounted — the cue a shiny gives in the
 * games. Fill a `position: relative` box with it; `size` is how big each spark is and how far it travels, in px.
 * Turning shiny off, or mounting while it is already on, plays nothing. `retrigger` replays it, while shiny is on,
 * whenever that value changes (the Battle screen passes its league: a new league deals a new pair).
 */
export function ShinyBurst({ spark = 12, reach = 30, retrigger }: { spark?: number; reach?: number; retrigger?: unknown }) {
  const shiny = useShiny();
  const [burst, setBurst] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (shiny) setBurst((n) => n + 1);
  }, [shiny, retrigger]);
  if (burst === 0) return null;
  return (
    // Keyed on the count, so each switch-on remounts it and the animation runs from the start.
    <span key={burst} className="shiny-burst" aria-hidden="true" style={{ ['--spark' as string]: `${spark}px`, ['--reach' as string]: `${reach}px` }}>
      {SPARKS.map((s, i) => (
        <i key={i} style={{ ['--a' as string]: `${s.a}deg`, ['--c' as string]: s.c, ['--d' as string]: `${(i % 4) * 60}ms` }} />
      ))}
    </span>
  );
}
