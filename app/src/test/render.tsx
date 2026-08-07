import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppStateProvider } from '../state/AppState';
import { ThemeProvider } from '../state/ThemeContext';

/**
 * Render inside the providers every screen assumes.
 *
 * Screens read league and species from AppState and colours from ThemeProvider;
 * rendering one bare throws on the missing context, which is a failure about
 * the harness rather than the component.
 */
export function renderApp(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <AppStateProvider>{ui}</AppStateProvider>
    </ThemeProvider>,
  );
}
