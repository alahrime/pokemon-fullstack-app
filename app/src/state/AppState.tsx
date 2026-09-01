import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { IV, LeagueId } from '../lib/types';
import { opponentsFor, randomMatchup } from '../lib/data';
import { defaultSpreadFor } from '../lib/engine';

export type Screen = 'landing' | 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores' | 'diagnostics' | 'moves' | 'formats' | 'account';
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
  /**
   * Selected charged moves per battle side; empty means the league's rated
   * set. Named the same way as the report's `chargeIds` — this used to be
   * `disabledChargesA/B`, which could only ever switch the two rated moves
   * off and gave no way to field a third.
   */
  chargeIdsA: string[];
  chargeIdsB: string[];
  shieldsA: number;
  shieldsB: number;
  energyA: number;
  energyB: number;
}

// Rolled once per page load, so the battle screen opens somewhere different
// each visit instead of always on the same saved-looking pair.
const [openingA, openingB] = randomMatchup('great');
/**
 * The opening spreads, from the same rule a species change applies.
 *
 * A flat 10/10/10 was the old seed: a rank-2918 roll nobody fields, sitting
 * 27 CP under the cap, quietly deciding every breakpoint on the screen until
 * someone noticed and fixed it by hand.
 */
const openingIvA = defaultSpreadFor(openingA, 'great');
const openingIvB = defaultSpreadFor(openingB, 'great');

/** The state a fresh session starts in. Exported so tests can assert the
 *  defaults themselves rather than inferring them from rendered text. */
export const INITIAL_STATE: AppStateShape = {
  // The search is the first step of every task here, so the page whose whole
  // job is the search is where you start. Choosing a species moves you on.
  screen: 'landing',
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
  battleA: openingA,
  battleB: openingB,
  // Not 15/15/15. A perfect roll is the *worst* common case in a capped
  // league — attack costs level under the cap, so Registeel at 15/15/15 is
  // rank 3656 of 4096 in Great — and opening the battle screen on it argues
  // the opposite of what the rest of the app demonstrates. 10/10/10 is the
  // floor the game guarantees on a raid, research or trade catch, so it is a
  // roll people actually hold, and it is rank 1 in no league, which leaves the
  // rank-1 button something to do. The report screen already defaults to a
  // deliberately imperfect spread; this brings the battle screen in line.
  ivA: { a: openingIvA.a, d: openingIvA.d, s: openingIvA.s },
  ivB: { a: openingIvB.a, d: openingIvB.d, s: openingIvB.s },
  fastA: 0,
  fastB: 0,
  bestBuddyA: false,
  bestBuddyB: false,
  chargeIdsA: [],
  chargeIdsB: [],
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
  const [state, setState] = useState<AppStateShape>(INITIAL_STATE);

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
