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
  let level: number | null = null;
  try {
    level = getEntry(choice.ref, choice.iv, league).entry.lvl;
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
