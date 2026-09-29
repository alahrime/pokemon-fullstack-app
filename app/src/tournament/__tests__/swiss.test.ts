import { describe, it, expect } from 'vitest';
import { defaultRounds, pairSwiss, standings, type Game } from '../swiss';

const g = (round: number, a: string, b: string | null, scoreA: number, scoreB: number): Game =>
  ({ round, a, b, scoreA, scoreB });
const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

describe('defaultRounds', () => {
  it('is ceil(log2 N), at least 1', () => {
    expect(defaultRounds(2)).toBe(1);
    expect(defaultRounds(8)).toBe(3);
    expect(defaultRounds(9)).toBe(4);
    expect(defaultRounds(26)).toBe(5);
    expect(defaultRounds(1)).toBe(1);
  });
});

describe('standings', () => {
  it('ranks by match wins, then opponent match-win %, then game-win %', () => {
    const games = [g(1, 'a', 'b', 2, 0), g(1, 'c', 'd', 2, 1), g(2, 'a', 'c', 2, 0), g(2, 'b', 'd', 0, 2)];
    const s = standings(['a', 'b', 'c', 'd'], games);
    // a is 2-0. c and d are both 1-1, but c's opponents (d at 1/2, a at 1) average
    // 0.75 OMW against d's (c at 1/2, b floored at 1/3) 0.417, so c ranks above d.
    expect(s.map((x) => x.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(s[0]).toMatchObject({ matchWins: 2, matches: 2, gameWins: 4, gameLosses: 0 });
  });
  it('counts a bye as a win and a 2-0 for the player, but not toward anyone\'s OMW', () => {
    const s = standings(['a', 'b', 'c'], [g(1, 'a', null, 2, 0), g(1, 'b', 'c', 2, 0)]);
    const a = s.find((x) => x.id === 'a')!;
    expect(a).toMatchObject({ matchWins: 1, gameWins: 2, hadBye: true, opponents: [] });
    expect(a.omw).toBeCloseTo(1 / 3);
  });
  it('floors OMW and GWP at one third', () => {
    const s = standings(['a', 'b'], [g(1, 'a', 'b', 2, 0)]);
    const b = s.find((x) => x.id === 'b')!;
    expect(b.gwp).toBeCloseTo(1 / 3);
    expect(b.omw).toBeGreaterThanOrEqual(1 / 3);
  });
  it('a 0-0 double loss gives nobody a match win', () => {
    const s = standings(['a', 'b'], [g(1, 'a', 'b', 0, 0)]);
    expect(s.every((x) => x.matchWins === 0 && x.matches === 1)).toBe(true);
  });
  it('breaks a full tie by head-to-head, then by id, deterministically', () => {
    const games = [g(1, 'a', 'b', 2, 1), g(1, 'c', 'd', 2, 1), g(2, 'a', 'c', 1, 2), g(2, 'b', 'd', 2, 1)];
    const first = standings(['a', 'b', 'c', 'd'], games).map((x) => x.id);
    const again = standings(['d', 'c', 'b', 'a'], games).map((x) => x.id);
    expect(first).toEqual(again);
  });
  it('ignores games naming players it was not given', () => {
    expect(() => standings(['a'], [g(1, 'a', 'zz', 2, 0)])).not.toThrow();
  });
});

describe('pairSwiss', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

  it('round 1 pairs everyone once, deterministically for a seed, differently across seeds', () => {
    const a = pairSwiss(ids(8), [], 'seed-1');
    const b = pairSwiss(ids(8), [], 'seed-1');
    const c = pairSwiss(ids(8), [], 'seed-2');
    expect(a).toEqual(b);
    expect(a.pairs).toHaveLength(4);
    expect(new Set(a.pairs.flatMap((p) => [p.a, p.b])).size).toBe(8);
    expect(JSON.stringify(a.pairs)).not.toBe(JSON.stringify(c.pairs));
    expect(a.rematches).toBe(0);
  });

  it('an odd field gets exactly one bye, given to a player who has not had one', () => {
    const r1 = pairSwiss(ids(5), [], 's');
    expect(r1.pairs.filter((p) => p.b === null)).toHaveLength(1);
    const byeR1 = r1.pairs.find((p) => p.b === null)!.a;
    const games: Game[] = r1.pairs.map((p) => (p.b === null ? g(1, p.a, null, 2, 0) : g(1, p.a, p.b, 2, 0)));
    const r2 = pairSwiss(ids(5), games, 's');
    const byeR2 = r2.pairs.find((p) => p.b === null)!.a;
    expect(byeR2).not.toBe(byeR1);
  });

  it('never repeats a pairing over a full Swiss when it is avoidable', () => {
    for (const n of [4, 6, 8, 10, 16]) {
      const players = ids(n);
      const games: Game[] = [];
      const played = new Set<string>();
      for (let round = 1; round <= defaultRounds(n); round++) {
        const { pairs, rematches } = pairSwiss(players, games, `t${n}`);
        expect(rematches).toBe(0);
        for (const p of pairs) {
          if (p.b === null) { games.push(g(round, p.a, null, 2, 0)); continue; }
          const k = key(p.a, p.b);
          expect(played.has(k)).toBe(false);
          played.add(k);
          games.push(g(round, p.a, p.b, round % 2 ? 2 : 0, round % 2 ? 0 : 2));
        }
      }
    }
  });

  it('pairs winners with winners: after round 1, the two unbeaten meet in a 4-player field', () => {
    const games = [g(1, 'p01', 'p02', 2, 0), g(1, 'p03', 'p04', 2, 1)];
    const { pairs } = pairSwiss(['p01', 'p02', 'p03', 'p04'], games, 's');
    const top = pairs.find((p) => [p.a, p.b].includes('p01'))!;
    expect([top.a, top.b].sort()).toEqual(['p01', 'p03']);
  });

  it('falls back to a rematch, and says how many, when no fresh pairing exists', () => {
    // three players, everyone has played everyone: the fallback must still pair the field
    const games = [g(1, 'a', 'b', 2, 0), g(2, 'b', 'c', 2, 0), g(3, 'a', 'c', 2, 0)];
    const r = pairSwiss(['a', 'b', 'c'], games, 's');
    expect(r.pairs.filter((p) => p.b !== null)).toHaveLength(1);
    expect(r.rematches).toBeGreaterThanOrEqual(1);
  });

  it('handles the empty and one-player fields', () => {
    expect(pairSwiss([], [], 's')).toEqual({ pairs: [], rematches: 0 });
    expect(pairSwiss(['a'], [], 's').pairs).toEqual([{ a: 'a', b: null }]);
  });
});
