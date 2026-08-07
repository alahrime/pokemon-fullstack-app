import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID, makeRef, parseRef, LEAGUE_BY_ID } from '../lib/data';
import {
  bestLeagueFor,
  dmg,
  bestBuddyEligible,
  bpRowsFor,
  buildHeatCells,
  flipGrid,
  flipMatchupRows,
  getEntry,
  opponentInfo,
  paletteFor,
  rankedOpponents,
  rulersFor,
  scenarioMatrix,
  verdictLine,
} from '../lib/engine';
import { IVAdjuster } from '../components/IVAdjuster';
import { HudFrame, HudReadout } from '../components/Hud';
import { OpponentGrid } from '../components/OpponentGrid';
import { MetricTabs } from '../components/MetricTabs';
import { metricSortLabel } from '../lib/metrics';
import { MovesPanel } from '../components/MovesPanel';
import { Board, BoardControls } from '../components/Board';
import { VizTabs } from '../components/VizTabs';
import { FormToggle } from '../components/FormToggle';
import { HeldOutNote } from '../components/HeldOutNote';
import { BestBuddyToggle } from '../components/BestBuddyToggle';
import { SpeciesHero } from '../components/SpeciesHero';
import { HeatmapView } from './detail/HeatmapView';
import { RulerView } from './detail/RulerView';
import { ThresholdTable } from './detail/ThresholdTable';
import { FlipView } from './detail/FlipView';

/**
 * Cells per page. The scan itself is uncapped — every league-legal opponent
 * whose damage thresholds this species can actually cross is included, which
 * runs to several hundred, so the board pages through them rather than
 * truncating at an arbitrary depth.
 */
const OPPONENT_WINDOW = 16;

/** Storage key for the right column's panel order. */
const REPORT_BOARD = 'report-analysis';

export function ReportScreen() {
  const { state, set, patch, bumpIv } = useAppState();
  const { league, species: speciesId, shadow, bestBuddy, chargeIds, iv, viz, colorBy, oppId, moveIdx } = state;

  const species = SPECIES_BY_ID.get(speciesId)!;
  // Everything downstream keys off the *ref*, which encodes Shadow. The engine
  // parses the suffix, so no other call signature changes.
  const isShadow = shadow && species.shadowEligible;
  const ref = makeRef(speciesId, isShadow);
  const { entry, table } = getEntry(ref, iv, league, bestBuddy);
  const bbEligible = useMemo(
    () => bestBuddyEligible(species, LEAGUE_BY_ID.get(league)!),
    [species, league],
  );
  const relevanceKind = viz === 'heat' && colorBy !== 'rank' ? colorBy : 'either';
  // The scan finds far more decidable matchups than fit on screen. Keep the
  // full slate for selection validity and show a rotating window of it.
  const relevance = useMemo(
    () => rankedOpponents(ref, league, moveIdx, relevanceKind, Infinity, chargeIds, bestBuddy),
    [ref, league, moveIdx, relevanceKind, chargeIds, bestBuddy],
  );
  const opponents = useMemo(() => relevance.map((r) => r.info), [relevance]);

  // Sorted by whichever metric is selected, then paged. The scan finds ~48
  // decidable matchups against 16 cells; paging shows the surplus without the
  // movement an auto-rotating board introduced.
  const [editing, setEditing] = useState(false);
  // Bumped on reset so the Board remounts and re-reads cleared storage.
  const [boardNonce, setBoardNonce] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);

  /**
   * Open this species against one of its listed opponents in the simulator.
   *
   * Carries the roll, the fast move and the charged selection across, so the
   * fight you land on is the one you were reading about rather than the
   * league's rated default.
   */
  const openBattle = (oppId: string) => {
    patch({
      screen: 'battle',
      battleA: ref,
      battleB: oppId,
      fastA: moveIdx,
      ivA: iv,
      chargeIdsA: chargeIds,
      // The opponent arrives on its own rated set, which is what the relevance
      // scan measured it at.
      fastB: 0,
      chargeIdsB: [],
    });
  };

  const sorted = useMemo(() => {
    const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
    const rankOf = (r: (typeof relevance)[number]) =>
      SPECIES_BY_ID.get(parseRef(r.info.id).id)?.leagueRank[league] ?? 9999;
    const key = (r: (typeof relevance)[number]) => {
      if (colorBy === 'break') return dmg(entry.atk, r.info.def, myFast, r.info.types);
      if (colorBy === 'bulk') return dmg(r.info.atk, entry.def, r.info.fastMove, species.types);
      // Rank: lower is better, so negate to keep "descending = strongest first".
      return -rankOf(r);
    };
    // Damage leads, because a breakpoint list is about the step. But damage is
    // a small integer and almost everything ties on it — measured over three
    // species, 30 to 38 of 40 rows shared a value, and Registeel's breakpoints
    // put 39 of 40 in one group. Ordering those ties by league rank is what
    // makes the list read meta-first instead of arbitrarily.
    return [...relevance].sort(
      (a, b) => (sortDesc ? key(b) - key(a) : key(a) - key(b)) || rankOf(a) - rankOf(b),
    );
  }, [relevance, colorBy, sortDesc, entry.atk, entry.def, species, moveIdx, league]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / OPPONENT_WINDOW));
  // Reset to the first page whenever the ordering or the slate changes, or the
  // board can land on a page that no longer exists.
  useEffect(() => setPage(0), [ref, league, moveIdx, relevanceKind, chargeIds, colorBy, sortDesc, bestBuddy]);
  const visible = useMemo(
    () => sorted.slice(page * OPPONENT_WINDOW, page * OPPONENT_WINDOW + OPPONENT_WINDOW),
    [sorted, page],
  );

  const effectiveOppId = opponents.some((o) => o.id === oppId) ? oppId : (opponents[0]?.id ?? oppId);
  useEffect(() => {
    if (effectiveOppId !== oppId) set('oppId', effectiveOppId);
  }, [effectiveOppId, oppId, set]);
  const activeOppIdx = Math.max(0, visible.findIndex((r) => r.info.id === effectiveOppId));
  const opp = useMemo(() => opponentInfo(effectiveOppId, league), [effectiveOppId, league]);

  const spPct = entry.sp / table.best.sp;
  const bestLeague = bestLeagueFor(ref, iv);
  const isRank1 = entry.rank === 1;
  const bpRows = useMemo(() => bpRowsFor(ref, iv, league, opp), [ref, iv, league, opp]);

  const heatCells = useMemo(
    () => (viz === 'heat' ? buildHeatCells(ref, iv, league, opp, moveIdx, colorBy) : []),
    [viz, ref, iv, league, opp, moveIdx, colorBy],
  );
  const rulers = useMemo(() => (viz === 'ruler' ? rulersFor(ref, iv, league, opp) : []), [viz, ref, iv, league, opp]);
  const grid = useMemo(
    () => (viz === 'flip' ? flipGrid(ref, iv, league, opp.id, moveIdx, state.shields, chargeIds, state.shieldsOpp) : null),
    [viz, ref, iv, league, opp, moveIdx, state.shields, state.shieldsOpp, chargeIds],
  );
  // Nine outcomes for the current spread vs the selected opponent - the
  // scenario picker doubles as a readout of the whole matchup.
  const scenarios = useMemo(
    () => (viz === 'flip' ? scenarioMatrix(ref, iv, league, opp.id, moveIdx, chargeIds) : []),
    [viz, ref, iv, league, opp, moveIdx, chargeIds],
  );
  const flipRows = useMemo(
    () => (viz === 'flip' ? flipMatchupRows(ref, iv, league, moveIdx, visible.map((r) => r.info.id), chargeIds, state.shieldsOpp) : []),
    [viz, ref, iv, league, moveIdx, visible, chargeIds, state.shieldsOpp],
  );

  // One palette for the whole report, derived from this species' typing.
  const palette = useMemo(() => paletteFor(species), [species]);
  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const colorByLabel = colorBy === 'rank' ? 'stat product rank' : colorBy === 'break' ? `${mv.name} damage dealt` : `${opp.fastMove.name} damage taken`;

  const footnote =
    'Stat product = Atk × Def × floor(HP) at the highest level under the cap; ranks recomputed per species per league. Damage model: floor(0.5 · power · Atk/Def · STAB) + 1. Click any heatmap cell to load that spread.';

  const rankBarW = (100 - ((entry.rank - 1) / 4095) * 100).toFixed(2) + '%';

  // Master has no CP cap, so there's no level/IV trade-off: every mon sits at
  // level 50 and every IV point is strictly better. Rank still sorts, but it
  // encodes nothing a player can act on - only near-perfect rolls are real
  // options - so the report says so rather than implying a decision exists.
  const uncapped = table.league.uncapped;
  const ivFloor = Math.min(iv.a, iv.d, iv.s);

  // Normal vs Shadow at the *same* IVs against the current opponent. Since the
  // multipliers cancel in stat product, rank is identical either way - the only
  // thing that moves is damage, so that's all this compares.
  const shadowCompare = useMemo(() => {
    if (!species.shadowEligible) return null;
    const n = getEntry(speciesId, iv, league).entry;
    const sh = getEntry(makeRef(speciesId, true), iv, league).entry;
    return {
      dealtN: dmg(n.atk, opp.def, mv, opp.types),
      dealtS: dmg(sh.atk, opp.def, mv, opp.types),
      takenN: dmg(opp.atk, n.def, opp.fastMove, species.types),
      takenS: dmg(opp.atk, sh.def, opp.fastMove, species.types),
      rankN: species.leagueRank[league],
      rankS: species.shadowLeagueRank[league],
    };
  }, [species, speciesId, iv, league, opp, mv]);

  return (
    <>
      {/* The whole report takes the colour of what it is reporting on.
          --t1/--t2 come from the species' own typing and are consumed by the
          wash, the rules and the hero below; a Steel/Fairy report and a
          Water/Ghost one are recognisable before either name is read. Set as
          custom properties rather than classes so a dual type blends instead
          of picking a side. */}
      <div
        className="report-frame"
        style={{
          ['--t1' as string]: `var(--type-${species.types[0]})`,
          ['--t2' as string]: `var(--type-${species.types[1] ?? species.types[0]})`,
        }}
      >
        <span className="report-wash" aria-hidden="true" />
      {/* Widened from 340px to fit the larger sprite frame without crowding the
          name beside it. */}
      <div className="rs-split">
        {/* Left column */}
        <div className="report-side">
          {/* Identity → form → roll. The three things you change sit together at
              the top; everything below is the readout they produce. */}
          <SpeciesHero species={species} entry={entry} league={league} shadow={isShadow} bestBuddy={entry.lvl > 50} />

          <div className="side-block">
            <div className="hud-label rs-label">
              <span>Form</span>
            </div>
            <FormToggle
              shadow={isShadow}
              eligible={species.shadowEligible}
              onChange={(v) => set('shadow', v)}
              speciesName={species.name}
            />
            <div className="text-muted text-xs mt-1.5 max-w-[38ch]">
              {species.shadowEligible
                ? 'Attack x1.2, defense x5/6. Those cancel exactly, so your rank never moves — but every damage threshold does.'
                : 'No Shadow form exists for this Pokémon.'}
            </div>

            <div className="hud-label rs-label-mid">
              <span>Best Buddy</span>
            </div>
            <BestBuddyToggle
              on={bestBuddy}
              eligible={bbEligible}
              onChange={(v) => set('bestBuddy', v)}
            />
            <div className="text-muted text-xs mt-1.5 max-w-[38ch]">
              {bbEligible
                ? 'Adds levels 50.5 and 51 to your spread. Opponents are always priced at their own Best Buddy ceiling, toggle or not.'
                : `${species.name} tops out below level 50 in this league, so a Best Buddy boost changes nothing for it. Opponents are still priced at theirs.`}
            </div>
          </div>

          <div className="side-block">
            <div className="hud-label rs-label-row">
              <span className="flex-1">Adjust roll</span>
              {/* Rank 1 is a specific spread, not 15/15/15 — under a cap a low
                  attack IV usually buys enough extra level to win on stat
                  product. Stepping to it by hand means knowing which of the
                  4096 it is, so this jumps straight there. Disabled once you
                  are on it, which doubles as the "already optimal" readout. */}
              <button
                type="button"
                className="btn chip-btn iv-max-btn"
                disabled={isRank1}
                onClick={() => patch({ iv: { a: table.best.a, d: table.best.d, s: table.best.s } })}
                title={
                  isRank1
                    ? 'Already the rank-1 spread for this league'
                    : `Jump to rank 1 — ${table.best.a}/${table.best.d}/${table.best.s}`
                }
              >
                {isRank1 ? '✓ rank 1' : `max → ${table.best.a}/${table.best.d}/${table.best.s}`}
              </button>
            </div>
            <IVAdjuster iv={iv} onBump={bumpIv} />
          </div>

          <HudFrame
            signal
            className="rs-rank"
          >
            <div className="rs-rank-caption">
              Stat product rank
            </div>
            <div className="rs-rank-value">
              <HudReadout value={`#${entry.rank}`} />
              <span className="numeric rs-rank-of">/ 4096</span>
            </div>
            <div className="rs-rank-track">
              <div
                className="ruler-band"
                style={{ height: 2, background: 'var(--color-accent)', width: rankBarW, boxShadow: 'var(--glow-accent)' }}
              />
            </div>
            <div className="rs-rank-note">
              {uncapped
                ? ivFloor === 15
                  ? 'Perfect. In an uncapped league that is the only spread that matters.'
                  : `Uncapped: every IV point is strictly better, so rank is just "more is better". Lowest IV is ${ivFloor}.`
                : verdictLine(entry.rank)}
            </div>
          </HudFrame>

          {uncapped && (
            <div className="panel rs-uncapped">
              <div className="panel-title">Master League</div>
              With no CP cap there is no trade-off to solve — nothing is gained by
              a lower attack IV, so stat product rises with every point and rank 1
              is always 15/15/15. Sub-perfect spreads aren't a choice, just a worse
              Pokémon, so matchup analysis here only probes rolls of 13+ in every stat.
            </div>
          )}

          {/* Battle stats — these carry the Shadow multipliers, unlike the
              hero's CP/level, which don't. */}
          <div className="side-block">
            <div className="hud-label rs-label">
              <span>Battle stats</span>
            </div>
            <div className="stat-strip">
            {(
              [
                ['Attack', entry.atk.toFixed(1)],
                ['Defense', entry.def.toFixed(1)],
                ['Stamina', String(entry.hp)],
              ] as [string, string][]
            ).map(([label, value]) => (
                <div key={label} className="stat-cell">
                  <span className="stat-cell-label">{label}</span>
                  <span className="stat-cell-value numeric">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="side-block">
            <div className="hud-label rs-label">
              <span>This spread</span>
            </div>
            <div className="stagger detail-list">
            {(
              [
                ['Stat product', `${(entry.sp / 1000).toFixed(2)}k`],
                ['% of rank 1', `${(spPct * 100).toFixed(2)}%`],
                ['Rank 1 spread', `${table.best.a}/${table.best.d}/${table.best.s} (${(table.best.sp / 1000).toFixed(2)}k)`],
                ['Best league here', `${bestLeague.league.name} · #${bestLeague.rank}`],
              ] as [string, string][]
            ).map(([label, value], i) => (
                <div key={label} className="detail-row" style={{ ['--i' as string]: i }}>
                  <span className="detail-label">{label}</span>
                  <span className="detail-value numeric">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sits with the other numbers rather than beside the toggle: the
              control belongs at the top, but this is a readout of its effect. */}
          {shadowCompare && (
            <div className="side-block">
              <div className="hud-label rs-label">
                <span>Shadow damage</span>
              </div>
              <table className="table numeric text-sm rs-shadow-table">
                <thead>
                  <tr>
                    <th className="text-left">vs {opp.name}</th>
                    <th className="text-right">Normal</th>
                    <th className="text-right">Shadow</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{mv.name} dealt</td>
                    <td className="text-right">{shadowCompare.dealtN}</td>
                    <td style={{ textAlign: 'right', color: shadowCompare.dealtS > shadowCompare.dealtN ? 'var(--color-accent-700)' : undefined }}>
                      {shadowCompare.dealtS}
                      {shadowCompare.dealtS > shadowCompare.dealtN ? ` (+${shadowCompare.dealtS - shadowCompare.dealtN})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td>{opp.fastMove.name} taken</td>
                    <td className="text-right">{shadowCompare.takenN}</td>
                    <td style={{ textAlign: 'right', color: shadowCompare.takenS > shadowCompare.takenN ? 'var(--color-accent-700)' : undefined }}>
                      {shadowCompare.takenS}
                      {shadowCompare.takenS > shadowCompare.takenN ? ` (+${shadowCompare.takenS - shadowCompare.takenN})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted">PvPoke rank</td>
                    <td className="text-right">{shadowCompare.rankN ?? '—'}</td>
                    <td className="text-right">{shadowCompare.rankS ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column. The panels here are independent readouts and which one
            matters most depends on the task, so their order is the user's. */}
        <div className="flex min-w-0 flex-col gap-3.5 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="hud-label text-(--text-faint)">
              {editing ? 'Drag a panel, or use the arrows' : 'Analysis'}
            </span>
            <BoardControls
              storageKey={REPORT_BOARD}
              editing={editing}
              onEditing={setEditing}
              onReset={() => setBoardNonce((n) => n + 1)}
            />
          </div>
          <Board
            // Remounts on reset so the board re-reads the cleared storage.
            key={boardNonce}
            storageKey={REPORT_BOARD}
            editing={editing}
            className="flex flex-col gap-3.5"
            blocks={[
              {
                id: 'moves',
                label: 'Loadout',
                node: (
                  <MovesPanel
                    species={species}
                    moveIdx={moveIdx}
                    onMoveIdx={(i) => set('moveIdx', i)}
                    chargeIds={chargeIds}
                    onChargeIds={(ids) => set('chargeIds', ids)}
                  />
                ),
              },
              {
                id: 'metric',
                label: 'Metric',
                node: <MetricTabs value={colorBy} onChange={(c) => set('colorBy', c)} />,
              },
              {
                id: 'opponents',
                label: 'Opponents',
                node: (
                  <>
                    <HeldOutNote />
                    <OpponentGrid
                      items={visible}
                      page={page}
                      pageCount={pageCount}
                      total={sorted.length}
                      activeId={effectiveOppId}
                      sortLabel={metricSortLabel(colorBy)}
                      sortDesc={sortDesc}
                      onSort={setSortDesc}
                      onPage={setPage}
                      onSelect={(id) => set('oppId', id)}
                      onBattle={(id) => openBattle(id)}
                    />
                  </>
                ),
              },
              {
                id: 'viz',
                label: 'Visualisation',
                // Tabs travel with the view they switch: separated, the cause
                // and its effect were never on screen together.
                node: (
                  <div className="flex flex-col gap-3.5">
                    <VizTabs value={viz} onChange={(v) => set('viz', v)} />
                    {viz === 'heat' && (
                      <HeatmapView
                        cells={heatCells}
                        colorBy={colorBy}
                        colorByLabel={colorByLabel}
                        onPick={(a, d) => patch({ iv: { ...iv, a, d } })}
                        ivS={iv.s}
                        onIvS={(v) => patch({ iv: { ...iv, s: v } })}
                        table={table}
                        iv={iv}
                        palette={palette}
                      />
                    )}
                    {viz === 'ruler' && <RulerView rulers={rulers} />}
                    {viz === 'table' && <ThresholdTable rows={bpRows} />}
                    {viz === 'flip' && grid && (
                      <FlipView
                        ivA={iv.a}
                        ivD={iv.d}
                        shieldsMine={state.shields}
                        shieldsTheirs={state.shieldsOpp}
                        scenarios={scenarios}
                        onShields={(mine, theirs) => patch({ shields: mine, shieldsOpp: theirs })}
                        grid={grid}
                        ivS={iv.s}
                        onIvS={(v) => patch({ iv: { ...iv, s: v } })}
                        onPick={(a, d) => patch({ iv: { ...iv, a, d } })}
                        rows={flipRows}
                        activeOppIdx={activeOppIdx}
                        onSelectOpponent={(idx) => set('oppId', visible[idx].info.id)}
                        now={grid.results.find((o) => o.entry.a === iv.a && o.entry.d === iv.d)?.result ?? { win: false, margin: 0 }}
                        cmpWin={entry.atk >= grid.opponentMon.atk}
                      />
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
      <p className="text-muted rs-foot-note">
        {footnote}
      </p>
      </div>
    </>
  );
}
