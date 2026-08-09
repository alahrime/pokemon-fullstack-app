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
 * So it lives here. It opens on click — deliberately not on hover: hover is
 * the one gesture a keyboard, a screen reader and a touch screen have no way
 * to make, and content that appears on hover alone also fails WCAG 1.4.13,
 * which requires such content be dismissable and hoverable. A press works
 * from every input, and it will not open itself while a pointer is merely
 * crossing the header on its way somewhere else. Escape or an outside click
 * closes it.
 *
 * It is a plain `<details>`-shaped disclosure rather than a tooltip because
 * tooltips cannot be read at length: this content is paragraphs, it needs to
 * be scrollable, selectable and reachable by keyboard.
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

  return (
    <span className="info-pop" ref={wrap}>
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
