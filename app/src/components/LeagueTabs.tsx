import { LEAGUES } from '../lib/data';
import { LeagueEmblem } from './LeagueEmblem';
import type { LeagueId } from '../lib/types';

/**
 * League switcher as folder tabs.
 *
 * This is the app's largest state change — league sets the CP cap, which
 * rebuilds every ranking table, swaps the opponent pool and re-runs every
 * simulation. It previously looked identical to the Report/Battle toggle
 * beside it, which undersold that. Now each league carries its own ball
 * colours and emblem, and the selected tab lifts clear of the row with a
 * folded corner, the way a pulled folder sits proud of the others.
 */

const CAPS: Record<LeagueId, string> = {
  great: '1500 CP',
  ultra: '2500 CP',
  master: 'NO CAP',
};

const SHORT: Record<LeagueId, string> = {
  great: 'Great',
  ultra: 'Ultra',
  master: 'Master',
};

export function LeagueTabs({ value, onChange }: { value: LeagueId; onChange: (id: LeagueId) => void }) {
  return (
    <div className="league-tabs" role="tablist" aria-label="League">
      {LEAGUES.map((lg) => {
        const active = value === lg.id;
        return (
          <button
            key={lg.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`league-tab${active ? ' is-active' : ''}`}
            style={
              {
                ['--lg' as string]: `var(--lg-${lg.id})`,
                ['--lg-deep' as string]: `var(--lg-${lg.id}-deep)`,
                ['--lg-accent' as string]: `var(--lg-${lg.id}-accent)`,
              } as React.CSSProperties
            }
            onClick={() => onChange(lg.id)}
            title={`${lg.name} — rankings, opponents and simulations all change`}
          >
            <LeagueEmblem league={lg.id} size={30} />
            <span className="league-tab-text">
              <span className="league-tab-name">{SHORT[lg.id]}</span>
              <span className="league-tab-cap numeric">{CAPS[lg.id]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
