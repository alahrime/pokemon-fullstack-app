import { useEffect, useMemo } from 'react';
import { useAppState, type Viz } from '../state/AppState';
import { SPECIES_BY_ID } from '../lib/data';
import {
  bestLeagueFor,
  bpRowsFor,
  buildHeatCells,
  flipGrid,
  flipMatchupRows,
  getEntry,
  opponentInfo,
  relevantOpponents,
  rulersFor,
  verdictLine,
} from '../lib/engine';
import { Sprite } from '../components/Sprite';
import { IVAdjuster } from '../components/IVAdjuster';
import { ChipButton, SegButton, SegGroup } from '../components/Seg';
import { HudFrame, HudReadout } from '../components/Hud';
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
  const { league, species: speciesId, iv, viz, colorBy, oppId, moveIdx } = state;

  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry, table } = getEntry(speciesId, iv, league);
  const relevanceKind = viz === 'heat' && colorBy !== 'rank' ? colorBy : 'either';
  const opponents = useMemo(
    () => relevantOpponents(speciesId, league, moveIdx, relevanceKind, 16),
    [speciesId, league, moveIdx, relevanceKind],
  );
  const effectiveOppId = opponents.some((o) => o.id === oppId) ? oppId : (opponents[0]?.id ?? oppId);
  useEffect(() => {
    if (effectiveOppId !== oppId) set('oppId', effectiveOppId);
  }, [effectiveOppId, oppId, set]);
  const activeOppIdx = Math.max(0, opponents.findIndex((o) => o.id === effectiveOppId));
  const opp = useMemo(() => opponentInfo(effectiveOppId, league), [effectiveOppId, league]);

  const spPct = entry.sp / table.best.sp;
  const bestLeague = bestLeagueFor(speciesId, iv);
  const bpRows = useMemo(() => bpRowsFor(speciesId, iv, league, opp), [speciesId, iv, league, opp]);

  const heatCells = useMemo(
    () => (viz === 'heat' ? buildHeatCells(speciesId, iv, league, opp, moveIdx, colorBy) : []),
    [viz, speciesId, iv, league, opp, moveIdx, colorBy],
  );
  const rulers = useMemo(() => (viz === 'ruler' ? rulersFor(speciesId, iv, league, opp) : []), [viz, speciesId, iv, league, opp]);
  const grid = useMemo(
    () => (viz === 'flip' ? flipGrid(speciesId, iv, league, opp.id, moveIdx, state.shields) : null),
    [viz, speciesId, iv, league, opp, moveIdx, state.shields],
  );
  const flipRows = useMemo(
    () => (viz === 'flip' ? flipMatchupRows(speciesId, iv, league, moveIdx, opponents.map((o) => o.id)) : []),
    [viz, speciesId, iv, league, moveIdx, opponents],
  );

  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const colorByLabel = colorBy === 'rank' ? 'stat product rank' : colorBy === 'break' ? `${mv.name} damage dealt` : `${opp.fastMove.name} damage taken`;

  const bpBlurb = `${table.league.name} · ${table.best.a}/${table.best.d}/${table.best.s} is rank 1 at ${(table.best.sp / 1000).toFixed(2)}k. Thresholds where floor(0.5·P·Atk/Def·STAB) steps by 1 for ${mv.name} into ${opp.name}, and where incoming ${opp.fastMove.name} steps down.`;

  const footnote =
    'Stat product = Atk × Def × floor(HP) at the highest level under the cap; ranks recomputed per species per league. Damage model: floor(0.5 · power · Atk/Def · STAB) + 1. Click any heatmap cell to load that spread.';

  const rankBarW = (100 - ((entry.rank - 1) / 4095) * 100).toFixed(2) + '%';

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,340px) minmax(0,1fr)', gap: 0, border: 'var(--border-strong) solid var(--rule-strong)' }}>
        {/* Left column */}
        <div style={{ borderRight: 'var(--border-strong) solid var(--rule-strong)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <HudFrame
              style={{
                flex: 'none',
                width: 88,
                height: 88,
                background: 'var(--surface-2)',
                border: 'var(--border-hairline) solid var(--rule-strong)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Sprite dex={species.dex} size={80} className="sprite-holo" />
            </HudFrame>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
                #{String(species.dex).padStart(3, '0')}
              </div>
              <h2 style={{ margin: '2px 0 4px', fontSize: 28 }}>{species.name}</h2>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                {species.types.map((t) => (
                  <span key={t} className="tag tag-neutral" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="text-muted numeric" style={{ fontSize: 13 }}>
                IV {iv.a}/{iv.d}/{iv.s} · CP {entry.cp} · L{entry.lvl}
              </div>
            </div>
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
            <div style={{ fontSize: 12, opacity: 0.75 }}>{verdictLine(entry.rank)}</div>
          </HudFrame>

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

          <hr className="hr" style={{ margin: '2px 0' }} />

          <div>
            <div className="hud-label" style={{ marginBottom: 8 }}>
              <span>Adjust roll</span>
            </div>
            <IVAdjuster iv={iv} onBump={bumpIv} />
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

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              vs
            </span>
            {opponents.map((o) => (
              <ChipButton key={o.id} active={effectiveOppId === o.id} onClick={() => set('oppId', o.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sprite dex={o.dex} size={22} />
                {o.name}
              </ChipButton>
            ))}
            <span style={{ width: 2, height: 20, background: 'var(--rule-strong)' }} />
            {species.fastMoves.map((m, i) => (
              <ChipButton key={m.id} active={moveIdx === i} onClick={() => set('moveIdx', i)}>
                {m.name}
              </ChipButton>
            ))}
          </div>

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
