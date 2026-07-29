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
import { VizTabs } from '../components/VizTabs';
import { FormToggle } from '../components/FormToggle';
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
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
    const key = (r: (typeof relevance)[number]) => {
      if (colorBy === 'break') return dmg(entry.atk, r.info.def, myFast, r.info.types);
      if (colorBy === 'bulk') return dmg(r.info.atk, entry.def, r.info.fastMove, species.types);
      // Rank: lower is better, so negate to keep "descending = strongest first".
      return -(SPECIES_BY_ID.get(parseRef(r.info.id).id)?.leagueRank[league] ?? 9999);
    };
    return [...relevance].sort((a, b) => (sortDesc ? key(b) - key(a) : key(a) - key(b)));
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
      {/* Widened from 340px to fit the larger sprite frame without crowding the
          name beside it. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,390px) minmax(0,1fr)', gap: 0, border: 'var(--border-strong) solid var(--rule-strong)' }}>
        {/* Left column */}
        <div className="report-side">
          {/* Identity → form → roll. The three things you change sit together at
              the top; everything below is the readout they produce. */}
          <SpeciesHero species={species} entry={entry} league={league} shadow={isShadow} bestBuddy={entry.lvl > 50} />

          <div className="side-block">
            <div className="hud-label" style={{ marginBottom: 7 }}>
              <span>Form</span>
            </div>
            <FormToggle
              shadow={isShadow}
              eligible={species.shadowEligible}
              onChange={(v) => set('shadow', v)}
              speciesName={species.name}
            />
            <div className="text-muted" style={{ fontSize: 11, marginTop: 6, maxWidth: '38ch' }}>
              {species.shadowEligible
                ? 'Attack x1.2, defense x5/6. Those cancel exactly, so your rank never moves — but every damage threshold does.'
                : 'No Shadow form exists for this Pokémon.'}
            </div>

            <div className="hud-label" style={{ margin: '13px 0 7px' }}>
              <span>Best Buddy</span>
            </div>
            <BestBuddyToggle
              on={bestBuddy}
              eligible={bbEligible}
              onChange={(v) => set('bestBuddy', v)}
            />
            <div className="text-muted" style={{ fontSize: 11, marginTop: 6, maxWidth: '38ch' }}>
              {bbEligible
                ? 'Adds levels 50.5 and 51 to your spread. Opponents are always priced at their own Best Buddy ceiling, toggle or not.'
                : `${species.name} tops out below level 50 in this league, so a Best Buddy boost changes nothing for it. Opponents are still priced at theirs.`}
            </div>
          </div>

          <div className="side-block">
            <div className="hud-label" style={{ marginBottom: 7 }}>
              <span>Adjust roll</span>
            </div>
            <IVAdjuster iv={iv} onBump={bumpIv} />
          </div>

          <HudFrame
            signal
            style={{ background: 'var(--surface-inverse)', color: 'var(--text-inverse)', padding: '16px 18px' }}
          >
            <div style={{ fontSize: 10, letterSpacing: 'var(--tracking-widest)', textTransform: 'uppercase', opacity: 0.6 }}>
              Stat product rank
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <HudReadout value={`#${entry.rank}`} />
              <span className="numeric" style={{ fontSize: 15, opacity: 0.55 }}>/ 4096</span>
            </div>
            {/* Track tints from the current text colour, so it works on either
                ground — the old hardcoded rgba(255,255,255,.25) vanished on light. */}
            <div style={{ height: 2, background: 'color-mix(in srgb, currentColor 25%, transparent)', margin: '12px 0 8px' }}>
              <div
                className="ruler-band"
                style={{ height: 2, background: 'var(--color-accent)', width: rankBarW, boxShadow: 'var(--glow-accent)' }}
              />
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {uncapped
                ? ivFloor === 15
                  ? 'Perfect. In an uncapped league that is the only spread that matters.'
                  : `Uncapped: every IV point is strictly better, so rank is just "more is better". Lowest IV is ${ivFloor}.`
                : verdictLine(entry.rank)}
            </div>
          </HudFrame>

          {uncapped && (
            <div className="panel" style={{ fontSize: 11, lineHeight: 1.5 }}>
              <div className="panel-title">Master League</div>
              With no CP cap there is no trade-off to solve — nothing is gained by
              a lower attack IV, so stat product rises with every point and rank 1
              is always 15/15/15. Sub-perfect spreads aren't a choice, just a worse
              Pokémon, so matchup analysis here only probes rolls of 13+ in every stat.
            </div>
          )}

          {/* Battle stats — these carry the Shadow multipliers, unlike the
              hero's CP/level, which don't. */}
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

          {/* Sits with the other numbers rather than beside the toggle: the
              control belongs at the top, but this is a readout of its effect. */}
          <div>
            {shadowCompare && (
              <table className="table numeric" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>vs {opp.name}</th>
                    <th style={{ textAlign: 'right' }}>Normal</th>
                    <th style={{ textAlign: 'right' }}>Shadow</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{mv.name} dealt</td>
                    <td style={{ textAlign: 'right' }}>{shadowCompare.dealtN}</td>
                    <td style={{ textAlign: 'right', color: shadowCompare.dealtS > shadowCompare.dealtN ? 'var(--color-accent-700)' : undefined }}>
                      {shadowCompare.dealtS}
                      {shadowCompare.dealtS > shadowCompare.dealtN ? ` (+${shadowCompare.dealtS - shadowCompare.dealtN})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td>{opp.fastMove.name} taken</td>
                    <td style={{ textAlign: 'right' }}>{shadowCompare.takenN}</td>
                    <td style={{ textAlign: 'right', color: shadowCompare.takenS > shadowCompare.takenN ? 'var(--color-accent-700)' : undefined }}>
                      {shadowCompare.takenS}
                      {shadowCompare.takenS > shadowCompare.takenN ? ` (+${shadowCompare.takenS - shadowCompare.takenN})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted">PvPoke rank</td>
                    <td style={{ textAlign: 'right' }}>{shadowCompare.rankN ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{shadowCompare.rankS ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right column */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* Loadout first: the moves decide every matchup listed below it. */}
          <MovesPanel
            species={species}
            moveIdx={moveIdx}
            onMoveIdx={(i) => set('moveIdx', i)}
            chargeIds={chargeIds}
            onChargeIds={(ids) => set('chargeIds', ids)}
          />

          {/* Governs the heatmap ramp, which opponents the scan surfaces, and
              the sort below — so it sits above all three. */}
          <MetricTabs value={colorBy} onChange={(c) => set('colorBy', c)} />

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
          />

          {/* Sits directly above the view it switches. At the top of the column
              it was several hundred pixels from the thing it re-rendered, so
              the cause and its effect were never on screen together. */}
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
      </div>
      <p className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
        {footnote}
      </p>
    </>
  );
}
