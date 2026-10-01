import { defaultSpreadFor, getEntry, mkBattleMon, selectedCharges } from './engine';
import { movesFor, speciesOf } from './data';
import type { BattleMon, IV, LeagueId } from './types';

const monCache = new Map<string, BattleMon>();

/**
 * A build chosen by hand, rather than the league's rated set at the rank-1 roll.
 *
 * §1d records that the rated set is often not the played set, and a team of
 * three is where that matters most — so the team builder lets a slot carry its
 * own moves and IVs. Absent, everything behaves exactly as before.
 */
export interface MonBuild {
  fastIdx: number;
  /** Empty means the league's rated charged moves. */
  chargeIds: string[];
  iv: IV;
}

export function monFor(ref: string, lg: LeagueId, build?: MonBuild): BattleMon {
  const sp = speciesOf(ref)!;
  // A custom build must not collide with the cached rated one, so the key
  // carries it. Rated lookups keep the short key and stay a cache hit.
  const key = build
    ? `${ref}|${lg}|${build.fastIdx}|${build.chargeIds.join(',')}|${build.iv.a}.${build.iv.d}.${build.iv.s}`
    : `${ref}|${lg}`;
  const hit = monCache.get(key);
  if (hit) return hit;
  const rated = movesFor(sp, lg);
  const fast = build ? (sp.fastMoves[Math.min(build.fastIdx, sp.fastMoves.length - 1)] ?? rated.fast) : rated.fast;
  const charges = build && build.chargeIds.length ? selectedCharges(sp, build.chargeIds) : rated.charges;
  // The same roll the slot's card displays. These two disagreeing is the one
  // thing this must not do: the card would describe a build the analysis behind
  // it never fielded.
  const entry = build ? getEntry(ref, build.iv, lg).entry : defaultSpreadFor(ref, lg, true);
  const mon = mkBattleMon(entry, fast, charges, sp.types);
  monCache.set(key, mon);
  return mon;
}

