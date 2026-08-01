import { AppStateProvider, useAppState, type Screen } from './state/AppState';
import { ThemeProvider } from './state/ThemeContext';
import { SegButton, SegGroup } from './components/Seg';
import { SpeciesSearch } from './components/SpeciesSearch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { HudGround } from './components/Hud';
import { SiteFooter } from './components/SiteFooter';
import { LeagueTabs } from './components/LeagueTabs';
import { opponentsFor } from './lib/data';
import { ReportScreen } from './screens/ReportScreen';
import { BattleScreen } from './screens/BattleScreen';
import { RankingsScreen } from './screens/RankingsScreen';
import { TeamBuilderScreen } from './screens/TeamBuilderScreen';
import { CoresScreen } from './screens/CoresScreen';
import { SpriteAudit } from './screens/SpriteAudit';

const SCREENS: [Screen, string][] = [
  ['report', 'Report'],
  ['battle', 'Battle'],
  ['rankings', 'Rankings'],
  ['gbl', 'GBL Teams'],
  ['show6', 'Show 6'],
  ['cores', 'Cores'],
];

function Nav() {
  const { state, set, patch } = useAppState();
  return (
    <div className="nav" style={{ position: 'sticky', top: 0, zIndex: 20, flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
      <span className="nav-brand">
        PARAGON<span style={{ color: 'var(--color-accent)' }}>/</span>IV
      </span>
      {/* The primary control on the page, and it was a 220px box adrift in
          empty header. Given room to grow it fills the gap between the brand
          and the screen tabs, so the thing you reach for first looks like it. */}
      <SpeciesSearch
        id="nav-species"
        value={state.species}
        onChange={(id) =>
          // chargeIds must clear with the species. Held across a change they
          // name moves the new species does not learn, and the moves panel —
          // which shows only the selected moves once a pool needs a picker —
          // then matches nothing and renders empty. Switching from Azumarill
          // to Mew was showing no charged moves at all.
          patch({ species: id, moveIdx: 0, chargeIds: [] })
        }
        placeholder="Name, type, gen1, @counter, water&!legendary…"
        className="nav-search"
      />
      <SegGroup>
        {SCREENS.map(([id, label]) => (
          <SegButton key={id} active={state.screen === id} onClick={() => set('screen', id)}>
            {label}
          </SegButton>
        ))}
      </SegGroup>
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
    case 'report':
      return <ReportScreen key="report" />;
    case 'battle':
      return <BattleScreen key="battle" />;
    case 'rankings':
      return <RankingsScreen key="rankings" />;
    case 'gbl':
      return <TeamBuilderScreen key="gbl" size={3} />;
    case 'show6':
      return <TeamBuilderScreen key="show6" size={6} />;
    case 'cores':
      return <CoresScreen key="cores" />;
  }
}

function Shell() {
  const { state } = useAppState();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)' }}>
      <HudGround />
      <div className="hud-content" style={{ display: 'contents' }}>
        <Nav />
        <div
          key={state.screen}
          className="screen-enter"
          style={{ padding: '24px 24px 64px', maxWidth: 'var(--shell-max)', width: '100%', margin: '0 auto', position: 'relative', zIndex: 2 }}
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
