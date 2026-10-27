import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GblBattle, GblSet } from '../gbl';

/** gbl_battles as the database keeps it, refusing a second battle at one (set_id, idx) as `unique (set_id, idx)` does. */
const rows = vi.hoisted(() => new Map<string, { set_id: string; idx: number }>());
vi.mock('../supabase', () => {
  const clash = (setId: string, idx: number, self?: string) =>
    [...rows].some(([id, r]) => id !== self && r.set_id === setId && r.idx === idx);
  const fail = { data: null, error: { message: 'duplicate key value violates unique constraint "gbl_battles_set_id_idx_key"' } };
  return {
    supabase: {
      from: () => ({
        delete: () => ({ eq: async (_: string, id: string) => { rows.delete(id); return { data: null, error: null }; } }),
        update: ({ idx }: { idx: number }) => ({
          eq: async (_: string, id: string) => {
            const r = rows.get(id)!;
            if (clash(r.set_id, idx, id)) return fail;
            r.idx = idx;
            return { data: null, error: null };
          },
        }),
        insert: (row: { set_id: string; idx: number; result: string | null; opponents: string[]; played_at?: string }) => ({
          select: () => ({
            single: async () => {
              if (clash(row.set_id, row.idx)) return fail;
              const id = `new${rows.size}`;
              rows.set(id, { set_id: row.set_id, idx: row.idx });
              return { data: { id, idx: row.idx, result: row.result, opponents: row.opponents, played_at: row.played_at ?? '' }, error: null };
            },
          }),
        }),
      }),
    },
  };
});

import { removeBattle, restoreBattle } from '../gbl';

const battle = (i: number): GblBattle => ({ id: `b${i}`, idx: i, result: 'win', opponents: [`mon${i}`], opponentMoves: [{ fast: null, charges: [] }], note: null, playedAt: `t${i}` });
const set = (battles: GblBattle[]): GblSet => ({ id: 's', accountId: null, season: 28, format: 'great', team: [], eloStart: null, eloEnd: null, startedAt: 't', battles });
const stored = () => [...rows].map(([id, r]) => [id, r.idx]).sort((a, b) => Number(a[1]) - Number(b[1]));

beforeEach(() => {
  rows.clear();
  for (let i = 1; i <= 5; i++) rows.set(`b${i}`, { set_id: 's', idx: i });
});

describe('deleting from the middle of a set, and putting it back', () => {
  it('closes the gap without ever holding two battles at one number', async () => {
    const rest = await removeBattle(set([1, 2, 3, 4, 5].map(battle)), battle(2));
    expect(rest.map((b) => [b.id, b.idx])).toEqual([['b1', 1], ['b3', 2], ['b4', 3], ['b5', 4]]);
    expect(stored()).toEqual([['b1', 1], ['b3', 2], ['b4', 3], ['b5', 4]]);
  });

  it('restores it to its place, moving the later ones back from the end', async () => {
    const rest = await removeBattle(set([1, 2, 3, 4, 5].map(battle)), battle(2));
    const back = await restoreBattle(set(rest), battle(2));
    expect(back.map((b) => [b.opponents[0], b.idx])).toEqual([['mon1', 1], ['mon2', 2], ['mon3', 3], ['mon4', 4], ['mon5', 5]]);
    expect(back[1].playedAt).toBe('t2');
    expect(stored().map((r) => r[1])).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles the first and the last battle', async () => {
    let rest = await removeBattle(set([1, 2, 3, 4, 5].map(battle)), battle(5));
    expect(rest.map((b) => b.idx)).toEqual([1, 2, 3, 4]);
    rest = await restoreBattle(set(rest), battle(5));
    rest = await removeBattle(set(rest), rest[0]);
    expect(rest.map((b) => [b.opponents[0], b.idx])).toEqual([['mon2', 1], ['mon3', 2], ['mon4', 3], ['mon5', 4]]);
    rest = await restoreBattle(set(rest), battle(1));
    expect(rest.map((b) => b.opponents[0])).toEqual(['mon1', 'mon2', 'mon3', 'mon4', 'mon5']);
  });
});
