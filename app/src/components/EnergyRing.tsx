import { chargeMoveStats, fastMoveCounts, fastMoveStats } from '../lib/engine';
import { isPokemonType } from '../lib/pokemonTypes';
import type { ChargeMove, FastMove } from '../lib/types';

/**
 * The moveset as an energy dial.
 *
 * A ring was the request; a ring of *selectable stat tiles* would have been a
 * poor one — each tile carries six numbers, and radial text placement, tab
 * order and responsive behaviour all degrade badly. So the circle does the job
 * a circle is actually good at: showing a bounded cycle.
 *
 * The ring is the 0–100 energy bar. Each charged move sits at its cost, so you
 * can see at a glance which are close together (interchangeable), which sit
 * beyond a fast move's practical reach, and how the bar refills. The sweep
 * from 0 to the cheapest move is filled by the selected fast move's energy per
 * turn, which is the actual relationship between the two columns.
 *
 * Selection stays in the tiles below, where the numbers are legible.
 */

const R = 52;
const CX = 64;
const CY = 64;
/** Leaves a gap at the bottom so 0 and 100 don't collide. */
const SWEEP = 300;
const START = 120;

function polar(frac: number, radius = R) {
  const deg = START + frac * SWEEP;
  const rad = (deg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)] as const;
}

function arc(from: number, to: number, radius = R) {
  const [x1, y1] = polar(from, radius);
  const [x2, y2] = polar(to, radius);
  const large = (to - from) * SWEEP > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}

export function EnergyRing({
  fast,
  charges,
  selected,
}: {
  fast: FastMove;
  charges: ChargeMove[];
  selected: string[];
}) {
  const fs = fastMoveStats(fast);
  const sorted = [...charges].sort((a, b) => a.energy - b.energy);
  const cheapest = sorted[0];
  const cheapestFrac = cheapest ? Math.min(1, cheapest.energy / 100) : 0;

  return (
    <div className="energy-ring">
      <svg viewBox="0 0 128 128" width={128} height={128} role="img" aria-label="Energy dial">
        <title>Energy from 0 to 100, with each charged move marked at its cost</title>

        {/* Track */}
        <path d={arc(0, 1)} fill="none" stroke="var(--rule-hairline)" strokeWidth="11" strokeLinecap="round" />

        {/* Filled to the cheapest move — the stretch the fast move must cover
            before anything at all can be thrown. */}
        {cheapest && (
          <path
            d={arc(0, cheapestFrac)}
            fill="none"
            stroke={isPokemonType(fast.type) ? `var(--type-${fast.type})` : 'var(--color-accent)'}
            strokeWidth="11"
            strokeLinecap="round"
            opacity="0.55"
          />
        )}

        {/* One marker per charged move, at its energy cost. */}
        {sorted.map((m) => {
          const frac = Math.min(1, m.energy / 100);
          const [ox, oy] = polar(frac, R + 9);
          const [ix, iy] = polar(frac, R - 9);
          const on = selected.includes(m.id);
          const col = isPokemonType(m.type) ? `var(--type-${m.type})` : 'var(--color-accent)';
          return (
            <g key={m.id} opacity={on ? 1 : 0.45}>
              <line x1={ix} y1={iy} x2={ox} y2={oy} stroke={col} strokeWidth={on ? 3.5 : 2} strokeLinecap="round" />
              {on && <circle cx={ox} cy={oy} r="3.2" fill={col} />}
            </g>
          );
        })}

        <text x={CX} y={CY - 6} textAnchor="middle" className="ring-ept">
          {fs.ept.toFixed(2)}
        </text>
        <text x={CX} y={CY + 7} textAnchor="middle" className="ring-unit">
          NRG / TURN
        </text>
        <text x={CX} y={CY + 22} textAnchor="middle" className="ring-fast">
          {fast.name}
        </text>
      </svg>

      <ul className="ring-key">
        {sorted.map((m) => {
          const st = chargeMoveStats(m);
          const counts = fastMoveCounts(fast, m);
          const on = selected.includes(m.id);
          return (
            <li key={m.id} className={`ring-key-row${on ? ' is-on' : ''}`}>
              <span
                className="ring-key-dot"
                style={{ background: isPokemonType(m.type) ? `var(--type-${m.type})` : 'var(--color-accent)' }}
              />
              <span className="ring-key-name">{m.name}</span>
              <span className="ring-key-num numeric">{m.energy}e</span>
              <span className="ring-key-num numeric">{st.dpe.toFixed(2)}</span>
              <span className="ring-key-counts numeric">{counts.join('·')}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
