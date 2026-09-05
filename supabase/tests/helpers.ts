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

/**
 * The two ways Postgres REFUSES a write in these suites, which have to be kept
 * apart. They share SQLSTATE 42501 and are otherwise nothing alike:
 *
 *   PRIVILEGE_DENIED — `permission denied for table x`. The role holds no
 *   grant for the verb, so the statement is rejected before any row is
 *   considered. This is what `revoke update on ... from authenticated`
 *   produces.
 *
 *   POLICY_DENIED — `new row violates row-level security policy for table
 *   "x"`. The grant exists and a WITH CHECK clause rejected the row.
 *
 * And a third outcome that is not an error at all: an UPDATE or DELETE whose
 * USING clause excludes the row reports 0 rows affected and raises NOTHING
 * (Ruling 12). `rejects.toThrow()` on its own cannot tell any of these apart —
 * and which one applies is precisely what the C1/C2 fix changed — so tests
 * name the class they mean rather than asserting that something threw.
 */
export const PRIVILEGE_DENIED =
  /permission denied for table (match_offers|queue_entries|matches|match_reports|match_rounds)/;
export const POLICY_DENIED = /new row violates row-level security policy/;

/**
 * Runs `q` and returns the refusal's SQLSTATE and message. Throws if the
 * statement SUCCEEDED, so a test that meant to observe a denial fails saying
 * that rather than on a confusing property access afterwards — the failure
 * mode this milestone hit when `getAttribute(...).toMatch` raised TypeError
 * instead of asserting.
 */
export async function refusal(q: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await q();
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? '(none)', message: err.message };
  }
  throw new Error('expected this statement to be refused, and it SUCCEEDED');
}

/**
 * Runs `body` in a transaction that ALWAYS rolls back, and always rejects.
 *
 * For probing a statement whose success would be destructive to rows this
 * suite does not own — `truncate`, in practice, which ignores row-level
 * security entirely and would empty every user's table. The privilege check
 * runs when the statement executes, so a rolled-back attempt is the same
 * evidence as a committed one.
 *
 * It rejects on BOTH paths on purpose, with different codes, because a plain
 * rollback would otherwise be indistinguishable from a refusal: a real
 * database error passes through with its own SQLSTATE, while a body that
 * SUCCEEDED rejects with `SUCCEEDED_THEN_ROLLED_BACK`, so a test asserting
 * '42501' fails and names what actually happened.
 */
export async function rollingBack(body: (tx: postgres.TransactionSql) => Promise<void>): Promise<never> {
  await client.begin(async (tx) => {
    await body(tx);
    throw Object.assign(new Error('the statement SUCCEEDED; the transaction was rolled back'), {
      code: 'SUCCEEDED_THEN_ROLLED_BACK',
    });
  });
  throw new Error('unreachable: the transaction above always throws');
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
