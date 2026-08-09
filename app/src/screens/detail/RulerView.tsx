import type { RulerData } from '../../lib/engine';

/**
 * The damage ruler, drawn as the two-level system it actually is.
 *
 * Attack varies continuously across the 4096 spreads; damage is an integer. So
 * the map from one to the other is a step function, and measured over the real
 * roster it has **one or two levels, never more** — a move either has a
 * breakpoint in reach or it does not. That is the whole shape of the data, and
 * the design says it: two states, one of them occupied, a transition between
 * them at a definite position.
 *
 * Which is why the treatment is what it is. The unoccupied level is drawn as
 * potential rather than as a duller copy of the occupied one — hatched, no
 * fill, its label dimmed — and the occupied level is solid and lit. The
 * transition carries a node at the baseline, the one position on the axis
 * where the answer changes.
 *
 * The flat case is the common one, not the exception, so it gets a designed
 * state rather than a full-width grey bar: the field is drawn degenerate, and
 * says so, at the same height as every other row so the stack never jumps.
 *
 * Positions arrive as percentages and go out as custom properties. Nothing
 * here computes geometry — `rulersFor` did that — and nothing here is styled
 * inline, so hover, reduced motion and the theme all reach it.
 */
export function RulerView({ rulers }: { rulers: RulerData[] }) {
  return (
    <div className="stagger rv">
      {rulers.map((r, i) => (
        <section key={i} className="rv-cell" style={{ ['--i' as string]: i }} data-flat={r.flat || undefined}>
          <header className="rv-head">
            <div className="min-w-0">
              <h4 className="rv-title">{r.title}</h4>
              <div className="rv-sub">{r.sub}</div>
            </div>
            <span className="hud-label rv-badge">{r.badge}</span>
          </header>

          <div className="rv-track">
            {/* The quantised field the levels sit in. */}
            <div className="rv-field" aria-hidden="true" />
            <div className="rv-baseline" aria-hidden="true" />

            {r.bands.map((b, bi) => (
              <div
                key={bi}
                className="ruler-band rv-band"
                data-active={b.active || undefined}
                style={{
                  ['--start' as string]: `${b.start}%`,
                  ['--w' as string]: `${b.width}%`,
                  ['--i' as string]: bi,
                }}
              >
                <span className="rv-band-label">{b.label}</span>
              </div>
            ))}

            {/* Transitions: the exact points where the damage integer changes. */}
            {r.ticks.map((t, ti) => (
              <div
                key={ti}
                className="rv-tick"
                aria-hidden="true"
                style={{ ['--pos' as string]: `${t.pos}%` }}
              />
            ))}

            {/* The flag is centred on the marker, so within a flag's width of
                either end it would hang off the axis. CSS cannot see the
                position, so the edge is named here and anchored there. */}
            <div
              className="rv-you"
              style={{ ['--pos' as string]: `${r.youPos}%` }}
              data-edge={r.youPos < 8 ? 'start' : r.youPos > 92 ? 'end' : undefined}
            >
              <span className="rv-caption">
                <span className="rv-caption-key">YOU</span>
                <span className="numeric">{r.youLabel}</span>
              </span>
            </div>
          </div>

          <footer className="rv-scale">
            <span className="numeric rv-bound">
              {r.min} <i>{r.unit}</i>
            </span>
            <span className="rv-note">{r.note}</span>
            <span className="numeric rv-bound">
              {r.max} <i>{r.unit}</i>
            </span>
          </footer>
        </section>
      ))}
    </div>
  );
}
