import type { CSSProperties, ReactNode } from 'react';

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

/** Bracket-cornered container. `signal` switches the brackets to cyan. */
export function HudFrame({
  children,
  signal = false,
  className = '',
  style,
}: {
  children: ReactNode;
  signal?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`hud-frame ${signal ? 'is-signal' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Small-caps telemetry header with a trailing rule and optional live dot. */
export function HudLabel({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div className="hud-label">
      {live ? <span className="hud-live" aria-hidden /> : null}
      <span>{children}</span>
    </div>
  );
}

/** Large tabular numeral with a theme-aware bloom. */
export function HudReadout({
  value,
  size = 52,
  style,
}: {
  value: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span className="hud-readout" style={{ fontSize: size, ...style }}>
      {value}
    </span>
  );
}
