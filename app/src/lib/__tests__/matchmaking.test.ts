import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RULES_SCHEMA, type Format } from '../../rules';

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

// No `as Format` cast: every required field is present, so the annotation alone
// type-checks. A cast here would hide the next real mismatch.
const FORMAT: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

/**
 * Copied from `saves.test.ts`. `errors` fails one table's writes the way
 * PostgREST does — a code plus the text it puts in `message`. `rpc` is new
 * here: `saves.ts` never called it, but `accept_offer`/`confirm_offer` are
 * functions, not table writes, so this module needs a recorder for them too.
 * `auth.getSession` is also new: `myMatches` has no `opponent_id` column to
 * read — a match row only has `player_a`/`player_b` — so the module has to
 * ask who is signed in to know which one is "me", and `leaveQueue` needs the
 * same id to filter its delete. `getSession` (a local read), not `getUser`
 * (a network round trip to the Auth server) — see `SessionContext.tsx`.
 * Defaults to a signed-in user id of 'me'; pass a different id, or `null` for
 * signed-out, to test the other cases.
 */
function harness(
  rows: Record<string, unknown[]>,
  errors: Record<string, { code: string; message: string }> = {},
  meId: string | null = 'me',
) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  function table(name: string) {
    const q: Record<string, unknown> = {
      select: vi.fn((cols?: unknown) => { calls.push({ table: name, op: 'select', payload: cols }); return q; }),
      eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
      // `myOffers` asks for two columns at once ("proposed by me OR accepted
      // by me"), which PostgREST spells as a single `or` filter string.
      or: vi.fn((filter: string) => { calls.push({ table: name, op: 'or', payload: filter }); return q; }),
      gt: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'gt', payload: [col, val] }); return q; }),
      order: vi.fn((col: string, opts?: unknown) => { calls.push({ table: name, op: 'order', payload: [col, opts] }); return q; }),
      insert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'insert', payload }); return q; }),
      upsert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'upsert', payload }); return q; }),
      update: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'update', payload }); return q; }),
      delete: vi.fn(() => { calls.push({ table: name, op: 'delete' }); return q; }),
      limit: vi.fn((n: number, opts?: unknown) => { calls.push({ table: name, op: 'limit', payload: [n, opts] }); return q; }),
      single: vi.fn(async () => ({ data: rows[name]?.[0] ?? null, error: errors[name] ?? null })),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[name] ?? [], error: errors[name] ?? null }).then(res),
    };
    return q;
  }
  pkg.client = {
    from: vi.fn((n: string) => table(n)),
    rpc: vi.fn(async (fn: string, args?: unknown) => {
      calls.push({ table: 'rpc', op: fn, payload: args });
      return { data: 'm1', error: null };
    }),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: meId ? { user: { id: meId } } : null }, error: null })),
    },
  };
  return { calls };
}

beforeEach(() => vi.resetModules());

describe('queue', () => {
  it('never sends user_id — the database default decides who owns the entry', async () => {
    const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
    const { joinQueue } = await import('../matchmaking');
    await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
    const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
    expect(Object.keys(insert.payload as object)).not.toContain('user_id');
  });

  it('sends the hash it computed, not one it was handed', async () => {
    const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
    const { joinQueue } = await import('../matchmaking');
    await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
    const { rulesHash } = await import('../../rules');
    const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
    expect((insert.payload as { claimed_hash: string }).claimed_hash).toBe(await rulesHash(FORMAT));
  });

  it('sends the data revision alongside the roster', async () => {
    const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
    const { joinQueue } = await import('../matchmaking');
    const { DATA_REV } = await import('../data');
    await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
    const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
    expect((insert.payload as { data_rev: string }).data_rev).toBe(DATA_REV);
  });

  it('returns the id of the row it created', async () => {
    harness({ queue_entries: [{ id: 'q1' }] });
    const { joinQueue } = await import('../matchmaking');
    const id = await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
    expect(id).toBe('q1');
  });

  /**
   * `deleteTeam` in `saves.ts` filters its delete with `.eq('id', id)` even
   * though RLS scopes it correctly on its own — that redundant predicate is
   * this codebase's established discipline for a DELETE. Asserting only that
   * *some* delete happened would pass whether or not that filter exists, so
   * this checks the filter's column and value explicitly.
   */
  it('scopes the delete to the caller\'s own user_id, read from the session', async () => {
    const { calls } = harness({});
    const { leaveQueue } = await import('../matchmaking');
    await leaveQueue();
    expect(calls.some((c) => c.table === 'queue_entries' && c.op === 'delete')).toBe(true);
    const eq = calls.find((c) => c.table === 'queue_entries' && c.op === 'eq');
    expect(eq?.payload).toEqual(['user_id', 'me']);
  });

  it('refuses to leave a queue nobody signed into', async () => {
    harness({}, {}, null);
    const { leaveQueue } = await import('../matchmaking');
    await expect(leaveQueue()).rejects.toThrow(/must be signed in/);
  });

  it('reports no entry when the table has none for this user', async () => {
    harness({ queue_entries: [] });
    const { myQueueEntry } = await import('../matchmaking');
    expect(await myQueueEntry()).toBeNull();
  });

  /**
   * `verifiedHash` stays null until the coordinator recomputes it — the field
   * name is load-bearing for Task 8, which renders null as "checking…".
   */
  it('renders an unverified entry with a null verifiedHash, not a fabricated one', async () => {
    harness({
      queue_entries: [
        { id: 'q1', league: 'great', format_version_id: 'v1', verified_hash: null, expires_at: '2026-09-02T12:00:00Z' },
      ],
    });
    const { myQueueEntry } = await import('../matchmaking');
    const entry = await myQueueEntry();
    expect(entry).toEqual({
      id: 'q1', league: 'great', formatVersionId: 'v1', verifiedHash: null, expiresAt: '2026-09-02T12:00:00Z',
    });
  });

  it('carries the verified hash through once the coordinator has set it', async () => {
    harness({
      queue_entries: [
        { id: 'q1', league: 'great', format_version_id: 'v1', verified_hash: 'abc123', expires_at: '2026-09-02T12:00:00Z' },
      ],
    });
    const { myQueueEntry } = await import('../matchmaking');
    const entry = await myQueueEntry();
    expect(entry?.verifiedHash).toBe('abc123');
  });
});

describe('matches', () => {
  /**
   * `matches` has no `opponent_id` column — only `player_a`/`player_b` — so
   * the module has to know which side of the row is "me" to fill in the field
   * Task 8 destructures. This is the client's own signed-in id, not a value a
   * server told it: getting it wrong would show someone their own id as their
   * opponent's.
   */
  it('reports the OTHER player as the opponent, whichever column they landed in', async () => {
    harness({
      matches: [
        {
          id: 'm1', player_a: 'me', player_b: 'them', format_version_id: 'v1', rules_hash: 'h1',
          data_rev: 'r1', rounds: 3, source: 'queue', created_at: '2026-09-02T12:00:00Z',
        },
        {
          id: 'm2', player_a: 'them2', player_b: 'me', format_version_id: 'v1', rules_hash: 'h1',
          data_rev: 'r1', rounds: 5, source: 'offer', created_at: '2026-09-02T13:00:00Z',
        },
      ],
    });
    const { myMatches } = await import('../matchmaking');
    const matches = await myMatches();
    expect(matches.map((m) => m.opponentId)).toEqual(['them', 'them2']);
  });

  it('maps every field Task 8 destructures', async () => {
    harness({
      matches: [
        {
          id: 'm1', player_a: 'me', player_b: 'them', format_version_id: 'v1', rules_hash: 'h1',
          data_rev: 'r1', rounds: 3, source: 'queue', created_at: '2026-09-02T12:00:00Z',
        },
      ],
    });
    const { myMatches } = await import('../matchmaking');
    const [m] = await myMatches();
    expect(m).toEqual({
      id: 'm1', opponentId: 'them', formatVersionId: 'v1', rulesHash: 'h1',
      dataRev: 'r1', rounds: 3, source: 'queue', createdAt: '2026-09-02T12:00:00Z',
    });
  });
});

describe('offers', () => {
  it('lists open offers for a league, mapped to camelCase fields', async () => {
    const { calls } = harness({
      match_offers: [
        {
          id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
          team: [{ ref: 'azumarill' }, { ref: 'registeel' }, { ref: 'skarmory' }],
        },
      ],
    });
    const { listOpenOffers } = await import('../matchmaking');
    const offers = await listOpenOffers('great');
    expect(offers).toEqual([
      {
        id: 'o1', proposerId: 'p1', league: 'great', formatVersionId: 'v1',
        scheduledFor: null, expiresAt: '2026-09-02T13:00:00Z', state: 'open', acceptedBy: null,
        rosterSize: 3,
      },
    ]);
    const leagueFilter = calls.find((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[0] === 'league');
    expect(leagueFilter?.payload).toEqual(['league', 'great']);
  });

  /**
   * `accept_offer(p_offer, p_team)` takes no format: the OFFER's
   * `format_version_id` is what the match is played under, so how big a
   * roster an accepter needs is the offer's business and not theirs. Nothing
   * downstream would catch the mismatch either — the coordinator recomputes
   * `rules_hash` and never looks at `team`.
   *
   * The size comes from the posted roster's length rather than from the
   * format's `composition.size`, because `format_versions` is readable only
   * for a format whose `visibility = 'public'` and a saved format defaults to
   * `private` — embedding the rules would return null for exactly the
   * strangers' offers this number is for.
   */
  it('reports how big a roster each offer wants, from the roster it was posted with', async () => {
    harness({
      match_offers: [
        {
          id: 'o-three', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
        },
        {
          id: 'o-six', proposer_id: 'p2', league: 'great', format_version_id: 'v2',
          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
        },
      ],
    });
    const { listOpenOffers } = await import('../matchmaking');
    expect((await listOpenOffers('great')).map((o) => o.rosterSize)).toEqual([3, 6]);
  });

  it('asks for the team it sizes that from, and reports zero rather than NaN without one', async () => {
    const { calls } = harness({
      match_offers: [
        {
          id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
        },
      ],
    });
    const { listOpenOffers } = await import('../matchmaking');
    const [o] = await listOpenOffers('great');
    // A zero disables the accept control; an undefined length would sail
    // through `team.length === o.rosterSize` as NaN and disable it too, but
    // silently and for the wrong reason.
    expect(o.rosterSize).toBe(0);
    const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
    expect(select?.payload).toMatch(/\bteam\b/);
  });

  /**
   * The proposer's half of the handshake has no other way home. An offer
   * leaves `state = 'open'` the moment it is accepted, so `listOpenOffers`
   * stops returning it exactly when the proposer needs to confirm it — and a
   * screen that only remembered what it posted this session forgets on
   * reload. These four tests hold the shape that lets both sides rediscover
   * it from the database instead.
   */
  it('lists offers I proposed and offers I accepted, not just open ones', async () => {
    const { calls } = harness({ match_offers: [] });
    const { myOffers } = await import('../matchmaking');
    await myOffers();
    const or = calls.find((c) => c.table === 'match_offers' && c.op === 'or');
    expect(or?.payload).toBe('proposer_id.eq.me,accepted_by.eq.me');
    // Scoping this to `open` would reintroduce the dead end it exists to fix.
    expect(calls.some((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[1] === 'open')).toBe(false);
  });

  it('carries state, scheduledFor, acceptedBy and matchId through for both sides', async () => {
    harness({
      match_offers: [
        {
          id: 'o1', proposer_id: 'me', league: 'great', format_version_id: 'fv1',
          scheduled_for: '2026-09-05T18:00:00Z', expires_at: '2026-09-05T19:00:00Z',
          state: 'accepted', accepted_by: 'them', match_id: null,
          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
        },
        {
          id: 'o2', proposer_id: 'them', league: 'great', format_version_id: 'fv1',
          scheduled_for: null, expires_at: '2026-09-05T19:00:00Z',
          state: 'converted', accepted_by: 'me', match_id: 'm9',
          // Six, deliberately differing from the three above: two rows mapped
          // from one function, and a constant would satisfy only one of them.
          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
        },
      ],
    });
    const { myOffers } = await import('../matchmaking');
    expect(await myOffers()).toEqual([
      {
        id: 'o1', proposerId: 'me', league: 'great', formatVersionId: 'fv1',
        scheduledFor: '2026-09-05T18:00:00Z', expiresAt: '2026-09-05T19:00:00Z',
        state: 'accepted', acceptedBy: 'them', matchId: null, rosterSize: 3,
      },
      {
        id: 'o2', proposerId: 'them', league: 'great', formatVersionId: 'fv1',
        scheduledFor: null, expiresAt: '2026-09-05T19:00:00Z',
        state: 'converted', acceptedBy: 'me', matchId: 'm9', rosterSize: 6,
      },
    ]);
  });

  it('asks the database for match_id, so a confirmed offer can name the match it became', async () => {
    // A state string alone cannot say WHICH match a confirmed offer became.
    const { calls } = harness({ match_offers: [] });
    const { myOffers } = await import('../matchmaking');
    await myOffers();
    const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
    expect(select?.payload).toMatch(/\bmatch_id\b/);
    expect(select?.payload).toMatch(/\bscheduled_for\b/);
    expect(select?.payload).toMatch(/\baccepted_by\b/);
    expect(select?.payload).toMatch(/\bstate\b/);
  });

  it('refuses to list the offers of nobody in particular', async () => {
    harness({}, {}, null);
    const { myOffers } = await import('../matchmaking');
    await expect(myOffers()).rejects.toThrow(/must be signed in/);
  });

  it('never sends proposer_id — the database default decides who owns the offer', async () => {
    const { calls } = harness({ match_offers: [{ id: 'o1' }] });
    const { createOffer } = await import('../matchmaking');
    await createOffer({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
    const insert = calls.find((c) => c.table === 'match_offers' && c.op === 'insert')!;
    expect(Object.keys(insert.payload as object)).not.toContain('proposer_id');
  });

  it('refuses to schedule an offer in the past before the database has to', async () => {
    harness({});
    const { createOffer } = await import('../matchmaking');
    await expect(createOffer({
      league: 'great', formatVersionId: 'v1', format: FORMAT, team: [],
      scheduledFor: new Date(Date.now() - 60_000),
    })).rejects.toThrow(/in the past/);
  });

  it('makes no network call when refusing a past schedule', async () => {
    const { calls } = harness({});
    const { createOffer } = await import('../matchmaking');
    await expect(createOffer({
      league: 'great', formatVersionId: 'v1', format: FORMAT, team: [],
      scheduledFor: new Date(Date.now() - 60_000),
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('sends a future schedule through as an ISO timestamp', async () => {
    const { calls } = harness({ match_offers: [{ id: 'o1' }] });
    const { createOffer } = await import('../matchmaking');
    const future = new Date(Date.now() + 3_600_000);
    await createOffer({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [], scheduledFor: future });
    const insert = calls.find((c) => c.table === 'match_offers' && c.op === 'insert')!;
    expect((insert.payload as { scheduled_for: string }).scheduled_for).toBe(future.toISOString());
  });

  /**
   * `acceptOffer` takes the taker's team: `accept_offer(p_offer, p_team)`
   * stores it as `accepted_team` and, for a live offer, as `matches.team_b`,
   * which is NOT NULL. The brief's version of this test called
   * `acceptOffer('o1')` with one argument — that signature cannot supply a
   * roster for a live match, so it is adapted here to pass one.
   */
  it('accepts an offer through the function, never by writing the row', async () => {
    const { calls } = harness({});
    const { acceptOffer } = await import('../matchmaking');
    await acceptOffer('o1', []);
    expect(calls.some((c) => c.table === 'match_offers' && c.op === 'update')).toBe(false);
    // accept_offer holds the row lock while it checks state; an UPDATE from here
    // would race a second taker and could edit the terms being agreed to.
  });

  it('calls accept_offer with the offer id and the taker team as separate args', async () => {
    const { calls } = harness({});
    const { acceptOffer } = await import('../matchmaking');
    const team = [{ ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }];
    await acceptOffer('o1', team);
    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'accept_offer')!;
    expect(rpc.payload).toEqual({ p_offer: 'o1', p_team: team });
  });

  it('confirms an offer through the function and returns the new match id', async () => {
    const { calls } = harness({});
    const { confirmOffer } = await import('../matchmaking');
    const id = await confirmOffer('o1');
    expect(id).toBe('m1');
    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'confirm_offer')!;
    expect(rpc.payload).toEqual({ p_offer: 'o1' });
  });
});

describe('friend codes', () => {
  it('reads the opponent friend code exposed once a match pairs the two of you', async () => {
    harness({ friend_codes: [{ code: '1234 5678 9012' }] });
    const { opponentFriendCode } = await import('../matchmaking');
    expect(await opponentFriendCode('them')).toBe('1234 5678 9012');
  });

  it('returns null rather than throwing when no code is on file yet', async () => {
    harness({ friend_codes: [] });
    const { opponentFriendCode } = await import('../matchmaking');
    expect(await opponentFriendCode('them')).toBeNull();
  });
});
