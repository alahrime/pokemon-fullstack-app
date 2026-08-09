import { Sprite } from '../../components/Sprite';
import { ShieldMatrix } from '../../components/ShieldMatrix';
import type { FlipGrid, FlipMatchupRow, ScenarioCell } from '../../lib/engine';

/** One face of a matchup flip card. Both faces always render; CSS turns the card. */
function FlipFace({ win, margin, back = false }: { win: boolean; margin: number; back?: boolean }) {
  return (
    <div
      className={`flip-face${back ? ' flip-face-back' : ''}`}
      style={{
        background: win ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'var(--surface-2)',
      }}
    >
      <div className="fv-face-body">
        <div
          style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 800,
            fontSize: 13,
            color: win ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
          }}
        >
          {win ? 'W' : 'L'}
        </div>
        <div className="text-muted numeric text-2xs">
          {margin >= 0 ? '+' : ''}
          {margin.toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

export function FlipView({
  ivA,
  ivD,
  shieldsMine,
  shieldsTheirs,
  scenarios,
  onShields,
  grid,
  ivS,
  onIvS,
  onPick,
  rows,
  activeOppIdx,
  onSelectOpponent,
  now,
  cmpWin,
}: {
  ivA: number;
  ivD: number;
  shieldsMine: number;
  shieldsTheirs: number;
  scenarios: ScenarioCell[][];
  onShields: (mine: number, theirs: number) => void;
  grid: FlipGrid;
  ivS: number;
  onIvS: (v: number) => void;
  onPick: (a: number, d: number) => void;
  rows: FlipMatchupRow[];
  activeOppIdx: number;
  onSelectOpponent: (idx: number) => void;
  now: { win: boolean; margin: number };
  cmpWin: boolean;
}) {
  const cheapest = grid.cheapest;
  const minAtkWin = grid.minAtkWin;

  const flipNeed = now.win
    ? cheapest
      ? `Cheapest winning spread here: ${cheapest.entry.a}/${cheapest.entry.d}/${cheapest.entry.s} (#${cheapest.entry.rank})`
      : ''
    : minAtkWin
      ? `Flips to a win at attack ${minAtkWin.entry.atk.toFixed(1)} — spread ${minAtkWin.entry.a}/${minAtkWin.entry.d}/${minAtkWin.entry.s} (#${minAtkWin.entry.rank})`
      : 'No spread in this slice wins — the matchup is lost on stats alone';

  const cmpLine = cmpWin
    ? `You win CMP ties: your attack is higher. Simultaneous charge moves land yours first.`
    : `You lose CMP ties: their attack is higher. Their charge move resolves first if thrown together.`;

  const flipNote =
    `Columns are your shield count against the opponent's ${shieldsTheirs}. ` +
    'Simulated at 500ms turns, throw-as-soon-as-charged, neutral typing, both sides on their default fast + charge move. Shield counts change which side of the boundary you need to be on; CMP is decided by raw attack.';

  return (
    <>
      {/* The result of the roll you are on, above everything it explains. It
          used to sit at the top of the right-hand column, which pushed the
          opponents table down out of sight — so the table you use to change
          the matchup was not visible while reading the grid it changed. */}
      <div className="fv-now">
        <div
          className="fv-now-verdict"
          style={{ color: now.win ? 'var(--color-accent-700)' : 'var(--color-text)' }}
        >
          {now.win ? 'WIN' : 'LOSS'} vs {grid.opponentInfo.name} · {now.margin >= 0 ? '+' : ''}
          {now.margin.toFixed(0)}% HP margin
        </div>
        <div className="text-muted fv-now-sub">
          {grid.winners.length} of {grid.total} spreads in this HP slice win
        </div>
        <div className="fv-now-need">{flipNeed}</div>
      </div>
      <div className="fv-cols">
        <div className="fv-grid-col">
          <div className="fv-grid">
            {grid.results.map((o) => {
              const isYou = o.entry.a === ivA && o.entry.d === ivD;
              return (
                <div
                  key={`${o.entry.a}-${o.entry.d}`}
                  title={`ATK ${o.entry.a} / DEF ${o.entry.d} — ${o.result.win ? 'WIN' : 'LOSS'} by ${o.result.margin.toFixed(0)}% HP · #${o.entry.rank}`}
                  onClick={() => onPick(o.entry.a, o.entry.d)}
                  style={{
                    aspectRatio: '1',
                    minWidth: 0,
                    background: o.result.win ? 'var(--color-accent-500)' : 'var(--color-neutral-200)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 8,
                    cursor: 'pointer',
                    color: o.result.win ? 'var(--color-on-accent)' : 'var(--color-neutral-600)',
                    outline: isYou ? '2px solid var(--color-text)' : undefined,
                    zIndex: isYou ? 2 : undefined,
                  }}
                >
                  {isYou ? '●' : ''}
                </div>
              );
            })}
          </div>
          <div className="text-muted fv-axis">
            <span>0 · ATTACK IV · 15</span>
            <span>rows = DEF IV 15 → 0</span>
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <span className="text-muted text-xs tracking-[0.08em] uppercase whitespace-nowrap">
              HP IV slice {ivS}
            </span>
            <input type="range" min={0} max={15} step={1} value={ivS} onChange={(e) => onIvS(Number(e.target.value))} className="fv-slice-range" />
          </div>
          <div
            style={{
              fontSize: 12,
              padding: '10px 12px',
              borderLeft: `3px solid ${cmpWin ? 'var(--color-accent)' : 'var(--color-neutral-500)'}`,
              background: 'var(--surface-2)',
              marginTop: 14,
            }}
          >
            {cmpLine}
          </div>
        </div>
        <div className="fv-side">
          <ShieldMatrix mine={shieldsMine} theirs={shieldsTheirs} cells={scenarios} onChange={onShields} />
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th title={`your 0 shields vs their ${shieldsTheirs}`}>0s</th>
                  <th title={`your 1 shield vs their ${shieldsTheirs}`}>1s</th>
                  <th title={`your 2 shields vs their ${shieldsTheirs}`}>2s</th>
                  <th>CMP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.species.id}
                    style={i === activeOppIdx ? { background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' } : undefined}
                    onClick={() => onSelectOpponent(i)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <Sprite sprite={r.species.sprite} dex={r.species.dex} size={26} />
                        <span className="fv-row-name">{r.species.name}</span>
                      </div>
                    </td>
                    {r.cells.map((c, ci) => (
                      <td key={ci}>
                        {/* The card turns over when the matchup does — the flip
                            is the concept this whole view is named for. */}
                        <div className={`flip-card h-[38px] w-[54px]${c.win ? ' is-won' : ''}`} >
                          <div className="flip-card-inner">
                            <FlipFace win={false} margin={c.margin} />
                            <FlipFace win margin={c.margin} back />
                          </div>
                        </div>
                      </td>
                    ))}
                    <td
                      style={{
                        fontSize: 11,
                        color: r.cmpWin ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
                      }}
                    >
                      {r.cmpWin ? 'you' : 'them'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted fv-note">
            {flipNote}
          </p>
        </div>
      </div>
    </>
  );
}
