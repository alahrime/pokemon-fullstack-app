# The coordinator's service-role key moves to Vault — and the tick stops raising

**Date:** 2026-09-04. **Branch:** `feat/m2a-matchmaking`.
**Migration:** `supabase/migrations/20260904174517_coordinator_tick_reads_vault_and_no_ops_unconfigured.sql`
**Tests:** `supabase/tests/coordinator-tick.test.ts` (9 cases, new)
**Docs:** `docs/superpowers/HANDOFF.md` — new section "Deploying M2a", plus two `Still outstanding` items.

---

## 1. What was actually wrong

`20260903030000_coordinator_schedule.sql` scheduled a per-minute job whose body was a bare
`net.http_post(url := current_setting('app.coordinator_url', true), …)`. `current_setting(…, true)`
returns NULL for an unset GUC and `net.http_request_queue.url` is NOT NULL, so on a deployment
where those settings were never applied the job **raised, every minute, forever**. Measured on the
local stack before any change (verbatim):

```
=== counts ===
 status | count
--------+-------
 failed |    91
(1 row)

=== net ===
 queue | responses
-------+-----------
     0 |         0
```

Ninety-one runs, zero successes, zero rows ever queued or answered.

### A second defect, found while trying to follow the old migration's own instructions

`20260903030000` told the operator to run `alter database postgres set app.coordinator_url = '…'`.
I tried it. It is refused (verbatim):

```
 current_user | usesuper
--------------+----------
 postgres     | f
(1 row)

=== try as postgres explicitly ===
ERROR:  permission denied to set parameter "app.coordinator_url"
EXIT=1
=== try alter role ===
ERROR:  permission denied to set parameter "app.coordinator_url"
EXIT=1
=== who is superuser ===
          usename           | usesuper
----------------------------+----------
 authenticator              | f
 pgbouncer                  | f
 postgres                   | f
 supabase_admin             | t
 ...
```

`postgres` is not a superuser on this stack — the local stack mirrors hosted Supabase in that, where
`supabase_admin` is the only superuser and no customer role is one — and Postgres 15+ refuses
`ALTER DATABASE/ROLE … SET` on an unrecognised *placeholder* GUC to non-superusers.
`GRANT SET ON PARAMETER` cannot be granted for a placeholder either. So the documented remedy was
not merely forgotten in production: **no role the operator holds could have carried it out.**
This measurement is what decides §4 below.

---

## 2. The migration

New file, `20260904174517_coordinator_tick_reads_vault_and_no_ops_unconfigured.sql`.
`20260903030000` is untouched — it is already applied everywhere, and `cron.schedule` upserts by
jobname, so re-scheduling `coordinator-tick` **replaces** the old job on the same `jobid` rather
than adding a rival. Confirmed after the change: `jobid | 1 | coordinator-tick | … | select public.coordinator_tick();`, one row.

The body:

```sql
create or replace function public.coordinator_tick() returns void
language plpgsql
set search_path = public
as $fn$
declare
  v_url text;
  v_key text;
begin
  select nullif(s.decrypted_secret, '') into v_url
    from vault.decrypted_secrets s where s.name = 'coordinator_url';

  select nullif(s.decrypted_secret, '') into v_key
    from vault.decrypted_secrets s where s.name = 'coordinator_service_role_key';

  if v_url is null or v_key is null then
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

revoke all on function public.coordinator_tick() from public, anon, authenticated, service_role;

select cron.schedule('coordinator-tick', '* * * * *', $job$select public.coordinator_tick();$job$);
```

Design points, each with a reason:

- **A named function, not an inline `do` block** in the cron command: greppable, testable without
  waiting sixty seconds for a tick, and diffable in review.
- **SECURITY INVOKER (the default), deliberately not DEFINER.** A definer owned by `postgres` would
  let any role holding EXECUTE reach the key's blast radius without holding vault privileges of its
  own. As an invoker function only a role that can already read `vault.decrypted_secrets` can make
  it do anything; the cron job runs as `postgres`, which can.
- **`revoke all … from public, anon, authenticated, service_role`** is the actual gate, not
  belt-and-braces: `public` is an API-exposed schema and this project takes the cloud default of
  auto-granting new functions to the Data API roles. `service_role` is revoked too — the
  coordinator is the callee here, not a caller, and an anon-triggerable tick is a free way to make
  the database issue authenticated requests on demand. Asserted in the suite.
- **`nullif(…, '')` on both values.** An empty string is a configuration mistake that looks like
  configuration; an empty key would send `Bearer ` and earn a 401 a minute. Both count as
  unconfigured.
- **A `notice`, not an exception.** It names which half is missing; it never prints either value.

### Signatures, verified against the local database rather than assumed

```
          proname          |                          args                            | result
---------------------------+----------------------------------------------------------+--------
 create_secret             | new_secret text, new_name text, new_description text,    | uuid
                           | new_key_id uuid
 update_secret             | secret_id uuid, new_secret text, new_name text, …        | void
```

`vault.decrypted_secrets` is a **view** (`relkind = v`) with columns
`id, name, description, secret, decrypted_secret, key_id, nonce, created_at, updated_at`.
`postgres` holds `SELECT` on it and `EXECUTE` on `vault.create_secret`. `vault.secrets` carries
`CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE (name IS NOT NULL)` — which is
why the operator instructions say to rotate with `update_secret`, not a second `create_secret`.

---

## 3. No secret is committed

The migration contains no key and no URL. It reads two entries by well-known name. The exact
operator command is in the migration's own header comment and in `HANDOFF.md`:

```sql
select vault.create_secret(
  '<the project service-role key>',
  'coordinator_service_role_key',
  'Bearer token the per-minute coordinator-tick cron job sends to the coordinator Edge Function'
);

select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/coordinator',
  'coordinator_url',
  'Target of the per-minute coordinator-tick cron job'
);
```

Rotation:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'coordinator_service_role_key'),
  '<the new value>'
);
```

A test asserts that a freshly migrated database holds **neither** name, so a future migration that
quietly seeds one would fail the gate.

---

## 4. Where the URL lives, and why

**Both values are in Vault.** I started with the URL in the `app.coordinator_url` GUC and the
argument written out — a project URL is not a secret, encrypting it buys no protection, and keeping
it in `pg_settings` means an operator debugging a silent coordinator can just `show` it. Then I
tried to set it and got `ERROR: permission denied to set parameter "app.coordinator_url"` (§1).

That measurement retires the argument. The choice was never "Vault vs GUC on the merits"; on this
platform there is no GUC option at all for a role the operator holds. Vault is the only
per-environment key/value store on this database that `postgres` can write. Two entries, one
mechanism, one documented command, one failure mode.

The reasoning that survives is about *treatment*, not storage: `coordinator_url` stays freely
readable —
`select decrypted_secret from vault.decrypted_secrets where name = 'coordinator_url';` is the
supported way to check it — and that is a thing which must never be done to the key. Storing the
URL in Vault does not make it a secret; it makes it configurable.

A test pins the reason so it cannot rot silently: it asserts `usesuper = f` and that
`alter database postgres set app.coordinator_url = …` is refused. If that ever starts passing, the
GUC route has become available and this decision deserves revisiting.

---

## 5. Measurement — the unconfigured half

After `npm run db:reset` (whole chain applied from scratch, `EXIT=0`), with an empty Vault. First,
the two bodies run by hand, side by side, in the same unconfigured database — verbatim:

```
### state after reset: job, no secrets, no runs
 jobid |     jobname      | schedule  | username | active |              command
-------+------------------+-----------+----------+--------+-----------------------------------
     1 | coordinator-tick | * * * * * | postgres | t      | select public.coordinator_tick();
(1 row)

 vault_secrets
---------------
             0
(1 row)

 runs
------
 0
(1 row)


### A. the OLD body (20260903030000), run by hand, unconfigured:
ERROR:  null value in column "url" of relation "http_request_queue" violates not-null constraint
DETAIL:  Failing row contains (1, POST, null, {"Content-Type": "application/json", "Authorization": null}, \x7b7d, 5000).
CONTEXT:  SQL statement "insert into net.http_request_queue(method, url, headers, body, timeout_milliseconds)
    values (
        'POST',
        net._encode_url_with_params_array(url, params_array),
        headers,
        convert_to(body::text, 'UTF8'),
        timeout_milliseconds
    )
    returning id"
PL/pgSQL function http_post(text,jsonb,jsonb,jsonb,integer) line 37 at SQL statement
EXIT=1

### B. the NEW body, run by hand, unconfigured:
 coordinator_tick
------------------

(1 row)

NOTICE:  coordinator-tick: not configured (vault secret coordinator_url missing, coordinator_service_role_key missing) - skipping
EXIT=0

### net.http_request_queue after both:
 count
-------
     0
```

Same database, same second, same missing configuration: the old body raises, the new one returns
and queues nothing.

Then the **scheduled** job, left to fire on its own — verbatim:

```
Fri Sep  4 17:52:29 UTC 2026
 runid | jobid |  status   | return_message |          start_time           |           end_time
-------+-------+-----------+----------------+-------------------------------+-------------------------------
     1 |     1 | succeeded | 1 row          | 2026-09-04 17:52:00.016852+00 | 2026-09-04 17:52:00.019751+00
(1 row)

 http_request_queue | http_responses
--------------------+----------------
                  0 |              0
```

`succeeded`, in 3 ms, with **no row added to `net.http_request_queue`** — against the 91 `failed`
rows the same job accrued before this migration. The notice reaches the Postgres log:

```
NOTICE:  coordinator-tick: not configured (vault secret coordinator_url missing, coordinator_service_role_key missing) - skipping
```

Requirement 3 met: an unconfigured deployment now produces a job that runs and quietly does nothing.

---

## 6. Measurement — the configured half

`supabase functions serve` started (edge runtime up on
`http://127.0.0.1:54321/functions/v1/coordinator`, `supabase-edge-runtime-1.74.3`). Both secrets
created with `vault.create_secret(...)`, the key being the local stack's own service-role value
printed by `supabase status` — a well-known local development value, not a real credential, and it
appears nowhere in this repository:

```
service-role key length: 164  (local dev value, from supabase status)
            key_secret_id
--------------------------------------
 4df03e2d-f45c-4bbd-b5d6-2a3f6c2eeac2
            url_secret_id
--------------------------------------
 9640cea1-7e9f-4153-be39-c666ae353806

             name             |       value_preview
------------------------------+----------------------------
 coordinator_service_role_key | eyJhbGciOiJI...(164 chars)
 coordinator_url              | http://host....(58 chars)
```

(The URL is `http://host.docker.internal:54321/functions/v1/coordinator` — pg_net runs *inside* the
database container, so `127.0.0.1` there is the database, not Kong.)

The very next tick, verbatim:

```
 runid |  status   | return_message |          start_time
-------+-----------+----------------+-------------------------------
     1 | succeeded | 1 row          | 2026-09-04 17:52:00.016852+00
     2 | succeeded | 1 row          | 2026-09-04 17:53:00.014781+00

 id | status_code |   content_type   | timed_out |               content
----+-------------+------------------+-----------+-------------------------------------
  3 |         200 | application/json | f         | {"verified":0,"paired":0,"swept":0}
```

HTTP **200**, `{"verified":0,"paired":0,"swept":0}`. The Edge Function log confirms the request
arrived and the bearer token was accepted rather than something else answering:

```
Legacy token type detected, attempting HS256 verification.
serving the request with supabase/functions/coordinator
```

An all-zeros body is a weak proof that the handler *did* anything, so I seeded one already-verified,
already-expired `queue_entries` row (with its user, format and format version) and let the next tick
run:

```
 runid |  status   | return_message |          start_time
-------+-----------+----------------+-------------------------------
     3 | succeeded | 1 row          | 2026-09-04 17:54:00.00902+00

 id | status_code |   content_type   | timed_out |               content
----+-------------+------------------+-----------+-------------------------------------
  3 |         200 | application/json | f         | {"verified":0,"paired":0,"swept":0}
  4 |         200 | application/json | f         | {"verified":0,"paired":0,"swept":1}

=== queue_entries left ===
 count
-------
     0
```

`"swept":1`, and the row is gone. That is the whole chain measured end to end: cron → Vault →
`net.http_post` → Kong → Edge Function → JWT verified → `sweep_expired()` over PostgREST as
`service_role` → a row deleted in `public`. Requirement 1 met.

(`net._http_response` ids start at 3 because the failed old-body call in §5 and the suite's
rolled-back positive-control both consumed sequence values. Nothing was sent by either.)

### The local database was returned to the unconfigured state

Verbatim, after stopping the function server (`killed functions serve` / `edge container gone`):

```
DELETE 2
DELETE 1
 vault_secrets_remaining
-------------------------
                       0
 queue_entries
---------------
             0
 profiles_left
---------------
             0
NOTICE:  coordinator-tick: not configured (vault secret coordinator_url missing, coordinator_service_role_key missing) - skipping
 coordinator_tick
------------------

(1 row)
EXIT=0
```

Nothing of mine lingers: no secrets, no fixture user, no running server, and the tick is back to a
quiet no-op.

---

## 7. Regression tests

`supabase/tests/coordinator-tick.test.ts`, 9 cases, in the `check:db` suite. Every configuration
case runs inside a transaction that always rolls back, for two reasons that share a mechanism:
it makes each case hermetic against however the developer's machine is configured and against the
per-minute cron job racing the row counts; and **nothing is ever actually sent**, because
`net.http_post` only INSERTs into `net.http_request_queue` and pg_net's worker reads *committed*
rows. A queued row in a rolled-back transaction is full evidence the call was made, with no request
leaving the machine.

- the scheduled job is exactly one row, active, `* * * * *`, running `select public.coordinator_tick();`
- a freshly migrated database holds neither well-known secret name
- no key and no URL → no queued row
- URL only → no queued row
- key only → no queued row
- an **empty-string** value → no queued row
- **positive control**: both present → exactly one queued row, the right URL, `Authorization: Bearer <the decrypted key>`. Without this, every case above is satisfied by a function whose body is `return;`
- `anon`, `authenticated` and `service_role` all have `has_function_privilege(...) = false`
- `usesuper = f` and `alter database … set app.coordinator_url` is refused — the §4 decision, pinned

The "does not throw" assertions are measured, not assumed: `rollingBack` always throws, and the
helper asserts the sentinel `SUCCEEDED_THEN_ROLLED_BACK` code. If the tick raised — the original
defect — the body would never reach that throw and the case would fail carrying the database's
SQLSTATE instead.

---

## 8. Gates

Both run as instructed — redirected, exit code echoed separately, log read. No `cmd | tail`.

```
cd app && npm run check > /tmp/vault-gate.log 2>&1; echo "EXIT=$?"     ->  EXIT=0
cd app && npm run check:db > /tmp/vault-db.log 2>&1; echo "EXIT=$?"    ->  EXIT=0
```

`npm run check` (Docker-free), tail of `/tmp/vault-gate.log`:

```
 Test Files  81 passed (81)
      Tests  1162 passed (1162)
   Start at  13:54:31
   Duration  37.53s
```

`npm run check:db` (against the local stack), tail of `/tmp/vault-db.log`:

```
 ✓ ../supabase/tests/coordinator-tick.test.ts (9 tests) 70ms
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 116ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 186ms
 ✓ ../supabase/tests/queue.test.ts (11 tests) 188ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 202ms
 ✓ ../supabase/tests/teams.test.ts (23 tests) 247ms
 ✓ ../supabase/tests/offers.test.ts (21 tests) 332ms
 ✓ ../supabase/tests/pairing.test.ts (26 tests) 1005ms

 Test Files  8 passed (8)
      Tests  139 passed (139)
```

139 database tests, up from the 130 that existed before — the 9 new ones are this migration's.
Neither log contains a `FAIL`, a `✗`, or a TypeScript error (grepped, not eyeballed).

---

## 9. What I could not prove, and what I would watch

- **Nothing was measured against the production project.** Every result here is from the local
  stack. In particular the `permission denied to set parameter` finding is a *local* measurement;
  hosted `postgres` is likewise non-superuser, so I expect the same refusal there, but I did not and
  could not run it against production. If it turns out hosted allows the GUC, the Vault decision is
  still correct — it just loses its strongest argument.
- **The configured half used `http://host.docker.internal:54321`, not an `https://…supabase.co`
  URL.** TLS, Kong's hosted routing, and the hosted function's cold start are untested by this. The
  first production tick is the real test, which is why `HANDOFF.md` gives the two verification
  queries to run right after the secrets are created.
- **`cron.job_run_details` is still never purged.** This migration changes those ~1,440 rows/day
  from `failed` to `succeeded`; it does not stop them accruing. Logged as an outstanding item in
  `HANDOFF.md` rather than fixed here — a second cron job pruning old rows is the usual answer and
  is its own decision.
- **The quiet failure mode is a real cost, accepted deliberately.** A misconfigured production
  deployment is now indistinguishable from an idle one *from inside the app*. The only evidence is a
  Postgres `NOTICE` and an empty `net._http_response`. That trade is why the `HANDOFF.md` section
  spells the symptom out; a monitoring alarm on "zero `net._http_response` rows in the last hour"
  would close it properly, and is not in this change.
- **`verify_jwt` was on for the local `functions serve` run**, so the 200 also proves the token was
  accepted. I did not test what happens when the key is *wrong* (a rotated-but-not-updated secret):
  the expected shape is a 401 recorded in `net._http_response` with the cron run still `succeeded`,
  which is again silent. Same mitigation as above.
