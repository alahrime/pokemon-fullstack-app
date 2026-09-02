import { describe, it, expect } from 'vitest';
import { encodeMember, decodeMember } from '../teamCodec';
import { speciesOf } from '../data';
import { defaultSpreadFor } from '../engine';

/**
 * The index/id conversion, which is the whole reason this module exists.
 * `species.json` is generated, so a stored fastIdx would silently repoint at a
 * different move the next time the data is rebuilt.
 */
describe('team member codec', () => {
  const ref = 'registeel';
  const fastMoves = speciesOf(ref)!.fastMoves;

  it('stores the fast move id, not the index', () => {
    const stored = encodeMember({ ref, chargeIds: [], fastIdx: 1, iv: { a: 0, d: 14, s: 15 } }, 'great');
    expect(stored.fast_move).toBe(fastMoves[1].id);
    expect(Object.values(stored)).not.toContain(1);
  });

  it('round-trips a member back to the same choice', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST'], fastIdx: 0, iv: { a: 2, d: 15, s: 13 } };
    const { choice: back, unknownMove } = decodeMember(encodeMember(choice, 'great'));
    expect(back).toEqual(choice);
    expect(unknownMove).toBeNull();
  });

  it('records the level the engine derives, rather than leaving it null', () => {
    const stored = encodeMember({ ref, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 14, s: 15 } }, 'great');
    expect(stored.level).toBeGreaterThan(1);
    expect(stored.level).toBeLessThanOrEqual(51);
  });

  /**
   * The failure this design exists to make loud. A move that has left the data
   * must not resolve to whatever now sits at that index.
   */
  it('reports a fast move that no longer exists instead of silently picking another', () => {
    const { choice, unknownMove } = decodeMember({
      ref, fast_move: 'MOVE_THAT_WAS_REMOVED', charge_moves: [],
      iv_attack: 0, iv_defense: 14, iv_stamina: 15, level: 41.5,
    });
    expect(unknownMove).toBe('MOVE_THAT_WAS_REMOVED');
    expect(choice.fastIdx).toBe(0);
  });

  it('reports an unknown ref rather than throwing', () => {
    const { choice, unknownMove } = decodeMember({
      ref: 'not_a_pokemon', fast_move: 'BULLET_PUNCH', charge_moves: [],
      iv_attack: 0, iv_defense: 0, iv_stamina: 0, level: null,
    });
    expect(unknownMove).toBe('BULLET_PUNCH');
    expect(choice.ref).toBe('not_a_pokemon');
  });

  /**
   * The stored level has to be derived from the SAME table the spread came
   * from, and every producer of a choice on the team path reads the best-buddy
   * one: `defaultSpreadFor(ref, league, true)` in the builder's `defaultChoice`
   * and in the add modal, `bestSpreadFor(ref, league, true)` beside it. Reading
   * the other table records a level for IVs that were never chosen against it —
   * half a level out in Great, a full level in Ultra.
   *
   * The column exists to detect a level that MOVED after a data rebuild. A
   * baseline that disagrees with the builder on the day it was written cannot
   * do that: every roster looks like it has already drifted.
   *
   * `getTable` applies eligibility itself (`levelCapIdx` honours both the flag
   * and `bestBuddyEligible`), which is why none of those callers guard it and
   * this one must not either.
   */
  it.each([
    ['great' as const, 'medicham'],
    ['ultra' as const, 'skarmory'],
  ])('records the level against the same table the builder drew the spread from (%s, %s)', (league, ref) => {
    const spread = defaultSpreadFor(ref, league, true);
    const stored = encodeMember(
      { ref, chargeIds: [], fastIdx: 0, iv: { a: spread.a, d: spread.d, s: spread.s } },
      league,
    );
    expect(stored.level).toBe(spread.lvl);
  });

  it('still records a level for a species best buddy cannot lift', () => {
    // Not every species reaches past 50, and the table caps rather than
    // refusing. The flag must not turn an ordinary member's level into null.
    const spread = defaultSpreadFor('bastiodon', 'great', true);
    const stored = encodeMember(
      { ref: 'bastiodon', chargeIds: [], fastIdx: 0, iv: { a: spread.a, d: spread.d, s: spread.s } },
      'great',
    );
    expect(stored.level).toBe(spread.lvl);
  });

  it('keeps both charge moves in order', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST', 'FLASH_CANNON'], fastIdx: 0, iv: { a: 0, d: 0, s: 0 } };
    expect(encodeMember(choice, 'great').charge_moves).toEqual(['FOCUS_BLAST', 'FLASH_CANNON']);
  });
});
