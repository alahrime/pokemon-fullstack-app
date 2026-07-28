import { useEffect, useMemo } from 'react';
import { useAppState, type Viz } from '../state/AppState';
import { SPECIES_BY_ID, makeRef } from '../lib/data';
import {
  bestLeagueFor,
  dmg,
  bpRowsFor,
  buildHeatCells,
  flipGrid,
  flipMatchupRows,
  getEntry,
  opponentInfo,
  rankedOpponents,
  rulersFor,
  verdictLine,
} from '../lib/engine';
import { Sprite } from '../components/Sprite';
import { IVAdjuster } from '../components/IVAdjuster';
import { ChipButton, SegButton, SegGroup } from '../components/Seg';
import { HudFrame, HudReadout } from '../components/Hud';
import { OpponentGrid } from '../components/OpponentGrid';
import { MovepoolPicker } from '../components/MovepoolPicker';
import { FormToggle } from '../components/FormToggle';
import { HeatmapView } from './detail/HeatmapView';
import { RulerView } from './detail/RulerView';
import { ThresholdTable } from './detail/ThresholdTable';
import { FlipView } from './detail/FlipView';

const VIZ_ITEMS: [Viz, string][] = [
  ['heat', '4096 heatmap'],
  ['ruler', 'Damage ruler'],
  ['table', 'Threshold table'],
  ['flip', 'Matchup flips'],
];

export function ReportScreen() {
  const { state, set, patch, bumpIv } = useAppState();
  const { league, species: speciesId, shadow, chargeIds, iv, viz, colorBy, oppId, moveIdx } = state;

  const species = SPECIES_BY_ID.get(speciesId)!;
  // Everything downstream keys off the *ref*, which encodes Shadow. The engine
  // parses the suffix, so no other call signature changes.
  const isShadow = shadow && species.shadowEligible;
  const ref = makeRef(speciesId, isShadow);
  const { entry, table } = getEntry(ref, iv, league);
  const relevanceKind = viz === 'heat' && colorBy !== 'rank' ? colorBy : 'either';
  const relevance = useMemo(
    () => rankedOpponents(ref, league, moveIdx, relevanceKind, 16, chargeIds),
    [ref, league, moveIdx, relevanceKind, chargeIds],
  );
  const opponents = useMemo(() => relevance.map((r) => r.info), [relevance]);
  const effectiveOppId = opponents.some((o) => o.id === oppId) ? oppId : (opponents[0]?.id ?? oppId);
  useEffect(() => {
    if (effectiveOppId !== oppId) set('oppId', effectiveOppId);
  }, [effectiveOppId, oppId, set]);
  const activeOppIdx = Math.max(0, opponents.findIndex((o) => o.id === effectiveOppId));
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
    () => (viz === 'flip' ? flipGrid(ref, iv, league, opp.id, moveIdx, state.shields, chargeIds) : null),
    [viz, ref, iv, league, opp, moveIdx, state.shields, chargeIds],
  );
  const flipRows = useMemo(
    () => (viz === 'flip' ? flipMatchupRows(ref, iv, league, moveIdx, opponents.map((o) => o.id), chargeIds) : []),
    [viz, ref, iv, league, moveIdx, opponents, chargeIds],
  );

  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const colorByLabel = colorBy === 'rank' ? 'stat product rank' : colorBy === 'break' ? `${mv.name} damage dealt` : `${opp.fastMove.name} damage taken`;

  const bpBlurb = `${table.league.name} · ${table.best.a}/${table.best.d}/${table.best.s} is rank 1 at ${(table.best.sp / 1000).toFixed(2)}k. Thresholds where floor(0.5·P·Atk/Def·STAB) steps by 1 for ${mv.name} into ${opp.name}, and where incoming ${opp.fastMove.name} steps down.`;

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
      dealtN: dmg(n.atk, opp.def, mv),
      dealtS: dmg(sh.atk, opp.def, mv),
      takenN: dmg(opp.atk, n.def, opp.fastMove),
      takenS: dmg(opp.atk, sh.def, opp.fastMove),
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
        <div style={{ borderRight: 'var(--border-strong) solid var(--rule-strong)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Identity → form → roll. The three things you change sit together at
              the top; everything below is the readout they produce. */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <HudFrame
              style={{
                flex: 'none',
                width: 132,
                height: 132,
                background: 'var(--surface-2)',
                border: 'var(--border-hairline) solid var(--rule-strong)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Sprite sprite={species.sprite} dex={species.dex} size={120} shadow={isShadow} className="sprite-holo" />
            </HudFrame>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
                #{String(species.dex).padStart(3, '0')}
              </div>
              <h2 style={{ margin: '2px 0 4px', fontSize: 26 }}>
                {species.name}
                {isShadow ? <span style={{ color: 'var(--shadow-aura)' }}> ⟡</span> : null}
              </h2>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                {species.types.map((t) => (
                  <span key={t} className="tag tag-neutral" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>
                    {t}
                  </span>
                ))}
                {isShadow ? <span className="tag tag-shadow" style={{ letterSpacing: '0.08em', fontSize: 10 }}>SHADOW</span> : null}
              </div>
              <div className="text-muted numeric" style={{ fontSize: 13 }}>
                IV {iv.a}/{iv.d}/{iv.s} · CP {entry.cp} · L{entry.lvl}
              </div>
            </div>
          </div>

          <div>
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
          </div>

          <div>
            <div className="hud-label" style={{ marginBottom: 8 }}>
              <span>Adjust roll</span>
            </div>
            <IVAdjuster iv={iv} onBump={bumpIv} />
          </div>

          <hr className="hr" style={{ margin: '2px 0' }} />

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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: 'var(--border-hairline) solid var(--rule-strong)' }}>
            {[
              ['Attack', entry.atk.toFixed(1)],
              ['Defense', entry.def.toFixed(1)],
              ['HP', String(entry.hp)],
            ].map(([label, value], i) => (
              <div key={label} style={{ padding: '10px 12px', borderRight: i < 2 ? 'var(--border-hairline) solid var(--rule-strong)' : undefined }}>
                <div className="text-muted" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {label}
                </div>
                <div className="numeric" style={{ fontWeight: 800, fontSize: 20 }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(
              [
                ['Stat product', `${(entry.sp / 1000).toFixed(2)}k`],
                ['% of rank 1', `${(spPct * 100).toFixed(2)}%`],
                ['Rank 1 spread', `${table.best.a}/${table.best.d}/${table.best.s} (${(table.best.sp / 1000).toFixed(2)}k)`],
                ['Best league here', `${bestLeague.league.name} · #${bestLeague.rank}`],
              ] as [string, string][]
            ).map(([label, value], i) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, ['--i' as string]: i }}>
                <span className="text-muted">{label}</span>
                <span className="numeric">{value}</span>
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
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div>
              <h4 style={{ margin: 0 }}>Breakpoints &amp; bulkpoints across the 4096</h4>
              <div className="text-muted" style={{ fontSize: 12, maxWidth: '58ch' }}>
                {bpBlurb}
              </div>
            </div>
            <SegGroup>
              {VIZ_ITEMS.map(([id, label]) => (
                <SegButton key={id} active={viz === id} onClick={() => set('viz', id)}>
                  {label}
                </SegButton>
              ))}
            </SegGroup>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="hud-label">
              <span>Matchups where your roll decides it</span>
            </div>
            <OpponentGrid items={relevance} activeId={effectiveOppId} onSelect={(id) => set('oppId', id)} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Fast move
            </span>
            {species.fastMoves.map((m, i) => (
              <ChipButton key={m.id} active={moveIdx === i} onClick={() => set('moveIdx', i)}>
                {m.name}
              </ChipButton>
            ))}
          </div>

          <MovepoolPicker
            species={species}
            selected={chargeIds}
            onChange={(ids) => set('chargeIds', ids)}
          />

          {viz === 'heat' && (
            <HeatmapView
              cells={heatCells}
              colorBy={colorBy}
              colorByLabel={colorByLabel}
              onColorBy={(c) => set('colorBy', c)}
              onPick={(a, d) => patch({ iv: { ...iv, a, d } })}
              ivS={iv.s}
              onIvS={(v) => patch({ iv: { ...iv, s: v } })}
              table={table}
              iv={iv}
            />
          )}
          {viz === 'ruler' && <RulerView rulers={rulers} />}
          {viz === 'table' && <ThresholdTable rows={bpRows} />}
          {viz === 'flip' && grid && (
            <FlipView
              ivA={iv.a}
              ivD={iv.d}
              shields={state.shields}
              onShields={(n) => set('shields', n)}
              grid={grid}
              ivS={iv.s}
              onIvS={(v) => patch({ iv: { ...iv, s: v } })}
              onPick={(a, d) => patch({ iv: { ...iv, a, d } })}
              rows={flipRows}
              activeOppIdx={activeOppIdx}
              onSelectOpponent={(idx) => set('oppId', opponents[idx].id)}
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
