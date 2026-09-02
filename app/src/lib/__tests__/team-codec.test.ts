import { describe, it, expect } from 'vitest';
import { encodeMember, decodeMember } from '../teamCodec';
import { speciesOf } from '../data';

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

  it('keeps both charge moves in order', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST', 'FLASH_CANNON'], fastIdx: 0, iv: { a: 0, d: 0, s: 0 } };
    expect(encodeMember(choice, 'great').charge_moves).toEqual(['FOCUS_BLAST', 'FLASH_CANNON']);
  });
});
