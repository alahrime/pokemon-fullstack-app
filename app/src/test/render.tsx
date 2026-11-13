import { render } from '@testing-library/react';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { AppStateProvider, useAppState } from '../state/AppState';
import { ThemeProvider } from '../state/ThemeContext';
import { SessionProvider } from '../state/SessionContext';
import { ChannelListProvider } from '../state/ChannelListContext';
import { NotificationsProvider } from '../state/NotificationsContext';
import { ChatDockRequestProvider } from '../state/ChatDockContext';

/**
 * Render inside the providers every screen assumes.
 *
 * Screens read league and species from AppState, colours from ThemeProvider,
 * signed-in user from SessionProvider, and — since `MatchScreen`'s "Open
 * match chat" button lost its old `set('screen', 'chat')` navigation to the
 * dock replacing the `chat` destination — the one-shot bridge to `ChatDock`
 * from `ChatDockContext`; rendering any of these bare throws on the missing
 * context, which is a failure about the harness rather than the component.
 * Nesting matches App.tsx's own order (Theme, Session, ChannelList, AppState,
 * ChatDockRequest); `ChannelListProvider` is the one shared, polled channel
 * list, and reads the session.
 *
 * `setup.ts` mocks `@supabase/supabase-js` for the whole suite, so this
 * SessionProvider talks to the stub client and settles signed-out — a screen
 * test that needs a signed-in session builds its own harness instead (see
 * `team-saves.test.tsx`), the same way sign-in.test.tsx already does.
 */
export function renderApp(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <ChannelListProvider>
          <NotificationsProvider>
            <AppStateProvider>
              <ChatDockRequestProvider>{ui}</ChatDockRequestProvider>
            </AppStateProvider>
          </NotificationsProvider>
        </ChannelListProvider>
      </SessionProvider>
    </ThemeProvider>,
  );
}

/**
 * Open the Report screen on its Analysis page — the loadout, opponents and
 * visualisations live there, the roll's readout on the Report page.
 */
export function OnAnalysis({ children }: { children: ReactNode }) {
  const { set } = useAppState();
  useEffect(() => { set('reportPage', 'analysis'); }, []);
  return <>{children}</>;
}
