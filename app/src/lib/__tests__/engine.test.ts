import { describe, it, expect } from 'vitest';
import {
  PVP_BONUS, ENERGY_CAP, HP_WEIGHT, SHADOW_ATK_MULT, SHADOW_DEF_MULT,
  STAGE_MIN, STAGE_MAX, buffMultiplier, dmg, battle, mkBattleMon, chargesOf, fastMoveCounts,
  rankedOpponents, getEntry,
} from '../engine';
import { SPECIES_BY_ID, parseRef } from '../data';
import type { ChargeMove, FastMove } from '../types';

const F = (o: Partial<FastMove> = {}): FastMove =>
  ({ id: 'f', name: 'Fast', type: 'normal', archetype: null, power: 10, turns: 2, energyGain: 8, stab: 1, ...o });
const C = (o: Partial<ChargeMove> = {}): ChargeMove =>
  ({ id: 'c', name: 'Charge', type: 'normal', archetype: null, power: 90, energy: 50, stab: 1, ...o });
const mon = (o: { atk?: number; def?: number; hp?: number; types?: string[]; fast?: FastMove; charges?: ChargeMove[] } = {}) =>
  mkBattleMon(
    { atk: o.atk ?? 100, def: o.def ?? 100, hp: o.hp ?? 150 },
    o.fast ?? F(), o.charges ?? [C()], o.types ?? ['normal'],
  );

describe('dmg', () => {
  it('applies the PvP bonus multiplier', () => {
    // 100 * 0.5 * 1.3 is exactly 65 in real numbers, but the game's float32
    // 1.3 is a hair under, so it floors to 64 and lands 65 - as PvPoke does.
    expect(dmg(100, 100, C({ power: 100 }), ['normal'])).toBe(65);
  });
  it('never deals zero — there is always the +1', () => {
    expect(dmg(1, 1000, C({ power: 1 }), ['normal'])).toBeGreaterThanOrEqual(1);
  });
  it('scales with the attack-to-defence ratio', () => {
    expect(dmg(200, 100, C(), ['normal'])).toBeGreaterThan(dmg(100, 100, C(), ['normal']));
    expect(dmg(100, 200, C(), ['normal'])).toBeLessThan(dmg(100, 100, C(), ['normal']));
  });
  it('applies STAB', () => {
    expect(dmg(100, 100, C({ stab: 1.2 }), ['normal'])).toBeGreaterThan(dmg(100, 100, C({ stab: 1 }), ['normal']));
  });
  it('applies type effectiveness, including a double resist', () => {
    const neutral = dmg(100, 100, C({ type: 'normal' }), ['water']);
    const resisted = dmg(100, 100, C({ type: 'normal' }), ['rock']);
    const doubled = dmg(100, 100, C({ type: 'normal' }), ['ghost']);
    expect(resisted).toBeLessThan(neutral);
    expect(doubled).toBeLessThan(resisted);
  });
  it('is monotonic in attack, which the breakpoint search relies on', () => {
    let prev = 0;
    for (let a = 50; a <= 200; a += 10) {
      const d = dmg(a, 100, C(), ['normal']);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('constants', () => {
  it('carries the Trainer Battle bonus as float32 1.3, as PvPoke does', () => expect(PVP_BONUS).toBe(Math.fround(1.3)));
  it('caps energy at 100', () => expect(ENERGY_CAP).toBe(100));
  it('prices full HP on the same scale as the rating', () => expect(HP_WEIGHT).toBe(500));
  it("uses PvPoke's shadow multipliers, 1.2 and float32 5/6", () => {
    expect([SHADOW_ATK_MULT, SHADOW_DEF_MULT]).toEqual([1.2, 0.83333331]);
  });
});

describe('buffMultiplier', () => {
  it('is 1 at stage zero', () => expect(buffMultiplier(0)).toBe(1));
  it('is asymmetric: +1 is 1.25 but -1 is 0.8, not 1/1.25', () => {
    expect(buffMultiplier(1)).toBe(1.25);
    expect(buffMultiplier(-1)).toBe(0.8);
  });
  it('reaches 2x and 0.5x at the extremes', () => {
    expect(buffMultiplier(STAGE_MAX)).toBe(2);
    expect(buffMultiplier(STAGE_MIN)).toBe(0.5);
  });
  it('clamps beyond the extremes', () => {
    expect(buffMultiplier(99)).toBe(buffMultiplier(STAGE_MAX));
    expect(buffMultiplier(-99)).toBe(buffMultiplier(STAGE_MIN));
  });
  it('accepts fractional stages, which chance-gated buffs produce', () => {
    expect(buffMultiplier(0.2)).toBeGreaterThan(1);
    expect(buffMultiplier(0.2)).toBeLessThan(buffMultiplier(1));
  });
});

describe('battle', () => {
  it('is deterministic — same inputs, same result', () => {
    const a = mon(), b = mon({ atk: 90 });
    const x = battle(a, b, 1, 1, 0, 0, false, false);
    const y = battle(a, b, 1, 1, 0, 0, false, false);
    expect(x).toEqual(y);
  });
  it('the stronger attacker wins an otherwise identical matchup', () => {
    const r = battle(mon({ atk: 160 }), mon({ atk: 80 }), 0, 0, 0, 0, false, false);
    expect(r.win).toBe(true);
  });
  it('terminates — someone always faints', () => {
    const r = battle(mon(), mon(), 2, 2, 0, 0, false, false);
    expect(r.hpA <= 0 || r.hpB <= 0).toBe(true);
  });
  it('a shielded charged move deals exactly 1', () => {
    const r = battle(mon({ atk: 200 }), mon({ hp: 400 }), 0, 2, 0, 0, true, false);
    const shielded = r.log.filter((l) => l.shielded);
    expect(shielded.length).toBeGreaterThan(0);
    expect(shielded.every((l) => l.damage === 1)).toBe(true);
  });
  it('spends shields rather than hoarding them', () => {
    const r = battle(mon({ atk: 200 }), mon({ hp: 500 }), 0, 2, 0, 0, false, false);
    expect(r.shieldsB).toBeLessThan(2);
  });
  it('carries starting HP in, for a chained matchup', () => {
    const full = battle(mon(), mon(), 0, 0, 0, 0, false, false);
    const hurt = battle(mon(), mon(), 0, 0, 0, 0, false, false, 20, undefined);
    expect(hurt.win).not.toBe(full.win);
  });
  it('collectLog off produces no log but the same outcome', () => {
    const withLog = battle(mon(), mon({ atk: 80 }), 1, 1, 0, 0, true, false);
    const without = battle(mon(), mon({ atk: 80 }), 1, 1, 0, 0, false, false);
    expect(without.log).toHaveLength(0);
    expect(without.win).toBe(withLog.win);
    expect(without.hpA).toBe(withLog.hpA);
  });
  it('registers a fast move on its FINAL turn, not before', () => {
    const slow = mon({ fast: F({ turns: 5, power: 20 }) });
    const r = battle(slow, mon({ hp: 900, fast: F({ turns: 5 }) }), 0, 0, 0, 0, true, false);
    const first = r.log.find((l) => l.actor === 'A' && l.kind === 'fast');
    expect(first!.turn).toBe(4); // 0-indexed: the 5th turn
  });
  it('a KO denies the victim the fast move it had begun', () => {
    const killer = mon({ atk: 300, fast: F({ turns: 1, energyGain: 60 }) });
    const doomed = mon({ hp: 1, fast: F({ turns: 5 }) });
    const r = battle(killer, doomed, 0, 0, 0, 0, true, false);
    expect(r.log.filter((l) => l.actor === 'B' && l.kind === 'fast')).toHaveLength(0);
  });
  it('starting energy lets a charged move come out sooner', () => {
    const cold = battle(mon(), mon({ hp: 400 }), 0, 0, 0, 0, true, false);
    const loaded = battle(mon(), mon({ hp: 400 }), 0, 0, 100, 0, true, false);
    const firstCharge = (r: typeof cold) => r.log.find((l) => l.actor === 'A' && l.kind === 'charge')?.turn ?? 1e9;
    expect(firstCharge(loaded)).toBeLessThan(firstCharge(cold));
  });
  it('reports energy and shields at the end, for the chain to carry', () => {
    const r = battle(mon(), mon(), 2, 2, 0, 0, false, false);
    expect(r.energyA).toBeGreaterThanOrEqual(0);
    expect(r.energyA).toBeLessThanOrEqual(ENERGY_CAP);
    expect(r.shieldsA).toBeLessThanOrEqual(2);
  });
});

describe('chargesOf and fastMoveCounts', () => {
  it('drops a null second charge', () => {
    expect(chargesOf(C(), null)).toHaveLength(1);
    expect(chargesOf(C(), C({ id: 'c2' }))).toHaveLength(2);
  });
  it('drifts DOWN as leftover energy accumulates, per the worked examples', () => {
    // Rollout gains 13, Body Slam costs 35: three throws of three, then a two.
    expect(fastMoveCounts(F({ energyGain: 13 }), C({ energy: 35 }), 4)).toEqual([3, 3, 3, 2]);
    // Solar Beam at 80 against the same fast move: 7 then sixes.
    expect(fastMoveCounts(F({ energyGain: 13 }), C({ energy: 80 }), 4)).toEqual([7, 6, 6, 6]);
  });
  it('drifts down and then CYCLES, rather than decreasing forever', () => {
    // gain 8, cost 50: residue runs 6,4,2,0 and the fifth throw needs a full
    // seven again. Neither monotonic direction holds — the doc says so and two
    // assumed-monotonic assertions were wrong before this one.
    const counts = fastMoveCounts(F({ energyGain: 8 }), C({ energy: 50 }), 6);
    expect(counts).toEqual([7, 6, 6, 6, 7, 6]);
    const span = Math.max(...counts) - Math.min(...counts);
    expect(span).toBeLessThanOrEqual(1);
  });
  it('lands exactly when the cost divides the gain, with no drift', () => {
    expect(fastMoveCounts(F({ energyGain: 10 }), C({ energy: 50 }), 4)).toEqual([5, 5, 5, 5]);
  });
  it('returns nothing when the fast move generates no energy', () => {
    expect(fastMoveCounts(F({ energyGain: 0 }), C({ energy: 50 }), 4)).toEqual([]);
  });
});

describe('opponent relevance is weighted by who you actually meet', () => {
  // Shadow-aware: a Shadow is its own opponent with its own rank. Reading the
  // base form's instead counted Shadow Houndoom (#144) as Houndoom (#307).
  const rankOf = (ref: string) => {
    const { id, shadow } = parseRef(ref);
    const sp = SPECIES_BY_ID.get(id);
    return (shadow ? sp?.shadowLeagueRank : sp?.leagueRank)?.great ?? 9999;
  };

  it('leads with the meta and leaves the tail out', () => {
    // The rank term used to be `- rank * 0.1` against bonuses of 400 to 600,
    // so it barely counted: Azumarill's list had a median rank of 221 and a
    // tail to 647 — Celebi, Celesteela, Shadow Staraptor.
    const rel = rankedOpponents('azumarill', 'great', 0, 'break', 40);
    const ranks = rel.map((r) => rankOf(r.info.id)).sort((a, b) => a - b);
    const median = ranks[Math.floor(ranks.length / 2)];
    expect(median).toBeLessThan(120);
    expect(Math.max(...ranks.filter((r) => r < 9999))).toBeLessThan(300);
  });

  it('puts meta opponents ahead of everything', () => {
    // Which meta mons decide a roll depends on the battle model, so this
    // holds the weighting, not a name: it named Tinkaton until the 2026
    // rebalance, then Altaria until PvPoke's decision logic (B3) moved
    // Lickilicky's IV-sensitive matchups onto others.
    const rel = rankedOpponents('lickilicky', 'great', 0, 'either', 40);
    const lead = rel.slice(0, 5).map((r) => rankOf(r.info.id));
    expect(Math.max(...lead)).toBeLessThanOrEqual(50);
    expect(Math.min(...lead)).toBeLessThanOrEqual(20);
  });

  it('never surfaces a Pokémon nobody brings', () => {
    // Anorith is rank 1132 in Great. However decidable a matchup against it
    // might be, it is not a relevant matchup.
    for (const kind of ['break', 'bulk', 'either'] as const) {
      const rel = rankedOpponents('lickilicky', 'great', 0, kind, 40);
      expect(rel.some((r) => parseRef(r.info.id).id === 'anorith')).toBe(false);
    }
  });

  it('still lets a knife-edge matchup outrank a dull one against a better mon', () => {
    // The weight scales relevance, it does not replace it — otherwise the list
    // would just be the rankings again.
    const rel = rankedOpponents('azumarill', 'great', 0, 'either', 40);
    const ranks = rel.map((r) => rankOf(r.info.id));
    expect(ranks).not.toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('battle options: bait mode and starting stages', () => {
  // PvPoke ground truth (its own Battle class on pvpoke.com, 1v1 shields):
  // Medicham 7/15/14 Counter / Ice Punch + Psychic v Registeel 8/15/14 Lock-On /
  // Focus Blast + Flash Cannon. Selective baiting spends Ice Punch into the
  // shield and finishes with Psychic for 21; with baiting off PvPoke spends
  // Psychic into the shield and lands Ice Punch for 14.
  const pick = (id: string, iv: { a: number; d: number; s: number }, fast: string, charges: string[]) => {
    const s = SPECIES_BY_ID.get(id)!;
    return mkBattleMon(getEntry(id, iv, 'great').entry, s.fastMoves.find((m) => m.id === fast)!,
      charges.map((c) => s.chargeMoves.find((m) => m.id === c)!), s.types);
  };
  const medicham = pick('medicham', { a: 7, d: 15, s: 14 }, 'COUNTER', ['ICE_PUNCH', 'PSYCHIC']);
  const registeel = pick('registeel', { a: 8, d: 15, s: 14 }, 'LOCK_ON', ['FOCUS_BLAST', 'FLASH_CANNON']);
  const throws = (bait: 0 | 1 | 2) =>
    battle(medicham, registeel, 1, 1, 0, 0, true, true, undefined, undefined, 'always', 'always', { baitA: bait })
      .log.filter((e) => e.kind === 'charge' && e.actor === 'A').map((e) => `${e.moveName}:${e.damage}`);

  it('matches PvPoke with selective baiting, the default', () => {
    expect(throws(1)).toEqual(['Ice Punch:1', 'Psychic:21']);
    expect(battle(medicham, registeel, 1, 1, 0, 0, true, true).log).toEqual(
      battle(medicham, registeel, 1, 1, 0, 0, true, true, undefined, undefined, 'always', 'always', { baitA: 1 }).log);
  });
  it('matches PvPoke with baiting off', () => expect(throws(0)).toEqual(['Psychic:1', 'Ice Punch:14']));
  it('starts from the given stat stages', () => {
    const plain = battle(mon(), mon({ hp: 400 }), 0, 0, 0, 0, true, false).log[0].damage;
    const buffed = battle(mon(), mon({ hp: 400 }), 0, 0, 0, 0, true, false, undefined, undefined, 'always', 'always', { stagesA: { atk: 2, def: 0 } }).log[0].damage;
    expect(buffed).toBeGreaterThan(plain);
  });
});
