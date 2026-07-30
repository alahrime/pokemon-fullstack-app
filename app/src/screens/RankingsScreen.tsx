import { useMemo, useState } from 'react';
import { useAppState } from '../state/AppState';
import { CATEGORIES, type CategoryId } from '../lib/scenarios';
import { DEFAULT_TIER, ENGINE_REV, TIERS, rankingsFor, tierApplies, type RankOrder, type RankRow } from '../lib/rankings';
import { LEAGUE_BY_ID, parseRef, speciesOf } from '../lib/data';
import { Sprite } from '../components/Sprite';
import { TypeBadge } from '../components/TypeBadge';
import { SegButton, SegGroup } from '../components/Seg';
import { HeldOutNote } from '../components/HeldOutNote';

/** Rows per page. The full pool runs to 1140 in Great. */
const PAGE = 25;

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="rank-bar">
      <div className="rank-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Row({ row, i, max, expanded, onToggle }: {
  row: RankRow;
  i: number;
  max: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { shadow } = parseRef(row.ref);
  const sp = speciesOf(row.ref);
  const gain = row.bestScore - row.score;
  return (
    <>
      <tr className={`rank-row${expanded ? ' is-open' : ''}`} onClick={onToggle}>
        <td className="numeric rank-pos">{i}</td>
        <td>
          <div className="rank-name">
            {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={30} shadow={shadow} />}
            <div>
              <div className="rank-name-text">{row.name}</div>
              <div className="rank-types">{sp?.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
            </div>
          </div>
        </td>
        <td className="numeric rank-score">
          {row.score}
          <Bar value={row.score} max={max} />
        </td>
        <td className="numeric text-muted">{row.pvpokeRank === null ? '—' : `#${row.pvpokeRank}`}</td>
        <td
          className={`numeric rank-delta${row.delta === null ? '' : Math.abs(row.delta) < 10 ? '' : row.delta > 0 ? ' is-up' : ' is-down'}`}
          title={row.delta === null ? undefined : 'Places higher (+) or lower (−) than PvPoke ranks it'}
        >
          {row.delta === null ? '—' : row.delta === 0 ? '—' : `${row.delta > 0 ? '+' : ''}${row.delta}`}
        </td>
        <td className="numeric">
          {gain > 0 ? <span className="rank-gain">+{gain}</span> : <span className="text-faint">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="rank-detail-row">
          <td colSpan={6}>
            <div className="rank-detail">
              <div className="rank-detail-head">
                Every loadout swept, scored on Overall against the same opponent set.
                {!row.bestIsRecommended && (
                  <> The rated set is <strong>not</strong> the strongest here — that gap is the column on the right.</>
                )}
              </div>
              <ol className="rank-loadouts">
                {[...row.loadouts]
                  .map((l, idx) => ({ label: l[0], score: l[1], idx }))
                  .sort((a, b) => b.score - a.score)
                  .map((l) => (
                    <li key={l.idx} className={l.idx === 0 ? 'is-rated' : ''}>
                      <span className="rank-loadout-name">{l.label}</span>
                      {l.idx === 0 && <span className="tag tag-outline">rated</span>}
                      <span className="numeric rank-loadout-score">{l.score}</span>
                    </li>
                  ))}
              </ol>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function RankingsScreen() {
  const { state } = useAppState();
  const league = state.league;
  const [cat, setCat] = useState<CategoryId>('overall');
  const [tier, setTier] = useState<string>(() => DEFAULT_TIER(league));
  const [order, setOrder] = useState<RankOrder>('d1');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => rankingsFor(league, tier, cat, order), [league, tier, cat, order]);
  const max = rows[0]?.score ?? 1000;
  const pages = Math.ceil(rows.length / PAGE);
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const category = CATEGORIES.find((c) => c.id === cat)!;

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
    setOpen(null);
  };

  return (
    <div className="rankings">
      <div className="panel panel-strong rankings-controls">
        <div>
          <div className="hud-label">Category</div>
          <SegGroup>
            {CATEGORIES.map((c) => (
              <SegButton key={c.id} active={cat === c.id} onClick={() => reset(() => setCat(c.id))} title={c.blurb}>
                {c.label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <div>
          <div className="hud-label">Pass</div>
          <SegGroup>
            <SegButton
              active={order === 'd1'}
              onClick={() => reset(() => setOrder('d1'))}
              title="Every swept loadout, scored against a hard top-N opponent cutoff"
            >
              First derivative
            </SegButton>
            <SegButton
              active={order === 'd2'}
              onClick={() => reset(() => setOrder('d2'))}
              title="Opponents weighted continuously by their first-pass Overall; rated loadout only"
            >
              Weighted regression
            </SegButton>
          </SegGroup>
        </div>
        <div style={{ opacity: tierApplies(order) ? 1 : 0.45 }}>
          <div className="hud-label">Opponent pool</div>
          <SegGroup>
            {TIERS(league).map((t) => (
              <SegButton
                key={t}
                active={tier === t && tierApplies(order)}
                onClick={() => reset(() => { setOrder('d1'); setTier(t); })}
                title={t === 'all' ? 'Every league-legal form' : `Only the top ${t} by Overall`}
              >
                {t === 'all' ? 'All' : `Top ${t}`}
              </SegButton>
            ))}
          </SegGroup>
        </div>
      </div>

      <p className="rankings-blurb">{category.blurb}</p>

      <div className="panel rankings-note">
        <strong>Scores are mean battle ratings</strong>, where 500 is an even fight — every pool member
        played against every other, at each of the nine shield states and both shield policies, with
        each species swept across up to 12 loadouts. Ranked on the league's rated set so the column is
        comparable; the best swept set is the right-hand column.
        <br />
        {order === 'd1' ? (
          <>
            <strong>First derivative:</strong> every swept loadout, scored against a hard top-N
            opponent cutoff — rank N counts fully and rank N+1 not at all.
          </>
        ) : (
          <>
            <strong>Weighted regression:</strong> the first pass's own Overall fed back as a
            continuous opponent weight, so the field fades out instead of stopping at a boundary, and
            both sides restricted to their rated loadout — it describes the matchup rather than the
            movepool. The opponent-pool control does not apply here; the weighting replaces it.
          </>
        )}
        <br />
        PvPoke's <em>position</em> is shown alongside, not their score. Their number is a 0–100 index
        topping out near 93; ours is a mean battle rating where 500 is even. Rescaling one onto the
        other would produce a difference that looks like an error term and is nothing of the kind, so
        only rank order — the part that genuinely compares — is shown. Both columns are ranked over
        the species PvPoke publishes, which excludes Shadows. Engine rev {ENGINE_REV(league)}.
      </div>

      <HeldOutNote />

      <table className="table rankings-table">
        <thead>
          <tr>
            <th className="numeric">#</th>
            <th>Pokémon</th>
            <th className="numeric">{category.label}</th>
            <th className="numeric" title="Where PvPoke ranks it in the same category">PvPoke #</th>
            <th className="numeric" title="Places higher (+) or lower (-) than PvPoke ranks it">Δ rank</th>
            <th className="numeric" title="Gain from switching to the strongest swept loadout">
              Best set
            </th>
          </tr>
        </thead>
        <tbody>
          {slice.map((r, n) => (
            <Row
              key={r.ref}
              row={r}
              i={page * PAGE + n + 1}
              max={max}
              expanded={open === r.ref}
              onToggle={() => setOpen(open === r.ref ? null : r.ref)}
            />
          ))}
        </tbody>
      </table>

      <div className="opp-pager rankings-pager">
        <button className="btn opp-page-step" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ‹
        </button>
        <span className="opp-page-num">
          {page + 1} / {pages}
        </span>
        <button className="btn opp-page-step" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
          ›
        </button>
        <span className="opp-page-range">
          {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length} in{' '}
          {LEAGUE_BY_ID.get(league)!.name}
        </span>
      </div>
    </div>
  );
}
