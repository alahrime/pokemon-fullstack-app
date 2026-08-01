import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { IV, LeagueId } from '../lib/types';
import { opponentsFor } from '../lib/data';

export type Screen = 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores';
export type Viz = 'heat' | 'ruler' | 'table' | 'flip';
export type ColorBy = 'rank' | 'break' | 'bulk';

export interface AppStateShape {
  screen: Screen;
  league: LeagueId;
  /** Ref, may carry a `_shadow` suffix. */
  species: string;
  shadow: boolean;
  /**
   * Include Best Buddy levels (50.5 / 51) when building spread tables.
   *
   * Applies to both sides: a Best Buddy opponent is a real opponent. Species
   * that cannot reach past 50 under the cap ignore it rather than being
   * excluded, so the toggle is safe to leave on.
   */
  bestBuddy: boolean;
  /**
   * Hold charged moves for the turn the opponent's fast move registers.
   *
   * Off by default because PvPoke throws the moment a move is available, and
   * that is what every published rating is measured against. On, the sim plays
   * the alignment instead — better play, not comparable numbers.
   */
  optimizeTiming: boolean;
  /** Chosen charged moves; empty means PvPoke's recommended pair. */
  chargeIds: string[];
  iv: IV;
  viz: Viz;
  colorBy: ColorBy;
  oppId: string;
  moveIdx: number;
  /** Report screen shield scenario; the two sides are independent. */
  shields: number;
  shieldsOpp: number;
  battleA: string;
  battleB: string;
  ivA: IV;
  ivB: IV;
  fastA: number;
  fastB: number;
  // Charge moves disabled by the user, by move id - defaults to none (both
  // available charge moves are used, letting the battle sim bait/nuke as
  // real play would).
  /**
   * Best Buddy per combatant, not shared. On a head-to-head each Pokemon is
   * independently someone's buddy or not, so one flag could not express the
   * common case of a boosted mon against an unboosted one. Distinct from the
   * report screen's single `bestBuddy`, which describes only your own roll —
   * there the opponents are always priced at their own ceiling.
   */
  bestBuddyA: boolean;
  bestBuddyB: boolean;
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
  shadow: false,
  bestBuddy: false,
  optimizeTiming: false,
  chargeIds: [],
  iv: { a: 0, d: 14, s: 15 },
  viz: 'heat',
  colorBy: 'rank',
  oppId: opponentsFor('great')[0]?.id ?? '',
  moveIdx: 0,
  shields: 1,
  shieldsOpp: 1,
  battleA: 'azumarill',
  // Not Mimikyu: it is held out of the simulator (UNSIMULATED_IDS).
  battleB: 'lickilicky',
  ivA: { a: 15, d: 15, s: 15 },
  ivB: { a: 15, d: 15, s: 15 },
  fastA: 0,
  fastB: 0,
  bestBuddyA: false,
  bestBuddyB: false,
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
