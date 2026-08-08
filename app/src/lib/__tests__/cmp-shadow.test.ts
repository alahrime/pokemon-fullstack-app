import { describe, it, expect } from 'vitest';
import {
  SHADOW_ATK_MULT,
  SHADOW_DEF_MULT,
  bestSpreadFor,
  getTable,
  mkBattleMon,
  opponentInfo,
  rankedOpponents,
} from '../engine';
import { movesFor, pickableFor, speciesOf } from '../data';
import type { LeagueId } from '../types';

/**
 * Charge-move priority is decided on the Attack stat, and Shadow does not
 * change the Attack stat.
 *
 * Shadow's x6/5 attack and x5/6 defence are damage multipliers, not stat
 * changes — which is exactly why a Shadow carries its plain form's CP and its
 * plain form's stat-product rank, as `getTable` has always done deliberately.
 * CMP compares stats, so it must not see the multiplier.
 *
 * It did. `murkrow` and `murkrow_shadow` — same roll, same CP, same rank —
 * disagreed about whether Zapdos contests priority with them, because the
 * Shadow's attack was being read 20% high. That is the case these tests pin,
 * plus the invariant behind it.
 */

const LEAGUES: LeagueId[] = ['great', 'ultra', 'master'];

describe('the Attack stat is not moved by Shadow', () => {
  it('a Shadow keeps its plain form’s Attack stat, and only its damage attack scales', () => {
    for (const lg of LEAGUES) {
      const plain = bestSpreadFor('murkrow', lg, true);
      const shadow = bestSpreadFor('murkrow_shadow', lg, true);
      // The stat is the same number, not merely close.
      expect(shadow.statAtk, lg).toBeCloseTo(plain.statAtk, 10);
      // The damage attack is the stat times the multiplier, and defence falls.
      expect(shadow.atk, lg).toBeCloseTo(plain.atk * SHADOW_ATK_MULT, 10);
      expect(shadow.def, lg).toBeCloseTo(plain.def * SHADOW_DEF_MULT, 10);
      // And the things that were never supposed to move, still do not.
      expect(shadow.cp, lg).toBe(plain.cp);
      expect(shadow.sp, lg).toBe(plain.sp);
    }
  });

  it('holds for every species the league offers in both forms', () => {
    for (const lg of LEAGUES) {
      const refs = pickableFor(lg);
      const both = refs.filter((r) => r.endsWith('_shadow') && refs.includes(r.replace(/_shadow$/, '')));
      expect(both.length, lg).toBeGreaterThan(20);
      for (const s of both) {
        const p = opponentInfo(s.replace(/_shadow$/, ''), lg);
        const sh = opponentInfo(s, lg);
        expect(sh.statAtk, `${lg} ${s}`).toBeCloseTo(p.statAtk, 10);
        expect(sh.atk, `${lg} ${s}`).toBeCloseTo(p.atk * SHADOW_ATK_MULT, 10);
      }
    }
  });

  it('the whole spread table carries the stat alongside the damage attack', () => {
    const t = getTable('murkrow_shadow', 'great', false);
    for (const e of [t.best, t.worst, t.all[100]]) {
      expect(e.atk).toBeCloseTo(e.statAtk * SHADOW_ATK_MULT, 10);
    }
    // The band the CMP test reads is the stat band, not the damage one.
    expect(t.statAtkLo).toBeCloseTo(t.atkLo / SHADOW_ATK_MULT, 10);
    expect(t.statAtkHi).toBeCloseTo(t.atkHi / SHADOW_ATK_MULT, 10);
    const plain = getTable('murkrow', 'great', false);
    expect(t.statAtkLo).toBeCloseTo(plain.statAtkLo, 10);
    expect(t.statAtkHi).toBeCloseTo(plain.statAtkHi, 10);
  });
});

describe('a mon and its Shadow are contested identically', () => {
  it('Zapdos reports the same CMP verdict for Murkrow and Shadow Murkrow', () => {
    // The reported case. Before the fix the plain form read "CMP contested"
    // and the Shadow did not, purely because 141.37 x 1.2 = 169.64 fell
    // outside Zapdos' reachable band of 133.06..143.21.
    const rows = rankedOpponents('zapdos', 'great', 0, 'either', 999);
    const plain = rows.find((r) => r.info.id === 'murkrow');
    const shadow = rows.find((r) => r.info.id === 'murkrow_shadow');
    expect(plain, 'murkrow missing from the scan').toBeTruthy();
    expect(shadow, 'murkrow_shadow missing from the scan').toBeTruthy();
    expect(shadow!.cmpContested).toBe(plain!.cmpContested);
    expect(shadow!.cmpCost).toBe(plain!.cmpCost);
    // The Shadow still hits harder, so the rest of the matchup may differ —
    // only the priority verdict has to agree.
    expect(shadow!.info.atk).toBeGreaterThan(plain!.info.atk);
  }, 120000);

  it('holds across the pool, not just for the one that was noticed', () => {
    const rows = rankedOpponents('zapdos', 'great', 0, 'either', 999);
    const by = new Map(rows.map((r) => [r.info.id, r]));
    let pairs = 0;
    for (const [id, r] of by) {
      if (!id.endsWith('_shadow')) continue;
      const plain = by.get(id.replace(/_shadow$/, ''));
      if (!plain) continue;
      pairs++;
      expect(r.cmpContested, `${id} vs its plain form`).toBe(plain.cmpContested);
    }
    expect(pairs).toBeGreaterThan(10);
  }, 120000);
});

describe('what still counts toward priority', () => {
  it('mkBattleMon carries the stat, and falls back to atk when there is none', () => {
    const sp = speciesOf('murkrow')!;
    const mv = movesFor(sp, 'great');
    const withStat = mkBattleMon(bestSpreadFor('murkrow_shadow', 'great', true), mv.fast, mv.charges, sp.types);
    expect(withStat.cmpAtk).toBeCloseTo(withStat.atk / SHADOW_ATK_MULT, 10);
    // A hand-built entry with no Shadow component: the two are the same number.
    const bare = mkBattleMon({ atk: 120, def: 100, hp: 150 }, mv.fast, mv.charges, sp.types);
    expect(bare.cmpAtk).toBe(120);
  });

  it('a Shadow does not win priority it would otherwise lose', () => {
    // The substance of the bug in one assertion: against an opponent whose
    // attack sits between the two, the Shadow used to take priority and the
    // plain form did not.
    const plain = bestSpreadFor('murkrow', 'great', true);
    const shadow = bestSpreadFor('murkrow_shadow', 'great', true);
    const between = (plain.statAtk + shadow.atk) / 2;
    expect(between).toBeGreaterThan(plain.statAtk);
    expect(between).toBeLessThan(shadow.atk);
    // Judged on the stat, both lose to it; judged on damage attack, the
    // Shadow would have beaten it.
    expect(plain.statAtk < between).toBe(true);
    expect(shadow.statAtk < between).toBe(true);
    expect(shadow.atk > between).toBe(true);
  });
});
