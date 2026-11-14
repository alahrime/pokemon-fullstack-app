import { describe, it, expect } from 'vitest';
import { dmg, getTable, statText, thresholdLadders } from '../engine';
import { SPECIES_BY_ID } from '../data';
import { stepsCleared } from '../../screens/detail/FloorThresholds';

// Against the real table: a floor at a step's `from` guarantees that step's damage
// for every spread it keeps, and the stat group just below it does not.
describe('thresholdLadders', () => {
  for (const [ref, kind] of [['medicham', 'break'], ['azumarill', 'bulk'], ['registeel_shadow', 'break']] as const) {
    it(`${ref} ${kind} steps are exactly what a floor guarantees`, () => {
      const table = getTable(ref, 'great');
      const sp = SPECIES_BY_ID.get(ref.replace('_shadow', ''))!;
      const move = sp.fastMoves[0];
      const { rows } = thresholdLadders(ref, 'great', 0, kind);
      expect(rows.length).toBeGreaterThan(0);
      const stat = (e: (typeof table.all)[number]) => Number(statText(kind === 'break' ? e.statAtk : e.statDef));
      for (const r of rows.slice(0, 20)) {
        const d = (e: (typeof table.all)[number]) =>
          kind === 'break' ? dmg(e.atk, r.info.def, move, r.info.types) : dmg(r.info.atk, e.def, r.info.fastMove, sp.types);
        const worst = (v: number) => {
          const kept = table.all.filter((e) => stat(e) >= v).map(d);
          return kind === 'break' ? Math.min(...kept) : Math.max(...kept);
        };
        r.steps.forEach((s, i) => {
          expect(worst(s.from)).toBe(s.dmg);
          if (i > 0) expect(worst(Math.max(...table.all.map(stat).filter((t) => t < s.from)))).not.toBe(s.dmg);
        });
        expect(stepsCleared(r, r.steps[0].from)).toBe(0);
        expect(stepsCleared(r, r.steps.at(-1)!.from)).toBe(r.steps.length - 1);
      }
    });
  }
});
