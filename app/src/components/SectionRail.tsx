import type { Screen } from '../state/AppState';
import { railIdOf, railScreens, type SectionDef } from '../lib/screens';
import type { Badges } from '../lib/badges';

/** The active section's screens, as a left rail (a scrolling strip on a phone). */
export function SectionRail({
  section,
  screen,
  badges,
  onGo,
}: {
  section: SectionDef;
  screen: Screen;
  badges: Badges;
  onGo: (s: Screen) => void;
}) {
  const lit = railIdOf(screen);
  return (
    <nav className="section-rail" aria-label={`${section.label} screens`}>
      {railScreens(section).map((d) => {
        const n = badges[d.id];
        return (
          <button
            key={d.id}
            className={`nav-tab${lit === d.id ? ' is-active' : ''}`}
            style={{ ['--tab-hue' as string]: d.hue }}
            aria-current={lit === d.id ? 'page' : undefined}
            onClick={() => onGo(d.id)}
            title={d.blurb}
          >
            <span className="nav-tab-glyph" aria-hidden="true">{d.glyph}</span>
            <span className="nav-tab-label">{d.label}</span>
            {n ? <span className="nav-badge" aria-label={`${n} waiting`}>{n}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
