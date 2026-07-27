import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { IV, LeagueId } from '../lib/types';
import { opponentsFor } from '../lib/data';

export type Screen = 'overlay' | 'ios' | 'detail' | 'explorer' | 'collection' | 'compare';
export type Mode = 'beginner' | 'expert';
export type Viz = 'heat' | 'ruler' | 'table' | 'flip';
export type ColorBy = 'rank' | 'break' | 'bulk';
export type OverlayState = 'collapsed' | 'scan' | 'result';
export type IOSFlow = 'share' | 'library' | 'auto';
export type SortKey = 'rank' | 'cp' | 'name' | 'new';

export interface AppStateShape {
  screen: Screen;
  league: LeagueId;
  mode: Mode;
  species: string;
  iv: IV;
  viz: Viz;
  colorBy: ColorBy;
  oppId: string;
  moveIdx: number;
  overlay: OverlayState;
  iosFlow: IOSFlow;
  query: string;
  sort: SortKey;
  shields: number;
  cmpA: string;
  cmpB: string;
}

const initialState: AppStateShape = {
  screen: 'detail',
  league: 'great',
  mode: 'expert',
  species: 'azumarill',
  iv: { a: 0, d: 14, s: 15 },
  viz: 'heat',
  colorBy: 'rank',
  oppId: opponentsFor('great')[0]?.id ?? '',
  moveIdx: 0,
  overlay: 'collapsed',
  iosFlow: 'share',
  query: '',
  sort: 'rank',
  shields: 1,
  cmpA: 'c1',
  cmpB: 'c2',
};

interface AppStateContextValue {
  state: AppStateShape;
  set: <K extends keyof AppStateShape>(key: K, value: AppStateShape[K]) => void;
  patch: (partial: Partial<AppStateShape>) => void;
  bumpIv: (key: keyof IV, delta: number) => void;
  beginner: boolean;
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
    return { state, set, patch, bumpIv, beginner: state.mode === 'beginner' };
  }, [state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
