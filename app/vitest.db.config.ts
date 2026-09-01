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
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['../supabase/tests/**/*.test.ts'],
  },
});
