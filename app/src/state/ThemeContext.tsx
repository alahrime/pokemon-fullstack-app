import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeId = 'hud' | 'modernist';
export type MotionPref = 'on' | 'off';

export const THEMES: { id: ThemeId; label: string; blurb: string }[] = [
  { id: 'hud', label: 'HUD', blurb: 'Dark tactical readout' },
  { id: 'modernist', label: 'Swiss', blurb: 'Light editorial' },
];

const THEME_KEY = 'paragon.theme';
const MOTION_KEY = 'paragon.motion';

/** Read the persisted choice, falling back to the OS preference. */
function initialTheme(): ThemeId {
  if (typeof window === 'undefined') return 'hud';
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'hud' || saved === 'modernist') return saved;
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
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'hud' ? 'modernist' : 'hud')), []);
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
