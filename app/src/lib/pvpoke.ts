/**
 * PvPoke's own battle engine, run as-is.
 *
 * The files in app/vendor/pvpoke are PvPoke's Battle, Pokemon, ActionLogic
 * and friends, unmodified (MIT). They are browser scripts: sloppy-mode globals
 * that load their data with jQuery. So they are evaluated with `new Function`
 * - sloppy by construction, which they need - with the handful of globals
 * they touch passed in as parameters, shadowing the real ones.
 *
 * The caller supplies the sources and the gamemaster, so the same loader
 * serves Node scripts (fs) and the app (a bundler import) alike.
 */

import type { BattleLogEntry, BattleResult, IV } from './types';

/** Evaluation order: each file only needs the ones before it at call time. */
export const PVPOKE_FILES = [
  'DamageCalculator', 'TimelineEvent', 'TimelineAction', 'GameMaster', 'Pokemon', 'ActionLogic', 'Battle',
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped vendored JS */
export interface PvPoke {
  Battle: any;
  Pokemon: any;
}

export function loadPvPoke(sources: Record<(typeof PVPOKE_FILES)[number], string>, gamemaster: unknown): PvPoke {
  // GameMaster requests its data through $.ajax and defines the rest of its
  // methods after that call returns, so the data must arrive afterwards,
  // as it would asynchronously in a browser.
  const pending: { success: (d: unknown) => void }[] = [];
  const jq = Object.assign(() => ({ insertAfter() {}, eq() { return this; } }), {
    ajax: (o: { success: (d: unknown) => void }) => pending.push(o),
    getJSON: () => {},
  });
  const store: Record<string, string> = {};
  const window = {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    location: { href: '' },
  };
  const settings = { gamemaster: 'gamemaster', xls: false, hardMovesetLinks: false };
  const body = PVPOKE_FILES.map((f) => sources[f]).join('\n;\n') +
    '\nvar gm = GameMaster.getInstance();\nreturn { Battle: Battle, Pokemon: Pokemon };';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const make = new Function('$', 'window', 'host', 'webRoot', 'siteVersion', 'settings', 'console', body);
  const quiet = { ...console, log: () => {} };
  const engine = make(jq, window, 'node', '', '0', settings, quiet) as PvPoke;
  while (pending.length) pending.shift()!.success(gamemaster);
  return engine;
}

/** One side of a battle, in our identifiers. */
export interface PvPokeSide {
  /** Species ref; a `_shadow` suffix is PvPoke's own id for the Shadow. */
  ref: string;
  iv: IV;
  /** Level, as the roll's table entry has it (half levels, 51 for Best Buddy). */
  lvl: number;
  fast: string;
  charges: string[];
  shields: number;
  energy?: number;
  startHp?: number;
}

/**
 * One battle on PvPoke's engine, returned in our BattleResult shape.
 *
 * The log is rebuilt from PvPoke's timeline: HP and energy accumulate from
 * each event's damage and energy values, a charged move counts as shielded
 * when the defender's shield event lands on the same turn, and stat stages
 * follow the move's own buffs whenever PvPoke reports that they applied.
 * `bait` has no PvPoke equivalent and is always false.
 */
export function pvpokeBattle(
  pv: PvPoke, cp: number, sideA: PvPokeSide, sideB: PvPokeSide, optimizeTiming = true,
): BattleResult {
  const b = new pv.Battle();
  b.setCP(cp);
  const mk = (s: PvPokeSide, k: number) => {
    const p = new pv.Pokemon(s.ref, k, b);
    p.initialize(cp);
    p.ivs.atk = s.iv.a;
    p.ivs.def = s.iv.d;
    p.ivs.hp = s.iv.s;
    p.setLevel(s.lvl);
    p.selectMove('fast', s.fast);
    s.charges.forEach((c, i) => p.selectMove('charged', c, i));
    if (s.charges.length < 2) p.selectMove('charged', 'none', 1);
    p.setShields(s.shields);
    p.setStartEnergy(s.energy ?? 0);
    if (s.startHp !== undefined) p.setStartHp(s.startHp);
    p.optimizeMoveTiming = optimizeTiming;
    return p;
  };
  const A = mk(sideA, 0), B = mk(sideB, 1);
  b.setNewPokemon(A, 0);
  b.setNewPokemon(B, 1);
  b.simulate();

  const mons = [A, B];
  const hp = [A.startHp, B.startHp];
  const energy = [sideA.energy ?? 0, sideB.energy ?? 0];
  const stages = [{ atk: 0, def: 0 }, { atk: 0, def: 0 }];
  const clamp = (n: number) => Math.max(-4, Math.min(4, n));
  const timeline = b.getTimeline() as { type: string; name: string; actor: number; turn: number; values: (number | string)[] }[];
  const shieldedAt = new Set(timeline.filter((e) => e.type === 'shield').map((e) => `${e.turn}|${e.actor}`));
  const chargedTurns = new Map<number, Set<number>>();
  const log: BattleLogEntry[] = [];
  for (const e of timeline) {
    const kind = e.type.startsWith('fast') ? 'fast' : e.type.startsWith('charged') ? 'charge' : null;
    if (!kind) continue;
    const me = e.actor, foe = 1 - me;
    const damage = Number(e.values[0]);
    hp[foe] = Math.max(0, hp[foe] - damage);
    energy[me] = Math.max(0, Math.min(100, energy[me] + Number(e.values[1])));
    let buffText: string | null = null;
    if (kind === 'charge') {
      if (!chargedTurns.has(e.turn)) chargedTurns.set(e.turn, new Set());
      chargedTurns.get(e.turn)!.add(me);
      const text = e.values.slice(3).find((v) => typeof v === 'string' && /Attack|Defense/.test(v));
      const move = (mons[me].chargedMoves as { name: string; buffs?: number[]; buffTarget?: string }[]).find((m) => m?.name === e.name);
      if (text && move?.buffs) {
        const who = stages[move.buffTarget === 'self' ? me : foe];
        who.atk = clamp(who.atk + move.buffs[0]);
        who.def = clamp(who.def + move.buffs[1]);
        buffText = String(text).replace('<br>', ', ');
      }
    }
    log.push({
      turn: e.turn, actor: me === 0 ? 'A' : 'B', kind, moveName: e.name, bait: false,
      shielded: kind === 'charge' && shieldedAt.has(`${e.turn}|${foe}`), damage,
      hpA: hp[0], hpB: hp[1], energyA: energy[0], energyB: energy[1],
      atkStageA: stages[0].atk, defStageA: stages[0].def, atkStageB: stages[1].atk, defStageB: stages[1].def,
      buffText,
    });
  }
  const mine = A.hp / A.stats.hp, theirs = B.hp / B.stats.hp;
  return {
    win: A.hp <= 0 && B.hp <= 0 ? A.stats.atk >= B.stats.atk : mine > theirs,
    mine, theirs,
    hpA: A.hp, hpB: B.hp, maxHpA: A.stats.hp, maxHpB: B.stats.hp,
    cmpDecided: [...chargedTurns.values()].some((s) => s.size === 2),
    margin: (mine - theirs) * 100,
    energyA: A.energy, energyB: B.energy, shieldsA: A.shields, shieldsB: B.shields,
    log,
  };
}

