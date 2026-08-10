import { useMemo } from 'react';
import { leagueStatRange } from '../lib/engine';
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
        {/* The ribbon comes from Sprite, pinned to the sprite's own top-left,
            rather than being a fourth mark on the stage corner as it was.
            It reads as attached to the Pokemon at the cost of no longer
            completing the corner set with the dex and the league emblem —
            worth it for one badge that sits in the same place on every screen
            instead of one position here and another in Battle. */}
        <Sprite
          sprite={species.sprite}
          dex={species.dex}
          size={150}
          shadow={shadow}
          bestBuddy={bestBuddy}
          className="sprite-holo"
        />
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
            just restating the number beside it.

            The number is the *stat*, and a Shadow's stats are its base form's.
            The 6/5 attack and 5/6 defence are multipliers applied in the damage
            formula, not changes to the stat — which is why CP does not move
            when the form does, and why charge-move priority between a Shadow
            and its base form is always a tie. Showing the multiplied figure
            here reported a stat that does not exist and implied a CMP
            difference that never happens.

            So the bar carries the effect instead: base stat in the usual fill,
            and the Shadow adjustment as a second segment beyond it — added for
            attack, given back for defence. */}
        <div className="hero-meters">
          {(
            [
              ['ATK', entry.statAtk, entry.atk, range.atk, 'atk'],
              ['DEF', entry.statDef, entry.def, range.def, 'def'],
              ['HP', entry.hp, entry.hp, range.hp, 'hp'],
            ] as const
          ).map(([label, stat, effective, max, kind]) => {
            const clamp = (v: number) => Math.max(0, Math.min(100, v));
            const statPct = max > 0 ? clamp((stat / max) * 100) : 0;
            const effPct = max > 0 ? clamp((effective / max) * 100) : 0;
            // The delta runs from whichever is lower to whichever is higher, so
            // one rule draws both the attack gain and the defence give-back.
            const lo = Math.min(statPct, effPct);
            const hi = Math.max(statPct, effPct);
            const gain = effective > stat;
            const shifted = Math.abs(effective - stat) > 0.05;
            return (
              <div className={`hero-meter is-${kind}`} key={label}>
                <span className="hero-meter-label">{label}</span>
                <span className="hero-meter-track">
                  <span className="hero-meter-fill" style={{ width: `${lo}%` }} />
                  {shifted && (
                    <span
                      className={`hero-meter-shadow${gain ? ' is-gain' : ' is-loss'}`}
                      style={{ left: `${lo}%`, width: `${hi - lo}%` }}
                      title={`Shadow ${gain ? 'deals' : 'takes'} damage as if ${effective.toFixed(1)} — the ${label} stat itself stays ${stat.toFixed(1)}`}
                    />
                  )}
                </span>
                <span className="hero-meter-value numeric">
                  {kind === 'hp' ? stat : stat.toFixed(1)}
                </span>
                <span className="hero-meter-pct numeric" title={`${statPct.toFixed(0)}% of the league best`}>
                  {statPct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
