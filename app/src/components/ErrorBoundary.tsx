import { Component, type ReactNode } from 'react';

/**
 * Catches a render error below it and shows `fallback` instead of letting React unmount the whole app (which left a
 * blank page with no top bar and no way back but a reload). Used twice in `App.tsx`: around each screen, keyed on
 * the screen, so a crash is contained to that screen and clears when you go somewhere else; and around the shell,
 * as the last resort.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: Error, reset: () => void) => ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Caught by ErrorBoundary:', error);
  }
  reset = () => this.setState({ error: null });
  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
