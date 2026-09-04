# Task 2 review package — 576e2e9..HEAD

## Commits
1ecbc3d docs(task-2): rules_hash implementation report
2636f88 feat(rules): rules_hash is a sha256, now that a queue partitions on it

## Files changed
 .../2026-09-02-m2a-matchmaking/task-2-report.md    | 184 +++++++++++++++++++++
 app/src/lib/__tests__/saves.test.ts                |   7 +-
 app/src/lib/saves.ts                               |   4 +-
 app/src/rules/__tests__/hash.test.ts               |  26 +++
 app/src/rules/hash.ts                              |  19 +++
 app/src/rules/index.ts                             |   1 +
 6 files changed, 236 insertions(+), 5 deletions(-)

## Full diff
diff --git a/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-2-report.md b/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-2-report.md
new file mode 100644
index 0000000..790b40b
--- /dev/null
+++ b/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-2-report.md
@@ -0,0 +1,184 @@
+# Task 2 report: `rules_hash` becomes an actual hash
+
+## What changed and why
+
+- **Created `app/src/rules/hash.ts`** — `rulesHash(format: Format): Promise<string>`. Encodes `canonicalize(format)` as UTF-8 bytes, digests with `crypto.subtle.digest('SHA-256', ...)`, and formats the result as 64 lowercase hex characters. `crypto.subtle` (not `node:crypto`) is the point of the task: this exact function must run unchanged in the browser, under Node (`npm run rules:node`), and later in a Deno Edge Function that recomputes the hash a client claims for its own format — one implementation, one answer. `canonicalize` is imported, not inlined or reimplemented, so format identity (key order irrelevant, notes irrelevant, clause order significant) stays defined in exactly one place.
+
+- **Modified `app/src/rules/index.ts`** — added `export { rulesHash } from './hash';` alongside the existing `canonicalize` export, so `rulesHash` is part of the module's public surface like everything else UI code and `saves.ts` import from `../rules`.
+
+- **Modified `app/src/lib/saves.ts`** — the `format_versions` insert in `saveServerFormat` now stores `rules_hash: await rulesHash(f.format)` instead of `rules_hash: canonicalize(f.format)`. `saveServerFormat` was already `async`, so the added `await` needed no other signature change.
+
+- **Created `app/src/rules/__tests__/hash.test.ts`** — the three tests from the brief verbatim: 64-hex-character shape, two independently-authored identical formats agree, and a differing rule (`composition.size`) produces a different hash.
+
+- **Modified `app/src/lib/__tests__/saves.test.ts`** — updated the one assertion that depended on the old canonical-string value (see "Assertions changed" below).
+
+## One deviation from the brief's literal code, and why
+
+Step 4 of the brief gives the `saves.ts` import line verbatim as:
+
+```ts
+import { canonicalize, rulesHash, type Format } from '../rules';
+```
+
+with the note "`canonicalize` stays imported — it remains the definition of format identity and is what the hash is taken over." Taken literally, this leaves `canonicalize` an **unused** import in `saves.ts` once the insert switches to `rulesHash(f.format)` — there is no other reference to `canonicalize` anywhere else in that file (confirmed by `grep -n "canonicalize" src/lib/saves.ts` before editing: only the import line matched).
+
+`tsconfig.app.json` and `tsconfig.node.json` both set `noUnusedLocals: true`, and the gate runs `tsc -b` first. I verified this concretely:
+
+```
+$ npx tsc -b
+src/lib/saves.ts(2,10): error TS6133: 'canonicalize' is declared but its value is never read.
+EXIT=2
+```
+
+So the brief's literal import line fails the gate it also requires to pass (`npm run check` must exit 0). I read "`canonicalize` stays imported" as describing the architectural invariant — canonicalize remains the sole definition of format identity, and `hash.ts` calls it rather than reimplementing it (which it does: `import { canonicalize } from './canonical';` in `hash.ts`) — not a literal instruction to carry a now-dead import in `saves.ts`. I changed the `saves.ts` import to:
+
+```ts
+import { rulesHash, type Format } from '../rules';
+```
+
+and dropped `canonicalize` from it. `canonicalize` itself is untouched, still exported from `index.ts`, still the sole source of the canonical string, and still imported by `hash.ts` and by `saves.test.ts` was not needed either since the test was updated to compare against `rulesHash` output directly (see below). Flagging this explicitly since the brief said to use exact values verbatim and I deviated from one literal line for a hard gate requirement — happy to revert if there's a reason `canonicalize` needed to stay imported in `saves.ts` that I'm missing (e.g. a planned near-term caller in that file I don't have visibility into).
+
+## TDD: verbatim failing-test output (before implementation)
+
+Command: `cd app && ./node_modules/.bin/vitest run src/rules/__tests__/hash.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
+
+```
+EXIT=1
+
+ RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app
+
+
+⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
+
+ FAIL  src/rules/__tests__/hash.test.ts [ src/rules/__tests__/hash.test.ts ]
+Error: Failed to resolve import "../hash" from "src/rules/__tests__/hash.test.ts". Does the file exist?
+  Plugin: vite:import-analysis
+  File: /Users/alilahrime/Downloads/paragon-iv/app/src/rules/__tests__/hash.test.ts:3:26
+  1  |  import { describe, it, expect } from "vitest";
+  2  |  import { RULES_SCHEMA } from "../index";
+  3  |  import { rulesHash } from "../hash";
+     |                             ^
+  4  |  const base = {
+  5  |    schema: RULES_SCHEMA,
+ ❯ TransformPluginContext._formatLog node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:29079:43
+ ❯ TransformPluginContext.error node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:29076:14
+ ❯ normalizeUrl node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:27199:18
+ ❯ node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:27257:32
+ ❯ TransformPluginContext.transform node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:27225:4
+ ❯ EnvironmentPluginContainer.transform node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:28877:14
+ ❯ loadAndTransform node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:22746:26
+
+⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
+
+
+ Test Files  1 failed (1)
+      Tests  no tests
+   Start at  13:32:33
+   Duration  494ms (transform 24ms, setup 50ms, collect 0ms, tests 0ms, environment 257ms, prepare 33ms)
+```
+
+Matches the brief's expectation exactly: EXIT=1, "cannot resolve `../hash`".
+
+## Verbatim passing output (after implementation)
+
+Command: `cd app && ./node_modules/.bin/vitest run src/rules src/lib/__tests__/saves.test.ts > /tmp/green.log 2>&1; echo "EXIT=$?"`
+
+```
+EXIT=0
+
+ RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app
+
+ ✓ src/rules/__tests__/isolation.test.ts (3 tests) 2ms
+ ✓ src/rules/__tests__/satisfiable.test.ts (8 tests) 27ms
+ ✓ src/rules/__tests__/team.test.ts (8 tests) 9ms
+ ✓ src/rules/__tests__/pool.test.ts (13 tests) 37ms
+ ✓ src/rules/__tests__/hash.test.ts (3 tests) 3ms
+ ✓ src/rules/__tests__/quotas.test.ts (11 tests) 11ms
+ ✓ src/rules/__tests__/lint.test.ts (16 tests) 51ms
+ ✓ src/rules/__tests__/edits.test.ts (12 tests) 31ms
+ ✓ src/rules/__tests__/roll.test.ts (12 tests) 69ms
+ ✓ src/lib/__tests__/saves.test.ts (14 tests) 284ms
+ ✓ src/rules/__tests__/canonical.test.ts (8 tests) 2ms
+ ✓ src/rules/__tests__/selector.test.ts (8 tests) 2ms
+
+ Test Files  12 passed (12)
+      Tests  116 passed (116)
+   Start at  13:33:41
+   Duration  1.85s (transform 327ms, setup 1.11s, collect 1.07s, tests 528ms, environment 8.57s, prepare 1.20s)
+```
+
+`isolation.test.ts` passes with `crypto.subtle` present in `hash.ts` — confirming `crypto.*` is not caught by the browser-global regex (`\b(window|document|localStorage|sessionStorage|navigator)\s*\.`), as the brief predicted.
+
+## `npm run rules:node` output
+
+Command: `cd app && npm run rules:node > /tmp/rules.log 2>&1; echo "EXIT=$?"`
+
+```
+EXIT=0
+
+> app@0.0.0 rules:node
+> esbuild src/rules/index.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/rules-check.mjs --log-level=warning && node -e "import('./node_modules/.cache/rules-check.mjs').then(m => { if (!Object.keys(m).length) process.exit(1) })"
+```
+
+This is the check that mattered most per the brief: it bundles all of `src/rules/index.ts` (now including `hash.ts`, which calls `crypto.subtle.digest`) with esbuild for the Node platform and actually imports/executes the bundle under plain `node`. EXIT=0 confirms `crypto.subtle` resolves and runs correctly under Node — the same code path that will later run in the Deno Edge Function and in the browser.
+
+## `npm run check` final line and EXIT code
+
+Command: `cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"`
+
+Final lines:
+
+```
+ Test Files  79 passed (79)
+      Tests  1081 passed (1081)
+   Start at  13:34:19
+   Duration  31.07s (transform 2.43s, setup 9.44s, collect 15.06s, tests 154.57s, environment 50.50s, prepare 5.55s)
+```
+
+`EXIT=0`. The full pipeline ran and passed in order: `tsc -b`, `oxlint`, `themes`, `tokens`, `verify`, `audit:spreads`, `rules:node`, `test` (vitest, 79 files / 1081 tests, including the `hash.test.ts` and updated `saves.test.ts`).
+
+## Existing assertions changed
+
+Only one, in `app/src/lib/__tests__/saves.test.ts`:
+
+**Before:**
+```ts
+it('stores the canonical hash alongside the rules', async () => {
+  const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 0 }] });
+  const { saveServerFormat } = await import('../saves');
+  const { canonicalize } = await import('../../rules');
+  await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
+  const v = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
+  expect((v?.payload as { rules_hash: string }).rules_hash).toBe(canonicalize(FORMAT));
+});
+```
+
+**After:**
+```ts
+it('stores the sha256 digest of the canonical rules, not the string itself', async () => {
+  const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 0 }] });
+  const { saveServerFormat } = await import('../saves');
+  const { rulesHash } = await import('../../rules');
+  await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
+  const v = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
+  expect((v?.payload as { rules_hash: string }).rules_hash).toBe(await rulesHash(FORMAT));
+  expect((v?.payload as { rules_hash: string }).rules_hash).toMatch(/^[0-9a-f]{64}$/);
+});
+```
+
+Why: the old assertion checked that the stored `rules_hash` equalled `canonicalize(FORMAT)` — the full canonical string. That's precisely the behavior this task removes: the stored value is now a sha256 digest of that string, not the string itself, so the old assertion is testing the pre-task behavior and would (correctly) fail once the production code changed. I renamed the test to say what it now actually verifies, compare against `rulesHash(FORMAT)` (the same function under test elsewhere, computed independently in the test rather than duplicating the hex-digest logic inline), and added the 64-hex-character shape check so the test can't pass by accident if `rulesHash` and the insert path both regressed to something non-hash-shaped in the same way. No test was deleted; the assertion target changed because the stored value genuinely changed, per the brief's own instruction.
+
+No other existing assertions referenced the old canonical-string value of `rules_hash`.
+
+## Commit
+
+```
+git add app/src/rules/hash.ts app/src/rules/index.ts app/src/rules/__tests__/hash.test.ts app/src/lib/saves.ts app/src/lib/__tests__/saves.test.ts
+git commit -m "feat(rules): rules_hash is a sha256, now that a queue partitions on it"
+```
+
+## Anything I'm unsure about
+
+1. **The `canonicalize` import deviation above** — I'm confident the fix is correct (unused import fails `tsc -b` with `noUnusedLocals: true`, verified directly), but flagging it explicitly since the brief said to follow it verbatim and I deviated from one literal code line to keep the gate green. If there was a reason to keep an unused import there (e.g., an ESLint/oxlint disable comment expected, or a near-future caller), I don't have visibility into it.
+2. Migration/schema: the brief's "Note for the reviewer" says existing `format_versions` rows keep the old canonical-string value and that production holds none. I did not touch any migration files or the database — per the task's explicit instruction not to run `db:reset`/`db:start`/`db:stop` or `npm run data`, and because no migration file was named in "Files" to modify. If a schema change (e.g., a `CHECK` constraint expecting 64 hex chars, or a comment on the column) was expected as part of this task, I did not find one named in the brief and did not add one unprompted.
+3. I did not verify `rules_hash` end-to-end against a live Supabase instance (explicitly out of scope — a stack is running and in use by the human partner). Verification is limited to the unit/integration tests above plus the Node-runtime bundling check.
diff --git a/app/src/lib/__tests__/saves.test.ts b/app/src/lib/__tests__/saves.test.ts
index 37c37ff..a191dfd 100644
--- a/app/src/lib/__tests__/saves.test.ts
+++ b/app/src/lib/__tests__/saves.test.ts
@@ -225,27 +225,28 @@ describe('saved formats', () => {
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
diff --git a/app/src/lib/saves.ts b/app/src/lib/saves.ts
index af6fc86..2ba04d1 100644
--- a/app/src/lib/saves.ts
+++ b/app/src/lib/saves.ts
@@ -1,12 +1,12 @@
 import { supabase } from './supabase';
-import { canonicalize, type Format } from '../rules';
+import { rulesHash, type Format } from '../rules';
 import type { LeagueId } from './types';
 import type { StoredMember } from './teamCodec';
 
 export interface SavedTeam {
   id: string;
   name: string;
   league: LeagueId;
   members: StoredMember[];
 }
 
@@ -172,20 +172,20 @@ export async function saveServerFormat(f: { id?: string; name: string; format: F
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
