import postgres from 'postgres';

/**
 * The local Supabase stack's database, reached directly (not through
 * PostgREST). The connection string, port, and `postgres`/`postgres`
 * credentials are the fixed defaults every `supabase start` produces — not a
 * secret, and never a hosted key.
 */
const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// A single connection, reused across the whole run. Every query below runs
// inside its own transaction so `set local` never leaks between calls.
const client = postgres(CONNECTION_STRING, { max: 1 });

/**
 * Run a query as the `postgres` superuser — the same role migrations run as.
 * This role owns every table in `public` and therefore bypasses RLS
 * entirely, which is what makes it useful as the "ground truth" side of a
 * denied-vs-allowed comparison, and for fixture setup that must not be
 * blocked by the very policies under test.
 */
export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  return client.unsafe(query) as unknown as Promise<T[]>;
}

type JwtClaims = Record<string, unknown> & { sub: string };

/**
 * Returns a query function whose requests carry the identity PostgREST would
 * attach for a signed-in user: `role = authenticated` plus
 * `request.jwt.claims` holding `claims`. `auth.uid()` and `auth.role()` read
 * exactly this GUC (confirmed against this stack's own `auth.uid()` — see
 * task-3-report.md), so a policy written against `auth.uid()` sees the same
 * thing here as it would from a real request.
 *
 * Each call runs in its own transaction: `set local role` and `set local
 * request.jwt.claims` are transaction-scoped, so impersonation from one call
 * can never leak into the next.
 */
export function asUser(claims: JwtClaims) {
  return async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
    return client.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      // Bound as a query parameter (not string-interpolated) so a claim value
      // containing a quote can't break out of the SQL literal it would
      // otherwise land in.
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(claims),
      ]);
      return tx.unsafe(query) as unknown as Promise<T[]>;
    });
  };
}

/**
 * Returns a query function carrying the identity PostgREST gives an
 * unauthenticated request: `role = anon`, no JWT claims at all. Distinct from
 * `asUser` rather than `asUser({role: 'anon'})`, because a real anonymous
 * request never has a `request.jwt.claims` GUC set — `auth.uid()` resolving
 * to null via a missing setting is a different thing than resolving to null
 * via an empty claims object, and a policy could tell them apart.
 */
export function asAnon() {
  return async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
    return client.begin(async (tx) => {
      await tx.unsafe('set local role anon');
      return tx.unsafe(query) as unknown as Promise<T[]>;
    });
  };
}
