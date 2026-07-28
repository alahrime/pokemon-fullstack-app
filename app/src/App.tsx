import { AppStateProvider, useAppState, type Screen } from './state/AppState';
import { ThemeProvider } from './state/ThemeContext';
import { SegButton, SegGroup } from './components/Seg';
import { SpeciesSearch } from './components/SpeciesSearch';
import { ThemeSwitch } from './components/ThemeSwitch';
import { HudGround } from './components/Hud';
import { LEAGUES, opponentsFor } from './lib/data';
import { ReportScreen } from './screens/ReportScreen';
import { BattleScreen } from './screens/BattleScreen';

const SCREENS: [Screen, string][] = [
  ['report', 'Report'],
  ['battle', 'Battle'],
];

function Nav() {
  const { state, set, patch } = useAppState();
  return (
    <div className="nav" style={{ position: 'sticky', top: 0, zIndex: 20, flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
      <span className="nav-brand">
        PARAGON<span style={{ color: 'var(--color-accent)' }}>/</span>IV
      </span>
      <SpeciesSearch
        id="nav-species"
        value={state.species}
        onChange={(id) => patch({ species: id, moveIdx: 0 })}
        placeholder="Search species…"
        style={{ width: 200 }}
      />
      <SegGroup>
        {SCREENS.map(([id, label]) => (
          <SegButton key={id} active={state.screen === id} onClick={() => set('screen', id)}>
            {label}
          </SegButton>
        ))}
      </SegGroup>
      <SegGroup>
        {LEAGUES.map((lg) => (
          <SegButton
            key={lg.id}
            active={state.league === lg.id}
            onClick={() => patch({ league: lg.id, oppId: opponentsFor(lg.id)[0]?.id ?? '' })}
          >
            {lg.label}
          </SegButton>
        ))}
      </SegGroup>
      <ThemeSwitch />
    </div>
  );
}

function Screens() {
  const { state } = useAppState();
  // Keyed on the screen id so React remounts the subtree and the enter
  // animation replays on every switch.
  switch (state.screen) {
    case 'report':
      return <ReportScreen key="report" />;
    case 'battle':
      return <BattleScreen key="battle" />;
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
