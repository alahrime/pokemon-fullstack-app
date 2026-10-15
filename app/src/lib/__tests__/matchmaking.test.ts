import { describe, it, expect, vi, beforeEach } from 'vitest';

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

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
      is: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'is', payload: [col, val] }); return q; }),
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

describe('aimed offers stay off the board', () => {
  it('myOffers excludes target_id', async () => {
    const { calls } = harness({ match_offers: [] });
    const { myOffers } = await import('../matchmaking');
    await myOffers();
    expect(calls.filter((c) => c.op === 'is' && (c.payload as unknown[])[0] === 'target_id')).toHaveLength(1);
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
          data_rev: 'r1', rounds: 3, state: 'confirmed', rating_counted: true,
          amend_deadline: '2026-09-03T00:00:00Z', source: 'queue', created_at: '2026-09-02T12:00:00Z',
          league: 'ultra', format_versions: { formats: { name: 'Ultra League' } },
        },
      ],
    });
    const { myMatches } = await import('../matchmaking');
    const [m] = await myMatches();
    expect(m).toEqual({
      id: 'm1', opponentId: 'them', mySide: 'a', formatVersionId: 'v1', rulesHash: 'h1',
      dataRev: 'r1', rounds: 3, state: 'confirmed', ratingCounted: true,
      amendDeadline: '2026-09-03T00:00:00Z', source: 'queue', createdAt: '2026-09-02T12:00:00Z',
      league: 'ultra', formatName: 'Ultra League',
    });
  });
});

describe('offers', () => {
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
          state: 'accepted', accepted_by: 'them', match_id: null, verified_hash: 'vh1',
          team_public: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
        },
        {
          id: 'o2', proposer_id: 'them', league: 'great', format_version_id: 'fv1',
          scheduled_for: null, expires_at: '2026-09-05T19:00:00Z',
          state: 'converted', accepted_by: 'me', match_id: 'm9', verified_hash: 'vh1',
          // Six, deliberately differing from the three above: two rows mapped
          // from one function, and a constant would satisfy only one of them.
          team_public: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
        },
      ],
    });
    const { myOffers } = await import('../matchmaking');
    expect(await myOffers()).toEqual([
      {
        id: 'o1', proposerId: 'me', league: 'great', formatVersionId: 'fv1',
        scheduledFor: '2026-09-05T18:00:00Z', expiresAt: '2026-09-05T19:00:00Z',
        state: 'accepted', acceptedBy: 'them', matchId: null, verifiedHash: 'vh1', rosterSize: 3,
        roster: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
      },
      {
        id: 'o2', proposerId: 'them', league: 'great', formatVersionId: 'fv1',
        scheduledFor: null, expiresAt: '2026-09-05T19:00:00Z',
        state: 'converted', acceptedBy: 'me', matchId: 'm9', verifiedHash: 'vh1', rosterSize: 6,
        roster: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
      },
    ]);
  });

  /** `myOffers` inherits `roster` from `Offer`; it is a second mapper, and a
   * second mapper is where a field gets carried in one and forgotten in the
   * other. Asserted on its own so a regression names which listing lost it. */
  it('carries the roster through your own offers too', async () => {
    const team = [
      { ref: 'skarmory', fast_move: 'AIR_SLASH', charge_moves: ['SKY_ATTACK'], iv_attack: 2, iv_defense: 15, iv_stamina: 14, level: 39 },
    ];
    harness({
      match_offers: [
        {
          id: 'o1', proposer_id: 'me', league: 'great', format_version_id: 'fv1',
          scheduled_for: null, expires_at: '2026-09-05T19:00:00Z', state: 'open',
          accepted_by: null, match_id: null, verified_hash: 'vh1', team_public: team,
        },
      ],
    });
    const { myOffers } = await import('../matchmaking');
    expect((await myOffers())[0].roster).toEqual(team);
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
    const { DATA_REV } = await import('../data');
    const team = [{ ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }];
    await acceptOffer('o1', team);
    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'accept_offer')!;
    expect(rpc.payload).toEqual({ p_offer: 'o1', p_team: team, p_data_rev: DATA_REV });
  });

  /**
   * Accepting is the THIRD way into a match, and until this branch it was the
   * only one that never said which data build it was on. `joinQueue` and
   * `createOffer` both write `DATA_REV` into their own row and
   * `pair_queue_entries` refuses to pair across builds; `accept_offer` now
   * refuses too, and the argument has to be this build's revision rather than
   * anything read back off the offer — the whole point is that the two may
   * disagree.
   *
   * Asserted against the real `DATA_REV` and not merely `expect.any(String)`,
   * which would keep passing if the call sent a literal, the offer's own rev,
   * or an empty string.
   */
  it('sends this build\'s own data revision when accepting, not the offer\'s', async () => {
    const { calls } = harness({});
    const { acceptOffer } = await import('../matchmaking');
    const { DATA_REV } = await import('../data');
    await acceptOffer('o1', []);
    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'accept_offer')!;
    expect((rpc.payload as { p_data_rev: string }).p_data_rev).toBe(DATA_REV);
    expect(DATA_REV.length).toBeGreaterThan(0);
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
