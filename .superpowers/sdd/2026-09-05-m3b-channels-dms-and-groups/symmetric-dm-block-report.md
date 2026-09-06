# Product decision: a block is symmetric in a DM, directional elsewhere

## The bug this closes

`blocked_with_me(p_other)` only ever asked "did `p_other` block ME". After Ann
blocked Bob in their shared DM:

- Bob's inserts were refused (correct).
- Ann could keep posting, and Bob — still a channel member, still covered by
  the unchanged SELECT policy, still subscribed over realtime — kept
  receiving every message live, unable to answer. `block_user` tears down the
  friendship but never touches the channel, so this one-way line persisted
  indefinitely.

That is a harassment primitive inside the feature built to prevent
harassment. Product ruling (2026-09-06):

- **DM (`channels.kind = 'dm'`)**: the block is **symmetric**. Once either
  party has blocked the other, **neither** may post into that channel.
- **Group or match channel**: **unchanged, directional**. A room can hold
  members beyond the two parties to a block; a symmetric rule there would let
  one blocker mute themselves to every other member over a block aimed at
  just one person.

## What changed

### `supabase/migrations/20260907003000_messages.sql` (edited in place — unpushed, never touched production)

1. **New function `public.i_blocked(p_other uuid)`** — the caller-scoped
   mirror of `blocked_with_me`. `blocked_with_me` answers "did `p_other` block
   me"; `i_blocked` answers "did I block `p_other`". Both derive one side of
   the pair from `auth.uid()` internally, so a caller can only ever ask about
   a pair they are actually part of — that's what makes granting either safe,
   unlike the two-argument, `security definer` `blocked_between`, which
   bypasses RLS and answers for *any* pair and stays deliberately ungranted to
   `authenticated` (verified below).

   ```sql
   create or replace function public.i_blocked(p_other uuid)
   returns boolean
   language sql
   stable
   security definer
   set search_path = public
   as $fn$
     select exists (
       select 1 from public.blocks
        where blocker_id = (select auth.uid()) and blocked_id = p_other
     )
   $fn$;

   revoke all on function public.i_blocked(uuid) from public, anon, authenticated;
   grant execute on function public.i_blocked(uuid) to authenticated;
   ```

   The revoke names all **three** roles (`public, anon, authenticated`)
   before the grant, per this project's rule that two is not enough — this
   stack's default privileges already grant `authenticated` execute on a new
   function, so a revoke naming only `public, anon` would leave that default
   grant standing until the explicit `grant` line papered over it by
   coincidence.

2. **INSERT policy `"a member who is not blocked may post"`** — added a
   `kind = 'dm'`-gated branch:

   ```sql
   and not exists (
     select 1
       from public.channel_members other
      where other.channel_id = messages.channel_id
        and other.user_id <> (select auth.uid())
        and (
          public.blocked_with_me(other.user_id)
          or (
            public.i_blocked(other.user_id)
            and exists (
              select 1 from public.channels c
               where c.id = messages.channel_id and c.kind = 'dm'
            )
          )
        )
   )
   ```

   In a DM the loop's only "other" row *is* the whole other side of the
   block, so asking `i_blocked` about them enforces the symmetric rule
   exactly. In a group or match, the extra clause is always false (the
   channel's `kind` fails `= 'dm'`), leaving only `blocked_with_me` —
   unchanged and directional.

3. Did **not** touch the UPDATE policy ("an author may edit or soft-delete
   their own message") — the task scoped this change to the INSERT policy
   specifically, and the UPDATE policy's block clause still uses only
   `blocked_with_me`, unchanged.

4. Did **not** reach for `blocked_between`, and did not widen `i_blocked` to
   take both sides as arguments — both were explicitly forbidden and remain
   forbidden by the comments above each function.

### `app/tools/m3b-roundtrip.ts` — check 8, deliberately reversed

**This is a behaviour change, not a weakening.** Check 8 used to assert:
> "bot1 blocks bot2: bot2 sending into the shared DM is refused; bot1 sending
> still succeeds (one-directional)"

That assertion is now **wrong** under the product ruling — it describes
exactly the one-way-loudspeaker bug the ruling exists to close. It now
asserts:
> "bot1 blocks bot2: a DM block is SYMMETRIC — neither bot2 nor bot1 (the
> blocker) can post into the shared DM"

Both bot2's and bot1's `sendMessage` calls are now expected to raise, and the
test fails loudly if either one *doesn't* raise. The file's header comment
was also updated to explain the reversal and why a DM (exactly two members,
nobody else to protect) is different from a group or match channel.

### `supabase/tests/channels.test.ts`

- **Rewrote** `'stops a blocked person posting into a dm they already share'`
  → `'stops both parties posting into a dm once either has blocked the
  other'`. It used to end with `// And ann can still post; a block is
  one-directional.` followed by a successful insert as ann — the assertion
  the product ruling reverses. It now asserts **both** ann's and bob's
  inserts are refused (`POLICY_DENIED`), with a comment stating this is a
  deliberate behaviour change, not a weakening.

- **Added** `'stops both parties posting into a dm when the SECOND party is
  the one who blocked'` — same shape, block placed by bob instead of ann, to
  confirm the symmetry doesn't depend on which side of the pair placed the
  block (exercises `i_blocked` from both members' points of view).

- **Added** `'keeps a block directional in a group: the blocked member cannot
  post, the blocker still can'` — three-member group (ann, bob, cal); ann
  blocks bob; bob's insert is refused, but **both** ann's and cal's inserts
  still succeed. This is the test that stops a future "simplification" of the
  rule into symmetric-everywhere: cal, an innocent third member, must be
  completely unaffected by a block ann placed on someone else.

All three new/changed tests run as the real `authenticated` role via
`asUser({ sub: ... })`, never as `postgres` (a superuser would pass either
way and prove nothing).

## Verification

### `npm run db:reset`

```
$ cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail of `/tmp/reset.log` confirms every migration through
`20260907003000_messages.sql` and `20260907004000_pins_and_reports.sql`
applied cleanly, ending `Finished supabase db reset on branch main.` /
`{"target":"local","version":"","message":"Reset local database."}`.

### `npm run check:db`

```
$ cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail of `/tmp/db.log`:
```
 Test Files  11 passed (11)
      Tests  212 passed (212)
```
212 (was 210) — the two net-new tests (the reversed-direction DM test and the
group-directional test) plus one test rewritten in place.

### `npm run check`

```
$ cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
```
Tail of `/tmp/app.log`:
```
 Test Files  89 passed (89)
      Tests  1256 passed (1256)
```

### ACL verification

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('blocked_with_me','i_blocked','blocked_between') order by 1;"

blocked_between|postgres=X/postgres | service_role=X/postgres
blocked_with_me|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
i_blocked|postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
```

- `i_blocked`: granted to `authenticated` (and `service_role`/owner), exactly
  as intended.
- `blocked_with_me`: unchanged, still granted to `authenticated`.
- `blocked_between`: **still ungranted** to `authenticated`/`anon`/`public` —
  no ACL entry for either role, only owner (`postgres`) and `service_role`.
  Confirms it stays unreachable from a signed-in client, as required.

### Roundtrips (waited well past 60s after `db:reset` — the realtime
container had been up 2 minutes by the time these ran, per
`docker ps --filter name=supabase_realtime_paragon-iv` showing
`Up 2 minutes (healthy)`)

```
m2b EXIT=0 :: 11 passed, 0 failed
m3a EXIT=0 :: 9 passed, 0 failed
m3b EXIT=1 :: failed: 3. THE CHECK THIS SCRIPT EXISTS FOR: bot1 sends into the DM; bot2's live subscribeToChannel delivers it within 5s
```

m3b's failure was check 3 — the realtime-delivery-within-5s probe, which is
unrelated to this change (it tests the `supabase_realtime` publication /
websocket delivery timing, not RLS). Its own failure message is exactly the
"TIMED OUT after 5000ms" pattern this machine is known to produce under load,
not breakage. Check 8 — the one this task is actually about — **passed** on
this same run:
```
PASS  8. bot1 blocks bot2: a DM block is SYMMETRIC — neither bot2 nor bot1 (the blocker) can post into the shared DM
        blockUser(bot1 -> bot2) -> true; bot2's sendMessage raised "new row violates row-level security policy for table "messages""; bot1's own sendMessage (the blocker) also raised "new row violates row-level security policy for table "messages""
```

Per instructions, re-ran m3b once (not "fixing" the flake):
```
m3b(retry) EXIT=0 :: 13 passed, 0 failed
```
13/13 clean on retry — confirms starvation, not a real regression. Both
numbers are reported here as required: first run 12 passed / 1 failed
(realtime timing only), retry 13 passed / 0 failed.

## Per-test statement of what changed and why

| Test | File | What changed | Why |
|---|---|---|---|
| Check 8 | `app/tools/m3b-roundtrip.ts` | Reworded from "one-directional" to symmetric; bot1's post-block send now asserted **refused** instead of **succeeding** | Product ruling: a DM block silences both parties. The old assertion described the exact harassment primitive (blocker keeps broadcasting to a blocked victim) the ruling exists to close. |
| `'stops a blocked person posting into a dm they already share'` → `'stops both parties posting into a dm once either has blocked the other'` | `supabase/tests/channels.test.ts` | Removed the trailing "ann can still post; a block is one-directional" assertion; both ann's and bob's inserts now asserted refused | Same product ruling, SQL-level enforcement test |
| `'stops both parties posting into a dm when the SECOND party is the one who blocked'` (new) | `supabase/tests/channels.test.ts` | Added | Confirms symmetry holds regardless of which party placed the block (exercises `i_blocked` from both members) |
| `'keeps a block directional in a group: the blocked member cannot post, the blocker still can'` (new) | `supabase/tests/channels.test.ts` | Added | Confirms the directional rule is preserved outside a DM — the guard against "simplifying" this into symmetric-everywhere |

## Files touched

- `/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260907003000_messages.sql`
- `/Users/alilahrime/Downloads/paragon-iv/app/tools/m3b-roundtrip.ts`
- `/Users/alilahrime/Downloads/paragon-iv/supabase/tests/channels.test.ts`

## Concerns

- None outstanding. `blocked_between` confirmed still ungranted; all gates
  green; the one roundtrip failure was the documented realtime-timing flake,
  confirmed by a clean retry, and unrelated to the RLS change.
