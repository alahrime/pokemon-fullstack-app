import { useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID } from '../lib/data';
import { MOCK_CATCHES } from '../data/mockCatches';
import { cellColorMix, dmg, getEntry, opponentInfo } from '../lib/engine';
import { Sprite } from '../components/Sprite';

export function CompareScreen() {
  const { state, patch, beginner } = useAppState();
  const { league, cmpA, cmpB, oppId } = state;
  const opp = useMemo(() => opponentInfo(oppId, league), [oppId, league]);

  const cols = useMemo(() => {
    return [cmpA, cmpB].map((id, idx) => {
      const m = MOCK_CATCHES.find((x) => x.id === id) ?? MOCK_CATCHES[0];
      const species = SPECIES_BY_ID.get(m.speciesId)!;
      const { entry, table } = getEntry(m.speciesId, { a: m.a, d: m.d, s: m.s }, league);
      return { id, m, species, entry, table, idx };
    });
  }, [cmpA, cmpB, league]);

  const cmpWin = cols[0].entry.rank <= cols[1].entry.rank ? 0 : 1;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Compare two catches</h3>
        <div className="text-muted" style={{ fontSize: 12 }}>
          {beginner ? 'Which one should you power up? The better column is marked.' : 'Same league, same opponent, stat-by-stat delta with breakpoint tiers.'}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '2px solid var(--color-divider)' }}>
        {cols.map((c) => {
          const other = cols[1 - c.idx];
          const bars = [
            { label: 'Stat product', v: c.entry.sp, o: other.entry.sp, fmt: (v: number) => Math.round(v / 1000) + 'k' },
            { label: 'Attack', v: c.entry.atk, o: other.entry.atk, fmt: (v: number) => v.toFixed(1) },
            { label: 'Defense', v: c.entry.def, o: other.entry.def, fmt: (v: number) => v.toFixed(1) },
            { label: 'HP', v: c.entry.hp, o: other.entry.hp, fmt: (v: number) => String(v) },
          ].map((x) => {
            const max = Math.max(x.v, x.o);
            const dp = ((x.v - x.o) / x.o) * 100;
            return {
              label: x.label,
              value: x.fmt(x.v),
              w: ((x.v / max) * 100).toFixed(1) + '%',
              fill: x.v >= x.o ? 'var(--color-accent)' : 'var(--color-neutral-500)',
              delta: (dp >= 0 ? '+' : '') + dp.toFixed(1) + '%',
              deltaStyle: dp >= 0 ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
            };
          });

          const bps = c.species.fastMoves.map((mv) => {
            const seen = new Map<number, number>();
            c.table.all
              .slice()
              .sort((x, y) => x.atk - y.atk)
              .forEach((x) => {
                const d = dmg(x.atk, opp.def, mv);
                if (!seen.has(d)) seen.set(d, x.atk);
              });
            const th = [...seen.keys()].sort((x, y) => x - y);
            const hit = th.filter((d) => c.entry.atk >= seen.get(d)!);
            const next = th.find((d) => c.entry.atk < seen.get(d)!);
            return {
              id: mv.id,
              text: `${mv.name} — ${hit.length ? hit[hit.length - 1] + ' dmg' : '—'}${next ? ` (next at atk ${seen.get(next)!.toFixed(1)})` : ' (max tier)'}`,
              status: next ? `tier ${hit.length}/${th.length}` : 'top tier',
              color: next ? 'var(--color-neutral-600)' : 'var(--color-accent-700)',
            };
          });

          const slice = [];
          for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(c.table.map.get(a * 256 + d * 16 + c.m.s)!);
          const spMax = c.table.best.sp;
          const spMin = Math.min(...slice.map((x) => x.sp));

          const isBetter = cmpWin === c.idx;

          return (
            <div key={c.id} style={{ padding: 20, borderRight: c.idx === 0 ? '2px solid var(--color-divider)' : undefined }}>
              <select className="input" value={c.id} onChange={(e) => patch({ [c.idx === 0 ? 'cmpA' : 'cmpB']: e.target.value })}>
                {MOCK_CATCHES.map((op) => (
                  <option key={op.id} value={op.id}>
                    {SPECIES_BY_ID.get(op.speciesId)?.name} {op.a}/{op.d}/{op.s}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Sprite dex={c.species.dex} size={72} />
                <div style={{ minWidth: 0 }}>
                  <div className="text-muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {c.table.league.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 42, lineHeight: 1, letterSpacing: '-0.04em' }}>
                      #{c.entry.rank}
                    </span>
                    <span className="text-muted" style={{ fontSize: 13 }}>
                      / 4096
                    </span>
                    {isBetter && (
                      <span style={{ fontSize: 10, letterSpacing: '0.12em', background: 'var(--color-accent)', color: 'var(--color-bg)', padding: '2px 6px', marginLeft: 4 }}>
                        BETTER
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>
                    {c.species.name} {c.m.a}/{c.m.d}/{c.m.s} · CP {c.entry.cp} · L{c.entry.lvl}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bars.map((b) => (
                  <div key={b.label}>
                    <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      <span>{b.label}</span>
                      <span style={{ color: b.deltaStyle }}>
                        {b.value} {b.delta}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--color-neutral-300)', marginTop: 3 }}>
                      <div style={{ height: 8, background: b.fill, width: b.w }} />
                    </div>
                  </div>
                ))}
              </div>
              <hr className="hr" />
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 6 }}>
                Breakpoints vs {opp.species.name}
              </div>
              {bps.map((b) => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid var(--color-divider)', padding: '5px 0' }}>
                  <span>{b.text}</span>
                  <span style={{ color: b.color }}>{b.status}</span>
                </div>
              ))}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(16,1fr)', gap: 1, border: '1px solid var(--color-divider)', padding: 2, maxWidth: 280 }}>
                {slice.map((x) => (
                  <div
                    key={`${x.a}-${x.d}`}
                    style={{
                      aspectRatio: '1',
                      background: cellColorMix((x.sp - spMin) / Math.max(1e-9, spMax - spMin)),
                      outline: x.a === c.m.a && x.d === c.m.d ? '2px solid var(--color-text)' : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ border: '2px solid var(--color-divider)', borderTop: 0, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="tag tag-accent">Recommendation</span>
        <span style={{ fontSize: 14 }}>
          {(() => {
            const w = cols[cmpWin];
            const l = cols[1 - cmpWin];
            const gap = (((w.entry.sp - l.entry.sp) / l.entry.sp) * 100).toFixed(1);
            return beginner
              ? `Power up the ${w.species.name}. It is ${gap}% bulkier overall and ranks ${l.entry.rank - w.entry.rank} places higher.`
              : `${w.species.name} #${w.entry.rank} beats ${l.species.name} #${l.entry.rank} by ${gap}% stat product; verify move-specific breakpoints before investing.`;
          })()}
        </span>
      </div>
    </>
  );
}
