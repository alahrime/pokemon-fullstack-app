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
}: {
  species: Species;
  entry: RankedEntry;
  league: LeagueId;
  shadow: boolean;
}) {
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
          <span className="hero-vital">
            <span className="hero-vital-value numeric">{entry.cp}</span>
            <span className="hero-vital-label">CP</span>
          </span>
          <span className="hero-vital">
            <span className="hero-vital-value numeric">{entry.lvl}</span>
            <span className="hero-vital-label">Level</span>
          </span>
          <span className="hero-vital">
            <span className="hero-vital-value numeric">{entry.hp}</span>
            <span className="hero-vital-label">HP</span>
          </span>
        </div>
      </div>
    </div>
  );
}
