import { createClient } from '@supabase/supabase-js';

/**
 * The browser's Supabase client, created once at startup.
 *
 * Everything the app stores lives behind PostgREST, which means every table is
 * an endpoint and the row policy in `supabase/migrations/` is the only check
 * standing in front of it. This client carries the anon key and, once someone
 * signs in, their JWT — both public by design. The SERVICE ROLE key bypasses
 * every one of those policies, so it must never appear in this module, this
 * bundle, or `.env.local`.
 *
 * The two values are read STATICALLY, one member expression each. Vite replaces
 * `import.meta.env.VITE_*` textually at build time and does not resolve a
 * dynamic lookup — `import.meta.env[name]` would work under the dev server and
 * then read `undefined` in a production build, which is the worst version of
 * this bug: it only appears once deployed.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Fail at import rather than on first use.
 *
 * A client built from `undefined` is not inert — it is a client that throws
 * somewhere else later, in a component, with a message about a fetch. Refusing
 * here means the app does not start, and says why.
 */
function required(value: string | undefined, name: string): string {
  if (typeof value === 'string' && value !== '') return value;
  throw new Error(
    `${name} is not set, so the Supabase client cannot be created.\n` +
      `Copy app/.env.example to app/.env.local and fill both values in; ` +
      `\`npm run db:start\` prints them for the local stack.\n` +
      `Note that the SERVICE ROLE key is not one of them — it bypasses every ` +
      `row-level security policy and must never be used from the browser.`,
  );
}

export const supabase = createClient(
  required(url, 'VITE_SUPABASE_URL'),
  required(anonKey, 'VITE_SUPABASE_ANON_KEY'),
);
