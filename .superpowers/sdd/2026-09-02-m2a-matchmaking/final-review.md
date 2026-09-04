# M2a whole-branch review package — aa34c185df520713f9963d86d27e95cb50647dcf..HEAD

## Commits
63f2586 test(m2a): two accounts, three routes into a match, against real Postgres
3a2cb7e docs(sdd): the mutation harness asserts uniqueness, and reports the region
7ee20b7 fix(matchmaking): an expired offer is not acceptable, and dead controls say why
c7bf63a fix(matchmaking): don't offer Accept on an offer nobody has verified yet
19ecf14 fix(matchmaking): accepting is the offer's business, not the accepter's
7dde301 fix(matchmaking): a handshake both sides can find again, under a real format
5c89a6c feat(matchmaking): the Matchmaking screen — queue, offer board, scheduled proposals
a86e114 fix(matchmaking): scope leaveQueue's delete, and stop paying for getUser()
ac4a3e7 feat(matchmaking): the client data layer for queue, offers and matches
f031a4e fix(coordinator): self-contained bundle types, and a guard against a stale one
36bf1f9 feat(coordinator): verify what a client claims, then pair what agrees
334aeda docs(task-5b): saved-rosters size-scoping implementation report
f8ad45d fix(saves): scope saved rosters to team size, closing the cross-size overwrite hole
52128a1 fix(db): confirm_offer refuses to convert an offer whose taker vanished
4ca27bc feat(db): pairing, accepting and lapsing, with the races settled in SQL
dfd6dbe test(offers): third leg for the taker-update denial proof
5c89f6f feat(db): offers you can browse, and offers you schedule
4e16ad5 test(db): falsify the friend-code policy's paired-state clause
74a174a feat(db): a blind queue, and matches no client may write
1ecbc3d docs(task-2): rules_hash implementation report
2636f88 feat(rules): rules_hash is a sha256, now that a queue partitions on it
576e2e9 docs(plan): extend the artefact guard, do not cast past it
f19f269 feat(data): a deterministic revision identifying this data build
d74761e docs(plan): build-data.mjs alone, not the whole data chain

## Files changed
 app/package.json                                   |   4 +-
 app/scripts/build-data.mjs                         |  12 +-
 app/scripts/verify-coordinator-bundle.mjs          |  51 ++
 app/src/App.tsx                                    |   5 +
 app/src/lib/__tests__/data.test.ts                 |   4 +
 app/src/lib/__tests__/matchmaking.test.ts          | 477 +++++++++++
 app/src/lib/__tests__/saves.test.ts                | 111 ++-
 app/src/lib/data.ts                                |  12 +-
 app/src/lib/matchmaking.ts                         | 380 +++++++++
 app/src/lib/saves.ts                               |  53 +-
 app/src/lib/screens.ts                             |  12 +
 app/src/rules/__tests__/hash.test.ts               |  26 +
 app/src/rules/hash.ts                              |  19 +
 app/src/rules/index.ts                             |   1 +
 app/src/screens/MatchmakingScreen.tsx              | 748 ++++++++++++++++
 app/src/screens/TeamBuilderScreen.tsx              |  50 +-
 app/src/screens/__tests__/matchmaking.test.tsx     | 942 +++++++++++++++++++++
 app/src/screens/__tests__/team-saves.test.tsx      | 147 +++-
 app/src/state/AppState.tsx                         |   2 +-
 app/src/styles/components.css                      | 121 +++
 app/tools/m2a-roundtrip.ts                         | 859 +++++++++++++++++++
 app/tsconfig.scripts.json                          |   5 +-
 .../plans/2026-09-02-m2a-matchmaking.md            |  14 +-
 supabase/functions/coordinator/index.ts            |  49 ++
 supabase/functions/coordinator/rules.bundle.d.ts   |   1 +
 supabase/functions/coordinator/rules.bundle.js     | 786 +++++++++++++++++
 .../20260902204023_queue_and_matches.sql           |  87 ++
 .../migrations/20260902205215_match_offers.sql     |  60 ++
 .../20260903005933_pairing_functions.sql           | 177 ++++
 ...03011151_confirm_offer_guards_deleted_taker.sql |  48 ++
 supabase/migrations/20260903020000_teams_size.sql  |  50 ++
 .../20260903030000_coordinator_schedule.sql        |  27 +
 supabase/tests/offers.test.ts                      | 109 +++
 supabase/tests/pairing.test.ts                     | 505 +++++++++++
 supabase/tests/queue.test.ts                       | 133 +++
 supabase/tests/teams.test.ts                       |  83 +-
 36 files changed, 6103 insertions(+), 67 deletions(-)

## Full diff (generated data and SDD workspace excluded)
diff --git a/app/package.json b/app/package.json
index da23e60..0ab5cec 100644
--- a/app/package.json
+++ b/app/package.json
@@ -7,24 +7,26 @@
     "dev": "vite",
     "build": "tsc -b && vite build",
     "lint": "oxlint",
     "themes": "esbuild scripts/build-themes.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/themes.mjs --log-level=warning && node node_modules/.cache/themes.mjs",
     "tokens": "node scripts/token-parity.mjs",
     "data": "node scripts/build-data.mjs && npm run best-spreads && npm run matrix && npm run teams && npm run summary",
     "summary": "esbuild scripts/build-summary.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/summary.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/summary.mjs",
     "matrix": "esbuild scripts/build-matrix.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/matrix.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/matrix.mjs",
     "teams": "esbuild scripts/build-teams.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/teams.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/teams.mjs",
     "verify": "esbuild scripts/verify-data.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/verify.mjs --log-level=warning && node node_modules/.cache/verify.mjs",
-    "check": "tsc -b && oxlint && npm run themes && npm run tokens && npm run verify && npm run audit:spreads && npm run rules:node && npm run test",
+    "check": "tsc -b && oxlint && npm run themes && npm run tokens && npm run verify && npm run audit:spreads && npm run rules:node && npm run verify:coordinator-bundle && npm run test",
     "preview": "vite preview",
     "audit:spreads": "esbuild scripts/audit-spreads.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/audit.mjs --log-level=warning && node node_modules/.cache/audit.mjs",
     "rules:node": "esbuild src/rules/index.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/rules-check.mjs --log-level=warning && node -e \"import('./node_modules/.cache/rules-check.mjs').then(m => { if (!Object.keys(m).length) process.exit(1) })\"",
+    "build:coordinator": "esbuild src/rules/index.ts --bundle --format=esm --platform=neutral --outfile=../supabase/functions/coordinator/rules.bundle.js --log-level=warning",
+    "verify:coordinator-bundle": "node scripts/verify-coordinator-bundle.mjs",
     "best-spreads": "esbuild scripts/build-best-spreads.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/best.mjs --log-level=warning && node node_modules/.cache/best.mjs",
     "splits": "esbuild scripts/analyse-splits.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/splits.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/splits.mjs",
     "matchups": "esbuild scripts/compare-matchups.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/matchups.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/matchups.mjs",
     "test": "vitest run",
     "test:watch": "vitest",
     "coverage": "vitest run --coverage",
     "db:start": "supabase start --workdir ..",
     "db:stop": "supabase stop --workdir ..",
     "db:reset": "supabase db reset --workdir ..",
     "check:db": "npm run db:start && vitest run --config vitest.db.config.ts"
diff --git a/app/scripts/build-data.mjs b/app/scripts/build-data.mjs
index f01b3ea..b89b14b 100644
--- a/app/scripts/build-data.mjs
+++ b/app/scripts/build-data.mjs
@@ -25,20 +25,21 @@
  * SHADOWS. Shadow variants are not emitted as separate rows. A shadow shares
  * its base form's stats, typing and movepool exactly, so it is represented as
  * `shadowEligible` plus a separate rank set, and the engine derives the
  * variant by applying the multipliers. That keeps the file ~1100 rows instead
  * of ~1600 and makes shadow a toggle rather than a parallel roster.
  */
 
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
+import { createHash } from 'node:crypto';
 
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 const SRC = path.resolve(HERE, '../../data-src');
 const OUT = path.resolve(HERE, '../src/data');
 
 const LEAGUES = [
   { id: 'great', cp: 1500, file: 'rankings-1500.json' },
   { id: 'ultra', cp: 2500, file: 'rankings-2500.json' },
   { id: 'master', cp: 10000, file: 'rankings-10000.json' },
 ];
@@ -408,21 +409,30 @@ const byId = new Map(species.map((s) => [s.id, s]));
 const opponents = {};
 for (const lg of LEAGUES) {
   const table = rankByLeague.get(lg.id);
   opponents[lg.id] = [...table.entries()]
     .filter(([id]) => byId.has(id))
     .sort((a, b) => a[1].rank - b[1].rank)
     .slice(0, CURATED_PER_LEAGUE)
     .map(([id]) => id);
 }
 
-fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify({ moves: moveTable, species }));
+const out = { moves: moveTable, species };
+
+// A stable identity for this data build. Taken over the payload with the key
+// order the writer already fixes, so regenerating unchanged inputs yields the
+// same rev — `verify-data` asserts species.json is byte-identical across
+// rebuilds and this must not be what breaks it.
+const payload = JSON.stringify({ moves: out.moves, species: out.species });
+out.dataRev = createHash('sha256').update(payload).digest('hex').slice(0, 16);
+
+fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify(out));
 fs.writeFileSync(path.join(OUT, 'opponents.json'), JSON.stringify(opponents, null, 2));
 
 // ── report ─────────────────────────────────────────────────────────────────
 const shadowCount = species.filter((s) => s.shadowEligible).length;
 const formCount = species.filter((s) => s.id.includes('_')).length;
 const embedded = species.reduce((n, s) => n + s.fastMoves.length + s.chargeMoves.length, 0);
 console.log(`species.json    ${species.length} entries (${formCount} alternate forms, ${shadowCount} shadow-eligible)`);
 console.log(`  moves         ${Object.keys(moveTable).length} interned, ${embedded} references`);
 for (const lg of LEAGUES) {
   const n = species.filter((s) => s.leagues.includes(lg.id)).length;
diff --git a/app/scripts/verify-coordinator-bundle.mjs b/app/scripts/verify-coordinator-bundle.mjs
new file mode 100644
index 0000000..2a9b75e
--- /dev/null
+++ b/app/scripts/verify-coordinator-bundle.mjs
@@ -0,0 +1,51 @@
+/**
+ * Staleness guard for the coordinator's bundled rules module.
+ *
+ *   npm run verify:coordinator-bundle (wired into `npm run check`)
+ *
+ * `supabase/functions/coordinator/rules.bundle.js` is a committed, generated
+ * file — `npm run build:coordinator` produces it from `src/rules/index.ts`.
+ * Nothing rebuilds it automatically and there is no CI, so an edit to
+ * `src/rules/*` that forgets the rebuild would leave the coordinator
+ * verifying hashes against a stale copy of the rules: two implementations,
+ * two answers, reached by drift instead of design. This rebuilds the same
+ * bundle to a throwaway path and diffs it byte-for-byte against the committed
+ * one, failing the gate the moment they disagree.
+ */
+import { execFileSync } from 'node:child_process';
+import fs from 'node:fs';
+import path from 'node:path';
+import os from 'node:os';
+
+const APP_DIR = new URL('..', import.meta.url).pathname;
+const COMMITTED = path.join(APP_DIR, '..', 'supabase', 'functions', 'coordinator', 'rules.bundle.js');
+const tmpOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-bundle-')), 'rules.bundle.js');
+
+execFileSync(
+  path.join(APP_DIR, 'node_modules', '.bin', 'esbuild'),
+  ['src/rules/index.ts', '--bundle', '--format=esm', '--platform=neutral', `--outfile=${tmpOut}`, '--log-level=warning'],
+  { cwd: APP_DIR, stdio: 'inherit' },
+);
+
+if (!fs.existsSync(COMMITTED)) {
+  console.error(
+    `supabase/functions/coordinator/rules.bundle.js does not exist.\nRun: npm run build:coordinator`,
+  );
+  process.exit(1);
+}
+
+const committed = fs.readFileSync(COMMITTED, 'utf8');
+const fresh = fs.readFileSync(tmpOut, 'utf8');
+
+if (committed !== fresh) {
+  console.error(
+    'supabase/functions/coordinator/rules.bundle.js is stale: it no longer matches ' +
+      'what `esbuild src/rules/index.ts` produces right now.\n' +
+      'The coordinator (the Edge Function that verifies a client\'s claimed rules_hash) ' +
+      'would be checking claims against a different implementation than the one the browser ' +
+      'runs.\n\nRun: npm run build:coordinator\nThen commit the updated bundle.',
+  );
+  process.exit(1);
+}
+
+console.log('supabase/functions/coordinator/rules.bundle.js matches src/rules — not stale.');
diff --git a/app/src/App.tsx b/app/src/App.tsx
index b0dfe96..e5dc478 100644
--- a/app/src/App.tsx
+++ b/app/src/App.tsx
@@ -30,20 +30,23 @@ const CoresScreen = lazy(() => import('./screens/CoresScreen').then((m) => ({ de
 const DiagnosticsScreen = lazy(() => import('./screens/DiagnosticsScreen').then((m) => ({ default: m.DiagnosticsScreen })));
 const MovesScreen = lazy(() => import('./screens/MovesScreen').then((m) => ({ default: m.MovesScreen })));
 const FormatBuilderScreen = lazy(() =>
   import('./screens/FormatBuilderScreen').then((m) => ({ default: m.FormatBuilderScreen })),
 );
 // Lazy for a different reason than the others: not megabytes of data, just a
 // screen most visits never open. It does NOT keep @supabase/supabase-js out of
 // the entry chunk — SessionProvider is mounted at the root below, so the client
 // is in the entry chunk either way. Only this screen's own code is deferred.
 const SignInScreen = lazy(() => import('./screens/SignInScreen').then((m) => ({ default: m.SignInScreen })));
+const MatchmakingScreen = lazy(() =>
+  import('./screens/MatchmakingScreen').then((m) => ({ default: m.MatchmakingScreen })),
+);
 
 function Nav() {
   const { state, set, patch } = useAppState();
   return (
     <div className="nav sticky top-0 z-20 flex-wrap">
       <button
         className="nav-brand"
         onClick={() => set('screen', 'landing')}
         title="Back to the start"
       >
@@ -126,20 +129,22 @@ function Screens() {
     case 'show6':
       return <LazyScreen key="show6"><TeamBuilderScreen size={6} /></LazyScreen>;
     case 'cores':
       return <LazyScreen key="cores"><CoresScreen /></LazyScreen>;
     case 'diagnostics':
       return <LazyScreen key="diagnostics"><DiagnosticsScreen /></LazyScreen>;
     case 'moves':
       return <LazyScreen key="moves"><MovesScreen /></LazyScreen>;
     case 'formats':
       return <LazyScreen key="formats"><FormatBuilderScreen /></LazyScreen>;
+    case 'matchmaking':
+      return <LazyScreen key="matchmaking"><MatchmakingScreen /></LazyScreen>;
     case 'account':
       return <LazyScreen key="account"><SignInScreen /></LazyScreen>;
   }
 }
 
 /**
  * Holds the shell steady while a screen's chunk arrives.
  *
  * Sized rather than empty on purpose: these screens sit inside the shell's
  * animated container, and an unsized fallback collapses the page to the nav for
diff --git a/app/src/lib/__tests__/data.test.ts b/app/src/lib/__tests__/data.test.ts
index 9cb9e30..f22609a 100644
--- a/app/src/lib/__tests__/data.test.ts
+++ b/app/src/lib/__tests__/data.test.ts
@@ -27,20 +27,24 @@ describe('refs', () => {
     expect(speciesOf('azumarill_shadow')?.id).toBe('azumarill');
     expect(speciesOf('not_a_species')).toBeUndefined();
   });
 });
 
 describe('roster', () => {
   it('is populated and internally consistent', () => {
     expect(SPECIES.length).toBeGreaterThan(1000);
     expect(SPECIES_BY_ID.size).toBe(SPECIES.length);
   });
+  it('exposes a data revision that identifies this build', async () => {
+    const { DATA_REV } = await import('../data');
+    expect(DATA_REV).toMatch(/^[0-9a-f]{16}$/);
+  });
   it('ROSTER includes shadows and BASE_ROSTER does not', () => {
     expect(ROSTER.length).toBeGreaterThan(BASE_ROSTER.length);
     expect(BASE_ROSTER.every((r) => !r.shadow)).toBe(true);
   });
   it('excludes every unsimulated species from every picker', () => {
     const rosterIds = new Set(ROSTER.map((r) => r.ref));
     for (const id of UNSIMULATED_IDS) {
       expect(isSimulated(id)).toBe(false);
       expect(rosterIds.has(id)).toBe(false);
       expect(opponentCandidatesFor('great')).not.toContain(id);
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
new file mode 100644
index 0000000..ba45032
--- /dev/null
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -0,0 +1,477 @@
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
+ * `auth.getSession` is also new: `myMatches` has no `opponent_id` column to
+ * read — a match row only has `player_a`/`player_b` — so the module has to
+ * ask who is signed in to know which one is "me", and `leaveQueue` needs the
+ * same id to filter its delete. `getSession` (a local read), not `getUser`
+ * (a network round trip to the Auth server) — see `SessionContext.tsx`.
+ * Defaults to a signed-in user id of 'me'; pass a different id, or `null` for
+ * signed-out, to test the other cases.
+ */
+function harness(
+  rows: Record<string, unknown[]>,
+  errors: Record<string, { code: string; message: string }> = {},
+  meId: string | null = 'me',
+) {
+  const calls: { table: string; op: string; payload?: unknown }[] = [];
+  function table(name: string) {
+    const q: Record<string, unknown> = {
+      select: vi.fn((cols?: unknown) => { calls.push({ table: name, op: 'select', payload: cols }); return q; }),
+      eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
+      // `myOffers` asks for two columns at once ("proposed by me OR accepted
+      // by me"), which PostgREST spells as a single `or` filter string.
+      or: vi.fn((filter: string) => { calls.push({ table: name, op: 'or', payload: filter }); return q; }),
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
+      getSession: vi.fn(async () => ({ data: { session: meId ? { user: { id: meId } } : null }, error: null })),
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
+  /**
+   * `deleteTeam` in `saves.ts` filters its delete with `.eq('id', id)` even
+   * though RLS scopes it correctly on its own — that redundant predicate is
+   * this codebase's established discipline for a DELETE. Asserting only that
+   * *some* delete happened would pass whether or not that filter exists, so
+   * this checks the filter's column and value explicitly.
+   */
+  it('scopes the delete to the caller\'s own user_id, read from the session', async () => {
+    const { calls } = harness({});
+    const { leaveQueue } = await import('../matchmaking');
+    await leaveQueue();
+    expect(calls.some((c) => c.table === 'queue_entries' && c.op === 'delete')).toBe(true);
+    const eq = calls.find((c) => c.table === 'queue_entries' && c.op === 'eq');
+    expect(eq?.payload).toEqual(['user_id', 'me']);
+  });
+
+  it('refuses to leave a queue nobody signed into', async () => {
+    harness({}, {}, null);
+    const { leaveQueue } = await import('../matchmaking');
+    await expect(leaveQueue()).rejects.toThrow(/must be signed in/);
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
+          verified_hash: 'vh1', team: [{ ref: 'azumarill' }, { ref: 'registeel' }, { ref: 'skarmory' }],
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    const offers = await listOpenOffers('great');
+    expect(offers).toEqual([
+      {
+        id: 'o1', proposerId: 'p1', league: 'great', formatVersionId: 'v1',
+        scheduledFor: null, expiresAt: '2026-09-02T13:00:00Z', state: 'open', acceptedBy: null,
+        verifiedHash: 'vh1', rosterSize: 3,
+      },
+    ]);
+    const leagueFilter = calls.find((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[0] === 'league');
+    expect(leagueFilter?.payload).toEqual(['league', 'great']);
+  });
+
+  /**
+   * `accept_offer(p_offer, p_team)` takes no format: the OFFER's
+   * `format_version_id` is what the match is played under, so how big a
+   * roster an accepter needs is the offer's business and not theirs. Nothing
+   * downstream would catch the mismatch either — the coordinator recomputes
+   * `rules_hash` and never looks at `team`.
+   *
+   * The size comes from the posted roster's length rather than from the
+   * format's `composition.size`, because `format_versions` is readable only
+   * for a format whose `visibility = 'public'` and a saved format defaults to
+   * `private` — embedding the rules would return null for exactly the
+   * strangers' offers this number is for.
+   */
+  it('reports how big a roster each offer wants, from the roster it was posted with', async () => {
+    harness({
+      match_offers: [
+        {
+          id: 'o-three', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
+        },
+        {
+          id: 'o-six', proposer_id: 'p2', league: 'great', format_version_id: 'v2',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    expect((await listOpenOffers('great')).map((o) => o.rosterSize)).toEqual([3, 6]);
+  });
+
+  /**
+   * `accept_offer` raises 'this offer has not been verified yet' while this
+   * column is null, and the coordinator ticks once a minute — so a board that
+   * does not read it shows an Accept button that can only fail for the first
+   * minute of every offer's life.
+   */
+  it('carries the verification state of each offer, null and set alike', async () => {
+    harness({
+      match_offers: [
+        {
+          id: 'o-fresh', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          verified_hash: null, team: [{ ref: 'a' }],
+        },
+        {
+          id: 'o-ready', proposer_id: 'p2', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          verified_hash: 'vh9', team: [{ ref: 'a' }],
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    expect((await listOpenOffers('great')).map((o) => o.verifiedHash)).toEqual([null, 'vh9']);
+  });
+
+  it('asks the database for verified_hash on both listings', async () => {
+    const { calls } = harness({ match_offers: [] });
+    const mm = await import('../matchmaking');
+    await mm.listOpenOffers('great');
+    await mm.myOffers();
+    const selects = calls.filter((c) => c.table === 'match_offers' && c.op === 'select');
+    expect(selects).toHaveLength(2);
+    for (const s of selects) expect(s.payload).toMatch(/\bverified_hash\b/);
+  });
+
+  it('asks for the team it sizes that from, and reports zero rather than NaN without one', async () => {
+    const { calls } = harness({
+      match_offers: [
+        {
+          id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    const [o] = await listOpenOffers('great');
+    // A zero is a number the screen can reason about, and it now refuses the
+    // offer outright on it — `unacceptableReason` in MatchmakingScreen, which
+    // is where that decision belongs. Length alone would NOT have caught it:
+    // a fresh screen holds an empty roster, so `team.length === o.rosterSize`
+    // is 0 === 0 and would have rendered an ENABLED Accept. An earlier
+    // comment here claimed the zero did that work by itself; it did not, and
+    // the code was changed rather than the claim softened.
+    //
+    // What this function must not do is hand back `undefined` for a missing
+    // `team`: every comparison against it is false, so the control would be
+    // dead for a reason nothing could name.
+    expect(o.rosterSize).toBe(0);
+    const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
+    expect(select?.payload).toMatch(/\bteam\b/);
+  });
+
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
+          state: 'accepted', accepted_by: 'them', match_id: null, verified_hash: 'vh1',
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
+        },
+        {
+          id: 'o2', proposer_id: 'them', league: 'great', format_version_id: 'fv1',
+          scheduled_for: null, expires_at: '2026-09-05T19:00:00Z',
+          state: 'converted', accepted_by: 'me', match_id: 'm9', verified_hash: 'vh1',
+          // Six, deliberately differing from the three above: two rows mapped
+          // from one function, and a constant would satisfy only one of them.
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
+        },
+      ],
+    });
+    const { myOffers } = await import('../matchmaking');
+    expect(await myOffers()).toEqual([
+      {
+        id: 'o1', proposerId: 'me', league: 'great', formatVersionId: 'fv1',
+        scheduledFor: '2026-09-05T18:00:00Z', expiresAt: '2026-09-05T19:00:00Z',
+        state: 'accepted', acceptedBy: 'them', matchId: null, verifiedHash: 'vh1', rosterSize: 3,
+      },
+      {
+        id: 'o2', proposerId: 'them', league: 'great', formatVersionId: 'fv1',
+        scheduledFor: null, expiresAt: '2026-09-05T19:00:00Z',
+        state: 'converted', acceptedBy: 'me', matchId: 'm9', verifiedHash: 'vh1', rosterSize: 6,
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
diff --git a/app/src/lib/__tests__/saves.test.ts b/app/src/lib/__tests__/saves.test.ts
index 37c37ff..14d8bd5 100644
--- a/app/src/lib/__tests__/saves.test.ts
+++ b/app/src/lib/__tests__/saves.test.ts
@@ -16,21 +16,21 @@ const FORMAT: Format = {
 
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
@@ -44,75 +44,114 @@ function harness(rows: Record<string, unknown[]>, errors: Record<string, { code:
   }
   pkg.client = { from: vi.fn((n: string) => table(n)) };
   return { calls };
 }
 
 beforeEach(() => vi.resetModules());
 
 describe('saved teams', () => {
   it('reads a team and its members into one object', async () => {
     harness({
-      teams: [{ id: 't1', name: 'Mine', league: 'great',
+      teams: [{ id: 't1', name: 'Mine', league: 'great', size: 3,
         team_members: [{ slot: 1, ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM'],
           iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }] }],
     });
     const { listTeams } = await import('../saves');
-    const teams = await listTeams();
+    const teams = await listTeams(3);
     expect(teams).toHaveLength(1);
     expect(teams[0].name).toBe('Mine');
+    expect(teams[0].size).toBe(3);
     expect(teams[0].members[0].ref).toBe('azumarill');
   });
 
+  /**
+   * The scoping that makes the overwrite prompt safe again (task 5b — ledger
+   * Ruling 13). Both builders share one screen and one unfiltered `listTeams`
+   * used to let a 3-roster save offer to replace a same-named 6-roster, and
+   * `saveTeam`'s update path deletes every slot past the new length — three
+   * members gone for a screen the person was not even looking at. Filtering
+   * server-side means a GBL mount never sees a Show 6 roster in the first
+   * place, so the name-only match in the screen can never cross sizes.
+   */
+  it('filters by size server-side rather than trusting the caller to ignore the rest', async () => {
+    const { calls } = harness({ teams: [] });
+    const { listTeams } = await import('../saves');
+    await listTeams(3);
+    const eq = calls.find((c) => c.table === 'teams' && c.op === 'eq');
+    expect(eq?.payload).toEqual(['size', 3]);
+  });
+
   /**
    * The duplicate the builder's prompt cannot catch: a second tab inserted the
    * name after this one read its list. `teams_owner_name_uniq` refuses it, and
    * what comes back is `duplicate key value violates unique constraint …`,
    * which is not a sentence to put in front of someone who named a roster.
    */
   it('names the roster when the database refuses a duplicate name', async () => {
     harness({ teams: [] }, {
       teams: { code: '23505', message: 'duplicate key value violates unique constraint "teams_owner_name_uniq"' },
     });
     const { saveTeam } = await import('../saves');
-    await expect(saveTeam({ name: 'GL Squad', league: 'great', members: [] })).rejects.toThrow(
+    await expect(saveTeam({ name: 'GL Squad', league: 'great', size: 3, members: [] })).rejects.toThrow(
       /A roster called "GL Squad" already exists/,
     );
   });
 
   it('passes an unrelated write failure through untouched', async () => {
     // The guard on the other side: swallowing every write error into one
     // friendly sentence would hide a connection failure behind a name clash.
     harness({ teams: [] }, { teams: { code: '08006', message: 'could not connect to server' } });
     const { saveTeam } = await import('../saves');
-    await expect(saveTeam({ name: 'GL Squad', league: 'great', members: [] })).rejects.toThrow(
+    await expect(saveTeam({ name: 'GL Squad', league: 'great', size: 3, members: [] })).rejects.toThrow(
       /could not connect to server/,
     );
   });
 
   it('writes members in slot order, one row each', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      name: 'Mine', league: 'great',
+      name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
         { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: [], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 41 },
       ],
     });
     const members = calls.find((c) => c.table === 'team_members' && c.op === 'insert');
     expect((members?.payload as { slot: number }[]).map((m) => m.slot)).toEqual([1, 2]);
   });
 
+  /**
+   * Task 5b: `size` is what the database now filters `listTeams` by and
+   * checks against (3 or 6). It has to actually leave the client on both
+   * write paths, or every saved roster lands with no size to be scoped by.
+   */
+  it('sends size on the insert path', async () => {
+    const { calls } = harness({ teams: [{ id: 't1' }] });
+    const { saveTeam } = await import('../saves');
+    await saveTeam({ name: 'Mine', league: 'great', size: 6, members: [] });
+    const insert = calls.find((c) => c.table === 'teams' && c.op === 'insert');
+    expect((insert?.payload as { size: number }).size).toBe(6);
+  });
+
+  it('sends size on the update path', async () => {
+    const { calls } = harness({ teams: [{ id: 't1' }] });
+    const { saveTeam } = await import('../saves');
+    await saveTeam({ id: 't1', name: 'Mine', league: 'great', size: 6, members: [] });
+    const update = calls.find((c) => c.table === 'teams' && c.op === 'update');
+    expect((update?.payload as { size: number }).size).toBe(6);
+  });
+
   it('never writes an owner_id from the client', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
-    await saveTeam({ name: 'Mine', league: 'great', members: [] });
+    await saveTeam({ name: 'Mine', league: 'great', size: 3, members: [] });
     const insert = calls.find((c) => c.table === 'teams' && c.op === 'insert');
     // owner_id comes from a column default of auth.uid(); a client-supplied one
     // is a value the policy then has to agree with, which is a second source of
     // truth for who owns a row.
     expect(Object.keys(insert?.payload as object)).not.toContain('owner_id');
   });
 
   /**
    * The whole point: a roster that shrinks from three to two must not leave a
    * stale slot 3 behind. Both writes are asserted — a suite that only checked
@@ -120,21 +159,21 @@ describe('saved teams', () => {
    * scoping is asserted explicitly, by value, not merely that `eq`/`gt` were
    * called: a delete scoped only by team_id would wipe the whole roster (the
    * data-loss bug this design exists to avoid), and a wrong bound would
    * strand or over-delete rows — either failure leaves the delete COUNT at 1,
    * so the count alone cannot tell the two apart from a correct delete.
    */
   it('editing a team upserts the surviving slots and deletes only what is beyond them', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      id: 't1', name: 'Mine', league: 'great',
+      id: 't1', name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
         { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: [], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 41 },
       ],
     });
     const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
     expect((upsert?.payload as { slot: number }[]).map((m) => m.slot)).toEqual([1, 2]);
     const deletes = calls.filter((c) => c.table === 'team_members' && c.op === 'delete');
     expect(deletes).toHaveLength(1);
     const scopedByTeam = calls.find((c) => c.table === 'team_members' && c.op === 'eq');
@@ -145,21 +184,21 @@ describe('saved teams', () => {
 
   /**
    * Editing a team down to nothing is the shrink case taken to its limit:
    * every member must go, the upsert is skipped (nothing to write), and the
    * delete's bound becomes `gt('slot', 0)` — every slot is greater than 0, so
    * every row qualifies. Nothing exercised this path before.
    */
   it('editing a team to an empty roster removes every member', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
-    await saveTeam({ id: 't1', name: 'Mine', league: 'great', members: [] });
+    await saveTeam({ id: 't1', name: 'Mine', league: 'great', size: 3, members: [] });
     const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
     expect(upsert).toBeUndefined();
     const deletes = calls.filter((c) => c.table === 'team_members' && c.op === 'delete');
     expect(deletes).toHaveLength(1);
     const scopedByTeam = calls.find((c) => c.table === 'team_members' && c.op === 'eq');
     expect(scopedByTeam?.payload).toEqual(['team_id', 't1']);
     const boundedBySlot = calls.find((c) => c.table === 'team_members' && c.op === 'gt');
     expect(boundedBySlot?.payload).toEqual(['slot', 0]);
   });
 
@@ -167,37 +206,37 @@ describe('saved teams', () => {
    * The ordering IS the fix for the data-loss window: upsert first means a
    * failed upsert leaves the old roster untouched, and a failed delete after
    * it leaves stale extra slots rather than an empty team. A refactor that
    * swapped this back to delete-then-insert would pass every other test here
    * while reopening the window, so the order itself has to be asserted.
    */
   it('upserts the new roster before deleting the slots it no longer needs', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      id: 't1', name: 'Mine', league: 'great',
+      id: 't1', name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
       ],
     });
     const upsertIdx = calls.findIndex((c) => c.table === 'team_members' && c.op === 'upsert');
     const deleteIdx = calls.findIndex((c) => c.table === 'team_members' && c.op === 'delete');
     expect(upsertIdx).toBeGreaterThanOrEqual(0);
     expect(deleteIdx).toBeGreaterThanOrEqual(0);
     expect(upsertIdx).toBeLessThan(deleteIdx);
   });
 
   it('never writes an owner_id from the client when editing, either', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      id: 't1', name: 'Mine', league: 'great',
+      id: 't1', name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
       ],
     });
     const update = calls.find((c) => c.table === 'teams' && c.op === 'update');
     expect(Object.keys(update?.payload as object)).not.toContain('owner_id');
     const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
     expect(Object.keys((upsert?.payload as { team_id: string }[])[0])).not.toContain('owner_id');
   });
 });
@@ -225,27 +264,28 @@ describe('saved formats', () => {
    * see the fix report for the before/after run.
    */
   it('computes the next version from the highest existing version, not just any row', async () => {
     const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 3 }, { version: 1 }] });
     const { saveServerFormat } = await import('../saves');
     await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
     const insert = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
     expect((insert?.payload as { version: number }).version).toBe(4);
   });
 
-  it('stores the canonical hash alongside the rules', async () => {
+  it('stores the sha256 digest of the canonical rules, not the string itself', async () => {
     const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 0 }] });
     const { saveServerFormat } = await import('../saves');
-    const { canonicalize } = await import('../../rules');
+    const { rulesHash } = await import('../../rules');
     await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
     const v = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
-    expect((v?.payload as { rules_hash: string }).rules_hash).toBe(canonicalize(FORMAT));
+    expect((v?.payload as { rules_hash: string }).rules_hash).toBe(await rulesHash(FORMAT));
+    expect((v?.payload as { rules_hash: string }).rules_hash).toMatch(/^[0-9a-f]{64}$/);
   });
 });
 
 describe('listServerFormats', () => {
   /**
    * The embed used to pull every version's full `rules` jsonb for every
    * format, only to sort client-side and throw all but the newest away — a
    * payload that grows linearly with a user's edit history for data thrown
    * away on the next line, re-fetched after every save AND every delete.
    * PostgREST's referenced-table ordering avoids the over-fetch, but only if
@@ -273,21 +313,58 @@ describe('listServerFormats', () => {
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
diff --git a/app/src/lib/data.ts b/app/src/lib/data.ts
index 4586444..d84e0a7 100644
--- a/app/src/lib/data.ts
+++ b/app/src/lib/data.ts
@@ -28,21 +28,31 @@ interface RawSpecies
   extends Omit<Species, 'fastMoves' | 'chargeMoves' | 'chargeMove' | 'chargeMove2' | 'leagueMoves'> {
   fastMoves: string[];
   chargeMoves: string[];
   chargeMove: string;
   chargeMove2: string | null;
   leagueMoves?: Partial<Record<LeagueId, { fast: string; charge: string; charge2: string | null }>>;
 }
 const raw = artefact<{
   moves: Record<string, FastMove & ChargeMove>;
   species: RawSpecies[];
-}>(speciesRaw, 'species.json', ['moves', 'species'], 'npm run data');
+  dataRev: string;
+}>(speciesRaw, 'species.json', ['moves', 'species', 'dataRev'], 'npm run data');
+
+/**
+ * Identifies the generated data this build carries.
+ *
+ * Matches and scheduled offers pin it: a random draw agreed on Tuesday and
+ * played on Friday must deal the same six, and the only way to notice that the
+ * data moved underneath it is to have recorded which data it was.
+ */
+export const DATA_REV: string = raw.dataRev;
 
 export const SPECIES: Species[] = raw.species.map((s) => ({
   ...s,
   fastMoves: s.fastMoves.map((k) => raw.moves[k] as FastMove),
   chargeMoves: s.chargeMoves.map((k) => raw.moves[k] as ChargeMove),
   chargeMove: raw.moves[s.chargeMove] as ChargeMove,
   chargeMove2: s.chargeMove2 ? (raw.moves[s.chargeMove2] as ChargeMove) : null,
   leagueMoves: s.leagueMoves
     ? Object.fromEntries(
         Object.entries(s.leagueMoves).map(([lg, m]) => [
diff --git a/app/src/lib/matchmaking.ts b/app/src/lib/matchmaking.ts
new file mode 100644
index 0000000..f2e64bd
--- /dev/null
+++ b/app/src/lib/matchmaking.ts
@@ -0,0 +1,380 @@
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
+export type OfferState = 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
+
+export interface Offer {
+  id: string;
+  proposerId: string;
+  league: LeagueId;
+  formatVersionId: string;
+  /** Null for the live board; a timestamp for a scheduled proposal. */
+  scheduledFor: string | null;
+  expiresAt: string;
+  state: OfferState;
+  acceptedBy: string | null;
+  /**
+   * Null until the coordinator has recomputed the hash — and `accept_offer`
+   * raises `'this offer has not been verified yet'` for exactly that. The
+   * coordinator ticks once a minute, so every offer spends its first minute
+   * here: this is the normal beginning of an offer's life, not an edge case,
+   * and a board that does not read this column offers an Accept button that
+   * can only fail for a minute after every post.
+   */
+  verifiedHash: string | null;
+  /**
+   * How many members a roster accepting THIS offer needs — the length of the
+   * roster the proposer posted, which they built under this offer's own
+   * format. The accepter's own saved format has no say: `accept_offer` takes
+   * no format argument, and the offer's `format_version_id` is what the match
+   * is played under.
+   *
+   * Derived from `team` rather than from `format_versions.rules`, and that is
+   * a real constraint rather than laziness: versions are readable only for a
+   * format whose `visibility = 'public'` ("versions of a public format are
+   * readable by anyone signed in"), and a saved format defaults to `private`.
+   * Embedding the rules would hand back null for most offers on the board —
+   * precisely for the strangers whose offers this number exists to size. The
+   * team is readable under the same row policy that shows the offer at all.
+   */
+  rosterSize: number;
+}
+
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
+ */
+export async function leaveQueue(): Promise<void> {
+  const { data, error: sessionError } = await supabase.auth.getSession();
+  if (sessionError) throw new Error(sessionError.message);
+  const userId = data.session?.user.id;
+  if (!userId) throw new Error('you must be signed in to leave the queue');
+  const { error } = await supabase.from('queue_entries').delete().eq('user_id', userId);
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
+ * this reads the local session rather than trusting either column by
+ * position.
+ *
+ * `getSession()`, not `getUser()`: `getUser()` is a real network round trip
+ * that revalidates the JWT against the Auth server, and would abort this
+ * whole read on a transient network error for an id the caller already has
+ * locally. `SessionContext.tsx` makes the same choice for the same reason.
+ */
+export async function myMatches(): Promise<Match[]> {
+  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
+  if (sessionError) throw new Error(sessionError.message);
+  const me = sessionData.session?.user.id;
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
+    .select(
+      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, team',
+    )
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
+      state: OfferState;
+      accepted_by: string | null;
+      verified_hash: string | null;
+      team: StoredMember[] | null;
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
+      verifiedHash: r.verified_hash,
+      // The count, not the members. `match_offers`' select policy is
+      // whole-row, so the proposer's roster is legible to anyone who can see
+      // the offer — but this screen has no business rendering it, and what
+      // never leaves this function cannot be rendered by accident.
+      rosterSize: (r.team ?? []).length,
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
+      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, match_id, team',
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
+      accepted_by: string | null;
+      verified_hash: string | null;
+      match_id: string | null;
+      team: StoredMember[] | null;
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
+      verifiedHash: r.verified_hash,
+      matchId: r.match_id,
+      rosterSize: (r.team ?? []).length,
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
diff --git a/app/src/lib/saves.ts b/app/src/lib/saves.ts
index af6fc86..89cfbe2 100644
--- a/app/src/lib/saves.ts
+++ b/app/src/lib/saves.ts
@@ -1,39 +1,50 @@
 import { supabase } from './supabase';
-import { canonicalize, type Format } from '../rules';
+import { rulesHash, type Format } from '../rules';
 import type { LeagueId } from './types';
 import type { StoredMember } from './teamCodec';
 
 export interface SavedTeam {
   id: string;
   name: string;
   league: LeagueId;
+  size: 3 | 6;
   members: StoredMember[];
 }
 
 /**
  * `owner_id` is never sent from here. It defaults to `auth.uid()` in the
  * database, so who owns a row is decided in one place; a client-supplied owner
  * is a second source of truth the policy then has to agree with.
+ *
+ * `size` is required, not optional: GBL and Show 6 render the same
+ * TeamBuilderScreen and used to share one unfiltered list, which is how a
+ * same-named 6-roster ended up in the GBL picker's overwrite prompt and lost
+ * three members to a 3-roster save (task 5b, ledger Ruling 13). Filtering
+ * server-side with `.eq('size', size)` means a screen never even RECEIVES a
+ * roster of the other size — the scoping the overwrite prompt now depends on
+ * for its safety happens here, not as a client-side afterthought.
  */
-export async function listTeams(): Promise<SavedTeam[]> {
+export async function listTeams(size: 3 | 6): Promise<SavedTeam[]> {
   const { data, error } = await supabase
     .from('teams')
-    .select('id, name, league, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
+    .select('id, name, league, size, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
+    .eq('size', size)
     .order('updated_at', { ascending: false });
   if (error) throw new Error(error.message);
   return (data ?? []).map((row) => {
-    const r = row as { id: string; name: string; league: LeagueId; team_members: (StoredMember & { slot: number })[] };
+    const r = row as { id: string; name: string; league: LeagueId; size: 3 | 6; team_members: (StoredMember & { slot: number })[] };
     return {
       id: r.id,
       name: r.name,
       league: r.league,
+      size: r.size,
       members: [...r.team_members].sort((a, b) => a.slot - b.slot),
     };
   });
 }
 
 /**
  * A write failure, made sayable.
  *
  * A duplicate name reaching Postgres means the builder's own check missed it —
  * a second tab, or a list this tab read before that tab wrote. The index that
@@ -53,27 +64,28 @@ function writeError(error: { code?: string; message: string }, name: string): Er
       `A roster called "${name}" already exists. Open the saved list to refresh it, then save again to replace that roster.`,
     );
   }
   return new Error(error.message);
 }
 
 export async function saveTeam(t: {
   id?: string;
   name: string;
   league: LeagueId;
+  size: 3 | 6;
   members: StoredMember[];
 }): Promise<string> {
   let id = t.id;
   if (id) {
     const { error } = await supabase
       .from('teams')
-      .update({ name: t.name, league: t.league, updated_at: new Date().toISOString() })
+      .update({ name: t.name, league: t.league, size: t.size, updated_at: new Date().toISOString() })
       .eq('id', id);
     if (error) throw writeError(error, t.name);
     // UPSERT the new slots BEFORE deleting anything beyond the new length —
     // never delete-then-insert. The two writes are not one transaction, so
     // their order decides which failure direction is recoverable. Upsert
     // first: if the upsert fails, the OLD roster is untouched — nothing is
     // lost. Delete second, scoped to slots past the new length: if that
     // delete fails, the team is left with stale extra slots, which is
     // visible and easy to clean up by saving again. Reversing this order —
     // delete all, then insert — has a window where an insert failing after
@@ -91,21 +103,21 @@ export async function saveTeam(t: {
     }
     const { error: clearError } = await supabase
       .from('team_members')
       .delete()
       .eq('team_id', id)
       .gt('slot', t.members.length);
     if (clearError) throw new Error(clearError.message);
   } else {
     const { data, error } = await supabase
       .from('teams')
-      .insert({ name: t.name, league: t.league })
+      .insert({ name: t.name, league: t.league, size: t.size })
       .select('id')
       .single();
     if (error) throw writeError(error, t.name);
     id = (data as { id: string }).id;
     if (t.members.length > 0) {
       const { error: insertError } = await supabase
         .from('team_members')
         .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
       if (insertError) throw new Error(insertError.message);
     }
@@ -116,47 +128,68 @@ export async function saveTeam(t: {
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
@@ -172,20 +205,20 @@ export async function saveServerFormat(f: { id?: string; name: string; format: F
     .eq('format_id', id)
     .order('version', { ascending: false })
     .limit(1);
   const next = ((prior as { version: number }[] | null)?.[0]?.version ?? 0) + 1;
   // Append. A version is immutable in the database, so this is the only way to
   // change what a format says.
   const { error } = await supabase.from('format_versions').insert({
     format_id: id,
     version: next,
     rules: f.format,
-    rules_hash: canonicalize(f.format),
+    rules_hash: await rulesHash(f.format),
   });
   if (error) throw new Error(error.message);
   return id;
 }
 
 export async function deleteServerFormat(id: string): Promise<void> {
   const { error } = await supabase.from('formats').delete().eq('id', id);
   if (error) throw new Error(error.message);
 }
diff --git a/app/src/lib/screens.ts b/app/src/lib/screens.ts
index 8160457..4a65f43 100644
--- a/app/src/lib/screens.ts
+++ b/app/src/lib/screens.ts
@@ -88,20 +88,32 @@ export const SCREEN_DEFS: ScreenDef[] = [
     blurb: 'Every fast and charge move, with the figures that rank them.',
   },
   {
     id: 'formats',
     label: 'Formats',
     kicker: 'Rulesets',
     glyph: '⌘',
     hue: 'var(--type-dark)',
     blurb: 'Author a format clause by clause, and watch the legal pool move as you type.',
   },
+  {
+    id: 'matchmaking',
+    label: 'Matches',
+    kicker: 'Opponents',
+    // Not --type-fighting: the Battle screen already carries it, and every
+    // screen needs a distinct hue for colour to identify a section (see
+    // src/lib/__tests__/screens.test.ts). Ghost fits a blind queue anyway —
+    // the opponent is unseen until the pairing lands.
+    glyph: '⚔',
+    hue: 'var(--type-ghost)',
+    blurb: 'Queue for a blind match, browse an open offer, or schedule one for later.',
+  },
   {
     id: 'account',
     label: 'Account',
     kicker: 'You',
     glyph: '◉',
     hue: 'var(--type-normal)',
     blurb: 'Sign in, and choose the name the rest of Paragon will know you by.',
   },
 ];
 
diff --git a/app/src/rules/__tests__/hash.test.ts b/app/src/rules/__tests__/hash.test.ts
new file mode 100644
index 0000000..63a0e01
--- /dev/null
+++ b/app/src/rules/__tests__/hash.test.ts
@@ -0,0 +1,26 @@
+import { describe, it, expect } from 'vitest';
+import { RULES_SCHEMA, type Format } from '../index';
+import { rulesHash } from '../hash';
+
+const base: Format = {
+  schema: RULES_SCHEMA, base: 'great', start: 'empty', pool: [],
+  composition: { size: 3, uniqueSpecies: true }, selection: { mode: 'open' },
+};
+
+describe('rulesHash', () => {
+  it('is 64 hex characters', async () => {
+    expect(await rulesHash(base)).toMatch(/^[0-9a-f]{64}$/);
+  });
+
+  it('agrees for two independently authored identical formats', async () => {
+    // The whole point of partitioning queues by hash rather than by
+    // format_version_id: two people who wrote the same rules must meet.
+    const twin: Format = { ...base, composition: { ...base.composition } };
+    expect(await rulesHash(twin)).toBe(await rulesHash(base));
+  });
+
+  it('differs when a rule differs', async () => {
+    const bigger: Format = { ...base, composition: { ...base.composition, size: 6 } };
+    expect(await rulesHash(bigger)).not.toBe(await rulesHash(base));
+  });
+});
diff --git a/app/src/rules/hash.ts b/app/src/rules/hash.ts
new file mode 100644
index 0000000..90043cd
--- /dev/null
+++ b/app/src/rules/hash.ts
@@ -0,0 +1,19 @@
+import { canonicalize } from './canonical';
+import type { Format } from './types';
+
+/**
+ * The queue identity of a format.
+ *
+ * `canonicalize` decides what "the same rules" means — key order irrelevant,
+ * notes irrelevant, clause order significant. This only compresses that string
+ * into something worth indexing.
+ *
+ * `crypto.subtle` rather than a Node import on purpose: this exact function
+ * runs in the browser AND in the Edge Function that recomputes the hash it
+ * refuses to take on trust. Two implementations would be two answers.
+ */
+export async function rulesHash(format: Format): Promise<string> {
+  const bytes = new TextEncoder().encode(canonicalize(format));
+  const digest = await crypto.subtle.digest('SHA-256', bytes);
+  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
+}
diff --git a/app/src/rules/index.ts b/app/src/rules/index.ts
index 2bd122f..9b0b517 100644
--- a/app/src/rules/index.ts
+++ b/app/src/rules/index.ts
@@ -2,20 +2,21 @@
  * The rules module's public surface.
  *
  * UI code imports from here and never from the files behind it, so the internal
  * layout can change without a hundred import rewrites — and so the one rule
  * that matters about this directory stays checkable: nothing in it may import
  * React or touch a browser API. It has to run unchanged under Node, because the
  * server will eventually validate teams with exactly this code, and a validator
  * that disagrees with the client is worse than no validator.
  */
 export { canonicalize } from './canonical';
+export { rulesHash } from './hash';
 export { compileSelector, type RefTerm } from './selector';
 export { compileBuildSelector, type BuildTerm } from './buildSelector';
 export { resolvePool, type PoolResolution } from './pool';
 export { validateTeam, type TeamCheck } from './team';
 export {
   lintFormat,
   findSatisfyingTeam,
   MIN_POOL_ABSOLUTE,
   NARROW_POOL_FRACTION,
   RANDOM_POOL_MULTIPLE,
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
new file mode 100644
index 0000000..41aacdf
--- /dev/null
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -0,0 +1,748 @@
+import { useEffect, useMemo, useState } from 'react';
+import { ScreenHeader } from '../components/ScreenHeader';
+import { PokemonCard } from '../components/PokemonCard';
+import { SpeciesSearch } from '../components/SpeciesSearch';
+import type { AddPokemonChoice } from '../components/AddPokemonModal';
+import { useAppState } from '../state/AppState';
+import { useSession } from '../state/SessionContext';
+import { LEAGUE_BY_ID, conflictsOnTeam, movesFor, pickableFor, speciesOf } from '../lib/data';
+import { defaultSpreadFor } from '../lib/engine';
+import { encodeMember, type StoredMember } from '../lib/teamCodec';
+import type { LeagueId } from '../lib/types';
+import {
+  acceptOffer,
+  confirmOffer,
+  createOffer,
+  joinQueue,
+  leaveQueue,
+  listOpenOffers,
+  myMatches,
+  myOffers,
+  myQueueEntry,
+  opponentFriendCode,
+  type Match,
+  type MyOffer,
+  type Offer,
+  type QueueEntry,
+} from '../lib/matchmaking';
+import { listServerFormats, type SavedFormat } from '../lib/saves';
+
+/**
+ * The Matchmaking screen: three answers to one question — who do I play next
+ * — on one screen. A blind queue paired by the coordinator, a live board of
+ * offers anyone can browse and accept, and scheduled proposals that need
+ * both sides to confirm before they become a match.
+ *
+ * **What you queue under.** M2a queues with a format the person has SAVED ON
+ * THE SERVER, chosen here by name. Canonical per-league league formats are
+ * deferred to the ranked milestone: the spec ties them to ranked play, M2a
+ * has no rating, and partitioning the queue by `rules_hash` already means two
+ * people who authored the same rules meet each other. So `formatVersionId` is
+ * a real `format_versions.id` from `listServerFormats`, not a placeholder —
+ * the earlier `canonical:${league}` string was a value no foreign key could
+ * ever have accepted. Someone with no saved format for this league is told
+ * so and offered no control that could only fail.
+ *
+ * The roster is built right here rather than loaded from a saved team, and
+ * scored under the league's own rated moveset — the same fallback `Slot` uses
+ * on `TeamBuilderScreen` for a member that was never opened in a build
+ * picker. How many members it needs comes from the chosen format's
+ * `composition.size`, not a constant: the format is the thing that says how
+ * big a roster is.
+ */
+
+/** Only until a format is chosen — the empty slots have to be some number. */
+const DEFAULT_ROSTER_SIZE = 3;
+
+function messageOf(e: unknown): string {
+  return e instanceof Error ? e.message : String(e);
+}
+
+/** What a member saves as when it was never opened in a build picker — the
+ * league's rated set, same fallback `TeamBuilderScreen`'s `Slot` uses. */
+function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
+  const sp = speciesOf(refId);
+  if (!sp) return { ref: refId, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } };
+  const rated = movesFor(sp, leagueId);
+  const spread = defaultSpreadFor(refId, leagueId, true);
+  return {
+    ref: refId,
+    fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
+    chargeIds: rated.charges.map((c) => c.id),
+    iv: { a: spread.a, d: spread.d, s: spread.s },
+  };
+}
+
+function queueStatusText(entry: QueueEntry): string {
+  // `verifiedHash` is null until the coordinator recomputes it; only a
+  // verified entry is eligible to pair. Saying "queued" alone would imply a
+  // match is imminent when it may not even be checked yet.
+  return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
+}
+
+/**
+ * Why NOBODY can accept this offer right now — as distinct from why *you*
+ * cannot yet, which is a disabled button with a hint saying what to fix. A
+ * reason here means the control is not rendered at all.
+ */
+function unacceptableReason(o: Offer): string | null {
+  // FIRST, because it is first in `accept_offer` too — the reason shown is the
+  // reason the database would actually give.
+  //
+  // Expiry is a coordinator SWEEP, not a trigger: an offer past `expires_at`
+  // sits in `state = 'open'` until the next tick, and `listOpenOffers` filters
+  // only on `league` and `state`, so an expired row is handed back looking
+  // exactly like a live one. Nothing on this screen re-reads the board on its
+  // own either, so a page left open past this timestamp would otherwise show
+  // an enabled Accept — whose only possible outcome is `accept_offer` raising
+  // 'this offer has expired' — for as long as the tab stays open.
+  if (Date.parse(o.expiresAt) <= Date.now()) return 'Expired — nobody can accept it now.';
+  // The coordinator ticks once a minute, so every offer spends its first
+  // minute unverified and `accept_offer` raises for exactly this. Said as
+  // something in progress, because it is: a minute from now it is gone.
+  if (o.verifiedHash === null) return 'Being checked — acceptable once verified.';
+  // Only reachable from a malformed write by some other client: this screen
+  // never posts an empty roster. `accept_offer` would not catch it either —
+  // it refuses a null `p_team`, not an empty one — so a match would be
+  // created with an empty `team_b`.
+  if (o.rosterSize < 1) return 'Posted without a roster; nobody can accept it.';
+  return null;
+}
+
+/**
+ * "Add 2 more to queue", "Remove 3 to post" — never "Add -3 more".
+ *
+ * `verb` is what the control the hint hangs off actually does. Every control
+ * gated on `rosterReady` passes its own: Join, Post and Schedule are three
+ * buttons that go dead together, and a hint naming the wrong one of them is
+ * only marginally better than no hint at all.
+ */
+function rosterHint(want: number, have: number, verb: 'queue' | 'post' | 'schedule'): string {
+  const short = want - have;
+  return short > 0 ? `Add ${short} more to ${verb}` : `Remove ${-short} to ${verb}`;
+}
+
+/** Why a control is dead for the duration of an in-flight call. */
+const BUSY_HINT = 'Working — wait for the last action to finish';
+
+/**
+ * Where an offer has got to, said from the reader's own side of it. The two
+ * sides are not symmetric: `accepted` is "your move" to the proposer and
+ * "waiting on them" to the taker, and telling either one the other's sentence
+ * is how someone sits waiting for a handshake that was waiting for them.
+ */
+function offerStatusText(o: MyOffer, proposed: boolean): string {
+  switch (o.state) {
+    case 'open':
+      if (!proposed) return 'Still open.';
+      // The proposer's side of the same minute the board hides Accept for:
+      // "nobody has accepted it" would read as indifference from other
+      // people when in fact nobody has been allowed to yet.
+      return o.verifiedHash === null
+        ? 'Posted — being checked before anyone can accept it.'
+        : 'Posted — nobody has accepted it yet.';
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
+export function MatchmakingScreen() {
+  const { state } = useAppState();
+  const { user } = useSession();
+  const league = state.league;
+
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
+  // Declared here rather than with the board below because the roster's own
+  // capacity depends on it — see `rosterCapacity`.
+  const [offers, setOffers] = useState<Offer[] | null>(null);
+
+  // --- the roster, built locally on this screen ---------------------------
+  const [team, setTeam] = useState<string[]>([]);
+  /**
+   * The most members this roster could need: your own format's size, or the
+   * largest offer on the board. Capping at your own size would make a bigger
+   * offer permanently unacceptable — no amount of picking would reach its
+   * length — which is the "control that cannot succeed" rule again, wearing
+   * the roster's clothes instead of the button's.
+   */
+  const rosterCapacity = Math.max(rosterSize, ...(offers ?? []).map((o) => o.rosterSize));
+  const selectable = useMemo(
+    () => new Set(pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))),
+    [league, team],
+  );
+  const add = (ref: string) => {
+    setTeam((t) =>
+      t.includes(ref) || t.length >= rosterCapacity || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
+    );
+  };
+  const clear = (i: number) => setTeam((t) => t.filter((_, n) => n !== i));
+  const buildTeam = (): StoredMember[] => team.map((ref) => encodeMember(defaultChoice(ref, league), league));
+  /**
+   * Ready to JOIN or POST — both of which are queued under your own chosen
+   * format, so both need one. Accepting is deliberately not this: see
+   * `canAccept`.
+   */
+  const rosterReady = !!chosen && team.length === rosterSize;
+
+  // Nothing may sit past the capacity: a member the slots do not render is a
+  // member nobody can remove, and it still counts towards every length check
+  // on this screen.
+  useEffect(() => {
+    setTeam((t) => (t.length > rosterCapacity ? t.slice(0, rosterCapacity) : t));
+  }, [rosterCapacity]);
+
+  // --- the blind queue ------------------------------------------------------
+  const [entry, setEntry] = useState<QueueEntry | null>(null);
+  const [matches, setMatches] = useState<Match[] | null>(null);
+  const [codes, setCodes] = useState<Record<string, string | null>>({});
+  const [busy, setBusy] = useState(false);
+  const [notice, setNotice] = useState<string | null>(null);
+
+  useEffect(() => {
+    if (!user) {
+      setEntry(null);
+      setMatches(null);
+      setCodes({});
+      setSavedFormats(null);
+      return;
+    }
+    let live = true;
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
+    void myQueueEntry()
+      .then((e) => {
+        if (live) setEntry(e);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    void myMatches()
+      .then((m) => {
+        if (live) setMatches(m);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    return () => {
+      live = false;
+    };
+  }, [user]);
+
+  // Friend codes are readable only once a match pairs two people — fetched
+  // once matches are known, one call per opponent, never guessed at.
+  useEffect(() => {
+    if (!matches || matches.length === 0) return;
+    let live = true;
+    void Promise.all(
+      matches.map((m) => opponentFriendCode(m.opponentId).then((code) => [m.opponentId, code] as const)),
+    ).then((pairs) => {
+      if (live) setCodes(Object.fromEntries(pairs));
+    });
+    return () => {
+      live = false;
+    };
+  }, [matches]);
+
+  const join = async () => {
+    if (!chosen || !rosterReady || entry || busy) return;
+    setBusy(true);
+    setNotice(null);
+    try {
+      // The version id, not the format id: what two people agreed to play is
+      // an immutable version, so editing this format afterwards cannot change
+      // the rules of a match already queued under it.
+      await joinQueue({
+        league,
+        formatVersionId: chosen.versionId,
+        format: chosen.format,
+        team: buildTeam(),
+      });
+      setEntry(await myQueueEntry());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const leave = async () => {
+    if (!entry) return;
+    // Irreversible the moment it lands — the same confirm idiom
+    // `TeamBuilderScreen` uses before `deleteTeam`.
+    if (!window.confirm('Leave the queue? You will stop being matched until you join again.')) return;
+    setBusy(true);
+    setNotice(null);
+    try {
+      await leaveQueue();
+      setEntry(null);
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  // --- the open offer board --------------------------------------------------
+  const [justAccepted, setJustAccepted] = useState<{ offerId: string; matchId: string | null } | null>(null);
+  const [postOpen, setPostOpen] = useState(false);
+  const [scheduleAt, setScheduleAt] = useState('');
+  // Every offer this person is party to, READ FROM THE DATABASE — proposed or
+  // accepted, in whatever state. Not session state: an offer leaves
+  // `state = 'open'` the moment someone accepts it, so a panel driven by what
+  // this tab happened to post would forget the handshake on reload, and
+  // `listOpenOffers` would never hand it back. That is the offer lapsing and
+  // the match never being created.
+  const [mine, setMine] = useState<MyOffer[] | null>(null);
+
+  useEffect(() => {
+    if (!user) {
+      setOffers(null);
+      setMine(null);
+      return;
+    }
+    let live = true;
+    void listOpenOffers(league)
+      .then((o) => {
+        if (live) setOffers(o);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    return () => {
+      live = false;
+    };
+  }, [user, league]);
+
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
+  /**
+   * Accepting is governed by the OFFER, not by you. `accept_offer(p_offer,
+   * p_team)` takes no format: the offer's own `format_version_id` is what the
+   * match is played under, so a saved format of your own is not needed to
+   * accept one, and requiring it locked out everyone who has none — the
+   * database would have taken them. The roster has to be the size the OFFER
+   * wants for the same reason; sizing it by your own format would let a
+   * 6-strong roster into a 3-member offer, which nothing downstream rejects
+   * (the coordinator recomputes `rules_hash` and never inspects `team`).
+   */
+  const canAccept = (o: Offer) =>
+    !!user && o.proposerId !== user.id && unacceptableReason(o) === null && team.length === o.rosterSize;
+
+  const accept = async (o: Offer) => {
+    if (!canAccept(o) || busy) return;
+    setBusy(true);
+    setNotice(null);
+    try {
+      const matchId = await acceptOffer(o.id, buildTeam());
+      setOffers((prev) => (prev ? prev.filter((x) => x.id !== o.id) : prev));
+      setJustAccepted({ offerId: o.id, matchId });
+      // Re-read what this person is party to: the offer just accepted is now
+      // one of them, and this is the read that will still find it tomorrow.
+      setMine(await myOffers());
+      // A live offer resolves to a match id immediately; a scheduled one
+      // returns null and stays `accepted`, not a match, until the proposer
+      // confirms — rendering null as "matched" would put a battle on
+      // someone's calendar nobody actually agreed to yet.
+      if (matchId) setMatches(await myMatches());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const post = async (scheduled: boolean) => {
+    if (!chosen || !rosterReady || busy) return;
+    let scheduledFor: Date | undefined;
+    if (scheduled) {
+      if (!scheduleAt) {
+        setNotice('Pick a date and time to schedule for.');
+        return;
+      }
+      scheduledFor = new Date(scheduleAt);
+    }
+    setBusy(true);
+    setNotice(null);
+    try {
+      await createOffer({
+        league,
+        formatVersionId: chosen.versionId,
+        format: chosen.format,
+        team: buildTeam(),
+        scheduledFor,
+      });
+      setPostOpen(false);
+      setScheduleAt('');
+      setOffers(await listOpenOffers(league));
+      // Read the new offer back rather than remembering it here: what this
+      // panel shows has to be there after a reload too.
+      setMine(await myOffers());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const confirm = async (id: string) => {
+    setBusy(true);
+    setNotice(null);
+    try {
+      await confirmOffer(id);
+      setMine(await myOffers());
+      setMatches(await myMatches());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  if (!user) {
+    return (
+      <div className="matchmaking-screen">
+        <ScreenHeader
+          title="Matches"
+          blurb="Queue for a blind match, browse an open offer, or schedule one for later."
+        />
+        <div className="panel text-muted">Sign in to queue for a match, browse the open offer board, or schedule one for later.</div>
+      </div>
+    );
+  }
+
+  return (
+    <div className="matchmaking-screen">
+      <ScreenHeader
+        title="Matches"
+        blurb="Queue for a blind match, browse an open offer, or schedule one for later."
+      />
+
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
+      <div className="panel panel-strong">
+        <div className="hud-label">
+          Your roster for {LEAGUE_BY_ID.get(league)?.label ?? league}
+        </div>
+        {/* Your own format's size, but never fewer slots than the roster
+            actually holds — someone building up to a larger offer must be
+            able to see, and remove, every member they picked. */}
+        <div className="team-slots">
+          {Array.from({ length: Math.max(rosterSize, team.length) }, (_, i) => {
+            const r = team[i] ?? null;
+            return r ? (
+              <PokemonCard key={i} refId={r} league={league} size="compact" onClick={() => clear(i)} title="Click to remove" />
+            ) : (
+              <div key={i} className="team-slot is-empty">
+                <span className="team-slot-hint">Empty</span>
+              </div>
+            );
+          })}
+        </div>
+        <div className="team-add">
+          <SpeciesSearch
+            key={team.length}
+            id="matchmaking-team-add"
+            value=""
+            onChange={add}
+            placeholder="Add a Pokémon to this roster"
+            includeShadow
+            restrictTo={selectable}
+          />
+        </div>
+      </div>
+
+      <div className="panel">
+        <div className="hud-label">Blind queue</div>
+        <p className="text-muted">
+          Matched with anyone else queued under the same league and rules, blind — no format to browse, no
+          opponent to pick.
+        </p>
+        {entry && <p className="queue-status">{queueStatusText(entry)}</p>}
+        <div className="matchmaking-actions">
+          {/* No Join at all without a format to join under: `format_version_id`
+              is NOT NULL and a foreign key, so the call could only fail. Same
+              rule as the Accept control on one's own offer. */}
+          {chosen && (
+            <button
+              type="button"
+              className="btn btn-primary queue-join"
+              disabled={!rosterReady || !!entry || busy}
+              // Never "Add -3 more": the picker's cap is the largest thing on
+              // the board, so a roster built to accept a six-member offer is
+              // longer than a three-member format wants, and the shortfall is
+              // negative. Say which way to move it.
+              title={rosterReady ? undefined : rosterHint(rosterSize, team.length, 'queue')}
+              onClick={() => void join()}
+            >
+              {busy ? 'Working…' : 'Join queue'}
+            </button>
+          )}
+          {entry && (
+            <button type="button" className="btn" disabled={busy} onClick={() => void leave()}>
+              Leave queue
+            </button>
+          )}
+        </div>
+        {matches && matches.length > 0 && (
+          <ul className="match-list">
+            {matches.map((m) => (
+              <li key={m.id} className="match-row">
+                <span>Match paired</span>
+                <span className="friend-code">
+                  {codes[m.opponentId] === undefined
+                    ? 'Loading friend code…'
+                    : codes[m.opponentId]
+                      ? `Friend code: ${codes[m.opponentId]}`
+                      : 'No friend code on file for this opponent.'}
+                </span>
+              </li>
+            ))}
+          </ul>
+        )}
+      </div>
+
+      <div className="panel">
+        <div className="hud-label">Open offer board</div>
+        <p className="text-muted">
+          Browse a curated offer, or post one of your own — live now, or scheduled for later once both sides
+          confirm.
+        </p>
+        {justAccepted && (
+          <p className="matchmaking-notice" role="status">
+            {justAccepted.matchId
+              ? 'Matched! Check your matches above for the friend code.'
+              : "Offer accepted — awaiting the proposer's confirmation. Not a match yet."}
+          </p>
+        )}
+        {offers && offers.length === 0 && <p className="text-faint">No open offers right now.</p>}
+        {offers && offers.length > 0 && (
+          <ul className="offer-list">
+            {offers.map((o) => {
+              const mine = o.proposerId === user.id;
+              const blocked = unacceptableReason(o);
+              return (
+                <li key={o.id} className="offer-row" data-offer-id={o.id}>
+                  <span className="offer-when">
+                    {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
+                  </span>
+                  <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
+                  {mine ? (
+                    <span className="text-faint">Your offer</span>
+                  ) : blocked ? (
+                    // Not a disabled button: nothing this person does would
+                    // make it work, so the reason takes the control's place
+                    // rather than sitting in a tooltip on a dead one.
+                    <span className="text-faint offer-blocked">{blocked}</span>
+                  ) : (
+                    <button
+                      type="button"
+                      className="btn chip-btn offer-accept"
+                      // Not `rosterReady`: that asks whether YOU could post,
+                      // and accepting is the offer's business, not your
+                      // format's.
+                      disabled={!canAccept(o) || busy}
+                      // `busy` FIRST: it is the one gate that can be shut
+                      // while `canAccept` is true, and a control disabled for
+                      // a reason nobody states is the same defect as a
+                      // control that can only fail.
+                      title={
+                        busy
+                          ? BUSY_HINT
+                          : canAccept(o)
+                            ? undefined
+                            : `This offer is played with a roster of ${o.rosterSize}`
+                      }
+                      onClick={() => void accept(o)}
+                    >
+                      Accept
+                    </button>
+                  )}
+                </li>
+              );
+            })}
+          </ul>
+        )}
+
+        {/* Overlays the panel rather than growing it — the board must not
+            shove anything below it down the page as offers arrive. The list
+            above is bounded and scrolls for the same reason. */}
+        <div className="move-picker">
+          {chosen && (
+          <button
+            type="button"
+            className="btn move-picker-btn"
+            aria-expanded={postOpen}
+            onClick={() => setPostOpen((o) => !o)}
+          >
+            Post an offer
+          </button>
+          )}
+          {chosen && postOpen && (
+            <div className="move-picker-panel offer-post-panel">
+              <button
+                type="button"
+                className="btn btn-primary offer-post"
+                disabled={!rosterReady || busy}
+                // The same gate as Join, so the same hint — with this
+                // control's own verb. Without one, the state round 3 named
+                // (six picked to reach a bigger offer, own format of three)
+                // left these two buttons dead and silent while Join beside
+                // them explained itself.
+                title={busy ? BUSY_HINT : rosterReady ? undefined : rosterHint(rosterSize, team.length, 'post')}
+                onClick={() => void post(false)}
+              >
+                Post to the open board
+              </button>
+              <div className="offer-schedule-row">
+                <input
+                  type="datetime-local"
+                  className="input"
+                  value={scheduleAt}
+                  onChange={(e) => setScheduleAt(e.target.value)}
+                />
+                <button
+                  type="button"
+                  className="btn offer-schedule"
+                  disabled={!rosterReady || busy || !scheduleAt}
+                  // Three gates, so three reasons, in the order they are
+                  // checked. The date one matters most: a ready roster and no
+                  // date is the ONLY way this button is dead while Join beside
+                  // it is live, so "add/remove members" would be actively
+                  // misleading there.
+                  title={
+                    busy
+                      ? BUSY_HINT
+                      : !rosterReady
+                        ? rosterHint(rosterSize, team.length, 'schedule')
+                        : !scheduleAt
+                          ? 'Pick a date and time to schedule for'
+                          : undefined
+                  }
+                  onClick={() => void post(true)}
+                >
+                  Schedule
+                </button>
+              </div>
+            </div>
+          )}
+        </div>
+      </div>
+
+      {mine && mine.length > 0 && (
+        <div className="panel">
+          <div className="hud-label">Your offers</div>
+          <p className="text-muted">
+            Every offer you proposed or accepted, read back from the server — so a scheduled proposal is
+            still here, and still confirmable, on your next visit.
+          </p>
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
+          </ul>
+        </div>
+      )}
+
+      {notice && (
+        <p className="matchmaking-notice" role="alert">
+          {notice}
+        </p>
+      )}
+    </div>
+  );
+}
diff --git a/app/src/screens/TeamBuilderScreen.tsx b/app/src/screens/TeamBuilderScreen.tsx
index a9d1e9d..bfa8281 100644
--- a/app/src/screens/TeamBuilderScreen.tsx
+++ b/app/src/screens/TeamBuilderScreen.tsx
@@ -209,24 +209,35 @@ function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
  *
  * Compared case-insensitively and trimmed, because "GL Squad" and "gl squad"
  * are one roster to the person typing them and two rows to Postgres — nothing
  * in the database forbids the duplicate, so the only thing standing between a
  * name and a second identical entry in the load list is this comparison.
  *
  * `listTeams` orders by `updated_at` descending, so index 0 is the most
  * recently touched. Ties are possible: anything saved before this screen could
  * overwrite may already have left duplicates behind.
  */
-function rostersNamed(saved: SavedTeam[] | null, name: string): SavedTeam[] {
+/**
+ * `size` is checked here too, not only trusted from the server-side
+ * `.eq('size', size)` in `listTeams` — belt and suspenders. `listTeams` being
+ * scoped is what stops a roster of the other size from ever reaching
+ * `savedTeams` in the first place, but this is the line that actually decides
+ * whether to offer a replace, and a stale fetch or a future regression in
+ * that scoping should not be able to resurrect the bug this whole screen
+ * exists to close (task 5b, ledger Ruling 13): a same-named roster from the
+ * OTHER size matching here is exactly what let a 3-roster save delete three
+ * members of a 6-roster nobody was looking at.
+ */
+function rostersNamed(saved: SavedTeam[] | null, name: string, size: 3 | 6): SavedTeam[] {
   const key = name.trim().toLowerCase();
   if (key === '') return [];
-  return (saved ?? []).filter((t) => t.name.trim().toLowerCase() === key);
+  return (saved ?? []).filter((t) => t.size === size && t.name.trim().toLowerCase() === key);
 }
 
 /**
  * What to ask before replacing one. Says which roster, and names anything about
  * the replacement that is not obvious from the slots on screen.
  */
 function replacePrompt(target: SavedTeam, matchCount: number, league: LeagueId): string {
   const parts = [`Replace "${target.name}" with the roster in the slots above?`];
   // saveTeam's update path rewrites `league` along with the members, so this
   // can change the cap the roster is judged under without touching a control
@@ -273,20 +284,29 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
   // the game is.
   const pool = useMemo(() => new Set(teamPool(league)), [league]);
   const selectable = useMemo(
     () =>
       new Set(
         pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r))),
       ),
     [league, team],
   );
   const full = team.length === size;
+  /**
+   * Why the save control is disabled when the roster is non-empty but not
+   * exactly `size` yet — shown the same way a blank name gets a reason (see
+   * `team-save-hint` below). Silent before this: the only gate was
+   * `team.length === 0`, so a 1-of-6 saved without anything on screen saying
+   * it was incomplete (task 5b).
+   */
+  const saveIncompleteReason =
+    team.length > 0 && team.length < size ? `Add ${size - team.length} more to save this roster.` : null;
 
   const invalidate = () => {
     setReport(null);
     setSix(null);
     setPicks(null);
   };
   // Functional updates, not `setTeam([...team, ref])`. Two picks landing in the
   // same tick both read the `team` their own render closed over, so the second
   // overwrites the first instead of appending — which silently dropped members
   // and left the roster looking like it had chosen at random.
@@ -356,62 +376,66 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
 
   useEffect(() => {
     if (!user) {
       setSavedTeams(null);
       return;
     }
     // Guards a fetch that outlives its own sign-in: signing out while the
     // request is in flight must not resurrect `savedTeams` for a session that
     // no longer exists.
     let live = true;
-    listTeams()
+    listTeams(size)
       .then((teams) => {
         if (live) setSavedTeams(teams);
       })
       .catch((e: unknown) => {
         if (live) setSavesError(e instanceof Error ? e.message : String(e));
       });
     return () => {
       live = false;
     };
-  }, [user]);
+  }, [user, size]);
 
   const saveRoster = async () => {
-    if (team.length === 0 || saving) return;
+    // A complete roster, not merely a non-empty one — see the button's own
+    // `disabled` condition below, which this mirrors. `team.length === 0`
+    // alone (the old check) let a 1-of-6 be saved with nothing to say it was
+    // incomplete (task 5b).
+    if (team.length !== size || saving) return;
     const name = saveName.trim();
     // Saving under a name already in the list updates that roster instead of
     // writing a second row with the same label — but only when asked for. The
     // update path replaces every member, so an unprompted overwrite would be
     // indistinguishable from losing a roster.
     //
     // This reads the list already in state rather than re-fetching: it is
     // refreshed on sign-in and after every save and delete, which covers one
     // browser. It does NOT close the window where a second tab inserts the
     // same name between this check and the write — nothing but a unique index
     // on (owner_id, name) can, and there is none.
-    const clashes = rostersNamed(savedTeams, name);
+    const clashes = rostersNamed(savedTeams, name, size);
     const target = clashes[0];
     // Declining writes nothing at all. Falling back to an insert here would
     // answer "don't replace it" with a duplicate, which is what this whole
     // affordance exists to stop.
     if (target && !window.confirm(replacePrompt(target, clashes.length, league))) return;
     setSaving(true);
     setSavesError(null);
     try {
       // Every member is encoded, whether it went through the build modal or
       // not — `builds` has no entry for a ref added through the quick search,
       // and `defaultChoice` is what that ref is actually carrying (the rated
       // set `Slot` falls back to), not nothing.
       const members = team.map((ref) => encodeMember(builds[ref] ?? defaultChoice(ref, league), league));
-      await saveTeam({ id: target?.id, name, league, members });
+      await saveTeam({ id: target?.id, name, league, size, members });
       setSaveName('');
-      setSavedTeams(await listTeams());
+      setSavedTeams(await listTeams(size));
     } catch (e) {
       setSavesError(e instanceof Error ? e.message : String(e));
     } finally {
       setSaving(false);
     }
   };
 
   // Sets both `team` and `builds` — and REPLACES rather than merges into
   // either. See the comment on `add`/`t.includes` above: this screen has a
   // history of a second write landing on top of the render the first one
@@ -446,21 +470,21 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
     setBuilds(nextBuilds);
     invalidate();
     setSavedOpen(false);
     setLoadNotice(notices.length > 0 ? notices.join(' ') : null);
   };
 
   const deleteSaved = async (t: SavedTeam) => {
     if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
     try {
       await deleteTeam(t.id);
-      setSavedTeams(await listTeams());
+      setSavedTeams(await listTeams(size));
     } catch (e) {
       setSavesError(e instanceof Error ? e.message : String(e));
     }
   };
 
   const run = () => {
     setBusy(true);
     // Yield once so the button paints its busy state before the sim blocks.
     setTimeout(() => {
       const t0 = performance.now();
@@ -580,21 +604,26 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
           <div className="team-saves">
             <div className="team-saves-row">
               <label className="hud-label" htmlFor="team-save-name">Save this roster</label>
               <input
                 id="team-save-name"
                 className="input team-save-name"
                 placeholder="Name this roster"
                 value={saveName}
                 onChange={(e) => setSaveName(e.target.value)}
               />
-              <button className="btn btn-primary" disabled={team.length === 0 || saveName.trim() === '' || saving} onClick={saveRoster}>
+              <button
+                className="btn btn-primary"
+                disabled={team.length !== size || saveName.trim() === '' || saving}
+                title={saveIncompleteReason ?? undefined}
+                onClick={saveRoster}
+              >
                 {saving ? 'Saving…' : 'Save roster'}
               </button>
               {/* Overlays the panel rather than growing it — a roster list that
                   gets longer with use must not shove the slots above it down
                   the page every time something new is saved. */}
               <div className="team-load-picker">
                 <button
                   type="button"
                   className="btn move-picker-btn"
                   aria-expanded={savedOpen}
@@ -632,20 +661,21 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
                               Delete
                             </button>
                           </li>
                         ))}
                       </ul>
                     )}
                   </div>
                 )}
               </div>
             </div>
+            {saveIncompleteReason && <p className="team-save-hint text-faint">{saveIncompleteReason}</p>}
             {loadNotice && <p className="team-load-notice">{loadNotice}</p>}
             {savesError && <p className="team-load-notice" role="alert">{savesError}</p>}
           </div>
         )}
         <div className="team-actions">
           {/* Two members, not a full roster. What beats a partial team and
               which swap answers it are per-member measurements — they do not
               need the empty slots filled, and the questions are at their most
               useful while there are still slots to fill. Only the chain result
               and the matrix game need a fieldable line; those say so
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
new file mode 100644
index 0000000..d9ab5c8
--- /dev/null
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -0,0 +1,942 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { readFileSync } from 'node:fs';
+import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
+import type { Session } from '@supabase/supabase-js';
+import type { QueueEntry, Match, MyOffer, Offer } from '../../lib/matchmaking';
+import type { SavedFormat } from '../../lib/saves';
+import { RULES_SCHEMA } from '../../rules';
+
+/**
+ * The Matchmaking screen: the blind queue, the open offer board, and
+ * scheduled proposals.
+ *
+ * `../../lib/matchmaking` is mocked at the module boundary — the round trip
+ * through Supabase belongs to `matchmaking.test.ts`, not here. What belongs
+ * here is what the screen does with the nine functions it calls: whether it
+ * calls them with the roster and format actually on screen, whether it asks
+ * before an irreversible leave, whether a self-proposed offer is ever given
+ * an Accept control the database would refuse anyway, and whether a `null`
+ * return from `acceptOffer` (a scheduled offer awaiting the proposer's
+ * confirmation) is ever rendered as a match.
+ */
+
+const mmApi = vi.hoisted(() => ({
+  joinQueue: vi.fn(),
+  leaveQueue: vi.fn(),
+  myQueueEntry: vi.fn(),
+  myMatches: vi.fn(),
+  listOpenOffers: vi.fn(),
+  myOffers: vi.fn(),
+  createOffer: vi.fn(),
+  acceptOffer: vi.fn(),
+  confirmOffer: vi.fn(),
+  opponentFriendCode: vi.fn(),
+}));
+vi.mock('../../lib/matchmaking', () => mmApi);
+
+/**
+ * `../../lib/saves` is mocked the same way, for the same reason — and it is
+ * mocked at all because a queue entry's `format_version_id` is a foreign key
+ * into `format_versions`, so the screen has to get a real one from somewhere.
+ * M2a's answer is a format the person saved to their account.
+ */
+const savesApi = vi.hoisted(() => ({ listServerFormats: vi.fn() }));
+vi.mock('../../lib/saves', () => savesApi);
+
+const pkg = vi.hoisted(() => ({ client: null as unknown }));
+vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
+
+function fakeSession(id: string, email: string): Session {
+  return { access_token: 'tok', user: { id, email } } as unknown as Session;
+}
+
+function fakeClient(session: Session | null) {
+  const auth = {
+    getSession: vi.fn(async () => ({ data: { session }, error: null })),
+    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
+    signOut: vi.fn(async () => ({ error: null })),
+  };
+  pkg.client = { auth };
+  return auth;
+}
+
+/**
+ * `lib/supabase` builds its client once at import time, so the mock above
+ * only takes effect for an import that happens AFTER `pkg.client` is set —
+ * see `team-saves.test.tsx`'s identical harness for why this resets modules
+ * and imports dynamically rather than importing at the top of the file.
+ */
+async function mount(session: Session | null) {
+  fakeClient(session);
+  vi.resetModules();
+  const { ThemeProvider } = await import('../../state/ThemeContext');
+  const { AppStateProvider } = await import('../../state/AppState');
+  const { SessionProvider } = await import('../../state/SessionContext');
+  const { MatchmakingScreen } = await import('../MatchmakingScreen');
+  let view!: RenderResult;
+  await act(async () => {
+    view = render(
+      <ThemeProvider>
+        <AppStateProvider>
+          <SessionProvider>
+            <MatchmakingScreen />
+          </SessionProvider>
+        </AppStateProvider>
+      </ThemeProvider>,
+    );
+  });
+  return { view, container: view.container };
+}
+
+/** Add a named Pokemon through the live search dropdown. Copied from
+ * team-saves.test.tsx's `pick` — reading the first row synchronously after
+ * the change event reads the *previous* render's list. */
+async function pick(container: HTMLElement, typed: string) {
+  const input = container.querySelector('.team-add input') as HTMLInputElement;
+  fireEvent.focus(input);
+  fireEvent.change(input, { target: { value: typed } });
+  const row = await waitFor(() => {
+    const hit = [...container.querySelectorAll('.search-dropdown .search-row')].find((r) =>
+      new RegExp(`^${typed}$`, 'i').test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''),
+    );
+    if (!hit) throw new Error(`no search result for "${typed}"`);
+    return hit;
+  });
+  fireEvent.mouseDown(row);
+}
+
+async function pickThree(container: HTMLElement) {
+  await pick(container, 'azumarill');
+  await pick(container, 'registeel');
+  await pick(container, 'skarmory');
+}
+
+function offer(over: Partial<Offer>): Offer {
+  return {
+    id: 'off-x',
+    proposerId: 'someone-else',
+    league: 'great',
+    formatVersionId: 'v1',
+    scheduledFor: null,
+    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
+    state: 'open',
+    acceptedBy: null,
+    // Verified by default: the unverified case is its own set of tests below,
+    // and leaving every fixture in it would silently remove the Accept control
+    // from tests that are about something else entirely.
+    verifiedHash: 'h1',
+    rosterSize: 3,
+    ...over,
+  };
+}
+
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
+    verifiedHash: 'h1',
+    matchId: null,
+    rosterSize: 3,
+    ...over,
+  };
+}
+
+function match(over: Partial<Match>): Match {
+  return {
+    id: 'm-x',
+    opponentId: 'opp-1',
+    formatVersionId: 'v1',
+    rulesHash: 'hash',
+    dataRev: 'rev1',
+    rounds: 3,
+    source: 'queue',
+    createdAt: new Date().toISOString(),
+    ...over,
+  };
+}
+
+beforeEach(() => {
+  mmApi.joinQueue.mockReset().mockResolvedValue('q1');
+  mmApi.leaveQueue.mockReset().mockResolvedValue(undefined);
+  mmApi.myQueueEntry.mockReset().mockResolvedValue(null);
+  mmApi.myMatches.mockReset().mockResolvedValue([]);
+  mmApi.listOpenOffers.mockReset().mockResolvedValue([]);
+  mmApi.myOffers.mockReset().mockResolvedValue([]);
+  mmApi.createOffer.mockReset().mockResolvedValue('o1');
+  mmApi.acceptOffer.mockReset().mockResolvedValue('m1');
+  mmApi.confirmOffer.mockReset().mockResolvedValue('m1');
+  mmApi.opponentFriendCode.mockReset().mockResolvedValue(null);
+  savesApi.listServerFormats.mockReset().mockResolvedValue([savedFormat()]);
+});
+afterEach(cleanup);
+
+describe('signed out', () => {
+  it('offers nothing to sign in with when signed out', async () => {
+    const { container } = await mount(null);
+    expect(container.querySelector('.queue-join')).toBeFalsy();
+    expect(container.textContent).toMatch(/sign in/i);
+  });
+});
+
+describe('signed in — the blind queue', () => {
+  it('cannot join with an incomplete roster', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
+    expect(joinBtn).toBeTruthy();
+    expect(joinBtn.disabled).toBe(true);
+  });
+
+  it('joins the queue with the roster and format on screen', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
+    expect(joinBtn.disabled).toBe(false);
+    await act(async () => {
+      fireEvent.click(joinBtn);
+    });
+    await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
+    const arg = mmApi.joinQueue.mock.calls[0][0] as {
+      league: string;
+      formatVersionId: string;
+      format: { base: string };
+      team: { ref: string }[];
+    };
+    expect(arg.league).toBe('great');
+    expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
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
+  });
+
+  it('distinguishes queued-awaiting-verification from queued-and-eligible', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: null,
+      expiresAt: new Date(Date.now() + 600_000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/awaiting verification/i));
+    expect(container.textContent).not.toMatch(/eligible to pair/i);
+  });
+
+  it('shows a verified entry as eligible, not awaiting', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: 'abc123',
+      expiresAt: new Date(Date.now() + 600_000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/eligible to pair/i));
+    expect(container.textContent).not.toMatch(/awaiting verification/i);
+  });
+
+  it('asks before leaving a queue it is already in', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: null,
+      expiresAt: new Date(Date.now() + 600_000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const leaveBtn = await waitFor(() => {
+      const b = [...container.querySelectorAll('button')].find((x) => /Leave queue/i.test(x.textContent ?? ''));
+      if (!b) throw new Error('leave button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
+    fireEvent.click(leaveBtn);
+    expect(confirmSpy).toHaveBeenCalledTimes(1);
+    expect(mmApi.leaveQueue).not.toHaveBeenCalled();
+
+    confirmSpy.mockReturnValue(true);
+    await act(async () => {
+      fireEvent.click(leaveBtn);
+    });
+    await waitFor(() => expect(mmApi.leaveQueue).toHaveBeenCalledTimes(1));
+    confirmSpy.mockRestore();
+  });
+});
+
+describe('signed in — matches and friend codes', () => {
+  it("shows the opponent's friend code once a match exists", async () => {
+    mmApi.myMatches.mockResolvedValue([match({ opponentId: 'opp-1' })]);
+    mmApi.opponentFriendCode.mockResolvedValue('1234 5678 9012');
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/1234 5678 9012/));
+    expect(mmApi.opponentFriendCode).toHaveBeenCalledWith('opp-1');
+  });
+
+  it('says no friend code is on file rather than showing nothing', async () => {
+    mmApi.myMatches.mockResolvedValue([match({ opponentId: 'opp-2' })]);
+    mmApi.opponentFriendCode.mockResolvedValue(null);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/no friend code/i));
+  });
+});
+
+describe('signed in — the open offer board', () => {
+  it('disables accept on an offer the signed-in person proposed', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-mine', proposerId: 'u1' }),
+      offer({ id: 'off-theirs', proposerId: 'someone-else' }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const [mineRow, theirsRow] = await waitFor(() => {
+      const mine = container.querySelector('[data-offer-id="off-mine"]');
+      const theirs = container.querySelector('[data-offer-id="off-theirs"]');
+      if (!mine || !theirs) throw new Error('offer rows not rendered yet');
+      return [mine, theirs];
+    });
+    // The database refuses match_offers_not_self and accept_offer raises for
+    // it too, but a control that can only fail should not be presented.
+    expect(mineRow.querySelector('.offer-accept')).toBeFalsy();
+    expect(theirsRow.querySelector('.offer-accept')).toBeTruthy();
+  });
+
+  it('shows a scheduled offer awaiting confirmation as awaiting, not as a match', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-sched', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() }),
+    ]);
+    mmApi.acceptOffer.mockResolvedValue(null);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const acceptBtn = await waitFor(() => {
+      const b = container.querySelector('[data-offer-id="off-sched"] .offer-accept');
+      if (!b) throw new Error('accept button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledWith('off-sched', expect.any(Array)));
+    // accept_offer returns null for a scheduled offer: it is `accepted`, not
+    // yet a match, until the proposer confirms. Rendering null as "matched"
+    // would put a battle on someone's calendar nobody actually confirmed.
+    expect(container.textContent).toMatch(/awaiting/i);
+    expect(container.textContent).not.toMatch(/matched!/i);
+  });
+
+  it('shows a live offer as matched once accepted, since accept_offer returned a match id', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-live' })]);
+    mmApi.acceptOffer.mockResolvedValue('brand-new-match');
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const acceptBtn = await waitFor(() => {
+      const b = container.querySelector('[data-offer-id="off-live"] .offer-accept');
+      if (!b) throw new Error('accept button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(container.textContent).toMatch(/matched!/i));
+  });
+
+  it('posts an offer to the open board with the roster and format on screen', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
+    fireEvent.click(toggle);
+    const postBtn = await waitFor(() => {
+      const b = [...container.querySelectorAll('button')].find((x) => /Post to the open board/i.test(x.textContent ?? ''));
+      if (!b) throw new Error('post button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(postBtn);
+    });
+    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
+    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; team: { ref: string }[] };
+    expect(arg.scheduledFor).toBeUndefined();
+    expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+  });
+
+  it('schedules an offer for later with a scheduledFor date, and re-reads its own offers from the server', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
+    fireEvent.click(toggle);
+    const dtInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
+    const future = new Date(Date.now() + 3 * 86_400_000);
+    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T12:00`;
+    fireEvent.change(dtInput, { target: { value: local } });
+    const before = mmApi.myOffers.mock.calls.length;
+    const scheduleBtn = [...container.querySelectorAll('button')].find((b) => /^Schedule$/i.test(b.textContent ?? ''))!;
+    await act(async () => {
+      fireEvent.click(scheduleBtn);
+    });
+    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
+    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; formatVersionId: string };
+    expect(arg.scheduledFor).toBeInstanceOf(Date);
+    expect(arg.formatVersionId).toBe('fv-great-2');
+    // Read back, not remembered: what this panel shows has to survive the
+    // reload that throws every piece of session state away.
+    await waitFor(() => expect(mmApi.myOffers.mock.calls.length).toBeGreaterThan(before));
+  });
+});
+
+/**
+ * Accepting is the OFFER's business, not yours.
+ *
+ * `accept_offer(p_offer, p_team)` takes no format argument: the offer's own
+ * `format_version_id` governs the match. So neither a saved format of your
+ * own nor its `composition.size` may have any say in whether, or with what,
+ * you accept — the first locks out everyone who has none, and the second
+ * quietly sends a roster of the wrong length into someone else's offer.
+ */
+describe('signed in — accepting an offer', () => {
+  it('lets someone with no saved format of their own accept an open offer', async () => {
+    savesApi.listServerFormats.mockResolvedValue([]);
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-open', rosterSize: 3 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-open"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+
+    const acceptBtn = container.querySelector('[data-offer-id="off-open"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn).toBeTruthy();
+    // The database would take this person: they need no format to accept one.
+    expect(acceptBtn.disabled).toBe(false);
+    // And never the tooltip that used to sit on a permanently dead control.
+    expect(acceptBtn.getAttribute('title') ?? '').not.toMatch(/add 0 more/i);
+
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
+    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(3);
+    // Their own Join is still, correctly, not on offer — that one does need a
+    // format. The two gates are separate, which is the whole point.
+    expect(container.querySelector('.queue-join')).toBeFalsy();
+  });
+
+  it('sizes the roster it accepts with by the offer, not by your own format', async () => {
+    // Your format wants six; this offer is played with three.
+    savesApi.listServerFormats.mockResolvedValue([
+      savedFormat({
+        format: {
+          schema: RULES_SCHEMA,
+          base: 'great',
+          pool: [],
+          composition: { size: 6, uniqueSpecies: true },
+          selection: { mode: 'open' },
+        },
+      }),
+    ]);
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+
+    const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(false);
+    // Sized by your own six-member format, Join is not ready at three — the
+    // contrast is the assertion: one control says yes and the other says no,
+    // on the same roster, because they answer to different formats.
+    expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(true);
+
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
+    // Three, because the offer is played with three. Nothing downstream would
+    // have rejected six: the coordinator recomputes rules_hash and never
+    // inspects the roster.
+    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(3);
+  });
+
+  it('refuses to send a six-strong roster into a three-member offer', async () => {
+    // The exact mismatch nothing downstream would catch: `accept_offer` stores
+    // whatever roster it is handed as `matches.team_b`, and the coordinator
+    // recomputes `rules_hash` without ever inspecting `team`. A gate written
+    // as "at least as many as the offer wants" would let this through.
+    savesApi.listServerFormats.mockResolvedValue([
+      savedFormat({
+        format: {
+          schema: RULES_SCHEMA,
+          base: 'great',
+          pool: [],
+          composition: { size: 6, uniqueSpecies: true },
+          selection: { mode: 'open' },
+        },
+      }),
+    ]);
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    await pick(container, 'medicham');
+    await pick(container, 'swampert');
+    await pick(container, 'bastiodon');
+    // Six picked, under your own six-member format, which is legitimate — and
+    // Join is ready. It is Accept that must not be.
+    expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(false);
+    const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(true);
+    expect(acceptBtn.getAttribute('title')).toMatch(/roster of 3/i);
+  });
+
+  it('offers no Accept on an offer the coordinator has not verified yet, and says why', async () => {
+    // The coordinator ticks once a minute, so this is the normal first minute
+    // of every offer's life, not a rare edge — and `accept_offer` raises
+    // 'this offer has not been verified yet' for the whole of it.
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-fresh', verifiedHash: null }),
+      offer({ id: 'off-ready', verifiedHash: 'h1' }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const [fresh, ready] = await waitFor(() => {
+      const a = container.querySelector('[data-offer-id="off-fresh"]');
+      const b = container.querySelector('[data-offer-id="off-ready"]');
+      if (!a || !b) throw new Error('board not rendered yet');
+      return [a, b];
+    });
+    await pickThree(container);
+    expect(fresh.querySelector('.offer-accept')).toBeFalsy();
+    // A reason in the person's own register, so the board reads as busy
+    // rather than broken.
+    expect(fresh.textContent).toMatch(/being checked/i);
+    // And the verified one beside it is unaffected — otherwise this test
+    // would pass against a board that offered nothing to anybody.
+    expect((ready.querySelector('.offer-accept') as HTMLButtonElement).disabled).toBe(false);
+  });
+
+  it('tells the proposer their own offer is being checked, not that nobody wants it', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({ id: 'off-fresh', proposerId: 'u1', state: 'open', verifiedHash: null }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-fresh"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
+    });
+    expect(row.textContent).toMatch(/being checked/i);
+    expect(row.textContent).not.toMatch(/nobody has accepted/i);
+  });
+
+  it('offers no Accept on an offer posted with no roster at all', async () => {
+    // Not reachable from this screen, which never posts an empty roster — but
+    // `accept_offer` refuses only a NULL p_team, not an empty one, so a
+    // malformed offer from another client would otherwise convert into a
+    // match with an empty team_b.
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-empty', rosterSize: 0 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-offer-id="off-empty"]');
+      if (!r) throw new Error('board not rendered yet');
+      return r;
+    });
+    // A fresh screen holds an empty roster, so `team.length === o.rosterSize`
+    // is 0 === 0 — true. Length alone would have offered an enabled Accept.
+    expect(row.querySelector('.offer-accept')).toBeFalsy();
+    expect(row.textContent).toMatch(/without a roster/i);
+  });
+
+  it('refuses to accept with a roster of the wrong length, and says what the offer wants', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(true);
+    expect(acceptBtn.getAttribute('title')).toMatch(/roster of 6/i);
+  });
+
+  it('lets the roster grow past your own format to reach a bigger offer', async () => {
+    // Otherwise a six-member offer is unacceptable no matter what you pick,
+    // which is the "control that cannot succeed" rule wearing the roster's
+    // clothes: your own three-member format would cap the picker at three.
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    await pick(container, 'medicham');
+    await pick(container, 'swampert');
+    await pick(container, 'bastiodon');
+    // Every member picked is rendered in a slot — a member with no slot is a
+    // member nobody can remove.
+    expect(container.querySelectorAll('.team-slots > *').length).toBeGreaterThanOrEqual(6);
+
+    // Your own three-member format now wants three FEWER than you hold, and
+    // the shortfall arithmetic runs negative here: "Add -3 more to queue".
+    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
+    expect(joinBtn.disabled).toBe(true);
+    expect(joinBtn.getAttribute('title')).toMatch(/^Remove 3 to queue$/);
+    expect(joinBtn.getAttribute('title')).not.toMatch(/-\d/);
+
+    const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(false);
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
+    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(6);
+  });
+});
+
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
+    });
+    expect(row.textContent).toMatch(/confirm it to make it a match/i);
+    const confirmBtn = row.querySelector('.offer-confirm') as HTMLButtonElement;
+    expect(confirmBtn).toBeTruthy();
+    await act(async () => {
+      fireEvent.click(confirmBtn);
+    });
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
+ * An offer past its own `expires_at`.
+ *
+ * `accept_offer` raises 'this offer has expired' before it checks anything
+ * else, and expiry is a coordinator SWEEP rather than a trigger — the row sits
+ * in `state = 'open'` until the next tick. `listOpenOffers` filters on
+ * `league` and `state` only, so it hands the expired row back looking exactly
+ * like a live one, and nothing on this screen re-reads the board on its own.
+ * A page left open past the timestamp therefore shows an enabled Accept whose
+ * only possible outcome is raw Postgres text, indefinitely.
+ */
+describe('signed in — an offer that has expired', () => {
+  it('offers no Accept on an offer past its expiry, and says so', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-gone', expiresAt: new Date(Date.now() - 60_000).toISOString() }),
+      offer({ id: 'off-live', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const [gone, live] = await waitFor(() => {
+      const a = container.querySelector('[data-offer-id="off-gone"]');
+      const b = container.querySelector('[data-offer-id="off-live"]');
+      if (!a || !b) throw new Error('board not rendered yet');
+      return [a, b];
+    });
+    // A roster of exactly the size the offer wants: the ONLY remaining gate is
+    // the expiry itself, so without it this Accept renders enabled.
+    await pickThree(container);
+    expect(gone.querySelector('.offer-accept')).toBeFalsy();
+    // Unfixable, so the reason takes the control's place rather than sitting
+    // in a tooltip on a dead button — the split the screen keeps.
+    expect(gone.querySelector('.offer-blocked')?.textContent).toMatch(/expired/i);
+    // And the live offer beside it is untouched, or this test would pass
+    // against a board that offered nothing to anybody.
+    expect((live.querySelector('.offer-accept') as HTMLButtonElement).disabled).toBe(false);
+  });
+
+  it('is the reason given even when the offer is also unverified, as the database would', async () => {
+    // `accept_offer` checks expiry BEFORE verified_hash, so "being checked"
+    // here would be a sentence the database disagrees with — and a hopeful
+    // one, since "acceptable once verified" is a promise this row cannot keep.
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-both', verifiedHash: null, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-offer-id="off-both"]');
+      if (!r) throw new Error('board not rendered yet');
+      return r;
+    });
+    expect(row.textContent).toMatch(/expired/i);
+    expect(row.textContent).not.toMatch(/being checked/i);
+  });
+});
+
+/**
+ * Every disabled control says why it is disabled.
+ *
+ * Three buttons share the `rosterReady` gate — Join, Post and Schedule — and
+ * until now only Join carried a hint; the other two went dead and silent in
+ * exactly the state round 3 named. And any of them, plus Accept, can be dead
+ * for the length of an in-flight call with nothing said at all.
+ */
+describe('signed in — a disabled control says why', () => {
+  async function openPostPanel(container: HTMLElement) {
+    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
+    fireEvent.click(toggle);
+    return waitFor(() => {
+      const b = container.querySelector('.offer-post') as HTMLButtonElement | null;
+      if (!b) throw new Error('post panel not open yet');
+      return b;
+    });
+  }
+
+  it('names its own action in the roster hint, rather than telling Post to queue', async () => {
+    // The state round 3 named: own format of three, a six-member offer on the
+    // board, six picked to reach it. Join says "Remove 3 to queue"; Post and
+    // Schedule are dead under the same gate.
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    await pick(container, 'medicham');
+    await pick(container, 'swampert');
+    await pick(container, 'bastiodon');
+
+    const postBtn = await openPostPanel(container);
+    const schedBtn = container.querySelector('.offer-schedule') as HTMLButtonElement;
+    expect(postBtn.disabled).toBe(true);
+    expect(schedBtn.disabled).toBe(true);
+    expect(postBtn.getAttribute('title')).toBe('Remove 3 to post');
+    expect(schedBtn.getAttribute('title')).toBe('Remove 3 to schedule');
+    // Not the one verb the parameter used to be hardcoded to.
+    expect(postBtn.getAttribute('title')).not.toMatch(/queue/);
+    expect(schedBtn.getAttribute('title')).not.toMatch(/queue/);
+  });
+
+  it('tells Schedule apart from Post when the roster is fine and only the date is missing', async () => {
+    // The one state where Schedule is dead and Post beside it is live. A
+    // roster hint here would be actively wrong.
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const postBtn = await openPostPanel(container);
+    const schedBtn = container.querySelector('.offer-schedule') as HTMLButtonElement;
+    expect(postBtn.disabled).toBe(false);
+    expect(postBtn.getAttribute('title')).toBeNull();
+    expect(schedBtn.disabled).toBe(true);
+    // The exact string, not a pattern: `getAttribute` returns null for a
+    // missing title, and `toMatch(null)` is a TypeError rather than a
+    // failed assertion — which is the difference between evidence and noise.
+    expect(schedBtn.getAttribute('title')).toBe('Pick a date and time to schedule for');
+    expect(schedBtn.getAttribute('title') ?? '').not.toMatch(/add|remove/i);
+  });
+
+  it('says why Accept is dead for the length of an in-flight call', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-a' }), offer({ id: 'off-b' })]);
+    let release!: (id: string | null) => void;
+    mmApi.acceptOffer.mockReturnValue(new Promise<string | null>((res) => (release = res)));
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-b"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    const a = container.querySelector('[data-offer-id="off-a"] .offer-accept') as HTMLButtonElement;
+    const b = container.querySelector('[data-offer-id="off-b"] .offer-accept') as HTMLButtonElement;
+    expect(b.getAttribute('title')).toBeNull();
+    await act(async () => {
+      fireEvent.click(a);
+    });
+    // `canAccept(off-b)` is still true — `busy` is the only gate that shut,
+    // and it is the one an undefined title left unexplained.
+    expect(b.disabled).toBe(true);
+    expect(b.getAttribute('title')).toBe('Working — wait for the last action to finish');
+    await act(async () => {
+      release('m1');
+    });
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
+  });
+
+  /**
+   * The rule's own comment claims .offer-blocked is sized like the control it
+   * stands in for. Asserted against .chip-btn's ACTUAL declarations rather
+   * than against the literal 32px, so the two cannot drift apart silently —
+   * which is the whole failure mode the claim had before this round: a
+   * sentence describing a box the rule never had.
+   */
+  it('gives the blocked reason the same box as the Accept control it replaces', () => {
+    const chip = block('.chip-btn');
+    const blocked = block('.offer-blocked');
+    const decl = (rule: string, prop: string) =>
+      rule.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1].trim() ?? null;
+
+    expect(decl(chip, 'min-height'), '.chip-btn declares no min-height').not.toBeNull();
+    expect(decl(blocked, 'min-height')).toBe(decl(chip, 'min-height'));
+    expect(decl(blocked, 'padding')).toBe(decl(chip, 'padding'));
+    // Height only bites on a box that can have one.
+    expect(blocked).toMatch(/display:\s*inline-flex/);
+  });
+});
diff --git a/app/src/screens/__tests__/team-saves.test.tsx b/app/src/screens/__tests__/team-saves.test.tsx
index 2f925e4..2cc7ee2 100644
--- a/app/src/screens/__tests__/team-saves.test.tsx
+++ b/app/src/screens/__tests__/team-saves.test.tsx
@@ -72,25 +72,32 @@ function choiceFor(ref: string): AddPokemonChoice {
   const sp = speciesOf(ref)!;
   const rated = movesFor(sp, 'great');
   return {
     ref,
     fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
     chargeIds: rated.charges.map((c) => c.id),
     iv: { a: 0, d: 15, s: 15 },
   };
 }
 
-function savedTeam(id: string, name: string, refs: string[], league: SavedTeam['league'] = 'great'): SavedTeam {
+function savedTeam(
+  id: string,
+  name: string,
+  refs: string[],
+  league: SavedTeam['league'] = 'great',
+  size: SavedTeam['size'] = 3,
+): SavedTeam {
   return {
     id,
     name,
     league,
+    size,
     members: refs.map((r) => encodeMember(choiceFor(r), league)),
   };
 }
 
 /** Add a named Pokemon through the live search dropdown. Copied from
  * team-builder.test.tsx's `pick` — reading the first row synchronously after
  * the change event reads the *previous* render's list. */
 async function pick(container: HTMLElement, typed: string) {
   const input = container.querySelector('.team-add input') as HTMLInputElement;
   fireEvent.focus(input);
@@ -150,49 +157,146 @@ describe('signed in', () => {
 
   it('enables saving once there are members AND a name, and saves both in slot order', async () => {
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
     await pick(container, 'registeel');
     // Members alone are not enough — a blank name would write a row whose
     // Load button has no text (Finding 2).
     expect(saveButton(container)!.disabled).toBe(true);
 
     fireEvent.change(nameInput(container), { target: { value: 'My Team' } });
+    // A name alone is not enough either now: two of three, named, still is
+    // not a saveable roster (task 5b) — today's only check was
+    // `team.length === 0`, which let a 1-of-6 be saved.
+    expect(saveButton(container)!.disabled).toBe(true);
+
+    await pick(container, 'skarmory');
     expect(saveButton(container)!.disabled).toBe(false);
     await act(async () => {
       fireEvent.click(saveButton(container)!);
     });
 
     await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
-    const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string; league: string; members: { ref: string }[] };
-    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel']);
+    const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string; league: string; size: number; members: { ref: string }[] };
+    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+    expect(arg.size).toBe(3);
   });
 
-  it('keeps save disabled for a whitespace-only name, even with members added', async () => {
+  it('keeps save disabled for a whitespace-only name, even with a complete roster', async () => {
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
+    await pick(container, 'registeel');
+    await pick(container, 'skarmory');
     fireEvent.change(nameInput(container), { target: { value: '   ' } });
     expect(saveButton(container)!.disabled).toBe(true);
   });
 
   it('saves the name exactly as typed', async () => {
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
+    await pick(container, 'registeel');
+    await pick(container, 'skarmory');
     fireEvent.change(nameInput(container), { target: { value: 'Rain Squad' } });
     await act(async () => {
       fireEvent.click(saveButton(container)!);
     });
     await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
     const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string };
     expect(arg.name).toBe('Rain Squad');
   });
 
+  /**
+   * Task 5b's save gate: `team.length === size`, not merely `> 0`. This is
+   * what closes the 1-of-6-save hole — the old check let a wildly partial
+   * roster be written, silently, as long as it had at least one member and a
+   * name.
+   */
+  describe('the save control requires a complete roster', () => {
+    it('stays disabled for a partial GBL team of three, even named, and says why', async () => {
+      const { container } = await mount(3, fakeSession('ash@example.com'));
+      await pick(container, 'azumarill');
+      fireEvent.change(nameInput(container), { target: { value: 'Partial' } });
+      const btn = saveButton(container)!;
+      expect(btn.disabled).toBe(true);
+      // Says why, the way the blank-name case does — a disabled control with
+      // no visible reason is indistinguishable from a broken one.
+      expect(container.textContent).toMatch(/add 2 more to save/i);
+    });
+
+    it('enables at exactly three for GBL, not before and not by allowing a fourth', async () => {
+      const { container } = await mount(3, fakeSession('ash@example.com'));
+      await pick(container, 'azumarill');
+      await pick(container, 'registeel');
+      fireEvent.change(nameInput(container), { target: { value: 'Full Three' } });
+      expect(saveButton(container)!.disabled).toBe(true);
+      await pick(container, 'skarmory');
+      expect(saveButton(container)!.disabled).toBe(false);
+    });
+
+    it('stays disabled for a partial Show 6 roster, even named, and says why', async () => {
+      const { container } = await mount(6, fakeSession('ash@example.com'));
+      await pick(container, 'azumarill');
+      await pick(container, 'registeel');
+      fireEvent.change(nameInput(container), { target: { value: 'Partial Six' } });
+      const btn = saveButton(container)!;
+      expect(btn.disabled).toBe(true);
+      expect(container.textContent).toMatch(/add 4 more to save/i);
+    });
+
+    it('enables at exactly six for Show 6, and sends size 6', async () => {
+      const { container } = await mount(6, fakeSession('ash@example.com'));
+      for (const r of ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash']) {
+        await pick(container, r);
+      }
+      fireEvent.change(nameInput(container), { target: { value: 'Full Six' } });
+      expect(saveButton(container)!.disabled).toBe(false);
+      await act(async () => {
+        fireEvent.click(saveButton(container)!);
+      });
+      await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
+      const arg = savesApi.saveTeam.mock.calls[0][0] as { size: number; members: { ref: string }[] };
+      expect(arg.size).toBe(6);
+      expect(arg.members).toHaveLength(6);
+    });
+  });
+
+  /**
+   * The scoping that makes the overwrite prompt safe again. Before this, both
+   * builders shared one unfiltered `listTeams()`, so a same-named roster from
+   * the OTHER builder's size would show up as a match — and the overwrite
+   * this screen offers deletes every slot past the new length (see the brief
+   * and ledger Ruling 13). `listTeams` mocked here to actually honour the
+   * `size` argument, the way the real server-side `.eq('size', size)` would,
+   * so this test fails the way production would fail if the screen ever
+   * stopped passing its own size through.
+   */
+  it("never shows a Show 6 roster in the GBL picker, because listTeams is asked for size 3 only", async () => {
+    const sixRoster = savedTeam(
+      't-six',
+      'Shared Name',
+      ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash'],
+      'great',
+      6,
+    );
+    savesApi.listTeams.mockImplementation(async (size: number) => (size === 6 ? [sixRoster] : []));
+    const { container } = await mount(3, fakeSession('ash@example.com'));
+    expect(savesApi.listTeams).toHaveBeenCalledWith(3);
+    openSavedList(container);
+    await waitFor(() => expect(container.querySelector('.team-load-panel')).toBeTruthy());
+    expect(container.textContent).not.toMatch(/Shared Name/);
+  });
+
+  it('asks listTeams for its own size on mount', async () => {
+    await mount(6, fakeSession('ash@example.com'));
+    expect(savesApi.listTeams).toHaveBeenCalledWith(6);
+  });
+
   it('replaces the roster outright when loading a saved team, not appending to it', async () => {
     // The roster already carries two DIFFERENT members before the load. If the
     // screen appended instead of replacing, the roster would hold 4 (or more)
     // and would still contain azumarill/registeel — a superset, not the loaded
     // set. Asserting the exact final set is the only check that distinguishes
     // "replaced" from "happened to be the same length".
     savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'Rain Team', ['medicham', 'skarmory'])]);
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
     await pick(container, 'registeel');
@@ -341,42 +445,73 @@ describe('signed in', () => {
  * `saveTeam`'s update path took an `id` from the day it was written and had no
  * caller: every save from this screen omitted `id`, so every save inserted, and
  * saving twice under one name left two rows with the same label in the load
  * list and no way to tell them apart. These tests are about which of the two
  * branches the screen reaches, so they assert on the `id` argument — the only
  * thing that distinguishes them.
  */
 describe('saving over an existing roster', () => {
   const session = () => fakeSession('ash@example.com');
 
-  /** Build a roster and type `name` into the save box. */
+  /** Build a full roster (exactly `size`, here always 3) and type `name` into the save box. */
   async function rosterNamed(container: HTMLElement, name: string) {
     await pick(container, 'azumarill');
     await pick(container, 'registeel');
+    await pick(container, 'skarmory');
     fireEvent.change(nameInput(container), { target: { value: name } });
   }
 
   it('asks first, then updates the existing row instead of inserting a second one', async () => {
     savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
     const { container } = await mount(3, session());
     await rosterNamed(container, 'GL Squad');
 
     const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
     await act(async () => {
       fireEvent.click(saveButton(container)!);
     });
 
     expect(confirmSpy).toHaveBeenCalledTimes(1);
     await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
     const arg = savesApi.saveTeam.mock.calls[0][0] as { id?: string; name: string; members: { ref: string }[] };
     expect(arg.id).toBe('t1');
-    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel']);
+    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+    confirmSpy.mockRestore();
+  });
+
+  /**
+   * Task 5b's whole point. Before the list was scoped by size, this exact
+   * scenario — a same-named roster of the OTHER size sitting in `savedTeams`
+   * — is what let a 3-roster save offer to replace a 6-roster, and the
+   * update path then deletes every slot past 3. `listTeams` is scoped
+   * server-side now, so this roster would never really reach a `size=3`
+   * mount's `savedTeams` — but the match itself is asserted here too
+   * (defense in depth against a stale fetch or a future regression in that
+   * scoping), by forcing exactly the state a scoping bug would produce.
+   */
+  it('does not offer to replace a same-named roster of a different size', async () => {
+    savesApi.listTeams.mockResolvedValue([
+      savedTeam('t-six', 'GL Squad', ['medicham', 'skarmory', 'bastiodon', 'whiscash', 'registeel', 'azumarill'], 'great', 6),
+    ]);
+    const { container } = await mount(3, session());
+    await rosterNamed(container, 'GL Squad');
+
+    const confirmSpy = vi.spyOn(window, 'confirm');
+    await act(async () => {
+      fireEvent.click(saveButton(container)!);
+    });
+
+    expect(confirmSpy).not.toHaveBeenCalled();
+    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
+    // No id: this is an insert, not the update path that would delete the
+    // six's slots 4-6.
+    expect((savesApi.saveTeam.mock.calls[0][0] as { id?: string }).id).toBeUndefined();
     confirmSpy.mockRestore();
   });
 
   it('writes nothing at all when the replacement is declined', async () => {
     savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
     const { container } = await mount(3, session());
     await rosterNamed(container, 'GL Squad');
 
     const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
     await act(async () => {
diff --git a/app/src/state/AppState.tsx b/app/src/state/AppState.tsx
index 5d1475e..359074f 100644
--- a/app/src/state/AppState.tsx
+++ b/app/src/state/AppState.tsx
@@ -1,16 +1,16 @@
 import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
 import type { IV, LeagueId } from '../lib/types';
 import { opponentsFor, randomMatchup } from '../lib/data';
 import { defaultSpreadFor } from '../lib/engine';
 
-export type Screen = 'landing' | 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores' | 'diagnostics' | 'moves' | 'formats' | 'account';
+export type Screen = 'landing' | 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores' | 'diagnostics' | 'moves' | 'formats' | 'matchmaking' | 'account';
 export type Viz = 'heat' | 'ruler' | 'table' | 'flip';
 export type ColorBy = 'rank' | 'break' | 'bulk';
 
 export interface AppStateShape {
   screen: Screen;
   league: LeagueId;
   /** Ref, may carry a `_shadow` suffix. */
   species: string;
   shadow: boolean;
   /**
diff --git a/app/src/styles/components.css b/app/src/styles/components.css
index 08b5398..eb14052 100644
--- a/app/src/styles/components.css
+++ b/app/src/styles/components.css
@@ -5936,10 +5936,131 @@ th.bt-matrix-head { text-align: center; }
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
+/* The reason an offer cannot be accepted, standing where its Accept control
+   would be.
+
+   It carries .chip-btn's own box — min-height, padding, and a hairline border
+   made transparent — so a row showing a reason is exactly as tall as a row
+   showing a button, and the board does not go ragged when some offers are
+   acceptable and others are not. That matters on the re-read too: the board is
+   re-fetched after a post or an accept, and an offer that has verified since
+   the last read swaps this span for a button in place, without the rows under
+   it stepping.
+
+   The re-read is the ONLY thing that swaps it. Nothing on this screen polls,
+   so an offer does not become acceptable on its own while the tab sits open —
+   an earlier version of this comment claimed it did, and claimed a size this
+   rule did not have. Both are fixed here rather than one being written around
+   the other: the sizing is worth having, and the polling is a separate
+   decision nobody has taken.
+
+   --text-xs and italic stay: the box is the control's, the voice is not. */
+.offer-blocked {
+  display: inline-flex;
+  align-items: center;
+  min-height: 32px;
+  padding: 0 10px;
+  border: var(--border-hairline) solid transparent;
+  font-size: var(--text-xs);
+  font-style: italic;
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
diff --git a/app/tools/m2a-roundtrip.ts b/app/tools/m2a-roundtrip.ts
new file mode 100644
index 0000000..1052484
--- /dev/null
+++ b/app/tools/m2a-roundtrip.ts
@@ -0,0 +1,859 @@
+/**
+ * M2a end-to-end round trip: three real confirmed accounts, the real modules,
+ * the real local Postgres, and the real coordinator Edge Function.
+ *
+ * Why this file is kept while M1b's equivalents were throwaways: every other
+ * test in this milestone either mocks the Supabase client or drives SQL
+ * directly. A mock agrees with whatever it is told, and SQL run as the table
+ * owner never meets a policy. Neither can see what M1b learned the hard way —
+ * a green suite is not evidence about a system nobody ran. This is the only
+ * end-to-end proof M2a has.
+ *
+ * It imports the SHIPPING modules (`src/lib/matchmaking.ts`, `src/lib/saves.ts`,
+ * `src/rules`) and never reimplements them. Anything it proves is a property of
+ * the code the browser runs.
+ *
+ * Run it:
+ *
+ *   cd app
+ *   ./node_modules/.bin/esbuild tools/m2a-roundtrip.ts --bundle --platform=node \
+ *     --format=esm --outfile=node_modules/.cache/m2a.mjs --log-level=warning \
+ *     --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"<sb_publishable_… from npm run db:start>"}'
+ *   SUPABASE_SERVICE_ROLE_KEY='<the local SERVICE_ROLE_KEY>' node node_modules/.cache/m2a.mjs
+ *
+ * The service-role key comes from the environment and is never written into
+ * this file: it bypasses every policy in `supabase/migrations`, so a copy of it
+ * in the repository would be a copy of it in every clone. It is used for
+ * exactly two things, both of which no client is permitted to do and both of
+ * which are named at their call sites: deleting `matches` rows (there is
+ * deliberately no client DELETE policy) and deleting the test accounts.
+ *
+ * The coordinator must be reachable. `supabase functions serve --workdir ..`
+ * from `app/`, and STOP IT AFTERWARDS — a stray server once turned a
+ * 44-second gate into a 68-minute run in this repo.
+ */
+import { createClient } from '@supabase/supabase-js';
+import { supabase } from '../src/lib/supabase';
+import { DATA_REV } from '../src/lib/data';
+import { rulesHash, type Format } from '../src/rules';
+import type { StoredMember } from '../src/lib/teamCodec';
+import {
+  listServerFormats,
+  saveServerFormat,
+  deleteServerFormat,
+  saveTeam,
+  listTeams,
+  deleteTeam,
+} from '../src/lib/saves';
+import {
+  joinQueue,
+  leaveQueue,
+  myQueueEntry,
+  myMatches,
+  createOffer,
+  acceptOffer,
+  confirmOffer,
+  listOpenOffers,
+  myOffers,
+  opponentFriendCode,
+} from '../src/lib/matchmaking';
+
+const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
+const COORDINATOR_URL =
+  process.env.COORDINATOR_URL ?? 'http://127.0.0.1:54321/functions/v1/coordinator';
+const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
+const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
+if (!SERVICE_ROLE_KEY) {
+  console.error(
+    'SUPABASE_SERVICE_ROLE_KEY is not set. It is needed to delete `matches` rows (no client\n' +
+      'DELETE policy exists, by design) and to delete the test accounts at the end. Take it from\n' +
+      '`supabase status --workdir ..`; never commit it.',
+  );
+  process.exit(2);
+}
+
+/**
+ * The admin client. Separate from `supabase` on purpose — the shipping client
+ * is the thing under test and must never hold this key.
+ */
+const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
+  auth: { persistSession: false, autoRefreshToken: false },
+});
+
+// ---------------------------------------------------------------------------
+// A results harness that cannot pass for the wrong reason.
+//
+// Every check runs inside a try/catch, so an assertion that raises (reading a
+// property off an undefined row, say) is recorded as a FAILURE rather than
+// crashing the run and leaving earlier PASSes on screen as if they were the
+// whole story. That exact shape — a TypeError where a red was expected —
+// produced false evidence twice in this milestone.
+// ---------------------------------------------------------------------------
+let passes = 0;
+let failures = 0;
+const failed: string[] = [];
+
+async function check(name: string, body: () => Promise<string>): Promise<void> {
+  try {
+    const detail = await body();
+    passes++;
+    console.log(`PASS  ${name}\n        ${detail}`);
+  } catch (e) {
+    failures++;
+    failed.push(name);
+    const message = e instanceof Error ? `${e.message}` : String(e);
+    console.log(`FAIL  ${name}\n        ${message}`);
+  }
+}
+
+function assert(condition: boolean, message: string): void {
+  if (!condition) throw new Error(message);
+}
+
+function show(value: unknown): string {
+  return JSON.stringify(value);
+}
+
+const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
+
+// ---------------------------------------------------------------------------
+// Fixtures
+// ---------------------------------------------------------------------------
+const stamp = Date.now().toString(36);
+
+/**
+ * ONE ruleset, authored independently by two accounts.
+ *
+ * There are no canonical league formats in this system: `format_version_id` has
+ * to point at a version the account itself saved. Two people who author the
+ * same rules produce the same `canonicalize()` string and therefore the same
+ * `rules_hash`, which is the ONLY reason they can ever be paired — the queue
+ * partitions on the verified hash, not on the format id. That is the design,
+ * and check 3a asserts it directly rather than assuming it.
+ */
+const RULES: Format = {
+  schema: 1,
+  base: 'great',
+  start: 'empty',
+  pool: [{ effect: 'allow', select: 'type:steel', note: 'commentary, must not affect the hash' }],
+  composition: { size: 3 },
+  selection: { mode: 'open' },
+};
+
+/** The same rules, written in a different order with a different note. */
+const RULES_RESTATED: Format = {
+  base: 'great',
+  schema: 1,
+  pool: [{ select: 'TYPE:STEEL ', effect: 'allow', note: 'a different note entirely' }],
+  selection: { mode: 'open' },
+  composition: { size: 3 },
+  start: 'empty',
+};
+
+/**
+ * Three rosters with DIFFERENT members per account, deliberately.
+ *
+ * If all three held the same refs, then "team_b holds the accepter's roster"
+ * would pass just as happily against a `team_b` that had been filled with the
+ * proposer's — the check that matters most in the live-offer route would be
+ * unable to fail. The refs are what tell the two apart.
+ */
+const ROSTERS: Record<string, StoredMember[]> = {
+  a: [
+    { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: ['FOCUS_BLAST', 'FLASH_CANNON'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
+    { ref: 'skarmory', fast_move: 'AIR_SLASH', charge_moves: ['SKY_ATTACK', 'BRAVE_BIRD'], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 39 },
+    { ref: 'medicham', fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH', 'PSYCHIC'], iv_attack: 0, iv_defense: 15, iv_stamina: 14, level: 50 },
+  ],
+  b: [
+    { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM', 'PLAY_ROUGH'], iv_attack: 0, iv_defense: 14, iv_stamina: 15, level: 41 },
+    { ref: 'bastiodon', fast_move: 'SMACK_DOWN', charge_moves: ['STONE_EDGE', 'FLAMETHROWER'], iv_attack: 2, iv_defense: 15, iv_stamina: 13, level: 43 },
+    { ref: 'swampert', fast_move: 'MUD_SHOT', charge_moves: ['HYDRO_CANNON', 'EARTHQUAKE'], iv_attack: 0, iv_defense: 15, iv_stamina: 14, level: 38 },
+  ],
+  c: [
+    { ref: 'altaria', fast_move: 'DRAGON_BREATH', charge_moves: ['SKY_ATTACK', 'MOONBLAST'], iv_attack: 0, iv_defense: 14, iv_stamina: 14, level: 44 },
+    { ref: 'umbreon', fast_move: 'SNARL', charge_moves: ['FOUL_PLAY', 'LAST_RESORT'], iv_attack: 1, iv_defense: 15, iv_stamina: 15, level: 40 },
+    { ref: 'venusaur', fast_move: 'VINE_WHIP', charge_moves: ['FRENZY_PLANT', 'SLUDGE_BOMB'], iv_attack: 0, iv_defense: 13, iv_stamina: 15, level: 42 },
+  ],
+};
+
+function roster(tag: string): StoredMember[] {
+  const r = ROSTERS[tag];
+  if (!r) throw new Error(`no fixture roster for ${tag}`);
+  return r.map((m) => ({ ...m, charge_moves: [...m.charge_moves] }));
+}
+
+interface Account {
+  label: string;
+  email: string;
+  password: string;
+  displayName: string;
+  id: string;
+  team: StoredMember[];
+  formatId: string;
+  versionId: string;
+  rulesHash: string;
+  friendCode: string;
+}
+
+// ---------------------------------------------------------------------------
+// Signup through the real mailbox, because the profile trigger reads signup
+// metadata: an admin-created user would have no profile and every foreign key
+// here points at one.
+// ---------------------------------------------------------------------------
+interface MailpitSummary {
+  ID: string;
+  To?: { Address: string }[];
+}
+
+async function confirmationLink(email: string): Promise<string> {
+  const deadline = Date.now() + 30_000;
+  let last = 'no message ever arrived';
+  while (Date.now() < deadline) {
+    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
+    if (res.ok) {
+      const body = (await res.json()) as { messages?: MailpitSummary[] };
+      const hit = (body.messages ?? []).find((m) =>
+        (m.To ?? []).some((t) => t.Address?.toLowerCase() === email.toLowerCase()),
+      );
+      if (hit) {
+        const detail = await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`);
+        const parsed = (await detail.json()) as { Text?: string; HTML?: string };
+        const text = `${parsed.Text ?? ''}\n${parsed.HTML ?? ''}`.replace(/&amp;/g, '&');
+        const link = /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/.exec(text);
+        if (link) return link[0];
+        last = `a message for ${email} had no /auth/v1/verify link in it`;
+      }
+    } else {
+      last = `Mailpit answered ${res.status} for the message list`;
+    }
+    await sleep(400);
+  }
+  throw new Error(last);
+}
+
+async function signIn(a: Account): Promise<void> {
+  const { data, error } = await supabase.auth.signInWithPassword({
+    email: a.email,
+    password: a.password,
+  });
+  if (error) throw new Error(`${a.label} could not sign in: ${error.message}`);
+  const id = data.session?.user.id;
+  if (!id) throw new Error(`${a.label} signed in with no session`);
+  if (a.id && id !== a.id) throw new Error(`${a.label} signed in as ${id}, expected ${a.id}`);
+  a.id = id;
+}
+
+/**
+ * The gate this whole script rests on.
+ *
+ * PostgREST's container can hold a clock a second or two behind GoTrue's, which
+ * makes a freshly issued JWT "issued at future" and gets every request refused
+ * — a refusal indistinguishable from a policy denying the write. That confound
+ * produced a false pass during M1b. So: poll a trivial authenticated select
+ * until it comes back CLEAN and returns the caller's own profile row, and only
+ * then let anything else run. It also confirms `handle_confirmed_user()`
+ * actually made the profile every foreign key here needs.
+ */
+async function waitForTokenAccepted(a: Account): Promise<string> {
+  const deadline = Date.now() + 30_000;
+  let last = 'never attempted';
+  while (Date.now() < deadline) {
+    const { data, error } = await supabase.from('profiles').select('id, display_name').eq('id', a.id);
+    if (error) {
+      last = `PostgREST refused the token: ${error.message}`;
+    } else if ((data ?? []).length === 1) {
+      return `${a.label} ${a.id} — authenticated select returned its own profile row`;
+    } else {
+      last = `token accepted but no profile row for ${a.id} yet (${(data ?? []).length} rows)`;
+    }
+    await sleep(300);
+  }
+  throw new Error(`${a.label}: ${last}`);
+}
+
+async function register(label: string, tag: string): Promise<Account> {
+  const a: Account = {
+    label,
+    email: `m2a-${stamp}-${tag}@example.test`,
+    password: `Round-Trip-${stamp}-${tag}`,
+    displayName: `m2a ${stamp} ${tag}`,
+    id: '',
+    team: roster(tag),
+    formatId: '',
+    versionId: '',
+    rulesHash: '',
+    friendCode: `${tag.toUpperCase()}${stamp}`.padEnd(12, '0').slice(0, 12),
+  };
+  const { error } = await supabase.auth.signUp({
+    email: a.email,
+    password: a.password,
+    options: {
+      emailRedirectTo: 'http://localhost:5173',
+      data: {
+        display_name: a.displayName,
+        go_username: `GO${stamp}${tag}`,
+        birth_date: '1990-01-01',
+        tos_accepted_at: new Date().toISOString(),
+      },
+    },
+  });
+  if (error) throw new Error(`${label} could not sign up: ${error.message}`);
+  const link = await confirmationLink(a.email);
+  const confirmed = await fetch(link, { redirect: 'manual' });
+  if (confirmed.status >= 400) {
+    throw new Error(`${label}: confirmation link answered ${confirmed.status}`);
+  }
+  await signIn(a);
+  return a;
+}
+
+async function as<T>(a: Account, body: () => Promise<T>): Promise<T> {
+  await signIn(a);
+  return body();
+}
+
+// ---------------------------------------------------------------------------
+// The coordinator, and the guard in front of every tick.
+//
+// `pair_queue_entries()` and `sweep_expired()` are GLOBAL and unscoped: they
+// scan every user's rows, not this script's. This machine holds a human
+// partner's real account. So before each tick, look — with the admin client,
+// which sees past RLS — for any queue entry, offer or match that does not
+// belong to one of our three test accounts, and refuse to tick if one exists.
+// ---------------------------------------------------------------------------
+let accounts: Account[] = [];
+
+async function assertNoForeignRows(label: string): Promise<void> {
+  const ours = new Set(accounts.map((a) => a.id));
+  const q = await admin.from('queue_entries').select('id, user_id');
+  if (q.error) throw new Error(`pre-tick scan of queue_entries failed: ${q.error.message}`);
+  const o = await admin.from('match_offers').select('id, proposer_id');
+  if (o.error) throw new Error(`pre-tick scan of match_offers failed: ${o.error.message}`);
+  const m = await admin.from('matches').select('id, player_a, player_b');
+  if (m.error) throw new Error(`pre-tick scan of matches failed: ${m.error.message}`);
+
+  const foreignQ = (q.data ?? []).filter((r) => !ours.has((r as { user_id: string }).user_id));
+  const foreignO = (o.data ?? []).filter((r) => !ours.has((r as { proposer_id: string }).proposer_id));
+  const foreignM = (m.data ?? []).filter((r) => {
+    const row = r as { player_a: string; player_b: string };
+    return !ours.has(row.player_a) || !ours.has(row.player_b);
+  });
+  if (foreignQ.length || foreignO.length || foreignM.length) {
+    throw new Error(
+      `REFUSING TO TICK before "${label}": rows that are not this script's exist — ` +
+        `queue_entries ${show(foreignQ)}, match_offers ${show(foreignO)}, matches ${show(foreignM)}`,
+    );
+  }
+  console.log(
+    `      [pre-tick "${label}"] every row belongs to this script: ` +
+      `queue_entries ${(q.data ?? []).length}, match_offers ${(o.data ?? []).length}, matches ${(m.data ?? []).length}`,
+  );
+}
+
+interface Tick {
+  verified: number;
+  paired: number;
+  swept: number;
+}
+
+async function tick(label: string): Promise<Tick> {
+  await assertNoForeignRows(label);
+  const res = await fetch(COORDINATOR_URL, {
+    method: 'POST',
+    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
+  });
+  const text = await res.text();
+  if (!res.ok) throw new Error(`coordinator answered ${res.status}: ${text}`);
+  console.log(`      [tick "${label}"] ${text}`);
+  return JSON.parse(text) as Tick;
+}
+
+// ---------------------------------------------------------------------------
+async function main(): Promise<void> {
+  console.log(`M2a round trip — run ${stamp}, DATA_REV ${DATA_REV}`);
+  console.log(`coordinator ${COORDINATOR_URL}\n`);
+
+  const before = await censusRow();
+  console.log(`census before: ${show(before)}\n`);
+
+  // -- registration ---------------------------------------------------------
+  const alice = await register('alice', 'a');
+  const bob = await register('bob', 'b');
+  const carol = await register('carol', 'c');
+  accounts = [alice, bob, carol];
+
+  for (const a of accounts) {
+    await check(`0. ${a.label}'s JWT is accepted and its profile exists`, async () => {
+      await signIn(a);
+      return waitForTokenAccepted(a);
+    });
+  }
+  if (failures > 0) throw new Error('registration gate failed; nothing after it would mean anything');
+
+  // -- formats and rosters, through the real saves module -------------------
+  for (const [a, rules] of [
+    [alice, RULES],
+    [bob, RULES_RESTATED],
+    [carol, RULES],
+  ] as const) {
+    await as(a, async () => {
+      a.formatId = await saveServerFormat({ name: `m2a ${stamp} ${a.label}`, format: rules });
+      const saved = (await listServerFormats()).find((f) => f.id === a.formatId);
+      if (!saved) throw new Error(`${a.label} saved a format it cannot then list`);
+      a.versionId = saved.versionId;
+      a.rulesHash = saved.rulesHash;
+      const teamId = await saveTeam({
+        name: `m2a ${stamp} ${a.label}`,
+        league: 'great',
+        size: 3,
+        members: a.team,
+      });
+      const listed = (await listTeams(3)).find((t) => t.id === teamId);
+      if (!listed) throw new Error(`${a.label} saved a 3-roster that listTeams(3) does not return`);
+      a.team = listed.members;
+    });
+  }
+
+  await check('1. two accounts authoring the same rules produce the same rules_hash', async () => {
+    const expected = await rulesHash(RULES);
+    assert(
+      alice.rulesHash === bob.rulesHash,
+      `alice ${alice.rulesHash} vs bob ${bob.rulesHash} — restating the same rules changed the hash, ` +
+        `so two strangers could never be paired`,
+    );
+    assert(
+      alice.rulesHash === expected,
+      `the server stored ${alice.rulesHash} but rulesHash() says ${expected}`,
+    );
+    assert(
+      alice.versionId !== bob.versionId,
+      'both accounts somehow point at one format_versions row; this check would be vacuous',
+    );
+    return `alice ${alice.versionId} and bob ${bob.versionId} are different versions with the same hash ${alice.rulesHash}`;
+  });
+
+  // =========================================================================
+  // Check 2: leaveQueue() against real Postgres.
+  //
+  // leaveQueue issues `DELETE … .eq('user_id', me)`. Every unit test mocks the
+  // client, so none of them can say whether PostgREST accepts that statement or
+  // what it does. The half that matters is the SECOND assertion: a delete that
+  // removed both entries would pass a test that only looked at the leaver's.
+  // =========================================================================
+  await check('2. leaveQueue deletes the leaver\'s row and nobody else\'s', async () => {
+    const aliceEntry = await as(alice, () => joinQueue({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team }));
+    const bobEntry = await as(bob, () => joinQueue({ league: 'great', formatVersionId: bob.versionId, format: RULES_RESTATED, team: bob.team }));
+    const bobBefore = await as(bob, myQueueEntry);
+    assert(bobBefore?.id === bobEntry, `bob's own entry did not read back: ${show(bobBefore)}`);
+
+    await as(alice, leaveQueue);
+
+    const aliceAfter = await as(alice, myQueueEntry);
+    assert(aliceAfter === null, `alice left the queue and still has an entry: ${show(aliceAfter)}`);
+    const bobAfter = await as(bob, myQueueEntry);
+    assert(
+      bobAfter?.id === bobEntry,
+      `alice's leaveQueue took bob's entry with it — bob now reads ${show(bobAfter)}, expected id ${bobEntry}`,
+    );
+    // And the row is really gone, not merely hidden from alice by a policy.
+    const all = await admin.from('queue_entries').select('id, user_id');
+    const rows = (all.data ?? []) as { id: string; user_id: string }[];
+    assert(
+      !rows.some((r) => r.id === aliceEntry),
+      `alice's row ${aliceEntry} is still in the table: ${show(rows)}`,
+    );
+    assert(
+      rows.some((r) => r.id === bobEntry),
+      `bob's row ${bobEntry} is gone from the table: ${show(rows)}`,
+    );
+
+    await as(bob, leaveQueue);
+    const empty = await admin.from('queue_entries').select('id');
+    assert((empty.data ?? []).length === 0, `queue not empty after both left: ${show(empty.data)}`);
+    return `alice's entry ${aliceEntry} deleted; bob's ${bobEntry} survived, confirmed past RLS with the admin client`;
+  });
+
+  // =========================================================================
+  // Check 3: the coordinator's match_offers liar branch.
+  //
+  // Task 6 proved this for queue_entries. The match_offers branch is the same
+  // loop over a different table name and has never been run. `createOffer`
+  // computes the hash itself and cannot lie, so the lie is staged as a raw
+  // insert by the signed-in proposer — exactly what a modified client would do,
+  // which is the threat the recomputation exists for.
+  // =========================================================================
+  await check('3. an offer whose claimed_hash lies is DELETED by the coordinator', async () => {
+    const lie = 'deadbeef'.repeat(8);
+    const inserted = await as(carol, async () =>
+      supabase
+        .from('match_offers')
+        .insert({
+          league: 'great',
+          format_version_id: carol.versionId,
+          claimed_hash: lie,
+          team: carol.team,
+          data_rev: DATA_REV,
+        })
+        .select('id, claimed_hash, verified_hash')
+        .single(),
+    );
+    if (inserted.error) throw new Error(`could not stage the lying offer: ${inserted.error.message}`);
+    const row = inserted.data as { id: string; claimed_hash: string; verified_hash: string | null };
+    assert(row.claimed_hash === lie, `the lie did not survive the insert: ${show(row)}`);
+    assert(row.verified_hash === null, `a brand new offer arrived already verified: ${show(row)}`);
+
+    const t = await tick('liar offer');
+    assert(t.verified === 0, `the coordinator verified ${t.verified} rows; the only row present was a lie`);
+    assert(t.paired === 0, `the coordinator paired ${t.paired} despite an empty queue`);
+
+    const after = await admin.from('match_offers').select('id, state, verified_hash').eq('id', row.id);
+    if (after.error) throw new Error(`could not re-read the offer: ${after.error.message}`);
+    assert(
+      (after.data ?? []).length === 0,
+      `the lying offer was not deleted — it is still there as ${show(after.data)}`,
+    );
+    const matches = await admin.from('matches').select('id');
+    assert((matches.data ?? []).length === 0, `a match was created from a lie: ${show(matches.data)}`);
+    return `offer ${row.id} claimed ${lie.slice(0, 12)}…, coordinator recomputed a different hash and deleted the row outright`;
+  });
+
+  // =========================================================================
+  // Check 4: the queue route.
+  // =========================================================================
+  let queueMatchId = '';
+  await check('4. nothing pairs before the coordinator has verified the hashes', async () => {
+    await as(alice, () => joinQueue({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team }));
+    await as(bob, () => joinQueue({ league: 'great', formatVersionId: bob.versionId, format: RULES_RESTATED, team: bob.team }));
+    const aliceEntry = await as(alice, myQueueEntry);
+    const bobEntry = await as(bob, myQueueEntry);
+    assert(aliceEntry?.verifiedHash === null, `alice's entry was verified without a tick: ${show(aliceEntry)}`);
+    assert(bobEntry?.verifiedHash === null, `bob's entry was verified without a tick: ${show(bobEntry)}`);
+    const aliceMatches = await as(alice, myMatches);
+    const bobMatches = await as(bob, myMatches);
+    assert(aliceMatches.length === 0, `alice already has a match: ${show(aliceMatches)}`);
+    assert(bobMatches.length === 0, `bob already has a match: ${show(bobMatches)}`);
+    return `both entries sit at verified_hash null and neither player has a match`;
+  });
+
+  await check('4b. one tick verifies both and pairs exactly one match', async () => {
+    const t = await tick('queue route');
+    assert(t.verified === 2, `expected verified 2, got ${t.verified} (tick was ${show(t)})`);
+    assert(t.paired === 1, `expected paired 1, got ${t.paired} (tick was ${show(t)})`);
+    const all = await admin.from('matches').select('id, player_a, player_b, source, rules_hash');
+    const rows = (all.data ?? []) as { id: string; player_a: string; player_b: string; source: string; rules_hash: string }[];
+    assert(rows.length === 1, `expected exactly one matches row, found ${rows.length}: ${show(rows)}`);
+    const match = rows[0]!;
+    queueMatchId = match.id;
+    assert(match.source === 'queue', `match source is ${match.source}, expected 'queue'`);
+    assert(
+      match.rules_hash === alice.rulesHash,
+      `match carries rules_hash ${match.rules_hash}, expected the verified ${alice.rulesHash}`,
+    );
+    const players = [match.player_a, match.player_b].sort();
+    assert(
+      show(players) === show([alice.id, bob.id].sort()),
+      `match pairs ${show(players)}, expected alice and bob ${show([alice.id, bob.id].sort())}`,
+    );
+    const emptied = await admin.from('queue_entries').select('id');
+    assert((emptied.data ?? []).length === 0, `paired entries were left in the queue: ${show(emptied.data)}`);
+    return `match ${queueMatchId} — source queue, rules_hash ${match.rules_hash}, both entries consumed`;
+  });
+
+  await check('4c. both players can read the match; a third account cannot', async () => {
+    const a = await as(alice, myMatches);
+    assert(a.length === 1 && a[0]!.id === queueMatchId, `alice reads ${show(a.map((m) => m.id))}`);
+    assert(a[0]!.opponentId === bob.id, `alice's opponent reads as ${a[0]!.opponentId}, expected bob ${bob.id}`);
+    const b = await as(bob, myMatches);
+    assert(b.length === 1 && b[0]!.id === queueMatchId, `bob reads ${show(b.map((m) => m.id))}`);
+    assert(b[0]!.opponentId === alice.id, `bob's opponent reads as ${b[0]!.opponentId}, expected alice ${alice.id}`);
+    const c = await as(carol, myMatches);
+    assert(c.length === 0, `carol, who is in no match, can read ${show(c.map((m) => m.id))}`);
+    // A row-level check, not a count: carol asking for the match BY ID gets nothing.
+    const direct = await as(carol, async () => supabase.from('matches').select('id, team_a').eq('id', queueMatchId));
+    if (direct.error) throw new Error(`carol's direct read errored rather than returning nothing: ${direct.error.message}`);
+    assert((direct.data ?? []).length === 0, `carol can read match ${queueMatchId} directly: ${show(direct.data)}`);
+    return `alice and bob each read ${queueMatchId} with the other as opponent; carol reads 0 rows asking for it by id`;
+  });
+
+  // =========================================================================
+  // Check 5: friend codes, which the match is what unlocks.
+  // =========================================================================
+  await check('5. each player reads the other\'s friend code; the third account reads neither', async () => {
+    for (const a of accounts) {
+      const w = await as(a, async () =>
+        supabase.from('friend_codes').insert({ profile_id: a.id, code: a.friendCode }),
+      );
+      if (w.error) throw new Error(`${a.label} could not save a friend code: ${w.error.message}`);
+    }
+    const aliceReadsBob = await as(alice, () => opponentFriendCode(bob.id));
+    assert(aliceReadsBob === bob.friendCode, `alice read ${show(aliceReadsBob)} for bob, expected ${show(bob.friendCode)}`);
+    const bobReadsAlice = await as(bob, () => opponentFriendCode(alice.id));
+    assert(bobReadsAlice === alice.friendCode, `bob read ${show(bobReadsAlice)} for alice, expected ${show(alice.friendCode)}`);
+    const carolReadsAlice = await as(carol, () => opponentFriendCode(alice.id));
+    assert(carolReadsAlice === null, `carol read alice's friend code: ${show(carolReadsAlice)}`);
+    const carolReadsBob = await as(carol, () => opponentFriendCode(bob.id));
+    assert(carolReadsBob === null, `carol read bob's friend code: ${show(carolReadsBob)}`);
+    // And carol is not simply blind to the table — she can still read her own.
+    const carolOwn = await as(carol, () => opponentFriendCode(carol.id));
+    assert(
+      carolOwn === carol.friendCode,
+      `carol cannot even read her own code (${show(carolOwn)}), so the two nulls above prove nothing`,
+    );
+    return `alice↔bob exchanged ${show(alice.friendCode)}/${show(bob.friendCode)}; carol got null for both while still reading her own ${show(carolOwn)}`;
+  });
+
+  // =========================================================================
+  // Check 6: the live offer route.
+  // =========================================================================
+  await check('6. a live offer converts to a match on acceptance, carrying the accepter\'s roster', async () => {
+    const offerId = await as(alice, () =>
+      createOffer({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team }),
+    );
+    const unverified = await as(bob, () => listOpenOffers('great'));
+    const seen = unverified.find((o) => o.id === offerId);
+    assert(!!seen, `bob cannot see alice's public offer ${offerId} on the board`);
+    assert(seen!.verifiedHash === null, `a brand new offer is already verified: ${show(seen)}`);
+    assert(
+      seen!.rosterSize === alice.team.length,
+      `board says rosterSize ${seen!.rosterSize}, alice posted ${alice.team.length} members`,
+    );
+
+    const t = await tick('live offer');
+    assert(t.verified === 1, `expected verified 1, got ${show(t)}`);
+
+    const matchId = await as(bob, () => acceptOffer(offerId, bob.team));
+    assert(typeof matchId === 'string' && matchId.length > 0, `a live acceptance returned ${show(matchId)}, expected a match id`);
+
+    const stored = await as(bob, async () =>
+      supabase.from('matches').select('id, player_a, player_b, source, team_a, team_b').eq('id', matchId!).single(),
+    );
+    if (stored.error) throw new Error(`bob cannot read the match he just made: ${stored.error.message}`);
+    const m = stored.data as { player_a: string; player_b: string; source: string; team_a: StoredMember[]; team_b: StoredMember[] };
+    assert(m.source === 'offer', `match source ${m.source}, expected 'offer'`);
+    assert(m.player_a === alice.id && m.player_b === bob.id, `players are ${m.player_a}/${m.player_b}`);
+    assert(
+      Array.isArray(m.team_b) && m.team_b.length === bob.team.length,
+      `team_b holds ${show(m.team_b)} — an empty or short roster is the bug this check exists for`,
+    );
+    assert(
+      show(m.team_b.map((x) => x.ref)) === show(bob.team.map((x) => x.ref)),
+      `team_b is ${show(m.team_b.map((x) => x.ref))}, bob accepted with ${show(bob.team.map((x) => x.ref))}`,
+    );
+    assert(
+      show(m.team_a.map((x) => x.ref)) === show(alice.team.map((x) => x.ref)),
+      `team_a is ${show(m.team_a.map((x) => x.ref))}, alice offered ${show(alice.team.map((x) => x.ref))}`,
+    );
+    const proposerView = (await as(alice, myOffers)).find((o) => o.id === offerId);
+    assert(proposerView?.state === 'converted', `proposer sees state ${show(proposerView?.state)}, expected 'converted'`);
+    assert(proposerView?.matchId === matchId, `offer points at match ${show(proposerView?.matchId)}, expected ${matchId}`);
+    return `offer ${offerId} → match ${matchId}, team_b = ${show(m.team_b.map((x) => x.ref))} (bob's own roster, not empty)`;
+  });
+
+  // =========================================================================
+  // Check 7: the scheduled route — acceptance is half a handshake.
+  // =========================================================================
+  await check('7. a scheduled offer accepted is NOT a match until the proposer confirms', async () => {
+    const when = new Date(Date.now() + 45 * 60 * 1000);
+    const offerId = await as(alice, () =>
+      createOffer({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team, scheduledFor: when }),
+    );
+    const t = await tick('scheduled offer');
+    assert(t.verified === 1, `expected verified 1, got ${show(t)}`);
+
+    const before = await admin.from('matches').select('id');
+    const beforeIds = new Set(((before.data ?? []) as { id: string }[]).map((r) => r.id));
+
+    const accepted = await as(bob, () => acceptOffer(offerId, bob.team));
+    assert(accepted === null, `accepting a SCHEDULED offer returned ${show(accepted)}; it must not make a match`);
+
+    const after = await admin.from('matches').select('id');
+    const afterIds = ((after.data ?? []) as { id: string }[]).map((r) => r.id);
+    const created = afterIds.filter((id) => !beforeIds.has(id));
+    assert(created.length === 0, `a match appeared on a one-sided acceptance: ${show(created)}`);
+
+    const takerView = (await as(bob, myOffers)).find((o) => o.id === offerId);
+    assert(takerView?.state === 'accepted', `taker sees state ${show(takerView?.state)}, expected 'accepted'`);
+    assert(takerView?.matchId === null, `an accepted-not-confirmed offer already has match ${show(takerView?.matchId)}`);
+
+    const matchId = await as(alice, () => confirmOffer(offerId));
+    assert(typeof matchId === 'string' && matchId.length > 0, `confirmOffer returned ${show(matchId)}`);
+    const stored = await as(bob, async () =>
+      supabase.from('matches').select('id, player_a, player_b, team_b, source').eq('id', matchId).single(),
+    );
+    if (stored.error) throw new Error(`the confirmed match is not readable by the taker: ${stored.error.message}`);
+    const m = stored.data as { player_a: string; player_b: string; team_b: StoredMember[]; source: string };
+    assert(m.player_a === alice.id && m.player_b === bob.id, `players are ${m.player_a}/${m.player_b}`);
+    assert(
+      show(m.team_b.map((x) => x.ref)) === show(bob.team.map((x) => x.ref)),
+      `team_b on the confirmed match is ${show(m.team_b.map((x) => x.ref))}, bob accepted with ${show(bob.team.map((x) => x.ref))}`,
+    );
+    const finalView = (await as(alice, myOffers)).find((o) => o.id === offerId);
+    assert(finalView?.state === 'converted', `after confirming, state is ${show(finalView?.state)}`);
+    return `offer ${offerId}: accept → state 'accepted', matchId null, zero new matches; confirm → match ${matchId} with bob's roster`;
+  });
+
+  await check('8. a scheduled offer that runs out of time LAPSES rather than converting', async () => {
+    const when = new Date(Date.now() + 90 * 60 * 1000);
+    const offerId = await as(alice, () =>
+      createOffer({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team, scheduledFor: when }),
+    );
+    // Backdate the window. `createOffer` cannot take expires_at, and the
+    // proposer's own "an offer belongs to the person who proposed it" policy is
+    // what permits this — it is a client-authorized write, not an admin one.
+    const past = new Date(Date.now() - 60 * 1000).toISOString();
+    const moved = await as(alice, async () =>
+      supabase.from('match_offers').update({ expires_at: past }).eq('id', offerId).select('id, expires_at').single(),
+    );
+    if (moved.error) throw new Error(`could not backdate the offer: ${moved.error.message}`);
+
+    const before = await admin.from('matches').select('id');
+    const beforeIds = new Set(((before.data ?? []) as { id: string }[]).map((r) => r.id));
+
+    const t = await tick('lapse sweep');
+    assert(t.paired === 0, `the sweep tick paired ${t.paired}`);
+
+    const row = await admin.from('match_offers').select('id, state, match_id, expires_at').eq('id', offerId).single();
+    if (row.error) throw new Error(`could not re-read the lapsed offer: ${row.error.message}`);
+    const o = row.data as { state: string; match_id: string | null };
+    assert(o.state === 'lapsed', `expired offer is in state ${show(o.state)}, expected 'lapsed'`);
+    assert(o.match_id === null, `a lapsed offer carries match ${show(o.match_id)}`);
+
+    const after = await admin.from('matches').select('id');
+    const created = ((after.data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !beforeIds.has(id));
+    assert(created.length === 0, `the sweep created a match: ${show(created)}`);
+
+    // And it really is closed, not merely relabelled: accepting it now fails,
+    // with the reason named rather than merely "something was refused".
+    let refusal = '';
+    try {
+      await as(bob, () => acceptOffer(offerId, bob.team));
+    } catch (e) {
+      refusal = e instanceof Error ? e.message : String(e);
+    }
+    assert(
+      refusal.includes('no longer open') || refusal.includes('expired'),
+      `accepting a lapsed offer was refused with ${show(refusal)}, which is not the state check`,
+    );
+    return `offer ${offerId} → state 'lapsed', match_id null, no match created; a later accept is refused "${refusal}"`;
+  });
+
+  // -- cleanup --------------------------------------------------------------
+  await cleanup();
+
+  await check('9. every row this script created is gone', async () => {
+    const after = await censusRow();
+    const drift = Object.entries(after).filter(([k, v]) => v !== before[k as keyof Census]);
+    assert(
+      drift.length === 0,
+      `the database did not return to its starting shape. before ${show(before)}, after ${show(after)}, drift ${show(drift)}`,
+    );
+    return `census identical to the start: ${show(after)}`;
+  });
+}
+
+// ---------------------------------------------------------------------------
+interface Census {
+  profiles: number;
+  teams: number;
+  team_members: number;
+  formats: number;
+  format_versions: number;
+  friend_codes: number;
+  queue_entries: number;
+  match_offers: number;
+  matches: number;
+}
+
+async function censusRow(): Promise<Census> {
+  const tables: (keyof Census)[] = [
+    'profiles',
+    'teams',
+    'team_members',
+    'formats',
+    'format_versions',
+    'friend_codes',
+    'queue_entries',
+    'match_offers',
+    'matches',
+  ];
+  const out = {} as Census;
+  for (const t of tables) {
+    const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
+    if (error) throw new Error(`census of ${t} failed: ${error.message}`);
+    out[t] = count ?? -1;
+  }
+  return out;
+}
+
+/**
+ * Undo everything, in dependency order. `format_versions` is ON DELETE RESTRICT
+ * from both `matches` and `match_offers`, so those must go first or the format
+ * delete is refused — which is the guarantee working, not a bug.
+ *
+ * Client-side deletes are used wherever a policy permits one, so cleanup itself
+ * exercises the shipping code. The two exceptions are named where they happen.
+ */
+async function cleanup(): Promise<void> {
+  for (const a of accounts) {
+    if (!a.id) continue;
+    try {
+      await as(a, async () => {
+        await leaveQueue();
+        const offers = await supabase.from('match_offers').delete().eq('proposer_id', a.id);
+        if (offers.error) console.log(`      [cleanup] ${a.label} offers: ${offers.error.message}`);
+        const codes = await supabase.from('friend_codes').delete().eq('profile_id', a.id);
+        if (codes.error) console.log(`      [cleanup] ${a.label} friend code: ${codes.error.message}`);
+      });
+    } catch (e) {
+      console.log(`      [cleanup] ${a.label} first pass: ${e instanceof Error ? e.message : String(e)}`);
+    }
+  }
+  // matches has SELECT-only policies by design: no client may delete one, so
+  // this is the first of the two admin-only steps.
+  const ours = new Set(accounts.map((a) => a.id));
+  const all = await admin.from('matches').select('id, player_a, player_b');
+  for (const r of (all.data ?? []) as { id: string; player_a: string; player_b: string }[]) {
+    if (ours.has(r.player_a) || ours.has(r.player_b)) {
+      const d = await admin.from('matches').delete().eq('id', r.id);
+      if (d.error) console.log(`      [cleanup] match ${r.id}: ${d.error.message}`);
+    }
+  }
+  for (const a of accounts) {
+    if (!a.id) continue;
+    try {
+      await as(a, async () => {
+        if (a.formatId) await deleteServerFormat(a.formatId);
+        for (const t of await listTeams(3)) await deleteTeam(t.id);
+      });
+    } catch (e) {
+      console.log(`      [cleanup] ${a.label} second pass: ${e instanceof Error ? e.message : String(e)}`);
+    }
+  }
+  await supabase.auth.signOut();
+  // The second admin-only step: GoTrue owns auth.users and no client may delete
+  // an account. Deleting it cascades the profile every foreign key here points
+  // at.
+  for (const a of accounts) {
+    if (!a.id) continue;
+    const { error } = await admin.auth.admin.deleteUser(a.id);
+    if (error) console.log(`      [cleanup] account ${a.label}: ${error.message}`);
+  }
+}
+
+main()
+  .then(async () => {
+    console.log(`\n${passes} passed, ${failures} failed`);
+    if (failures > 0) console.log(`failed: ${failed.join(', ')}`);
+    process.exit(failures > 0 ? 1 : 0);
+  })
+  .catch(async (e) => {
+    console.log(`\nABORTED: ${e instanceof Error ? e.stack : String(e)}`);
+    try {
+      await cleanup();
+      console.log('cleanup ran after the abort');
+    } catch (c) {
+      console.log(`cleanup after abort also failed: ${c instanceof Error ? c.message : String(c)}`);
+    }
+    console.log(`${passes} passed, ${failures} failed before the abort`);
+    process.exit(1);
+  });
diff --git a/app/tsconfig.scripts.json b/app/tsconfig.scripts.json
index a0b2be5..52aafaf 100644
--- a/app/tsconfig.scripts.json
+++ b/app/tsconfig.scripts.json
@@ -17,15 +17,18 @@
        import.meta.env. */
     "types": ["node", "vite/client"],
     "skipLibCheck": true,
     "module": "esnext",
     "moduleResolution": "bundler",
     "resolveJsonModule": true,
     "allowImportingTsExtensions": true,
     "verbatimModuleSyntax": true,
     "moduleDetection": "force",
     "noEmit": true,
+    /* Nothing here renders anything, but `src/lib/teamCodec.ts` takes a type
+       from a .tsx component, so resolving its imports needs a jsx mode set. */
+    "jsx": "react-jsx",
     "strict": true,
     "noFallthroughCasesInSwitch": true
   },
-  "include": ["scripts"]
+  "include": ["scripts", "tools"]
 }
diff --git a/docs/superpowers/plans/2026-09-02-m2a-matchmaking.md b/docs/superpowers/plans/2026-09-02-m2a-matchmaking.md
index 147fd48..303e05c 100644
--- a/docs/superpowers/plans/2026-09-02-m2a-matchmaking.md
+++ b/docs/superpowers/plans/2026-09-02-m2a-matchmaking.md
@@ -82,35 +82,43 @@ import { createHash } from 'node:crypto';
 // same rev — `verify-data` asserts species.json is byte-identical across
 // rebuilds and this must not be what breaks it.
 const payload = JSON.stringify({ moves: out.moves, species: out.species });
 out.dataRev = createHash('sha256').update(payload).digest('hex').slice(0, 16);
 ```
 
 - [ ] **Step 4: Export it**
 
 In `app/src/lib/data.ts`, beside the other top-level exports derived from the JSON:
 
+`app/src/lib/data.ts` already wraps the parsed JSON in `artefact<{moves, species}>(speciesRaw, 'species.json', ['moves','species'], 'npm run data')`, a guard whose stated purpose is turning "the compiler saw a typed field and the screen got `undefined`" into a loud named failure at import. Extend that call rather than casting past it — add `dataRev: string` to the type parameter **and** to the required-keys list, then:
+
 ```ts
 /**
  * Identifies the generated data this build carries.
  *
  * Matches and scheduled offers pin it: a random draw agreed on Tuesday and
  * played on Friday must deal the same six, and the only way to notice that the
  * data moved underneath it is to have recorded which data it was.
  */
-export const DATA_REV: string = (raw as { dataRev?: string }).dataRev ?? 'unknown';
+export const DATA_REV: string = raw.dataRev;
 ```
 
+A `?? 'unknown'` fallback would defeat the point: this value exists so staleness is *noticed*, and a silent default is staleness going unnoticed.
+
 - [ ] **Step 5: Regenerate and verify determinism**
 
-Run: `cd app && npm run data > /tmp/data.log 2>&1; echo "EXIT=$?" && git diff --stat src/data/species.json`
-Expected: EXIT=0, and `species.json` shows the added `dataRev` key only. Run `npm run data` a second time and confirm `git diff` reports no further change — that is the determinism assertion, and a differing rev between two runs means the hash input is unstable.
+Run: `cd app && node scripts/build-data.mjs > /tmp/data.log 2>&1; echo "EXIT=$?" && git diff --stat src/data/species.json`
+Expected: EXIT=0, and `species.json` shows the added `dataRev` key only.
+
+**`build-data.mjs` alone, NOT `npm run data`.** That script is the first stage of a chain — `build-data → best-spreads → matrix → teams → summary` — whose later stages take upwards of half an hour (`teams` alone burned 108 minutes of CPU when this was measured). None of them writes `dataRev`, and none is affected by a new key in `species.json`, so running them proves nothing about the hash and costs the whole afternoon.
+
+Then run `node scripts/build-data.mjs` a SECOND time and confirm `git diff --stat src/data/species.json` reports no change — that is the determinism assertion, and a differing rev between two runs means the hash input is unstable. Fix that rather than working around it: an unstable rev poisons every `data_rev` value downstream.
 
 - [ ] **Step 6: Run the test and the gate**
 
 Run: `cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"`
 Expected: EXIT=0.
 
 - [ ] **Step 7: Commit**
 
 ```bash
 git add app/scripts/build-data.mjs app/src/lib/data.ts app/src/lib/__tests__/data.test.ts app/src/data/species.json
diff --git a/supabase/functions/coordinator/index.ts b/supabase/functions/coordinator/index.ts
new file mode 100644
index 0000000..cd5e876
--- /dev/null
+++ b/supabase/functions/coordinator/index.ts
@@ -0,0 +1,49 @@
+import { createClient } from 'jsr:@supabase/supabase-js@2';
+// The esbuild output carries no type declarations, so Deno sees `any` here.
+// That is deliberate and is exactly why Task 9 exists: the only thing checking
+// that this is the same function the browser runs is a test that runs both.
+// @ts-types="./rules.bundle.d.ts"
+import { rulesHash } from './rules.bundle.js';
+
+/**
+ * The coordinator tick.
+ *
+ * Runs as the service role, which bypasses every policy — so it must be the
+ * only thing here that needs to. It does exactly what SQL cannot: recompute a
+ * format's hash with the client's own code. Everything else is a function call.
+ */
+Deno.serve(async () => {
+  const admin = createClient(
+    Deno.env.get('SUPABASE_URL')!,
+    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
+  );
+
+  let verified = 0;
+  for (const table of ['queue_entries', 'match_offers'] as const) {
+    const { data, error } = await admin
+      .from(table)
+      .select('id, claimed_hash, format_versions!inner(rules)')
+      .is('verified_hash', null)
+      .limit(200);
+    if (error) return new Response(error.message, { status: 500 });
+
+    for (const row of data ?? []) {
+      const r = row as unknown as { id: string; claimed_hash: string; format_versions: { rules: unknown } };
+      const actual = await rulesHash(r.format_versions.rules);
+      if (actual !== r.claimed_hash) {
+        // The claim was wrong. Drop the entry rather than correcting it: a
+        // client that computed a different hash disagrees with the server about
+        // what its own format IS, and silently requeueing it under the real
+        // hash would put someone into a match on terms they did not compute.
+        await admin.from(table).delete().eq('id', r.id);
+        continue;
+      }
+      await admin.from(table).update({ verified_hash: actual }).eq('id', r.id);
+      verified++;
+    }
+  }
+
+  const { data: paired } = await admin.rpc('pair_queue_entries');
+  const { data: swept } = await admin.rpc('sweep_expired');
+  return Response.json({ verified, paired, swept });
+});
diff --git a/supabase/functions/coordinator/rules.bundle.d.ts b/supabase/functions/coordinator/rules.bundle.d.ts
new file mode 100644
index 0000000..9d34eae
--- /dev/null
+++ b/supabase/functions/coordinator/rules.bundle.d.ts
@@ -0,0 +1 @@
+export declare function rulesHash(format: unknown): Promise<string>;
diff --git a/supabase/migrations/20260902204023_queue_and_matches.sql b/supabase/migrations/20260902204023_queue_and_matches.sql
new file mode 100644
index 0000000..22d3d06
--- /dev/null
+++ b/supabase/migrations/20260902204023_queue_and_matches.sql
@@ -0,0 +1,87 @@
+-- Someone waiting to be matched, blind: no opponent chosen, no format browsed.
+create table public.queue_entries (
+  id uuid primary key default gen_random_uuid(),
+  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
+  league text not null,
+  format_version_id uuid not null references public.format_versions (id) on delete cascade,
+  -- What the CLIENT says this format hashes to. Never trusted: the coordinator
+  -- recomputes it from format_versions.rules and writes verified_hash, and only
+  -- verified entries are eligible to pair. A client that lies lands in no queue
+  -- rather than in a stranger's.
+  claimed_hash text not null,
+  verified_hash text,
+  -- The roster as saved, not a pointer to `teams`: editing a team afterwards
+  -- must not change what was queued with.
+  team jsonb not null,
+  data_rev text not null,
+  created_at timestamptz not null default now(),
+  expires_at timestamptz not null default now() + interval '10 minutes'
+);
+
+-- One at a time. Two entries for one person can be paired with each other by a
+-- coordinator that only checks "different rows", and a self-match is a bug that
+-- looks like a feature until someone reports their own friend code back to them.
+create unique index queue_entries_one_per_user on public.queue_entries (user_id);
+-- The pairing scan reads exactly this.
+create index queue_entries_pairing_idx on public.queue_entries (verified_hash, league, created_at)
+  where verified_hash is not null;
+
+create table public.matches (
+  id uuid primary key default gen_random_uuid(),
+  player_a uuid not null references public.profiles (id) on delete cascade,
+  player_b uuid not null references public.profiles (id) on delete cascade,
+  -- RESTRICT, deliberately, not CASCADE. format_versions are immutable so that
+  -- a match's terms stay readable for years; letting a delete cascade through
+  -- here would make that guarantee hold everywhere except where it matters.
+  format_version_id uuid not null references public.format_versions (id) on delete restrict,
+  -- The VERIFIED hash, copied from the entries that produced this row.
+  rules_hash text not null,
+  team_a jsonb not null,
+  team_b jsonb not null,
+  data_rev text not null,
+  seed text not null,
+  rounds smallint not null default 3,
+  state text not null default 'paired',
+  source text not null,
+  created_at timestamptz not null default now(),
+  constraint matches_distinct_players check (player_a <> player_b),
+  constraint matches_rounds check (rounds in (3, 5)),
+  constraint matches_source check (source in ('queue', 'offer')),
+  constraint matches_state check (state in ('paired', 'abandoned'))
+);
+
+create index matches_player_a_idx on public.matches (player_a);
+create index matches_player_b_idx on public.matches (player_b);
+
+alter table public.queue_entries enable row level security;
+alter table public.matches enable row level security;
+
+create policy "a queue entry is its owner's"
+  on public.queue_entries for all
+  to authenticated
+  using ((select auth.uid()) = user_id)
+  with check ((select auth.uid()) = user_id);
+
+-- SELECT only, and only for the two people in it. There is deliberately no
+-- insert, update or delete policy: a match is created by the pairing functions
+-- running as the table owner, so every client write is refused by default-deny
+-- rather than by a rule somebody could loosen.
+create policy "a match is visible to the two people in it"
+  on public.matches for select
+  to authenticated
+  using ((select auth.uid()) in (player_a, player_b));
+
+-- The one widening in this migration. A friend code was owner-only, because it
+-- is the handle someone is contacted by. An opponent gets it for the duration
+-- of a match and by no other route.
+create policy "an opponent may read your friend code while you have a match"
+  on public.friend_codes for select
+  to authenticated
+  using (
+    exists (
+      select 1 from public.matches m
+      where m.state = 'paired'
+        and ((m.player_a = friend_codes.profile_id and m.player_b = (select auth.uid()))
+          or (m.player_b = friend_codes.profile_id and m.player_a = (select auth.uid())))
+    )
+  );
diff --git a/supabase/migrations/20260902205215_match_offers.sql b/supabase/migrations/20260902205215_match_offers.sql
new file mode 100644
index 0000000..959da4a
--- /dev/null
+++ b/supabase/migrations/20260902205215_match_offers.sql
@@ -0,0 +1,60 @@
+-- A proposition, not a queue entry. The difference that earns a separate table
+-- is review: an opponent reads the format before agreeing, which a blind queue
+-- by definition does not allow.
+create table public.match_offers (
+  id uuid primary key default gen_random_uuid(),
+  proposer_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
+  format_version_id uuid not null references public.format_versions (id) on delete restrict,
+  claimed_hash text not null,
+  verified_hash text,
+  league text not null,
+  team jsonb not null,
+  data_rev text not null,
+  visibility public.format_visibility not null default 'public',
+  -- Null for the live board: playable now. Set for a proposal at a stated time.
+  scheduled_for timestamptz,
+  -- The handshake window. Both sides must be inside it, and an offer that
+  -- reaches it unconfirmed LAPSES rather than converting — a scheduled battle
+  -- on the board is one both people committed to, not one somebody was
+  -- nominated for.
+  expires_at timestamptz not null default now() + interval '1 hour',
+  accepted_by uuid references public.profiles (id) on delete set null,
+  -- The taker's roster as saved at the moment they accepted, not a pointer
+  -- into `teams`: editing a team afterwards must not change what was accepted
+  -- with, and Task 5's accept_offer() writes it here alongside accepted_by so
+  -- a converted offer has both rosters that matches.team_a/team_b need.
+  -- Null until someone accepts.
+  accepted_team jsonb,
+  accepted_at timestamptz,
+  confirmed_at timestamptz,
+  match_id uuid references public.matches (id) on delete set null,
+  state text not null default 'open',
+  created_at timestamptz not null default now(),
+  constraint match_offers_state check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted')),
+  constraint match_offers_not_self check (accepted_by is null or accepted_by <> proposer_id),
+  constraint match_offers_scheduled_future check (scheduled_for is null or scheduled_for > created_at)
+);
+
+create index match_offers_open_idx on public.match_offers (visibility, league, created_at)
+  where state = 'open';
+create index match_offers_expiry_idx on public.match_offers (expires_at) where state in ('open', 'accepted');
+
+alter table public.match_offers enable row level security;
+
+create policy "an offer belongs to the person who proposed it"
+  on public.match_offers for all
+  to authenticated
+  using ((select auth.uid()) = proposer_id)
+  with check ((select auth.uid()) = proposer_id);
+
+-- Same shape as "a public format is readable by anyone signed in", which is
+-- the precedent this copies rather than invents.
+create policy "a public offer is readable by anyone signed in"
+  on public.match_offers for select
+  to authenticated
+  using (visibility = 'public' or (select auth.uid()) = accepted_by);
+
+-- Accepting is done through accept_offer(), not by a client UPDATE. There is
+-- deliberately no update policy for a taker: letting them write this row is
+-- letting them edit the terms they are agreeing to, and no WITH CHECK
+-- expressible here can say "you may set accepted_by and nothing else".
diff --git a/supabase/migrations/20260903005933_pairing_functions.sql b/supabase/migrations/20260903005933_pairing_functions.sql
new file mode 100644
index 0000000..0446b82
--- /dev/null
+++ b/supabase/migrations/20260903005933_pairing_functions.sql
@@ -0,0 +1,177 @@
+-- Pair everything pairable, in one transaction, as the table owner.
+--
+-- `for update skip locked` is the whole mechanism. Two coordinator ticks
+-- overlapping is not hypothetical — a tick that runs long while the next fires
+-- is the normal failure of any timer — and without SKIP LOCKED the second tick
+-- reads rows the first is about to consume and pairs them a second time. With
+-- it, the second tick simply does not see them. This is the same class of bug
+-- as M1b's duplicate formats, where two overlapping runs each did the work.
+create function public.pair_queue_entries() returns integer
+language plpgsql security definer set search_path = public as $$
+declare
+  pending public.queue_entries;
+  cur public.queue_entries;
+  paired integer := 0;
+begin
+  for cur in
+    select * from public.queue_entries
+     where verified_hash is not null and expires_at > now()
+     order by verified_hash, league, data_rev, created_at
+     for update skip locked
+  loop
+    if pending.id is not null
+       and pending.verified_hash = cur.verified_hash
+       and pending.league = cur.league
+       -- Same data build, deliberately. A random draw both sides compute must
+       -- deal from the same pool; two clients on different data would agree on
+       -- the rules and disagree on what satisfies them.
+       and pending.data_rev = cur.data_rev
+       and pending.user_id <> cur.user_id then
+      insert into public.matches
+        (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+      values
+        (pending.user_id, cur.user_id, pending.format_version_id, pending.verified_hash,
+         pending.team, cur.team, pending.data_rev, gen_random_uuid()::text, 'queue');
+      delete from public.queue_entries where id in (pending.id, cur.id);
+      paired := paired + 1;
+      pending := null;
+    else
+      pending := cur;
+    end if;
+  end loop;
+  return paired;
+end;
+$$;
+
+-- Accepting is a function, not an UPDATE, for two reasons: the row must be
+-- locked while its state is checked, and a taker permitted to write this row is
+-- a taker permitted to edit the terms they are agreeing to. The team the taker
+-- is bringing has to come in as an argument, not from a client-writable
+-- column: `matches.team_b` is NOT NULL, and there is deliberately no update
+-- policy that would let a taker stage their roster into match_offers first.
+create function public.accept_offer(p_offer uuid, p_team jsonb) returns uuid
+language plpgsql security definer set search_path = public as $$
+declare
+  o public.match_offers;
+  taker uuid := (select auth.uid());
+  new_match uuid;
+begin
+  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
+  if p_team is null then raise exception 'you must supply the team you are accepting with'; end if;
+  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
+  -- told the offer is taken. Skipping would tell them "no such offer", a
+  -- different and misleading answer.
+  select * into o from public.match_offers where id = p_offer for update;
+  if not found then raise exception 'no such offer'; end if;
+  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
+  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
+  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
+  if o.verified_hash is null then raise exception 'this offer has not been verified yet'; end if;
+  if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;
+
+  if o.scheduled_for is null then
+    -- Live: agreeing is playing. One confirmation is the whole handshake, and
+    -- the taker's own team — not an empty roster — is what they play the
+    -- match on.
+    insert into public.matches
+      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+    values
+      (o.proposer_id, taker, o.format_version_id, o.verified_hash, o.team, p_team,
+       o.data_rev, gen_random_uuid()::text, 'offer')
+    returning id into new_match;
+    update public.match_offers
+       set state = 'converted', accepted_by = taker, accepted_team = p_team, accepted_at = now(),
+           confirmed_at = now(), match_id = new_match
+     where id = p_offer;
+    return new_match;
+  end if;
+
+  -- Scheduled: one-sided acceptance is not a match. The proposer must confirm
+  -- inside the window or this lapses. The team is captured now, at acceptance
+  -- time, because it is the taker's own write and confirm_offer() runs as the
+  -- proposer, who has no roster of the taker's to supply.
+  update public.match_offers
+     set state = 'accepted', accepted_by = taker, accepted_team = p_team, accepted_at = now()
+   where id = p_offer;
+  return null;
+end;
+$$;
+
+create function public.confirm_offer(p_offer uuid) returns uuid
+language plpgsql security definer set search_path = public as $$
+declare
+  o public.match_offers;
+  me uuid := (select auth.uid());
+  new_match uuid;
+begin
+  select * into o from public.match_offers where id = p_offer for update;
+  if not found then raise exception 'no such offer'; end if;
+  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
+  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
+  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
+
+  -- team_b is the roster the taker accepted with, captured by accept_offer()
+  -- into accepted_team — the proposer confirming does not get to supply it.
+  insert into public.matches
+    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+  values
+    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, o.accepted_team,
+     o.data_rev, gen_random_uuid()::text, 'offer')
+  returning id into new_match;
+  update public.match_offers
+     set state = 'converted', confirmed_at = now(), match_id = new_match
+   where id = p_offer;
+  return new_match;
+end;
+$$;
+
+-- Expiry is a sweep, not a trigger: nothing touches a stale row to fire a
+-- trigger on. An offer past its window LAPSES — it does not quietly convert,
+-- because the calendar has to mean something.
+create function public.sweep_expired() returns integer
+language plpgsql security definer set search_path = public as $$
+declare swept integer := 0;
+begin
+  delete from public.queue_entries where expires_at <= now();
+  get diagnostics swept = row_count;
+  update public.match_offers set state = 'lapsed'
+   where state in ('open', 'accepted') and expires_at <= now();
+  return swept;
+end;
+$$;
+
+-- The invariant Task 4 deferred: accepted_team was added with no constraint
+-- tying it to accepted_by. An accepted_by with no team would be an
+-- acceptance whose roster was lost, and confirm_offer() would then try to
+-- write a null into matches.team_b, which is NOT NULL — a failure at
+-- confirmation time for a mistake made at acceptance time. accept_offer()
+-- above always writes both columns together, so this constraint should never
+-- fire from that path; it exists to close off any other write reaching the
+-- same inconsistent state (a direct UPDATE, a future function).
+--
+-- Deliberately one-directional (accepted_by null implies nothing about
+-- accepted_team), not "both null or both set": accepted_by is
+-- `on delete set null`, so deleting the taker's account nulls it while
+-- accepted_team stays behind as a snapshot of a roster with nobody attached.
+-- A symmetric constraint would turn that ON DELETE SET NULL into a constraint
+-- violation and make the account undeletable.
+alter table public.match_offers
+  add constraint match_offers_accepted_needs_team
+  check (accepted_by is null or accepted_team is not null);
+
+-- pair_queue_entries() and sweep_expired() are coordinator-only: Task 6's
+-- coordinator calls both over PostgREST as service_role, and nobody else has
+-- any business running a global scan of every user's queue and offers.
+revoke all on function public.pair_queue_entries() from public, anon, authenticated;
+revoke all on function public.sweep_expired() from public, anon, authenticated;
+grant execute on function public.pair_queue_entries() to service_role;
+grant execute on function public.sweep_expired() to service_role;
+
+-- accept_offer/confirm_offer are user-facing and revoked from PUBLIC (which
+-- `create function` grants by default) so an unauthenticated request gets
+-- "permission denied" rather than reaching the "you must be signed in" check
+-- inside the function body.
+revoke all on function public.accept_offer(uuid, jsonb) from public, anon;
+revoke all on function public.confirm_offer(uuid) from public, anon;
+grant execute on function public.accept_offer(uuid, jsonb) to authenticated;
+grant execute on function public.confirm_offer(uuid) to authenticated;
diff --git a/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql b/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql
new file mode 100644
index 0000000..4a96501
--- /dev/null
+++ b/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql
@@ -0,0 +1,48 @@
+-- confirm_offer() previously trusted that state = 'accepted' implied
+-- accepted_by was a live player. It is not: accepted_by is
+-- `on delete set null`, and the constraint added in the previous migration
+-- is deliberately one-directional (accepted_by null implies nothing about
+-- accepted_team), so a taker who accepted a scheduled offer and then deleted
+-- their account leaves the offer sitting in 'accepted' with accepted_by
+-- null and accepted_team still populated. Nothing about account deletion
+-- touches state, and confirm_offer only checked state <> 'accepted' — so the
+-- proposer, still inside the window, could reach the INSERT below with
+-- accepted_by null, and matches.player_b is NOT NULL. The insert rolled
+-- back, but the failure a client saw was a raw Postgres constraint
+-- violation instead of a clean domain error.
+--
+-- Deliberately NOT also transitioning the offer to 'lapsed' here.
+-- sweep_expired() already reaches this exact row once expires_at passes
+-- (state in ('open', 'accepted')), so the terminal transition already has a
+-- single, already-tested owner; having confirm_offer additionally mutate
+-- state on this error path would duplicate that responsibility for no gain
+-- — the window is time-bounded regardless, and a proposer who retries before
+-- expiry just gets the same clean error again.
+create or replace function public.confirm_offer(p_offer uuid) returns uuid
+language plpgsql security definer set search_path = public as $$
+declare
+  o public.match_offers;
+  me uuid := (select auth.uid());
+  new_match uuid;
+begin
+  select * into o from public.match_offers where id = p_offer for update;
+  if not found then raise exception 'no such offer'; end if;
+  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
+  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
+  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
+  if o.accepted_by is null then raise exception 'the person who accepted this offer no longer exists'; end if;
+
+  -- team_b is the roster the taker accepted with, captured by accept_offer()
+  -- into accepted_team — the proposer confirming does not get to supply it.
+  insert into public.matches
+    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+  values
+    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, o.accepted_team,
+     o.data_rev, gen_random_uuid()::text, 'offer')
+  returning id into new_match;
+  update public.match_offers
+     set state = 'converted', confirmed_at = now(), match_id = new_match
+   where id = p_offer;
+  return new_match;
+end;
+$$;
diff --git a/supabase/migrations/20260903020000_teams_size.sql b/supabase/migrations/20260903020000_teams_size.sql
new file mode 100644
index 0000000..ec243bf
--- /dev/null
+++ b/supabase/migrations/20260903020000_teams_size.sql
@@ -0,0 +1,50 @@
+-- Saved rosters gain a size (task 5b — reported by the human partner mid-M2a,
+-- ledger Ruling 13).
+--
+-- Both builders — GBL (size=3) and Show 6 (size=6) — rendered the same
+-- TeamBuilderScreen and shared one unfiltered `listTeams()`. That meant every
+-- roster showed up in both pickers, distinguishable only by name, and the
+-- overwrite prompt this screen offers — added the same day this migration was
+-- written — matched a same-named roster from EITHER size. Its update path
+-- upserts the new slots and then deletes every slot past the new length, so
+-- saving a 3-roster under a name already used by a 6-roster silently deleted
+-- three of that six's members. This migration is what lets the client scope
+-- `listTeams` and the save gate to one size, closing that hole at the source
+-- rather than patching the symptom in the screen.
+--
+-- The rule: size is a consequence of the screen a roster was saved from, not
+-- a stored guess. A roster saved from Show 6 is a 6-roster; one from GBL is a
+-- 3-roster — never anything else.
+alter table public.teams add column size smallint;
+
+-- Backfill is exact for every roster that exists: the partner's local
+-- database holds exactly 2 saved rosters, both complete at 6 members, and
+-- production holds no rows at all (no accounts yet). All of them are
+-- complete, and from here on the save gate guarantees completeness, so member
+-- count IS the size. The `> 3` form rather than `= 6` so a partial roster
+-- predating this rule (none exist today, but the check below cannot assume
+-- that forever) lands somewhere deterministic rather than violating the
+-- check that follows.
+update public.teams t
+   set size = case when (select count(*) from public.team_members m where m.team_id = t.id) > 3 then 6 else 3 end;
+
+alter table public.teams alter column size set not null;
+alter table public.teams add constraint teams_size check (size in (3, 6));
+
+-- The name-uniqueness index widens to include size. Under the new rule a GBL
+-- "Core" and a Show 6 "Core" are two different rosters, and once each
+-- builder's list only ever shows its own size, forbidding the shared name
+-- would be a restriction the UI could never explain to the person hitting it.
+--
+-- A unique index cannot gain a column in place, so this drops
+-- `teams_owner_name_uniq` (from migration 20260902163500) and recreates it
+-- under the SAME name with size added: (owner_id, size, lower(btrim(name))).
+-- The name is kept deliberately — `writeError` in app/src/lib/saves.ts
+-- matches the string "teams_owner_name_uniq" in the 23505 Postgres returns to
+-- turn it into a readable sentence, and a renamed index would silently break
+-- that mapping back down to a raw constraint-violation message.
+--
+-- Done last, after size is populated and NOT NULL: an index over a column
+-- cannot be built while that column is still nullable mid-backfill.
+drop index if exists public.teams_owner_name_uniq;
+create unique index teams_owner_name_uniq on public.teams (owner_id, size, lower(btrim(name)));
diff --git a/supabase/migrations/20260903030000_coordinator_schedule.sql b/supabase/migrations/20260903030000_coordinator_schedule.sql
new file mode 100644
index 0000000..5a6840a
--- /dev/null
+++ b/supabase/migrations/20260903030000_coordinator_schedule.sql
@@ -0,0 +1,27 @@
+-- Every minute. Latency is a later optimisation; the spec's whole point in
+-- starting with a scheduled function is that nothing here holds a socket.
+create extension if not exists pg_cron;
+create extension if not exists pg_net;
+
+select cron.schedule(
+  'coordinator-tick',
+  '* * * * *',
+  $$
+  select net.http_post(
+    url := current_setting('app.coordinator_url', true),
+    headers := jsonb_build_object(
+      'Content-Type', 'application/json',
+      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
+    )
+  );
+  $$
+);
+
+-- Reviewer note: the URL and key come from settings rather than being
+-- written into this migration, because a migration is committed and a
+-- service-role key must never be. Set them per environment with:
+--   alter database postgres set app.coordinator_url = '…';
+--   alter database postgres set app.service_role_key = '…';
+-- If that indirection proves awkward on the hosted project, the fallback is
+-- Supabase's dashboard-managed cron — but do not inline the key here to make
+-- this step pass.
diff --git a/supabase/tests/offers.test.ts b/supabase/tests/offers.test.ts
new file mode 100644
index 0000000..4513958
--- /dev/null
+++ b/supabase/tests/offers.test.ts
@@ -0,0 +1,109 @@
+import { randomUUID } from 'node:crypto';
+import { describe, it, expect, beforeAll, afterEach } from 'vitest';
+import { sql, asUser, asAnon } from './helpers';
+
+describe('match offer policies', () => {
+  const proposer = randomUUID();
+  const taker = randomUUID();
+  let versionId = '';
+
+  async function makeUser(id: string, name: string) {
+    await sql(
+      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
+       values ('${id}', '${id}@example.com', now(),
+         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
+    );
+  }
+
+  beforeAll(async () => {
+    await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
+    await makeUser(taker, `OT_${taker.slice(0, 8)}`);
+    const [f] = await sql<{ id: string }>(
+      `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
+    const [v] = await sql<{ id: string }>(
+      `insert into public.format_versions (format_id, version, rules, rules_hash)
+       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
+    versionId = v.id;
+  });
+
+  afterEach(async () => {
+    await sql(`delete from public.matches where player_a in ('${proposer}','${taker}') or player_b in ('${proposer}','${taker}')`);
+    await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
+    await sql(`delete from public.friend_codes where profile_id in ('${proposer}','${taker}')`);
+  });
+
+  const offer = (visibility: string, scheduled = 'null') =>
+    asUser({ sub: proposer })<{ id: string }>(
+      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
+       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`,
+    );
+
+  it('shows a public offer to any signed-in stranger', async () => {
+    const [o] = await offer('public');
+    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+  });
+
+  it('hides a public offer from someone not signed in, though the row exists and is visible to its proposer', async () => {
+    const [o] = await offer('public');
+    expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
+    // Prove the emptiness above is the anon policy at work, not an absent row:
+    // the superuser connection (bypasses RLS) and the proposer (via their own
+    // policy) both still see it.
+    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+  });
+
+  it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
+    const [o] = await offer('unlisted');
+    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
+    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+  });
+
+  it('refuses an offer proposed on someone else\'s behalf', async () => {
+    await expect(
+      asUser({ sub: taker })(
+        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
+         values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
+    ).rejects.toThrow(/row-level security/);
+  });
+
+  /**
+   * A taker may accept. A taker may NOT rewrite the terms they are accepting.
+   *
+   * There is no update policy that admits the taker at all (see the migration
+   * comment), so the row fails the USING clause before WITH CHECK is ever
+   * consulted. Postgres does not raise an error for that case — an UPDATE
+   * whose WHERE/USING excludes every row simply reports 0 rows affected, the
+   * same as `UPDATE ... WHERE id = <nothing>`. So the proof here isn't a
+   * thrown exception; it's that the write touched nothing (0 rows, RETURNING
+   * empty) while the superuser connection shows the row still holds its
+   * original terms.
+   *
+   * That alone can't tell "the taker was denied" apart from "nobody can
+   * update this table" — a typo in the proposer's own policy would leave the
+   * taker's update at 0 rows too, for the wrong reason. The third leg closes
+   * that gap: the proposer, on the very same row and column, succeeds.
+   */
+  it('refuses a taker editing the offer\'s terms', async () => {
+    const [o] = await offer('public');
+    const written = await asUser({ sub: taker })<{ id: string }>(
+      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
+    );
+    expect(written).toHaveLength(0);
+    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
+      { league: 'great' },
+    ]);
+    // Same row, same column, different actor: the proposer can.
+    const proposerWrite = await asUser({ sub: proposer })<{ id: string }>(
+      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
+    );
+    expect(proposerWrite).toHaveLength(1);
+    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
+      { league: 'master' },
+    ]);
+  });
+
+  it('refuses a scheduled offer in the past', async () => {
+    await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
+  });
+});
diff --git a/supabase/tests/pairing.test.ts b/supabase/tests/pairing.test.ts
new file mode 100644
index 0000000..7765931
--- /dev/null
+++ b/supabase/tests/pairing.test.ts
@@ -0,0 +1,505 @@
+import { randomUUID } from 'node:crypto';
+import postgres from 'postgres';
+import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
+import { sql, asUser } from './helpers';
+
+const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
+
+describe('pairing', () => {
+  const a = randomUUID(),
+    b = randomUUID(),
+    c = randomUUID();
+  let versionId = '';
+
+  // Every assertion in this file is scoped to these three users. The pairing
+  // functions are global by design — `pair_queue_entries()` scans the whole
+  // queue and `sweep_expired()` sweeps every table — and this suite runs
+  // against the partner's real local database alongside other test files
+  // running in parallel. An unscoped `select count(*) from matches` would be
+  // reading somebody else's rows.
+  const mine = () => `player_a in ('${a}','${b}','${c}') or player_b in ('${a}','${b}','${c}')`;
+  const myEntries = () => `user_id in ('${a}','${b}','${c}')`;
+
+  /**
+   * Independent connections. `helpers.ts` deliberately shares ONE connection
+   * with `max: 1`, which cannot express a race: two queries on it are
+   * serialised by the pool before they ever reach Postgres. A test about two
+   * transactions overlapping has to own its own sockets.
+   */
+  const conn = () => postgres(CONNECTION_STRING, { max: 1 });
+
+  /**
+   * Opens a fresh connection, begins a transaction, and runs `query` inside
+   * it, holding the transaction open until `release()` is called. Used to
+   * hold a row lock across an `await` boundary so a concurrent test body can
+   * prove it is blocked (plain `for update`) or skipped (`skip locked`) by
+   * another transaction. Only resolves once the locking query has actually
+   * completed, so the caller never races the lock's own acquisition.
+   */
+  async function hold(query: string) {
+    const client = conn();
+    let announceLocked!: () => void;
+    let release!: () => void;
+    const locked = new Promise<void>((r) => (announceLocked = r));
+    const gate = new Promise<void>((r) => (release = r));
+    const held = client.begin(async (tx) => {
+      await tx.unsafe(query);
+      announceLocked();
+      await gate;
+    });
+    await locked;
+    return {
+      release: async () => {
+        release();
+        await held;
+        await client.end();
+      },
+    };
+  }
+
+  // A long-lived side connection for role-scoped queries (`set local role` is
+  // transaction-scoped, so it needs a transaction, and `sql()` gives none).
+  const alt = conn();
+  const asRole =
+    (role: string) =>
+    async <T = Record<string, unknown>>(query: string): Promise<T[]> =>
+      alt.begin(async (tx) => {
+        await tx.unsafe(`set local role ${role}`);
+        return tx.unsafe(query) as unknown as Promise<T[]>;
+      }) as unknown as Promise<T[]>;
+
+  async function makeUser(id: string, name: string) {
+    await sql(
+      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
+       values ('${id}', '${id}@example.com', now(),
+         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
+    );
+  }
+
+  beforeAll(async () => {
+    for (const [id, n] of [
+      [a, 'PA'],
+      [b, 'PB'],
+      [c, 'PC'],
+    ] as const)
+      await makeUser(id, `${n}_${id.slice(0, 8)}`);
+    const [f] = await sql<{ id: string }>(
+      `insert into public.formats (owner_id, name) values ('${a}', 'Pair Cup') returning id`,
+    );
+    const [v] = await sql<{ id: string }>(
+      `insert into public.format_versions (format_id, version, rules, rules_hash)
+       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cc') returning id`,
+    );
+    versionId = v.id;
+  });
+
+  afterEach(async () => {
+    await sql(`delete from public.match_offers where proposer_id in ('${a}','${b}','${c}')`);
+    await sql(`delete from public.matches where ${mine()}`);
+    await sql(`delete from public.queue_entries where ${myEntries()}`);
+  });
+
+  afterAll(async () => {
+    await alt.end();
+    // The fixtures cascade out of auth.users: profiles, formats and
+    // format_versions all go with them, so nothing this file created is left
+    // in the partner's database.
+    await sql(`delete from auth.users where id in ('${a}','${b}','${c}')`);
+  });
+
+  const enqueue = (user: string, hash: string | null = 'cc', team = '[]', rev = 'rev1') =>
+    sql(`insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
+         values ('${user}', 'great', '${versionId}', 'cc', ${hash === null ? 'null' : `'${hash}'`}, '${team}'::jsonb, '${rev}')`);
+
+  const pair = async () => {
+    const [row] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
+    return Number(row.pair_queue_entries);
+  };
+
+  const offer = async (extraCols = '', extraVals = '') => {
+    const [o] = await sql<{ id: string }>(
+      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility${extraCols})
+       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '["A"]'::jsonb, 'rev1', 'public'${extraVals}) returning id`,
+    );
+    return o;
+  };
+
+  it('pairs two verified entries sharing a hash, and consumes them', async () => {
+    await enqueue(a, 'cc', '["A"]');
+    await enqueue(b, 'cc', '["B"]');
+    expect(await pair()).toBe(1);
+    expect(
+      await sql<{ team_a: unknown; team_b: unknown; source: string; rules_hash: string }>(
+        `select team_a, team_b, source, rules_hash from public.matches where ${mine()}`,
+      ),
+    ).toEqual([{ team_a: ['A'], team_b: ['B'], source: 'queue', rules_hash: 'cc' }]);
+    expect(await sql(`select id from public.queue_entries where ${myEntries()}`)).toHaveLength(0);
+  });
+
+  it('leaves an unverified entry alone — the trust boundary', async () => {
+    await enqueue(a);
+    await enqueue(b, null);
+    expect(await pair()).toBe(0);
+    expect(await sql(`select id from public.queue_entries where ${myEntries()}`)).toHaveLength(2);
+  });
+
+  it('does not pair entries whose hashes differ', async () => {
+    await enqueue(a);
+    await enqueue(b, 'dd');
+    expect(await pair()).toBe(0);
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  /**
+   * The `data_rev` leg of the pairing predicate, which nothing else here can
+   * fail: every other test uses one data build, so dropping the clause would
+   * leave them all green. A random draw both sides compute has to deal from
+   * the same pool.
+   */
+  it('does not pair two clients on different data builds', async () => {
+    await enqueue(a, 'cc', '[]', 'rev1');
+    await enqueue(b, 'cc', '[]', 'rev2');
+    expect(await pair()).toBe(0);
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  it('leaves the odd one out queued when three are waiting', async () => {
+    await enqueue(a);
+    await enqueue(b);
+    await enqueue(c);
+    expect(await pair()).toBe(1);
+    expect(await sql(`select id from public.queue_entries where ${myEntries()}`)).toHaveLength(1);
+  });
+
+  /**
+   * The SKIP LOCKED proof, made deterministic.
+   *
+   * A true race can only ever say "no duplicate happened this time". This says
+   * something stronger and repeatable: while another transaction holds these
+   * rows, a tick must SKIP them and return promptly. Written with plain `for
+   * update` the same call would block on the held rows instead of returning,
+   * so the 2s ceiling is the assertion that distinguishes the two.
+   *
+   * Three legs, because "returned 0" on its own is indistinguishable from
+   * "there was nothing to pair": (a) the tick reports 0 and quickly, (b) no
+   * match appeared, and (c) once the lock is released the very same rows pair.
+   */
+  it('skips rows another tick already holds, rather than blocking on them', { timeout: 20000 }, async () => {
+    await enqueue(a);
+    await enqueue(b);
+
+    const lock = await hold(`select id from public.queue_entries where ${myEntries()} for update`);
+    // On its own connection, so a regression that blocks stalls this call
+    // rather than the shared connection every other assertion here uses.
+    const runner = conn();
+    try {
+      const settled = await Promise.race([
+        runner
+          .unsafe(`select public.pair_queue_entries()`)
+          .then((r) => ({ done: true, n: Number((r[0] as { pair_queue_entries: number }).pair_queue_entries) })),
+        new Promise<{ done: boolean; n: number }>((r) => setTimeout(() => r({ done: false, n: -1 }), 2000)),
+      ]);
+      expect(settled).toEqual({ done: true, n: 0 });
+      expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+    } finally {
+      // Unconditionally: a failed assertion above must not leave rows locked,
+      // or `afterEach` blocks on them and every later test in this file times
+      // out for a reason that has nothing to do with what broke.
+      await lock.release();
+      await runner.end();
+    }
+
+    // Leg (c): the rows were pairable all along.
+    expect(await pair()).toBe(1);
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
+  });
+
+  /**
+   * The race itself: two coordinator ticks overlapping, which is the normal
+   * failure of any timer — a tick that runs long while the next one fires.
+   * The invariant is not "exactly one match": with SKIP LOCKED the two ticks
+   * may each claim one of the two rows and pair nothing, which is safe and
+   * self-correcting. The invariant is that two entries never become two
+   * matches, and that what the ticks REPORT matches what they wrote.
+   *
+   * This is the shape of bug M1b shipped: an effect that ran twice under a
+   * remount and duplicated every row, invisible to 1056 tests that all
+   * exercised a single run.
+   */
+  it('never turns two entries into two matches when two ticks overlap', { timeout: 20000 }, async () => {
+    await enqueue(a);
+    await enqueue(b);
+    const [c1, c2] = [conn(), conn()];
+    const [r1, r2] = await Promise.all([
+      c1.unsafe(`select public.pair_queue_entries()`),
+      c2.unsafe(`select public.pair_queue_entries()`),
+    ]);
+    await Promise.all([c1.end(), c2.end()]);
+    const reported =
+      Number((r1[0] as { pair_queue_entries: number }).pair_queue_entries) +
+      Number((r2[0] as { pair_queue_entries: number }).pair_queue_entries);
+
+    const matches = await sql(`select id from public.matches where ${mine()}`);
+    const left = await sql(`select id from public.queue_entries where ${myEntries()}`);
+    // What was reported is what was written — a tick that returns 1 while
+    // another already consumed the rows is the duplicate bug reporting itself.
+    expect(matches).toHaveLength(reported);
+    expect(matches.length).toBeLessThanOrEqual(1);
+    if (matches.length === 1) {
+      expect(left).toHaveLength(0);
+    } else {
+      // Nothing was consumed, and the next tick still pairs them.
+      expect(left).toHaveLength(2);
+      expect(await pair()).toBe(1);
+    }
+  });
+
+  it('records the taker\'s own team as team_b, not an empty roster', async () => {
+    const o = await offer();
+    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+    expect(
+      await sql<{ team_a: unknown; team_b: unknown; source: string }>(
+        `select team_a, team_b, source from public.matches where ${mine()}`,
+      ),
+    ).toEqual([{ team_a: ['A'], team_b: ['B'], source: 'offer' }]);
+    expect(
+      await sql<{ state: string; accepted_team: unknown }>(
+        `select state, accepted_team from public.match_offers where id = '${o.id}'`,
+      ),
+    ).toEqual([{ state: 'converted', accepted_team: ['B'] }]);
+  });
+
+  /**
+   * The race. Two independent connections accept the same offer at the same
+   * moment. One must win and one must be told no — and crucially there must be
+   * exactly ONE match, not two. Counting rejections is not enough: a rejection
+   * for the wrong reason counts the same, which is how a false pass gets
+   * recorded, so the refusal's message is asserted too.
+   */
+  it('lets only one of two simultaneous accepts through', { timeout: 20000 }, async () => {
+    const o = await offer();
+    const [c1, c2] = [conn(), conn()];
+    const accept = (client: ReturnType<typeof conn>, who: string, team: string) =>
+      client.begin(async (tx) => {
+        await tx.unsafe('set local role authenticated');
+        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
+        return tx.unsafe(`select public.accept_offer('${o.id}', '${team}'::jsonb)`);
+      });
+    const results = await Promise.allSettled([accept(c1, b, '["B"]'), accept(c2, c, '["C"]')]);
+    await Promise.all([c1.end(), c2.end()]);
+
+    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
+    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
+    expect(String(refused.reason?.message)).toMatch(/no longer open/);
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
+  });
+
+  /**
+   * `accept_offer` uses plain `for update`, NOT skip locked, deliberately: a
+   * second accept must WAIT and then be told the offer is taken. Skipping
+   * would find no row and answer "no such offer" — a different and misleading
+   * thing to tell someone whose opponent beat them by a tenth of a second.
+   *
+   * The race above cannot tell those apart on its own, because a run where the
+   * two transactions happen not to overlap produces the same tally. Here the
+   * overlap is forced: a third connection holds the offer row, and the accept
+   * must still be unfinished half a second later.
+   */
+  it('makes a second accept wait for the row rather than declaring it missing', { timeout: 20000 }, async () => {
+    const o = await offer();
+    const lock = await hold(`select id from public.match_offers where id = '${o.id}' for update`);
+    const runner = conn();
+    // Declared outside the try so the `finally` below can release the lock
+    // and then wait for this to unblock, rather than leaving it dangling —
+    // otherwise a failed assertion here leaves the row locked forever and
+    // `afterEach`'s delete on it wedges every later test in this file, which
+    // is exactly the failure mode the previous attempt on this task flagged.
+    let accepting!: Promise<unknown>;
+    try {
+      accepting = runner.begin(async (tx) => {
+        await tx.unsafe('set local role authenticated');
+        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: b })]);
+        return tx.unsafe(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+      });
+      const early = await Promise.race([
+        accepting.then(() => 'settled').catch((e: Error) => `failed: ${e.message}`),
+        new Promise<string>((r) => setTimeout(() => r('still waiting'), 600)),
+      ]);
+      expect(early).toBe('still waiting');
+    } finally {
+      await lock.release();
+      await accepting.catch(() => {});
+      await runner.end();
+    }
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
+  });
+
+  it('holds a scheduled offer until the proposer confirms it too', async () => {
+    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
+    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+    // One-sided acceptance is not a match.
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+    expect(
+      await sql<{ state: string; accepted_team: unknown }>(
+        `select state, accepted_team from public.match_offers where id = '${o.id}'`,
+      ),
+    ).toEqual([{ state: 'accepted', accepted_team: ['B'] }]);
+
+    await asUser({ sub: a })(`select public.confirm_offer('${o.id}')`);
+    // The roster the taker accepted with is what the match is played on — the
+    // proposer's confirmation does not get to supply it for them.
+    expect(
+      await sql<{ team_a: unknown; team_b: unknown }>(`select team_a, team_b from public.matches where ${mine()}`),
+    ).toEqual([{ team_a: ['A'], team_b: ['B'] }]);
+  });
+
+  it('lets nobody but the proposer confirm a scheduled offer', async () => {
+    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
+    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+    await expect(asUser({ sub: c })(`select public.confirm_offer('${o.id}')`)).rejects.toThrow(/only the proposer/);
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  it('refuses to let someone accept their own offer', async () => {
+    const o = await offer();
+    await expect(asUser({ sub: a })(`select public.accept_offer('${o.id}', '["A"]'::jsonb)`)).rejects.toThrow(
+      /cannot accept your own offer/,
+    );
+  });
+
+  it('refuses an accept on an offer the coordinator has not verified', async () => {
+    const [o] = await sql<{ id: string }>(
+      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
+       values ('${a}', '${versionId}', 'cc', 'great', '["A"]'::jsonb, 'rev1', 'public') returning id`,
+    );
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+      /not been verified/,
+    );
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  it('refuses an accept with no team at all', async () => {
+    const o = await offer();
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', null)`)).rejects.toThrow(
+      /team you are accepting with/,
+    );
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  it('refuses an accept from a request carrying no identity', async () => {
+    const o = await offer();
+    await expect(asRole('authenticated')(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+      /signed in/,
+    );
+  });
+
+  it('lapses an unconfirmed offer rather than converting it', async () => {
+    const o = await offer(', expires_at', `, now() - interval '1 minute'`);
+    await sql(`select public.sweep_expired()`);
+    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([
+      { state: 'lapsed' },
+    ]);
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  it('drops a queue entry that waited too long, and leaves a fresh one', async () => {
+    await enqueue(a);
+    await sql(`update public.queue_entries set expires_at = now() - interval '1 minute' where user_id = '${a}'`);
+    await enqueue(b);
+    await sql(`select public.sweep_expired()`);
+    expect(await sql<{ user_id: string }>(`select user_id from public.queue_entries where ${myEntries()}`)).toEqual([
+      { user_id: b },
+    ]);
+  });
+
+  /**
+   * The coordinator in Task 6 calls these two over PostgREST as `service_role`.
+   * Nothing else in this repo grants that role anything, so if this migration
+   * does not, the first tick fails with permission denied.
+   */
+  it('runs the coordinator functions as service_role and refuses everyone else', async () => {
+    await expect(asRole('anon')(`select public.pair_queue_entries()`)).rejects.toThrow(/permission denied/);
+    await expect(asRole('authenticated')(`select public.pair_queue_entries()`)).rejects.toThrow(/permission denied/);
+    await expect(asRole('anon')(`select public.sweep_expired()`)).rejects.toThrow(/permission denied/);
+    await expect(asRole('authenticated')(`select public.sweep_expired()`)).rejects.toThrow(/permission denied/);
+    expect(await asRole('service_role')(`select public.pair_queue_entries()`)).toHaveLength(1);
+    expect(await asRole('service_role')(`select public.sweep_expired()`)).toHaveLength(1);
+  });
+
+  it('refuses an accept from a request with no session at all', async () => {
+    const o = await offer();
+    await expect(asRole('anon')(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+      /permission denied/,
+    );
+  });
+
+  /**
+   * The invariant Task 4 deferred: `accepted_team` was added with no
+   * constraint tying it to `accepted_by`. An `accepted_by` without a team is
+   * an acceptance whose roster was lost, and `confirm_offer` would then try to
+   * write a null into `matches.team_b`, which is NOT NULL — a failure at
+   * confirmation time for a mistake made at acceptance time.
+   */
+  it('refuses an acceptance recorded without the taker\'s team', async () => {
+    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
+    await expect(
+      sql(`update public.match_offers set accepted_by = '${b}', accepted_at = now() where id = '${o.id}'`),
+    ).rejects.toThrow(/match_offers_accepted_needs_team/);
+    // The row is untouched...
+    expect(
+      await sql<{ accepted_by: string | null }>(`select accepted_by from public.match_offers where id = '${o.id}'`),
+    ).toEqual([{ accepted_by: null }]);
+    // ...and the same write, with the team it was missing, goes through.
+    expect(
+      await sql(
+        `update public.match_offers set accepted_by = '${b}', accepted_team = '["B"]'::jsonb, accepted_at = now()
+         where id = '${o.id}' returning id`,
+      ),
+    ).toHaveLength(1);
+  });
+
+  /**
+   * The constraint is deliberately one-directional. `accepted_by` is
+   * `on delete set null`, so deleting the taker's account nulls it while
+   * `accepted_team` stays — a snapshot of a roster with nobody attached. A
+   * symmetric "both null or both set" constraint would turn that cascade into
+   * an error and make the account undeletable.
+   */
+  it('still lets the taker delete their account after accepting', async () => {
+    const t = randomUUID();
+    await makeUser(t, `PT_${t.slice(0, 8)}`);
+    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
+    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
+    await expect(sql(`delete from auth.users where id = '${t}'`)).resolves.toBeDefined();
+    expect(
+      await sql<{ accepted_by: string | null; accepted_team: unknown }>(
+        `select accepted_by, accepted_team from public.match_offers where id = '${o.id}'`,
+      ),
+    ).toEqual([{ accepted_by: null, accepted_team: ['T'] }]);
+  });
+
+  /**
+   * The gap the constraint choice above opens: accepted_by can become null
+   * on an offer still sitting in 'accepted', because nothing about deleting
+   * the taker's account touches `state`. confirm_offer() must recognise that
+   * rather than reach the matches INSERT with a null player_b, which would
+   * surface as a raw NOT NULL violation instead of a clean domain error.
+   */
+  it('refuses to confirm an accepted offer whose taker no longer exists', async () => {
+    const t = randomUUID();
+    await makeUser(t, `PT_${t.slice(0, 8)}`);
+    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
+    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
+    await sql(`delete from auth.users where id = '${t}'`);
+    expect(
+      await sql<{ state: string; accepted_by: string | null }>(
+        `select state, accepted_by from public.match_offers where id = '${o.id}'`,
+      ),
+    ).toEqual([{ state: 'accepted', accepted_by: null }]);
+
+    await expect(asUser({ sub: a })(`select public.confirm_offer('${o.id}')`)).rejects.toThrow(
+      /no longer exists/,
+    );
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+});
diff --git a/supabase/tests/queue.test.ts b/supabase/tests/queue.test.ts
new file mode 100644
index 0000000..df487ef
--- /dev/null
+++ b/supabase/tests/queue.test.ts
@@ -0,0 +1,133 @@
+import { randomUUID } from 'node:crypto';
+import { describe, it, expect, beforeAll, afterEach } from 'vitest';
+import { sql, asUser, asAnon } from './helpers';
+
+describe('queue and match policies', () => {
+  const userA = randomUUID();
+  const userB = randomUUID();
+  let versionId = '';
+
+  async function makeUser(id: string, name: string) {
+    await sql(
+      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
+       values ('${id}', '${id}@example.com', now(),
+         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
+    );
+  }
+
+  beforeAll(async () => {
+    await makeUser(userA, `QA_${userA.slice(0, 8)}`);
+    await makeUser(userB, `QB_${userB.slice(0, 8)}`);
+    const [f] = await sql<{ id: string }>(
+      `insert into public.formats (owner_id, name) values ('${userA}', 'Queue Cup') returning id`,
+    );
+    const [v] = await sql<{ id: string }>(
+      `insert into public.format_versions (format_id, version, rules, rules_hash)
+       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
+    );
+    versionId = v.id;
+  });
+
+  afterEach(async () => {
+    await sql(`delete from public.matches where player_a in ('${userA}','${userB}') or player_b in ('${userA}','${userB}')`);
+    await sql(`delete from public.queue_entries where user_id in ('${userA}','${userB}')`);
+  });
+
+  const enqueue = (owner: string) =>
+    asUser({ sub: owner })<{ id: string }>(
+      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
+       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning id`,
+    );
+
+  it('lets someone join the queue without naming themselves', async () => {
+    const rows = await asUser({ sub: userA })<{ user_id: string }>(
+      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
+       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning user_id`,
+    );
+    expect(rows[0].user_id).toBe(userA);
+  });
+
+  it('refuses a queue entry made on someone else\'s behalf', async () => {
+    await expect(
+      asUser({ sub: userB })(
+        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, team, data_rev)
+         values ('${userA}', 'great', '${versionId}', 'aa', '[]'::jsonb, 'rev1')`),
+    ).rejects.toThrow(/row-level security/);
+  });
+
+  it('hides a queue entry from everyone but its owner', async () => {
+    await enqueue(userA);
+    expect(await asUser({ sub: userB })(`select id from public.queue_entries`)).toHaveLength(0);
+    expect(await asAnon()(`select id from public.queue_entries`)).toHaveLength(0);
+  });
+
+  it('allows only one queue entry per person', async () => {
+    await enqueue(userA);
+    await expect(enqueue(userA)).rejects.toThrow(/queue_entries_one_per_user/);
+  });
+
+  it('lets a player see a match they are in, and nobody else see it', async () => {
+    const [m] = await sql<{ id: string }>(
+      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-1','queue') returning id`,
+    );
+    expect(await asUser({ sub: userA })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(1);
+    const stranger = randomUUID();
+    await makeUser(stranger, `QS_${stranger.slice(0, 8)}`);
+    expect(await asUser({ sub: stranger })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(0);
+  });
+
+  /** The reason this table exists as coordinator-only. */
+  it('refuses a match inserted by a player, even one they are in', async () => {
+    await expect(
+      asUser({ sub: userA })(
+        `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+         values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-2','queue')`),
+    ).rejects.toThrow(/row-level security/);
+  });
+
+  it('reveals an opponent\'s friend code, and only to an opponent', async () => {
+    await sql(`insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')`);
+    const stranger = randomUUID();
+    await makeUser(stranger, `QT_${stranger.slice(0, 8)}`);
+    // Before any match: invisible.
+    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
+    await sql(
+      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-3','queue')`);
+    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
+    expect(await asUser({ sub: stranger })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
+  });
+
+  /**
+   * The `state = 'paired'` clause is the only thing keeping this policy from
+   * granting an opponent's friend code forever, past the point the match
+   * ended. Nothing else in this file ever inserts a non-'paired' match, so a
+   * policy with that clause dropped — or swapped for something looser like
+   * `state != 'abandoned'` — would pass every other test here undetected.
+   * Same pair, same friend-code row, same querier as the paired case: the
+   * only thing that changes is state, so this is what proves the clause is
+   * load-bearing rather than decorative.
+   */
+  it('stops showing a friend code once the match is abandoned', async () => {
+    // upsert: an earlier test in this file already gave userB a friend code
+    // and afterEach doesn't touch public.friend_codes, so a bare insert
+    // would collide on the profile_id primary key here.
+    await sql(
+      `insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')
+       on conflict (profile_id) do update set code = excluded.code`,
+    );
+    // Ground truth: inserted with the superuser connection, which bypasses
+    // RLS, so its existence is proven independently of the policy under test.
+    await sql(
+      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source, state)
+       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-4','queue','paired')`);
+    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
+
+    await sql(`update public.matches set state = 'abandoned' where player_a = '${userA}' and player_b = '${userB}'`);
+    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
+    // afterEach deletes every match for userA/userB, but not friend_codes;
+    // clean up explicitly so this row doesn't linger in the partner's DB.
+    await sql(`delete from public.friend_codes where profile_id = '${userB}'`);
+  });
+});
diff --git a/supabase/tests/teams.test.ts b/supabase/tests/teams.test.ts
index dc28d77..fdd382d 100644
--- a/supabase/tests/teams.test.ts
+++ b/supabase/tests/teams.test.ts
@@ -18,48 +18,48 @@ describe('team policies', () => {
 
   beforeAll(async () => {
     await makeUser(userA, `TeamA_${userA.slice(0, 8)}`);
     await makeUser(userB, `TeamB_${userB.slice(0, 8)}`);
   });
 
   afterEach(async () => {
     await sql(`delete from public.teams where owner_id in ('${userA}', '${userB}')`);
   });
 
-  async function teamFor(owner: string): Promise<string> {
+  async function teamFor(owner: string, size: 3 | 6 = 6): Promise<string> {
     const [row] = await sql<{ id: string }>(
-      `insert into public.teams (owner_id, name, league)
-       values ('${owner}', 'Test Roster', 'great') returning id`,
+      `insert into public.teams (owner_id, name, league, size)
+       values ('${owner}', 'Test Roster', 'great', ${size}) returning id`,
     );
     return row.id;
   }
 
   it('lets an owner insert their own team', async () => {
     const rows = await asUser({ sub: userA })<{ id: string }>(
-      `insert into public.teams (owner_id, name, league)
-       values ('${userA}', 'Mine', 'great') returning id`,
+      `insert into public.teams (owner_id, name, league, size)
+       values ('${userA}', 'Mine', 'great', 6) returning id`,
     );
     expect(rows).toHaveLength(1);
   });
 
   it('defaults owner_id to the signed-in user, since the client never sends it', async () => {
     const rows = await asUser({ sub: userA })<{ owner_id: string }>(
-      `insert into public.teams (name, league) values ('Defaulted', 'great') returning owner_id`,
+      `insert into public.teams (name, league, size) values ('Defaulted', 'great', 6) returning owner_id`,
     );
     expect(rows[0].owner_id).toBe(userA);
   });
 
   it('refuses a team inserted on someone else\'s behalf', async () => {
     await expect(
       asUser({ sub: userB })(
-        `insert into public.teams (owner_id, name, league)
-         values ('${userA}', 'Not mine', 'great')`,
+        `insert into public.teams (owner_id, name, league, size)
+         values ('${userA}', 'Not mine', 'great', 6)`,
       ),
     ).rejects.toThrow(/row-level security/);
   });
 
   it('shows an owner their own team', async () => {
     const id = await teamFor(userA);
     const rows = await asUser({ sub: userA })(`select id from public.teams where id = '${id}'`);
     expect(rows).toHaveLength(1);
   });
 
@@ -153,39 +153,55 @@ describe('team policies', () => {
    * That prompt compares against the roster list already in the browser, so two
    * tabs — or one tab whose list is stale — both see "no such name" and both
    * insert. The client cannot close that window; only the database can, because
    * only the database sees both writes.
    *
    * Trimmed and lower-cased to match the client's own comparison exactly
    * (`name.trim().toLowerCase()` in TeamBuilderScreen). An index on bare `name`
    * would let "  GL Squad" through a check that had already called it taken,
    * which is worse than no index: the two rules would disagree.
    */
-  it('refuses a second roster with the same name for one owner', async () => {
-    await asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`);
+  it('refuses a second roster with the same name and size for one owner', async () => {
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
     await expect(
-      asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`),
+      asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`),
     ).rejects.toThrow(/teams_owner_name_uniq/);
   });
 
-  it('refuses one that differs only in case or surrounding space', async () => {
-    await asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`);
+  it('refuses one that differs only in case or surrounding space, at the same size', async () => {
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
     await expect(
-      asUser({ sub: userA })(`insert into public.teams (name, league) values ('  gl squad  ', 'ultra')`),
+      asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('  gl squad  ', 'ultra', 3)`),
     ).rejects.toThrow(/teams_owner_name_uniq/);
   });
 
   /** Names are personal. Two people may both have a "GL Squad". */
   it('lets a different owner hold the same name', async () => {
-    await asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`);
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
     const rows = await asUser({ sub: userB })<{ id: string }>(
-      `insert into public.teams (name, league) values ('GL Squad', 'great') returning id`,
+      `insert into public.teams (name, league, size) values ('GL Squad', 'great', 3) returning id`,
+    );
+    expect(rows).toHaveLength(1);
+  });
+
+  /**
+   * The whole point of widening the index to (owner_id, size, name): a GBL
+   * "Core" and a Show 6 "Core" are two different rosters now that each
+   * builder only ever sees its own size, and forbidding the shared name would
+   * be a restriction the UI could never explain. Asserted alongside the
+   * same-size duplicate rejection above, not instead of it — an index that
+   * simply permitted everything would pass this half alone.
+   */
+  it('lets one owner hold the same name at two different sizes', async () => {
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
+    const rows = await asUser({ sub: userA })<{ id: string }>(
+      `insert into public.teams (name, league, size) values ('GL Squad', 'great', 6) returning id`,
     );
     expect(rows).toHaveLength(1);
   });
 
   /** The rename path has to keep working, or overwriting is the only way to save. */
   it('still lets an owner rename a roster to a name nobody holds', async () => {
     const id = await teamFor(userA);
     const rows = await asUser({ sub: userA })<{ name: string }>(
       `update public.teams set name = 'Renamed' where id = '${id}' returning name`,
     );
@@ -195,11 +211,46 @@ describe('team policies', () => {
   it('rejects a third charge move', async () => {
     const id = await teamFor(userA);
     await expect(
       sql(
         `insert into public.team_members
            (team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina)
          values ('${id}', 1, 'azumarill', 'BUBBLE', '{"A","B","C"}', 0, 15, 15)`,
       ),
     ).rejects.toThrow(/team_members_charge_count/);
   });
+
+  /**
+   * Task 5b: size is a consequence of the screen a roster was saved from, not
+   * a stored guess (ledger Ruling 13). Every insert above already supplies it
+   * because the column is NOT NULL with no default — these tests are the ones
+   * that pin down the column's own rules rather than relying on it as a side
+   * effect of another test passing.
+   */
+  describe('team size', () => {
+    it('rejects a team with no size at all', async () => {
+      await expect(
+        asUser({ sub: userA })(`insert into public.teams (name, league) values ('No Size', 'great')`),
+      ).rejects.toThrow(/null value in column "size"|violates not-null constraint/);
+    });
+
+    it('rejects a size outside 3 or 6', async () => {
+      await expect(
+        asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('Bad Size', 'great', 4)`),
+      ).rejects.toThrow(/teams_size/);
+    });
+
+    it('accepts a size of 3', async () => {
+      const rows = await asUser({ sub: userA })<{ size: number }>(
+        `insert into public.teams (name, league, size) values ('Three', 'great', 3) returning size`,
+      );
+      expect(rows[0].size).toBe(3);
+    });
+
+    it('accepts a size of 6', async () => {
+      const rows = await asUser({ sub: userA })<{ size: number }>(
+        `insert into public.teams (name, league, size) values ('Six', 'great', 6) returning size`,
+      );
+      expect(rows[0].size).toBe(6);
+    });
+  });
 });
