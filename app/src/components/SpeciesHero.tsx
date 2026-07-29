import { useMemo } from 'react';
import { leagueStatRange } from '../lib/engine';
import { BestBuddyRibbon } from './BestBuddyRibbon';
import { Sprite } from './Sprite';
import { TypeBadge } from './TypeBadge';
import { LeagueEmblem } from './LeagueEmblem';
import type { LeagueId, RankedEntry, Species } from '../lib/types';

/**
 * Identity block: who you're looking at, at a glance.
 *
 * Previously a 132px thumbnail beside a 26px name, competing for width with
 * the type badges. Now the sprite gets a full-width stage of its own and the
 * name runs the width beneath it, so the subject of the page actually reads as
 * the subject.
 *
 * The stage is tinted by the active league. That's the one piece of global
 * state with no other presence in this column, and it changes every number
 * below — worth a constant reminder of which one you're in.
 */
export function SpeciesHero({
  species,
  entry,
  league,
  shadow,
  bestBuddy = false,
}: {
  species: Species;
  entry: RankedEntry;
  league: LeagueId;
  shadow: boolean;
  /** Rank-1 spread only reachable with a Best Buddy boost. */
  bestBuddy?: boolean;
}) {
  const range = useMemo(() => leagueStatRange(league), [league]);

  return (
    <div
      className={`hero${shadow ? ' is-shadow' : ''}`}
      style={
        {
          ['--lg' as string]: `var(--lg-${league})`,
          ['--lg-deep' as string]: `var(--lg-${league}-deep)`,
          ['--lg-accent' as string]: `var(--lg-${league}-accent)`,
        } as React.CSSProperties
      }
    >
      <div className="hero-stage">
        <span className="hero-dex numeric">#{String(species.dex).padStart(3, '0')}</span>
        <span className="hero-league" title={`${league} league`}>
          <LeagueEmblem league={league} size={22} />
        </span>
        <Sprite sprite={species.sprite} dex={species.dex} size={150} shadow={shadow} className="sprite-holo" />

        {/* Pinned to the stage, not the sprite. The sprite box is 150px inside
            a ~346px stage, so a badge on its corner sits ~98px shy of the
            stage edge and reads as floating in the middle. The stage already
            marks its corners this way — dex top-left, league top-right — so
            the ribbon takes the remaining one. */}
        {bestBuddy && (
          <span className="hero-buddy" title="Best Buddy required">
            <BestBuddyRibbon size={26} detail />
          </span>
        )}
      </div>

      <div className="hero-body">
        <h2 className="hero-name">
          {species.name}
          {shadow && <span className="hero-shadow-mark">⟡</span>}
        </h2>

        <div className="hero-types">
          {species.types.map((t) => (
            <TypeBadge key={t} type={t} />
          ))}
          {shadow && <span className="tag tag-shadow hero-shadow-tag">SHADOW</span>}
        </div>

        <div className="hero-vitals">
          <span className="hero-vital is-lead">
            <span className="hero-vital-value numeric">{entry.cp}</span>
            <span className="hero-vital-label">CP</span>
          </span>
          <span className="hero-vital">
            <span className="hero-vital-value numeric">{entry.lvl}</span>
            <span className="hero-vital-label">Level</span>
          </span>
          <span className="hero-vital">
            <span className="hero-vital-value numeric">{entry.rank}</span>
            <span className="hero-vital-label">Rank</span>
          </span>
        </div>

        {/* Attack, defence and HP as meters against the strongest in the
            league, so the bar answers "how does this compare" rather than
            just restating the number beside it. */}
        <div className="hero-meters">
          {(
            [
              ['ATK', entry.atk, range.atk, 'atk'],
              ['DEF', entry.def, range.def, 'def'],
              ['HP', entry.hp, range.hp, 'hp'],
            ] as const
          ).map(([label, value, max, kind]) => {
            const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
            return (
              <div className={`hero-meter is-${kind}`} key={label}>
                <span className="hero-meter-label">{label}</span>
                <span className="hero-meter-track">
                  <span className="hero-meter-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="hero-meter-value numeric">
                  {kind === 'hp' ? value : value.toFixed(1)}
                </span>
                <span className="hero-meter-pct numeric" title={`${pct.toFixed(0)}% of the league best`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
