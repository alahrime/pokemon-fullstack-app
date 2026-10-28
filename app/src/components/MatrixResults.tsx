import { useMemo, useState } from 'react';
import { Sprite } from './Sprite';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { downloadCsv, stamp } from '../lib/exportData';
import {
  CMP_DIFF_LABEL, DIFF_LABEL, METRICS, MOVE_SLOTS, SLOT_LABEL, averageOf, diffsOf, higherIsBetter, ivText, movesetAbbr, recordOf,
  resultOf, toneOf, valueOf, type Diff, type MatrixCell, type Metric, type MoveSlot, type Outcome, type ResolvedMon,
} from '../lib/battleMatrix';
import type { LeagueId } from '../lib/types';

/**
 * The Matrix's results: a table of every pairing in one of four views, and under it the Differences — each row
 * against a baseline row, naming the columns where a matchup, breakpoint, bulkpoint or CMP was gained or lost.
 */

const GLYPH: Record<Outcome, string> = { win: '●', tie: '⨯⨯', loss: '✕' };
const OUTCOME_WORD: Record<Outcome, string> = { win: 'win', tie: 'double KO', loss: 'loss' };
/** CMP view only: who throws first when both throw on the same turn. */
const CMP_MARK: Record<Outcome, string> = { win: '▲', tie: '=', loss: '▼' };
const CMP_WORD: Record<Outcome, string> = { win: 'won (throws first)', tie: 'tied (both resolve)', loss: 'lost (throws second)' };

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

export function MatrixResults({ rows, cols, cells, league, stale }: {
  rows: ResolvedMon[];
  cols: ResolvedMon[];
  cells: MatrixCell[][];
  league: LeagueId;
  stale: boolean;
}) {
  const [metric, setMetric] = useState<Metric>('rating');
  const [slot, setSlot] = useState<MoveSlot>('fast');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const [baseKey, setBaseKey] = useState<string | null>(null);
  const damage = metric === 'break' || metric === 'bulk';
  const lede = METRICS.find((m) => m.id === metric)!.lede;

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

  const sortBy = (key: SortKey) => setSort((s) => (s && s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const ariaSort = (key: SortKey) => (sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined);

  const baseIdx = Math.max(0, rows.findIndex((r) => r.entry.key === baseKey));

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

  return (
    <div className={`bm-results${stale ? ' is-stale' : ''}`} aria-busy={stale}>
      <section className="panel bm-panel" aria-label="Matchups">
        <div className="bm-tabs" role="tablist" aria-label="Matrix view">
          {METRICS.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={metric === m.id}
              className={`btn chip-btn${metric === m.id ? ' is-active' : ''}`} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="bm-lede text-faint">{lede}</p>
        {damage && (
          <label className="bm-slot">
            <span className="hud-label">Move</span>
            <select className="bm-select" value={slot} onChange={(e) => setSlot(e.target.value as MoveSlot)} aria-label="Move">
              {MOVE_SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
            </select>
          </label>
        )}

        <div className="bm-scroll">
          <table className="bm-table">
            <thead>
              <tr>
                <th className="bm-corner" scope="col">
                  <button type="button" className="bm-sort" onClick={() => setSort(null)} title="Back to list order">
                    {sort ? '↺ List order' : 'Pokémon'}
                  </button>
                </th>
                {cols.map((c, j) => (
                  <th key={c.entry.key} scope="col" className="bm-colhead" aria-sort={ariaSort(j)}>
                    <button type="button" className={`bm-sort${sort?.key === j ? ' is-sorted' : ''}`} onClick={() => sortBy(j)}
                      title={`Sort by ${displayName(c.entry.ref)}`}>
                      <MonLabel mon={c} sprite={30} />
                      {sort?.key === j && <span className="bm-arrow" aria-hidden="true">{sort.desc ? '▼' : '▲'}</span>}
                    </button>
                  </th>
                ))}
                <th scope="col" className="bm-stathead" aria-sort={ariaSort('record')}>
                  <button type="button" className="bm-sort" onClick={() => sortBy('record')}>{metric === 'attack' ? 'CMP Record' : 'Record'}<br /><small>W-L-T</small></button>
                </th>
                <th scope="col" className="bm-stathead" aria-sort={ariaSort('avg')}>
                  <button type="button" className="bm-sort" onClick={() => sortBy('avg')}>Average</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {order.map((i) => {
                const r = rows[i];
                return (
                  <tr key={r.entry.key} className={i === baseIdx ? 'is-base' : undefined}>
                    <th scope="row" className="bm-rowhead">
                      <span className="bm-pos numeric">{i + 1}</span>
                      <MonLabel mon={r} />
                    </th>
                    {cols.map((c, j) => {
                      const cell = cells[i]?.[j];
                      if (!cell) return <td key={c.entry.key} />;
                      const tone = toneOf(cell);
                      const v = valueOf(cell, metric, slot);
                      const cmp = metric === 'attack' ? resultOf(cell, metric) : null;
                      const label = `${displayName(r.entry.ref)} vs ${displayName(c.entry.ref)}: ${fmt(v, metric)}`
                        + `${cmp ? `, CMP ${CMP_WORD[cmp]}` : ''}, battle ${OUTCOME_WORD[tone]}`;
                      return (
                        <td key={c.entry.key} className="bm-cell">
                          <span className={`bm-val is-${tone}`} title={label} aria-label={label}>
                            <i aria-hidden="true">{GLYPH[tone]}</i>
                            {cmp && <b className={`bm-cmp is-${cmp}`} aria-hidden="true">{CMP_MARK[cmp]}</b>}
                            {fmt(v, metric)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="bm-stat numeric">{records[i].win}-{records[i].loss}-{records[i].tie}</td>
                    <td className="bm-stat numeric">{fmtAvg(avgs[i], metric)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bm-foot">
          <button type="button" className="btn btn-sm is-primary" onClick={exportCsv}>Export to CSV</button>
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
          </p>
        </div>
        <label className="bm-fill">
          <span className="hud-label">Compare against</span>
          <select className="bm-select" value={base.entry.key} onChange={(e) => onBase(e.target.value)} aria-label="Compare against">
            {rows.map((r, i) => (
              <option key={r.entry.key} value={r.entry.key}>{i + 1}. {displayName(r.entry.ref)} {movesetAbbr(r)} {ivText(r.entry.iv)}</option>
            ))}
          </select>
        </label>
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
            return (
              <li key={r.entry.key} className={`bm-diff-row${isBase ? ' is-base' : ''}`}>
                <span className="bm-diff-who">
                  <span className="bm-pos numeric">{i + 1}</span>
                  <MonLabel mon={r} />
                </span>
                <span className="bm-diff-chips">
                  {isBase ? (
                    <span className="text-faint">Baseline</span>
                  ) : diffs.length === 0 ? (
                    <span className="text-faint">No differences</span>
                  ) : diffs.map((d) => {
                    const c = cols[d.col];
                    const name = displayName(c.entry.ref);
                    const delta = d.delta !== undefined ? ` (${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} damage)` : '';
                    return (
                      <span key={c.entry.key} className={`bm-chip is-${d.kind}`} title={`${label(d.kind)}: ${name}${delta}`}>
                        <b aria-hidden="true">{KIND_SIGN(d)}</b>
                        <Face mon={c} size={22} />
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
