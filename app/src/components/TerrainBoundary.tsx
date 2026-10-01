import { Component, type ReactNode } from 'react';

/**
 * Catches whatever the 3D terrain throws — a WebGL context that probed fine but will not create, a failed
 * lazy chunk after a deploy, a shader error — so that it costs the terrain and not the screen. React unmounts the
 * whole tree on an uncaught render error, which is what "the 3D button crashes the page" looks like.
 */
export class TerrainBoundary extends Component<
  { onError: (message: string) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('3D terrain failed:', error);
    this.props.onError(error.message || String(error));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
