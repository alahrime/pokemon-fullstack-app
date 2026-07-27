import { useMemo } from 'react';
import { useAppState, type Viz } from '../state/AppState';
import { SPECIES_BY_ID, opponentsFor } from '../lib/data';
import {
  bestLeagueFor,
  bpRowsFor,
  buildHeatCells,
  flipGrid,
  flipMatchupRows,
  getEntry,
  opponentInfo,
  rulersFor,
  verdictLine,
} from '../lib/engine';
import { Sprite } from '../components/Sprite';
import { IVAdjuster } from '../components/IVAdjuster';
import { ChipButton, SegButton, SegGroup } from '../components/Seg';
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
  const { state, set, patch, bumpIv, beginner } = useAppState();
  const { league, species: speciesId, iv, viz, colorBy, oppId, moveIdx } = state;

  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry, table } = getEntry(speciesId, iv, league);
  const opponents = useMemo(() => opponentsFor(league), [league]);
  const activeOppIdx = Math.max(0, opponents.findIndex((o) => o.id === oppId));
  const opp = useMemo(() => opponentInfo(oppId || opponents[0]?.id, league), [oppId, opponents, league]);

  const spPct = entry.sp / table.best.sp;
  const bestLeague = bestLeagueFor(speciesId, iv);
  const bpRows = useMemo(() => bpRowsFor(speciesId, iv, league, opp), [speciesId, iv, league, opp]);

  const heatCells = useMemo(
    () => (viz === 'heat' ? buildHeatCells(speciesId, iv, league, opp, moveIdx, colorBy) : []),
    [viz, speciesId, iv, league, opp, moveIdx, colorBy],
  );
  const rulers = useMemo(() => (viz === 'ruler' ? rulersFor(speciesId, iv, league, opp) : []), [viz, speciesId, iv, league, opp]);
  const grid = useMemo(
    () => (viz === 'flip' ? flipGrid(speciesId, iv, league, opp.species.id, moveIdx, state.shields) : null),
    [viz, speciesId, iv, league, opp, moveIdx, state.shields],
  );
  const flipRows = useMemo(
    () => (viz === 'flip' ? flipMatchupRows(speciesId, iv, league, moveIdx, opponents.map((o) => o.id)) : []),
    [viz, speciesId, iv, league, moveIdx, opponents],
  );

  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const colorByLabel = colorBy === 'rank' ? 'stat product rank' : colorBy === 'break' ? `${mv.name} damage dealt` : `${opp.fastMove.name} damage taken`;

  const bpBlurb = beginner
    ? 'Every square is one of the 4096 possible catches. A breakpoint is the attack value where your fast move starts doing one more damage — cross it and every hit for the rest of the fight is stronger.'
    : `${table.league.name} · ${table.best.a}/${table.best.d}/${table.best.s} is rank 1 at ${(table.best.sp / 1000).toFixed(2)}k. Thresholds where floor(0.5·P·Atk/Def·STAB) steps by 1 for ${mv.name} into ${opp.species.name}, and where incoming ${opp.fastMove.name} steps down.`;

  const footnote = beginner
    ? 'Rank compares your Pokémon against every one of the 4096 possible IV rolls at this CP cap. #1 is the best possible. Click any heatmap cell to load that spread.'
    : 'Stat product = Atk × Def × floor(HP) at the highest level under the cap; ranks recomputed per species per league. Damage model: floor(0.5 · power · Atk/Def · STAB) + 1. Click any heatmap cell to load that spread.';

  const rankBarW = (100 - ((entry.rank - 1) / 4095) * 100).toFixed(2) + '%';

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,340px) minmax(0,1fr)', gap: 0, border: '2px solid var(--color-divider)' }}>
        {/* Left column */}
        <div style={{ borderRight: '2px solid var(--color-divider)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div
              style={{
                flex: 'none',
                width: 88,
                height: 88,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-divider)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Sprite dex={species.dex} size={80} />
            </div>
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
              <div className="text-muted" style={{ fontSize: 13 }}>
                IV {iv.a}/{iv.d}/{iv.s} · CP {entry.cp} · L{entry.lvl}
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--color-text)', color: 'var(--color-bg)', padding: '16px 18px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>Stat product rank</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 52, lineHeight: 1, letterSpacing: '-0.04em' }}>
                #{entry.rank}
              </span>
              <span style={{ fontSize: 15, opacity: 0.55 }}>/ 4096</span>
            </div>
            <div style={{ height: 2, background: 'rgba(255,255,255,0.25)', margin: '12px 0 8px' }}>
              <div style={{ height: 2, background: 'var(--color-accent)', width: rankBarW }} />
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{verdictLine(entry.rank, beginner)}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: '1px solid var(--color-divider)' }}>
            {[
              ['Attack', entry.atk.toFixed(1)],
              ['Defense', entry.def.toFixed(1)],
              ['HP', String(entry.hp)],
            ].map(([label, value], i) => (
              <div key={label} style={{ padding: '10px 12px', borderRight: i < 2 ? '1px solid var(--color-divider)' : undefined }}>
                <div className="text-muted" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {label}
                </div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 20 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="text-muted">Stat product</span>
              <span>{(entry.sp / 1000).toFixed(2)}k</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="text-muted">% of rank 1</span>
              <span>{(spPct * 100).toFixed(2)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="text-muted">Rank 1 spread</span>
              <span>
                {table.best.a}/{table.best.d}/{table.best.s} ({(table.best.sp / 1000).toFixed(2)}k)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="text-muted">Best league here</span>
              <span>
                {bestLeague.league.name} · #{bestLeague.rank}
              </span>
            </div>
          </div>

          <hr className="hr" style={{ margin: '2px 0' }} />

          <div>
            <div className="text-muted" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Adjust roll
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
              <ChipButton key={o.id} active={oppId === o.id} onClick={() => set('oppId', o.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sprite dex={o.dex} size={22} />
                {o.name}
              </ChipButton>
            ))}
            <span style={{ width: 2, height: 20, background: 'var(--color-divider)' }} />
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
              beginner={beginner}
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
