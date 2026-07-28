import type { ScenarioCell } from '../lib/engine';

/**
 * Shield-scenario picker that doubles as a readout.
 *
 * Shielding is rarely even — whoever burns a shield first is playing a
 * different game from that point on, and a spread that wins 1v1 can lose 1v2 —
 * so both sides are independent. Rows are your shields, columns are theirs.
 *
 * Each cell shows the HP margin for that scenario rather than the coordinate
 * pair it used to. The coordinates were already encoded by position, so "12"
 * was redundant; the margin is the thing you're actually choosing between, and
 * showing all nine at once turns the picker into a map of the matchup.
 */

/** Saturation tracks how decisive the result is, capped where it stops reading. */
const FULL_MARGIN = 40;

function cellStyle(c: ScenarioCell, active: boolean) {
  const weight = Math.min(1, Math.abs(c.margin) / FULL_MARGIN);
  const hue = c.win ? 'var(--color-accent)' : 'var(--color-neutral-600)';
  return {
    background: `color-mix(in srgb, ${hue} ${(8 + weight * 46).toFixed(0)}%, transparent)`,
    borderColor: active ? 'var(--color-text)' : `color-mix(in srgb, ${hue} ${(30 + weight * 40).toFixed(0)}%, transparent)`,
    color: c.win ? 'var(--color-accent-800)' : 'var(--color-neutral-800)',
  };
}

export function ShieldMatrix({
  mine,
  theirs,
  cells,
  onChange,
}: {
  mine: number;
  theirs: number;
  cells: ScenarioCell[][];
  onChange: (mine: number, theirs: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="hud-label">
        <span>Shield scenarios · your HP margin</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="shield-axis-y">your shields</span>
        <div>
          <div className="shield-matrix" role="group" aria-label="Shield scenario">
            <span />
            {[0, 1, 2].map((t) => (
              <span key={t} className="shield-matrix-label">
                {t}
              </span>
            ))}
            {[0, 1, 2].map((m) => (
              <div key={m} style={{ display: 'contents' }}>
                <span className="shield-matrix-label">{m}</span>
                {[0, 1, 2].map((t) => {
                  const c = cells[m]?.[t];
                  const active = mine === m && theirs === t;
                  if (!c) return <span key={t} />;
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`shield-cell${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      title={`You ${m} shield${m === 1 ? '' : 's'} vs their ${t} — ${c.win ? 'win' : 'loss'} by ${Math.abs(c.margin).toFixed(1)}% HP`}
                      onClick={() => onChange(m, t)}
                      style={cellStyle(c, active)}
                    >
                      <span className="shield-cell-margin numeric">
                        {c.margin >= 0 ? '+' : '−'}
                        {Math.abs(c.margin).toFixed(0)}
                      </span>
                      <span className="shield-cell-wl">{c.win ? 'W' : 'L'}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="shield-axis-x">opponent shields</div>
        </div>
      </div>
    </div>
  );
}
