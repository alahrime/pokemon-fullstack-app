-- The coordinator tick, guarded, reading its configuration from Vault.
--
-- WHAT WAS WRONG. 20260903030000 scheduled a per-minute job whose body was a
-- bare `net.http_post(url := current_setting('app.coordinator_url', true), …)`.
-- `current_setting(…, true)` returns NULL for an unset GUC, and
-- `net.http_request_queue.url` is NOT NULL — so on any deployment where those
-- settings were never applied, the job did not degrade, it RAISED, every
-- minute, forever. Measured on the local stack before this migration:
--
--   status | count      runid | status |            return_message
--   -------+-------     ------+--------+---------------------------------------
--   failed |    91         91 | failed | ERROR: null value in column "url" of
--                                        relation "http_request_queue" violates
--                                        not-null constraint
--
-- Ninety-one runs, zero successes, zero rows ever in net.http_request_queue.
-- Nothing was verified, nothing paired, and the only evidence sat in
-- cron.job_run_details where nobody was looking. That is the defect this
-- migration fixes: not "the key is in the wrong place", but "an unconfigured
-- deployment errors instead of doing nothing".
--
-- AND THE SETTINGS COULD NOT HAVE BEEN APPLIED ANYWAY. 20260903030000's own
-- comment told the operator to run `alter database postgres set
-- app.coordinator_url = '…'`. On this stack that command is refused, measured:
--
--   postgres=> select current_user, usesuper from pg_user where usename = current_user;
--    current_user | usesuper
--    postgres     | f
--   postgres=> alter database postgres set app.coordinator_url = 'http://…';
--   ERROR:  permission denied to set parameter "app.coordinator_url"
--
-- `postgres` is not a superuser here — the local stack mirrors hosted Supabase
-- in that, where `supabase_admin` is the only superuser and no customer role
-- is one. Postgres 15+ refuses `ALTER DATABASE/ROLE … SET` on an unrecognised
-- placeholder GUC to non-superusers, and `GRANT SET ON PARAMETER` cannot be
-- granted for a placeholder either. So the documented remedy was not merely
-- forgotten in production: no role the operator holds could have carried it
-- out. That is why BOTH values move to Vault below, and it is the whole of the
-- answer to "where should the URL live".
--
-- Do NOT edit 20260903030000 to fix this. It is already applied on any stack
-- that has run a reset. `cron.schedule` upserts by jobname, so re-scheduling
-- 'coordinator-tick' here REPLACES the old job (same jobid) rather than adding
-- a second one.
--
-- THIS MIGRATION CREATES NO SECRET AND CONTAINS NO KEY AND NO URL. It reads
-- two entries by well-known names. The operator creates them, once per
-- environment, with exactly this — and matchmaking does nothing at all until
-- they do (see docs/superpowers/HANDOFF.md, "Deploying M2a"):
--
--   select vault.create_secret(
--     '<the project service-role key>',
--     'coordinator_service_role_key',
--     'Bearer token the per-minute coordinator-tick cron job sends to the coordinator Edge Function'
--   );
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/coordinator',
--     'coordinator_url',
--     'Target of the per-minute coordinator-tick cron job'
--   );
--
-- To change either later, do NOT call create_secret again — `name` carries a
-- unique index and the second call raises. Use:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'coordinator_service_role_key'),
--     '<the new value>'
--   );
--
-- The URL is not a secret and is not being treated as one for secrecy's sake;
-- it is in Vault because Vault is the only per-environment key/value store on
-- this database that the `postgres` role can actually write, as measured
-- above. It stays readable to anyone debugging a silent coordinator —
-- `select decrypted_secret from vault.decrypted_secrets where name = 'coordinator_url';`
-- — which is deliberate, and is a thing that must never be done to the key.
-- A missing URL takes the same quiet path as a missing key, below: never
-- again a NOT NULL violation.

-- Named function rather than an inline `do` block in the cron command: the
-- body is then greppable, unit-testable without waiting for a tick, and
-- diffable in review. SECURITY INVOKER (the default) on purpose — this must
-- NOT be a definer function. A definer owned by postgres would let any role
-- holding EXECUTE reach the key's blast radius without holding vault
-- privileges of its own; as an invoker function, only a role that could
-- already read vault.decrypted_secrets can make it do anything. The cron job
-- runs as `postgres`, which holds exactly that.
create or replace function public.coordinator_tick() returns void
language plpgsql
-- Everything below is schema-qualified; the pin is here so a search_path set
-- by a caller cannot decide which `decrypted_secrets` or `http_post` is meant.
set search_path = public
as $fn$
declare
  v_url text;
  v_key text;
begin
  -- `nullif(…, '')` on both: an empty string is a configuration mistake that
  -- looks like configuration. An empty URL would reach pg_net and fail; an
  -- empty key would send `Bearer ` and earn a 401 every minute. Both are
  -- "unconfigured", and both take the quiet path.
  select nullif(s.decrypted_secret, '') into v_url
    from vault.decrypted_secrets s where s.name = 'coordinator_url';

  select nullif(s.decrypted_secret, '') into v_key
    from vault.decrypted_secrets s where s.name = 'coordinator_service_role_key';

  if v_url is null or v_key is null then
    -- A NOTICE, not an EXCEPTION. This is the whole point of the migration.
    -- An unconfigured deployment gets a job that runs, does nothing, and is
    -- recorded 'succeeded' — not one that raises 1,440 times a day for a
    -- year. The notice lands in the Postgres log for whoever goes looking,
    -- and names both halves so the log says which one is missing. It names
    -- them; it never prints them.
    raise notice 'coordinator-tick: not configured (vault secret coordinator_url %, coordinator_service_role_key %) - skipping',
      case when v_url is null then 'missing' else 'present' end,
      case when v_key is null then 'missing' else 'present' end;
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    )
  );
end;
$fn$;

-- `public` is an API-exposed schema and this project takes the cloud default
-- of auto-granting new functions to the Data API roles, so the revoke is not
-- belt-and-braces, it is the actual gate. Nobody but the owner calls this:
-- service_role included — the coordinator is the callee here, not a caller,
-- and an anon-triggerable tick is a free way to make the database issue
-- authenticated requests on demand.
revoke all on function public.coordinator_tick() from public, anon, authenticated, service_role;

comment on function public.coordinator_tick() is
  'Body of the per-minute coordinator-tick cron job. Reads its target and its service-role '
  'bearer token from vault.decrypted_secrets (names: coordinator_url, '
  'coordinator_service_role_key). A no-op, not an error, when either is absent.';

-- Upserts by jobname over the job 20260903030000 created.
select cron.schedule(
  'coordinator-tick',
  '* * * * *',
  $job$select public.coordinator_tick();$job$
);
