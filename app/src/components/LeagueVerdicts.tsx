import type { CSSProperties } from 'react';
import { LEAGUE_BY_ID } from '../lib/data';
import type { LeagueVerdict } from '../lib/engine';
import type { LeagueId } from '../lib/types';
import { LeagueEmblem } from './LeagueEmblem';

const NAME: Record<LeagueId, string> = { great: 'Great', ultra: 'Ultra', master: 'Master' };

/**
 * The roll above it, in every league at once: "is this catch worth keeping for anything?" without switching tabs.
 * A row is the league switch too, so the readout below it follows whichever league you tap.
 */
export function LeagueVerdicts({ rows, current, onPick }: {
  rows: readonly LeagueVerdict[];
  current: LeagueId;
  onPick: (league: LeagueId) => void;
}) {
  return (
    <div className="league-verdicts" role="group" aria-label="This roll in every league">
      {rows.map((r) => (
        <button
          key={r.league}
          type="button"
          className="league-verdict"
          aria-pressed={r.league === current}
          style={{ '--lg-accent': `var(--lg-${r.league}-accent)` } as CSSProperties}
          onClick={() => onPick(r.league)}
          title={`Show ${LEAGUE_BY_ID.get(r.league)!.name}`}
          // The name is hidden on phones (the emblem carries it there), so the label says it all.
          aria-label={`${NAME[r.league]} League: rank ${r.rank}, ${r.pct.toFixed(1)}% of rank 1, ${r.cp} CP, level ${r.lvl}`}
        >
          <LeagueEmblem league={r.league} size={22} />
          <span className="league-verdict-name">{NAME[r.league]}</span>
          <span className="league-verdict-rank numeric">#{r.rank.toLocaleString()}</span>
          <span className="league-verdict-pct numeric">{r.pct.toFixed(1)}%</span>
          <span className="league-verdict-cp numeric">{r.cp.toLocaleString()} <small>CP</small></span>
          <span className="league-verdict-lvl numeric"><small>Lv</small> {r.lvl}</span>
        </button>
      ))}
    </div>
  );
}
