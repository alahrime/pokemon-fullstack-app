# Task 8 fix-round 1 re-review — 5c89a6c..HEAD

## Commits
7dde301 fix(matchmaking): a handshake both sides can find again, under a real format

## Files changed
 .../2026-09-02-m2a-matchmaking/task-8-report.md    | 193 ++++++++++++++
 app/src/lib/__tests__/matchmaking.test.ts          |  71 ++++-
 app/src/lib/__tests__/saves.test.ts                |  45 +++-
 app/src/lib/matchmaking.ts                         |  81 +++++-
 app/src/lib/saves.ts                               |  27 +-
 app/src/screens/MatchmakingScreen.tsx              | 287 +++++++++++++++------
 app/src/screens/__tests__/matchmaking.test.tsx     | 232 ++++++++++++++++-
 app/src/styles/components.css                      |  93 +++++++
 8 files changed, 922 insertions(+), 107 deletions(-)

## Full diff
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
index 7b2a0a5..83a2739 100644
--- a/app/src/lib/__tests__/matchmaking.test.ts
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -18,42 +18,45 @@ const FORMAT: Format = {
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
-      select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
+      select: vi.fn((cols?: unknown) => { calls.push({ table: name, op: 'select', payload: cols }); return q; }),
       eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
+      // `myOffers` asks for two columns at once ("proposed by me OR accepted
+      // by me"), which PostgREST spells as a single `or` filter string.
+      or: vi.fn((filter: string) => { calls.push({ table: name, op: 'or', payload: filter }); return q; }),
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
@@ -205,40 +208,106 @@ describe('offers', () => {
     const { calls } = harness({
       match_offers: [
         {
           id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
           scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
         },
       ],
     });
     const { listOpenOffers } = await import('../matchmaking');
     const offers = await listOpenOffers('great');
     expect(offers).toEqual([
       {
         id: 'o1', proposerId: 'p1', league: 'great', formatVersionId: 'v1',
         scheduledFor: null, expiresAt: '2026-09-02T13:00:00Z', state: 'open', acceptedBy: null,
       },
     ]);
     const leagueFilter = calls.find((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[0] === 'league');
     expect(leagueFilter?.payload).toEqual(['league', 'great']);
   });
 
+  /**
+   * The proposer's half of the handshake has no other way home. An offer
+   * leaves `state = 'open'` the moment it is accepted, so `listOpenOffers`
+   * stops returning it exactly when the proposer needs to confirm it — and a
+   * screen that only remembered what it posted this session forgets on
+   * reload. These four tests hold the shape that lets both sides rediscover
+   * it from the database instead.
+   */
+  it('lists offers I proposed and offers I accepted, not just open ones', async () => {
+    const { calls } = harness({ match_offers: [] });
+    const { myOffers } = await import('../matchmaking');
+    await myOffers();
+    const or = calls.find((c) => c.table === 'match_offers' && c.op === 'or');
+    expect(or?.payload).toBe('proposer_id.eq.me,accepted_by.eq.me');
+    // Scoping this to `open` would reintroduce the dead end it exists to fix.
+    expect(calls.some((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[1] === 'open')).toBe(false);
+  });
+
+  it('carries state, scheduledFor, acceptedBy and matchId through for both sides', async () => {
+    harness({
+      match_offers: [
+        {
+          id: 'o1', proposer_id: 'me', league: 'great', format_version_id: 'fv1',
+          scheduled_for: '2026-09-05T18:00:00Z', expires_at: '2026-09-05T19:00:00Z',
+          state: 'accepted', accepted_by: 'them', match_id: null,
+        },
+        {
+          id: 'o2', proposer_id: 'them', league: 'great', format_version_id: 'fv1',
+          scheduled_for: null, expires_at: '2026-09-05T19:00:00Z',
+          state: 'converted', accepted_by: 'me', match_id: 'm9',
+        },
+      ],
+    });
+    const { myOffers } = await import('../matchmaking');
+    expect(await myOffers()).toEqual([
+      {
+        id: 'o1', proposerId: 'me', league: 'great', formatVersionId: 'fv1',
+        scheduledFor: '2026-09-05T18:00:00Z', expiresAt: '2026-09-05T19:00:00Z',
+        state: 'accepted', acceptedBy: 'them', matchId: null,
+      },
+      {
+        id: 'o2', proposerId: 'them', league: 'great', formatVersionId: 'fv1',
+        scheduledFor: null, expiresAt: '2026-09-05T19:00:00Z',
+        state: 'converted', acceptedBy: 'me', matchId: 'm9',
+      },
+    ]);
+  });
+
+  it('asks the database for match_id, so a confirmed offer can name the match it became', async () => {
+    // A state string alone cannot say WHICH match a confirmed offer became.
+    const { calls } = harness({ match_offers: [] });
+    const { myOffers } = await import('../matchmaking');
+    await myOffers();
+    const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
+    expect(select?.payload).toMatch(/\bmatch_id\b/);
+    expect(select?.payload).toMatch(/\bscheduled_for\b/);
+    expect(select?.payload).toMatch(/\baccepted_by\b/);
+    expect(select?.payload).toMatch(/\bstate\b/);
+  });
+
+  it('refuses to list the offers of nobody in particular', async () => {
+    harness({}, {}, null);
+    const { myOffers } = await import('../matchmaking');
+    await expect(myOffers()).rejects.toThrow(/must be signed in/);
+  });
+
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
diff --git a/app/src/lib/__tests__/saves.test.ts b/app/src/lib/__tests__/saves.test.ts
index a9acf14..14d8bd5 100644
--- a/app/src/lib/__tests__/saves.test.ts
+++ b/app/src/lib/__tests__/saves.test.ts
@@ -6,41 +6,41 @@ vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
 
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
  * `errors` fails one table's writes the way PostgREST does — a code plus the
  * text it puts in `message`. Without it every query in this harness succeeds,
  * so nothing here could ever exercise a failure branch.
  */
 function harness(rows: Record<string, unknown[]>, errors: Record<string, { code: string; message: string }> = {}) {
   const calls: { table: string; op: string; payload?: unknown }[] = [];
   function table(name: string) {
     const q: Record<string, unknown> = {
-      select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
+      select: vi.fn((cols?: unknown) => { calls.push({ table: name, op: 'select', payload: cols }); return q; }),
       eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
       gt: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'gt', payload: [col, val] }); return q; }),
       // Recorded like every other modifier below, not a bare no-op: a caller
       // relying on referenced-table ordering (see the `listServerFormats`
       // test) needs its exact arguments visible, not just that `order` was
       // called with something.
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
   pkg.client = { from: vi.fn((n: string) => table(n)) };
   return { calls };
@@ -303,31 +303,68 @@ describe('listServerFormats', () => {
 
     const versionOrder = calls.find(
       (c) => c.table === 'formats' && c.op === 'order' && (c.payload as unknown[])[0] === 'version',
     );
     expect(versionOrder?.payload).toEqual(['version', { referencedTable: 'format_versions', ascending: false }]);
 
     const versionLimit = calls.find((c) => c.table === 'formats' && c.op === 'limit');
     expect(versionLimit?.payload).toEqual([1, { referencedTable: 'format_versions' }]);
   });
 
   it('still returns the highest version when the embed hands back more than one row', async () => {
     // The client-side backstop: even if the referenced-table limit above were
     // ever bypassed, listServerFormats must not report a stale version as
     // current.
     harness({
       formats: [
         {
           id: 'f1',
           name: 'Air Ban',
           format_versions: [
-            { version: 1, rules: FORMAT, rules_hash: 'h1' },
-            { version: 3, rules: FORMAT, rules_hash: 'h3' },
+            { id: 'fv-1', version: 1, rules: FORMAT, rules_hash: 'h1' },
+            { id: 'fv-3', version: 3, rules: FORMAT, rules_hash: 'h3' },
           ],
         },
       ],
     });
     const { listServerFormats } = await import('../saves');
     const formats = await listServerFormats();
-    expect(formats).toEqual([{ id: 'f1', name: 'Air Ban', format: FORMAT, version: 3, rulesHash: 'h3' }]);
+    expect(formats).toEqual([
+      { id: 'f1', name: 'Air Ban', format: FORMAT, version: 3, versionId: 'fv-3', rulesHash: 'h3' },
+    ]);
+  });
+
+  /**
+   * `versionId` is `format_versions.id`, and `id` is `formats.id` — two
+   * different tables. Matchmaking's `format_version_id` is a foreign key into
+   * the first; handing it the second would fail the key, and handing it the
+   * WRONG version's id would put two people in a match under rules neither of
+   * them is looking at. So this asserts the exact row it came from, and
+   * asserts it is not the format id.
+   */
+  it('surfaces the id of the version it returned, not the id of the format', async () => {
+    harness({
+      formats: [
+        {
+          id: 'f1',
+          name: 'Air Ban',
+          format_versions: [
+            { id: 'fv-1', version: 1, rules: FORMAT, rules_hash: 'h1' },
+            { id: 'fv-3', version: 3, rules: FORMAT, rules_hash: 'h3' },
+          ],
+        },
+      ],
+    });
+    const { listServerFormats } = await import('../saves');
+    const [f] = await listServerFormats();
+    expect(f.versionId).toBe('fv-3');
+    expect(f.versionId).not.toBe(f.id);
+  });
+
+  it('asks for the version id in the embed, or there is nothing to surface', async () => {
+    const { calls } = harness({ formats: [] });
+    const { listServerFormats } = await import('../saves');
+    await listServerFormats();
+    const select = calls.find((c) => c.table === 'formats' && c.op === 'select');
+    expect(select?.payload).toMatch(/format_versions\(\s*id\b/);
   });
 });
diff --git a/app/src/lib/matchmaking.ts b/app/src/lib/matchmaking.ts
index fd25cd4..97779cd 100644
--- a/app/src/lib/matchmaking.ts
+++ b/app/src/lib/matchmaking.ts
@@ -7,52 +7,64 @@ import type { StoredMember } from './teamCodec';
 export interface QueueEntry {
   id: string;
   league: LeagueId;
   formatVersionId: string;
   /** Null until the coordinator has recomputed the hash. Render as "checking…". */
   verifiedHash: string | null;
   expiresAt: string;
 }
 
 export interface Match {
   id: string;
   opponentId: string;
   formatVersionId: string;
   rulesHash: string;
   dataRev: string;
   rounds: number;
   source: 'queue' | 'offer';
   createdAt: string;
 }
 
+export type OfferState = 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
+
 export interface Offer {
   id: string;
   proposerId: string;
   league: LeagueId;
   formatVersionId: string;
   /** Null for the live board; a timestamp for a scheduled proposal. */
   scheduledFor: string | null;
   expiresAt: string;
-  state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
+  state: OfferState;
   acceptedBy: string | null;
 }
 
+/**
+ * An offer the signed-in person is party to. The extra field over `Offer` is
+ * the match it became: an offer only carries one once it has been confirmed
+ * (or, for a live offer, converted on acceptance), so a null `matchId` beside
+ * `state = 'accepted'` is precisely the handshake still waiting on someone.
+ */
+export interface MyOffer extends Offer {
+  matchId: string | null;
+}
+
 /**
  * `user_id` is never sent from here, same rule as `saves.ts`: it defaults to
  * `auth.uid()` in the database, so a client-supplied owner is never a second
  * source of truth the policy has to agree with.
  *
  * `claimed_hash` is computed here with `rulesHash`, never accepted as a
  * caller-supplied value — the coordinator recomputes it independently and
  * writes `verified_hash`, and only a verified entry is eligible to pair. A
  * hash this function trusted a caller for would be a hash the coordinator
  * could never have caught a lie in.
  */
 export async function joinQueue(a: {
   league: LeagueId;
   formatVersionId: string;
   format: Format;
   team: StoredMember[];
 }): Promise<string> {
   const { data, error } = await supabase
     .from('queue_entries')
     .insert({
@@ -161,52 +173,117 @@ export async function myMatches(): Promise<Match[]> {
     };
   });
 }
 
 export async function listOpenOffers(league: LeagueId): Promise<Offer[]> {
   const { data, error } = await supabase
     .from('match_offers')
     .select('id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by')
     .eq('league', league)
     .eq('state', 'open')
     .order('created_at', { ascending: false });
   if (error) throw new Error(error.message);
   return (data ?? []).map((row) => {
     const r = row as {
       id: string;
       proposer_id: string;
       league: LeagueId;
       format_version_id: string;
       scheduled_for: string | null;
       expires_at: string;
-      state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
+      state: OfferState;
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
+ * Every offer the signed-in person is party to — the ones they proposed AND
+ * the ones they accepted — in every state, not just `open`.
+ *
+ * `listOpenOffers` cannot do this job and must not be widened to try. An
+ * offer leaves `state = 'open'` the instant someone accepts it, so a proposer
+ * whose only view of their own proposal was the open board loses sight of it
+ * at exactly the moment it needs their confirmation — the offer then lapses
+ * on its own expiry and the match is never created. The taker is stranded the
+ * same way: their acceptance is a row they can no longer see. Both sides need
+ * to rediscover the handshake on a fresh page load, from the database, which
+ * is what this reads.
+ *
+ * `match_id` is selected here and nowhere else: it is the only thing that
+ * distinguishes "confirmed, and here is the match it became" from a state
+ * string alone.
+ *
+ * Both halves of the OR are already readable under the existing policies —
+ * "an offer belongs to the person who proposed it" covers the proposer's own
+ * rows in any state, and "a public offer is readable by anyone signed in"
+ * covers the taker's. The filter is not what makes this safe; it is what
+ * keeps the answer to "mine" from being "everyone's".
+ *
+ * `getSession()`, not `getUser()`: a local read of the already-verified
+ * session, the same choice `leaveQueue` and `myMatches` make above.
+ */
+export async function myOffers(): Promise<MyOffer[]> {
+  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
+  if (sessionError) throw new Error(sessionError.message);
+  const me = sessionData.session?.user.id;
+  if (!me) throw new Error('you must be signed in to list your offers');
+  const { data, error } = await supabase
+    .from('match_offers')
+    .select(
+      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, match_id',
+    )
+    .or(`proposer_id.eq.${me},accepted_by.eq.${me}`)
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
+      state: OfferState;
       accepted_by: string | null;
+      match_id: string | null;
     };
     return {
       id: r.id,
       proposerId: r.proposer_id,
       league: r.league,
       formatVersionId: r.format_version_id,
       scheduledFor: r.scheduled_for,
       expiresAt: r.expires_at,
       state: r.state,
       acceptedBy: r.accepted_by,
+      matchId: r.match_id,
     };
   });
 }
 
 /**
  * `proposer_id` is never sent, same rule as `user_id` above. Checked BEFORE
  * any network call: a scheduled offer in the past is refused here so the
  * caller learns why without a round trip, and before the database's own
  * `match_offers_scheduled_future` constraint would say the same thing less
  * legibly.
  */
 export async function createOffer(a: {
   league: LeagueId;
   formatVersionId: string;
   format: Format;
   team: StoredMember[];
   scheduledFor?: Date;
 }): Promise<string> {
   if (a.scheduledFor && a.scheduledFor <= new Date()) {
     throw new Error('a scheduled offer cannot be in the past');
diff --git a/app/src/lib/saves.ts b/app/src/lib/saves.ts
index 5264761..89cfbe2 100644
--- a/app/src/lib/saves.ts
+++ b/app/src/lib/saves.ts
@@ -118,67 +118,88 @@ export async function saveTeam(t: {
     if (t.members.length > 0) {
       const { error: insertError } = await supabase
         .from('team_members')
         .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
       if (insertError) throw new Error(insertError.message);
     }
   }
   return id;
 }
 
 export async function deleteTeam(id: string): Promise<void> {
   const { error } = await supabase.from('teams').delete().eq('id', id);
   if (error) throw new Error(error.message);
 }
 
 export interface SavedFormat {
   id: string;
   name: string;
   format: Format;
   version: number;
+  /**
+   * `format_versions.id` for that version — a different table from `id`
+   * above, which is `formats.id`. This is the one a queue entry or a match
+   * offer points its `format_version_id` foreign key at: what two people
+   * agreed to play is an immutable VERSION, not a format whose next save
+   * would silently change the rules of a match already in flight.
+   */
+  versionId: string;
   rulesHash: string;
 }
 
 export async function listServerFormats(): Promise<SavedFormat[]> {
   const { data, error } = await supabase
     .from('formats')
-    .select('id, name, format_versions(version, rules, rules_hash)')
+    .select('id, name, format_versions(id, version, rules, rules_hash)')
     .order('updated_at', { ascending: false })
     // Every save appends a version, so a format with a long edit history has
     // a `format_versions` row per edit — and this list re-runs after every
     // save and delete. Without these, the embed pulls every version's full
     // `rules` jsonb only to throw all but the newest away on the next line.
     // PostgREST orders and limits the embedded table itself when told which
     // table the modifier applies to.
     .order('version', { referencedTable: 'format_versions', ascending: false })
     .limit(1, { referencedTable: 'format_versions' });
   if (error) throw new Error(error.message);
   return (data ?? []).flatMap((row) => {
-    const r = row as { id: string; name: string; format_versions: { version: number; rules: Format; rules_hash: string }[] };
+    const r = row as {
+      id: string;
+      name: string;
+      format_versions: { id: string; version: number; rules: Format; rules_hash: string }[];
+    };
     // The current version is the highest one; there is no pointer column to
     // disagree with it. The query above should already hand back only that
     // one row, but re-selecting the max client-side costs nothing and is a
     // correctness backstop if the referenced-table ordering above ever
     // regresses.
     const latest = [...r.format_versions].sort((a, b) => b.version - a.version)[0];
     if (!latest) return [];
-    return [{ id: r.id, name: r.name, format: latest.rules, version: latest.version, rulesHash: latest.rules_hash }];
+    return [
+      {
+        id: r.id,
+        name: r.name,
+        format: latest.rules,
+        version: latest.version,
+        versionId: latest.id,
+        rulesHash: latest.rules_hash,
+      },
+    ];
   });
 }
 
 export async function saveServerFormat(f: { id?: string; name: string; format: Format }): Promise<string> {
   let id = f.id;
   if (id) {
     const { error } = await supabase
       .from('formats')
       .update({ name: f.name, updated_at: new Date().toISOString() })
       .eq('id', id);
     if (error) throw new Error(error.message);
   } else {
     const { data, error } = await supabase.from('formats').insert({ name: f.name }).select('id').single();
     if (error) throw new Error(error.message);
     id = (data as { id: string }).id;
   }
   const { data: prior } = await supabase
     .from('format_versions')
     .select('version')
     .eq('format_id', id)
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
index 2418d8f..47c041c 100644
--- a/app/src/screens/MatchmakingScreen.tsx
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -1,389 +1,481 @@
 import { useEffect, useMemo, useState } from 'react';
 import { ScreenHeader } from '../components/ScreenHeader';
 import { PokemonCard } from '../components/PokemonCard';
 import { SpeciesSearch } from '../components/SpeciesSearch';
 import type { AddPokemonChoice } from '../components/AddPokemonModal';
 import { useAppState } from '../state/AppState';
 import { useSession } from '../state/SessionContext';
 import { LEAGUE_BY_ID, conflictsOnTeam, movesFor, pickableFor, speciesOf } from '../lib/data';
 import { defaultSpreadFor } from '../lib/engine';
 import { encodeMember, type StoredMember } from '../lib/teamCodec';
-import { RULES_SCHEMA, type Format } from '../rules';
 import type { LeagueId } from '../lib/types';
 import {
   acceptOffer,
   confirmOffer,
   createOffer,
   joinQueue,
   leaveQueue,
   listOpenOffers,
   myMatches,
+  myOffers,
   myQueueEntry,
   opponentFriendCode,
   type Match,
+  type MyOffer,
   type Offer,
   type QueueEntry,
 } from '../lib/matchmaking';
+import { listServerFormats, type SavedFormat } from '../lib/saves';
 
 /**
  * The Matchmaking screen: three answers to one question — who do I play next
  * — on one screen. A blind queue paired by the coordinator, a live board of
  * offers anyone can browse and accept, and scheduled proposals that need
  * both sides to confirm before they become a match.
  *
- * The roster is built right here rather than loaded from a saved team: this
- * screen's "Consumes" list is deliberately narrow (Task 7's matchmaking API,
- * `useSession`, `LEAGUE_BY_ID`), and pulling in `lib/saves`' saved-team and
- * saved-format machinery would have meant mocking a second module boundary
- * this screen's tests were never asked to cover. What is built here is
- * scored under the league's own rated moveset — the same fallback `Slot`
- * uses on `TeamBuilderScreen` for a member that was never opened in a build
- * picker.
+ * **What you queue under.** M2a queues with a format the person has SAVED ON
+ * THE SERVER, chosen here by name. Canonical per-league league formats are
+ * deferred to the ranked milestone: the spec ties them to ranked play, M2a
+ * has no rating, and partitioning the queue by `rules_hash` already means two
+ * people who authored the same rules meet each other. So `formatVersionId` is
+ * a real `format_versions.id` from `listServerFormats`, not a placeholder —
+ * the earlier `canonical:${league}` string was a value no foreign key could
+ * ever have accepted. Someone with no saved format for this league is told
+ * so and offered no control that could only fail.
  *
- * `formatVersionId`/`format` are the "canonical league format" the design
- * spec describes for the open queue: the whole base league, no extra
- * clauses. See the KNOWN GAP note on `canonicalFormatVersionId` below —
- * there is currently no code anywhere, in this screen or elsewhere, that can
- * produce or discover a *real* `format_versions.id` for it.
+ * The roster is built right here rather than loaded from a saved team, and
+ * scored under the league's own rated moveset — the same fallback `Slot` uses
+ * on `TeamBuilderScreen` for a member that was never opened in a build
+ * picker. How many members it needs comes from the chosen format's
+ * `composition.size`, not a constant: the format is the thing that says how
+ * big a roster is.
  */
 
-const ROSTER_SIZE = 3;
-
-function canonicalFormat(league: LeagueId): Format {
-  return {
-    schema: RULES_SCHEMA,
-    base: league,
-    start: 'league',
-    pool: [],
-    composition: { size: ROSTER_SIZE, uniqueSpecies: true },
-    selection: { mode: 'open' },
-  };
-}
-
-/**
- * KNOWN GAP, reported rather than papered over (see task-8-report.md): a
- * `format_version_id` is a foreign key into `format_versions`, and nothing
- * in this codebase today can produce or discover a real one for a league's
- * canonical, unrestricted ruleset — there is no seed migration for it, and
- * `lib/saves.ts`'s `listServerFormats` doesn't expose `format_versions.id`
- * for a custom saved format either (only `formats.id`, a different table).
- * This placeholder keeps the shape of the write honest rather than hiding
- * the gap; `joinQueue`/`createOffer` will fail their foreign key against a
- * real database until that plumbing exists.
- */
-function canonicalFormatVersionId(league: LeagueId): string {
-  return `canonical:${league}`;
-}
+/** Only until a format is chosen — the empty slots have to be some number. */
+const DEFAULT_ROSTER_SIZE = 3;
 
 function messageOf(e: unknown): string {
   return e instanceof Error ? e.message : String(e);
 }
 
 /** What a member saves as when it was never opened in a build picker — the
  * league's rated set, same fallback `TeamBuilderScreen`'s `Slot` uses. */
 function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
   const sp = speciesOf(refId);
   if (!sp) return { ref: refId, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } };
   const rated = movesFor(sp, leagueId);
   const spread = defaultSpreadFor(refId, leagueId, true);
   return {
     ref: refId,
     fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
     chargeIds: rated.charges.map((c) => c.id),
     iv: { a: spread.a, d: spread.d, s: spread.s },
   };
 }
 
 function queueStatusText(entry: QueueEntry): string {
   // `verifiedHash` is null until the coordinator recomputes it; only a
   // verified entry is eligible to pair. Saying "queued" alone would imply a
   // match is imminent when it may not even be checked yet.
   return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
 }
 
+/**
+ * Where an offer has got to, said from the reader's own side of it. The two
+ * sides are not symmetric: `accepted` is "your move" to the proposer and
+ * "waiting on them" to the taker, and telling either one the other's sentence
+ * is how someone sits waiting for a handshake that was waiting for them.
+ */
+function offerStatusText(o: MyOffer, proposed: boolean): string {
+  switch (o.state) {
+    case 'open':
+      return proposed ? 'Posted — nobody has accepted it yet.' : 'Still open.';
+    case 'accepted':
+      return proposed
+        ? 'Someone accepted. Confirm it to make it a match.'
+        : "You accepted — awaiting the proposer's confirmation.";
+    case 'confirmed':
+    case 'converted':
+      return 'Confirmed — this is a match now.';
+    case 'lapsed':
+      return 'Lapsed — the window closed before it was confirmed.';
+  }
+}
+
 export function MatchmakingScreen() {
   const { state } = useAppState();
   const { user } = useSession();
   const league = state.league;
 
+  // --- the format being queued under --------------------------------------
+  // Null while loading, [] once loaded and empty — a distinction the screen
+  // renders, since "you have no saved formats" is a wrong thing to say to
+  // someone whose formats simply have not arrived yet.
+  const [savedFormats, setSavedFormats] = useState<SavedFormat[] | null>(null);
+  const [chosenId, setChosenId] = useState<string | null>(null);
+
+  const leagueFormats = useMemo(
+    () => (savedFormats ?? []).filter((f) => f.format.base === league),
+    [savedFormats, league],
+  );
+  // Filtered to this league's own formats: `league` is what the queue and the
+  // board are partitioned on, and offering a Master format while the screen
+  // says Great would queue someone under rules they are not looking at.
+  const chosen = leagueFormats.find((f) => f.id === chosenId) ?? leagueFormats[0] ?? null;
+  const rosterSize = chosen ? chosen.format.composition.size : DEFAULT_ROSTER_SIZE;
+
   // --- the roster, built locally on this screen ---------------------------
   const [team, setTeam] = useState<string[]>([]);
   const selectable = useMemo(
     () => new Set(pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))),
     [league, team],
   );
   const add = (ref: string) => {
     setTeam((t) =>
-      t.includes(ref) || t.length >= ROSTER_SIZE || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
+      t.includes(ref) || t.length >= rosterSize || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
     );
   };
   const clear = (i: number) => setTeam((t) => t.filter((_, n) => n !== i));
   const buildTeam = (): StoredMember[] => team.map((ref) => encodeMember(defaultChoice(ref, league), league));
-  const rosterReady = team.length === ROSTER_SIZE;
+  const rosterReady = !!chosen && team.length === rosterSize;
+
+  // A format with a smaller roster leaves members past its size unreachable —
+  // invisible in the slots, but still counted, so the roster could never be
+  // "ready" again without a member nobody can see being removed.
+  useEffect(() => {
+    setTeam((t) => (t.length > rosterSize ? t.slice(0, rosterSize) : t));
+  }, [rosterSize]);
 
   // --- the blind queue ------------------------------------------------------
   const [entry, setEntry] = useState<QueueEntry | null>(null);
   const [matches, setMatches] = useState<Match[] | null>(null);
   const [codes, setCodes] = useState<Record<string, string | null>>({});
   const [busy, setBusy] = useState(false);
   const [notice, setNotice] = useState<string | null>(null);
 
   useEffect(() => {
     if (!user) {
       setEntry(null);
       setMatches(null);
       setCodes({});
+      setSavedFormats(null);
       return;
     }
     let live = true;
+    void listServerFormats()
+      .then((f) => {
+        if (live) setSavedFormats(f);
+      })
+      .catch((e: unknown) => {
+        if (live) {
+          setSavedFormats([]);
+          setNotice(messageOf(e));
+        }
+      });
     void myQueueEntry()
       .then((e) => {
         if (live) setEntry(e);
       })
       .catch((e: unknown) => {
         if (live) setNotice(messageOf(e));
       });
     void myMatches()
       .then((m) => {
         if (live) setMatches(m);
       })
       .catch((e: unknown) => {
         if (live) setNotice(messageOf(e));
       });
     return () => {
       live = false;
     };
   }, [user]);
 
   // Friend codes are readable only once a match pairs two people — fetched
   // once matches are known, one call per opponent, never guessed at.
   useEffect(() => {
     if (!matches || matches.length === 0) return;
     let live = true;
     void Promise.all(
       matches.map((m) => opponentFriendCode(m.opponentId).then((code) => [m.opponentId, code] as const)),
     ).then((pairs) => {
       if (live) setCodes(Object.fromEntries(pairs));
     });
     return () => {
       live = false;
     };
   }, [matches]);
 
   const join = async () => {
-    if (!rosterReady || entry || busy) return;
+    if (!chosen || !rosterReady || entry || busy) return;
     setBusy(true);
     setNotice(null);
     try {
+      // The version id, not the format id: what two people agreed to play is
+      // an immutable version, so editing this format afterwards cannot change
+      // the rules of a match already queued under it.
       await joinQueue({
         league,
-        formatVersionId: canonicalFormatVersionId(league),
-        format: canonicalFormat(league),
+        formatVersionId: chosen.versionId,
+        format: chosen.format,
         team: buildTeam(),
       });
       setEntry(await myQueueEntry());
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
 
   const leave = async () => {
     if (!entry) return;
     // Irreversible the moment it lands — the same confirm idiom
     // `TeamBuilderScreen` uses before `deleteTeam`.
     if (!window.confirm('Leave the queue? You will stop being matched until you join again.')) return;
     setBusy(true);
     setNotice(null);
     try {
       await leaveQueue();
       setEntry(null);
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
 
   // --- the open offer board --------------------------------------------------
   const [offers, setOffers] = useState<Offer[] | null>(null);
   const [justAccepted, setJustAccepted] = useState<{ offerId: string; matchId: string | null } | null>(null);
   const [postOpen, setPostOpen] = useState(false);
   const [scheduleAt, setScheduleAt] = useState('');
-  // Offers this screen has posted this session, so a Confirm control can be
-  // offered for them. There is no function anywhere in `lib/matchmaking` to
-  // list "offers I proposed" (only `listOpenOffers`, scoped to `state =
-  // 'open'`, which an accepted offer has already left) — see the report.
-  // Confirming one nobody has actually accepted yet simply answers with
-  // whatever error `confirm_offer` raises; that is surfaced, not hidden.
-  const [posted, setPosted] = useState<{ id: string; scheduledFor: string | null }[]>([]);
+  // Every offer this person is party to, READ FROM THE DATABASE — proposed or
+  // accepted, in whatever state. Not session state: an offer leaves
+  // `state = 'open'` the moment someone accepts it, so a panel driven by what
+  // this tab happened to post would forget the handshake on reload, and
+  // `listOpenOffers` would never hand it back. That is the offer lapsing and
+  // the match never being created.
+  const [mine, setMine] = useState<MyOffer[] | null>(null);
 
   useEffect(() => {
     if (!user) {
       setOffers(null);
+      setMine(null);
       return;
     }
     let live = true;
     void listOpenOffers(league)
       .then((o) => {
         if (live) setOffers(o);
       })
       .catch((e: unknown) => {
         if (live) setNotice(messageOf(e));
       });
     return () => {
       live = false;
     };
   }, [user, league]);
 
+  useEffect(() => {
+    if (!user) return;
+    let live = true;
+    void myOffers()
+      .then((o) => {
+        if (live) setMine(o);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    return () => {
+      live = false;
+    };
+  }, [user]);
+
   const accept = async (o: Offer) => {
     if (!user || o.proposerId === user.id || !rosterReady || busy) return;
     setBusy(true);
     setNotice(null);
     try {
       const matchId = await acceptOffer(o.id, buildTeam());
       setOffers((prev) => (prev ? prev.filter((x) => x.id !== o.id) : prev));
       setJustAccepted({ offerId: o.id, matchId });
+      // Re-read what this person is party to: the offer just accepted is now
+      // one of them, and this is the read that will still find it tomorrow.
+      setMine(await myOffers());
       // A live offer resolves to a match id immediately; a scheduled one
       // returns null and stays `accepted`, not a match, until the proposer
       // confirms — rendering null as "matched" would put a battle on
       // someone's calendar nobody actually agreed to yet.
       if (matchId) setMatches(await myMatches());
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
 
   const post = async (scheduled: boolean) => {
-    if (!rosterReady || busy) return;
+    if (!chosen || !rosterReady || busy) return;
     let scheduledFor: Date | undefined;
     if (scheduled) {
       if (!scheduleAt) {
         setNotice('Pick a date and time to schedule for.');
         return;
       }
       scheduledFor = new Date(scheduleAt);
     }
     setBusy(true);
     setNotice(null);
     try {
-      const id = await createOffer({
+      await createOffer({
         league,
-        formatVersionId: canonicalFormatVersionId(league),
-        format: canonicalFormat(league),
+        formatVersionId: chosen.versionId,
+        format: chosen.format,
         team: buildTeam(),
         scheduledFor,
       });
-      setPosted((p) => [...p, { id, scheduledFor: scheduledFor ? scheduledFor.toISOString() : null }]);
       setPostOpen(false);
       setScheduleAt('');
       setOffers(await listOpenOffers(league));
+      // Read the new offer back rather than remembering it here: what this
+      // panel shows has to be there after a reload too.
+      setMine(await myOffers());
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
 
   const confirm = async (id: string) => {
     setBusy(true);
     setNotice(null);
     try {
       await confirmOffer(id);
-      setPosted((p) => p.filter((o) => o.id !== id));
+      setMine(await myOffers());
       setMatches(await myMatches());
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
 
   if (!user) {
     return (
       <div className="matchmaking-screen">
         <ScreenHeader
           title="Matches"
           blurb="Queue for a blind match, browse an open offer, or schedule one for later."
         />
         <div className="panel text-muted">Sign in to queue for a match, browse the open offer board, or schedule one for later.</div>
       </div>
     );
   }
 
   return (
     <div className="matchmaking-screen">
       <ScreenHeader
         title="Matches"
         blurb="Queue for a blind match, browse an open offer, or schedule one for later."
       />
 
+      <div className="panel panel-strong">
+        <div className="hud-label">Format for {LEAGUE_BY_ID.get(league)?.label ?? league}</div>
+        {savedFormats === null && <p className="text-faint">Reading your saved formats…</p>}
+        {savedFormats !== null && leagueFormats.length === 0 && (
+          <p className="text-muted no-formats">
+            You have no saved format for this league. Author one on the Formats screen and save it to your
+            account — a match is played under a saved format, so there is nothing to queue with until then.
+          </p>
+        )}
+        {leagueFormats.length > 0 && (
+          <div className="format-choices">
+            {leagueFormats.map((f) => (
+              <button
+                key={f.id}
+                type="button"
+                className="btn seg-btn format-choice"
+                data-format-id={f.id}
+                aria-pressed={chosen?.id === f.id}
+                onClick={() => setChosenId(f.id)}
+              >
+                {f.name}
+              </button>
+            ))}
+          </div>
+        )}
+      </div>
+
       <div className="panel panel-strong">
         <div className="hud-label">
           Your roster for {LEAGUE_BY_ID.get(league)?.label ?? league}
         </div>
         <div className="team-slots">
-          {Array.from({ length: ROSTER_SIZE }, (_, i) => {
+          {Array.from({ length: rosterSize }, (_, i) => {
             const r = team[i] ?? null;
             return r ? (
               <PokemonCard key={i} refId={r} league={league} size="compact" onClick={() => clear(i)} title="Click to remove" />
             ) : (
               <div key={i} className="team-slot is-empty">
                 <span className="team-slot-hint">Empty</span>
               </div>
             );
           })}
         </div>
         <div className="team-add">
           <SpeciesSearch
             key={team.length}
             id="matchmaking-team-add"
             value=""
             onChange={add}
             placeholder="Add a Pokémon to this roster"
             includeShadow
             restrictTo={selectable}
           />
         </div>
       </div>
 
       <div className="panel">
         <div className="hud-label">Blind queue</div>
         <p className="text-muted">
           Matched with anyone else queued under the same league and rules, blind — no format to browse, no
           opponent to pick.
         </p>
         {entry && <p className="queue-status">{queueStatusText(entry)}</p>}
         <div className="matchmaking-actions">
-          <button
-            type="button"
-            className="btn btn-primary queue-join"
-            disabled={!rosterReady || !!entry || busy}
-            title={!rosterReady ? `Add ${ROSTER_SIZE - team.length} more to queue` : undefined}
-            onClick={() => void join()}
-          >
-            {busy ? 'Working…' : 'Join queue'}
-          </button>
+          {/* No Join at all without a format to join under: `format_version_id`
+              is NOT NULL and a foreign key, so the call could only fail. Same
+              rule as the Accept control on one's own offer. */}
+          {chosen && (
+            <button
+              type="button"
+              className="btn btn-primary queue-join"
+              disabled={!rosterReady || !!entry || busy}
+              title={!rosterReady ? `Add ${rosterSize - team.length} more to queue` : undefined}
+              onClick={() => void join()}
+            >
+              {busy ? 'Working…' : 'Join queue'}
+            </button>
+          )}
           {entry && (
             <button type="button" className="btn" disabled={busy} onClick={() => void leave()}>
               Leave queue
             </button>
           )}
         </div>
         {matches && matches.length > 0 && (
           <ul className="match-list">
             {matches.map((m) => (
               <li key={m.id} className="match-row">
                 <span>Match paired</span>
                 <span className="friend-code">
                   {codes[m.opponentId] === undefined
                     ? 'Loading friend code…'
                     : codes[m.opponentId]
                       ? `Friend code: ${codes[m.opponentId]}`
                       : 'No friend code on file for this opponent.'}
                 </span>
               </li>
             ))}
@@ -405,103 +497,126 @@ export function MatchmakingScreen() {
           </p>
         )}
         {offers && offers.length === 0 && <p className="text-faint">No open offers right now.</p>}
         {offers && offers.length > 0 && (
           <ul className="offer-list">
             {offers.map((o) => {
               const mine = o.proposerId === user.id;
               return (
                 <li key={o.id} className="offer-row" data-offer-id={o.id}>
                   <span className="offer-when">
                     {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
                   </span>
                   <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
                   {mine ? (
                     <span className="text-faint">Your offer</span>
                   ) : (
                     <button
                       type="button"
                       className="btn chip-btn offer-accept"
                       disabled={!rosterReady || busy}
-                      title={!rosterReady ? `Add ${ROSTER_SIZE - team.length} more to accept` : undefined}
+                      title={!rosterReady ? `Add ${rosterSize - team.length} more to accept` : undefined}
                       onClick={() => void accept(o)}
                     >
                       Accept
                     </button>
                   )}
                 </li>
               );
             })}
           </ul>
         )}
 
         {/* Overlays the panel rather than growing it — the board must not
-            shove anything below it down the page as offers arrive. */}
+            shove anything below it down the page as offers arrive. The list
+            above is bounded and scrolls for the same reason. */}
         <div className="move-picker">
+          {chosen && (
           <button
             type="button"
             className="btn move-picker-btn"
             aria-expanded={postOpen}
             onClick={() => setPostOpen((o) => !o)}
           >
             Post an offer
           </button>
-          {postOpen && (
+          )}
+          {chosen && postOpen && (
             <div className="move-picker-panel offer-post-panel">
               <button
                 type="button"
                 className="btn btn-primary"
                 disabled={!rosterReady || busy}
                 onClick={() => void post(false)}
               >
                 Post to the open board
               </button>
               <div className="offer-schedule-row">
                 <input
                   type="datetime-local"
                   className="input"
                   value={scheduleAt}
                   onChange={(e) => setScheduleAt(e.target.value)}
                 />
                 <button
                   type="button"
                   className="btn"
                   disabled={!rosterReady || busy || !scheduleAt}
                   onClick={() => void post(true)}
                 >
                   Schedule
                 </button>
               </div>
             </div>
           )}
         </div>
       </div>
 
-      {posted.length > 0 && (
+      {mine && mine.length > 0 && (
         <div className="panel">
-          <div className="hud-label">Your posted offers</div>
+          <div className="hud-label">Your offers</div>
           <p className="text-muted">
-            A scheduled offer becomes a match only once you confirm it here after someone accepts.
+            Every offer you proposed or accepted, read back from the server — so a scheduled proposal is
+            still here, and still confirmable, on your next visit.
           </p>
-          <ul className="posted-offer-list">
-            {posted.map((o) => (
-              <li key={o.id} className="posted-offer-row">
-                <span>
-                  {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Posted to the open board'}
-                </span>
-                <button type="button" className="btn" disabled={busy} onClick={() => void confirm(o.id)}>
-                  Confirm
-                </button>
-              </li>
-            ))}
+          <ul className="my-offer-list">
+            {mine.map((o) => {
+              const proposed = o.proposerId === user.id;
+              return (
+                <li key={o.id} className="my-offer-row" data-my-offer-id={o.id} data-offer-state={o.state}>
+                  <span className="my-offer-when">
+                    {o.scheduledFor
+                      ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}`
+                      : 'Posted to the open board'}
+                  </span>
+                  <span className="text-faint my-offer-status">{offerStatusText(o, proposed)}</span>
+                  {/* Confirm ONLY for the proposer of an offer someone has
+                      actually accepted. confirm_offer raises "only the
+                      proposer confirms" for the taker and "this offer has not
+                      been accepted yet" for every other state, so a Confirm
+                      anywhere else is a button whose entire behaviour is to
+                      print raw Postgres text at someone. */}
+                  {proposed && o.state === 'accepted' && (
+                    <button
+                      type="button"
+                      className="btn chip-btn offer-confirm"
+                      disabled={busy}
+                      onClick={() => void confirm(o.id)}
+                    >
+                      Confirm
+                    </button>
+                  )}
+                </li>
+              );
+            })}
           </ul>
         </div>
       )}
 
       {notice && (
         <p className="matchmaking-notice" role="alert">
           {notice}
         </p>
       )}
     </div>
   );
 }
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
index 648a1ea..1da0d72 100644
--- a/app/src/screens/__tests__/matchmaking.test.tsx
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -1,52 +1,65 @@
 import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { readFileSync } from 'node:fs';
 import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
 import type { Session } from '@supabase/supabase-js';
-import type { QueueEntry, Match, Offer } from '../../lib/matchmaking';
+import type { QueueEntry, Match, MyOffer, Offer } from '../../lib/matchmaking';
+import type { SavedFormat } from '../../lib/saves';
+import { RULES_SCHEMA } from '../../rules';
 
 /**
  * The Matchmaking screen: the blind queue, the open offer board, and
  * scheduled proposals.
  *
  * `../../lib/matchmaking` is mocked at the module boundary — the round trip
  * through Supabase belongs to `matchmaking.test.ts`, not here. What belongs
  * here is what the screen does with the nine functions it calls: whether it
  * calls them with the roster and format actually on screen, whether it asks
  * before an irreversible leave, whether a self-proposed offer is ever given
  * an Accept control the database would refuse anyway, and whether a `null`
  * return from `acceptOffer` (a scheduled offer awaiting the proposer's
  * confirmation) is ever rendered as a match.
  */
 
 const mmApi = vi.hoisted(() => ({
   joinQueue: vi.fn(),
   leaveQueue: vi.fn(),
   myQueueEntry: vi.fn(),
   myMatches: vi.fn(),
   listOpenOffers: vi.fn(),
+  myOffers: vi.fn(),
   createOffer: vi.fn(),
   acceptOffer: vi.fn(),
   confirmOffer: vi.fn(),
   opponentFriendCode: vi.fn(),
 }));
 vi.mock('../../lib/matchmaking', () => mmApi);
 
+/**
+ * `../../lib/saves` is mocked the same way, for the same reason — and it is
+ * mocked at all because a queue entry's `format_version_id` is a foreign key
+ * into `format_versions`, so the screen has to get a real one from somewhere.
+ * M2a's answer is a format the person saved to their account.
+ */
+const savesApi = vi.hoisted(() => ({ listServerFormats: vi.fn() }));
+vi.mock('../../lib/saves', () => savesApi);
+
 const pkg = vi.hoisted(() => ({ client: null as unknown }));
 vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
 
 function fakeSession(id: string, email: string): Session {
   return { access_token: 'tok', user: { id, email } } as unknown as Session;
 }
 
 function fakeClient(session: Session | null) {
   const auth = {
     getSession: vi.fn(async () => ({ data: { session }, error: null })),
     onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
     signOut: vi.fn(async () => ({ error: null })),
   };
   pkg.client = { auth };
   return auth;
 }
 
 /**
  * `lib/supabase` builds its client once at import time, so the mock above
  * only takes effect for an import that happens AFTER `pkg.client` is set —
@@ -95,103 +108,174 @@ async function pick(container: HTMLElement, typed: string) {
 async function pickThree(container: HTMLElement) {
   await pick(container, 'azumarill');
   await pick(container, 'registeel');
   await pick(container, 'skarmory');
 }
 
 function offer(over: Partial<Offer>): Offer {
   return {
     id: 'off-x',
     proposerId: 'someone-else',
     league: 'great',
     formatVersionId: 'v1',
     scheduledFor: null,
     expiresAt: new Date(Date.now() + 3600_000).toISOString(),
     state: 'open',
     acceptedBy: null,
     ...over,
   };
 }
 
+function savedFormat(over: Partial<SavedFormat> = {}): SavedFormat {
+  return {
+    id: 'f-great',
+    name: 'Great League Open',
+    version: 2,
+    versionId: 'fv-great-2',
+    rulesHash: 'h2',
+    format: {
+      schema: RULES_SCHEMA,
+      base: 'great',
+      pool: [],
+      composition: { size: 3, uniqueSpecies: true },
+      selection: { mode: 'open' },
+    },
+    ...over,
+  };
+}
+
+function myOffer(over: Partial<MyOffer>): MyOffer {
+  return {
+    id: 'mine-x',
+    proposerId: 'u1',
+    league: 'great',
+    formatVersionId: 'fv-great-2',
+    scheduledFor: null,
+    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
+    state: 'open',
+    acceptedBy: null,
+    matchId: null,
+    ...over,
+  };
+}
+
 function match(over: Partial<Match>): Match {
   return {
     id: 'm-x',
     opponentId: 'opp-1',
     formatVersionId: 'v1',
     rulesHash: 'hash',
     dataRev: 'rev1',
     rounds: 3,
     source: 'queue',
     createdAt: new Date().toISOString(),
     ...over,
   };
 }
 
 beforeEach(() => {
   mmApi.joinQueue.mockReset().mockResolvedValue('q1');
   mmApi.leaveQueue.mockReset().mockResolvedValue(undefined);
   mmApi.myQueueEntry.mockReset().mockResolvedValue(null);
   mmApi.myMatches.mockReset().mockResolvedValue([]);
   mmApi.listOpenOffers.mockReset().mockResolvedValue([]);
+  mmApi.myOffers.mockReset().mockResolvedValue([]);
   mmApi.createOffer.mockReset().mockResolvedValue('o1');
   mmApi.acceptOffer.mockReset().mockResolvedValue('m1');
   mmApi.confirmOffer.mockReset().mockResolvedValue('m1');
   mmApi.opponentFriendCode.mockReset().mockResolvedValue(null);
+  savesApi.listServerFormats.mockReset().mockResolvedValue([savedFormat()]);
 });
 afterEach(cleanup);
 
 describe('signed out', () => {
   it('offers nothing to sign in with when signed out', async () => {
     const { container } = await mount(null);
     expect(container.querySelector('.queue-join')).toBeFalsy();
     expect(container.textContent).toMatch(/sign in/i);
   });
 });
 
 describe('signed in — the blind queue', () => {
   it('cannot join with an incomplete roster', async () => {
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
     expect(joinBtn).toBeTruthy();
     expect(joinBtn.disabled).toBe(true);
   });
 
   it('joins the queue with the roster and format on screen', async () => {
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await pickThree(container);
     const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
     expect(joinBtn.disabled).toBe(false);
     await act(async () => {
       fireEvent.click(joinBtn);
     });
     await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
     const arg = mmApi.joinQueue.mock.calls[0][0] as {
       league: string;
       formatVersionId: string;
       format: { base: string };
       team: { ref: string }[];
     };
     expect(arg.league).toBe('great');
     expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
-    expect(typeof arg.formatVersionId).toBe('string');
-    expect(arg.formatVersionId.length).toBeGreaterThan(0);
-    expect(arg.format.base).toBe('great');
+    // The EXACT version id of the saved format on screen. "a non-empty
+    // string" was the earlier assertion, and it passed against the
+    // `canonical:great` placeholder that no foreign key could ever have
+    // accepted — an assertion no wrong value could fail is not coverage.
+    // `versionId` is `format_versions.id`; `id` is `formats.id`, a different
+    // table, and sending that one would fail the key just as quietly.
+    expect(arg.formatVersionId).toBe('fv-great-2');
+    expect(arg.formatVersionId).not.toBe('f-great');
+    expect(arg.format).toEqual(savedFormat().format);
+  });
+
+  it('offers no Join at all when there is no saved format to join under', async () => {
+    savesApi.listServerFormats.mockResolvedValue([]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.querySelector('.no-formats')).toBeTruthy());
+    // `format_version_id` is NOT NULL and a foreign key: with nothing to put
+    // in it, joining could only fail. Same rule as Accept on one's own offer.
+    expect(container.querySelector('.queue-join')).toBeFalsy();
+    expect(container.textContent).toMatch(/no saved format/i);
+  });
+
+  it('queues under the format that was chosen, not the first one listed', async () => {
+    savesApi.listServerFormats.mockResolvedValue([
+      savedFormat(),
+      savedFormat({ id: 'f-cup', name: 'Fossil Cup', versionId: 'fv-cup-7' }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const second = await waitFor(() => {
+      const b = container.querySelector('[data-format-id="f-cup"]');
+      if (!b) throw new Error('format choices not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    fireEvent.click(second);
+    await pickThree(container);
+    await act(async () => {
+      fireEvent.click(container.querySelector('.queue-join') as HTMLButtonElement);
+    });
+    await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
+    expect((mmApi.joinQueue.mock.calls[0][0] as { formatVersionId: string }).formatVersionId).toBe('fv-cup-7');
   });
 
   it('distinguishes queued-awaiting-verification from queued-and-eligible', async () => {
     mmApi.myQueueEntry.mockResolvedValue({
       id: 'q1',
       league: 'great',
       formatVersionId: 'v1',
       verifiedHash: null,
       expiresAt: new Date(Date.now() + 600_000).toISOString(),
     } satisfies QueueEntry);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => expect(container.textContent).toMatch(/awaiting verification/i));
     expect(container.textContent).not.toMatch(/eligible to pair/i);
   });
 
   it('shows a verified entry as eligible, not awaiting', async () => {
     mmApi.myQueueEntry.mockResolvedValue({
       id: 'q1',
       league: 'great',
       formatVersionId: 'v1',
@@ -309,48 +393,174 @@ describe('signed in — the open offer board', () => {
 
   it('posts an offer to the open board with the roster and format on screen', async () => {
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await pickThree(container);
     const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
     fireEvent.click(toggle);
     const postBtn = await waitFor(() => {
       const b = [...container.querySelectorAll('button')].find((x) => /Post to the open board/i.test(x.textContent ?? ''));
       if (!b) throw new Error('post button not rendered yet');
       return b as HTMLButtonElement;
     });
     await act(async () => {
       fireEvent.click(postBtn);
     });
     await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
     const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; team: { ref: string }[] };
     expect(arg.scheduledFor).toBeUndefined();
     expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
   });
 
-  it('schedules an offer for later with a scheduledFor date, and offers a Confirm control once posted', async () => {
+  it('schedules an offer for later with a scheduledFor date, and re-reads its own offers from the server', async () => {
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await pickThree(container);
     const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
     fireEvent.click(toggle);
     const dtInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
     const future = new Date(Date.now() + 3 * 86_400_000);
     const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T12:00`;
     fireEvent.change(dtInput, { target: { value: local } });
+    const before = mmApi.myOffers.mock.calls.length;
     const scheduleBtn = [...container.querySelectorAll('button')].find((b) => /^Schedule$/i.test(b.textContent ?? ''))!;
     await act(async () => {
       fireEvent.click(scheduleBtn);
     });
     await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
-    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date };
+    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; formatVersionId: string };
     expect(arg.scheduledFor).toBeInstanceOf(Date);
+    expect(arg.formatVersionId).toBe('fv-great-2');
+    // Read back, not remembered: what this panel shows has to survive the
+    // reload that throws every piece of session state away.
+    await waitFor(() => expect(mmApi.myOffers.mock.calls.length).toBeGreaterThan(before));
+  });
+});
 
-    const confirmBtn = await waitFor(() => {
-      const b = [...container.querySelectorAll('.posted-offer-row button')].find((x) => /Confirm/i.test(x.textContent ?? ''));
-      if (!b) throw new Error('confirm button not rendered yet');
-      return b as HTMLButtonElement;
+/**
+ * The handshake, after a reload.
+ *
+ * A scheduled offer needs two acts by two people, minutes or days apart, and
+ * neither of them is likely to still have this tab open. `listOpenOffers`
+ * cannot carry it: the offer leaves `state = 'open'` the moment it is
+ * accepted, which is exactly when the proposer needs to see it. Everything
+ * these tests mount is a FRESH screen that posted nothing this session — the
+ * panel is driven by what `myOffers` reports, or it is driven by nothing.
+ */
+describe('signed in — the handshake survives a reload', () => {
+  it('rediscovers an offer awaiting your confirmation, and confirms it', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({
+        id: 'off-accepted',
+        proposerId: 'u1',
+        acceptedBy: 'someone-else',
+        state: 'accepted',
+        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
+      }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-accepted"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
     });
+    expect(row.textContent).toMatch(/confirm it to make it a match/i);
+    const confirmBtn = row.querySelector('.offer-confirm') as HTMLButtonElement;
+    expect(confirmBtn).toBeTruthy();
     await act(async () => {
       fireEvent.click(confirmBtn);
     });
-    await waitFor(() => expect(mmApi.confirmOffer).toHaveBeenCalledWith('o1'));
+    await waitFor(() => expect(mmApi.confirmOffer).toHaveBeenCalledWith('off-accepted'));
+  });
+
+  it('tells the taker their acceptance is waiting on the proposer, and gives them no Confirm', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({
+        id: 'off-theirs',
+        proposerId: 'someone-else',
+        acceptedBy: 'u1',
+        state: 'accepted',
+        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
+      }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-theirs"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
+    });
+    expect(row.textContent).toMatch(/awaiting the proposer/i);
+    // `confirm_offer` raises "only the proposer confirms" for the taker.
+    expect(row.querySelector('.offer-confirm')).toBeFalsy();
+  });
+
+  it('offers no Confirm on an offer nobody has accepted yet', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({ id: 'off-open-live', proposerId: 'u1', state: 'open' }),
+      myOffer({
+        id: 'off-open-sched',
+        proposerId: 'u1',
+        state: 'open',
+        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
+      }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-my-offer-id="off-open-live"]')) throw new Error('not rendered yet');
+    });
+    // A live offer goes open -> converted on acceptance and never reaches
+    // `accepted`, so confirm_offer would raise "this offer has not been
+    // accepted yet" every single time and print that sentence at the person.
+    expect(container.querySelectorAll('.offer-confirm')).toHaveLength(0);
+    expect(container.textContent).toMatch(/nobody has accepted it yet/i);
+  });
+
+  it('shows a confirmed offer as a match rather than as something still to do', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({ id: 'off-done', proposerId: 'u1', acceptedBy: 'someone-else', state: 'converted', matchId: 'm9' }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-done"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
+    });
+    expect(row.textContent).toMatch(/this is a match now/i);
+    expect(row.querySelector('.offer-confirm')).toBeFalsy();
+  });
+});
+
+/**
+ * jsdom applies no stylesheet, so nothing here asserts a rendered box. What a
+ * test CAN hold is the rule itself, read as text — the established pattern in
+ * this repo (see `add-modal-size.test.tsx`). The board grows on its own as
+ * other people post to it; without a bound and its own scroll it pushes the
+ * Post control and every panel below it down the page while someone is
+ * reaching for them.
+ */
+describe('the offer board is bounded, not expanding', () => {
+  const css = readFileSync('src/styles/components.css', 'utf8');
+
+  function block(selector: string): string {
+    const i = css.search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
+    expect(i, `${selector} not found at the top level`).toBeGreaterThan(-1);
+    return css.slice(i, css.indexOf('}', i) + 1);
+  }
+
+  it('caps the open board and scrolls inside that cap', () => {
+    const rule = block('.offer-list');
+    expect(rule).toMatch(/max-height:\s*\d/);
+    expect(rule).toMatch(/overflow-y:\s*auto/);
+  });
+
+  it('caps your own offer list the same way', () => {
+    const rule = block('.my-offer-list');
+    expect(rule).toMatch(/max-height:\s*\d/);
+    expect(rule).toMatch(/overflow-y:\s*auto/);
+  });
+
+  it('declares each of those selectors once at the top level', () => {
+    // The .team-slots lesson: two rules for one selector, and the edit lands
+    // on whichever you read rather than whichever wins.
+    for (const sel of ['.offer-list', '.my-offer-list']) {
+      expect(css.match(new RegExp(`^\\${sel}\\s*\\{`, 'gm')) ?? [], sel).toHaveLength(1);
+    }
   });
 });
diff --git a/app/src/styles/components.css b/app/src/styles/components.css
index 08b5398..26ca446 100644
--- a/app/src/styles/components.css
+++ b/app/src/styles/components.css
@@ -5926,20 +5926,113 @@ th.bt-matrix-head { text-align: center; }
 }
 /* No --danger token in this design system (see the account block above); the
    secondary signal colour every theme defines is what a message like this
    uses instead. */
 .team-load-notice {
   margin-top: var(--space-2);
   font-size: var(--text-sm);
   line-height: 1.5;
   color: var(--color-accent-2-700);
   border-left: var(--border-strong) solid var(--color-accent-2-700);
   padding-left: var(--space-3);
 }
 /* The league a saved roster was built for, beside its name in the load list —
    a Great roster's IVs are not what an Ultra cap would have chosen, so which
    league it belongs to has to be visible before it is loaded, not just on
    the notice that fires afterward. */
 .team-load-league {
   flex: none;
   font-size: var(--text-xs);
 }
+
+/* --- Matchmaking ------------------------------------------------------- */
+
+.format-choices {
+  display: flex;
+  flex-wrap: wrap;
+  gap: var(--space-2);
+  margin-top: var(--space-2);
+}
+.matchmaking-actions {
+  display: flex;
+  align-items: center;
+  gap: var(--space-2);
+  flex-wrap: wrap;
+  margin-top: var(--space-2);
+}
+.queue-status {
+  margin-top: var(--space-2);
+  font-size: var(--text-sm);
+  color: var(--color-accent);
+}
+.match-list {
+  list-style: none;
+  margin: var(--space-2) 0 0;
+  padding: 0;
+  display: flex;
+  flex-direction: column;
+  gap: var(--space-1);
+}
+/* The board is bounded and scrolls INSIDE that bound. An open offer board
+   grows on its own — offers arrive from other people while this screen sits
+   open — and an unbounded list would push the Post control and the panels
+   under it down the page mid-click, moving the target out from under the
+   pointer. Same reason the post form overlays instead of expanding.
+   Written out in full rather than grouped with .match-list above: this is the
+   rule anyone comes here to read, and a cap that lives in one rule while the
+   selector also appears in another is the .team-slots trap. */
+.offer-list {
+  list-style: none;
+  margin: var(--space-2) 0 0;
+  padding: 0;
+  display: flex;
+  flex-direction: column;
+  gap: var(--space-1);
+  max-height: 240px;
+  overflow-y: auto;
+}
+/* Bounded for the same reason: your own offers accumulate as you post them. */
+.my-offer-list {
+  list-style: none;
+  margin: var(--space-2) 0 0;
+  padding: 0;
+  display: flex;
+  flex-direction: column;
+  gap: var(--space-1);
+  max-height: 240px;
+  overflow-y: auto;
+}
+.match-row,
+.offer-row,
+.my-offer-row {
+  display: flex;
+  align-items: center;
+  gap: var(--space-2);
+  flex-wrap: wrap;
+  font-size: var(--text-sm);
+}
+.offer-when,
+.my-offer-when {
+  flex: 1 1 12rem;
+  min-width: 8rem;
+}
+.friend-code {
+  font-family: var(--font-mono);
+  color: var(--color-accent);
+}
+.offer-schedule-row {
+  display: flex;
+  align-items: center;
+  gap: var(--space-2);
+  margin-top: var(--space-2);
+}
+/* No --danger token in this design system — the secondary signal colour every
+   theme defines is what a message like this uses instead (see
+   .team-load-notice above, the precedent this copies). */
+.matchmaking-notice {
+  margin-top: var(--space-2);
+  font-size: var(--text-sm);
+  line-height: 1.5;
+  color: var(--color-accent-2-700);
+  border-left: var(--border-strong) solid var(--color-accent-2-700);
+  padding-left: var(--space-3);
+}
