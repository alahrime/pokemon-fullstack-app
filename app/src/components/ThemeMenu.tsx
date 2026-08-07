import { useEffect, useId, useRef, useState } from 'react';
import { THEMES, useTheme } from '../state/ThemeContext';
import { MotionToggle } from './ThemeSwitch';

/**
 * The theme picker, as an overlay rather than a row.
 *
 * Eleven themes will not fit in the nav as a segmented control, and growing
 * that control inline would push the whole header down every time it opened.
 * So it overlays: the trigger's own size is a function of nothing, and the
 * panel's height is a function of how many themes exist rather than of the
 * layout around it.
 *
 * Each swatch carries `data-theme`, which means it renders in that theme's own
 * tokens — the preview IS the palette, not a second copy of it that can drift.
 */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // Deferred, so the click that opened this does not immediately close it.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const active = THEMES.find((t) => t.id === theme);

  return (
    <div className="theme-menu" ref={box}>
      <button
        type="button"
        className={`btn theme-menu-btn${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Theme — ${active?.label ?? theme}`}
        title={`Theme — ${active?.label ?? theme}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="theme-menu-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="theme-menu-current" aria-hidden="true" data-theme={theme} />
      </button>

      {open && (
        <div className="theme-menu-panel" id={panelId} role="dialog" aria-label="Choose a theme">
          <div className="hud-label theme-menu-head">Theme</div>
          <div className="theme-swatches">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-swatch${t.id === theme ? ' is-active' : ''}`}
                aria-pressed={t.id === theme}
                aria-label={`${t.label} — ${t.blurb}`}
                title={`${t.label} — ${t.blurb}`}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
              >
                {/* Drawn from the theme's own tokens: ground, accent, signal. */}
                <span className="theme-swatch-face" data-theme={t.id} aria-hidden="true">
                  <span className="theme-swatch-accent" />
                  <span className="theme-swatch-signal" />
                </span>
                <span className="theme-swatch-name">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="theme-menu-foot">
            <MotionToggle className="theme-menu-motion" />
          </div>
        </div>
      )}
    </div>
  );
}
