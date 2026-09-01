# Task 3 report: the harness, and default-deny as an assertion

## What the harness does

`supabase/tests/helpers.ts` connects once to the local stack's database
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres` — the fixed,
non-secret default every `supabase start` produces) using the `postgres`
npm package (`postgres@3.4.9`, added as a devDependency only — `dependencies`
in `app/package.json` is untouched).

Three exports:

- **`sql(query)`** — runs a query as the `postgres` superuser, the role
  migrations run as. `postgres` owns every table in `public`, so it bypasses
  RLS entirely. Used directly by `rls.test.ts` (catalog-only queries) and as
  the "ground truth" side of the denied-vs-allowed comparison below.
- **`asUser(claims)`** — returns an async query function. Each call opens its
  own `client.begin()` transaction, runs `set local role authenticated`, then
  `select set_config('request.jwt.claims', $1, true)` with the claims JSON
  bound as a query **parameter** (not string-interpolated) so a claim value
  containing a quote can't escape the literal, then runs the caller's query.
  Because `set local` and `set_config(..., true)` are transaction-scoped,
  impersonation from one call can never leak into the next.
- **`asAnon()`** — same shape, but only `set local role anon`, no claims GUC
  at all. Deliberately not `asUser({role:'anon'})`: a real anonymous
  PostgREST request never has `request.jwt.claims` set, and `auth.uid()`
  resolving to null via a *missing* setting is different from resolving to
  null via an *empty* claims object — a future policy could distinguish them,
  so the harness does too.

## The `auth.uid()` definition I actually read

Ran directly against the running container (`supabase_db_paragon-iv`):

```
$ docker exec -i supabase_db_paragon-iv psql -U postgres -d postgres -c "\sf auth.uid"

CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
```

It reads `request.jwt.claims` as jsonb and pulls `->> 'sub'` (falling back
from a flattened `request.jwt.claim.sub` GUC that PostgREST also sets but
that the harness doesn't need to set, since the fallback covers it). This
matches the brief's description exactly: setting
`request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'` is read the
same way a real PostgREST request's JWT would be. I also read `auth.role()`
for the same reason — same shape, reads `request.jwt.claims ->> 'role'`.

One deliberate deviation from the brief's literal `set local
request.jwt.claims = '...'` syntax: the harness uses
`select set_config('request.jwt.claims', $1, true)` instead. I verified by
hand that these are equivalent (`is_local := true` is exactly what `set
local` does), and using `set_config` as a normal function call lets the
claims JSON be passed as a bound parameter instead of string-interpolated
into SQL text — safer, and it's what a `SET` statement (a utility statement)
cannot do since utility statements don't accept bind parameters. Confirmed
side-by-side in psql:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select auth.uid() as uid_seen, auth.role() as role_seen;
rollback;
```
```
               uid_seen               |   role_seen
--------------------------------------+---------------
 22222222-2222-2222-2222-222222222222 | authenticated
```

## Evidence that impersonation genuinely changes what a query can see

First proved at the psql level, directly against the container, inside one
transaction so the comparison is apples-to-apples (`public.profiles` has RLS
enabled, zero policies, at this point in the milestone):

```sql
begin;
insert into auth.users (id, email) values ('1111...1111', 'harness-test@example.com');
insert into public.profiles (id, display_name, go_username, tos_accepted_at, birth_date)
values ('1111...1111', 'HarnessTest2', 'HarnessTest2', now(), '2000-01-01');

select 'as postgres' as who, count(*) as n from public.profiles;
-- as postgres | n=1   (superuser/owner bypasses RLS)

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1111...1111","role":"authenticated"}', true);

select 'as authenticated (impersonated)' as who, count(*) as n from public.profiles;
-- as authenticated (impersonated) | n=0   (RLS on, zero policies -> deny-all)

select auth.uid();
-- 1111...1111   (the claim really reached the policy layer)
rollback;
```

**postgres saw the row (n=1); the impersonated `authenticated` user, in the
same transaction, against the same row, saw nothing (n=0).** Not both denied,
not both allowed — the split the brief asked for.

Then re-proved using the *actual harness code* (`sql`, `asUser`, `asAnon`
from `helpers.ts`), via a throwaway test file (`supabase/tests/
_verify_harness.test.ts`, deleted before commit — not part of the shipped
diff):

- Inserted a fixture user via `sql()` (superuser).
- `sql()` (superuser) counted it: 1.
- `asUser({sub, role:'authenticated'})` counted it: 0.
- `asAnon()` counted it: 0.
- `asUser(...)` querying `select auth.uid()::text` returned exactly the
  `sub` passed in, proving the claim reached the policy layer through the
  harness's own code path, not just raw psql.
- Cleanup via explicit `DELETE`, verified gone in a second test.

**A real finding from building that throwaway verifier, worth flagging:** my
first attempt wrapped the fixture insert/select/cleanup in raw
`sql('begin')` ... `sql('rollback')` text sent over the *same shared
single connection* that `asUser`'s internal `client.begin()` also uses.
Postgres warned `there is already a transaction in progress` and later
`there is no transaction in progress` — the nested `client.begin()` call
committed the outer transaction as a side effect of resolving normally, so my
"rollback" rolled back nothing and the fixture rows were committed for real
into the local dev database. I caught this by checking the database directly
after the run (`select * from public.profiles where id = '3333...'` — the
row was there), cleaned it up by hand, and rewrote the verifier to use
explicit `INSERT`/`DELETE` instead of relying on rollback for isolation. I
added a comment to that effect in the throwaway file while it existed. This
is now documented as a footgun in `helpers.ts`'s `asAnon` doc comment context
and above in this report so Task 4 doesn't repeat it: **never mix raw
`begin`/`rollback` text with `asUser`/`asAnon` on the shared connection** —
build fixtures with plain autocommitting statements and clean up explicitly.

## TDD evidence

**RED** — before `helpers.ts` and `vitest.db.config.ts` existed:

```
$ npm run check:db
...
✘ [ERROR] Could not resolve "/Users/alilahrime/Downloads/paragon-iv/app/vitest.db.config.ts"
failed to load config from .../vitest.db.config.ts
EXIT=1
```

**GREEN** — after the harness and config were added:

```
$ npm run check:db
...
 ✓ ../supabase/tests/rls.test.ts (2 tests) 15ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
EXIT=0
```

Also confirmed the default suite is unaffected (db tests don't leak into
`npm run test`'s include globs):

```
$ npx vitest run --config vitest.config.ts
 Test Files  70 passed (70)
      Tests  973 passed (973)
```

## Stack state

```
$ npm run db:stop
{"project_id_filter":"paragon-iv","backup":true,"message":"Stopped supabase local development setup."}
$ docker ps --format '{{.Names}}'
(empty)
```

Confirmed stopped, no containers running.

## Files changed

- `supabase/tests/rls.test.ts` (new) — the two assertions from the brief,
  verbatim, with the second commented as **temporary**, deleted by Task 4.
- `supabase/tests/helpers.ts` (new) — `sql`, `asUser`, `asAnon`.
- `app/vitest.db.config.ts` (new) — `node` environment,
  `include: ['../supabase/tests/**/*.test.ts']`, kept out of the default
  `vitest.config.ts` globs.
- `app/package.json` — added `postgres: ^3.4.9` to `devDependencies` only.
- `app/package-lock.json` — corresponding lockfile update.

## Self-review findings

- The transaction-nesting footgun above was found by building and then
  distrusting my own throwaway verification — worth Task 4 knowing about
  even though it never touched the shipped code.
- `sql()`'s generic type parameter is a caller-asserted shape (`postgres`
  returns rows as plain objects at runtime with no schema validation) — same
  as any raw-SQL driver; not a gap specific to this harness.
- I deviated from the brief's literal `set local request.jwt.claims = '...'`
  syntax in favor of `set_config(..., true)` with a bound parameter. I
  verified they are equivalent (shown above) before relying on it; flagging
  the deviation explicitly since the brief was specific about the syntax to
  verify.
- Did not add a `.gitignore` entry or anything for `supabase/.temp` /
  `supabase/.branches` — pre-existing, untouched, not part of this task.

## Concerns

- None that block Task 4. The harness's `asUser`/`asAnon` are proven to work
  against real RLS-on-zero-policies tables using the real trigger/table setup
  Task 2 shipped, not a toy schema.
