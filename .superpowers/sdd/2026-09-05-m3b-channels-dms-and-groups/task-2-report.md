# Task 2 report — who may open what

## Status: done, both gates green, committed to `main` (not pushed)

Commit: `ff63dbf` — "feat(chat): dms with friends and opponents, mutual-friend groups"

## Files changed

- `supabase/migrations/20260907001000_channel_functions.sql` (new) — `are_friends`, `share_a_live_match`, `open_dm`, `create_group`, `add_to_group`, `leave_channel`.
- `supabase/tests/channels.test.ts` (appended) — 6 new tests inside the existing `describe('channels and membership', ...)` block, plus `befriend()` and `openDm()` helpers.
- `app/vitest.db.config.ts` (modified) — added `fileParallelism: false`. See "Deviation" below; this was required to make `check:db` pass and is not a test change.

Migration is named `20260907001000_channel_functions.sql` per your correction, not the brief's `20260905141000` (which sorts before the already-deployed `20260906002000`).

## The two corrections, applied

1. **`is_channel_member(p_channel)` — one argument.** `add_to_group` calls `public.is_channel_member(p_channel)`, not the brief's two-argument form. Verified against Task 1's migration (`20260907000000_channels_and_members.sql`), which defines it exactly this way and documents why a two-argument variant was rejected.

2. **`are_friends` and `share_a_live_match` granted to nobody.** The migration ends with:
   ```sql
   revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
   revoke all on function public.share_a_live_match(uuid, uuid) from public, anon, authenticated;
   ```
   and no `grant execute ... to authenticated` for either — only the four client RPCs get that grant. Each function's grant block carries a comment stating why it is deliberately unreachable from a client (probing arbitrary pairs for friendship / live-match status would recreate the leak the `friendships` SELECT policy and `blocked_between`'s non-grant already exist to prevent). Confirmed both are still callable from inside `open_dm`/`create_group`/`add_to_group` because those are themselves `security definer` and reach them as the owner (same pattern already proven by `blocked_between`, which has been non-granted since M3a and is called successfully from `request_friendship` etc.).

## TDD sequence

**Step 1 — failing run**, before the migration existed on disk being applied to the running DB (file was written, but `db:reset` had not yet run):

```
cd app && npm run check:db > /tmp/db_fail.log 2>&1; echo "EXIT=$?"
EXIT=1
```
```
❯ ../supabase/tests/channels.test.ts (11 tests | 6 failed) 222ms
  → function public.open_dm(unknown) does not exist
  → function public.create_group(unknown, uuid[]) does not exist
...
Test Files  1 failed | 10 passed (11)
     Tests  6 failed | 185 passed (191)
```
Matches the brief's expected failure exactly.

**Step 2 — apply migration:**
```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET_EXIT=$?"
RESET_EXIT=0
```
(applied cleanly through `20260907001000_channel_functions.sql`, last in the list)

**Step 3 — passing run:**
```
cd app && npm run check:db > /tmp/db_pass.log 2>&1; echo "EXIT=$?"
EXIT=1   <-- see "Deviation" below, this was social.test.ts, not channels.test.ts
```
`channels.test.ts` itself was fully green (191 total, 188 passed at that point, the 3 failures were all in `social.test.ts`). Traced, fixed (see below), then:
```
cd app && npm run check:db > /tmp/db_final.log 2>&1; echo "EXIT=$?"
EXIT=0
Test Files  11 passed (11)
     Tests  191 passed (191)
```
Ran twice more to rule out flakiness/starvation — both times `EXIT=0`, `191 passed (191)`, ~5s wall time (not a starved run).

**`npm run check`:**
```
cd app && npm run check > /tmp/check_full.log 2>&1; echo "EXIT=$?"
EXIT=0
Test Files  87 passed (87)
     Tests  1233 passed (1233)
```
Unchanged from baseline, as required.

## ACL verification

```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('are_friends','share_a_live_match','open_dm','create_group','add_to_group','leave_channel') order by 1;"
```
Output:
```
add_to_group|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
are_friends|postgres=X/postgres | service_role=X/postgres
create_group|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
leave_channel|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
open_dm|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
share_a_live_match|postgres=X/postgres | service_role=X/postgres
```
`are_friends` and `share_a_live_match` show no `authenticated` entry — nobody but the owner and `service_role` (superuser-equivalent, expected on every function) can execute them. The four client RPCs all carry `authenticated`. No bare `=X/postgres` (PUBLIC) on any row.

## Deviation: `app/vitest.db.config.ts` gained `fileParallelism: false`

Not in the brief, not a test file named in your instructions, but required to get `check:db` to `EXIT=0` without weakening any test.

**What happened:** after the migration applied, `channels.test.ts` was 100% green, but `social.test.ts` failed 3 tests, all with the same shape — `expected [...] to have a length of +0 but got 1` (or 2) — on lines that run `sql(`select * from public.friendships`)` (the raw superuser connection, RLS bypassed) and assert the **entire table** is empty at that point in the test. That assumption was safe as long as no other test file wrote to `friendships` — which was true before Task 2. My new `befriend()` helper in `channels.test.ts` (required by your corrected tests) inserts rows into that same global table. Vitest's default cross-file parallelism runs test files as concurrent workers against the same live Postgres instance, so an insert from `channels.test.ts` could land while `social.test.ts`'s global-count assertion was mid-flight.

**How I confirmed it was a race, not a migration bug:** ran the same suite with `npx vitest run --config vitest.db.config.ts --fileParallelism=false` — 191/191 passed immediately, no code changes. The failure was deterministic across repeated normal runs (not intermittent in the way a timing-sensitive flake usually is), which is consistent with this machine's workers finishing in a very consistent relative order run-to-run, not with test breakage.

**Fix:** added `fileParallelism: false` to `vitest.db.config.ts` with a comment explaining why (files share one live database and some assertions read whole shared tables, so they need to run one at a time, which is what they already implicitly assumed). This touches no assertion in any test file — nothing was weakened, skipped, or made less strict. Verified stable across three subsequent `check:db` runs, all `191 passed (191)`, `EXIT=0`, ~5s each (comfortably below the starvation-timeout territory called out in your instructions).

I did not touch `social.test.ts` itself — its global-table assertions are legitimate for a suite that runs its files serially, which is now guaranteed.

## Things I verified but did not need to change

- `matches.state` check constraint (`20260905124000_match_reports_and_rounds.sql`) is `('paired', 'reported', 'confirmed', 'mismatch', 'disputed', 'unverified', 'abandoned')`. The brief's `share_a_live_match` uses `state in ('paired', 'reported', 'mismatch', 'disputed')` — this is not a stale/wrong list, it's the exact same "live match" state set already used by the friend-code visibility policy in that same migration (line ~121), so I kept it verbatim rather than treating it as a deviation.
- `pair_lo`/`pair_hi` are granted to `authenticated` in production already (via `20260906002000_friend_codes_and_blocked_matchmaking.sql`, because an RLS policy calls them directly as the querying role) — irrelevant to my functions since mine only call them from inside `security definer` bodies, but I confirmed the grant exists so nothing here depends on it being otherwise.
- Re: "duplicate `const` names" warning — reviewed the brief's test snippets for the specific footgun; the refactor to `refusal()` for the uniform-refusal test (below) uses three distinctly-named captures (`stranger`, `blocked`, `nonexistent`) rather than reusing a name, so this didn't surface for me, but I didn't find an obvious literal duplicate-const bug elsewhere in the brief's other snippets either — flagging in case you were pointing at something I didn't spot.

## The uniform-refusal test, as required

Rewrote the brief's three separate `.rejects.toThrow(/cannot be messaged/)` assertions into one test using `refusal()` (a thunk, per its real signature) that captures all three messages and compares them with `toBe`, not three independent regex checks:

```ts
it('refuses a dm with a stranger, and gives the identical refusal to a blocked user and a nonexistent profile', async () => {
  const stranger = await refusal(() => openDm(ann, bob));
  expect(stranger.message).toMatch(/cannot be messaged/);

  await befriend(ann, bob);
  await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${bob}')`);
  const blocked = await refusal(() => openDm(bob, ann));
  const nonexistent = await refusal(() => openDm(ann, randomUUID()));

  expect(blocked.message).toBe(stranger.message);
  expect(nonexistent.message).toBe(stranger.message);
});
```
This is a strictly stronger check than the brief's version: it proves the three refusal paths produce the exact same string object-content, not just that each independently matches a loose pattern.

## Tests added (6, all passing)

1. `opens a dm with a friend, and returns the same channel twice` — friend path + the race-safe re-select both directions.
2. `opens a dm with an opponent you share a live match with, without a friendship` — `share_a_live_match` path, no friendship row at all.
3. `refuses a dm with a stranger, and gives the identical refusal to a blocked user and a nonexistent profile` — the uniform-refusal test above.
4. `creates a group only out of the creator s own friends` — deny (not-yet-friends-with-cal) then allow once befriended, 3-member group.
5. `lets a member add their own friend, and refuses to add a stranger` — bob (a member, friends with ann but not cal) is refused, then succeeds once bob and cal are friends — proves the check is against the ADDER's friendships.
6. `refuses to add someone to a group they are not a member of` — cal (friends with both ann and bob, but not a channel member) is refused with "not a member".

## Concerns / things I'm not fully certain about

- `fileParallelism: false` slows `check:db` slightly (files now run one at a time instead of concurrently) but the measured wall time was ~5s for the full 11-file, 191-test suite — well within normal bounds, not a starvation risk on its own. If a future task adds many more DB test files this could grow; flagging in case that tradeoff needs revisiting later, but for now it's the correct fix for a real, reproducible cross-file race, not a workaround for something more of my own tests should have avoided.
- I did not attempt to instead scope `channels.test.ts`'s `afterEach` to run before other files could see the data, or serialize only the two colliding files — `fileParallelism: false` is coarser (applies to the whole `check:db` suite) but is also the honest fix: the shared-table assumption in `social.test.ts` was never file-local to begin with, so any two files that both eventually touch `friendships` will have the same problem, not just these two.
- Did not push, per explicit instruction to not push, even though this repo's standing "ship without asking" note would otherwise apply — the task's own explicit instruction takes precedence.
