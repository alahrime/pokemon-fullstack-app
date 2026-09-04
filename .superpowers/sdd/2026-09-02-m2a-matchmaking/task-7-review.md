# Task 7 review package — f031a4e..HEAD

## Commits
ac4a3e7 feat(matchmaking): the client data layer for queue, offers and matches

## Files changed
 .../2026-09-02-m2a-matchmaking/task-7-report.md    |  99 +++++++
 app/src/lib/__tests__/matchmaking.test.ts          | 290 +++++++++++++++++++++
 app/src/lib/matchmaking.ts                         | 243 +++++++++++++++++
 3 files changed, 632 insertions(+)

## Full diff
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
new file mode 100644
index 0000000..e700e6b
--- /dev/null
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -0,0 +1,290 @@
+import { describe, it, expect, vi, beforeEach } from 'vitest';
+import { RULES_SCHEMA, type Format } from '../../rules';
+
+const pkg = vi.hoisted(() => ({ client: null as unknown }));
+vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
+
+// No `as Format` cast: every required field is present, so the annotation alone
+// type-checks. A cast here would hide the next real mismatch.
+const FORMAT: Format = {
+  schema: RULES_SCHEMA,
+  base: 'great',
+  pool: [],
+  composition: { size: 3, uniqueSpecies: true },
+  selection: { mode: 'open' },
+};
+
+/**
+ * Copied from `saves.test.ts`. `errors` fails one table's writes the way
+ * PostgREST does — a code plus the text it puts in `message`. `rpc` is new
+ * here: `saves.ts` never called it, but `accept_offer`/`confirm_offer` are
+ * functions, not table writes, so this module needs a recorder for them too.
+ * `auth.getUser` is also new: `myMatches` has no `opponent_id` column to read
+ * — a match row only has `player_a`/`player_b` — so the module has to ask who
+ * is signed in to know which one is "me". Defaults to a signed-in user id of
+ * 'me'; pass a different id to test the other side of a match.
+ */
+function harness(
+  rows: Record<string, unknown[]>,
+  errors: Record<string, { code: string; message: string }> = {},
+  meId: string | null = 'me',
+) {
+  const calls: { table: string; op: string; payload?: unknown }[] = [];
+  function table(name: string) {
+    const q: Record<string, unknown> = {
+      select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
+      eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
+      gt: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'gt', payload: [col, val] }); return q; }),
+      order: vi.fn((col: string, opts?: unknown) => { calls.push({ table: name, op: 'order', payload: [col, opts] }); return q; }),
+      insert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'insert', payload }); return q; }),
+      upsert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'upsert', payload }); return q; }),
+      update: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'update', payload }); return q; }),
+      delete: vi.fn(() => { calls.push({ table: name, op: 'delete' }); return q; }),
+      limit: vi.fn((n: number, opts?: unknown) => { calls.push({ table: name, op: 'limit', payload: [n, opts] }); return q; }),
+      single: vi.fn(async () => ({ data: rows[name]?.[0] ?? null, error: errors[name] ?? null })),
+      then: (res: (v: unknown) => unknown) =>
+        Promise.resolve({ data: rows[name] ?? [], error: errors[name] ?? null }).then(res),
+    };
+    return q;
+  }
+  pkg.client = {
+    from: vi.fn((n: string) => table(n)),
+    rpc: vi.fn(async (fn: string, args?: unknown) => {
+      calls.push({ table: 'rpc', op: fn, payload: args });
+      return { data: 'm1', error: null };
+    }),
+    auth: {
+      getUser: vi.fn(async () => ({ data: { user: meId ? { id: meId } : null }, error: null })),
+    },
+  };
+  return { calls };
+}
+
+beforeEach(() => vi.resetModules());
+
+describe('queue', () => {
+  it('never sends user_id — the database default decides who owns the entry', async () => {
+    const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
+    const { joinQueue } = await import('../matchmaking');
+    await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
+    const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
+    expect(Object.keys(insert.payload as object)).not.toContain('user_id');
+  });
+
+  it('sends the hash it computed, not one it was handed', async () => {
+    const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
+    const { joinQueue } = await import('../matchmaking');
+    await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
+    const { rulesHash } = await import('../../rules');
+    const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
+    expect((insert.payload as { claimed_hash: string }).claimed_hash).toBe(await rulesHash(FORMAT));
+  });
+
+  it('sends the data revision alongside the roster', async () => {
+    const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
+    const { joinQueue } = await import('../matchmaking');
+    const { DATA_REV } = await import('../data');
+    await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
+    const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
+    expect((insert.payload as { data_rev: string }).data_rev).toBe(DATA_REV);
+  });
+
+  it('returns the id of the row it created', async () => {
+    harness({ queue_entries: [{ id: 'q1' }] });
+    const { joinQueue } = await import('../matchmaking');
+    const id = await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
+    expect(id).toBe('q1');
+  });
+
+  it('leaves the queue with a plain delete — RLS, not a client-supplied filter, scopes it to one row', async () => {
+    const { calls } = harness({});
+    const { leaveQueue } = await import('../matchmaking');
+    await leaveQueue();
+    expect(calls.some((c) => c.table === 'queue_entries' && c.op === 'delete')).toBe(true);
+  });
+
+  it('reports no entry when the table has none for this user', async () => {
+    harness({ queue_entries: [] });
+    const { myQueueEntry } = await import('../matchmaking');
+    expect(await myQueueEntry()).toBeNull();
+  });
+
+  /**
+   * `verifiedHash` stays null until the coordinator recomputes it — the field
+   * name is load-bearing for Task 8, which renders null as "checking…".
+   */
+  it('renders an unverified entry with a null verifiedHash, not a fabricated one', async () => {
+    harness({
+      queue_entries: [
+        { id: 'q1', league: 'great', format_version_id: 'v1', verified_hash: null, expires_at: '2026-09-02T12:00:00Z' },
+      ],
+    });
+    const { myQueueEntry } = await import('../matchmaking');
+    const entry = await myQueueEntry();
+    expect(entry).toEqual({
+      id: 'q1', league: 'great', formatVersionId: 'v1', verifiedHash: null, expiresAt: '2026-09-02T12:00:00Z',
+    });
+  });
+
+  it('carries the verified hash through once the coordinator has set it', async () => {
+    harness({
+      queue_entries: [
+        { id: 'q1', league: 'great', format_version_id: 'v1', verified_hash: 'abc123', expires_at: '2026-09-02T12:00:00Z' },
+      ],
+    });
+    const { myQueueEntry } = await import('../matchmaking');
+    const entry = await myQueueEntry();
+    expect(entry?.verifiedHash).toBe('abc123');
+  });
+});
+
+describe('matches', () => {
+  /**
+   * `matches` has no `opponent_id` column — only `player_a`/`player_b` — so
+   * the module has to know which side of the row is "me" to fill in the field
+   * Task 8 destructures. This is the client's own signed-in id, not a value a
+   * server told it: getting it wrong would show someone their own id as their
+   * opponent's.
+   */
+  it('reports the OTHER player as the opponent, whichever column they landed in', async () => {
+    harness({
+      matches: [
+        {
+          id: 'm1', player_a: 'me', player_b: 'them', format_version_id: 'v1', rules_hash: 'h1',
+          data_rev: 'r1', rounds: 3, source: 'queue', created_at: '2026-09-02T12:00:00Z',
+        },
+        {
+          id: 'm2', player_a: 'them2', player_b: 'me', format_version_id: 'v1', rules_hash: 'h1',
+          data_rev: 'r1', rounds: 5, source: 'offer', created_at: '2026-09-02T13:00:00Z',
+        },
+      ],
+    });
+    const { myMatches } = await import('../matchmaking');
+    const matches = await myMatches();
+    expect(matches.map((m) => m.opponentId)).toEqual(['them', 'them2']);
+  });
+
+  it('maps every field Task 8 destructures', async () => {
+    harness({
+      matches: [
+        {
+          id: 'm1', player_a: 'me', player_b: 'them', format_version_id: 'v1', rules_hash: 'h1',
+          data_rev: 'r1', rounds: 3, source: 'queue', created_at: '2026-09-02T12:00:00Z',
+        },
+      ],
+    });
+    const { myMatches } = await import('../matchmaking');
+    const [m] = await myMatches();
+    expect(m).toEqual({
+      id: 'm1', opponentId: 'them', formatVersionId: 'v1', rulesHash: 'h1',
+      dataRev: 'r1', rounds: 3, source: 'queue', createdAt: '2026-09-02T12:00:00Z',
+    });
+  });
+});
+
+describe('offers', () => {
+  it('lists open offers for a league, mapped to camelCase fields', async () => {
+    const { calls } = harness({
+      match_offers: [
+        {
+          id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    const offers = await listOpenOffers('great');
+    expect(offers).toEqual([
+      {
+        id: 'o1', proposerId: 'p1', league: 'great', formatVersionId: 'v1',
+        scheduledFor: null, expiresAt: '2026-09-02T13:00:00Z', state: 'open', acceptedBy: null,
+      },
+    ]);
+    const leagueFilter = calls.find((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[0] === 'league');
+    expect(leagueFilter?.payload).toEqual(['league', 'great']);
+  });
+
+  it('never sends proposer_id — the database default decides who owns the offer', async () => {
+    const { calls } = harness({ match_offers: [{ id: 'o1' }] });
+    const { createOffer } = await import('../matchmaking');
+    await createOffer({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
+    const insert = calls.find((c) => c.table === 'match_offers' && c.op === 'insert')!;
+    expect(Object.keys(insert.payload as object)).not.toContain('proposer_id');
+  });
+
+  it('refuses to schedule an offer in the past before the database has to', async () => {
+    harness({});
+    const { createOffer } = await import('../matchmaking');
+    await expect(createOffer({
+      league: 'great', formatVersionId: 'v1', format: FORMAT, team: [],
+      scheduledFor: new Date(Date.now() - 60_000),
+    })).rejects.toThrow(/in the past/);
+  });
+
+  it('makes no network call when refusing a past schedule', async () => {
+    const { calls } = harness({});
+    const { createOffer } = await import('../matchmaking');
+    await expect(createOffer({
+      league: 'great', formatVersionId: 'v1', format: FORMAT, team: [],
+      scheduledFor: new Date(Date.now() - 60_000),
+    })).rejects.toThrow();
+    expect(calls).toHaveLength(0);
+  });
+
+  it('sends a future schedule through as an ISO timestamp', async () => {
+    const { calls } = harness({ match_offers: [{ id: 'o1' }] });
+    const { createOffer } = await import('../matchmaking');
+    const future = new Date(Date.now() + 3_600_000);
+    await createOffer({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [], scheduledFor: future });
+    const insert = calls.find((c) => c.table === 'match_offers' && c.op === 'insert')!;
+    expect((insert.payload as { scheduled_for: string }).scheduled_for).toBe(future.toISOString());
+  });
+
+  /**
+   * `acceptOffer` takes the taker's team: `accept_offer(p_offer, p_team)`
+   * stores it as `accepted_team` and, for a live offer, as `matches.team_b`,
+   * which is NOT NULL. The brief's version of this test called
+   * `acceptOffer('o1')` with one argument — that signature cannot supply a
+   * roster for a live match, so it is adapted here to pass one.
+   */
+  it('accepts an offer through the function, never by writing the row', async () => {
+    const { calls } = harness({});
+    const { acceptOffer } = await import('../matchmaking');
+    await acceptOffer('o1', []);
+    expect(calls.some((c) => c.table === 'match_offers' && c.op === 'update')).toBe(false);
+    // accept_offer holds the row lock while it checks state; an UPDATE from here
+    // would race a second taker and could edit the terms being agreed to.
+  });
+
+  it('calls accept_offer with the offer id and the taker team as separate args', async () => {
+    const { calls } = harness({});
+    const { acceptOffer } = await import('../matchmaking');
+    const team = [{ ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }];
+    await acceptOffer('o1', team);
+    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'accept_offer')!;
+    expect(rpc.payload).toEqual({ p_offer: 'o1', p_team: team });
+  });
+
+  it('confirms an offer through the function and returns the new match id', async () => {
+    const { calls } = harness({});
+    const { confirmOffer } = await import('../matchmaking');
+    const id = await confirmOffer('o1');
+    expect(id).toBe('m1');
+    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'confirm_offer')!;
+    expect(rpc.payload).toEqual({ p_offer: 'o1' });
+  });
+});
+
+describe('friend codes', () => {
+  it('reads the opponent friend code exposed once a match pairs the two of you', async () => {
+    harness({ friend_codes: [{ code: '1234 5678 9012' }] });
+    const { opponentFriendCode } = await import('../matchmaking');
+    expect(await opponentFriendCode('them')).toBe('1234 5678 9012');
+  });
+
+  it('returns null rather than throwing when no code is on file yet', async () => {
+    harness({ friend_codes: [] });
+    const { opponentFriendCode } = await import('../matchmaking');
+    expect(await opponentFriendCode('them')).toBeNull();
+  });
+});
diff --git a/app/src/lib/matchmaking.ts b/app/src/lib/matchmaking.ts
new file mode 100644
index 0000000..59caa16
--- /dev/null
+++ b/app/src/lib/matchmaking.ts
@@ -0,0 +1,243 @@
+import { supabase } from './supabase';
+import { DATA_REV } from './data';
+import { rulesHash, type Format } from '../rules';
+import type { LeagueId } from './types';
+import type { StoredMember } from './teamCodec';
+
+export interface QueueEntry {
+  id: string;
+  league: LeagueId;
+  formatVersionId: string;
+  /** Null until the coordinator has recomputed the hash. Render as "checking…". */
+  verifiedHash: string | null;
+  expiresAt: string;
+}
+
+export interface Match {
+  id: string;
+  opponentId: string;
+  formatVersionId: string;
+  rulesHash: string;
+  dataRev: string;
+  rounds: number;
+  source: 'queue' | 'offer';
+  createdAt: string;
+}
+
+export interface Offer {
+  id: string;
+  proposerId: string;
+  league: LeagueId;
+  formatVersionId: string;
+  /** Null for the live board; a timestamp for a scheduled proposal. */
+  scheduledFor: string | null;
+  expiresAt: string;
+  state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
+  acceptedBy: string | null;
+}
+
+/**
+ * `user_id` is never sent from here, same rule as `saves.ts`: it defaults to
+ * `auth.uid()` in the database, so a client-supplied owner is never a second
+ * source of truth the policy has to agree with.
+ *
+ * `claimed_hash` is computed here with `rulesHash`, never accepted as a
+ * caller-supplied value — the coordinator recomputes it independently and
+ * writes `verified_hash`, and only a verified entry is eligible to pair. A
+ * hash this function trusted a caller for would be a hash the coordinator
+ * could never have caught a lie in.
+ */
+export async function joinQueue(a: {
+  league: LeagueId;
+  formatVersionId: string;
+  format: Format;
+  team: StoredMember[];
+}): Promise<string> {
+  const { data, error } = await supabase
+    .from('queue_entries')
+    .insert({
+      league: a.league,
+      format_version_id: a.formatVersionId,
+      claimed_hash: await rulesHash(a.format),
+      team: a.team,
+      data_rev: DATA_REV,
+    })
+    .select('id')
+    .single();
+  if (error) throw new Error(error.message);
+  return (data as { id: string }).id;
+}
+
+/**
+ * No filter is sent — `queue_entries_one_per_user` guarantees at most one row
+ * is even visible to this user under RLS, so an unscoped delete removes that
+ * one row and nothing belonging to anyone else.
+ */
+export async function leaveQueue(): Promise<void> {
+  const { error } = await supabase.from('queue_entries').delete();
+  if (error) throw new Error(error.message);
+}
+
+export async function myQueueEntry(): Promise<QueueEntry | null> {
+  const { data, error } = await supabase
+    .from('queue_entries')
+    .select('id, league, format_version_id, verified_hash, expires_at');
+  if (error) throw new Error(error.message);
+  const rows = (data ?? []) as {
+    id: string;
+    league: LeagueId;
+    format_version_id: string;
+    verified_hash: string | null;
+    expires_at: string;
+  }[];
+  const row = rows[0];
+  if (!row) return null;
+  return {
+    id: row.id,
+    league: row.league,
+    formatVersionId: row.format_version_id,
+    verifiedHash: row.verified_hash,
+    expiresAt: row.expires_at,
+  };
+}
+
+/**
+ * `matches` has no `opponent_id` column — only `player_a`/`player_b`, since a
+ * match row is symmetric and belongs to neither side more than the other.
+ * Working out which one is "the opponent" needs to know who is signed in, so
+ * this reads the live session rather than trusting either column by position.
+ */
+export async function myMatches(): Promise<Match[]> {
+  const { data: userData, error: userError } = await supabase.auth.getUser();
+  if (userError) throw new Error(userError.message);
+  const me = userData.user?.id;
+  const { data, error } = await supabase
+    .from('matches')
+    .select('id, player_a, player_b, format_version_id, rules_hash, data_rev, rounds, source, created_at')
+    .order('created_at', { ascending: false });
+  if (error) throw new Error(error.message);
+  return (data ?? []).map((row) => {
+    const r = row as {
+      id: string;
+      player_a: string;
+      player_b: string;
+      format_version_id: string;
+      rules_hash: string;
+      data_rev: string;
+      rounds: number;
+      source: 'queue' | 'offer';
+      created_at: string;
+    };
+    return {
+      id: r.id,
+      opponentId: r.player_a === me ? r.player_b : r.player_a,
+      formatVersionId: r.format_version_id,
+      rulesHash: r.rules_hash,
+      dataRev: r.data_rev,
+      rounds: r.rounds,
+      source: r.source,
+      createdAt: r.created_at,
+    };
+  });
+}
+
+export async function listOpenOffers(league: LeagueId): Promise<Offer[]> {
+  const { data, error } = await supabase
+    .from('match_offers')
+    .select('id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by')
+    .eq('league', league)
+    .eq('state', 'open')
+    .order('created_at', { ascending: false });
+  if (error) throw new Error(error.message);
+  return (data ?? []).map((row) => {
+    const r = row as {
+      id: string;
+      proposer_id: string;
+      league: LeagueId;
+      format_version_id: string;
+      scheduled_for: string | null;
+      expires_at: string;
+      state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
+      accepted_by: string | null;
+    };
+    return {
+      id: r.id,
+      proposerId: r.proposer_id,
+      league: r.league,
+      formatVersionId: r.format_version_id,
+      scheduledFor: r.scheduled_for,
+      expiresAt: r.expires_at,
+      state: r.state,
+      acceptedBy: r.accepted_by,
+    };
+  });
+}
+
+/**
+ * `proposer_id` is never sent, same rule as `user_id` above. Checked BEFORE
+ * any network call: a scheduled offer in the past is refused here so the
+ * caller learns why without a round trip, and before the database's own
+ * `match_offers_scheduled_future` constraint would say the same thing less
+ * legibly.
+ */
+export async function createOffer(a: {
+  league: LeagueId;
+  formatVersionId: string;
+  format: Format;
+  team: StoredMember[];
+  scheduledFor?: Date;
+}): Promise<string> {
+  if (a.scheduledFor && a.scheduledFor <= new Date()) {
+    throw new Error('a scheduled offer cannot be in the past');
+  }
+  const { data, error } = await supabase
+    .from('match_offers')
+    .insert({
+      league: a.league,
+      format_version_id: a.formatVersionId,
+      claimed_hash: await rulesHash(a.format),
+      team: a.team,
+      data_rev: DATA_REV,
+      scheduled_for: a.scheduledFor ? a.scheduledFor.toISOString() : null,
+    })
+    .select('id')
+    .single();
+  if (error) throw new Error(error.message);
+  return (data as { id: string }).id;
+}
+
+/**
+ * Goes through `accept_offer(p_offer, p_team)`, never a client UPDATE: the
+ * function holds the row lock while it checks state, and a taker permitted to
+ * write this row directly would be a taker permitted to edit the terms they
+ * are agreeing to. `p_team` is the taker's own roster — `matches.team_b` is
+ * NOT NULL for a live offer, and there is no column policy that would let a
+ * taker stage it any other way.
+ *
+ * Returns the new match id for a live offer, or null for a scheduled one —
+ * that offer is `accepted`, not yet a match, until the proposer confirms.
+ */
+export async function acceptOffer(id: string, team: StoredMember[]): Promise<string | null> {
+  const { data, error } = await supabase.rpc('accept_offer', { p_offer: id, p_team: team });
+  if (error) throw new Error(error.message);
+  return data as string | null;
+}
+
+/** Goes through `confirm_offer(p_offer)`, the proposer's half of the same handshake. */
+export async function confirmOffer(id: string): Promise<string> {
+  const { data, error } = await supabase.rpc('confirm_offer', { p_offer: id });
+  if (error) throw new Error(error.message);
+  return data as string;
+}
+
+/**
+ * Readable only once a match pairs the two of you — see the "an opponent may
+ * read your friend code while you have a match" policy on `friend_codes`. No
+ * `.single()`: a profile with no code on file yet is zero rows, not an error.
+ */
+export async function opponentFriendCode(profileId: string): Promise<string | null> {
+  const { data, error } = await supabase.from('friend_codes').select('code').eq('profile_id', profileId);
+  if (error) throw new Error(error.message);
+  const rows = (data ?? []) as { code: string }[];
+  return rows[0]?.code ?? null;
+}
