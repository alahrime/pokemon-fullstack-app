import { useMemo, useState } from 'react';
import { canPurify, lineOf } from '../lib/data';
import { leagueVerdicts, purifiedIv } from '../lib/engine';
import type { IV, Species } from '../lib/types';
import { LeagueEmblem } from './LeagueEmblem';
import { Sprite } from './Sprite';
import { Switch } from './Switch';

const fmt = (iv: IV) => `${iv.a}/${iv.d}/${iv.s}`;

/**
 * "Is this catch worth keeping as anything it can become?": the roll ranked for every form in its line, Megas
 * included (bestAt scales their level down to the cap, as GO does). With Purified on, each eligible form shows
 * the rank at IV +2 and the rank it would otherwise have, because under a cap the extra IVs can hurt.
 */
export function EvolutionLine({ species, iv, bestBuddy, onPick }: {
  species: Species;
  iv: IV;
  bestBuddy: boolean;
  onPick: (id: string, iv: IV) => void;
}) {
  const [purified, setPurified] = useState(false);
  const line = lineOf(species);
  const anyPurifiable = line.some(canPurify);
  const on = purified && anyPurifiable;
  const rows = useMemo(
    () => line.map((s) => {
      const shown = on && canPurify(s) ? purifiedIv(iv) : iv;
      return { s, shown, plain: leagueVerdicts(s.id, iv, bestBuddy), cells: leagueVerdicts(s.id, shown, bestBuddy) };
    }),
    [line, iv, on, bestBuddy],
  );

  if (line.length < 2) return null;
  return (
    <div className="side-block rs-line">
      <div className="hud-label mb-[7px] flex items-center gap-2">
        <span className="flex-1">{on ? `Purified · ${fmt(iv)} → ${fmt(purifiedIv(iv))}` : 'Evolution line'}</span>
        {anyPurifiable && (
          <Switch
            label="Purified"
            checked={on}
            onChange={setPurified}
            title="Purifying a Shadow adds 2 to each IV, capped at 15"
          />
        )}
      </div>
      <div className="evo-line">
        {rows.map(({ s, shown, plain, cells }) => (
          <button
            key={s.id}
            type="button"
            className="evo-line-row"
            aria-current={s.id === species.id}
            title={`Open ${s.name} at ${fmt(shown)}`}
            onClick={() => { setPurified(false); onPick(s.id, shown); }}
          >
            <span className="evo-line-name"><Sprite sprite={s.sprite} dex={s.dex} size={24} />{s.name}</span>
            {cells.map((c, i) => {
              const was = plain[i].rank;
              const moved = c.rank !== was;
              return (
                <span key={c.league} className="evo-line-cell numeric" title={`${c.league}: rank ${c.rank}, ${c.pct.toFixed(1)}% of rank 1, ${c.cp} CP, level ${c.lvl}`}>
                  <LeagueEmblem league={c.league} size={16} />
                  <span className="evo-line-rank" data-move={moved ? (c.rank < was ? 'up' : 'down') : undefined}>
                    #{c.rank.toLocaleString()}{moved ? (c.rank < was ? ' ▲' : ' ▼') : ''}
                  </span>
                  <span className="evo-line-sub">{moved ? `was #${was.toLocaleString()}` : `${c.pct.toFixed(1)}%`}</span>
                </span>
              );
            })}
          </button>
        ))}
      </div>
    </div>
  );
}
