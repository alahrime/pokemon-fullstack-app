import { describe, it, expect } from 'vitest';
import { sql, refusal, rollingBack } from './helpers';

/**
 * The coordinator tick's guard.
 *
 * The defect this suite exists for: 20260903030000 scheduled
 * `net.http_post(url := current_setting('app.coordinator_url', true), …)` with
 * nothing between an unset GUC and `http_request_queue.url`, which is NOT
 * NULL. On a deployment where the settings were never applied the job did not
 * degrade — it RAISED, every minute, forever, and the local stack had 91
 * failed runs and zero successes to prove it. Every assertion below is about
 * the difference between "does nothing" and "throws".
 *
 * The names are duplicated from the migration on purpose. A test that read
 * them out of the same place the function reads them from would still pass if
 * someone renamed both, and the names ARE the contract with the operator —
 * a deploy that creates `coordinator-url` instead of `coordinator_url` gets a
 * silent, permanently inert matchmaking system.
 */
const URL_NAME = 'coordinator_url';
const KEY_NAME = 'coordinator_service_role_key';
const A_URL = 'http://127.0.0.1:54321/functions/v1/coordinator';

/**
 * Every case runs inside a transaction that always rolls back, for two
 * separate reasons that happen to share a mechanism:
 *
 *  - Hermeticity. Creating and deleting the Vault entries inside the
 *    transaction lets each case state its own configuration without depending
 *    on how the developer's machine happens to be set up, and without a
 *    per-minute cron tick racing the row counts.
 *  - Nothing is ever actually sent. `net.http_post` only INSERTs into
 *    `net.http_request_queue`; pg_net's background worker reads COMMITTED
 *    rows. A queued row in a rolled-back transaction is the full evidence
 *    that the call was made, and no request leaves the machine.
 *
 * `rollingBack` always throws, so results come back through a closure and the
 * throw is consumed by `refusal`, which asserts the body reached its end
 * rather than dying partway.
 */
async function inRolledBackTx(
  body: (run: (q: string) => Promise<Record<string, unknown>[]>) => Promise<void>,
) {
  const outcome = await refusal(() =>
    rollingBack(async (tx) => {
      await body((q) => tx.unsafe(q) as unknown as Promise<Record<string, unknown>[]>);
    }),
  );
  // Not cosmetic: if the tick RAISED — the original defect — the body would
  // never reach `rollingBack`'s own throw, and this would carry the database's
  // SQLSTATE instead. Asserting the sentinel is how "it did not throw" is
  // measured rather than assumed.
  expect(outcome.code).toBe('SUCCEEDED_THEN_ROLLED_BACK');
}

type Run = (q: string) => Promise<Record<string, unknown>[]>;

const clearBoth = (run: Run) =>
  run(`delete from vault.secrets where name in ('${URL_NAME}', '${KEY_NAME}')`);

const queuedRows = (run: Run) => run(`select url, headers from net.http_request_queue order by id`);

describe('coordinator tick', () => {
  it('is the job pg_cron actually runs, under the one jobname', async () => {
    const rows = await sql<{ command: string; active: boolean; schedule: string }>(
      `select command, active, schedule from cron.job where jobname = 'coordinator-tick'`,
    );
    // Exactly one. `cron.schedule` upserts by jobname, so a second row here
    // would mean a migration had scheduled a rival tick under another name.
    expect(rows).toHaveLength(1);
    expect(rows[0].command.trim()).toBe('select public.coordinator_tick();');
    expect(rows[0].active).toBe(true);
    expect(rows[0].schedule).toBe('* * * * *');
  });

  it('commits no secret: both well-known names are absent until an operator creates them', async () => {
    const rows = await sql(
      `select name from vault.secrets where name in ('${URL_NAME}', '${KEY_NAME}')`,
    );
    expect(rows).toEqual([]);
  });

  it('does nothing, quietly, when neither the key nor the URL is configured', async () => {
    let after: Record<string, unknown>[] = [{ sentinel: true }];
    await inRolledBackTx(async (run) => {
      await clearBoth(run);
      await run(`select public.coordinator_tick()`);
      after = await queuedRows(run);
    });
    expect(after).toEqual([]);
  });

  it('does nothing when the URL is configured but the key is missing', async () => {
    let after: Record<string, unknown>[] = [{ sentinel: true }];
    await inRolledBackTx(async (run) => {
      await clearBoth(run);
      await run(`select vault.create_secret('${A_URL}', '${URL_NAME}', 'rolled back')`);
      await run(`select public.coordinator_tick()`);
      after = await queuedRows(run);
    });
    expect(after).toEqual([]);
  });

  it('does nothing when the key is configured but the URL is missing', async () => {
    let after: Record<string, unknown>[] = [{ sentinel: true }];
    await inRolledBackTx(async (run) => {
      await clearBoth(run);
      await run(`select vault.create_secret('not-a-real-key', '${KEY_NAME}', 'rolled back')`);
      await run(`select public.coordinator_tick()`);
      after = await queuedRows(run);
    });
    expect(after).toEqual([]);
  });

  it('does nothing when a value is present but empty, which is a mistake that looks configured', async () => {
    let after: Record<string, unknown>[] = [{ sentinel: true }];
    await inRolledBackTx(async (run) => {
      await clearBoth(run);
      await run(`select vault.create_secret('${A_URL}', '${URL_NAME}', 'rolled back')`);
      await run(`select vault.create_secret('', '${KEY_NAME}', 'rolled back')`);
      await run(`select public.coordinator_tick()`);
      after = await queuedRows(run);
    });
    expect(after).toEqual([]);
  });

  // The positive control. Without it, every assertion above is satisfied by a
  // function whose body is `return;` — "queues nothing" has to be measured
  // against a configuration that does queue something.
  it('posts to the configured URL, bearing the Vault key, when both are present', async () => {
    let after: Record<string, unknown>[] = [];
    await inRolledBackTx(async (run) => {
      await clearBoth(run);
      await run(`select vault.create_secret('${A_URL}', '${URL_NAME}', 'rolled back')`);
      await run(`select vault.create_secret('not-a-real-key', '${KEY_NAME}', 'rolled back')`);
      await run(`select public.coordinator_tick()`);
      after = await queuedRows(run);
    });
    expect(after).toHaveLength(1);
    expect(after[0].url).toBe(A_URL);
    // The key reaches the header from Vault, decrypted — not the ciphertext,
    // and not a NULL that would have made this `Bearer ` and earned a 401 a
    // minute instead of an exception a minute.
    expect((after[0].headers as Record<string, string>).Authorization).toBe('Bearer not-a-real-key');
  });

  it('is callable by nobody but its owner — not anon, authenticated, or service_role', async () => {
    const rows = await sql<{ has: boolean; grantee: string }>(
      `select r.rolname as grantee,
              has_function_privilege(r.rolname, 'public.coordinator_tick()', 'execute') as has
         from unnest(array['anon','authenticated','service_role']) as r(rolname)`,
    );
    expect(rows.map((r) => [r.grantee, r.has])).toEqual([
      ['anon', false],
      ['authenticated', false],
      ['service_role', false],
    ]);
  });

  // The reason both values are in Vault rather than in `app.*` GUCs, asserted
  // rather than asserted-about. If this ever starts failing, the GUC route has
  // become available and the migration's justification needs revisiting.
  it('cannot be configured by GUC at all: postgres is not superuser and ALTER DATABASE is refused', async () => {
    const [me] = await sql<{ usesuper: boolean }>(
      `select usesuper from pg_user where usename = current_user`,
    );
    expect(me.usesuper).toBe(false);

    const denied = await refusal(() =>
      sql(`alter database postgres set app.coordinator_url = '${A_URL}'`),
    );
    expect(denied.message).toMatch(/permission denied to set parameter "app\.coordinator_url"/);
  });
});
