# Task 7 fix-round 1 re-review — ac4a3e7..a86e114

## Commits
a86e114 fix(matchmaking): scope leaveQueue's delete, and stop paying for getUser()

## Files changed
 .../2026-09-02-m2a-matchmaking/task-7-report.md    | 65 ++++++++++++++++++++++
 app/src/lib/__tests__/matchmaking.test.ts          | 30 ++++++++--
 app/src/lib/matchmaking.ts                         | 37 +++++++++---
 3 files changed, 118 insertions(+), 14 deletions(-)

## Full diff
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
index e700e6b..7b2a0a5 100644
--- a/app/src/lib/__tests__/matchmaking.test.ts
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -2,76 +2,79 @@ import { describe, it, expect, vi, beforeEach } from 'vitest';
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
- * `auth.getUser` is also new: `myMatches` has no `opponent_id` column to read
- * — a match row only has `player_a`/`player_b` — so the module has to ask who
- * is signed in to know which one is "me". Defaults to a signed-in user id of
- * 'me'; pass a different id to test the other side of a match.
+ * `auth.getSession` is also new: `myMatches` has no `opponent_id` column to
+ * read — a match row only has `player_a`/`player_b` — so the module has to
+ * ask who is signed in to know which one is "me", and `leaveQueue` needs the
+ * same id to filter its delete. `getSession` (a local read), not `getUser`
+ * (a network round trip to the Auth server) — see `SessionContext.tsx`.
+ * Defaults to a signed-in user id of 'me'; pass a different id, or `null` for
+ * signed-out, to test the other cases.
  */
 function harness(
   rows: Record<string, unknown[]>,
   errors: Record<string, { code: string; message: string }> = {},
   meId: string | null = 'me',
 ) {
   const calls: { table: string; op: string; payload?: unknown }[] = [];
   function table(name: string) {
     const q: Record<string, unknown> = {
       select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
       eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
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
-      getUser: vi.fn(async () => ({ data: { user: meId ? { id: meId } : null }, error: null })),
+      getSession: vi.fn(async () => ({ data: { session: meId ? { user: { id: meId } } : null }, error: null })),
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
@@ -79,45 +82,60 @@ describe('queue', () => {
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
 
-  it('leaves the queue with a plain delete — RLS, not a client-supplied filter, scopes it to one row', async () => {
+  /**
+   * `deleteTeam` in `saves.ts` filters its delete with `.eq('id', id)` even
+   * though RLS scopes it correctly on its own — that redundant predicate is
+   * this codebase's established discipline for a DELETE. Asserting only that
+   * *some* delete happened would pass whether or not that filter exists, so
+   * this checks the filter's column and value explicitly.
+   */
+  it('scopes the delete to the caller\'s own user_id, read from the session', async () => {
     const { calls } = harness({});
     const { leaveQueue } = await import('../matchmaking');
     await leaveQueue();
     expect(calls.some((c) => c.table === 'queue_entries' && c.op === 'delete')).toBe(true);
+    const eq = calls.find((c) => c.table === 'queue_entries' && c.op === 'eq');
+    expect(eq?.payload).toEqual(['user_id', 'me']);
+  });
+
+  it('refuses to leave a queue nobody signed into', async () => {
+    harness({}, {}, null);
+    const { leaveQueue } = await import('../matchmaking');
+    await expect(leaveQueue()).rejects.toThrow(/must be signed in/);
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
diff --git a/app/src/lib/matchmaking.ts b/app/src/lib/matchmaking.ts
index 59caa16..fd25cd4 100644
--- a/app/src/lib/matchmaking.ts
+++ b/app/src/lib/matchmaking.ts
@@ -52,82 +52,103 @@ export async function joinQueue(a: {
   formatVersionId: string;
   format: Format;
   team: StoredMember[];
 }): Promise<string> {
   const { data, error } = await supabase
     .from('queue_entries')
     .insert({
       league: a.league,
       format_version_id: a.formatVersionId,
       claimed_hash: await rulesHash(a.format),
       team: a.team,
       data_rev: DATA_REV,
     })
     .select('id')
     .single();
   if (error) throw new Error(error.message);
   return (data as { id: string }).id;
 }
 
 /**
- * No filter is sent — `queue_entries_one_per_user` guarantees at most one row
- * is even visible to this user under RLS, so an unscoped delete removes that
- * one row and nothing belonging to anyone else.
+ * Filtered by the caller's own `user_id`, read from the local session —
+ * `saves.ts`'s `deleteTeam` filters its delete with `.eq('id', id)` even
+ * though its RLS policy also scopes correctly on its own, and that is this
+ * codebase's established discipline for a DELETE: a redundant predicate that
+ * matches what RLS already computes is ordinary defence in depth, not a
+ * second source of truth the way a client-supplied owner on INSERT would be.
+ * Without it, this call is literally "delete every queue entry you can see",
+ * and its safety would rest entirely on one RLS policy staying exactly as
+ * written across every future migration.
+ *
+ * `getSession()`, not `getUser()`: a local read of the already-verified
+ * session, not a network round trip that revalidates the JWT against the
+ * Auth server on every call — the same choice `SessionContext.tsx` makes and
+ * explains.
  */
 export async function leaveQueue(): Promise<void> {
-  const { error } = await supabase.from('queue_entries').delete();
+  const { data, error: sessionError } = await supabase.auth.getSession();
+  if (sessionError) throw new Error(sessionError.message);
+  const userId = data.session?.user.id;
+  if (!userId) throw new Error('you must be signed in to leave the queue');
+  const { error } = await supabase.from('queue_entries').delete().eq('user_id', userId);
   if (error) throw new Error(error.message);
 }
 
 export async function myQueueEntry(): Promise<QueueEntry | null> {
   const { data, error } = await supabase
     .from('queue_entries')
     .select('id, league, format_version_id, verified_hash, expires_at');
   if (error) throw new Error(error.message);
   const rows = (data ?? []) as {
     id: string;
     league: LeagueId;
     format_version_id: string;
     verified_hash: string | null;
     expires_at: string;
   }[];
   const row = rows[0];
   if (!row) return null;
   return {
     id: row.id,
     league: row.league,
     formatVersionId: row.format_version_id,
     verifiedHash: row.verified_hash,
     expiresAt: row.expires_at,
   };
 }
 
 /**
  * `matches` has no `opponent_id` column — only `player_a`/`player_b`, since a
  * match row is symmetric and belongs to neither side more than the other.
  * Working out which one is "the opponent" needs to know who is signed in, so
- * this reads the live session rather than trusting either column by position.
+ * this reads the local session rather than trusting either column by
+ * position.
+ *
+ * `getSession()`, not `getUser()`: `getUser()` is a real network round trip
+ * that revalidates the JWT against the Auth server, and would abort this
+ * whole read on a transient network error for an id the caller already has
+ * locally. `SessionContext.tsx` makes the same choice for the same reason.
  */
 export async function myMatches(): Promise<Match[]> {
-  const { data: userData, error: userError } = await supabase.auth.getUser();
-  if (userError) throw new Error(userError.message);
-  const me = userData.user?.id;
+  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
+  if (sessionError) throw new Error(sessionError.message);
+  const me = sessionData.session?.user.id;
   const { data, error } = await supabase
     .from('matches')
     .select('id, player_a, player_b, format_version_id, rules_hash, data_rev, rounds, source, created_at')
     .order('created_at', { ascending: false });
   if (error) throw new Error(error.message);
   return (data ?? []).map((row) => {
     const r = row as {
       id: string;
       player_a: string;
       player_b: string;
       format_version_id: string;
       rules_hash: string;
       data_rev: string;
       rounds: number;
       source: 'queue' | 'offer';
       created_at: string;
     };
     return {
       id: r.id,
       opponentId: r.player_a === me ? r.player_b : r.player_a,
