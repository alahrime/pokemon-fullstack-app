import type { ReactNode } from 'react';

/**
 * HUD chrome primitives.
 *
 * These stay mounted in every theme — the modernist theme sets
 * --chrome-opacity to 0, so they fade out rather than unmounting. That keeps
 * layout identical across a theme swap and avoids a reflow mid-transition.
 */

/** Fixed background layers: survey grid, scanline wash, slow sweep bar. */
export function HudGround() {
  return (
    <>
      <div className="hud-ground" aria-hidden />
      <div className="hud-scanlines" aria-hidden />
      <div className="hud-sweep" aria-hidden />
    </>
  );
}

/* The bracket-cornered container had a wrapper component here; every caller
   but the report's rank panel wrote `className="panel hud-frame"` directly,
   and that panel is gone. The CSS class is the primitive now. */

/** Small-caps telemetry header with a trailing rule and optional live dot. */
export function HudLabel({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div className="hud-label">
      {live ? <span className="hud-live" aria-hidden /> : null}
      <span>{children}</span>
    </div>
  );
}
