import { useRef } from 'react';

/**
 * Shields as three icon toggles: a crossed-out shield for none, one shield, and two dovetailed. A radio group, so the
 * arrow keys move the choice; the chosen one fills and runs a single hue sweep, then rests.
 */
const SHIELD = 'M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3Z';

function Glyph({ n }: { n: 0 | 1 | 2 }) {
  if (n === 0) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" className="sp-glyph">
        <path d={SHIELD} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="8.6" fill="none" className="sp-ban" strokeWidth="2" />
        <path d="M6 6 18 18" className="sp-ban" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (n === 1) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" className="sp-glyph">
        <path d={SHIELD} className="sp-fill" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 7v9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }
  // Two shields dovetailed: the back one offset up-left, the front one overlapping it down-right.
  return (
    <svg width="30" height="26" viewBox="0 0 30 24" aria-hidden="true" className="sp-glyph">
      <path d={SHIELD} transform="translate(-1.5 -1) scale(0.92)" className="sp-fill is-back" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d={SHIELD} transform="translate(8.5 1.6) scale(0.92)" className="sp-fill" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const LABEL = ['No shields', '1 shield', '2 shields'] as const;

export function ShieldPicker({ value, onChange, label = 'Shields' }: { value: number; onChange: (n: number) => void; label?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (n: number) => {
    const next = (n + 3) % 3;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="sp-group" role="radiogroup" aria-label={label}>
      {([0, 1, 2] as const).map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            ref={(el) => { refs.current[n] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={LABEL[n]}
            title={LABEL[n]}
            tabIndex={on ? 0 : -1}
            className={`sp-btn is-n${n}${on ? ' is-on' : ''}`}
            onClick={() => onChange(n)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(value + 1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(value - 1); }
            }}
          >
            {/* Keyed on the choice so the sweep replays each time this one is picked. */}
            {on && <span key={`sweep-${value}`} className="sp-sweep" aria-hidden="true" />}
            <Glyph n={n} />
            <span className="sp-n numeric" aria-hidden="true">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
