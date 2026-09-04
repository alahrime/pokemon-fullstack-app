import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FRIEND_CODE_PATTERN, normalizeFriendCode } from '../friendCode';

/**
 * The friend code: twelve digits, and the one field on the account that an
 * opponent is ever shown.
 *
 * `normalizeFriendCode` is separated from the screen because it is the same
 * rule the database check constraint spells in SQL
 * (`20260904..._friend_codes_are_twelve_digits.sql`). Two spellings of one rule
 * can drift, so the last test in the first block asserts they agree on every
 * case below rather than trusting that they do.
 */
describe('normalizeFriendCode', () => {
  it('accepts twelve bare digits and groups them in fours', () => {
    expect(normalizeFriendCode('123456789012')).toBe('1234 5678 9012');
  });

  it('accepts the spacing Pokémon GO itself shows', () => {
    expect(normalizeFriendCode('1234 5678 9012')).toBe('1234 5678 9012');
  });

  it('accepts the separators people paste', () => {
    expect(normalizeFriendCode('1234-5678-9012')).toBe('1234 5678 9012');
    expect(normalizeFriendCode('  1234\t5678  9012  ')).toBe('1234 5678 9012');
  });

  it('rejects the wrong number of digits', () => {
    expect(normalizeFriendCode('12345678901')).toBeNull();
    expect(normalizeFriendCode('1234567890123')).toBeNull();
    expect(normalizeFriendCode('')).toBeNull();
  });

  /**
   * A trainer NAME is not a friend code, and letters are the way that mistake
   * arrives. Stripping non-digits and counting what is left would silently
   * accept `abc123456789012xyz`; this asserts it does not.
   */
  it('rejects anything that is not digits and separators', () => {
    expect(normalizeFriendCode('1234 5678 901a')).toBeNull();
    expect(normalizeFriendCode('habibi2')).toBeNull();
    expect(normalizeFriendCode('+1 234 567 89012')).toBeNull();
  });

  it('produces only what the database constraint accepts', () => {
    for (const raw of ['123456789012', '1234-5678-9012', '0000 0000 0000']) {
      const code = normalizeFriendCode(raw);
      expect(code).not.toBeNull();
      expect(FRIEND_CODE_PATTERN.test(code!)).toBe(true);
    }
  });
});

/**
 * The two database calls. Mocked at the package boundary the way
 * `matchmaking.test.ts` and `saves.test.ts` do — the point of these is the
 * shape of the request, since RLS decides the rest and is proved against real
 * Postgres, not here.
 */
const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

function harness(rows: unknown[] = [], error: { code?: string; message: string } | null = null, meId: string | null = 'me') {
  const calls: { op: string; payload?: unknown }[] = [];
  const q: Record<string, unknown> = {
    select: vi.fn((cols?: unknown) => { calls.push({ op: 'select', payload: cols }); return q; }),
    eq: vi.fn((col: string, val: unknown) => { calls.push({ op: 'eq', payload: [col, val] }); return q; }),
    upsert: vi.fn((payload: unknown, opts?: unknown) => { calls.push({ op: 'upsert', payload: [payload, opts] }); return q; }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(res),
  };
  pkg.client = {
    from: vi.fn((table: string) => { calls.push({ op: 'from', payload: table }); return q; }),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: meId ? { user: { id: meId } } : null }, error: null })),
    },
  };
  return calls;
}

beforeEach(() => vi.resetModules());

describe('myFriendCode', () => {
  it('reads the signed-in account’s own row', async () => {
    const calls = harness([{ code: '1234 5678 9012' }]);
    const { myFriendCode } = await import('../friendCode');
    expect(await myFriendCode()).toBe('1234 5678 9012');
    expect(calls).toContainEqual({ op: 'from', payload: 'friend_codes' });
    expect(calls).toContainEqual({ op: 'eq', payload: ['profile_id', 'me'] });
  });

  /** No code on file is the ordinary state of a new account, not an error. */
  it('is null when nothing is on file', async () => {
    harness([]);
    const { myFriendCode } = await import('../friendCode');
    expect(await myFriendCode()).toBeNull();
  });

  it('is null when nobody is signed in, without asking the database', async () => {
    const calls = harness([], null, null);
    const { myFriendCode } = await import('../friendCode');
    expect(await myFriendCode()).toBeNull();
    expect(calls.some((c) => c.op === 'from')).toBe(false);
  });

  it('throws what the database said rather than reporting no code', async () => {
    harness([], { message: 'JWT expired' });
    const { myFriendCode } = await import('../friendCode');
    await expect(myFriendCode()).rejects.toThrow('JWT expired');
  });
});

describe('saveFriendCode', () => {
  it('upserts the normalized code against the signed-in id', async () => {
    const calls = harness([]);
    const { saveFriendCode } = await import('../friendCode');
    await saveFriendCode('1234-5678-9012');
    const upsert = calls.find((c) => c.op === 'upsert');
    const [payload, opts] = upsert!.payload as [Record<string, unknown>, Record<string, unknown>];
    expect(payload.profile_id).toBe('me');
    expect(payload.code).toBe('1234 5678 9012');
    expect(opts.onConflict).toBe('profile_id');
  });

  /**
   * The screen validates before calling this, so a bad code arriving here is a
   * bug in a caller. It must not reach the database and be refused as a check
   * violation somebody then has to translate back into a sentence.
   */
  it('refuses a code the constraint would reject, without a round trip', async () => {
    const calls = harness([]);
    const { saveFriendCode } = await import('../friendCode');
    await expect(saveFriendCode('nope')).rejects.toThrow(/twelve digits/i);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('throws when nobody is signed in', async () => {
    harness([], null, null);
    const { saveFriendCode } = await import('../friendCode');
    await expect(saveFriendCode('123456789012')).rejects.toThrow(/signed in/i);
  });

  it('throws what the database said', async () => {
    harness([], { message: 'new row violates row-level security policy' });
    const { saveFriendCode } = await import('../friendCode');
    await expect(saveFriendCode('123456789012')).rejects.toThrow(/row-level security/);
  });
});
