import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LeagueId } from '../lib/types';
import { LeagueEmblem } from './LeagueEmblem';

/**
 * One choice in a league-flavoured dropdown. `league` picks the emblem (a cup shows the league whose CP cap it
 * plays under); `types` tints it by the types the cup is made of, and without any it takes its league's own
 * colours.
 */
export interface LeagueOption {
  value: string;
  label: string;
  league: LeagueId;
  types?: readonly string[];
  /** Explicit colours; wins over `types`. */
  palette?: readonly string[];
  note?: string;
  group?: string;
}

/**
 * The colours an option is drawn in. A cup of Fairy and Poison reads pink running into purple, because that is
 * what its Pokémon are; a plain league reads in its ball's colours.
 */
export function optionColors(o: Pick<LeagueOption, 'league' | 'types' | 'palette'>): string[] {
  if (o.palette?.length) return [...o.palette];
  return o.types?.length
    ? o.types.map((t) => `var(--type-${t})`)
    : [`var(--lg-${o.league})`, `var(--lg-${o.league}-accent)`];
}

const stops = (cs: string[], pct: number) => (cs.length > 1 ? cs : [cs[0], cs[0]]).map((c) => `color-mix(in srgb, ${c} ${pct}%, transparent)`).join(', ');

export function optionStyle(o: Pick<LeagueOption, 'league' | 'types' | 'palette'>): CSSProperties {
  const cs = optionColors(o);
  return {
    ['--ls-rail' as string]: `linear-gradient(180deg, ${(cs.length > 1 ? cs : [cs[0], cs[0]]).join(', ')})`,
    ['--ls-wash' as string]: `linear-gradient(90deg, ${stops(cs, 26)})`,
    ['--ls-wash-hot' as string]: `linear-gradient(90deg, ${stops(cs, 44)})`,
  };
}

/**
 * A dropdown whose rows carry the league emblem and their own colours, which a native `<select>` cannot draw.
 * Same contract as one: a labelled combobox, arrow keys / Enter / Escape, one value. The list overlays rather
 * than pushing the page, scrolls inside itself, and Escape closes it without also closing a dialog around it.
 */
export function LeagueSelect({ id, label, value, options, onChange, buttonRef }: {
  id: string;
  label: string;
  value: string;
  options: readonly LeagueOption[];
  onChange: (value: string) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const selectedIdx = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(selectedIdx);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options[selectedIdx];

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const pick = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
  };

  return (
    <div className="ls">
      <button
        id={id}
        ref={buttonRef}
        type="button"
        role="combobox"
        className="input ls-btn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        style={current ? optionStyle(current) : undefined}
        onClick={() => { setActive(selectedIdx); setOpen((v) => !v); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) { setActive(selectedIdx); setOpen(true); return; }
            setActive((i) => Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (open) pick(active); else { setActive(selectedIdx); setOpen(true); }
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {current && (
          <>
            <LeagueEmblem league={current.league} size={26} />
            <span className="ls-name">{current.label}</span>
            {current.note && <span className="ls-note numeric">{current.note}</span>}
          </>
        )}
        <span className="ls-caret" aria-hidden>▾</span>
      </button>
      {open && (
        // A press on the panel (its scrollbar, a group heading) must not blur the button, which closes the list.
        <ul id={`${id}-list`} ref={listRef} role="listbox" aria-label={label} className="ls-list" onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === selectedIdx}
              className={`ls-opt${i === active ? ' is-active' : ''}${i === selectedIdx ? ' is-selected' : ''}${o.group && o.group !== options[i - 1]?.group ? ' starts-group' : ''}`}
              style={optionStyle(o)}
              data-group={o.group && o.group !== options[i - 1]?.group ? o.group : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <LeagueEmblem league={o.league} size={28} />
              <span className="ls-name">{o.label}</span>
              {o.note && <span className="ls-note numeric">{o.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
