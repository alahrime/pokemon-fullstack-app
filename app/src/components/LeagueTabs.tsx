import { LEAGUES } from '../lib/data';
import { LeagueEmblem } from './LeagueEmblem';
import { LeagueSelect, type LeagueOption } from './LeagueSelect';
import { LIMITED_CUPS } from '../lib/presetFormats';
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

const CUP_OPTIONS: LeagueOption[] = LIMITED_CUPS.map((p) => ({
  value: p.key, label: p.name, league: p.base, types: p.cup.include?.types, palette: p.palette,
  note: p.base === 'master' ? 'No cap' : `${p.base === 'great' ? 1500 : 2500} CP`,
}));

export function LeagueTabs({ value, cup, onChange }: { value: LeagueId; cup: string | null; onChange: (id: LeagueId, cup: string | null) => void }) {
  return (
    <>
    <div className="league-tabs" role="tablist" aria-label="League">
      {LEAGUES.map((lg) => {
        const active = value === lg.id;
        return (
          <button
            key={lg.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`league-tab${active && !cup ? ' is-active' : ''}`}
            style={
              {
                ['--lg' as string]: `var(--lg-${lg.id})`,
                ['--lg-deep' as string]: `var(--lg-${lg.id}-deep)`,
                ['--lg-accent' as string]: `var(--lg-${lg.id}-accent)`,
              } as React.CSSProperties
            }
            onClick={() => onChange(lg.id, null)}
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
    <div className="cup-select">
      <LeagueSelect
        id="cup-select"
        label="Limited cup"
        value={cup ?? ''}
        options={[{ value: '', label: 'No cup', league: value, note: 'Standard rules' }, ...CUP_OPTIONS]}
        onChange={(k) => { const c = LIMITED_CUPS.find((p) => p.key === k); onChange(c ? c.base : value, c?.key ?? null); }}
      />
    </div>
    </>
  );
}
