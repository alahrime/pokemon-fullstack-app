import { lazy, Suspense } from 'react';
import { AppStateProvider, useAppState } from './state/AppState';
import { SCREEN_DEFS } from './lib/screens';
import { ThemeProvider } from './state/ThemeContext';
import { SessionProvider } from './state/SessionContext';
import { ThemeMenu } from './components/ThemeMenu';
import { HudGround } from './components/Hud';
import { SiteFooter } from './components/SiteFooter';
import { LeagueTabs } from './components/LeagueTabs';
import { opponentsFor, randomMatchup } from './lib/data';
import { defaultSpreadFor } from './lib/engine';
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
const MovesScreen = lazy(() => import('./screens/MovesScreen').then((m) => ({ default: m.MovesScreen })));
const FormatBuilderScreen = lazy(() =>
  import('./screens/FormatBuilderScreen').then((m) => ({ default: m.FormatBuilderScreen })),
);
// Lazy for a different reason than the others: not megabytes of data, just a
// screen most visits never open. It does NOT keep @supabase/supabase-js out of
// the entry chunk — SessionProvider is mounted at the root below, so the client
// is in the entry chunk either way. Only this screen's own code is deferred.
const SignInScreen = lazy(() => import('./screens/SignInScreen').then((m) => ({ default: m.SignInScreen })));

function Nav() {
  const { state, set, patch } = useAppState();
  return (
    <div className="nav sticky top-0 z-20 flex-wrap">
      <button
        className="nav-brand"
        onClick={() => set('screen', 'landing')}
        title="Back to the start"
      >
        PARAGON<span className="text-(--color-accent)">/</span>IV
      </button>
      {/* Not SegGroup any more: these are the app's primary destinations, and
          rendering them as the same control used for a sort order made them
          read as a minor setting. Each carries its own hue and glyph, matching
          the landing page's card for the same screen. */}
      <nav className="flex items-stretch gap-1 flex-wrap" aria-label="Sections">
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
      {/* League and theme travel together on the right. Left loose in the
          wrapping nav, the theme trigger was small enough to be the only item
          pushed onto a second row, where its panel then opened off-screen. */}
      <div className="nav-right">
        <LeagueTabs
          value={state.league}
          onChange={(id) => {
            // The battle pair is drawn from the league's own pool, so it is
            // re-rolled here — a Great-league matchup left on the Master
            // screen is priced at a cap it never plays under.
            const [a, b] = randomMatchup(id);
            const spreadA = defaultSpreadFor(a, id);
            const spreadB = defaultSpreadFor(b, id);
            patch({
              league: id,
              oppId: opponentsFor(id)[0]?.id ?? '',
              battleA: a,
              battleB: b,
              fastA: 0,
              fastB: 0,
              chargeIdsA: [],
              chargeIdsB: [],
              // The roll is priced against the cap, so it is re-taken with the
              // league as well as with the species — a Great roll under Master
              // is a spread nobody would field there.
              ivA: { a: spreadA.a, d: spreadA.d, s: spreadA.s },
              ivB: { a: spreadB.a, d: spreadB.d, s: spreadB.s },
            });
          }}
        />
        <ThemeMenu />
      </div>
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
    case 'moves':
      return <LazyScreen key="moves"><MovesScreen /></LazyScreen>;
    case 'formats':
      return <LazyScreen key="formats"><FormatBuilderScreen /></LazyScreen>;
    case 'account':
      return <LazyScreen key="account"><SignInScreen /></LazyScreen>;
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
      <SessionProvider>
        <AppStateProvider>
          <Shell />
        </AppStateProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
