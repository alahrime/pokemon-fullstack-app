/**
 * Staleness guard for the coordinator's bundled rules module.
 *
 *   npm run verify:coordinator-bundle (wired into `npm run check`)
 *
 * `supabase/functions/coordinator/rules.bundle.js` is a committed, generated
 * file — `npm run build:coordinator` produces it from `src/rules/index.ts`.
 * Nothing rebuilds it automatically and there is no CI, so an edit to
 * `src/rules/*` that forgets the rebuild would leave the coordinator
 * verifying hashes against a stale copy of the rules: two implementations,
 * two answers, reached by drift instead of design. This rebuilds the same
 * bundle to a throwaway path and diffs it byte-for-byte against the committed
 * one, failing the gate the moment they disagree.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APP_DIR = new URL('..', import.meta.url).pathname;
const COMMITTED = path.join(APP_DIR, '..', 'supabase', 'functions', 'coordinator', 'rules.bundle.js');
const tmpOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-bundle-')), 'rules.bundle.js');

execFileSync(
  path.join(APP_DIR, 'node_modules', '.bin', 'esbuild'),
  ['src/rules/index.ts', '--bundle', '--format=esm', '--platform=neutral', `--outfile=${tmpOut}`, '--log-level=warning'],
  { cwd: APP_DIR, stdio: 'inherit' },
);

if (!fs.existsSync(COMMITTED)) {
  console.error(
    `supabase/functions/coordinator/rules.bundle.js does not exist.\nRun: npm run build:coordinator`,
  );
  process.exit(1);
}

const committed = fs.readFileSync(COMMITTED, 'utf8');
const fresh = fs.readFileSync(tmpOut, 'utf8');

if (committed !== fresh) {
  console.error(
    'supabase/functions/coordinator/rules.bundle.js is stale: it no longer matches ' +
      'what `esbuild src/rules/index.ts` produces right now.\n' +
      'The coordinator (the Edge Function that verifies a client\'s claimed rules_hash) ' +
      'would be checking claims against a different implementation than the one the browser ' +
      'runs.\n\nRun: npm run build:coordinator\nThen commit the updated bundle.',
  );
  process.exit(1);
}

console.log('supabase/functions/coordinator/rules.bundle.js matches src/rules — not stale.');
