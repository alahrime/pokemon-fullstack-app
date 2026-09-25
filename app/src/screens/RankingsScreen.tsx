import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { CATEGORIES, CATEGORY_MARK, type CategoryId } from '../lib/scenarios';
import { DEFAULT_TIER, ENGINE_REV, exportAll, rankingsFor, type RankRow } from '../lib/rankings';
import { downloadCsv, downloadJson, stamp } from '../lib/exportData';
import { LEAGUE_BY_ID, movesFor, parseRef, speciesOf } from '../lib/data';
import { moveTypeStyle } from '../lib/pokemonTypes';
import { MoveCounts } from '../components/MoveCounts';
import { defaultSpreadFor } from '../lib/engine';
import type { LeagueId } from '../lib/types';
import { Sprite } from '../components/Sprite';
import { TypeBadge } from '../components/TypeBadge';
import { SegButton, SegGroup } from '../components/Seg';
import { Pager } from '../components/Pager';

/** Rows per page. The full pool runs to 1140 in Great. */


function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="rank-bar">
      <div className="rank-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Row({ row, i, n, max, league, expanded, onToggle }: {
  row: RankRow;
  i: number;
  /** Position within the page, which staggers this row's arrival. */
  n: number;
  max: number;
  league: LeagueId;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { shadow } = parseRef(row.ref);
  const sp = speciesOf(row.ref);
  const gain = Math.round((row.bestScore - row.score) * 10) / 10;
  // Read back from the same calls the build made, so the row cannot show a
  // spread or a set that did not earn the score beside it.
  const spread = useMemo(() => (sp ? defaultSpreadFor(row.ref, league, true) : null), [sp, row.ref, league]);
  const moves = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);
  return (
    <>
      <tr
        className={`rank-row${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        style={{ ['--row-i' as string]: n }}
      >
        <td className="numeric rank-pos">{i}</td>
        <td>
          {/* The row had a 30px sprite and nothing but a name beside it, which
              wasted the width the table already had. At 56px with the rated
              spread and the set underneath, the row answers "is this the build
              I am thinking of" without expanding it. Same data the score was
              computed from — defaultSpreadFor and movesFor, not a second guess. */}
          <div className="rank-name">
            <span className="rank-art">
              {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={84} shadow={shadow} />}
            </span>
            <div className="rank-id">
              <div className="rank-name-text">{row.name}</div>
              <div className="rank-types">{sp?.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
              {spread && (
                <div className="numeric rank-spread">
                  <span className="rank-iv">{spread.a}/{spread.d}/{spread.s}</span>
                  <span className="rank-cp">{spread.cp}<i>CP</i></span>
                  <span className="rank-lvl">L{spread.lvl}</span>
                </div>
              )}
            </div>
            {moves && (
              // A column of its own, beside the identity rather than stacked
              // under it. The name cell is 585px wide and the stacked version
              // used 156 of them, so the row carried 357px of nothing between
              // a cramped Pokemon and its score.
              //
              // The card language, so a build reads the same here as it does
              // on a team slot or a core row: the move's own type on the rail,
              // and how many fast moves each charged throw costs.
              <div className="pc-moves rank-moves">
                <span className="pc-move pc-move-fast" style={moveTypeStyle(moves.fast.type)}>
                  <span className="pc-move-name">{moves.fast.name}</span>
                  <span className="pc-move-denom">to charge ↓</span>
                </span>
                {moves.charges.map((c) => (
                  <span className="pc-move" key={c.id} style={moveTypeStyle(c.type)}>
                    <span className="pc-move-name">{c.name}</span>
                    <MoveCounts fast={moves.fast} charge={c} />
                  </span>
                ))}
              </div>
            )}
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
                      <span className="flex-1">{l.label}</span>
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
  const tier = DEFAULT_TIER(league);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => rankingsFor(league, tier, cat), [league, tier, cat]);
  const max = rows[0]?.score ?? 1000;
  const pages = Math.ceil(rows.length / pageSize);
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);
  const category = CATEGORIES.find((c) => c.id === cat)!;

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
    setOpen(null);
  };

  return (
    <div className="rankings">
      <ScreenHeader
        title="Rankings"
        info={
          <>
            <p className="info-pop-lead">{category.blurb}</p>

        Scored by <strong>PvPoke's own ranking method</strong> run on our battles: each species
        against PvPoke's ranked field, one battle per role at PvPoke's shields and starting energy.
        A battle rating is <em>health kept plus damage dealt</em>, with +100 per shield forced or
        kept on a win; wins above 700 are <strong>soft-capped</strong> and losses under 300{' '}
        <strong>curved down</strong>. Each opponent is weighted by its own score and PvPoke's
        override weights, and every column is <strong>0–100 of the best in it</strong>.
        <br />
        <strong>Overall</strong> is PvPoke's weighted geometric mean of the role scores, sorted
        strongest first (12×, 6×, 4×, 2×; Switches and Chargers share a slot), and consistency (2×).
        Loadouts are each scored the same way; the league's rated set is ranked, the best swept set
        is the right-hand column.
        <br />
        PvPoke's <em>position</em> is shown alongside. Their published Overall blends in an
        editor-set score (75% of it for most of the Great League head), which no simulation
        reproduces, so positions differ most there. Engine rev {ENGINE_REV(league)}.
          </>
        }
        blurb="Every league-legal form, ranked by PvPoke's method on our battles."
      />
      <div className="panel panel-strong flex flex-wrap gap-5 mb-4">
        <div>
          <div className="hud-label">Category</div>
          <SegGroup>
            {CATEGORIES.map((c) => (
              <SegButton key={c.id} active={cat === c.id} onClick={() => reset(() => setCat(c.id))} title={c.blurb}>
                {/* A mark per role, so eight words of similar length read as a
                    set rather than as a paragraph in a row. */}
                <span className="cat-mark" aria-hidden="true">{CATEGORY_MARK[c.id]}</span>
                {c.label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <div>
          <div className="hud-label">Export</div>
          <div className="best-teams-export">
            <button
              className="btn btn-sm"
              title="This view as CSV — one row per species, the columns as shown"
              onClick={() =>
                downloadCsv(
                  `paragon-rankings-${league}-${cat}-${stamp()}`,
                  rows.map((r) => ({
                    rank: r.rank,
                    ref: r.ref,
                    name: r.name,
                    league,
                    category: cat,
                    score: r.score,
                    bestScore: r.bestScore,
                    bestLoadout: r.bestLoadout,
                    bestIsRated: r.bestIsRecommended,
                    pvpokeRank: r.pvpokeRank ?? '',
                    rankDelta: r.delta ?? '',
                  })),
                )
              }
            >
              CSV
            </button>
            <button
              className="btn btn-sm"
              title="Every category for this league, plus each species' swept loadouts"
              onClick={() => downloadJson(`paragon-rankings-full-${league}-${stamp()}`, exportAll(league))}
            >
              All categories
            </button>
          </div>
        </div>
      </div>

      <Pager
        page={page}
        pages={pages}
        total={rows.length}
        size={pageSize}
        onPage={setPage}
        onSize={(n) => { setPageSize(n); setPage(0); }}
        unit={`in ${LEAGUE_BY_ID.get(league)!.name}`}
        className="pager-top"
      />

      <div className="table-scroll">
        <table className="table rankings-table">
          {/* Explicit columns, because auto layout kept handing the surplus to
              the widest column — the Pokemon one — where it read as a void
              between a build and its score. Stated here, the spare width goes
              to the numeric columns instead, and the score column's bar gets
              longer with it. */}
          <colgroup>
            <col className="w-[3rem]" />
            <col className="rank-col-mon" />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
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
          {/* Keyed on everything that changes the contents, so React remounts
              these rows and the arrival replays: a new page, a new category or
              a new pool is dealt, not swapped. */}
          <tbody className="stagger-drop-rows" key={`${cat}-${page}-${pageSize}`}>
            {slice.map((r, n) => (
              <Row
                key={r.ref}
                row={r}
                n={n}
                i={page * pageSize + n + 1}
                max={max}
                league={league}
                expanded={open === r.ref}
                onToggle={() => setOpen(open === r.ref ? null : r.ref)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pages={pages}
        total={rows.length}
        size={pageSize}
        onPage={setPage}
        onSize={(n) => { setPageSize(n); setPage(0); }}
        unit={`in ${LEAGUE_BY_ID.get(league)!.name}`}
      />
    </div>
  );
}
