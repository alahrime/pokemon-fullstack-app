import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Sprite } from './Sprite';
import { FancySelect, type FancyOption } from './FancySelect';
import { ShieldIcon, SwordIcon, TrophyIcon } from './Icons';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { downloadCsv, stamp } from '../lib/exportData';
import { useAppState } from '../state/AppState';
import { useSlidingMarker } from '../lib/useSlidingMarker';
import {
  CMP_DIFF_LABEL, DIFF_LABEL, METRICS, MOVE_SLOTS, SLOT_LABEL, averageOf, diffsOf, higherIsBetter, ivText, movesetAbbr, recordOf,
  resultOf, toneOf, valueOf, type Diff, type MatrixCell, type Metric, type MoveSlot, type Outcome, type ResolvedMon,
} from '../lib/battleMatrix';
import type { LeagueId } from '../lib/types';

/**
 * The Matrix's results: a table of every pairing in one of four views, and under it the Differences — each row
 * against a baseline row, naming the columns where a matchup, breakpoint, bulkpoint or CMP was gained or lost.
 *
 * Pointing at a cell lights its row and column; pressing it opens that exact matchup (builds, shields, timing) on the
 * 1v1 tab, where it can be played out turn by turn.
 */

const GLYPH: Record<Outcome, string> = { win: '●', tie: '⨯⨯', loss: '✕' };
const OUTCOME_WORD: Record<Outcome, string> = { win: 'win', tie: 'double KO', loss: 'loss' };
/** CMP view only: who throws first when both throw on the same turn. */
const CMP_MARK: Record<Outcome, string> = { win: '▲', tie: '=', loss: '▼' };
const CMP_WORD: Record<Outcome, string> = { win: 'won (throws first)', tie: 'tied (both resolve)', loss: 'lost (throws second)' };

function BoltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}
const METRIC_ICON: Record<Metric, ReactNode> = {
  rating: <TrophyIcon size={16} />,
  break: <SwordIcon size={16} />,
  bulk: <ShieldIcon size={16} />,
  attack: <BoltIcon />,
};

type SortKey = number | 'record' | 'avg';

function fmt(v: number | null, metric: Metric): string {
  if (v === null) return '—';
  if (metric === 'attack') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
  return Math.round(v).toString();
}
const fmtAvg = (v: number | null, metric: Metric) =>
  v === null ? '—' : metric === 'rating' ? v.toFixed(1) : metric === 'attack' ? fmt(v, metric) : v.toFixed(2);

function Face({ mon, size }: { mon: ResolvedMon; size: number }) {
  const sp = speciesOf(mon.entry.ref)!;
  return <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(mon.entry.ref).shadow} />;
}

function MonLabel({ mon, sprite = 28 }: { mon: ResolvedMon; sprite?: number }) {
  return (
    <>
      <Face mon={mon} size={sprite} />
      <span className="bm-label">
        <span className="bm-label-name">{displayName(mon.entry.ref)}</span>
        <span className="bm-label-sub">{movesetAbbr(mon)}</span>
        <span className="bm-label-sub numeric">{ivText(mon.entry.iv)}</span>
      </span>
    </>
  );
}

/** Wins, double KOs and losses as one bar, so a column of records reads as a chart. */
function RecordBar({ win, tie, loss }: { win: number; tie: number; loss: number }) {
  const n = win + tie + loss || 1;
  return (
    <span className="bm-recbar" aria-hidden="true">
      <i className="is-win" style={{ width: `${(win / n) * 100}%` }} />
      <i className="is-tie" style={{ width: `${(tie / n) * 100}%` }} />
      <i className="is-loss" style={{ width: `${(loss / n) * 100}%` }} />
    </span>
  );
}

const rowOption = (r: ResolvedMon, i: number): FancyOption => {
  const sp = speciesOf(r.entry.ref)!;
  return {
    value: r.entry.key,
    label: `${i + 1}. ${displayName(r.entry.ref)}`,
    hint: `${movesetAbbr(r)} · ${ivText(r.entry.iv)}`,
    lead: <Sprite sprite={sp.sprite} dex={sp.dex} size={26} shadow={parseRef(r.entry.ref).shadow} />,
  };
};

export function MatrixResults({ rows, cols, cells, league, stale, shields }: {
  rows: ResolvedMon[];
  cols: ResolvedMon[];
  cells: MatrixCell[][];
  league: LeagueId;
  stale: boolean;
  /** [left, right]: what the matrix was fought at, carried into a cell opened on the 1v1 tab. */
  shields: [number, number];
}) {
  const { state, patch } = useAppState();
  const [metric, setMetric] = useState<Metric>('rating');
  const [slot, setSlot] = useState<MoveSlot>('fast');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const [baseKey, setBaseKey] = useState<string | null>(null);
  const damage = metric === 'break' || metric === 'bulk';
  const lede = METRICS.find((m) => m.id === metric)!.lede;
  const { ref: tabsRef, box } = useSlidingMarker<HTMLDivElement>('.bm-tab.is-active');
  const table = useRef<HTMLTableElement>(null);
  const lit = useRef<number | null>(null);

  const records = useMemo(() => cells.map((r) => recordOf(r, metric)), [cells, metric]);
  const avgs = useMemo(() => cells.map((r) => averageOf(r, metric, slot)), [cells, metric, slot]);

  // Rows in display order: the list's own order until a column is chosen.
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!sort) return idx;
    const score = (i: number): number => {
      if (sort.key === 'record') return records[i].win * 2 + records[i].tie;
      const v = sort.key === 'avg' ? avgs[i] : cells[i]?.[sort.key] ? valueOf(cells[i][sort.key], metric, slot) : null;
      if (v === null) return Number.NEGATIVE_INFINITY;
      // Bulkpoints rank least damage taken first; flipping the value keeps one comparator for every view.
      return higherIsBetter(metric) ? v : -v;
    };
    return idx.sort((a, b) => (sort.desc ? score(b) - score(a) : score(a) - score(b)));
  }, [rows, sort, records, avgs, cells, metric, slot]);

  // The leader: best record, then best average. Crowned in the table and named in the summary.
  const leader = useMemo(() => {
    let best = -1;
    let at = -1;
    records.forEach((r, i) => {
      const a = avgs[i] ?? 0;
      const s = (r.win * 2 + r.tie) * 1e6 + (higherIsBetter(metric) ? a : -a);
      if (s > best || at < 0) { best = s; at = i; }
    });
    return at;
  }, [records, avgs, metric]);

  const sortBy = (key: SortKey) => setSort((s) => (s && s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const ariaSort = (key: SortKey) => (sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined);

  const baseIdx = Math.max(0, rows.findIndex((r) => r.entry.key === baseKey));

  // The column crosshair, painted straight onto the cells: re-rendering 1600 of them per pointer move is not free.
  const light = (j: number | null) => {
    if (lit.current === j) return;
    const t = table.current;
    if (!t) return;
    if (lit.current !== null) t.querySelectorAll(`[data-col="${lit.current}"]`).forEach((el) => el.classList.remove('is-col-lit'));
    if (j !== null) t.querySelectorAll(`[data-col="${j}"]`).forEach((el) => el.classList.add('is-col-lit'));
    lit.current = j;
  };

  /** Hand this exact pairing to the 1v1 tab: both builds, the shields it was fought at, and fresh HP and energy. */
  const open = (r: ResolvedMon, c: ResolvedMon) => {
    patch({
      battleMode: 'single',
      battleA: r.entry.ref, battleB: c.entry.ref,
      ivA: r.entry.iv, ivB: c.entry.iv,
      fastA: r.entry.fastIdx, fastB: c.entry.fastIdx,
      chargeIdsA: r.charges.map((m) => m.id), chargeIdsB: c.charges.map((m) => m.id),
      bestBuddyA: !!r.entry.bestBuddy, bestBuddyB: !!c.entry.bestBuddy,
      shieldsA: shields[0], shieldsB: shields[1],
      energyA: 0, energyB: 0, startHpA: null, startHpB: null,
      baitA: 1, baitB: 1, stagesA: { atk: 0, def: 0 }, stagesB: { atk: 0, def: 0 },
    });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ }
  };

  const exportCsv = () => {
    const head = (m: ResolvedMon, i: number) => `${i + 1}. ${displayName(m.entry.ref)} ${movesetAbbr(m)} ${ivText(m.entry.iv)}`;
    downloadCsv(`matrix-${league}-${metric}${damage ? `-${slot}` : ''}-${stamp()}`, rows.map((r, i) => ({
      Pokemon: displayName(r.entry.ref),
      Moves: movesetAbbr(r),
      IVs: ivText(r.entry.iv),
      Level: r.stats.lvl,
      CP: r.stats.cp,
      ...Object.fromEntries(cols.map((c, j) => [head(c, j), valueOf(cells[i][j], metric, slot) ?? ''])),
      Record: `${records[i].win}-${records[i].loss}-${records[i].tie}`,
      Average: avgs[i] === null ? '' : Number(avgs[i]!.toFixed(2)),
    })));
  };

  const total = rows.length * cols.length;
  const wins = records.reduce((n, r) => n + r.win, 0);
  const lead = rows[leader];

  return (
    <div className={`bm-results${stale ? ' is-stale' : ''}`} aria-busy={stale}>
      <section className="panel bm-panel" aria-label="Matchups">
        <div className="bm-summary">
          <span className="bm-stat-tile"><i>Pairings</i><b className="numeric">{total}</b></span>
          <span className="bm-stat-tile"><i>{metric === 'attack' ? 'CMP won' : 'Won'}</i><b className="numeric">{total ? Math.round((wins / total) * 100) : 0}%</b></span>
          <span className="bm-stat-tile"><i>Shields</i><b className="numeric">{shields[0]} v {shields[1]}</b></span>
          {lead && (
            <span className="bm-stat-tile is-leader">
              <i>Leads this view</i>
              <span className="bm-leader"><Face mon={lead} size={28} /><b>{displayName(lead.entry.ref)}</b><small className="numeric">{ivText(lead.entry.iv)}</small></span>
            </span>
          )}
          <span className="bm-timing" role="group" aria-label="Charge timing">
            <span className="hud-label">Charge timing</span>
            <span className="bm-pill-toggle">
              <button type="button" aria-pressed={!state.optimizeTiming} className={!state.optimizeTiming ? 'is-on' : ''}
                onClick={() => patch({ optimizeTiming: false })} title="Throw the moment a charged move is ready">ASAP</button>
              <button type="button" aria-pressed={state.optimizeTiming} className={state.optimizeTiming ? 'is-on' : ''}
                onClick={() => patch({ optimizeTiming: true })} title="Hold for the turn the opponent's fast move registers (same setting as 1v1)">Optimal</button>
            </span>
          </span>
        </div>

        <div className={`bm-tabs${box ? ' has-marker' : ''}`} role="tablist" aria-label="Matrix view" ref={tabsRef}>
          {box && <span className="bm-tab-marker" aria-hidden="true" style={{ transform: `translateX(${box.x}px)`, width: `${box.w}px` }} />}
          {METRICS.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={metric === m.id}
              className={`bm-tab${metric === m.id ? ' is-active' : ''}`} onClick={() => setMetric(m.id)}>
              {METRIC_ICON[m.id]}<span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="bm-view-head">
          <p className="bm-lede text-faint">{lede} Press a cell to play it out on 1v1.</p>
          {damage && (
            <div className="bm-slot">
              <span className="hud-label">Move</span>
              <FancySelect value={slot} label="Move" onChange={(v) => setSlot(v as MoveSlot)}
                options={MOVE_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s], hint: s === 'fast' ? 'Every fast move hit' : 'One charged move landing' }))} />
            </div>
          )}
        </div>

        <div className="bm-scroll" onMouseLeave={() => light(null)}>
          <table className="bm-table" ref={table}>
            <thead>
              <tr>
                <th className="bm-corner" scope="col">
                  <button type="button" className="bm-sort" onClick={() => setSort(null)} title="Back to list order">
                    {sort ? '↺ List order' : 'Pokémon'}
                  </button>
                </th>
                {cols.map((c, j) => (
                  <th key={c.entry.key} scope="col" className="bm-colhead" aria-sort={ariaSort(j)} data-col={j} onMouseEnter={() => light(j)}>
                    <button type="button" className={`bm-sort${sort?.key === j ? ' is-sorted' : ''}`} onClick={() => sortBy(j)}
                      title={`Sort by ${displayName(c.entry.ref)}`}>
                      <MonLabel mon={c} sprite={34} />
                      {sort?.key === j && <span className="bm-arrow" aria-hidden="true">{sort.desc ? '▼' : '▲'}</span>}
                    </button>
                  </th>
                ))}
                <th scope="col" className="bm-stathead" aria-sort={ariaSort('record')}>
                  <button type="button" className={`bm-sort${sort?.key === 'record' ? ' is-sorted' : ''}`} onClick={() => sortBy('record')}>{metric === 'attack' ? 'CMP Record' : 'Record'}<br /><small>W-L-T</small></button>
                </th>
                <th scope="col" className="bm-stathead" aria-sort={ariaSort('avg')}>
                  <button type="button" className={`bm-sort${sort?.key === 'avg' ? ' is-sorted' : ''}`} onClick={() => sortBy('avg')}>Average</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {order.map((i, pos) => {
                const r = rows[i];
                return (
                  <tr key={r.entry.key} className={`${i === baseIdx ? 'is-base' : ''}${i === leader ? ' is-leader' : ''}`} style={{ ['--row' as string]: Math.min(pos, 14) }}>
                    <th scope="row" className="bm-rowhead">
                      <span className="bm-pos numeric">{i + 1}</span>
                      {i === leader && <span className="bm-crown" title="Leads this view" aria-label="Leads this view">♛</span>}
                      <MonLabel mon={r} />
                    </th>
                    {cols.map((c, j) => {
                      const cell = cells[i]?.[j];
                      if (!cell) return <td key={c.entry.key} />;
                      const tone = toneOf(cell);
                      const v = valueOf(cell, metric, slot);
                      const cmp = metric === 'attack' ? resultOf(cell, metric) : null;
                      const label = `${displayName(r.entry.ref)} vs ${displayName(c.entry.ref)}: ${fmt(v, metric)}`
                        + `${cmp ? `, CMP ${CMP_WORD[cmp]}` : ''}, battle ${OUTCOME_WORD[tone]}. Open in 1v1`;
                      return (
                        <td key={c.entry.key} className="bm-cell" data-col={j} onMouseEnter={() => light(j)}>
                          <button type="button" className={`bm-val is-${tone}`} title={label} aria-label={label} onClick={() => open(r, c)}>
                            {/* Keyed on what it shows, so a cell that changes flashes once and the rest stay put. */}
                            <span key={`${metric}|${slot}|${v}|${tone}`} className="bm-val-in">
                              <i aria-hidden="true">{GLYPH[tone]}</i>
                              {cmp && <b className={`bm-cmp is-${cmp}`} aria-hidden="true">{CMP_MARK[cmp]}</b>}
                              {fmt(v, metric)}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                    <td className="bm-stat numeric">
                      {records[i].win}-{records[i].loss}-{records[i].tie}
                      <RecordBar {...records[i]} />
                    </td>
                    <td className="bm-stat numeric">{fmtAvg(avgs[i], metric)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bm-foot">
          <button type="button" className="bm-btn is-primary" onClick={exportCsv}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Export to CSV
          </button>
          <span className="bm-key text-faint">
            {(['win', 'tie', 'loss'] as const).map((o) => (
              <span key={o} className="bm-key-item"><span className={`bm-val is-${o} is-swatch`} aria-hidden="true"><i>{GLYPH[o]}</i></span>{o === 'tie' ? 'simultaneous KO' : `battle ${o}`}</span>
            ))}
            {metric === 'attack' && (['win', 'tie', 'loss'] as const).map((o) => (
              <span key={`c${o}`} className="bm-key-item"><b className={`bm-cmp is-${o}`} aria-hidden="true">{CMP_MARK[o]}</b>CMP {o}</span>
            ))}
          </span>
        </div>
      </section>

      <Differences rows={rows} cols={cols} cells={cells} metric={metric} slot={slot} baseIdx={baseIdx} onBase={setBaseKey} />
    </div>
  );
}

const KIND_SIGN = (d: Diff) => (d.kind.startsWith('gain') ? '+' : '−');

function Differences({ rows, cols, cells, metric, slot, baseIdx, onBase }: {
  rows: ResolvedMon[];
  cols: ResolvedMon[];
  cells: MatrixCell[][];
  metric: Metric;
  slot: MoveSlot;
  baseIdx: number;
  onBase: (key: string) => void;
}) {
  const damage = metric === 'break' || metric === 'bulk';
  const kinds = damage ? (['gain', 'drop'] as const) : (['gain-win', 'gain-tie', 'drop-tie', 'drop-loss'] as const);
  const what = metric === 'rating' ? 'matchups' : metric === 'break' ? 'breakpoints' : metric === 'bulk' ? 'bulkpoints' : 'charge-move priority';
  const base = rows[baseIdx];
  const label = (k: (typeof kinds)[number]) =>
    damage ? (k === 'gain' ? (metric === 'break' ? 'Breakpoint gained' : 'Bulkpoint gained') : (metric === 'break' ? 'Breakpoint lost' : 'Bulkpoint lost'))
      : metric === 'attack' ? CMP_DIFF_LABEL[k] : DIFF_LABEL[k];

  return (
    <section className="panel bm-panel" aria-label="Differences">
      <div className="bm-diff-head">
        <div>
          <h2 className="bm-side-title">Differences</h2>
          <p className="bm-lede text-faint">
            Where each Pokémon's {what} differ from the baseline's{damage ? ` (${SLOT_LABEL[slot].toLowerCase()})` : ''}, at these shields.
            Press a Pokémon to make it the baseline.
          </p>
        </div>
        <div className="bm-fill">
          <span className="hud-label">Compare against</span>
          <FancySelect value={base.entry.key} label="Compare against" onChange={onBase} showHint options={rows.map(rowOption)} />
        </div>
      </div>
      <div className="bm-key text-faint">
        {kinds.map((k) => (
          <span key={k} className="bm-key-item"><span className={`bm-chip is-${k} is-swatch`} aria-hidden="true" />{label(k)}</span>
        ))}
      </div>
      {rows.length < 2 ? (
        <p className="text-faint">Add a second Pokémon on the left to compare it against the first.</p>
      ) : (
        <ol className="bm-diffs">
          {rows.map((r, i) => {
            const isBase = i === baseIdx;
            const diffs = isBase ? [] : diffsOf(cells[baseIdx], cells[i], metric, slot);
            const up = diffs.filter((d) => d.kind.startsWith('gain')).length;
            const down = diffs.length - up;
            return (
              <li key={r.entry.key} className={`bm-diff-row${isBase ? ' is-base' : ''}`}>
                <button type="button" className="bm-diff-who" onClick={() => onBase(r.entry.key)} disabled={isBase}
                  title={isBase ? 'The baseline' : `Compare everything against ${displayName(r.entry.ref)}`}>
                  <span className="bm-pos numeric">{i + 1}</span>
                  <MonLabel mon={r} />
                  {!isBase && diffs.length > 0 && (
                    <span className="bm-tally numeric" aria-label={`${up} gained, ${down} lost`}>
                      {up > 0 && <b className="is-up">+{up}</b>}
                      {down > 0 && <b className="is-down">−{down}</b>}
                    </span>
                  )}
                </button>
                <span className="bm-diff-chips">
                  {isBase ? (
                    <span className="bm-base-tag">Baseline</span>
                  ) : diffs.length === 0 ? (
                    <span className="text-faint">No differences</span>
                  ) : diffs.map((d, n) => {
                    const c = cols[d.col];
                    const name = displayName(c.entry.ref);
                    const delta = d.delta !== undefined ? ` (${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} damage)` : '';
                    return (
                      <span key={c.entry.key} className={`bm-chip is-${d.kind}`} title={`${label(d.kind)}: ${name}${delta}`}
                        style={{ ['--i' as string]: Math.min(n, 16) }}>
                        <b aria-hidden="true">{KIND_SIGN(d)}</b>
                        <Face mon={c} size={24} />
                        <span className="bm-chip-text">
                          <span className="bm-chip-name"><span className="sr-only">{label(d.kind)}: </span>{name}</span>
                          <small>{movesetAbbr(c)}{d.delta !== undefined && ` · ${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)}`}</small>
                        </span>
                      </span>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
