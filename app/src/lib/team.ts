import { battle } from './engine';
import type { BattleMon, BattleResult } from './types';

/**
 * A team battle, played as one continuous fight rather than a set of matchups.
 *
 * This is the part a matchup matrix cannot express. In GBL the winner of an
 * exchange does not reset: it carries its remaining HP and its banked energy
 * straight into the next opponent, and shields belong to the *player* for the
 * whole battle rather than to each Pokemon. So the value of a lead is not
 * "does it win its matchup" but "what does it leave behind" — a mon that wins
 * at 15% HP with no energy has spent the same matchup very differently from
 * one that wins at 70% holding a charged move, and only the second is why
 * people talk about carrying a game.
 *
 * That also means team strength is not separable. You cannot score three
 * Pokemon independently and add them up, because the second one's job depends
 * on what the first left standing. Everything here follows from that.
 */

/** Shields per player for the whole battle, not per Pokemon. */
export const TEAM_SHIELDS = 2;

export interface ChainStep {
  /** Index into each team of the mons that fought. */
  a: number;
  b: number;
  /** True if A's mon survived the exchange. */
  aWon: boolean;
  /** State the survivor carries forward. */
  hp: number;
  maxHp: number;
  energy: number;
  shieldsA: number;
  shieldsB: number;
}

export interface TeamResult {
  win: boolean;
  /** Mons still standing when it ended. The usual GBL scoreline. */
  aliveA: number;
  aliveB: number;
  /**
   * Fraction of total team HP left on each side. Distinguishes a 3-0 that
   * finished untouched from one that finished on fumes, which matters when
   * comparing teams that both went 3-0.
   */
  hpFracA: number;
  hpFracB: number;
  steps: ChainStep[];
}

interface Live {
  mon: BattleMon;
  hp: number;
  energy: number;
}

/**
 * Play team A against team B, leads first, loser replaced by the next in
 * order.
 *
 * Deliberately models the no-switch line: each side sends its next Pokemon
 * only when the current one faints. Voluntary switching is a real and large
 * part of high-level play, but it is a game tree rather than a simulation —
 * both players are choosing simultaneously under hidden information — and
 * folding a guess about it in here would quietly turn a measurement into an
 * opinion. The switch pressure a team creates is measured separately, from
 * the scenarios, rather than assumed here.
 */
export function teamBattle(
  teamA: readonly BattleMon[],
  teamB: readonly BattleMon[],
  opts: { shields?: number; optimizeTiming?: boolean } = {},
): TeamResult {
  const shields = opts.shields ?? TEAM_SHIELDS;
  const optimize = opts.optimizeTiming ?? false;

  const liveA: Live[] = teamA.map((mon) => ({ mon, hp: mon.hp, energy: 0 }));
  const liveB: Live[] = teamB.map((mon) => ({ mon, hp: mon.hp, energy: 0 }));
  let i = 0;
  let j = 0;
  let sA = shields;
  let sB = shields;
  const steps: ChainStep[] = [];

  // Bounded by the number of faints possible: every exchange kills someone.
  while (i < liveA.length && j < liveB.length) {
    const A = liveA[i];
    const B = liveB[j];
    const r: BattleResult = battle(
      A.mon, B.mon, sA, sB, A.energy, B.energy, false, optimize, A.hp, B.hp,
    );

    // Whoever is left standing keeps what they have. `battle` reports HP
    // already floored at zero, so the loser reads as 0 without special casing.
    A.hp = r.hpA;
    B.hp = r.hpB;
    A.energy = r.energyA;
    B.energy = r.energyB;
    sA = r.shieldsA;
    sB = r.shieldsB;

    const aWon = r.hpA > 0;
    steps.push({
      a: i, b: j, aWon,
      hp: aWon ? r.hpA : r.hpB,
      maxHp: aWon ? r.maxHpA : r.maxHpB,
      energy: aWon ? r.energyA : r.energyB,
      shieldsA: sA, shieldsB: sB,
    });

    // A double KO retires both, which is how simultaneous faints resolve.
    if (r.hpA <= 0) i++;
    if (r.hpB <= 0) j++;
    // Neither died: the clock ran out on this exchange. Nothing can progress,
    // so stop rather than spin.
    if (r.hpA > 0 && r.hpB > 0) break;
  }

  const totalA = teamA.reduce((n, m) => n + m.hp, 0);
  const totalB = teamB.reduce((n, m) => n + m.hp, 0);
  const leftA = liveA.reduce((n, x) => n + Math.max(0, x.hp), 0);
  const leftB = liveB.reduce((n, x) => n + Math.max(0, x.hp), 0);
  const aliveA = liveA.filter((x) => x.hp > 0).length;
  const aliveB = liveB.filter((x) => x.hp > 0).length;

  return {
    // Mons remaining decides it, exactly as the scoreline does. HP fraction
    // breaks the tie when both sides have the same number standing.
    win: aliveA !== aliveB ? aliveA > aliveB : leftA / totalA > leftB / totalB,
    aliveA,
    aliveB,
    hpFracA: leftA / totalA,
    hpFracB: leftB / totalB,
    steps,
  };
}

/**
 * How much of a team's result came from carryover rather than raw matchups.
 *
 * Runs the same fight twice — once with state persisting, once resetting every
 * survivor to full HP and zero energy — and reports the gap. A team whose
 * score barely moves is a set of three good Pokemon; one whose score collapses
 * without carryover is a team, and the difference is the thing worth building
 * around.
 */
export function carryoverEdge(
  teamA: readonly BattleMon[],
  teamB: readonly BattleMon[],
  opts: { shields?: number; optimizeTiming?: boolean } = {},
): { chained: TeamResult; isolated: TeamResult; edge: number } {
  const chained = teamBattle(teamA, teamB, opts);
  const isolated = teamBattleIsolated(teamA, teamB, opts);
  return { chained, isolated, edge: chained.hpFracA - isolated.hpFracA };
}

/** The same chain with every survivor healed between matchups — the control. */
function teamBattleIsolated(
  teamA: readonly BattleMon[],
  teamB: readonly BattleMon[],
  opts: { shields?: number; optimizeTiming?: boolean } = {},
): TeamResult {
  const shields = opts.shields ?? TEAM_SHIELDS;
  const optimize = opts.optimizeTiming ?? false;
  const liveA = teamA.map((mon) => ({ mon, hp: mon.hp, energy: 0 }));
  const liveB = teamB.map((mon) => ({ mon, hp: mon.hp, energy: 0 }));
  let i = 0;
  let j = 0;
  let sA = shields;
  let sB = shields;
  const steps: ChainStep[] = [];

  while (i < liveA.length && j < liveB.length) {
    const A = liveA[i];
    const B = liveB[j];
    const r = battle(A.mon, B.mon, sA, sB, 0, 0, false, optimize);
    sA = r.shieldsA;
    sB = r.shieldsB;
    const aWon = r.hpA > 0;
    // Survivor is restored: this is the counterfactual, not the game.
    if (aWon) A.hp = A.mon.hp;
    else A.hp = 0;
    if (r.hpB > 0) B.hp = B.mon.hp;
    else B.hp = 0;
    steps.push({ a: i, b: j, aWon, hp: aWon ? r.hpA : r.hpB, maxHp: aWon ? r.maxHpA : r.maxHpB, energy: 0, shieldsA: sA, shieldsB: sB });
    if (r.hpA <= 0) i++;
    if (r.hpB <= 0) j++;
    if (r.hpA > 0 && r.hpB > 0) break;
  }

  const totalA = teamA.reduce((n, m) => n + m.hp, 0);
  const totalB = teamB.reduce((n, m) => n + m.hp, 0);
  const leftA = liveA.reduce((n, x) => n + Math.max(0, x.hp), 0);
  const leftB = liveB.reduce((n, x) => n + Math.max(0, x.hp), 0);
  const aliveA = liveA.filter((x) => x.hp > 0).length;
  const aliveB = liveB.filter((x) => x.hp > 0).length;
  return {
    win: aliveA !== aliveB ? aliveA > aliveB : leftA / totalA > leftB / totalB,
    aliveA, aliveB, hpFracA: leftA / totalA, hpFracB: leftB / totalB, steps,
  };
}
