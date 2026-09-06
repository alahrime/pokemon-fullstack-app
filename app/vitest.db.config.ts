import { defineConfig } from 'vitest/config';

/**
 * The database suite: policy tests that talk to a real local Postgres
 * (`supabase start`, port 54322), not a browser. Kept as its own config,
 * separate from `vitest.config.ts`, for two reasons — it needs `node` rather
 * than `jsdom` (there is no DOM here, only SQL), and it must NOT join the
 * default `npm run test` include globs: it requires a running database and
 * would fail every plain `vitest run` for a reason that has nothing to do
 * with the code changed.
 *
 * Run via `npm run check:db`, which starts the stack first.
 *
 * `fileParallelism: false`: every file here hits the SAME live Postgres, and
 * several assertions (e.g. social.test.ts's `select * from public.friendships`
 * with no where clause) read the whole shared table, not just rows scoped to
 * that file's own users. That was safe while only one file wrote to
 * `friendships`; Task 2 added `befriend()` calls to channels.test.ts, and
 * Vitest's default cross-file parallelism let those inserts land, briefly,
 * while social.test.ts's global-count assertions were mid-flight — a real
 * race, reproduced consistently on this machine, not a migration bug. Running
 * files one at a time is what these tests already assumed.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['../supabase/tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
