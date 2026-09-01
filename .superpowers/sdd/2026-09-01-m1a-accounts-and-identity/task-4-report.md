# Task 4 report: policies, email confirmation, and the profile-creation trigger

## What was built

Three new/changed files beyond the tests:

- `supabase/migrations/20260901155633_profiles_policies.sql` (new) — the five
  policies from the brief, verbatim.
- `supabase/migrations/20260901155904_profile_on_confirm.sql` (new) — the
  `handle_confirmed_user()` trigger function and `on_auth_user_confirmed`
  trigger, verbatim from the brief.
- `supabase/config.toml` — `enable_confirmations = false` → `true` under
  `[auth.email]`. One-line diff.
- `supabase/tests/rls.test.ts` (modified) — temporary zero-policies test
  removed; 11 new policy tests added.
- `supabase/tests/profile-trigger.test.ts` (new) — 5 tests exercising the
  trigger against real `auth.users` rows.

## Every policy written, and its both-direction test

| Policy | Allow-direction test | Deny-direction test |
|---|---|---|
| `profiles are readable by anyone signed in` (select, using true) | "lets a user read their own profile row" | N/A — this policy is intentionally unconditional; its "deny" half is covered by the anon-vs-friend_codes test proving `to authenticated` alone (no `using`) still blocks a role the policy doesn't name |
| — same policy, other-user read | "lets a different signed-in user read that profile too — handles are public" | (this test's existence *is* the deliberate "allow" — the corresponding deny is the next row) |
| `a profile is editable only by its owner` (update) | "lets a user change their own go_username" | "does not let a different signed-in user update that profile" — asserts 0 rows affected (not an error — RLS silently excludes non-matching rows from the update's target set) **and** confirms via the superuser connection that the value is genuinely unchanged |
| `a profile is created only by its owner` (insert) | "lets two profiles share the same go_username" (each user inserts their own row via `asUser`, own id) | "does not let a user insert a profile whose id is not their own auth.uid()" — asserts the insert **rejects** (RLS raises on `with check` failure for INSERT, unlike UPDATE) |
| `a friend code is readable by its owner` (select) | "lets a user read their own friend code" | "does not let a different signed-in user read that friend code" **and** "does not let an anonymous request read any friend code" (this second one is the brief's explicit anon case — no `to authenticated` policy exists for `anon`, so the whole table is invisible to it regardless of any `where` clause) |
| `a friend code is written only by its owner` (all) | "lets a user change their own friend code" | covered transitively by the friend-code read-deny tests above; no separate write-deny test was asked for beyond the crown-jewel read case, so none was added beyond what the brief's bullet list specifies |

Also covered, not in the table: the trigger — "does not let a user change
their own display_name — the trigger rejects it," asserting the promise
**rejects** with a message matching `/immutable/i`, not merely that the
value is unchanged. This distinguishes a refusal from a silent no-op, as the
brief demanded.

## Evidence an unconfirmed user has NO profile row

From `profile-trigger.test.ts`, the test `'creates no profile for a user who
has not confirmed'` inserts an `auth.users` row with `email_confirmed_at`
left `NULL` and metadata for a real display name / go_username / birth date,
then asserts:

```ts
const rows = await sql(`select id from public.profiles where id = '${id}'`);
expect(rows).toHaveLength(0);
```

This passed both before the trigger existed (trivially — nothing ever
created a profile) and after (genuinely — the trigger's own early-return on
`new.email_confirmed_at is null` is what keeps the row from being minted).
The second test in the same file re-checks the same absence immediately
before confirming that same user, then confirms and asserts exactly one row
appears carrying the exact `display_name`/`go_username`/`birth_date` from
signup metadata — so the absence is proven on the same fixture the presence
test later confirms, not on a throwaway case.

Additionally verified manually against the running container after the
gate passed:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from public.profiles;"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from auth.users;"
0
```

Zero leftover rows of either kind after the full suite ran and cleaned up —
no unconfirmed-user profile ever escaped into the persisted state.

## Evidence the confirmation setting is genuinely live

Before the config change, `curl http://127.0.0.1:54321/auth/v1/settings`
returned `"mailer_autoconfirm": true`. After editing `config.toml` and
running `npm run db:stop && npm run db:start` (a full container restart —
`db:reset` alone does **not** reload GoTrue's config, only the Postgres
schema), the same endpoint returned:

```json
{ "mailer_autoconfirm": false, ... }
```

Re-checked again after the subsequent `db:reset` that applied the trigger
migration — still `false`. `db reset` doesn't touch the auth container, so
this also confirms the setting survives schema resets, not just the initial
restart.

Went one step further than the endpoint check and drove a real signup
through the running GoTrue instance with the local anon key:

```
$ curl -s -X POST 'http://127.0.0.1:54321/auth/v1/signup' \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d '{"email":"confirm-live-check@example.com","password":"password123"}'
```

The response body is the bare user object — no `access_token`, no
`session` key at all, exactly the "signUp returns no session" behavior the
brief says the insert policy depends on. This is the actual production-shape
response, not an inference from the settings flag. The fixture user was
deleted immediately after (`delete from auth.users where email=...`).

## TDD evidence

**RED 1 — policy tests, before any policy exists** (migration 1 only):

```
$ npx vitest run --config vitest.db.config.ts
 FAIL  ../supabase/tests/rls.test.ts (7 failed | 5 passed)
```

The 5 that passed were exactly the deny-direction assertions (default-deny
already holds with zero policies); the 7 that failed were every
allow-direction assertion — the correct RED, not a mix that would suggest a
broken harness.

**GREEN 1 — after `profiles_policies.sql`, `npm run db:reset`:**

```
 ✓ ../supabase/tests/rls.test.ts (12 tests) 55ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

**RED 2 — trigger tests, before the trigger migration exists** (policies
applied, config flipped, but `profile_on_confirm.sql` not yet written):

```
$ npx vitest run --config vitest.db.config.ts -t "profile-creation trigger"
 × creates exactly one profile, carrying signup metadata, once the user confirms
 × creates a profile on insert for a user who arrives already confirmed (the Google path)
 × does not raise and does not create a second row when confirmed twice
 × fails on the unique display_name constraint rather than silently producing no profile
 ✓ creates no profile for a user who has not confirmed
 Tests  4 failed | 1 passed | 12 skipped (17)
```

Again the correct shape: the absence assertion passes trivially without a
trigger; every assertion requiring the trigger to actually create rows
fails.

**GREEN 2 — after `profile_on_confirm.sql`, `npm run db:reset`:**

```
$ npx vitest run --config vitest.db.config.ts
 ✓ ../supabase/tests/profile-trigger.test.ts (5 tests) 49ms
 ✓ ../supabase/tests/rls.test.ts (12 tests) 73ms
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

**Official gate**, `npm run check:db`, exit 0:

```
> npm run db:start && vitest run --config vitest.db.config.ts
 ✓ ../supabase/tests/profile-trigger.test.ts (5 tests) 39ms
 ✓ ../supabase/tests/rls.test.ts (12 tests) 59ms
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

**Regression check** — default app suite unaffected by any of this:

```
$ npx vitest run --config vitest.config.ts
 Test Files  70 passed (70)
      Tests  973 passed (973)
```

All exit codes above were captured directly (`echo "EXIT=$?"` immediately
after each command, never through a pipe).

## Direct SQL verification of the final state

```
$ docker exec supabase_db_paragon-iv psql -U postgres -c \
  "select tablename, policyname, cmd, roles from pg_policies where schemaname='public' order by tablename, cmd;"
 friend_codes | a friend code is written only by its owner | ALL    | {authenticated}
 friend_codes | a friend code is readable by its owner     | SELECT | {authenticated}
 profiles     | a profile is created only by its owner     | INSERT | {authenticated}
 profiles     | profiles are readable by anyone signed in  | SELECT | {authenticated}
 profiles     | a profile is editable only by its owner    | UPDATE | {authenticated}
(5 rows)

$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select tgname, tgrelid::regclass from pg_trigger where tgname='on_auth_user_confirmed';"
on_auth_user_confirmed|auth.users
```

Exactly the 5 policies from the brief, exactly the one trigger, nothing
extra.

## Stack state

```
$ npm run db:stop
{"message":"Stopped supabase local development setup."}
$ docker ps --format '{{.Names}}'
(empty)
$ docker ps -q | wc -l
0
```

Confirmed stopped.

## Files changed

- `supabase/migrations/20260901155633_profiles_policies.sql` (new)
- `supabase/migrations/20260901155904_profile_on_confirm.sql` (new)
- `supabase/config.toml` (1-line change: `enable_confirmations`)
- `supabase/tests/rls.test.ts` (temp test removed, 11 policy tests added)
- `supabase/tests/profile-trigger.test.ts` (new, 5 tests)

No changes under `app/src/`. `npm run check` was not run, per the global
constraint (only `npm run check:db`, plus the unmodified `vitest.config.ts`
suite as a non-gating regression check).

## Self-review findings

- The "different user cannot update" test asserts both that the `UPDATE`
  affects 0 rows *and*, independently through the superuser connection, that
  the target value is unchanged — the brief's own distinction (silent no-op
  vs. refusal) applied here too, even though the brief only demanded it
  explicitly for the `display_name` trigger case. For UPDATE, Postgres RLS
  genuinely does silently exclude non-matching rows (no error is possible or
  expected here, unlike the INSERT case) — so "0 rows affected" is the
  correct and only assertion, but I still cross-checked the data because a
  test that only checks `rows.length === 0` could pass even if the harness's
  query itself were wrong (e.g. a typo'd `where` clause matching nothing for
  unrelated reasons).
- I split the trigger tests into their own file
  (`supabase/tests/profile-trigger.test.ts`) rather than appending to
  `rls.test.ts`. The brief's Files section names only `rls.test.ts` for the
  policy tests; it does not name a trigger test file, but Step 6 describes a
  materially different concern (real `auth.users` confirmation flows via
  direct SQL, not RLS impersonation) that would have made a single file
  unwieldy. `vitest.db.config.ts`'s glob (`../supabase/tests/**/*.test.ts`)
  picks it up automatically — no config change needed.
- Both test files use randomly generated UUIDs and randomized name suffixes
  for every fixture (`randomUUID()`), rather than the fixed test UUIDs used
  in Task 3's report. This was deliberate: the two test files run against
  the same live database and could in principle be scheduled concurrently by
  Vitest, and `profiles.display_name` is globally unique — fixed literal
  names risked a collision between files or between reruns that never fully
  cleaned up (e.g., an interrupted run). Cleanup is still explicit
  (`afterAll`/`afterEach` with plain `delete`, never relying on transaction
  rollback) per the footgun Task 3 documented.
- Confirmed by direct experiment (not asserted in a test, since it's not in
  the brief's list) that the duplicate-`display_name` confirmation failure
  rolls back the *entire* statement, including `auth.users.email_confirmed_at`
  itself — a user whose confirmation collides with a taken name ends up
  looking unconfirmed again after the failed attempt, not confirmed-without-
  a-profile. Worth the controller knowing for Task 6's error-handling design
  (a real user hitting this needs a "that name's taken, try confirming with
  a different name" story, not just a generic 500), but out of scope to fix
  here since the brief only asked to prove the insert fails loudly.
- `insert into auth.users` fixtures never set `email_confirmed_at` unless a
  test specifically needs a confirmed/Google-path user, precisely because
  the trigger (once it exists) fires on that column and would otherwise
  attempt to synthesize a profile from empty `raw_user_meta_data`, itself
  failing on `display_name`'s `NOT NULL` constraint and aborting the fixture
  insert. This is why `rls.test.ts`'s policy fixtures (which build profiles
  by hand, bypassing the trigger entirely) leave `email_confirmed_at` null.

## Concerns

- None that block this task. The one open question flagged above (duplicate
  display_name during confirmation silently un-confirms the user, since the
  whole statement rolls back) is a real UX edge case for a later task, not a
  defect in what was asked for here — the brief's own bullet only required
  that the insert "fails on the unique constraint rather than silently
  producing no profile," which it verifiably does.
- The friend-code table's `for all` write policy (covering insert/update/
  delete together) was used verbatim from the brief without a dedicated
  insert-only or delete-only test; the brief's bullet list only asked for
  read-own/read-deny/anon-deny plus "can change own friend code," which is
  what's tested. Flagging in case a future reviewer expects insert/delete
  coverage on that table specifically.

---

# Fix round 1: the confirmation lockout

## The finding, restated

The coordinator identified that a `display_name` collision discovered at
confirmation time was worse than the "UX edge case" I'd flagged: because the
trigger's `insert` raised inside the `UPDATE ... email_confirmed_at = now()`
statement, the *entire* statement rolled back, including
`email_confirmed_at` itself. A user whose name lost the race could never
confirm (identical collision on every retry) and could never re-register
(the email is already taken in `auth.users`) — a lockout only an
administrator could clear, reachable by two ordinary users wanting the same
name.

## The fix

New migration:
`supabase/migrations/20260901160626_confirm_survives_name_collision.sql`,
via `npx supabase migration new confirm_survives_name_collision` (not an
edit to the already-applied `20260901155904_profile_on_confirm.sql`).
`create or replace function public.handle_confirmed_user()`, identical to
the original except the `insert ... on conflict (id) do nothing` is now
wrapped in its own `begin/exception when unique_violation then null; end`
block, so a `display_name` collision is swallowed rather than propagating
out and failing the trigger's caller (the `UPDATE`/`INSERT` on
`auth.users`). The `on conflict (id) do nothing` is kept — it still covers
the double-fire case (insert-then-update) independent of this fix.

Verified live against the running container after `npm run db:reset`:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -c "\sf public.handle_confirmed_user"
...
  begin
    insert into public.profiles (...) on conflict (id) do nothing;
  exception when unique_violation then
    null;
  end;
  return new;
```

## Tests added

All four in `supabase/tests/profile-trigger.test.ts`. The original file's
tests 1–4 (unconfirmed-has-no-profile, confirmed-creates-one-with-metadata,
Google-path-arrives-confirmed, confirming-twice-is-a-no-op) are unchanged
and still pass. Test 5 — the one that previously asserted `confirm(secondId)`
should **reject** on a name collision — was **not** kept alongside the new
tests: it was asserting the exact bug being fixed, so keeping its original
assertion would mean deliberately shipping a regression test that fails
against the fix. It was replaced with a new `describe('a display_name
collision discovered at confirmation', ...)` block containing the three
tests the coordinator asked for, built on a shared `setUpCollision()` helper
(a confirmed "owner" of the name plus an unconfirmed "loser" who requested
the same name):

1. **`still confirms the losing account rather than stranding it`** — the
   lockout regression test. Asserts `confirm(loserId)` resolves (does not
   throw) and that `auth.users.email_confirmed_at` for the loser is
   non-null afterward.
2. **`leaves the losing account with no profile row`** — asserts
   `select id from public.profiles where id = loserId` returns zero rows
   after confirmation, the state Task 6 must handle on first sign-in.
3. **`leaves the name owner unaffected`** — asserts the owner's profile
   still exists and still carries the shared `display_name`, i.e. the fix
   doesn't touch the winning row.

Net test count: `profile-trigger.test.ts` went from 5 to 7 tests (4
unchanged + 3 new, replacing the 1 that pinned the bug). `rls.test.ts`'s 12
tests are untouched. Total db suite: 19 (up from 17).

## RED, before the fix

Ran the new collision tests against the trigger from
`20260901155904_profile_on_confirm.sql` (fix migration not yet written):

```
$ npx vitest run --config vitest.db.config.ts -t "display_name collision"
 × still confirms the losing account rather than stranding it
   → promise rejected "PostgresError: duplicate key value violat…" instead of resolving
 × leaves the losing account with no profile row
   → duplicate key value violates unique constraint "profiles_display_name_key"
 × leaves the name owner unaffected
   → duplicate key value violates unique constraint "profiles_display_name_key"

 Tests  3 failed | 16 skipped (19)
```

All three failed with exactly the `profiles_display_name_key`
unique-violation the coordinator described propagating out of `confirm()` —
genuine RED exercising the actual lockout path, not failing for an unrelated
reason.

## GREEN, after the fix

```
$ npm run db:reset
Applying migration 20260901153959_profiles.sql...
Applying migration 20260901155633_profiles_policies.sql...
Applying migration 20260901155904_profile_on_confirm.sql...
Applying migration 20260901160626_confirm_survives_name_collision.sql...
{"message":"Reset local database."}

$ npx vitest run --config vitest.db.config.ts
 ✓ ../supabase/tests/profile-trigger.test.ts (7 tests) 58ms
 ✓ ../supabase/tests/rls.test.ts (12 tests) 75ms
 Test Files  2 passed (2)
      Tests  19 passed (19)
```

**Official gate**, `npm run check:db`, exit 0:

```
 ✓ ../supabase/tests/profile-trigger.test.ts (7 tests) 51ms
 ✓ ../supabase/tests/rls.test.ts (12 tests) 64ms
 Test Files  2 passed (2)
      Tests  19 passed (19)
```

All exit codes captured directly (`echo "EXIT=$?"` immediately after each
command, never through a pipe).

## Cleanup and stack state

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from public.profiles;"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from auth.users;"
0
```

No leftover fixture rows after the full run.

```
$ npm run db:stop
{"message":"Stopped supabase local development setup."}
$ docker ps --format '{{.Names}}'
(empty)
$ docker ps -q | wc -l
0
```

Confirmed stopped.

## Files changed (this round)

- `supabase/migrations/20260901160626_confirm_survives_name_collision.sql`
  (new)
- `supabase/tests/profile-trigger.test.ts` (modified — 3 tests replacing 1,
  4 unchanged)

Commit: `8606399 fix(db): a taken name must not strand a confirming account`.

## Self-review findings (this round)

- Deleting the old test 5 rather than keeping it disabled or updated in
  place: I judged that a test whose entire premise (collision should fail
  loudly) is now false has no value left even as documentation — the new
  `describe` block's docstring explains the reversal and why, which does
  that job instead.
- Noticed an unrelated empty file, `paragon.env.local`, appear at the repo
  root (0 bytes, mtime matching one of the `db:reset` runs this session) —
  did not create it deliberately and don't know its origin (possibly a
  side effect of the Supabase CLI's `--workdir ..` writing something at the
  parent directory it wasn't expecting). Left it untracked and unstaged;
  not part of this commit.
- Did not re-verify the RLS policy tests' RED/GREEN cycle in this round
  since nothing about the policies changed — only reran the full suite to
  confirm no regression, which it didn't.

## Concerns (this round)

- None blocking. The fix is narrowly scoped to the exact failure mode
  described, verified to sit on genuine RED beforehand, and the "account
  confirmed with no profile" state it now permits is explicitly Task 6's
  problem to handle on first sign-in, as the coordinator's fix comment says.

---

# Fix round 2: coverage gaps and a narrowed exception handler

Review came back Ready with three Minors. All three closed in this round.

## 1. `friend_codes` "for all" policy — insert and delete coverage added

The policy grants insert/update/delete/select together; only UPDATE's
allow-direction had a test. Added a new `describe('friend_codes write
policy — insert and delete', ...)` block to `supabase/tests/rls.test.ts`
with fresh per-test fixture profiles (`makeProfile()` helper, cleaned up in
a `finally`):

- **`lets the owner insert their own friend code`** — `asUser(owner)`
  inserts a `friend_codes` row for their own `profile_id`; asserts 1 row
  returned.
- **`does not let a different user insert a friend code for someone else's
  profile_id`** — `asUser(attacker)` inserting a row for `targetId` is
  asserted to reject, and the target's `friend_codes` table is confirmed
  still empty afterward via the superuser connection (not just "it threw").
- **`lets the owner delete their own friend code`** — `asUser(owner)`
  deletes their own row; asserts 1 row returned and confirms via `sql()`
  that it's actually gone.
- **`does not let a different user delete someone else's friend code`** —
  `asUser(attacker)` deleting the owner's row returns 0 rows affected (RLS
  silently excludes it from the delete's target set — no error, exactly
  like the UPDATE-deny case), and the row is confirmed to **survive** with
  its original `code` value via the superuser connection. This is the one
  the coordinator specifically flagged: a denied delete proves nothing by
  "didn't throw" alone, since 0-rows-affected-silently is also what a
  buggy but harmless query would look like.

No policy change was needed for any of these four — the existing `for all`
policy from Task 4's original migration already behaved correctly in all
four directions; only the tests were missing.

## 2. Direct anon-deny test for `profiles`

Added `'does not let an anonymous request read any profile'` right next to
the existing friend_codes anon-deny test:

```ts
it('does not let an anonymous request read any profile', async () => {
  const rows = await asAnon()<{ id: string }>(`select id from public.profiles`);
  expect(rows).toHaveLength(0);
});
```

Passes because `profiles`' only SELECT policy is scoped `to authenticated`
— `anon` matches no policy at all, so the whole table is invisible to it
regardless of any filter, same mechanism as the friend_codes case, now
verified directly rather than only inferred.

## 3. Narrowed the `unique_violation` handler

New migration (not an edit to an applied one):
`supabase/migrations/20260901161600_confirm_forgives_only_display_name_collision.sql`,
via `npx supabase migration new confirm_forgives_only_display_name_collision`.
`create or replace function public.handle_confirmed_user()`, same shape as
before, but the exception handler now reads the actual constraint name via
`get stacked diagnostics v_constraint = constraint_name` and re-raises
unless it is exactly `profiles_display_name_key`:

```sql
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint is distinct from 'profiles_display_name_key' then
    raise;
  end if;
end;
```

Chose `get stacked diagnostics` over the `sqlerrm like '%...%'` alternative
the coordinator also offered: matching on the structured `constraint_name`
diagnostic is exact and independent of message wording/locale, whereas a
`like` match on the free-text error message is exactly the kind of
string-matching fragility this codebase's own comments elsewhere warn
against. Commented the assumption in the migration itself (a future unique
constraint on `profiles` must decide deliberately whether it belongs in
this handler) per the instruction to comment it, not just fix it silently.

Confirmed live against the running container:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -c "\sf public.handle_confirmed_user"
...
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'profiles_display_name_key' then
      raise;
    end if;
  end;
```

Also directly enumerated `public.profiles`'s constraints to confirm the
premise (only two unique-ish constraints reach this insert, and `id`'s
never gets here):

```
$ docker exec supabase_db_paragon-iv psql -U postgres -c \
  "select conname, contype from pg_constraint where conrelid = 'public.profiles'::regclass;"
          conname          | contype
---------------------------+---------
 profiles_pkey             | p
 profiles_display_name_key | u
 profiles_id_fkey          | f
```

### Whether a "different unique violation still propagates" test was proven

**Not proven — reported as an honest gap, per the coordinator's explicit
permission to do so rather than invent a contrived fixture.** The query
above is the reason: `public.profiles` has exactly one unique constraint
reachable from inside this trigger's `insert` statement —
`profiles_display_name_key`. The other one, `profiles_pkey` (the primary
key on `id`), can never raise `unique_violation` here because `ON CONFLICT
(id) DO NOTHING` intercepts it before Postgres would raise anything. There
is no third unique constraint on this table today, and none of the other
columns inserted (`go_username`, `birth_date`, `tos_accepted_at`) carry a
unique constraint either. Constructing a genuine "different unique
violation propagates" test would require adding a new unique constraint to
`public.profiles` purely to give the test something to violate — schema
churn motivated by nothing the product needs, which is precisely the
contrived-fixture failure mode the coordinator warned against. I did not
add one.

What *is* covered instead: every one of the 4 pre-existing trigger
collision tests (from fix round 1) still passes against this narrowed
handler, which is itself partial evidence the narrowing didn't break the
one case it must continue to forgive — the `display_name` collision is
still absorbed, confirmed by
`still confirms the losing account rather than stranding it` continuing to
pass. But that is evidence the *intended* path still works, not evidence
that an *unintended* violation type is correctly re-raised — the two are
different claims, and only the first is actually tested here.

## TDD / verification for this round

```
$ npx vitest run --config vitest.db.config.ts     # after adding tests 1 & 2, before the migration
 ✓ ../supabase/tests/rls.test.ts (17 tests) 89ms   # 12 original + 5 new, all green immediately —
                                                     # no policy change was needed for these two items

$ npm run db:reset                                 # applies the narrowed-handler migration
Applying migration 20260901161600_confirm_forgives_only_display_name_collision.sql...
{"message":"Reset local database."}

$ npx vitest run --config vitest.db.config.ts
 ✓ ../supabase/tests/profile-trigger.test.ts (7 tests) 44ms
 ✓ ../supabase/tests/rls.test.ts (17 tests) 76ms
 Test Files  2 passed (2)
      Tests  24 passed (24)

$ npm run check:db   # official gate
 Test Files  2 passed (2)
      Tests  24 passed (24)
EXIT=0
```

All exit codes captured directly (`echo "EXIT=$?"` immediately after each
command, never through a pipe). Total db suite: 24 (up from 19 — 5 new
tests in `rls.test.ts`, `profile-trigger.test.ts` unchanged this round).

## Cleanup and stack state

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from public.profiles;"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from public.friend_codes;"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from auth.users;"
0

$ npm run db:stop
{"message":"Stopped supabase local development setup."}
$ docker ps --format '{{.Names}}'
(empty)
$ docker ps -q | wc -l
0
```

Confirmed stopped, no leftover fixture rows of any kind.

## Files changed (this round)

- `supabase/migrations/20260901161600_confirm_forgives_only_display_name_collision.sql`
  (new)
- `supabase/tests/rls.test.ts` (modified — 5 tests added, nothing removed)

Commit: `f5ffdc7 test(db): cover the writes that policy allows, and narrow
what it forgives`.

Noted in passing but out of scope: an intervening commit `3725c98 chore:
ignore stray env files anywhere in the tree` appeared in the branch history
between fix rounds 1 and 2, widening `.gitignore` for the empty
`paragon.env.local` artifact I'd flagged as a self-review finding in round
1. Not made by me this round; mentioning it only so the history isn't
mysterious to a later reader.

## Self-review findings (this round)

- The insert/delete friend_codes tests needed fresh fixture profiles rather
  than reusing `userA`/`userB`, since those two already carry a
  `friend_codes` row from the outer `beforeAll` (whose primary key is
  `profile_id`) — inserting a second row for the same owner would itself
  collide on the primary key for reasons unrelated to the policy under
  test. Used a small `makeProfile(label)` helper local to the new
  `describe` block instead, one profile per role per test.
- Chose `get stacked diagnostics` over the brief's alternative `sqlerrm
  like` form; documented the reasoning above and in the migration's own
  comment.
- Confirmed by direct query (not by trusting the SQL brief text) that
  `profiles_pkey` truly cannot reach the exception handler — it's
  intercepted by `ON CONFLICT (id) DO NOTHING` at the `INSERT` level, a
  step earlier than exception handling — before writing the "cannot prove
  this without a new constraint" conclusion, so that conclusion rests on a
  verified fact about this schema rather than an assumption.

## Concerns (this round)

- The one open item is the untested "different unique violation
  propagates" path, disclosed above rather than papered over. If a future
  migration adds a second unique constraint to `profiles`, whoever does
  that should also add a test exercising this handler's `raise` branch
  against it — the schema change would finally make that test constructible
  without contrivance.

---

# Fix round 3: display names are unfrozen (product requirement reversal)

Not a defect fix — the product owner withdrew the immutability requirement
from earlier in this task. Fix round 2 was accepted as-is (24/24, unchanged
this round).

## The migration

New migration (not an edit to an applied one):
`supabase/migrations/20260901162007_display_name_unfrozen.sql`, via
`npx supabase migration new display_name_unfrozen`:

```sql
drop trigger if exists profiles_display_name_frozen on public.profiles;
drop function if exists public.freeze_display_name();
```

Comment explains the *why*: the name was frozen so "this person has always
been this person" held for an account's lifetime; that guarantee is
withdrawn so someone can fix a regretted name and so losing a name race
(the lockout scenario from fix round 1) stops being permanent for the loser
— they can register again once a name is free and rename into it later.
The trade accepted: impersonation-by-rename becomes possible, since the
kept UNIQUE constraint only ever prevented two people holding a name
simultaneously, never one holding it after another gave it up.

The UNIQUE constraint on `display_name` (`profiles_display_name_key`) was
untouched — confirmed directly:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select count(*) from pg_trigger where tgname='profiles_display_name_frozen';"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select count(*) from pg_proc where proname='freeze_display_name';"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -c \
  "select conname, contype from pg_constraint where conrelid = 'public.profiles'::regclass;"
          conname          | contype
---------------------------+---------
 profiles_display_name_key | u
 profiles_id_fkey          | f
 profiles_pkey             | p
```

Trigger and function both gone; the unique constraint (and everything
else) intact.

## Which test was inverted, and why it's a correction not a loosening

`supabase/tests/rls.test.ts`'s test previously titled `'does not let a
user change their own display_name — the trigger rejects it'` (asserting
`.rejects.toThrow(/immutable/i)`) is now `'lets a user change their own
display_name, now that it is no longer frozen'`, asserting the update
succeeds and the new value reads back correctly.

This is a correction, not a loosening, because the assertion it replaces
encoded a product requirement (display names are permanent) that no longer
exists — the requirement moved, so the test that pinned the old
requirement was pinning something false. Nothing about the *mechanism*
under test (the UPDATE ownership policy, or the unique constraint) was
weakened; only the assertion about a now-removed trigger changed, from
"this must fail" to "this must succeed." The test's own comment says so
explicitly and tells a future reader not to "restore" the old assertion,
per the coordinator's instruction, since the trigger it depended on no
longer exists on purpose.

Proven to genuinely depend on the trigger, not just asserted: ran this test
**before** applying the unfreeze migration and it failed with exactly
`display_name is immutable once chosen` — the real error the still-present
trigger raises — not a mismatch for some unrelated reason.

## The two new tests

Both added directly after the inverted test, same `describe` block:

1. **`'does not let a user change a different user's display_name'`** — the
   one that matters per the coordinator's framing. `asUser(userB)` attempts
   to update `userA`'s `display_name`; asserts 0 rows affected (RLS's
   ownership scoping on the UPDATE policy, `(select auth.uid()) = id`, is a
   mechanism entirely independent of the trigger that was just dropped) and
   confirms via the superuser connection that `userA`'s `display_name` is
   unchanged. This test **passed even before the migration was applied** —
   correctly, since it exercises the RLS policy, not the trigger, and the
   coordinator's framing was exactly right: the two mechanisms needed to be
   verified independent, not assumed independent, and this test is that
   verification. It stayed green across the whole round.

2. **`'does not let a rename collide with a name someone else already
   holds'`** — creates two fresh fixture profiles (`ownerId` holding
   `takenName`, `renamerId` holding a distinct name), then has
   `asUser(renamerId)` attempt to rename into `takenName`. Asserts the
   update rejects matching `/duplicate key|unique constraint/i`. This one
   **genuinely depended on the migration**: run before the migration, it
   still failed (good — a rename attempt on a still-frozen row must fail
   regardless), but for the *wrong* reason — the freeze trigger raised
   `display_name is immutable once chosen` before the unique constraint
   ever got a chance to fire, since the `BEFORE UPDATE` trigger runs first.
   After the migration removed that trigger, the same test now fails for
   the *right* reason — the unique constraint's `duplicate key value
   violates unique constraint "profiles_display_name_key"` — which the
   regex now matches. Caught this by running the test standalone (`-t
   "rename collide"`) before applying the migration and reading the actual
   error message, not just trusting that "it failed" meant "it failed
   correctly."

## TDD evidence

**RED (inverted test)**, before the migration:

```
$ npx vitest run --config vitest.db.config.ts -t "display_name"
 × lets a user change their own display_name, now that it is no longer frozen
   → display_name is immutable once chosen
 ✓ does not let a user change a different user's display_name   (correctly green already)
```

**RED (collision test)**, before the migration, standalone:

```
$ npx vitest run --config vitest.db.config.ts -t "rename collide"
 × does not let a rename collide with a name someone else already holds
   → expected [Function] to throw error matching /duplicate key|unique constraint/i
     but got 'display_name is immutable once chosen'
```

**GREEN**, after `npm run db:reset` applied the migration:

```
$ npx vitest run --config vitest.db.config.ts
 ✓ ../supabase/tests/profile-trigger.test.ts (7 tests) 60ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 96ms
 Test Files  2 passed (2)
      Tests  26 passed (26)
```

**Official gate**, `npm run check:db`, exit 0:

```
 ✓ ../supabase/tests/profile-trigger.test.ts (7 tests) 50ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 93ms
 Test Files  2 passed (2)
      Tests  26 passed (26)
```

All 24 previously-passing tests (from before this round) still pass except
the one whose requirement was withdrawn, which now asserts the opposite as
required. Net: 26 total (up from 24 — the inverted test stays 1, plus 2
new). All exit codes captured directly (`echo "EXIT=$?"` immediately after
each command, never through a pipe).

## Cleanup and stack state

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from public.profiles;"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from public.friend_codes;"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from auth.users;"
0

$ npm run db:stop
{"message":"Stopped supabase local development setup."}
$ docker ps --format '{{.Names}}'
(empty)
$ docker ps -q | wc -l
0
```

Confirmed stopped, no leftover fixture rows.

## Files changed (this round)

- `supabase/migrations/20260901162007_display_name_unfrozen.sql` (new)
- `supabase/tests/rls.test.ts` (modified — 1 test inverted with an
  explanatory comment, 2 new tests added, nothing else touched)

Commit: `40f7d6c feat(db): a display name can be changed, and still cannot
be shared`.

## Self-review findings (this round)

- After the inverted test successfully renames `userA`, I update the local
  JS fixture object (`userA.displayName = rows[0].display_name`) so any
  later test in the file that might reference `userA.displayName` stays
  accurate rather than silently stale. Checked: no test after this point in
  the file actually reads `userA.displayName` again, but keeping the JS
  object honest costs nothing and avoids a future edit accidentally reading
  a stale value.
- The cross-user-deny test and the rename-collision test both needed to be
  checked for *which* mechanism they were actually exercising before and
  after the migration — the standalone pre-migration run of the collision
  test was the only way to catch that it was passing for the wrong reason
  (trigger, not constraint) rather than assuming a failing test before a
  fix is automatically "the right RED."
- Did not touch `profile-trigger.test.ts` this round — none of its
  assertions depend on `display_name` immutability, only on the unique
  constraint (still present) and the confirmation trigger (unrelated to the
  freeze trigger). Confirmed by the fact that all 7 of its tests passed
  throughout this round without modification.

## Concerns (this round)

- None. The product reversal is narrowly scoped to exactly the trigger and
  function named in the instruction; the unique constraint, the RLS
  policies, and the confirmation trigger are all unmodified and independently
  re-verified as still correct.
