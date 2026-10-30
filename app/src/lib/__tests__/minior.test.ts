import { describe, it, expect } from 'vitest';
import { ratedEntry, resolve } from '../battleMatrix';
import { battle } from '../engine';

// PvPoke's Minior: the released entry is Core, every battle starts it as Meteor (bulky), and it breaks open into Core
// (attack-weighted) once a hit leaves it under half HP.
describe('Minior', () => {
  for (const L of ['great', 'ultra'] as const) {
    it(`in ${L}, Meteor trades attack for bulk and Core takes it back`, () => {
      const by = resolve(ratedEntry('minior_core', L), L).mon.forms!.by;
      expect(by.minior_meteor.def).toBeGreaterThan(by.minior_core.def);
      expect(by.minior_meteor.atk).toBeLessThan(by.minior_core.atk);
    });

    it(`in ${L}, hits as Meteor until under half HP, then as Core`, () => {
      const m = resolve(ratedEntry('minior_core', L), L);
      const foe = resolve(ratedEntry(L === 'great' ? 'azumarill' : 'registeel', L), L);
      const r = battle(m.mon, foe.mon, 0, 0, 0, 0, true);
      const fast = r.log.filter((e) => e.actor === 'A' && e.kind === 'fast');
      // The HP each hit was thrown at is the HP left after the previous log line.
      const before = (i: number) => r.log[r.log.indexOf(fast[i]) - 1]?.hpA ?? m.mon.hp;
      const meteor = fast.filter((_, i) => before(i) / m.mon.hp >= 0.5).map((e) => e.damage);
      const core = fast.filter((_, i) => before(i) / m.mon.hp < 0.5).map((e) => e.damage);
      expect(meteor.length).toBeGreaterThan(0);
      expect(core.length).toBeGreaterThan(0);
      expect(Math.min(...core)).toBeGreaterThan(Math.max(...meteor));
    });
  }
});
