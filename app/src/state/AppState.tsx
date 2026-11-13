import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IV, LeagueId } from '../lib/types';
import { opponentsFor, randomMatchup, ratedFastIdx, SPECIES_BY_ID } from '../lib/data';
import { defaultSpreadFor, isMega, type BaitMode, type Stages } from '../lib/engine';
import type { Match } from '../lib/matches';
import { hashForView, isAuthCallback, playerIdFromHash, reportFromHash, reportQuery, screenFromHash, tournamentIdFromHash, type ReportView } from '../lib/route';

export type Screen = 'landing' | 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores' | 'diagnostics' | 'moves' | 'formats' | 'matchmaking' | 'match' | 'friends' | 'chat' | 'tournaments' | 'records' | 'player' | 'tracker' | 'account';
export type Viz = 'heat' | 'ruler' | 'table' | 'flip';
export type ColorBy = 'rank' | 'break' | 'bulk';

export interface AppStateShape {
  screen: Screen;
  league: LeagueId;
  /** A limited cup (a `PRESET_FORMATS` key) played on top of `league`'s cap, or null for the plain league. */
  cup: string | null;
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
  /** Report screen page: the roll's readout, or the matchup analysis. */
  reportPage: 'report' | 'analysis';
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
  /** Starting HP per battle side; null is full. Species-specific, so it resets with the species. */
  startHpA: number | null;
  startHpB: number | null;
  /** PvPoke's baitShields per battle side. */
  baitA: BaitMode;
  baitB: BaitMode;
  /** Starting attack/defence stages per battle side, PvPoke's stat modifiers. */
  stagesA: Stages;
  stagesB: Stages;
  /** The Battle screen's mode: one head-to-head, or a matrix of every Pokémon on one side against every one on the other. */
  battleMode: 'single' | 'matrix';
  /**
   * The match the `match` screen is open on. A whole `Match`, not just an
   * id, because whoever navigates here (a row on the Matchmaking screen)
   * already has the fetched object in hand — refetching by id would be a
   * round trip to recover data the caller is about to throw away.
   */
  activeMatch: Match | null;
  /** The tournament the Tournaments screen is open on; mirrored in the URL
   *  (`#/play/tournaments/<id>`), unlike `activeMatch`, so it can be linked. */
  activeTournamentId: string | null;
  /** The profile open on the `player` screen (`#/play/players/<id>`), linkable like a tournament. */
  activePlayerId: string | null;
  /** Around-your-roll filter: spreads at or above these stats, or null for every spread. Species-specific. */
  statFloor: { atk: number; def: number } | null;
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

/**
 * What changes when the league does: the battle pair is drawn from the league's own pool, so it is re-rolled — a
 * Great-league matchup left on the Master screen is priced at a cap it never plays under — and so is its spread,
 * which is priced against the cap. `cup` is the limited cup played under that league's cap, or null.
 */
export function leaguePatch(id: LeagueId, cup: string | null): Partial<AppStateShape> {
  const [a, b] = randomMatchup(id);
  const spreadA = defaultSpreadFor(a, id);
  const spreadB = defaultSpreadFor(b, id);
  return {
    league: id,
    cup,
    statFloor: null,
    oppId: opponentsFor(id)[0]?.id ?? '',
    battleA: a,
    battleB: b,
    fastA: ratedFastIdx(a, id),
    fastB: ratedFastIdx(b, id),
    chargeIdsA: [],
    chargeIdsB: [],
    ivA: { a: spreadA.a, d: spreadA.d, s: spreadA.s },
    ivB: { a: spreadB.a, d: spreadB.d, s: spreadB.s },
  };
}

/** The state a fresh session starts in. Exported so tests can assert the
 *  defaults themselves rather than inferring them from rendered text. */
export const INITIAL_STATE: AppStateShape = {
  // The search is the first step of every task here, so the page whose whole
  // job is the search is where you start. Choosing a species moves you on.
  screen: 'landing',
  league: 'great',
  cup: null,
  species: 'azumarill',
  shadow: false,
  bestBuddy: false,
  // PvPoke's engine optimises move timing by default (Pokemon.js), so do we.
  optimizeTiming: true,
  chargeIds: [],
  iv: { a: 0, d: 14, s: 15 },
  viz: 'heat',
  reportPage: 'report',
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
  fastA: ratedFastIdx(openingA, 'great'),
  fastB: ratedFastIdx(openingB, 'great'),
  bestBuddyA: false,
  bestBuddyB: false,
  chargeIdsA: [],
  chargeIdsB: [],
  shieldsA: 1,
  shieldsB: 1,
  energyA: 0,
  energyB: 0,
  startHpA: null,
  startHpB: null,
  baitA: 1,
  baitB: 1,
  stagesA: { atk: 0, def: 0 },
  stagesB: { atk: 0, def: 0 },
  battleMode: 'single',
  activeMatch: null,
  activeTournamentId: null,
  activePlayerId: null,
  statFloor: null,
};

/** A shared Analyze link's Pokémon, roll and league laid over `s`; `s` itself when it already says all that. */
function applyReport(s: AppStateShape, v: Partial<ReportView>): AppStateShape {
  let n = s;
  const cup = v.cup === undefined ? n.cup : v.cup;
  if ((v.league && v.league !== n.league) || cup !== n.cup) n = { ...n, ...leaguePatch(v.league ?? n.league, cup) };
  if (v.species && (v.species !== n.species || v.shadow !== n.shadow)) {
    const crossed = v.species !== n.species && (isMega(SPECIES_BY_ID.get(v.species)!) || isMega(SPECIES_BY_ID.get(n.species)!));
    n = { ...n, species: v.species, shadow: !!v.shadow, ...(v.species !== n.species ? { moveIdx: 0, chargeIds: [], statFloor: null } : {}), ...(crossed ? { bestBuddy: false } : {}) };
  }
  if (v.iv && (v.iv.a !== n.iv.a || v.iv.d !== n.iv.d || v.iv.s !== n.iv.s)) n = { ...n, iv: v.iv };
  if (v.statFloor !== undefined && (v.statFloor?.atk !== n.statFloor?.atk || v.statFloor?.def !== n.statFloor?.def)) {
    n = { ...n, statFloor: v.statFloor };
  }
  return n;
}

interface AppStateContextValue {
  state: AppStateShape;
  set: <K extends keyof AppStateShape>(key: K, value: AppStateShape[K]) => void;
  patch: (partial: Partial<AppStateShape>) => void;
  bumpIv: (key: keyof IV, delta: number) => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // INITIAL_STATE stays the exported default (tests assert it); only the
  // starting screen is taken from the address, so a shared link lands where
  // it points.
  const [state, setState] = useState<AppStateShape>(() => applyReport({
    ...INITIAL_STATE,
    // Analyze opens on a random Pokémon each visit (the battle screen's opening
    // left side), not the same fixed one; a species the user picks then stays.
    species: openingA,
    screen: typeof window === 'undefined' ? 'landing' : screenFromHash(window.location.hash),
    activeTournamentId: typeof window === 'undefined' ? null : tournamentIdFromHash(window.location.hash),
    activePlayerId: typeof window === 'undefined' ? null : playerIdFromHash(window.location.hash),
  }, typeof window === 'undefined' ? {} : reportFromHash(window.location.hash)));

  // State → URL. An empty hash is the landing page, so a fresh visit writes
  // nothing and adds no history entry.
  const wanted = useRef('#/');
  useEffect(() => {
    // The report carries its Pokémon and roll, so a link to it opens that analysis.
    const want = hashForView(state.screen, state.activeTournamentId, state.activePlayerId)
      + (state.screen === 'report' ? reportQuery(state) : '');
    wanted.current = want;
    const have = window.location.hash || '#/';
    if (have === want) return;
    // An auth callback is left for its readers, which clear it themselves;
    // replacing it here wiped a Discord error before the screen could show it.
    if (isAuthCallback(have)) return;
    // An unknown route is not ours to keep: replace it so Back does not land on
    // it again. replaceState fires no hashchange, and state already says
    // `want`, so nothing else to sync.
    // A roll tweaked on the report replaces its own entry too: every IV bump
    // is not a page Back should step through.
    const haveScreen = screenFromHash(have);
    const known = hashForView(haveScreen, tournamentIdFromHash(have), playerIdFromHash(have)) === have.split('?')[0];
    if (!known || (haveScreen === 'report' && state.screen === 'report')) history.replaceState(null, '', want);
    else window.location.hash = want;
  }, [state.screen, state.activeTournamentId, state.activePlayerId, state.species, state.shadow, state.league, state.iv, state.cup, state.statFloor]);

  // URL → state, for back/forward and hand-edited addresses.
  useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      // supabase-js clears a token it has read with `location.hash = ''`, which
      // is a hashchange to nowhere: followed, it sent every Discord sign-in to
      // landing instead of the Account screen the callback opened.
      if (isAuthCallback(e.oldURL.slice(e.oldURL.indexOf('#')))) {
        history.replaceState(null, '', wanted.current);
        return;
      }
      const next = screenFromHash(window.location.hash);
      const nextId = tournamentIdFromHash(window.location.hash);
      const nextPlayer = playerIdFromHash(window.location.hash);
      // An open match keeps its screen when the address still says Matches.
      setState((s) => applyReport(
        hashForView(s.screen, s.activeTournamentId, s.activePlayerId) === hashForView(next, nextId, nextPlayer)
          ? s
          : { ...s, screen: next, activeTournamentId: nextId, activePlayerId: nextPlayer },
        reportFromHash(window.location.hash),
      ));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const value = useMemo<AppStateContextValue>(() => {
    const set = <K extends keyof AppStateShape>(key: K, v: AppStateShape[K]) =>
      setState((s) => ({ ...s, [key]: v }));
    const patch = (partial: Partial<AppStateShape>) => setState((s) => {
      // On a Mega `bestBuddy` is its Mega Level, which means nothing to the next species.
      const next = partial.species && partial.species !== s.species ? SPECIES_BY_ID.get(partial.species) : undefined;
      const crossed = next && (isMega(next) || isMega(SPECIES_BY_ID.get(s.species)!));
      // The stat floor is a range of this species' stats; the next one's starts unfiltered.
      const species = next ? { statFloor: null } : {};
      return { ...s, ...(crossed ? { bestBuddy: false } : {}), ...species, ...partial };
    });
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
