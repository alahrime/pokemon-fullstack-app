import { AppStateProvider, useAppState, type Screen } from './state/AppState';
import { SegButton, SegGroup } from './components/Seg';
import { LEAGUES, opponentsFor } from './lib/data';
import { DetailScreen } from './screens/DetailScreen';
import { OverlayScreen } from './screens/OverlayScreen';
import { IOSScreen } from './screens/IOSScreen';
import { ExplorerScreen } from './screens/ExplorerScreen';
import { CollectionScreen } from './screens/CollectionScreen';
import { CompareScreen } from './screens/CompareScreen';

const SCREENS: [Screen, string][] = [
  ['overlay', 'Android overlay'],
  ['ios', 'iOS capture'],
  ['detail', 'Report'],
  ['explorer', '4096 explorer'],
  ['collection', 'Collection'],
  ['compare', 'Compare'],
];

function Nav() {
  const { state, set, patch } = useAppState();
  return (
    <div
      className="nav"
      style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--color-bg)', flexWrap: 'wrap', rowGap: 8 }}
    >
      <span className="nav-brand" style={{ letterSpacing: '-0.03em' }}>
        PARAGON<span style={{ color: 'var(--color-accent)' }}>/</span>IV
      </span>
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
      <SegGroup>
        {(['beginner', 'expert'] as const).map((id) => (
          <SegButton key={id} active={state.mode === id} onClick={() => set('mode', id)}>
            {id === 'beginner' ? 'Beginner' : 'Expert'}
          </SegButton>
        ))}
      </SegGroup>
    </div>
  );
}

function Screens() {
  const { state } = useAppState();
  switch (state.screen) {
    case 'overlay':
      return <OverlayScreen />;
    case 'ios':
      return <IOSScreen />;
    case 'detail':
      return <DetailScreen />;
    case 'explorer':
      return <ExplorerScreen />;
    case 'collection':
      return <CollectionScreen />;
    case 'compare':
      return <CompareScreen />;
  }
}

function Shell() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)' }}>
      <Nav />
      <div style={{ padding: '24px 24px 64px', maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <Screens />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
