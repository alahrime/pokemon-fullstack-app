import { lazy, Suspense } from 'react';
import { AppStateProvider, useAppState } from './state/AppState';
import { SCREEN_DEFS } from './lib/screens';
import { ThemeProvider } from './state/ThemeContext';
import { SpeciesSearch } from './components/SpeciesSearch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { HudGround } from './components/Hud';
import { SiteFooter } from './components/SiteFooter';
import { LeagueTabs } from './components/LeagueTabs';
import { opponentsFor } from './lib/data';
import { LandingScreen } from './screens/LandingScreen';
import { ReportScreen } from './screens/ReportScreen';
import { BattleScreen } from './screens/BattleScreen';
import { SpriteAudit } from './screens/SpriteAudit';

/**
 * The three screens that read `rankings.json` (3.1MB) or `teams.json` (3.8MB)
 * are loaded on demand; the rest are not.
 *
 * The split is drawn around the artefacts, not around component size. Landing,
 * Report and Battle all run off `species.json`, which every screen needs and
 * which therefore has to be in the entry chunk anyway — making those lazy would
 * buy a few kB of app code and cost a spinner. These three are where the
 * megabytes are, and none of them is the first thing anyone sees.
 */
const RankingsScreen = lazy(() => import('./screens/RankingsScreen').then((m) => ({ default: m.RankingsScreen })));
const TeamBuilderScreen = lazy(() => import('./screens/TeamBuilderScreen').then((m) => ({ default: m.TeamBuilderScreen })));
const CoresScreen = lazy(() => import('./screens/CoresScreen').then((m) => ({ default: m.CoresScreen })));
const DiagnosticsScreen = lazy(() => import('./screens/DiagnosticsScreen').then((m) => ({ default: m.DiagnosticsScreen })));

function Nav() {
  const { state, set, patch } = useAppState();
  // On the landing page the search is the page — a second copy in the header
  // would be two inputs for one job, and the smaller one would win by being
  // nearer the mouse. The brand takes the space back instead.
  const onLanding = state.screen === 'landing';
  return (
    <div className="nav sticky top-0 z-20 flex-wrap">
      <button
        className="nav-brand"
        onClick={() => set('screen', 'landing')}
        title="Back to the start"
      >
        PARAGON<span className="text-(--color-accent)">/</span>IV
      </button>
      {!onLanding && (
        <SpeciesSearch
          id="nav-species"
          value={state.species}
          onChange={(id) =>
            // Go to the Report, because the Report is the only screen that
            // shows the species this picks. Rankings, Cores and the two team
            // builders never read `state.species`, so choosing from here used
            // to commit the selection and change nothing visible — the control
            // looked broken on four of the six screens when it was in fact
            // working perfectly and reporting to an empty room.
            //
            // chargeIds must clear with the species. Held across a change they
            // name moves the new species does not learn, and the moves panel —
            // which shows only the selected moves once a pool needs a picker —
            // then matches nothing and renders empty. Switching from Azumarill
            // to Mew was showing no charged moves at all.
            patch({ species: id, moveIdx: 0, chargeIds: [], screen: 'report' })
          }
          placeholder="Name, type, gen1, @counter, water&!legendary…"
          className="nav-search"
        />
      )}
      {/* Not SegGroup any more: these are the app's primary destinations, and
          rendering them as the same control used for a sort order made them
          read as a minor setting. Each carries its own hue and glyph, matching
          the landing page's card for the same screen. */}
      <nav className="nav-tabs" aria-label="Sections">
        {SCREEN_DEFS.map((d) => (
          <button
            key={d.id}
            className={`nav-tab${state.screen === d.id ? ' is-active' : ''}`}
            style={{ ['--tab-hue' as string]: d.hue }}
            aria-current={state.screen === d.id ? 'page' : undefined}
            onClick={() => set('screen', d.id)}
            title={d.blurb}
          >
            <span className="nav-tab-glyph" aria-hidden="true">{d.glyph}</span>
            <span className="nav-tab-label">{d.label}</span>
          </button>
        ))}
      </nav>
      <LeagueTabs
        value={state.league}
        onChange={(id) => patch({ league: id, oppId: opponentsFor(id)[0]?.id ?? '' })}
      />
      <ThemeSwitch />
    </div>
  );
}

/** Diagnostics reachable by query string, kept out of the nav. */
const AUDIT = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('audit');

function Screens() {
  const { state } = useAppState();
  if (AUDIT === 'sprites') return <SpriteAudit />;
  // Keyed on the screen id so React remounts the subtree and the enter
  // animation replays on every switch.
  switch (state.screen) {
    case 'landing':
      return <LandingScreen key="landing" />;
    case 'report':
      return <ReportScreen key="report" />;
    case 'battle':
      return <BattleScreen key="battle" />;
    case 'rankings':
      return <LazyScreen key="rankings"><RankingsScreen /></LazyScreen>;
    case 'gbl':
      return <LazyScreen key="gbl"><TeamBuilderScreen size={3} /></LazyScreen>;
    case 'show6':
      return <LazyScreen key="show6"><TeamBuilderScreen size={6} /></LazyScreen>;
    case 'cores':
      return <LazyScreen key="cores"><CoresScreen /></LazyScreen>;
    case 'diagnostics':
      return <LazyScreen key="diagnostics"><DiagnosticsScreen /></LazyScreen>;
  }
}

/**
 * Holds the shell steady while a screen's chunk arrives.
 *
 * Sized rather than empty on purpose: these screens sit inside the shell's
 * animated container, and an unsized fallback collapses the page to the nav for
 * a frame before it snaps back to full height.
 */
function LazyScreen({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="panel hud-frame text-muted lazy-fallback">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function Shell() {
  const { state } = useAppState();
  // The landing page runs its own full-bleed layout, so the shell's reading
  // measure and padding would fight it.
  const wide = state.screen === 'landing';
  return (
    <div className="flex min-h-screen flex-col font-(family-name:--font-body)">
      <HudGround />
      <div className="hud-content contents">
        <Nav />
        <div
          key={state.screen}
          className={`screen-enter relative z-[2] mx-auto w-full ${wide ? 'max-w-none p-0' : 'max-w-(--shell-max) px-6 pt-6 pb-16'}`}
        >
          <Screens />
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
    </ThemeProvider>
  );
}
