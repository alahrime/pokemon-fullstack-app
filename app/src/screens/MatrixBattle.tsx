import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { BattleModeTabs } from '../components/BattleModeTabs';
import { AddPokemonModal, RETURN_ID, type AddPokemonChoice } from '../components/AddPokemonModal';
import { MatrixResults } from '../components/MatrixResults';
import { SegButton, SegGroup } from '../components/Seg';
import { Sprite } from '../components/Sprite';
import { IVAdjuster } from '../components/IVAdjuster';
import { useAppState } from '../state/AppState';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { chargesOf } from '../lib/engine';
import {
  atRankOne, chargesFor, isUsable, matrix, newKey, quickFillRefs, quickFills, ratedEntry, resolve,
  type MatrixEntry, type ResolvedMon,
} from '../lib/battleMatrix';
import type { ChargeMove, LeagueId } from '../lib/types';

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

  const left = useMemo(() => sides.left.entries.map((e) => resolve(e, league)), [sides.left.entries, league]);
  const right = useMemo(() => sides.right.entries.map((e) => resolve(e, league)), [sides.right.entries, league]);
  // A 40 × 40 matrix is 1600 battles; deferring keeps typing an IV responsive while it re-runs.
  const live = useMemo(
    () => ({ left, right, sl: sides.left.shields, sr: sides.right.shields }),
    [left, right, sides.left.shields, sides.right.shields],
  );
  const input = useDeferredValue(live);
  const cells = useMemo(() => matrix(input.left, input.right, input.sl, input.sr), [input]);
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
          id="left"
          title="Your Pokémon"
          note="Rows: the Pokémon being compared"
          league={league}
          state={sides.left}
          mons={left}
          onChange={(next) => setSide('left', next)}
        />
        <MatrixSide
          id="right"
          title="Opponents"
          note="Columns: the group they face"
          league={league}
          state={sides.right}
          mons={right}
          onChange={(next) => setSide('right', next)}
        />
      </div>
      {left.length > 0 && right.length > 0 ? (
        <MatrixResults rows={input.left} cols={input.right} cells={cells} league={league} stale={stale} />
      ) : (
        <p className="bm-empty text-faint">
          Add at least one Pokémon on each side to see the matrix. Quick Fill puts a whole meta on a side at once.
        </p>
      )}
    </>
  );
}

function MatrixSide({ id, title, note, league, state, mons, onChange }: {
  id: SideId;
  title: string;
  note: string;
  league: LeagueId;
  state: SideState;
  mons: ResolvedMon[];
  onChange: (next: Partial<SideState>) => void;
}) {
  const [modal, setModal] = useState<{ edit: MatrixEntry | null } | null>(null);
  const [fill, setFill] = useState('');
  const fills = quickFills(league);
  const { entries } = state;
  const put = (list: MatrixEntry[]) => onChange({ entries: list });

  const commit = (choice: AddPokemonChoice) => {
    const base = { ref: choice.ref, fastIdx: choice.fastIdx, chargeIds: choice.chargeIds, iv: choice.iv, ...(choice.bestBuddy ? { bestBuddy: true } : {}) };
    if (modal?.edit) put(entries.map((e) => (e.key === modal.edit!.key ? { key: e.key, ...base } : e)));
    else put([...entries, { key: newKey(), ...base }]);
  };

  const initialOf = (e: MatrixEntry): AddPokemonChoice => ({
    ref: e.ref,
    fastIdx: e.fastIdx,
    // The modal shows the moves it is given, so a rated (empty) pick is spelled out as the moves it stands for.
    chargeIds: e.chargeIds.length ? e.chargeIds : chargesFor(e, league).map((c) => c.id),
    iv: e.iv,
    bestBuddy: e.bestBuddy,
  });

  return (
    <section className={`panel bm-side is-${id}`} aria-label={title}>
      <header className="bm-side-head">
        <div>
          <h2 className="bm-side-title">{title} <span className="numeric text-faint">({entries.length})</span></h2>
          <p className="bm-side-note text-faint">{note}</p>
        </div>
        <div>
          <div className="hud-label">Shields</div>
          <SegGroup>
            {[0, 1, 2].map((n) => (
              <SegButton key={n} active={state.shields === n} onClick={() => onChange({ shields: n })} title={`${n} shield${n === 1 ? '' : 's'}`}>
                {n}
              </SegButton>
            ))}
          </SegGroup>
        </div>
      </header>

      <div className="bm-side-tools">
        <label className="bm-fill">
          <span className="hud-label">Quick Fill</span>
          <select
            className="bm-select"
            value={fill}
            aria-label={`Quick fill ${title}`}
            onChange={(e) => {
              const key = e.target.value;
              setFill(key);
              if (key) put(quickFillRefs(key, league).map((r) => ratedEntry(r, league)));
            }}
          >
            <option value="">Choose a group…</option>
            {fills.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <div className="bm-side-actions">
          <button type="button" className="btn btn-sm is-primary" onClick={() => setModal({ edit: null })}>+ Add Pokémon</button>
          <button type="button" className="btn btn-sm chip-btn" disabled={!entries.length}
            onClick={() => put(entries.map((e) => atRankOne(e, league)))}
            title="Set every Pokémon on this side to its rank-1 IVs for the league">
            All rank 1
          </button>
          <button type="button" className="btn btn-sm chip-btn" disabled={!entries.length}
            onClick={() => { put([]); setFill(''); }}>
            Clear
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="bm-side-empty text-faint">No Pokémon yet.</p>
      ) : (
        <ol className="bm-list">
          {mons.map((m, i) => (
            <MatrixCard
              key={m.entry.key}
              index={i}
              mon={m}
              onEdit={() => setModal({ edit: m.entry })}
              onChange={(next) => put(entries.map((e) => (e.key === m.entry.key ? next : e)))}
              onCopy={() => put([...entries.slice(0, i + 1), { ...m.entry, key: newKey() }, ...entries.slice(i + 1)])}
              onRemove={() => put(entries.filter((e) => e.key !== m.entry.key))}
            />
          ))}
        </ol>
      )}

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

/**
 * One Pokémon on a side: a tall, narrow card, so a side holds a grid of them. Moves and IVs are edited right here —
 * the dialog (opened from the name) is for changing the species or form.
 */
function MatrixCard({ index, mon, onEdit, onChange, onCopy, onRemove }: {
  index: number;
  mon: ResolvedMon;
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
  // Choosing one charged move spells out both, so the other stops following the league's rated set.
  const setCharge = (slot: 0 | 1, id: string) => {
    const next = [...picked];
    if (id) next[slot] = id;
    else next.splice(slot, 1);
    const clean = next.filter((x, i) => x && next.indexOf(x) === i);
    onChange({ ...entry, chargeIds: clean.length ? clean : picked.slice(0, 1) });
  };
  return (
    <li className="bm-card" style={{
      ['--t1' as string]: `var(--type-${sp.types[0]})`,
      ['--t2' as string]: `var(--type-${sp.types[1] ?? sp.types[0]})`,
    }}>
      <div className="bm-card-top">
        <span className="bm-card-pos numeric">{index + 1}</span>
        <span className="bm-card-actions">
          <button type="button" className="btn btn-sm bm-icon" onClick={onCopy} aria-label={`Duplicate ${name}`} title="Duplicate (to compare another roll or moveset)">⧉</button>
          <button type="button" className="btn btn-sm bm-icon" onClick={onRemove} aria-label={`Remove ${name}`} title="Remove">✕</button>
        </span>
      </div>
      <button type="button" className="bm-card-id" onClick={onEdit} title={`Change ${name}'s species or form`}>
        {/* The Analyze hero's stage in miniature: the sprite stands on a pool of its type's light. */}
        <span className={`bm-stage${parseRef(entry.ref).shadow ? ' is-shadow' : ''}`}>
          <span className="bm-dex numeric">#{String(sp.dex).padStart(3, '0')}</span>
          <Sprite sprite={sp.sprite} dex={sp.dex} size={96} shadow={parseRef(entry.ref).shadow} bestBuddy={!!entry.bestBuddy} className="sprite-holo" />
        </span>
        <span className="bm-card-name">{name}</span>
      </button>
      <span className="bm-card-stats numeric">
        <span title="Level">L{stats.lvl}</span>
        <span title="CP">{stats.cp} CP</span>
        <span title="Rank of this roll in the league">#{stats.rank}</span>
      </span>

      <div className="bm-moves">
        <label className="bm-move">
          <span className="bm-move-k">Fast</span>
          <select className="bm-select" value={mon.fast.id} aria-label={`${name} fast move`}
            onChange={(e) => onChange({ ...entry, fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === e.target.value)) })}>
            {sp.fastMoves.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        {([0, 1] as const).map((slot) => (
          <label key={slot} className="bm-move">
            <span className="bm-move-k">Charged {slot + 1}</span>
            <select className="bm-select" value={picked[slot] ?? ''} aria-label={`${name} charged move ${slot + 1}`}
              onChange={(e) => setCharge(slot, e.target.value)}>
              {slot === 1 && <option value="">None</option>}
              {pool.filter((c) => c.id === picked[slot] || !picked.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
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
