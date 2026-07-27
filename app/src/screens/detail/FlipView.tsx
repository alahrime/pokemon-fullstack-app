import { ChipButton } from '../../components/Seg';
import { Sprite } from '../../components/Sprite';
import type { FlipGrid, FlipMatchupRow } from '../../lib/engine';

const SHIELD_ITEMS: [number, string][] = [
  [0, '0 shields'],
  [1, '1 shield each'],
  [2, '2 shields each'],
];

export function FlipView({
  ivA,
  ivD,
  shields,
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
  beginner,
}: {
  ivA: number;
  ivD: number;
  shields: number;
  onShields: (n: number) => void;
  grid: FlipGrid;
  ivS: number;
  onIvS: (v: number) => void;
  onPick: (a: number, d: number) => void;
  rows: FlipMatchupRow[];
  activeOppIdx: number;
  onSelectOpponent: (idx: number) => void;
  now: { win: boolean; margin: number };
  cmpWin: boolean;
  beginner: boolean;
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

  const flipNote = beginner
    ? 'Green squares are IV spreads that beat this opponent in this shield scenario. The edge between green and grey is the breakpoint that actually matters — everything else is noise.'
    : 'Simulated at 500ms turns, throw-as-soon-as-charged, neutral typing, both sides on their default fast + charge move. Shield counts change which side of the boundary you need to be on; CMP is decided by raw attack.';

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
        <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Shields
        </span>
        {SHIELD_ITEMS.map(([n, label]) => (
          <ChipButton key={n} active={shields === n} onClick={() => onShields(n)}>
            {label}
          </ChipButton>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, width: 'min(520px,100%)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(16,minmax(0,1fr))',
              gap: 2,
              border: '1px solid var(--color-divider)',
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
                    color: o.result.win ? 'var(--color-bg)' : 'var(--color-neutral-600)',
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
            <span className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              HP IV slice {ivS}
            </span>
            <input type="range" min={0} max={15} step={1} value={ivS} onChange={(e) => onIvS(Number(e.target.value))} style={{ flex: 1, minWidth: 140 }} />
          </div>
          <div
            style={{
              fontSize: 12,
              padding: '10px 12px',
              borderLeft: `3px solid ${cmpWin ? 'var(--color-accent)' : 'var(--color-neutral-500)'}`,
              background: 'var(--color-surface)',
              marginTop: 14,
            }}
          >
            {cmpLine}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ border: '2px solid var(--color-divider)', padding: 14 }}>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 20,
                color: now.win ? 'var(--color-accent-700)' : 'var(--color-text)',
              }}
            >
              {now.win ? 'WIN' : 'LOSS'} vs {grid.opponentInfo.species.name} · {now.margin >= 0 ? '+' : ''}
              {now.margin.toFixed(0)}% HP margin
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {grid.winners.length} of {grid.total} spreads in this HP slice win
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{flipNeed}</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Opponent</th>
                <th>0s</th>
                <th>1s</th>
                <th>2s</th>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sprite dex={r.species.dex} size={26} />
                      <span style={{ fontSize: 13 }}>{r.species.name}</span>
                    </div>
                  </td>
                  {r.cells.map((c, ci) => (
                    <td key={ci}>
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontWeight: 800,
                          fontSize: 13,
                          color: c.win ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
                        }}
                      >
                        {c.win ? 'W' : 'L'}
                      </div>
                      <div className="text-muted" style={{ fontSize: 10 }}>
                        {c.margin >= 0 ? '+' : ''}
                        {c.margin.toFixed(0)}%
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
