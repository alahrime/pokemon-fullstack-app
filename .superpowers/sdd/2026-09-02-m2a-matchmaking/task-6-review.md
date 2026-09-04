# Task 6 review package — 334aeda..HEAD

## Commits
36bf1f9 feat(coordinator): verify what a client claims, then pair what agrees

## Files changed
 app/package.json                                   |   1 +
 supabase/functions/coordinator/index.ts            |  49 ++
 supabase/functions/coordinator/rules.bundle.d.ts   |   2 +
 supabase/functions/coordinator/rules.bundle.js     | 786 +++++++++++++++++++++
 .../20260903030000_coordinator_schedule.sql        |  27 +
 5 files changed, 865 insertions(+)

## Full diff
diff --git a/app/package.json b/app/package.json
index da23e60..a657f52 100644
--- a/app/package.json
+++ b/app/package.json
@@ -11,20 +11,21 @@
     "tokens": "node scripts/token-parity.mjs",
     "data": "node scripts/build-data.mjs && npm run best-spreads && npm run matrix && npm run teams && npm run summary",
     "summary": "esbuild scripts/build-summary.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/summary.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/summary.mjs",
     "matrix": "esbuild scripts/build-matrix.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/matrix.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/matrix.mjs",
     "teams": "esbuild scripts/build-teams.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/teams.mjs --log-level=warning && node --max-old-space-size=8192 node_modules/.cache/teams.mjs",
     "verify": "esbuild scripts/verify-data.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/verify.mjs --log-level=warning && node node_modules/.cache/verify.mjs",
     "check": "tsc -b && oxlint && npm run themes && npm run tokens && npm run verify && npm run audit:spreads && npm run rules:node && npm run test",
     "preview": "vite preview",
     "audit:spreads": "esbuild scripts/audit-spreads.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/audit.mjs --log-level=warning && node node_modules/.cache/audit.mjs",
     "rules:node": "esbuild src/rules/index.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/rules-check.mjs --log-level=warning && node -e \"import('./node_modules/.cache/rules-check.mjs').then(m => { if (!Object.keys(m).length) process.exit(1) })\"",
+    "build:coordinator": "esbuild src/rules/index.ts --bundle --format=esm --platform=neutral --outfile=../supabase/functions/coordinator/rules.bundle.js --log-level=warning",
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
index 0000000..84f8c8e
--- /dev/null
+++ b/supabase/functions/coordinator/rules.bundle.d.ts
@@ -0,0 +1,2 @@
+import type { Format } from '../../../app/src/rules/types';
+export declare function rulesHash(format: Format): Promise<string>;
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

## NOTE
rules.bundle.js is generated by 'npm run build:coordinator' from app/src/rules/index.ts and is excluded above.
