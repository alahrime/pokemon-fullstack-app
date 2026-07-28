/**
 * Compact 3x3 shield-scenario picker.
 *
 * The report screen previously offered only symmetric counts — "1 shield each"
 * — which quietly hid the scenarios that decide most real matchups. Shielding
 * is rarely even: whoever burns a shield first is playing a different game from
 * that point on, and a spread that wins 1v1 can lose 1v2. The battle screen
 * already modelled both sides independently; this brings the report in line.
 *
 * Rendered as a matrix rather than two selects because the grid *is* the
 * mental model — rows are your shields, columns are theirs — and it fits in
 * roughly the width the old three chips took.
 */
export function ShieldMatrix({
  mine,
  theirs,
  onChange,
}: {
  mine: number;
  theirs: number;
  onChange: (mine: number, theirs: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <span className="hud-label" style={{ flex: 'none' }}>
        <span>Shields</span>
      </span>
      <div className="shield-matrix" role="group" aria-label="Shield scenario">
        <span />
        {[0, 1, 2].map((t) => (
          <span key={t} className="shield-matrix-label" title={`Opponent uses ${t}`}>
            {t}
          </span>
        ))}
        {[0, 1, 2].map((m) => (
          <div key={m} style={{ display: 'contents' }}>
            <span className="shield-matrix-label" title={`You use ${m}`} style={{ paddingRight: 4 }}>
              {m}
            </span>
            {[0, 1, 2].map((t) => {
              const active = mine === m && theirs === t;
              return (
                <button
                  key={t}
                  type="button"
                  className={`shield-cell${active ? ' is-active' : ''}${m === t ? ' is-even' : ''}`}
                  aria-pressed={active}
                  title={`You ${m} · them ${t}`}
                  onClick={() => onChange(m, t)}
                >
                  {m}
                  {t}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <span className="text-faint" style={{ fontSize: 10, lineHeight: 1.3 }}>
        rows you
        <br />
        cols them
      </span>
    </div>
  );
}
