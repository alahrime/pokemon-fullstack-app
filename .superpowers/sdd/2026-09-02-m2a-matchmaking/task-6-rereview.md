# Task 6 fix-round 1 re-review — 36bf1f9..HEAD

## Commits
f031a4e fix(coordinator): self-contained bundle types, and a guard against a stale one

## Files changed
 app/package.json                                 |  3 +-
 app/scripts/verify-coordinator-bundle.mjs        | 51 ++++++++++++++++++++++++
 supabase/functions/coordinator/rules.bundle.d.ts |  3 +-
 3 files changed, 54 insertions(+), 3 deletions(-)

## Full diff (generated bundle excluded)
diff --git a/app/package.json b/app/package.json
index a657f52..0ab5cec 100644
--- a/app/package.json
+++ b/app/package.json
@@ -2,35 +2,36 @@
   "name": "app",
   "private": true,
   "version": "0.0.0",
   "type": "module",
   "scripts": {
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
     "build:coordinator": "esbuild src/rules/index.ts --bundle --format=esm --platform=neutral --outfile=../supabase/functions/coordinator/rules.bundle.js --log-level=warning",
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
   },
   "dependencies": {
     "@react-three/drei": "^10.7.7",
     "@react-three/fiber": "^9.6.1",
     "@supabase/supabase-js": "^2.112.4",
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
diff --git a/supabase/functions/coordinator/rules.bundle.d.ts b/supabase/functions/coordinator/rules.bundle.d.ts
index 84f8c8e..9d34eae 100644
--- a/supabase/functions/coordinator/rules.bundle.d.ts
+++ b/supabase/functions/coordinator/rules.bundle.d.ts
@@ -1,2 +1 @@
-import type { Format } from '../../../app/src/rules/types';
-export declare function rulesHash(format: Format): Promise<string>;
+export declare function rulesHash(format: unknown): Promise<string>;
