import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Test setup.
 *
 * Two environments in one run: `lib/` and `scripts/` are pure and run in node,
 * everything with JSX needs jsdom. Vitest picks per-file via the
 * `environmentMatchGlobs` equivalent — here a single jsdom default, since the
 * pure modules do not care and a uniform environment is one less thing to
 * explain when a test fails.
 *
 * Coverage excludes what a unit test cannot meaningfully assert: the generated
 * data blobs, the 3D view (a WebGL canvas), and the entry point.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    /**
     * The Supabase client reads its URL and key from the environment and
     * refuses to be constructed without them, so any test that transitively
     * imports it needs both present. They cannot come from `.env.local` — that
     * file is git-ignored, so the suite would pass here and fail on a fresh
     * clone. These are not credentials and reach no network: every test that
     * exercises the client mocks `@supabase/supabase-js` at the package
     * boundary. The point is only that the guard has something to accept.
     */
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_test_not_a_credential',
    },
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'scripts/bradley-terry.ts'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/data/**',
        // A WebGL canvas has no meaningful assertions in jsdom; it is verified
        // in the browser instead. It is the only screen in this list — the
        // sprite audit sat here too, as a convenience rather than because it
        // resisted testing, and now has a suite of its own.
        'src/components/Heatmap3D.tsx',
      ],
    },
  },
});
