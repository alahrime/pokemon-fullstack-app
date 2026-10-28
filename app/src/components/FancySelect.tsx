import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A select drawn by the app instead of the browser: each option can carry a leading mark (a swatch, a type icon), a
 * second line, and trailing figures, which a native <select> cannot show.
 *
 * The list overlays rather than expands (the house rule): it is portalled to <body> and positioned against the
 * trigger, because the triggers live inside scrolling card grids that would clip an absolutely positioned list. It
 * opens downward, or upward when the space below is short, and closes on an outside press, Escape, Tab, a resize or
 * any scroll outside it — a list left floating over content that moved is worse than one that closes.
 *
 * Keyboard: the trigger opens on Enter, Space and the arrows; in the list the arrows, Home and End move, Enter and
 * Space pick, and typing jumps to the next option starting with that letter.
 */
export interface FancyOption {
  value: string;
  label: string;
  /** Second line, quieter. */
  hint?: ReactNode;
  /** Before the label: a swatch, an icon. */
  lead?: ReactNode;
  /** After the label: figures. */
  trail?: ReactNode;
}

const LIST_MAX = 320;
const GAP = 4;

export function FancySelect({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose…',
  size = 'md',
  className = '',
  showHint = false,
}: {
  value: string;
  options: FancyOption[];
  onChange: (value: string) => void;
  /** Accessible name of the control. */
  label: string;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Show the selected option's hint under its label in the trigger too. */
  showHint?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean } | null>(null);
  // Bumped on every pick, keying the flash overlay so the hue sweep plays once per choice.
  const [picks, setPicks] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const current = options.find((o) => o.value === value);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const want = Math.min(LIST_MAX, options.length * 52 + 8);
    const up = below < want && above > below;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8)),
      top: up ? r.top - GAP : r.bottom + GAP,
      width: Math.max(r.width, 220),
      maxH: Math.max(120, Math.min(LIST_MAX, up ? above : below)),
      up,
    });
  };

  const show = (at?: number) => {
    place();
    setActive(at ?? Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    setPicks((n) => n + 1);
    close();
  };

  useLayoutEffect(() => {
    if (open) list.current?.focus({ preventScroll: true });
  }, [open]);

  // Keep the active option in view as the keyboard walks the list.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      // A scroll of the page itself targets the window, which is not a Node and is never inside either.
      const t = e.target;
      if (t instanceof Node && (list.current?.contains(t) || trigger.current?.contains(t))) return;
      close(false);
    };
    const resize = () => close(false);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === 'ArrowDown') setActive((a) => Math.min(last, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { close(false); return; }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      // The same letter pressed again cycles through the options starting with it, as a native select does.
      const q = /^(.)\1+$/.test(typed.current.text) ? typed.current.text[0] : typed.current.text;
      const from = q.length === 1 ? active + 1 : active;
      const order = [...options.keys()].map((k) => (k + from) % options.length);
      const hit = order.find((k) => options[k].label.toLowerCase().startsWith(q));
      if (hit !== undefined) setActive(hit);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`fs-trigger is-${size}${open ? ' is-open' : ''} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        {picks > 0 && <span key={picks} className="fs-flash" aria-hidden="true" />}
        {current?.lead && <span className="fs-lead">{current.lead}</span>}
        <span className="fs-text">
          <span className={`fs-label${current ? '' : ' is-placeholder'}`}>{current?.label ?? placeholder}</span>
          {showHint && current?.hint && <span className="fs-hint">{current.hint}</span>}
        </span>
        {size === 'md' && current?.trail && <span className="fs-trail">{current.trail}</span>}
        <svg className="fs-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos && createPortal(
        <ul
          ref={list}
          id={`${id}-list`}
          className={`fs-list${pos.up ? ' is-up' : ''}`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-o${active}`}
          onKeyDown={onListKey}
          style={{
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxH,
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-o${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={`fs-option${i === active ? ' is-active' : ''}${o.value === value ? ' is-selected' : ''}`}
              style={{ ['--i' as string]: Math.min(i, 12) }}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              {o.lead && <span className="fs-lead">{o.lead}</span>}
              <span className="fs-text">
                <span className="fs-label">{o.label}</span>
                {o.hint && <span className="fs-hint">{o.hint}</span>}
              </span>
              {o.trail && <span className="fs-trail">{o.trail}</span>}
              {o.value === value && (
                <svg className="fs-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

/** A colour swatch for an option's lead: two or three stops, chamfered like the rest of the HUD. */
export function Swatch({ colors }: { colors: string[] }) {
  const stops = colors.length > 1 ? colors : [colors[0], colors[0]];
  return <span className="fs-swatch" style={{ background: `linear-gradient(135deg, ${stops.join(', ')})` }} aria-hidden="true" />;
}
