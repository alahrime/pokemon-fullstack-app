import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { BattleModeTabs } from '../components/BattleModeTabs';
import { AddPokemonModal, RETURN_ID, type AddPokemonChoice } from '../components/AddPokemonModal';
import { MatrixResults } from '../components/MatrixResults';
import { FancySelect, Swatch, type FancyOption } from '../components/FancySelect';
import { ShieldPicker } from '../components/ShieldPicker';
import { TypeIcon } from '../components/TypeBadge';
import { Sprite } from '../components/Sprite';
import { IVAdjuster } from '../components/IVAdjuster';
import { useAppState } from '../state/AppState';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { chargesOf } from '../lib/engine';
import {
  atRankOne, chargesFor, isUsable, matrix, newKey, quickFillRefs, quickFills, ratedEntry, resolve,
  type MatrixEntry, type ResolvedMon,
} from '../lib/battleMatrix';
import type { ChargeMove, FastMove, LeagueId } from '../lib/types';

/**
 * Battle → Matrix: a list of Pokémon down the left, a group across the right, every pairing simulated at the shield
 * counts each side chooses. Built for comparing builds — five rolls of one species against a meta, or a handful of
 * different species and movesets — so the lists are edited in place and kept per league across reloads.
 */

type SideId = 'left' | 'right';
interface SideState { entries: MatrixEntry[]; shields: number }
type Stored = Partial<Record<LeagueId, Record<SideId, SideState>>>;

export const MATRIX_STORE_KEY = 'paragon-battle-matrix-v1';
const EMPTY: Record<SideId, SideState> = { left: { entries: [], shields: 1 }, right: { entries: [], shields: 1 } };

function load(league: LeagueId): Record<SideId, SideState> {
  try {
    const all = JSON.parse(localStorage.getItem(MATRIX_STORE_KEY) ?? '{}') as Stored;
    const got = all[league];
    if (!got) return EMPTY;
    const side = (s: Partial<SideState> | undefined): SideState => ({
      entries: Array.isArray(s?.entries) ? s.entries.filter(isUsable) : [],
      shields: s?.shields === 0 || s?.shields === 2 ? s.shields : 1,
    });
    return { left: side(got.left), right: side(got.right) };
  } catch {
    return EMPTY;
  }
}

function save(league: LeagueId, sides: Record<SideId, SideState>) {
  try {
    const all = JSON.parse(localStorage.getItem(MATRIX_STORE_KEY) ?? '{}') as Stored;
    all[league] = sides;
    localStorage.setItem(MATRIX_STORE_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked or full: the matrix still works, it just will not be there after a reload.
  }
}

export function MatrixBattle() {
  const { state } = useAppState();
  const { league } = state;
  // Lists belong to a league: a Great League group priced at the Ultra cap is a different group.
  const [sides, setSides] = useState(() => ({ league, ...load(league) }));
  if (sides.league !== league) setSides({ league, ...load(league) });
  useEffect(() => save(sides.league, { left: sides.left, right: sides.right }), [sides]);

  const setSide = (id: SideId, next: Partial<SideState>) => setSides((s) => ({ ...s, [id]: { ...s[id], ...next } }));
  // Functional, so a removal that lands after its fold-out animation still sees the list as it is by then.
  const removeFrom = (id: SideId, key: string) =>
    setSides((s) => ({ ...s, [id]: { ...s[id], entries: s[id].entries.filter((e) => e.key !== key) } }));
  const [swaps, setSwaps] = useState(0);
  const swap = () => {
    setSides((s) => ({ ...s, left: s.right, right: s.left }));
    setSwaps((n) => n + 1);
  };

  const left = useMemo(() => sides.left.entries.map((e) => resolve(e, league)), [sides.left.entries, league]);
  const right = useMemo(() => sides.right.entries.map((e) => resolve(e, league)), [sides.right.entries, league]);
  // A 40 × 40 matrix is 1600 battles; deferring keeps dragging an IV responsive while it re-runs.
  const live = useMemo(
    () => ({ left, right, sl: sides.left.shields, sr: sides.right.shields, opt: state.optimizeTiming }),
    [left, right, sides.left.shields, sides.right.shields, state.optimizeTiming],
  );
  const input = useDeferredValue(live);
  const cells = useMemo(() => matrix(input.left, input.right, input.sl, input.sr, input.opt), [input]);
  const stale = input !== live;

  return (
    <>
      <ScreenHeader
        title="Battle"
        blurb="Matrix: every Pokémon on the left against every Pokémon on the right, at the shields each side holds. Compare rolls, movesets or whole species, and see which matchups, breakpoints and bulkpoints each one gains or loses."
      />
      <BattleModeTabs />
      <div className="bm-sides">
        <MatrixSide
          key={`l${swaps}`}
          id="left"
          title="Your Pokémon"
          note="Rows: the Pokémon being compared"
          league={league}
          state={sides.left}
          mons={left}
          onChange={(next) => setSide('left', next)}
          onRemove={(key) => removeFrom('left', key)}
        />
        <button type="button" className="bm-swap" onClick={swap} disabled={!sides.left.entries.length && !sides.right.entries.length}
          aria-label="Swap sides" title="Swap the two sides, shields and all">
          {swaps > 0 && <span key={swaps} className="bm-swap-spin" aria-hidden="true" />}
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h14l-4-4M20 16H6l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <MatrixSide
          key={`r${swaps}`}
          id="right"
          title="Opponents"
          note="Columns: the group they face"
          league={league}
          state={sides.right}
          mons={right}
          onChange={(next) => setSide('right', next)}
          onRemove={(key) => removeFrom('right', key)}
        />
      </div>
      {/* Gated on the deferred lists the cells were computed from, never the live ones: for a frame after an Undo the
          live side has Pokémon while the matrix still holds none. */}
      {input.left.length > 0 && input.right.length > 0 ? (
        <MatrixResults rows={input.left} cols={input.right} cells={cells} league={league} stale={stale}
          shields={[input.sl, input.sr]} />
      ) : (
        <div className="bm-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <p>Add at least one Pokémon on each side to see the matrix.</p>
          <p className="text-faint">Quick Fill puts a whole meta on a side at once.</p>
        </div>
      )}
    </>
  );
}

/** How long a card takes to fold away: nothing at all when motion is off. */
function foldMs(): number {
  try {
    if (document.documentElement.dataset.motion === 'off') return 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch {
    return 0;
  }
  return 220;
}

function MatrixSide({ id, title, note, league, state, mons, onChange, onRemove }: {
  id: SideId;
  title: string;
  note: string;
  league: LeagueId;
  state: SideState;
  mons: ResolvedMon[];
  onChange: (next: Partial<SideState>) => void;
  onRemove: (key: string) => void;
}) {
  const [modal, setModal] = useState<{ edit: MatrixEntry | null } | null>(null);
  const [fill, setFill] = useState('');
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  // The list as it was before a Clear or a Quick Fill replaced it, for one Undo.
  const [undo, setUndo] = useState<{ what: string; entries: MatrixEntry[] } | null>(null);
  const fills = quickFills(league);
  const { entries } = state;
  const put = (list: MatrixEntry[]) => onChange({ entries: list });
  const replace = (list: MatrixEntry[], what: string) => {
    if (entries.length) setUndo({ what, entries });
    put(list);
  };
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(t);
  }, [undo]);

  const commit = (choice: AddPokemonChoice) => {
    const base = { ref: choice.ref, fastIdx: choice.fastIdx, chargeIds: choice.chargeIds, iv: choice.iv, ...(choice.bestBuddy ? { bestBuddy: true } : {}) };
    if (modal?.edit) put(entries.map((e) => (e.key === modal.edit!.key ? { key: e.key, ...base } : e)));
    else put([...entries, { key: newKey(), ...base }]);
  };

  const remove = (key: string) => {
    const ms = foldMs();
    if (!ms) return onRemove(key);
    setLeaving((s) => new Set(s).add(key));
    setTimeout(() => {
      onRemove(key);
      setLeaving((s) => { const n = new Set(s); n.delete(key); return n; });
    }, ms);
  };

  const initialOf = (e: MatrixEntry): AddPokemonChoice => ({
    ref: e.ref,
    fastIdx: e.fastIdx,
    // The modal shows the moves it is given, so a rated (empty) pick is spelled out as the moves it stands for.
    chargeIds: e.chargeIds.length ? e.chargeIds : chargesFor(e, league).map((c) => c.id),
    iv: e.iv,
    bestBuddy: e.bestBuddy,
  });

  const fillOptions: FancyOption[] = fills.map((f) => ({
    value: f.key,
    label: f.label,
    hint: f.note,
    lead: <Swatch colors={f.swatch} />,
    trail: f.types.length ? (
      <span className="fs-types">{f.types.slice(0, 5).map((t) => <TypeIcon key={t} type={t} size={14} />)}</span>
    ) : undefined,
  }));

  return (
    <section className={`panel bm-side is-${id}`} aria-label={title}>
      <header className="bm-side-head">
        <div>
          <h2 className="bm-side-title">
            {title} <span key={entries.length} className="bm-count numeric">{entries.length}</span>
          </h2>
          <p className="bm-side-note text-faint">{note}</p>
        </div>
        <div className="bm-shields">
          <div className="hud-label">Shields</div>
          <ShieldPicker value={state.shields} onChange={(n) => onChange({ shields: n })} label={`${title} shields`} />
        </div>
      </header>

      <div className="bm-side-tools">
        <button type="button" className="bm-btn is-primary bm-add" onClick={() => setModal({ edit: null })}>
          <span className="bm-btn-plus" aria-hidden="true">+</span> Add Pokémon
        </button>
        <div className="bm-fill">
          <span className="hud-label">Quick Fill</span>
          <FancySelect
            value={fill}
            options={fillOptions}
            label={`Quick fill ${title}`}
            placeholder="Fill with a meta or cup…"
            showHint
            onChange={(key) => {
              setFill(key);
              replace(quickFillRefs(key, league).map((r) => ratedEntry(r, league)), fills.find((f) => f.key === key)?.label ?? 'Quick Fill');
            }}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="bm-side-empty">
          <span className="bm-side-empty-ring" aria-hidden="true">+</span>
          <p className="text-faint">No Pokémon yet. Add one, or Quick Fill a whole group.</p>
        </div>
      ) : (
        <ol className="bm-list">
          {mons.map((m, i) => (
            <MatrixCard
              key={m.entry.key}
              index={i}
              mon={m}
              leaving={leaving.has(m.entry.key)}
              onEdit={() => setModal({ edit: m.entry })}
              onChange={(next) => put(entries.map((e) => (e.key === m.entry.key ? next : e)))}
              onCopy={() => put([...entries.slice(0, i + 1), { ...m.entry, key: newKey() }, ...entries.slice(i + 1)])}
              onRemove={() => remove(m.entry.key)}
            />
          ))}
        </ol>
      )}

      <footer className="bm-side-foot">
        <button type="button" className="bm-btn is-gold" disabled={!entries.length}
          onClick={() => put(entries.map((e) => atRankOne(e, league)))}
          title="Set every Pokémon on this side to its rank-1 IVs for the league">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" fill="currentColor" /></svg>
          MAX RANK
        </button>
        <button type="button" className="bm-btn is-ghost" disabled={!entries.length}
          onClick={() => { replace([], 'Clear'); setFill(''); }}>
          Clear
        </button>
        {undo && (
          <span className="bm-undo" role="status">
            {undo.what === 'Clear' ? `Cleared ${undo.entries.length}` : `Replaced ${undo.entries.length} with ${undo.what}`}
            <button type="button" className="bm-link" onClick={() => { put(undo.entries); setUndo(null); setFill(''); }}>Undo</button>
          </span>
        )}
      </footer>

      {modal && (
        <AddPokemonModal
          league={league}
          buddy
          initial={modal.edit ? initialOf(modal.edit) : undefined}
          commitLabel={id === 'left' ? 'Add to your Pokémon' : 'Add to opponents'}
          onCommit={commit}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}

/** Every charged move a card may pick: the species' pool, without Return on a Shadow (it cannot keep it). */
function chargePool(ref: string): ChargeMove[] {
  const sp = speciesOf(ref)!;
  const shadow = parseRef(ref).shadow;
  const seen = new Set<string>();
  return chargesOf(sp.chargeMove, sp.chargeMove2).concat(sp.chargeMoves)
    .filter((c) => (shadow && c.id === RETURN_ID) || seen.has(c.id) ? false : (seen.add(c.id), true));
}

const fastOption = (m: FastMove): FancyOption => ({
  value: m.id,
  label: m.name,
  hint: m.archetype ?? undefined,
  lead: <TypeIcon type={m.type} size={16} />,
  trail: <span className="fs-fig">{m.turns}t · {(m.energyGain / m.turns).toFixed(1)}<i>e/t</i></span>,
});
const chargeOption = (c: ChargeMove): FancyOption => ({
  value: c.id,
  label: c.name,
  hint: c.archetype ?? undefined,
  lead: <TypeIcon type={c.type} size={16} />,
  trail: <span className="fs-fig">{c.energy}<i>e</i> · {(c.power / c.energy).toFixed(2)}<i>dpe</i></span>,
});
const NONE: FancyOption = { value: '', label: 'None', hint: 'One charged move only' };

/**
 * One Pokémon on a side: a tall, narrow card, so a side holds a grid of them. Moves and IVs are edited right here —
 * the dialog (opened from the sprite) is for changing the species or form.
 */
function MatrixCard({ index, mon, leaving, onEdit, onChange, onCopy, onRemove }: {
  index: number;
  mon: ResolvedMon;
  leaving: boolean;
  onEdit: () => void;
  onChange: (next: MatrixEntry) => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const { entry, stats } = mon;
  const sp = speciesOf(entry.ref)!;
  const name = displayName(entry.ref);
  const pool = chargePool(entry.ref);
  const picked = mon.charges.map((c) => c.id);
  const shadow = parseRef(entry.ref).shadow;
  // Choosing one charged move spells out both, so the other stops following the league's rated set.
  const setCharge = (slot: 0 | 1, id: string) => {
    const next = [...picked];
    if (id) next[slot] = id;
    else next.splice(slot, 1);
    const clean = next.filter((x, i) => x && next.indexOf(x) === i);
    onChange({ ...entry, chargeIds: clean.length ? clean : picked.slice(0, 1) });
  };
  return (
    <li className={`bm-card${leaving ? ' is-leaving' : ''}${stats.rank === 1 ? ' is-rank1' : ''}`} style={{
      ['--t1' as string]: `var(--type-${sp.types[0]})`,
      ['--t2' as string]: `var(--type-${sp.types[1] ?? sp.types[0]})`,
      ['--i' as string]: Math.min(index, 12),
    }}>
      <div className="bm-card-top">
        <span className="bm-card-pos numeric">{index + 1}</span>
        <span className="bm-card-types">{sp.types.map((t) => <TypeIcon key={t} type={t} size={16} />)}</span>
        <span className="bm-card-actions">
          <button type="button" className="bm-icon" onClick={onCopy} aria-label={`Duplicate ${name}`} title="Duplicate (to compare another roll or moveset)">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M16 8V4H4v12h4" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
          <button type="button" className="bm-icon is-danger" onClick={onRemove} aria-label={`Remove ${name}`} title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </span>
      </div>
      <button type="button" className="bm-card-id" onClick={onEdit} title={`Change ${name}'s species or form`}>
        {/* The Analyze hero's stage in miniature: the sprite stands on a pool of its type's light. */}
        <span className={`bm-stage${shadow ? ' is-shadow' : ''}`}>
          <span className="bm-dex numeric">#{String(sp.dex).padStart(3, '0')}</span>
          {stats.rank === 1 && <span className="bm-rank1" title="Rank 1 roll for this league">MAX</span>}
          <Sprite sprite={sp.sprite} dex={sp.dex} size={96} shadow={shadow} bestBuddy={!!entry.bestBuddy} className="sprite-holo" />
          <span className="bm-stage-edit" aria-hidden="true">Change</span>
        </span>
        <span className="bm-card-name">{name}</span>
      </button>
      <span className="bm-card-stats numeric">
        <span title="Level"><i>LV</i>{stats.lvl}</span>
        <span title="CP"><i>CP</i>{stats.cp}</span>
        <span title="Rank of this roll in the league"><i>RANK</i>{stats.rank}</span>
      </span>

      <div className="bm-moves">
        <div className="bm-move">
          <span className="bm-move-k">Fast</span>
          <FancySelect size="sm" value={mon.fast.id} label={`${name} fast move`} options={sp.fastMoves.map(fastOption)}
            onChange={(v) => onChange({ ...entry, fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === v)) })} />
        </div>
        {([0, 1] as const).map((slot) => (
          <div key={slot} className="bm-move">
            <span className="bm-move-k">Charged {slot + 1}</span>
            <FancySelect size="sm" value={picked[slot] ?? ''} label={`${name} charged move ${slot + 1}`}
              options={[
                ...(slot === 1 ? [NONE] : []),
                ...pool.filter((c) => c.id === picked[slot] || !picked.includes(c.id)).map(chargeOption),
              ]}
              onChange={(v) => setCharge(slot, v)} />
          </div>
        ))}
      </div>

      <div className="bm-ivs" role="group" aria-label={`${name} IVs`}>
        <IVAdjuster
          iv={entry.iv}
          size={20}
          icons
          onBump={(k, d) => onChange({ ...entry, iv: { ...entry.iv, [k]: Math.max(0, Math.min(15, entry.iv[k] + d)) } })}
          onSet={(k, v) => onChange({ ...entry, iv: { ...entry.iv, [k]: v } })}
        />
      </div>
    </li>
  );
}
