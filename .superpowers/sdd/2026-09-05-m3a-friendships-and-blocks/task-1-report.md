# Task 1 report: friendships and blocks schema + policies

## What changed

- Created `supabase/migrations/20260906000000_friendships_and_blocks.sql` (named per the
  orchestrator's explicit instruction, NOT the brief's `20260905130000`, which would sort
  before migrations already deployed to production — the newest on `main` at task start was
  `20260905124300_scheduled_matches_carry_their_play_time.sql`).
- Created `supabase/tests/social.test.ts` — the brief's test file, with one deviation (see
  below).
- Modified `supabase/tests/helpers.ts` — extended `PRIVILEGE_DENIED`'s alternation to include
  `friendships`, exactly as the brief's Step 4 specifies. No other change to helpers.ts.

The migration is the brief's SQL verbatim for the tables, indexes, RLS enable, and both
policies (canonical `(user_lo, user_hi)` friendships table with `friendships_ordered`,
`friendships_status`, `friendships_requester_is_a_party` checks; one-directional `blocks`
table with `blocks_distinct` check; friendships select-only policy scoped to the two parties
with insert/update/delete revoked from `authenticated`; blocks `for all` policy scoped to
`blocker_id = auth.uid()` with no policy at all for the blocked side). I added one block of
commentary and revoke statements for `pair_lo`/`pair_hi` that the brief's SQL did not include
(see "pair_lo/pair_hi grants" below).

## Deviation from the brief: the `refusal()` call

The brief's test file calls:

```ts
await refusal(
  asUser({ sub: ann })(`insert into public.friendships ...`),
  PRIVILEGE_DENIED,
);
```

This does not match the `refusal()` that actually exists in `supabase/tests/helpers.ts` (and
that five other suites — offers, queue, reports, coordinator-tick — already depend on):

```ts
export async function refusal(q: () => Promise<unknown>): Promise<{ code: string; message: string }>
```

It takes a **thunk** (one argument) and returns `{code, message}` for the caller to assert on;
it does not take a matcher as a second argument and does not assert internally. The brief's
call instead passes an already-invoked `Promise` as the first argument (`asUser(...)(query)`
calls the returned function immediately) plus a regex as a second argument the real function
doesn't accept. At runtime this wouldn't throw — extra JS arguments are silently ignored, and
calling the non-function `q` would throw synchronously, which the `try/catch` inside `refusal`
swallows and turns into `{code: '(none)', message: 'q is not a function'}` — and since the
brief's test never inspects that return value, the test would pass unconditionally, whether or
not the migration's revoke actually works. That's a false-positive test, which the global
constraints explicitly warn against ("Piped exit codes lie" / "never assert 'it threw' when you
mean...").

I fixed the one affected test (`'lets nobody write a friendship row directly'`) to use the
existing, real `refusal()` contract, matching the convention in every other suite:

```ts
const denied = await refusal(() =>
  asUser({ sub: ann })(
    `insert into public.friendships (user_lo, user_hi, requested_by)
     values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`,
  ),
);
expect(denied.message).toMatch(PRIVILEGE_DENIED);
```

This is the only place the test file differs from the brief's listing. Every other test,
including the ones with the "no error, 0 rows" unblock semantics, is verbatim.

I did not touch `refusal()`'s signature in helpers.ts — per the global constraint to prefer a
local fix over widening a shared function that other suites already depend on.

## `pair_lo`/`pair_hi` grants — what I decided and why

The brief's own migration SQL defines `pair_lo`/`pair_hi` but never calls them anywhere in
this migration — not in the check constraints (which write `user_lo < user_hi` directly), not
in either policy. Nothing in this task's SQL needs any role to have EXECUTE on them yet.

Both are pure, immutable, `language sql` functions that only compute `least`/`greatest` of two
UUIDs — no table access, no `auth.uid()` call, nothing sensitive. Leaving PUBLIC's default
EXECUTE grant in place would not leak anything by itself. But given the explicit context that
this exact default bit M2b twice, and the repo's established pattern is to revoke on creation
rather than reason about whether the specific function is dangerous enough to bother, I added:

```sql
revoke all on function public.pair_lo(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pair_hi(uuid, uuid) from public, anon, authenticated;
```

I revoked from `authenticated` too, not just `public`/`anon`, because — unlike
`accept_offer`/`confirm_offer` in the precedent migrations — nothing in this task's scope calls
these functions from client-facing code, so there is no current caller to grant to. Granting
`authenticated` execute now would be granting access to something nothing yet uses, which is
its own kind of default-left-open. When a later migration (the "send/accept friend request"
functions this schema is clearly built for) adds the first caller, that migration should add
whatever grant its actual caller needs — plausibly nothing at all, if that function is
`security definer` owned by `postgres`, since a superuser-owned definer bypasses the callee's
ACL check entirely when invoking `pair_lo`/`pair_hi` internally.

This is the one place I added SQL beyond the brief's literal text. I judged it necessary given
the explicit instruction to "judge for yourself whether they need `authenticated` execute at
all," and the safer default is closed-by-default until a caller exists.

Verified directly against the running stack after `db:reset`:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select has_function_privilege('anon','public.pair_lo(uuid,uuid)','execute'), \
          has_function_privilege('authenticated','public.pair_lo(uuid,uuid)','execute');"
f|f
```

and the two policies exist exactly as specified:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select polname, polcmd, polroles::regrole[] from pg_policy p \
   join pg_class c on c.oid=p.polrelid where c.relname in ('friendships','blocks');"
a friendship is visible to its two sides|r|{authenticated}
a block belongs to the person who made it|*|{authenticated}
```

`polcmd = *` is Postgres's code for `for all`; there is exactly one policy per table, and
`blocks` has none scoped to the blocked side — the "no policy at all, not a narrowed one"
requirement.

## TDD sequence, with real command output

### Step 2 — write the test, see it fail

```
$ cd app && npm run check:db > /tmp/db_before.log 2>&1; echo "EXIT=$?"
EXIT=1
```

Relevant excerpt from `/tmp/db_before.log`:

```
 ❯ ../supabase/tests/social.test.ts (7 tests | 7 failed) 118ms
     → relation "public.friendships" does not exist
     → relation "public.friendships" does not exist
     ...
     → relation "public.blocks" does not exist
     ...
 Test Files  1 failed | 9 passed (10)
      Tests  7 failed | 159 passed (166)
```

Before count: 159/159 passing (9 suites), 7 new failing tests, all failing on
`relation "public.friendships" does not exist` / `relation "public.blocks" does not exist` —
the correct failure for a migration that hasn't been written yet.

### Step 3/5 — write the migration, reset, re-run

```
$ cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET_EXIT=$?"
RESET_EXIT=0
...
Applying migration 20260906000000_friendships_and_blocks.sql...
...
Finished supabase db reset on branch main.
```

```
$ cd app && npm run check:db > /tmp/db_after.log 2>&1; echo "EXIT=$?"
EXIT=0
```

Relevant excerpt from `/tmp/db_after.log`:

```
 ✓ ../supabase/tests/social.test.ts (7 tests) 210ms
 Test Files  10 passed (10)
      Tests  166 passed (166)
```

After count: 166/166 (159 existing + 7 new), `check:db` EXIT=0.

### Full gate

```
$ cd app && npm run check > /tmp/check_full.log 2>&1; echo "EXIT=$?"
EXIT=1
```

One failure, unrelated to this change: `src/components/__tests__/leaves.test.tsx` —
`SpeciesSearch list behaviour > tracks scroll position...`, an `AssertionError` comparing
`'Palkia (Origin)rank20484'` to itself (`not.toBe` on identical strings) — a virtualized-list
scroll-position test, nowhere near `supabase/`. Test Files 1 failed | 84 passed (85), Tests
1219 passed (1220).

I verified this predates and is unrelated to this task:

```
$ npx vitest run src/components/__tests__/leaves.test.tsx  # run 1
EXIT1=0, 20/20 passed
$ npx vitest run src/components/__tests__/leaves.test.tsx  # run 2
EXIT2=0, 20/20 passed
```

Passes cleanly in isolation both times — it's flaky under the full-suite run, not broken by
this migration (this task touched nothing under `app/src`). I then re-ran the full gate once
more to confirm:

```
$ cd app && npm run check > /tmp/check_full2.log 2>&1; echo "EXIT=$?"
EXIT=0
Test Files  85 passed (85)
     Tests  1220 passed (1220)
```

1220/1220, EXIT=0 on the clean rerun.

## Files changed

- `supabase/migrations/20260906000000_friendships_and_blocks.sql` (new)
- `supabase/tests/social.test.ts` (new)
- `supabase/tests/helpers.ts` (modified — one-line regex extension)

## Commit

```
665031e feat(social): one row per friendship, and a block nobody can see
```

Not pushed, per instructions.

## What I'm unsure about

- The `pair_lo`/`pair_hi` grant decision (revoke from `authenticated` too, grant to nobody) is
  a judgment call with no current test coverage forcing it either way, since nothing calls
  these functions yet. If the next task's "send friend request" function turns out to need
  `authenticated` (i.e., it isn't `security definer`), that migration will need to add the
  grant — I flagged this in the migration's comment so it isn't a silent trap.
- The full-suite flaky test (`leaves.test.tsx` scroll-position) is pre-existing and unrelated,
  but I did not dig into its root cause since it's out of this task's scope — flagging it here
  rather than silently ignoring it.
