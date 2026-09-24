import { describe, expect, it } from 'vitest';
import { pvpokeBattle } from '../pvpoke';
import { loadPvPokeLazy } from '../pvpokeApp';

describe('option A, PvPoke engine as the app loads it', () => {
  it('reproduces the first battle of the parity fixture', async () => {
    // data-src/pvpoke-sweep-1500.json: Melmetal vs Altaria at 0 shields,
    // PvPoke's default IVs, ends 3 / 0.
    const pv = await loadPvPokeLazy();
    const r = pvpokeBattle(pv, 1500,
      { ref: 'melmetal', iv: { a: 4, d: 10, s: 14 }, lvl: 15.5, fast: 'THUNDER_SHOCK', charges: ['DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH'], shields: 0 },
      { ref: 'altaria', iv: { a: 4, d: 12, s: 13 }, lvl: 28.5, fast: 'DRAGON_BREATH', charges: ['MOONBLAST', 'FLAMETHROWER'], shields: 0 });
    expect([r.hpA, r.hpB]).toEqual([3, 0]);
    expect(r.log.at(-1)).toMatchObject({ hpA: 3, hpB: 0 });
  });
});
