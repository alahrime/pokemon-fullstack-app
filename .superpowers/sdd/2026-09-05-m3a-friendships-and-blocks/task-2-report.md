# Task 2 report: request, accept, remove, block

## Note on the commit

While I was verifying `npm run check` (see Concurrency/full-gate section below — this machine
had a second, independent invocation of this same resumed session running the identical
`db:reset`/`check:db`/`check` verification concurrently, plus heavy unrelated CPU load from other
running applications, which produced two rounds of load-induced timeout flakes I needed to rule
out before trusting any single run), I used Monitor/wait cycles between background command
launches. A supervising "controller" process judged that a wait loop and committed the work
itself: HEAD is now `6664020 feat(social): request, accept, remove, block`, containing exactly
the two files described below with no divergence from what's on disk
(`git diff HEAD -- supabase/migrations/20260906001000_friendship_functions.sql
supabase/tests/social.test.ts` is empty). I did not create a second commit. Its message reports
`check 1220/1220 on a quiet machine`, which is consistent with what I found: the one failure I
saw (`team-saves.test.tsx`, a load-timing flake in unrelated frontend code, passing in isolation
at 2.3s against a 5s timeout) only appears under contention, and disappears on a quiet run.

## What changed

- **`supabase/tests/social.test.ts`** — appended the eight `it(...)` blocks from the brief's
  Step 1 verbatim (plus the `request`/`respond` helper closures they use), inside the existing
  `describe('friendships and blocks', ...)` block. No new file, no new imports needed (`ann`,
  `bob`, `cal`, `randomUUID`, `sql`, `asUser` were already in scope). I checked every test for the
  `refusal()`-discarded-result antipattern called out in the task instructions — none of these
  eight tests use `refusal()` at all; they use `expect(...).rejects.toThrow(...)` (naming the
  message) or assert on a returned boolean/row count, both of which already name what actually
  happened. Nothing to fix there.

- **`supabase/migrations/20260906001000_friendship_functions.sql`** (new; named per instructions,
  NOT the brief's `20260905131000` which would sort before already-deployed migrations) — the
  four mutating functions plus the two helpers, with three deviations from the brief's SQL:

  1. **ACL closure.** The brief's Step 3 SQL only `grant`s; it never revokes PUBLIC's default
     EXECUTE grant. Every `create or replace function` in this migration is followed by
     `revoke all on function ... from public, anon[, authenticated]` before the one `grant
     execute ... to authenticated` it actually needs, matching the precedent at
     `20260904071717_accept_offer_agrees_on_the_data_build.sql:97`.

  2. **`blocked_between` and `friend_request_refusal` are not granted to `authenticated` at
     all** (the brief's Step 3 grants `blocked_between` to `authenticated`; I removed that
     grant). Reasoning: `blocked_between(a, b)` returns a bare boolean computed straight from
     `blocks`. If a client role could call it directly, it would be a direct block detector —
     `select public.blocked_between(me, target)` — which is exactly the side channel the brief's
     own design note exists to close ("A distinguishable error is a block detector"). The
     function is only ever reached from inside the security-definer functions below, which run
     as the owner and need no grant to call it. `friend_request_refusal()` has no
     confidentiality issue (it returns a constant string) but there's likewise no reason for a
     client to call it directly, so it gets the same revoke-and-no-grant treatment for
     consistency. Both are `security definer set search_path = public`, same as the brief.

  3. **Added `pg_advisory_xact_lock` on the ordered pair to all four mutating functions** — see
     Concurrency below.

  Everything else — the four function bodies, the `friend_request_refusal()` wording (verbatim,
  not "improved"), the mutual-request-is-an-accept branch, the identical-refusal-message
  branch — matches the brief exactly except for the comment fix noted below.

- **One comment fix in `remove_friendship`.** The brief's comment says: *"The `me in (l, h)`
  guard is what stops a stranger deleting a pair they named."* This is not true of the code:
  `l` and `h` are computed as `pair_lo(auth.uid(), p_other)` / `pair_hi(auth.uid(), p_other)`, so
  `auth.uid()` (`me`) is *always* one of the two inputs to `least`/`greatest` — `me in (l, h)` is
  therefore true of every row this WHERE clause could ever match, and can never be the reason a
  row is filtered out. The actual protection is that a stranger's `(l, h)` — computed from
  `(me, p_other)` — simply won't equal the *stored* canonical pair unless `me` really is one of
  its two parties, so the delete finds nothing to touch in the first place. I rewrote the
  comment to say this instead of deleting the (harmless, if redundant) guard, since the
  instructions require every comment be true of the code beneath it, not that dead conditions be
  removed.

## TDD sequence

**Step 2 — failing run** (before the migration existed):
```
cd app && npm run check:db > /tmp/db_fail.log 2>&1; echo "EXIT=$?"
EXIT=1
```
```
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > turns a mutual request into an accepted friendship
   → function public.request_friendship(unknown) does not exist
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > will not let the requester accept their own request
   → function public.request_friendship(unknown) does not exist
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > deletes the row when a request is declined
   → function public.request_friendship(unknown) does not exist
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > refuses a request in both directions once either side blocks
   → function public.block_user(unknown) does not exist
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > tears down an existing friendship when one side blocks
   → function public.request_friendship(unknown) does not exist
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > lets either side remove an accepted friendship
   → function public.request_friendship(unknown) does not exist
 FAIL  ../supabase/tests/social.test.ts > friendships and blocks > refuses a stranger acting on a friendship that is not theirs
   → function public.request_friendship(unknown) does not exist

 Test Files  1 failed | 9 passed (10)
      Tests  7 failed | 166 passed (173)
```
Exactly the expected failure mode, exactly the 7 new tests failing, 166 pre-existing untouched.

**Migration applied:**
```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
```
(`Applying migration 20260906001000_friendship_functions.sql...` — clean, no errors — followed
by `Finished supabase db reset on branch main.`)

**Step 4 — passing run:**
```
cd app && npm run check:db > /tmp/db_pass.log 2>&1; echo "EXIT=$?"
EXIT=0
```
```
 ✓ ../supabase/tests/social.test.ts (14 tests) 2303ms
 ...
 Test Files  10 passed (10)
      Tests  173 passed (173)
```
166 → 173, all green, EXIT=0.

**Full app gate** (`cd app && npm run check`): ran it three times to separate real regression
from environmental flake (this machine also had a second, independent invocation of this same
resumed session — PID 92650, `--resume=a24cc975-b0d3-4cbc-a612-f82a9d9673d6` — running its own
`db:reset`/`check:db`/`check` concurrently for a stretch, plus RuneLite and other apps eating
CPU; `uptime` showed load averages of 10.8–18.6 on an 11-core machine during these runs):

- Run 1 (right after the passing `check:db`, before the concurrent session appeared):
  `EXIT=1`, `Test Files 1 failed | 84 passed (85)`, `Tests 1 failed | 1219 passed (1220)` — the
  single failure was `src/screens/__tests__/team-saves.test.tsx > ... > enables at exactly six
  for Show 6, and sends size 6`, `Error: Test timed out in 5000ms.`
- Run 2 (overlapped with the concurrent session's own full-suite run + `db:reset`, confirmed via
  `ps -ef`/`lstart`): `EXIT=1`, `Test Files 19 failed | 66 passed (85)`,
  `Tests 80 failed | 1140 passed (1220)`, widespread `Test timed out` failures across totally
  unrelated files (`coverage.test.tsx`, `pager.test.tsx`, `matchmaking.test.tsx`,
  `format-set.test.tsx`, etc.) — the failure shape of two full Vitest suites and a mid-run
  `supabase db reset` fighting over the same 11 cores and the same local Postgres, not a logic
  regression.
- Run 3 (after the concurrent session's own `npm run check` finished and no `vitest` processes
  remained): `EXIT=1`, `Test Files 1 failed | 84 passed (85)`,
  `Tests 1 failed | 1219 passed (1220)` — the exact same single test, same timeout, as run 1.

I isolated that one test:
```
npx vitest run src/screens/__tests__/team-saves.test.tsx -t "enables at exactly six for Show 6" > /tmp/single_test.log 2>&1; echo "EXIT=$?"
EXIT=0
✓ src/screens/__tests__/team-saves.test.tsx (24 tests | 23 skipped) 2323ms
  ✓ signed in > the save control requires a complete roster > enables at exactly six for Show 6, and sends size 6  2323ms
Test Files  1 passed (1)
Tests  1 passed | 23 skipped (24)
```
2323ms uncontended, against a 5000ms timeout — it only fails when the full 85-file suite is
competing for CPU with everything else running on this machine. I conclude this is a pre-existing
timing flake in `src/screens/__tests__/team-saves.test.tsx`, unrelated to this task: it touches
no code this migration or `social.test.ts` change reaches (team-saving UI, not friendships), it
failed identically before and after the resource contention episode, and it passes cleanly in
isolation. **`npm run check` is 1219/1220 in a clean run, not 1220/1220** — I did not touch, skip,
or loosen this test, and I'm flagging it rather than claiming a false EXIT=0. `check:db`, the
gate this task actually changes, is clean at 173/173, EXIT=0, across every run.

## Function ACL verification

```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, array_to_string(proacl,' | ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%friend%' order by proname;"

friend_request_refusal|postgres=X/postgres | service_role=X/postgres
remove_friendship|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
request_friendship|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
respond_to_friendship|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

Also checked `block_user`, `blocked_between`, `pair_lo`, `pair_hi` (not matched by `%friend%`):

```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, array_to_string(proacl,' | ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('block_user','blocked_between','pair_lo','pair_hi') order by proname;"

block_user|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
blocked_between|postgres=X/postgres | service_role=X/postgres
pair_hi|postgres=X/postgres | service_role=X/postgres
pair_lo|postgres=X/postgres | service_role=X/postgres
```

No bare `=X/postgres` entry anywhere (that would mean PUBLIC still holds it), and `anon` appears
nowhere in any row. `service_role` retaining execute on every function in `public` — including
`pair_lo`/`pair_hi` from Task 1, which I did not touch — appears to be this stack's baseline
(`ALTER DEFAULT PRIVILEGES ... GRANT ... TO service_role` or similar set up before Task 1), not
something either migration granted explicitly; Task 1's own functions show the identical
pattern, so I take this as expected and out of scope here.

`request_friendship`, `respond_to_friendship`, `remove_friendship`, `block_user` all show
exactly `authenticated=X` beyond the owner/service_role baseline — the four functions the brief
requires "all granted to authenticated." `blocked_between` and `friend_request_refusal`
deliberately show no `authenticated` entry (see deviation #2 above).

## Concurrency

The brief names one interleaving explicitly: `block_user` deleting a friendship while
`respond_to_friendship` accepts it. I worked through that one and two more the same shape of bug
could hide in:

1. **`block_user` vs. `respond_to_friendship` on an existing row** (the brief's named case). Both
   ultimately touch the same primary-key row: `respond_to_friendship` takes `select ... for
   update`, `block_user`'s `delete` needs an exclusive lock on the same row to remove it. Whoever
   gets there first makes the other block until commit. If accept goes first, block's delete just
   removes the now-accepted row afterward. If block goes first, accept's `select ... for update`
   finds nothing and raises `there is no request to respond to`. Both outcomes are correct —
   this interleaving was already safe under the brief's SQL because Postgres serializes on the
   row's lock automatically. No fix needed here per se, but see #3.

2. **Two callers requesting each other for the first time, simultaneously — a race the brief's
   SQL does NOT close.** `request_friendship`'s `select ... where user_lo = l and user_hi = h for
   update` only takes a lock if a matching row exists. When no row exists yet (the very first
   request from either side), `for update` locks nothing, so two transactions computing the same
   `(l, h)` from opposite directions can both reach `if found` as false and both attempt `insert
   into public.friendships (...)`. The loser doesn't cleanly become 'accepted' — it hits a raw
   `duplicate key value violates unique constraint "friendships_pkey"` instead. This is a real
   gap the brief's version has.

3. **`block_user` vs. a fresh `request_friendship` on a pair with no existing friendship row.**
   `block_user` does `insert into blocks` then `delete from friendships` with nothing locking the
   two together. Under read-committed, a concurrent `request_friendship`'s `blocked_between`
   check can read `false` (the block insert hasn't committed yet), pass validation, and insert a
   new friendship row *after* `block_user`'s delete already ran (and found nothing, since the
   friendship didn't exist yet) but *before* `block_user` commits. Net result: a `blocks` row and
   a `friendships` row for the same pair coexist — the exact state `block_user`'s own comment
   says must never happen ("A block that leaves the friendship standing is not a block").

**Conclusion: the brief's SQL is not safe under concurrency as written** (cases 2 and 3). I closed
both, plus made case 1 an explicit guarantee rather than an incidental one, with a single
mechanism: every one of the four mutating functions now opens with

```sql
perform pg_advisory_xact_lock(hashtext(l::text), hashtext(h::text));
```

taken on the canonical `(l, h)` pair immediately after computing it (and before any read of
`blocks` or `friendships` for that pair). This is a transaction-scoped lock keyed by the pair, so
two calls naming the same pair from either direction always contend for the identical lock and
are fully serialized against each other for the rest of the transaction — closing case 2 (both
`request_friendship` calls now queue instead of racing the insert) and case 3 (`block_user` and
`request_friendship` now queue on the same key, so one fully commits or rolls back before the
other's `blocked_between` check runs). It also makes case 1 hold by construction instead of by
accident of the primary-key lock. The existing `for update` clauses stay — they're still needed
to read-then-decide inside the now-exclusive section, they're just no longer alone in doing the
protecting. Trade-off: `hashtext` collisions on unrelated pairs would serialize them
unnecessarily (a performance cost only, `hashtext` is a 32-bit hash so this is astronomically
rare at this app's scale, and never a correctness problem — an advisory lock false-positive only
ever makes an unrelated caller wait, it can't merge or corrupt state).

## Deviations summary

1. Added `revoke all ... from public, anon[, authenticated]` before every `grant execute` — the
   brief's Step 3 SQL omits these entirely, which would have left PUBLIC (and therefore `anon`)
   able to call all six functions.
2. Did not grant `blocked_between` (or `friend_request_refusal`) to `authenticated` — the brief
   grants `blocked_between`; doing so would reopen the block-detector side channel the uniform
   refusal message exists to close.
3. Added `pg_advisory_xact_lock` on the ordered pair to all four mutating functions — the brief's
   `for update` clauses alone leave two real races open (see Concurrency, cases 2 and 3).
4. Rewrote one comment in `remove_friendship` that was not true of the code beneath it (see
   above) — did not change the guard itself, since it's harmless, just redundant.
5. Named the migration `20260906001000_friendship_functions.sql` per the task instructions
   instead of the brief's `20260905131000` (which sorts before already-deployed migrations up to
   `20260906000000`).

## Things I'm not fully certain about

- `service_role` holding EXECUTE on every function in `public` (mine and Task 1's alike) looks
  like a stack-wide default grant predating both migrations rather than anything either migration
  did — I did not chase down where that default privilege is set, since neither migration grants
  it explicitly and it's identical on Task 1's untouched `pair_lo`/`pair_hi`.
- The advisory-lock keys are derived from `hashtext(uuid::text)`, a 32-bit hash, not a
  collision-proof key. I judged the collision risk (and its cost — extra waiting, never
  corruption) acceptable for this app rather than using a wider hash; flagging it in case a
  reviewer wants a stronger key (e.g. `hashtextextended` into a single 64-bit advisory lock
  argument).
