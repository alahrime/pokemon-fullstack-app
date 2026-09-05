import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toMatchTerms, toMyTerms } from '../matches';

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

/**
 * Copied from `matchmaking.test.ts`'s harness, trimmed to what `myMatches`
 * itself touches: a `matches` table read and `auth.getSession`. `meId: null`
 * stands in for a signed-out caller, or one whose session lookup came back
 * empty — the case `myMatches` must refuse to map rather than silently
 * seat as player_b (see the "returns no matches, not a fabricated seat" test
 * below).
 */
function harness(rows: Record<string, unknown[]>, meId: string | null = 'me') {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  function table(name: string) {
    const q: Record<string, unknown> = {
      select: vi.fn((cols?: unknown) => { calls.push({ table: name, op: 'select', payload: cols }); return q; }),
      eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
      order: vi.fn((col: string, opts?: unknown) => { calls.push({ table: name, op: 'order', payload: [col, opts] }); return q; }),
      maybeSingle: vi.fn(async () => ({ data: rows[name]?.[0] ?? null, error: null })),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[name] ?? [], error: null }).then(res),
    };
    return q;
  }
  pkg.client = {
    from: vi.fn((n: string) => table(n)),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: meId ? { user: { id: meId } } : null }, error: null })),
    },
  };
  return { calls };
}

beforeEach(() => vi.resetModules());

describe('myMatches with no session', () => {
  /**
   * Pins Finding 1: `toMatch` resolves `mySide` with
   * `r.player_a === me ? 'a' : 'b'` and has no guard of its own — an
   * undefined `me` resolves to `'b'` for every row, silently inverting whose
   * round wins are whose once that seat feeds `toMatchTerms`. The RLS policy
   * on `matches` is what makes an unauthenticated `select` come back `[]` in
   * production, but this test does not rely on that: the harness returns a
   * real row for a null session, so this only passes if `myMatches` itself
   * refuses to map when it has no session id.
   */
  it('returns no matches rather than a fabricated seat, when there is no session', async () => {
    const { calls } = harness(
      {
        matches: [
          {
            id: 'm1', player_a: 'them', player_b: 'them2', format_version_id: 'v1', rules_hash: 'h1',
            data_rev: 'r1', rounds: 3, state: 'confirmed', rating_counted: true,
            amend_deadline: null, source: 'queue', created_at: '2026-09-02T12:00:00Z',
          },
        ],
      },
      null,
    );
    const { myMatches } = await import('../matches');
    expect(await myMatches()).toEqual([]);
    expect(calls.some((c) => c.table === 'matches' && c.op === 'select')).toBe(false);
  });
});

describe('perspective conversion', () => {
  it('converts what I claim into match terms, from either seat', () => {
    expect(toMatchTerms([true, false, true], 'a')).toEqual(['a', 'b', 'a']);
    expect(toMatchTerms([true, false, true], 'b')).toEqual(['b', 'a', 'b']);
  });

  it('round-trips from both seats', () => {
    const claim = [true, true, false, false, true];
    for (const side of ['a', 'b'] as const) {
      expect(toMyTerms(toMatchTerms(claim, side), side)).toEqual(claim);
    }
  });

  it('reads the same stored array oppositely for the two players', () => {
    const stored = ['a', 'b', 'a'] as const;
    expect(toMyTerms([...stored], 'a')).toEqual([true, false, true]);
    expect(toMyTerms([...stored], 'b')).toEqual([false, true, false]);
  });
});
