import { useEffect, useRef, useState } from 'react';
import { isPokemonType, typeIconUrl } from '../lib/pokemonTypes';
import type { ChargeMove, FastMove } from '../lib/types';

/**
 * Searchable move list, rendered over the panel rather than inside it.
 *
 * Filters on name and type, so "fire" finds every Fire move and "punch" every
 * punching one.
 */
export function MovePicker({
  count,
  moves,
  isActive,
  onPick,
}: {
  count: number;
  moves: (FastMove | ChargeMove)[];
  isActive: (m: FastMove | ChargeMove) => boolean;
  onPick: (m: FastMove | ChargeMove) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? moves.filter((m) => m.name.toLowerCase().includes(needle) || m.type?.toLowerCase().includes(needle))
    : moves;

  return (
    <div className="move-picker" ref={box}>
      <button type="button" className="move-picker-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{open ? 'Close' : `Browse all ${count}`}</span>
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="move-picker-panel" role="dialog" aria-label="Choose a move">
          <input
            className="input move-picker-input"
            autoFocus
            value={q}
            placeholder="Filter by name or type…"
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="move-picker-list">
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`move-picker-row${isActive(m) ? ' is-active' : ''}`}
                  onClick={() => onPick(m)}
                >
                  {isPokemonType(m.type) && <img src={typeIconUrl(m.type)} alt="" width={13} height={13} />}
                  <span className="move-picker-name">{m.name}</span>
                  <span className="numeric move-picker-stat">{m.power}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="move-picker-empty">No move matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
