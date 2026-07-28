import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { IV, LeagueId } from '../lib/types';
import { opponentsFor } from '../lib/data';

export type Screen = 'report' | 'battle';
export type Viz = 'heat' | 'ruler' | 'table' | 'flip';
export type ColorBy = 'rank' | 'break' | 'bulk';

export interface AppStateShape {
  screen: Screen;
  league: LeagueId;
  species: string;
  iv: IV;
  viz: Viz;
  colorBy: ColorBy;
  oppId: string;
  moveIdx: number;
  shields: number;
  battleA: string;
  battleB: string;
  ivA: IV;
  ivB: IV;
  fastA: number;
  fastB: number;
  // Charge moves disabled by the user, by move id - defaults to none (both
  // available charge moves are used, letting the battle sim bait/nuke as
  // real play would).
  disabledChargesA: string[];
  disabledChargesB: string[];
  shieldsA: number;
  shieldsB: number;
  energyA: number;
  energyB: number;
}

const initialState: AppStateShape = {
  screen: 'report',
  league: 'great',
  species: 'azumarill',
  iv: { a: 0, d: 14, s: 15 },
  viz: 'heat',
  colorBy: 'rank',
  oppId: opponentsFor('great')[0]?.id ?? '',
  moveIdx: 0,
  shields: 1,
  battleA: 'azumarill',
  battleB: 'mimikyu',
  ivA: { a: 15, d: 15, s: 15 },
  ivB: { a: 15, d: 15, s: 15 },
  fastA: 0,
  fastB: 0,
  disabledChargesA: [],
  disabledChargesB: [],
  shieldsA: 1,
  shieldsB: 1,
  energyA: 0,
  energyB: 0,
};

interface AppStateContextValue {
  state: AppStateShape;
  set: <K extends keyof AppStateShape>(key: K, value: AppStateShape[K]) => void;
  patch: (partial: Partial<AppStateShape>) => void;
  bumpIv: (key: keyof IV, delta: number) => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppStateShape>(initialState);

  const value = useMemo<AppStateContextValue>(() => {
    const set = <K extends keyof AppStateShape>(key: K, v: AppStateShape[K]) =>
      setState((s) => ({ ...s, [key]: v }));
    const patch = (partial: Partial<AppStateShape>) => setState((s) => ({ ...s, ...partial }));
    const bumpIv = (key: keyof IV, delta: number) =>
      setState((s) => ({ ...s, iv: { ...s.iv, [key]: Math.max(0, Math.min(15, s.iv[key] + delta)) } }));
    return { state, set, patch, bumpIv };
  }, [state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
