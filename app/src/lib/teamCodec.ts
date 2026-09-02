import type { AddPokemonChoice } from '../components/AddPokemonModal';
import type { LeagueId } from './types';
import { speciesOf } from './data';
import { getEntry } from './engine';

export interface StoredMember {
  ref: string;
  fast_move: string;
  charge_moves: string[];
  iv_attack: number;
  iv_defense: number;
  iv_stamina: number;
  level: number | null;
}

export interface DecodedMember {
  choice: AddPokemonChoice;
  /** The stored move id, when it no longer exists in the data. Null when fine. */
  unknownMove: string | null;
}

export function encodeMember(choice: AddPokemonChoice, league: LeagueId): StoredMember {
  const species = speciesOf(choice.ref);
  const fast = species?.fastMoves[choice.fastIdx];
  // Level is recorded, not authoritative — the engine derives it from the IVs
  // and the cap. Stored so a later data change that moves it can be seen.
  //
  // `true` for best buddy, because every producer of a choice on this path
  // draws its spread from that table: `defaultSpreadFor(ref, league, true)` in
  // the builder and the add modal, `bestSpreadFor(ref, league, true)` beside
  // it. Reading the other table recorded a level for IVs that were never
  // chosen against it — 50 where the builder said 50.5 in Great, 51 in Ultra —
  // which made every roster look like it had already drifted and left this
  // column unable to detect the drift it exists for. `getTable` applies
  // eligibility itself, so this needs no `bestBuddyEligible` guard, which is
  // why none of those callers has one either.
  let level: number | null = null;
  try {
    level = getEntry(choice.ref, choice.iv, league, true).entry.lvl;
  } catch {
    // An unknown ref has no table. The member is still worth storing.
  }
  return {
    ref: choice.ref,
    fast_move: fast?.id ?? '',
    charge_moves: [...choice.chargeIds],
    iv_attack: choice.iv.a,
    iv_defense: choice.iv.d,
    iv_stamina: choice.iv.s,
    level,
  };
}

export function decodeMember(stored: StoredMember): DecodedMember {
  const species = speciesOf(stored.ref);
  const idx = species?.fastMoves.findIndex((m) => m.id === stored.fast_move) ?? -1;
  return {
    choice: {
      ref: stored.ref,
      chargeIds: [...stored.charge_moves],
      // Fall back to the first move, and SAY SO through unknownMove. Resolving
      // silently is how a saved team quietly becomes a different team.
      fastIdx: idx >= 0 ? idx : 0,
      iv: { a: stored.iv_attack, d: stored.iv_defense, s: stored.iv_stamina },
    },
    unknownMove: idx >= 0 ? null : stored.fast_move,
  };
}
