import type { RulerData } from '../../lib/engine';

export function RulerView({ rulers }: { rulers: RulerData[] }) {
  return (
    <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '8px 0 0' }}>
      {rulers.map((r, i) => (
        <div key={i} style={{ ['--i' as string]: i }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 26 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16 }}>{r.title}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {r.sub}
              </div>
            </div>
            <span className="tag tag-accent" style={{ flex: 'none', whiteSpace: 'nowrap' }}>
              {r.badge}
            </span>
          </div>
          <div
            style={{
              position: 'relative',
              height: 74,
              borderLeft: 'var(--border-strong) solid var(--rule-strong)',
              borderRight: 'var(--border-strong) solid var(--rule-strong)',
            }}
          >
            <div style={{ position: 'absolute', left: 0, right: 0, top: 34, height: 2, background: 'var(--rule-strong)' }} />
            {r.bands.map((b, bi) => (
              <div
                key={bi}
                className="ruler-band"
                style={{
                  position: 'absolute',
                  top: 0,
                  height: 34,
                  left: `${b.start}%`,
                  width: `${b.width}%`,
                  background: b.active ? 'var(--color-accent)' : `color-mix(in srgb, var(--color-text) ${6 + bi * 5}%, transparent)`,
                  color: b.active ? 'var(--color-on-accent)' : 'var(--color-text)',
                  boxShadow: b.active ? 'var(--glow-accent)' : undefined,
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 5,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  borderRight: 'var(--border-strong) solid var(--surface-1)',
                  ['--i' as string]: bi,
                }}
              >
                {b.label}
              </div>
            ))}
            {r.ticks.map((t, ti) => (
              <div
                key={ti}
                style={{
                  position: 'absolute',
                  top: 34,
                  height: 14,
                  width: 2,
                  background: 'var(--color-text)',
                  left: `${t.pos}%`,
                }}
              />
            ))}
            <div
              style={{
                position: 'absolute',
                top: -6,
                bottom: 22,
                width: 2,
                background: 'var(--color-accent)',
                left: `${r.youPos}%`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: -19,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  background: 'var(--color-accent)',
                  color: 'var(--color-on-accent)',
                  padding: '1px 5px',
                  boxShadow: 'var(--glow-accent)',
                }}
              >
                YOU {r.youLabel}
              </div>
            </div>
          </div>
          <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 22 }}>
            <span>
              {r.min} {r.unit}
            </span>
            <span>{r.note}</span>
            <span>
              {r.max} {r.unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
