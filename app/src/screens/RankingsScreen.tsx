import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { CATEGORIES, CATEGORY_MARK, type CategoryId } from '../lib/scenarios';
import { DEFAULT_TIER, ENGINE_REV, TIERS, exportAll, rankingsFor, type RankOrder, type RankRow } from '../lib/rankings';
import { downloadCsv, downloadJson, stamp } from '../lib/exportData';
import { LEAGUE_BY_ID, movesFor, parseRef, speciesOf } from '../lib/data';
import { moveTypeStyle } from '../lib/pokemonTypes';
import { MoveCounts } from '../components/MoveCounts';
import { bestSpreadFor } from '../lib/engine';
import type { LeagueId } from '../lib/types';
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

function Row({ row, i, max, league, expanded, onToggle }: {
  row: RankRow;
  i: number;
  max: number;
  league: LeagueId;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { shadow } = parseRef(row.ref);
  const sp = speciesOf(row.ref);
  const gain = row.bestScore - row.score;
  // Read back from the same calls the build made, so the row cannot show a
  // spread or a set that did not earn the score beside it.
  const spread = useMemo(() => (sp ? bestSpreadFor(row.ref, league, true) : null), [sp, row.ref, league]);
  const moves = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);
  return (
    <>
      <tr className={`rank-row${expanded ? ' is-open' : ''}`} onClick={onToggle}>
        <td className="numeric rank-pos">{i}</td>
        <td>
          {/* The row had a 30px sprite and nothing but a name beside it, which
              wasted the width the table already had. At 56px with the rated
              spread and the set underneath, the row answers "is this the build
              I am thinking of" without expanding it. Same data the score was
              computed from — bestSpreadFor and movesFor, not a second guess. */}
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
      <ScreenHeader
        title="Rankings"
        info={
          <>
            <p className="info-pop-lead">{category.blurb}</p>

        <strong>Category scores are mean battle ratings</strong>, on PvPoke's 0–1000 scale — every
        pool member played against every other, at each of the nine shield states and both shield
        policies, with each species swept across up to 12 loadouts. Ranked on the league's rated set
        so the column is comparable; the best swept set is the right-hand column.
        <br />
        A rating is <em>health kept plus damage dealt</em>, then three adjustments taken from
        PvPoke's own ranker: a win earns <strong>+100 per shield it forced and per shield it kept</strong>,
        wins above 700 are <strong>soft-capped</strong> so a blowout is worth barely more than a
        clean win, and losses under 300 are <strong>curved down</strong> so failing to trade costs
        more than losing gracefully. Their editor override — which replaces 75% of a published score
        with a hand-set value — is deliberately <em>not</em> reproduced here.
        <br />
        <strong>Overall is not a battle rating.</strong> It is a weighted geometric mean of this
        Pokémon's own five role scores, each first normalised against the best in that category, with
        its strongest role weighted 12× and consistency 2×. That asks how strong a Pokémon is at what
        it does rather than how it averages, so a specialist outranks a generalist. It is shown ×10
        to share an axis with the other columns, but only its <em>order</em> is meaningful.
        <br />
        {order === 'd1' ? (
          <>
            <strong>Even field:</strong> every swept loadout, scored against a top-N opponent
            cutoff where everyone inside it counts the same — beating rank 98 is worth beating rank 2.
          </>
        ) : (
          <>
            <strong>Graded field:</strong> the same opponent pool, but graded — each opponent
            weighted by the first pass's own Overall, so beating the head of the format counts for
            more than beating its shoulder. Both sides are restricted to their rated loadout, which
            makes it a measure of the matchup rather than of the movepool.
          </>
        )}
        <br />
        PvPoke's <em>position</em> is shown alongside, not their score. Their number is a 0–100 index
        topping out near 93; ours is a mean battle rating where 500 is even. Rescaling one onto the
        other would produce a difference that looks like an error term and is nothing of the kind, so
        only rank order — the part that genuinely compares — is shown. Both columns are ranked over
        the species PvPoke publishes, which excludes Shadows. Engine rev {ENGINE_REV(league)}.
          </>
        }
        blurb="Every league-legal form, scored in seven roles at five opponent-pool depths."
        aside={<HeldOutNote />}
      />
      <div className="panel panel-strong rankings-controls">
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
          <div className="hud-label">Pass</div>
          <SegGroup>
            <SegButton
              active={order === 'd1'}
              onClick={() => reset(() => setOrder('d1'))}
              title="Every swept loadout, scored against a hard top-N opponent cutoff — every opponent inside it counts the same"
            >
              Even field
            </SegButton>
            <SegButton
              active={order === 'd2'}
              onClick={() => reset(() => setOrder('d2'))}
              title="The same cutoff, but each opponent weighted by its own Overall; rated loadout only"
            >
              Graded field
            </SegButton>
          </SegGroup>
        </div>
        <div>
          <div className="hud-label">Opponent pool</div>
          <SegGroup>
            {TIERS(league).map((t) => (
              <SegButton
                key={t}
                active={tier === t}
                onClick={() => reset(() => setTier(t))}
                title={t === 'all' ? 'Every league-legal form' : `Only the top ${t} by Overall`}
              >
                {t === 'all' ? 'All' : `Top ${t}`}
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
                  `paragon-rankings-${league}-${tier}-${cat}-${order}-${stamp()}`,
                  rows.map((r) => ({
                    rank: r.rank,
                    ref: r.ref,
                    name: r.name,
                    league,
                    tier,
                    category: cat,
                    pass: order,
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
              title="Every tier, category and pass for this league, plus each species' swept loadouts"
              onClick={() => downloadJson(`paragon-rankings-full-${league}-${stamp()}`, exportAll(league))}
            >
              All strata
            </button>
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table rankings-table">
          {/* Explicit columns, because auto layout kept handing the surplus to
              the widest column — the Pokemon one — where it read as a void
              between a build and its score. Stated here, the spare width goes
              to the numeric columns instead, and the score column's bar gets
              longer with it. */}
          <colgroup>
            <col className="rank-col-pos" />
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
          <tbody>
            {slice.map((r, n) => (
              <Row
                key={r.ref}
                row={r}
                i={page * PAGE + n + 1}
                max={max}
                league={league}
                expanded={open === r.ref}
                onToggle={() => setOpen(open === r.ref ? null : r.ref)}
              />
            ))}
          </tbody>
        </table>
      </div>

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
