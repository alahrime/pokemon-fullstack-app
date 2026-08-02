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
      <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
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
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, width: 'min(520px,100%)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(16,minmax(0,1fr))',
              gap: 2,
              border: 'var(--border-hairline) solid var(--rule-strong)',
              padding: 3,
            }}
          >
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
          <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 4 }}>
            <span>0 · ATTACK IV · 15</span>
            <span>rows = DEF IV 15 → 0</span>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="text-muted text-xs tracking-[0.08em] uppercase whitespace-nowrap">
              HP IV slice {ivS}
            </span>
            <input type="range" min={0} max={15} step={1} value={ivS} onChange={(e) => onIvS(Number(e.target.value))} style={{ flex: 1, minWidth: 140 }} />
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
        <div className="flex min-w-[280px] flex-1 flex-col gap-3">
          <div style={{ border: 'var(--border-strong) solid var(--rule-strong)', padding: 14 }}>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 20,
                color: now.win ? 'var(--color-accent-700)' : 'var(--color-text)',
              }}
            >
              {now.win ? 'WIN' : 'LOSS'} vs {grid.opponentInfo.name} · {now.margin >= 0 ? '+' : ''}
              {now.margin.toFixed(0)}% HP margin
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {grid.winners.length} of {grid.total} spreads in this HP slice win
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{flipNeed}</div>
          </div>
          <ShieldMatrix mine={shieldsMine} theirs={shieldsTheirs} cells={scenarios} onChange={onShields} />
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
                      <span style={{ fontSize: 13 }}>{r.species.name}</span>
                    </div>
                  </td>
                  {r.cells.map((c, ci) => (
                    <td key={ci}>
                      {/* The card turns over when the matchup does — the flip
                          is the concept this whole view is named for. */}
                      <div className={`flip-card${c.win ? ' is-won' : ''}`} style={{ height: 38, width: 54 }}>
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
          <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
            {flipNote}
          </p>
        </div>
      </div>
    </>
  );
}
