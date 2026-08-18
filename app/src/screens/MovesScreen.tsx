import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { TypeIcon } from '../components/TypeBadge';
import { Pager } from '../components/Pager';
import { CHARGE_MOVES, FAST_MOVES } from '../lib/data';
import { chargeMoveStats, fastMoveStats } from '../lib/engine';
import type { ChargeMove, FastMove } from '../lib/types';

type Kind = 'fast' | 'charge';

const KINDS: { id: Kind; label: string; note: string; glyph: string }[] = [
  { id: 'fast', label: 'Fast moves', note: 'Energy in, per turn', glyph: '⌁' },
  { id: 'charge', label: 'Charge moves', note: 'Energy out, per throw', glyph: '◈' },
];

/**
 * The kind picker, as an overlaid listbox rather than a native `<select>`.
 *
 * A native select is the right control for this — two exclusive options — but
 * its expanded list is drawn by the operating system, so it arrives as a plain
 * white menu in the middle of an instrument panel and nothing in the app's
 * stylesheet can reach it. This is the same overlay language the move browser
 * already uses: a chamfered trigger, a panel over the page rather than a menu
 * beside it, and each option carrying what it holds.
 *
 * Keyboard behaviour is the listbox pattern: arrows move, Enter or Space
 * commits, Escape closes, and focus returns to the trigger either way.
 */
function KindPicker({
  value,
  counts,
  onChange,
}: {
  value: Kind;
  counts: Record<Kind, number>;
  onChange: (k: Kind) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = KINDS.find((k) => k.id === value)!;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // Registered a tick late, so the press that opened the panel does not
    // immediately close it again.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const commit = (k: Kind) => {
    onChange(k);
    setOpen(false);
    trigger.current?.focus();
  };

  const onOptionKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (i + (e.key === 'ArrowDown' ? 1 : KINDS.length - 1)) % KINDS.length;
      (box.current?.querySelectorAll('.mv-kind-opt')[next] as HTMLElement | undefined)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(KINDS[i].id);
    }
  };

  return (
    <div className="mv-kind-picker" ref={box}>
      <button
        type="button"
        ref={trigger}
        className={`mv-kind-btn${open ? ' is-open' : ''}`}
        aria-label="Move kind"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mv-kind-glyph" aria-hidden>{current.glyph}</span>
        <span className="mv-kind-current">{current.label}</span>
        <span className="numeric mv-kind-tally">{counts[current.id]}</span>
        <span className="mv-kind-caret" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <ul className="mv-kind-panel" role="listbox" aria-label="Move kind">
          {KINDS.map((k, i) => (
            <li key={k.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={k.id === value}
                autoFocus={k.id === value}
                className={`mv-kind-opt${k.id === value ? ' is-on' : ''}`}
                onClick={() => commit(k.id)}
                onKeyDown={(e) => onOptionKey(e, i)}
              >
                <span className="mv-kind-glyph" aria-hidden>{k.glyph}</span>
                <span className="mv-kind-opt-body">
                  <span className="mv-kind-opt-label">{k.label}</span>
                  <span className="mv-kind-opt-note">{k.note}</span>
                </span>
                <span className="numeric mv-kind-tally">{counts[k.id]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One column definition, feeding the header, the sort and the cell alike.
 *
 * The two kinds do not share a shape — a fast move has a duration and a charge
 * move does not — so each gets its own list rather than one union with holes
 * in it. `value` is what sorts; `render` is only for columns whose text is not
 * simply that number.
 */
interface Col<T> {
  key: string;
  label: string;
  /** Expanded in the header's tooltip — these are all abbreviations. */
  hint: string;
  /**
   * Declared width, in px.
   *
   * The table is laid out `fixed`, so these — not the cell contents — decide
   * where every column sits. Sizing to content meant the widths were a
   * function of whichever 25 rows the current sort happened to surface: page 1
   * of a name sort holds "Hidden Power (Fighting)" and page 1 of a damage sort
   * holds "Gust", and every column to their right moved between the two. A
   * column that shifts when you sort by it is the one thing a table must not
   * do.
   */
  w: number;
  value: (m: T) => number;
  render?: (m: T) => ReactNode;
  /** The one column that also draws a bar, scaled to the visible set. */
  meter?: boolean;
}

const NAME_COL = { key: 'name', label: 'Move', hint: 'Alphabetical' };
/** Wide enough for the longest type name, "fighting", beside its icon. */
const TYPE_W = 128;

const FAST_COLS: Col<FastMove>[] = [
  {
    key: 'damage',
    label: 'Dmg',
    hint: 'Base power, before types and stats',
    w: 88,
    value: (m) => fastMoveStats(m).damage,
    meter: true,
  },
  {
    key: 'energy',
    label: 'Energy',
    hint: 'Energy generated per use',
    w: 92,
    value: (m) => fastMoveStats(m).energyGain,
  },
  {
    key: 'turns',
    label: 'Turns',
    hint: 'Duration in 500ms battle turns',
    w: 104,
    value: (m) => m.turns,
    render: (m) => `${m.turns} · ${(m.turns * 0.5).toFixed(1)}s`,
  },
  {
    key: 'dpt',
    label: 'DPT',
    hint: 'Damage per turn — how hard it hits while you wait',
    w: 84,
    value: (m) => fastMoveStats(m).dpt,
    render: (m) => fastMoveStats(m).dpt.toFixed(2),
  },
  {
    key: 'ept',
    label: 'EPT',
    hint: 'Energy per turn — how fast it fuels the charge move',
    w: 84,
    value: (m) => fastMoveStats(m).ept,
    render: (m) => fastMoveStats(m).ept.toFixed(2),
  },
];

const CHARGE_COLS: Col<ChargeMove>[] = [
  {
    key: 'damage',
    label: 'Dmg',
    hint: 'Base power, before types and stats',
    w: 88,
    value: (m) => chargeMoveStats(m).damage,
    meter: true,
  },
  {
    key: 'energy',
    label: 'Cost',
    hint: 'Energy the throw costs',
    w: 84,
    value: (m) => m.energy,
  },
  {
    key: 'dpe',
    label: 'DPE',
    hint: 'Damage per energy — the standard efficiency measure',
    w: 84,
    value: (m) => chargeMoveStats(m).dpe,
    render: (m) => chargeMoveStats(m).dpe.toFixed(2),
  },
  {
    key: 'buff',
    label: 'Effect',
    hint: 'Stat stages applied on resolution, and how often',
    w: 152,
    // Sorts by how much it moves, in either direction, so the movers group.
    value: (m) => (m.buffs ? (Math.abs(m.buffs.atkStage) + Math.abs(m.buffs.defStage)) * m.buffs.chance : 0),
    render: (m) => (m.buffs ? buffLabel(m) : '—'),
  },
];

function buffLabel(m: ChargeMove): string {
  const b = m.buffs!;
  const parts: string[] = [];
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  if (b.atkStage) parts.push(`${sign(b.atkStage)} atk`);
  if (b.defStage) parts.push(`${sign(b.defStage)} def`);
  const who = b.target === 'self' ? 'self' : 'foe';
  const odds = b.chance >= 1 ? '' : ` ${Math.round(b.chance * 100)}%`;
  return `${parts.join(' ')} ${who}${odds}`;
}

/** Name, type and archetype, matched as plain substrings. */
function matches(m: FastMove | ChargeMove, q: string): boolean {
  if (!q) return true;
  const hay = `${m.name} ${m.type} ${m.archetype ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/**
 * The move catalogue: every fast and charge move in the game, with the figures
 * that decide which one a Pokémon should be running.
 *
 * Every other screen reaches moves through a species — the report's loadout,
 * the battle's timeline — which answers "what does this Pokémon throw" and
 * never "what is this move worth". The numbers here are the move's own: base
 * power with no STAB, no attacker and no target, because that is the only form
 * in which two moves on different Pokémon can be compared at all.
 *
 * Charge moves carry no per-turn figures because they have no turns: in PvP
 * they resolve the instant the energy is there. Damage per energy is the
 * equivalent measure, and it is the one the meta actually argues about.
 */
export function MovesScreen() {
  const [kind, setKind] = useState<Kind>('fast');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'damage', desc: true });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);

  const cols = (kind === 'fast' ? FAST_COLS : CHARGE_COLS) as Col<FastMove & ChargeMove>[];
  const pool = (kind === 'fast' ? FAST_MOVES : CHARGE_MOVES) as (FastMove & ChargeMove)[];

  const rows = useMemo(() => {
    const found = pool.filter((m) => matches(m, q));
    const col = cols.find((c) => c.key === sort.key);
    const cmp = col
      ? (a: FastMove & ChargeMove, b: FastMove & ChargeMove) => col.value(a) - col.value(b)
      : (a: FastMove & ChargeMove, b: FastMove & ChargeMove) => a.name.localeCompare(b.name);
    // A stable second key: two moves of equal power keep a fixed order rather
    // than shuffling between renders of the same query.
    return [...found].sort((a, b) => (sort.desc ? cmp(b, a) : cmp(a, b)) || a.name.localeCompare(b.name));
  }, [pool, cols, q, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const shown = rows.slice(page * size, page * size + size);
  // The meter is relative to what the query returned, not to the whole game:
  // a search for fast moves under 5 power should still show a spread.
  const peak = useMemo(() => {
    const col = cols.find((c) => c.meter);
    return col ? rows.reduce((m, r) => Math.max(m, col.value(r)), 0) : 0;
  }, [cols, rows]);

  const reset = (next: Partial<{ kind: Kind; q: string }>) => {
    if (next.kind !== undefined) {
      setKind(next.kind);
      // Sort keys are per-kind; only `damage` and `energy` exist in both, and a
      // stale `dpt` would silently fall back to alphabetical.
      setSort((s) => (s.key === 'damage' || s.key === 'energy' ? s : { key: 'damage', desc: true }));
    }
    if (next.q !== undefined) setQ(next.q);
    setPage(0);
  };

  const sortBy = (key: string) => {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
    setPage(0);
  };

  return (
    <>
      <ScreenHeader
        title="Moves"
        blurb="Every fast and charge move in the game, with the numbers that decide which one to run."
        info={
          <>
            <p>
              Damage is base power: no STAB, no type effectiveness and no attack stat, so two moves
              can be compared without picking a Pokémon to throw them. A species applies its own
              1.2× when the types match.
            </p>
            <p className="mt-2">
              Fast moves report per-turn figures because they occupy turns — one turn is 500ms.
              Charge moves resolve instantly once the energy is banked, so they have none; damage
              per energy is the measure that ranks them.
            </p>
          </>
        }
      />

      <div className="mv-controls">
        <div className="mv-kind">
          <span className="hud-label">Kind</span>
          <KindPicker
            value={kind}
            counts={{ fast: FAST_MOVES.length, charge: CHARGE_MOVES.length }}
            onChange={(k) => reset({ kind: k })}
          />
        </div>

        <label className="mv-search">
          <span className="hud-label">Search</span>
          <span className="mv-search-field">
            <span className="nav-search-glyph" aria-hidden="true">⌕</span>
            <input
              className="input"
              value={q}
              onChange={(e) => reset({ q: e.target.value })}
              placeholder="Name, type or archetype — dragon, spam, counter…"
              aria-label="Search moves"
            />
          </span>
        </label>

        <span className="mv-count numeric">
          {rows.length.toLocaleString()} <i>of</i> {pool.length.toLocaleString()}
        </span>
      </div>

      <div className="panel hud-frame mv-panel">
        <div className="table-scroll">
          <table className="table text-sm mv-table">
            {/* Declared geometry. The name column takes every pixel the others
                do not, so the figures hold the same place at any width and
                under any sort. */}
            <colgroup>
              <col className="mv-col-name" />
              <col style={{ width: TYPE_W }} />
              {cols.map((c) => (
                <col key={c.key} style={{ width: c.w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  className="mv-th"
                  aria-sort={sort.key === NAME_COL.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                >
                  <button type="button" className="mv-sort" onClick={() => sortBy(NAME_COL.key)} title={NAME_COL.hint}>
                    {NAME_COL.label}
                    <Caret on={sort.key === NAME_COL.key} desc={sort.desc} />
                  </button>
                </th>
                <th className="mv-th mv-th-type">Type</th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className="mv-th mv-th-num"
                    aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                  >
                    <button type="button" className="mv-sort" onClick={() => sortBy(c.key)} title={c.hint}>
                      {c.label}
                      <Caret on={sort.key === c.key} desc={sort.desc} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {/* Keyed on what re-orders the list, so React remounts the rows
                and the cascade replays. Without this the arrival is only ever
                seen once, on the first render of the screen — every sort and
                page after that reuses the same nodes and nothing moves. Not
                keyed on the query: replaying the whole run on each keystroke
                is a strobe, not an arrival. */}
            <tbody className="stagger-drop-rows" key={`${kind}-${sort.key}-${sort.desc}-${page}`}>
              {shown.map((m, i) => (
                <tr
                  key={m.id}
                  className="mv-row"
                  style={{ ['--mv-type' as string]: `var(--type-${m.type})`, ['--row-i' as string]: i }}
                >
                  <td className="mv-name" title={m.archetype ? `${m.name} — ${m.archetype}` : m.name}>
                    <span className="mv-name-text">{m.name}</span>
                    {m.archetype && <span className="mv-tag">{m.archetype}</span>}
                  </td>
                  <td className="mv-type-cell">
                    <TypeIcon type={m.type} size={18} />
                    <span className="mv-type-label">{m.type}</span>
                  </td>
                  {cols.map((c) => {
                    const v = c.value(m);
                    const text = c.render ? c.render(m) : v;
                    return (
                      <td key={c.key} className={`numeric mv-num${c.meter ? ' mv-meter' : ''}`}>
                        {c.meter && peak > 0 && (
                          <span
                            className="mv-meter-fill"
                            style={{ width: `${Math.max(2, (v / peak) * 100)}%` }}
                            aria-hidden
                          />
                        )}
                        <span className="mv-num-text">{text}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="mv-empty">
            Nothing matches “{q}”. Names, types and PvPoke's own archetypes are all searched.
          </p>
        )}
      </div>

      <Pager
        page={Math.min(page, pages - 1)}
        pages={pages}
        total={rows.length}
        size={size}
        onPage={(n) => setPage(Math.max(0, Math.min(pages - 1, n)))}
        onSize={(n) => {
          setSize(n);
          setPage(0);
        }}
        unit="moves"
        className="mt-3"
      />
    </>
  );
}

/** Sort direction, drawn only on the column that is actually sorting. */
function Caret({ on, desc }: { on: boolean; desc: boolean }) {
  return (
    <span className={`mv-caret${on ? ' is-on' : ''}`} aria-hidden="true">
      {on ? (desc ? '▼' : '▲') : '·'}
    </span>
  );
}
