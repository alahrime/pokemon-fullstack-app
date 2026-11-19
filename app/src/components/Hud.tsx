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

/**
 * What a lazy screen shows while its chunk downloads and its data parses. Big
 * chunks (rankings, teams) are multi-megabyte JSON, so this can be up for a
 * second or more on a slow link. Callers size it via `className`; it fills
 * that box. The animation only runs while it is mounted, and the global
 * reduced-motion rule in tokens.css stops it.
 */
export function LoadingPanel({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`panel hud-frame loading-panel ${className}`} role="status" aria-live="polite">
      <div className="loading-reticle" aria-hidden>
        <span className="loading-ring" />
        <span className="loading-core" />
      </div>
      <div className="loading-bar" aria-hidden><span /></div>
      <div className="hud-label loading-label"><span>{label}</span></div>
    </div>
  );
}
