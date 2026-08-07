import type { RulerData } from '../../lib/engine';

export function RulerView({ rulers }: { rulers: RulerData[] }) {
  return (
    <div className="stagger rv">
      {rulers.map((r, i) => (
        <div key={i} style={{ ['--i' as string]: i }}>
          <div className="rv-head">
            <div className="min-w-0">
              <div className="rv-title">{r.title}</div>
              <div className="text-muted text-sm">
                {r.sub}
              </div>
            </div>
            <span className="tag tag-accent rv-head-aside">
              {r.badge}
            </span>
          </div>
          <div className="rv-track">
            <div className="rv-baseline" />
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
              <div className="rv-caption">
                YOU {r.youLabel}
              </div>
            </div>
          </div>
          <div className="text-muted rv-scale">
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
