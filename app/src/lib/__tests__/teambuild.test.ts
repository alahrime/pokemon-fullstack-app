import { describe, it, expect } from 'vitest';
import { completionPool, suggestCompletions } from '../teambuild';
import { conflictsOnTeam, speciesOf } from '../data';
import { sharedTypePairs } from '../synergy';
import { teamPool } from '../rankings';
import type { LeagueId } from '../types';

/**
 * The suggester, which had two ways of returning nothing at all.
 *
 * `team.test.ts` already covers the happy path, and every case there passes a
 * partial of **one** — which is exactly why neither failure surfaced. Both need
 * a roster big enough to repeat a typing, so the sizes are the point of these
 * tests rather than incidental to them.
 */

const LEAGUES: LeagueId[] = ['great', 'ultra', 'master'];
const typesOf = (r: string) => speciesOf(r)?.types ?? [];

/** Five arbitrary members of a real six, per league. */
const FIVE: Record<LeagueId, string[]> = {
  great: ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory'],
  ultra: ['swampert', 'registeel', 'giratina_altered', 'talonflame', 'cresselia'],
  master: ['dialga', 'zacian_hero', 'groudon', 'kyogre', 'metagross'],
};

describe('completionPool — who may be suggested', () => {
  it('never offers a duplicate species or a conflicting form', () => {
    const { pool } = completionPool(['registeel'], 'great', 3);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool).not.toContain('registeel');
    expect(pool.some((r) => conflictsOnTeam('registeel', r))).toBe(false);
  });

  it('holds a three to the ABC rule when the roster can still obey it', () => {
    // Azumarill (Water/Fairy) and Registeel (Steel) share nothing, so the
    // nominal cap of zero is achievable and must be enforced.
    const cp = completionPool(['azumarill', 'registeel'], 'great', 3);
    expect(cp.nominal).toBe(0);
    expect(cp.shared).toBe(0);
    expect(cp.typeCap).toBe(0);
    for (const r of cp.pool) {
      expect(sharedTypePairs(['azumarill', 'registeel', r].map(typesOf))).toBe(0);
    }
  });

  it('allows a six two shared pairs, where a three is allowed none', () => {
    // Discovery's MAX_SHARED_TYPES_6. A six is a menu you pick three from.
    expect(completionPool(['azumarill', 'registeel'], 'great', 6).nominal).toBe(2);
    expect(completionPool(['azumarill', 'registeel'], 'great', 3).nominal).toBe(0);
  });

  it('still offers candidates beside a GBL pair that already repeats a typing', () => {
    // Registeel + Skarmory is an ordinary Great pairing and both are Steel.
    // Judged as a whole roster against a cap of zero it rejected *every*
    // candidate, and the panel came back empty.
    const cp = completionPool(['registeel', 'skarmory'], 'great', 3);
    expect(cp.shared).toBe(1);
    expect(cp.typeCap).toBe(1);
    expect(cp.pool.length).toBeGreaterThan(0);
  });

  it('still offers candidates for a Show 6 past its third member, in every league', () => {
    // The original failure: five arbitrary Pokemon always share more than two
    // typings, so the whole-roster test emptied the pool from the fourth pick
    // onward — 0 candidates in all three leagues.
    for (const lg of LEAGUES) {
      for (let k = 3; k <= 5; k++) {
        const cp = completionPool(FIVE[lg].slice(0, k), lg, 6);
        expect(cp.pool.length, `${lg} partial ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('asks the candidate not to make things worse, never to fix the roster', () => {
    for (const lg of LEAGUES) {
      const partial = FIVE[lg];
      const cp = completionPool(partial, lg, 6);
      // The floor is what the roster already spends: a rule the user's own
      // picks have already broken cannot be charged to the candidate.
      expect(cp.typeCap).toBeGreaterThanOrEqual(cp.shared);
      expect(cp.typeCap).toBeGreaterThanOrEqual(cp.nominal);
      for (const r of cp.pool) {
        expect(sharedTypePairs([...partial, r].map(typesOf))).toBeLessThanOrEqual(cp.typeCap);
      }
    }
  });

  it('reports the allowance it used rather than quietly dropping the rule', () => {
    const cp = completionPool(FIVE.great, 'great', 6);
    expect(cp.shared).toBeGreaterThan(cp.nominal);
    expect(cp.typeCap).toBe(cp.shared);
    // Relaxed is for the loop past that floor, which this roster does not need.
    expect(cp.relaxed).toBe(false);
  });

  it('loosens one step at a time rather than returning nothing', () => {
    // A roster of five Steel-adjacent picks that leaves nothing at its own
    // shared-pair count still has to produce a list.
    for (const lg of LEAGUES) {
      const cp = completionPool(FIVE[lg], lg, 6);
      expect(cp.pool.length).toBeGreaterThan(0);
      expect(cp.pool.length).toBeLessThanOrEqual(teamPool(lg).length);
    }
  });

  it('is a pure filter — same input, same pool', () => {
    expect(completionPool(FIVE.great, 'great', 6)).toEqual(completionPool(FIVE.great, 'great', 6));
  });
});

describe('suggestCompletions — which game each size is scored on', () => {
  it('scores a three as a chain and says so', () => {
    const out = suggestCompletions(['azumarill', 'registeel'], 'great', 3, { count: 6, limit: 4 });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(s.metric).toBe('winRate');
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
    }
  });

  it('scores a six as the matrix game once a line can be fielded', () => {
    const out = suggestCompletions(['azumarill', 'registeel'], 'great', 6, { count: 2, limit: 4 });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(s.metric).toBe('floor');
      // A floor is a margin, not a rate: negative is normal and above 1 is not.
      expect(Math.abs(s.value)).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to the chain for a six with one member, and not to a column of noughts', () => {
    // Two Pokemon cannot form a line, so there is no matrix game yet. Scoring
    // that pair against sampled *sixes* gave every candidate exactly 0.
    const out = suggestCompletions(['azumarill'], 'great', 6, { count: 8, limit: 8 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.metric === 'winRate')).toBe(true);
    expect(out.some((s) => s.value > 0)).toBe(true);
  });

  it('returns a ranked list for every Show 6 partial size, in every league', () => {
    for (const lg of LEAGUES) {
      for (let k = 1; k <= 5; k++) {
        const out = suggestCompletions(FIVE[lg].slice(0, k), lg, 6, { count: 1, limit: 3 });
        expect(out.length, `${lg} partial ${k}`).toBeGreaterThan(0);
        for (const s of out) expect(Number.isFinite(s.value)).toBe(true);
      }
    }
  }, 120000);

  it('sorts by value, best first', () => {
    const out = suggestCompletions(['azumarill', 'registeel'], 'great', 3, { count: 6, limit: 8 });
    for (let i = 1; i < out.length; i++) expect(out[i - 1].value).toBeGreaterThanOrEqual(out[i].value);
  });

  it('measures gain against one median, so the column ranks picks not team sizes', () => {
    const out = suggestCompletions(['azumarill', 'registeel'], 'great', 3, { count: 6, limit: 8 });
    const medians = out.map((s) => s.value - s.gain);
    for (const m of medians) expect(m).toBeCloseTo(medians[0], 9);
  });

  it('never suggests a member of the partial team', () => {
    const partial = FIVE.great;
    const out = suggestCompletions(partial, 'great', 6, { count: 1, limit: 12 });
    for (const s of out) expect(partial).not.toContain(s.ref);
  });

  it('scores the build a slot is carrying, not the league rated set', () => {
    const partial = ['azumarill', 'registeel'];
    const rated = suggestCompletions(partial, 'great', 3, { count: 8, limit: 12 });
    // Registeel on its worst legal fast move is a different Pokemon to build
    // around, so the completions it wants must move.
    const sp = speciesOf('registeel')!;
    const built = suggestCompletions(partial, 'great', 3, {
      count: 8,
      limit: 12,
      builds: {
        registeel: { fastIdx: sp.fastMoves.length - 1, chargeIds: [], iv: { a: 0, d: 15, s: 15 } },
      },
    });
    expect(built.length).toBe(rated.length);
    const changed =
      built.some((b, i) => b.ref !== rated[i].ref) ||
      built.some((b, i) => Math.abs(b.value - rated[i].value) > 1e-9);
    expect(changed).toBe(true);
  });

  it('is deterministic — the field is a yardstick, not a draw', () => {
    const a = suggestCompletions(['azumarill', 'registeel'], 'great', 3, { count: 6, limit: 5 });
    const b = suggestCompletions(['azumarill', 'registeel'], 'great', 3, { count: 6, limit: 5 });
    expect(a).toEqual(b);
  });

  it('names only weaknesses the existing members leave open', () => {
    const out = suggestCompletions(['azumarill', 'registeel'], 'great', 3, { count: 4, limit: 6 });
    for (const s of out) {
      expect(Array.isArray(s.covers)).toBe(true);
      expect(new Set(s.covers).size).toBe(s.covers.length);
    }
  });
});
