import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The long explanation, folded away behind a mark.
 *
 * These screens opened with several hundred words of methodology above the
 * first Pokémon — how a rating is built, what the adjustments are, why the
 * composite is not a battle rating. It is all worth saying and none of it is
 * worth saying *first*: it pushed the thing people came for below the fold
 * every time they changed a league.
 *
 * So it lives here. Hover opens it for a pointer, click or Enter for everyone
 * else, and Escape or an outside click closes it. It is a plain `<details>`-
 * shaped disclosure rather than a tooltip because tooltips cannot be read at
 * length: this content is paragraphs, it needs to be scrollable, selectable
 * and reachable by keyboard.
 *
 * Rendered inline rather than in a portal, which is what lets it inherit the
 * type scale and the theme without being restyled.
 */
export function InfoPopover({
  label = 'How this is measured',
  children,
  align = 'end',
}: {
  /** Names the panel for a screen reader, and titles the mark for a pointer. */
  label?: string;
  children: ReactNode;
  /** Which edge the panel hangs from — `end` for a control at the right. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  // Hover opens, and a short close delay lets the pointer travel from the mark
  // into the panel without it vanishing on the way.
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hold = () => window.clearTimeout(timer.current);
  const release = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 180);
  };

  return (
    <span
      className="info-pop"
      ref={wrap}
      onMouseEnter={() => { hold(); setOpen(true); }}
      onMouseLeave={release}
    >
      <button
        type="button"
        className={`info-pop-mark${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <div className={`info-pop-panel info-pop-${align}`} role="note" aria-label={label}>
          {children}
        </div>
      )}
    </span>
  );
}
