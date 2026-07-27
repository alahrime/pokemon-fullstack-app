import { useMemo } from 'react';
import { useAppState, type ColorBy } from '../state/AppState';
import { SPECIES_BY_ID } from '../lib/data';
import { buildHeatCells, getEntry, opponentInfo } from '../lib/engine';
import { Sprite } from '../components/Sprite';
import { ChipButton } from '../components/Seg';
import { Heatmap } from '../components/Heatmap';

const COLOR_BY_ITEMS: [ColorBy, string][] = [
  ['rank', 'Rank'],
  ['break', 'Breakpoints'],
  ['bulk', 'Bulkpoints'],
];

export function ExplorerScreen() {
  const { state, set, patch, beginner } = useAppState();
  const { league, species: speciesId, iv, colorBy, oppId, moveIdx } = state;
  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry, table } = getEntry(speciesId, iv, league);
  const opp = useMemo(() => opponentInfo(oppId, league), [oppId, league]);
  const cells = useMemo(() => buildHeatCells(speciesId, iv, league, opp, moveIdx, colorBy), [speciesId, iv, league, opp, moveIdx, colorBy]);

  const explorerBlurb = beginner
    ? 'Every square is one possible catch. Darker red means better. Your catch is outlined.'
    : `${table.league.name} · ${table.best.a}/${table.best.d}/${table.best.s} is rank 1 at ${(table.best.sp / 1000).toFixed(2)}k · slice fixes HP IV`;

  const topRows = table.all.slice(0, 12);

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Sprite dex={species.dex} size={56} />
            <div>
              <h3 style={{ margin: 0 }}>{species.name} — the whole 4096</h3>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {explorerBlurb}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {COLOR_BY_ITEMS.map(([id, label]) => (
              <ChipButton key={id} active={colorBy === id} onClick={() => set('colorBy', id)}>
                {label}
              </ChipButton>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="text-muted" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, padding: '14px 0' }}>
            <span>15</span>
            <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.1em' }}>DEF IV</span>
            <span>0</span>
          </div>
          <div style={{ minWidth: 0, width: 'min(680px,100%)' }}>
            <Heatmap cells={cells} onPick={(a, d) => patch({ iv: { ...iv, a, d } })} gap={2} />
            <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 6, letterSpacing: '0.1em' }}>
              <span>0</span>
              <span>ATTACK IV</span>
              <span>15</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 520 }}>
          <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            HP IV slice
          </span>
          <input type="range" min={0} max={15} step={1} value={iv.s} onChange={(e) => patch({ iv: { ...iv, s: Number(e.target.value) } })} style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, width: 24, textAlign: 'right' }}>{iv.s}</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 300 }}>
        <h4 style={{ margin: '0 0 8px' }}>Top of the space</h4>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>IV</th>
              <th>CP</th>
              <th>L</th>
              <th>SP</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {topRows.map((r) => (
              <tr
                key={`${r.a}-${r.d}-${r.s}`}
                style={r.a === iv.a && r.d === iv.d && r.s === iv.s ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : undefined}
              >
                <td style={{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>{r.rank}</td>
                <td>
                  {r.a}/{r.d}/{r.s}
                </td>
                <td>{r.cp}</td>
                <td>{r.lvl}</td>
                <td>{(r.sp / 1000).toFixed(2)}k</td>
                <td style={{ fontSize: 12, color: 'var(--color-accent-700)' }}>{((r.sp / table.best.sp) * 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
          Click any cell to load that spread into the report. The slider moves through the third axis — 16 slices make up the
          full 4096. Rank {entry.rank} is currently selected.
        </p>
      </div>
    </div>
  );
}
