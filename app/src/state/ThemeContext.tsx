import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeId = 'hud' | 'modernist' | 'midnight' | 'paper' | 'contrast';
export type MotionPref = 'on' | 'off';

/**
 * The ids are historical and deliberately unchanged.
 *
 * `hud` and `modernist` name a look; the labels now name what people actually
 * pick by, which is dark or light. Renaming the ids would break every
 * `[data-theme='hud']` selector across four stylesheets and silently reset the
 * saved preference of anyone who already has one, for a cosmetic gain.
 */
export const THEMES: { id: ThemeId; label: string; blurb: string; scheme: 'dark' | 'light' }[] = [
  { id: 'hud', label: 'Dark', blurb: 'Tactical readout — the original', scheme: 'dark' },
  { id: 'midnight', label: 'Midnight', blurb: 'Deep indigo, softer contrast', scheme: 'dark' },
  { id: 'modernist', label: 'Light', blurb: 'Swiss editorial', scheme: 'light' },
  { id: 'paper', label: 'Paper', blurb: 'Warm ivory, low glare', scheme: 'light' },
  { id: 'contrast', label: 'Contrast', blurb: 'Maximum separation, no chrome', scheme: 'dark' },
];

const THEME_IDS = THEMES.map((t) => t.id);

const THEME_KEY = 'paragon.theme';
const MOTION_KEY = 'paragon.motion';

/** Read the persisted choice, falling back to the OS preference. */
function initialTheme(): ThemeId {
  if (typeof window === 'undefined') return 'hud';
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved && (THEME_IDS as string[]).includes(saved)) return saved as ThemeId;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'modernist' : 'hud';
}

function initialMotion(): MotionPref {
  if (typeof window === 'undefined') return 'on';
  const saved = window.localStorage.getItem(MOTION_KEY);
  if (saved === 'on' || saved === 'off') return saved;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'off' : 'on';
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  toggleTheme: () => void;
  motion: MotionPref;
  setMotion: (m: MotionPref) => void;
  toggleMotion: () => void;
  /** True when animation should be suppressed — drives JS-side effects that
   *  CSS alone can't reach (e.g. the R3F camera auto-orbit). */
  reduced: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme);
  const [motion, setMotionState] = useState<MotionPref>(initialMotion);

  // Both preferences live as attributes on <html> so CSS can key off them
  // without any component knowing the current theme.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-motion', motion);
    window.localStorage.setItem(MOTION_KEY, motion);
  }, [motion]);

  const setTheme = useCallback((t: ThemeId) => setThemeState(t), []);
  const setMotion = useCallback((m: MotionPref) => setMotionState(m), []);
  // Cycles through the list rather than flipping a pair, now that there are
  // more than two. The keyboard shortcut and any caller that just wants "the
  // next one" keeps working without knowing how many exist.
  const toggleTheme = useCallback(
    () => setThemeState((t) => THEME_IDS[(THEME_IDS.indexOf(t) + 1) % THEME_IDS.length]),
    [],
  );
  const toggleMotion = useCallback(() => setMotionState((m) => (m === 'on' ? 'off' : 'on')), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme, motion, setMotion, toggleMotion, reduced: motion === 'off' }),
    [theme, setTheme, toggleTheme, motion, setMotion, toggleMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
