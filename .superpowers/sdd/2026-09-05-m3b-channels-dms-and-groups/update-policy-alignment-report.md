# UPDATE policy alignment with INSERT — report

## What changed

`supabase/migrations/20260908000000_group_and_match_blocks_stop_muting_the_whole_room.sql`
was edited in place (it is unpushed and never touched production; the earlier
`20260907004000` and older migrations were left untouched, as required).

1. **UPDATE policy rewritten.** Dropped `"an author may edit or soft-delete
   their own message"` (originally created in the deployed
   `20260907003000_messages.sql`) and replaced it with `"an author who is not
   blocked in a dm may edit or soft-delete their own message"`. The new
   policy's `WITH CHECK` block clause is now structurally identical to the
   INSERT policy's: DM-only scope (`exists (... c.kind = 'dm' ...)`) and the
   symmetric `blocked_with_me(other.user_id) OR i_blocked(other.user_id)`
   check inside it. `USING (author_id = auth.uid())` is unchanged — only the
   author's own rows are ever candidates for this policy.
2. **Comments rewritten.** The migration's top banner now says it rewrites
   BOTH the INSERT and UPDATE policies and why (an edit/soft-delete is a
   posting action — it puts content, or a changed form of it, in front of a
   channel's members). A new section, `THE UPDATE POLICY GETS THE IDENTICAL
   BLOCK CLAUSE, IN THIS SAME MIGRATION`, explains the two bugs UPDATE had
   (the same group/match scope bug INSERT had, plus its own directional-only
   bug in a DM) and states explicitly that `messages_protect_columns` (in
   `20260907003000_messages.sql`, deployed, untouched) is not weakened —
   nothing in this change touches that trigger.
3. **Nothing else in the UPDATE policy changed.** `messages_protect_columns`
   (the immutability trigger blocking `channel_id`/`author_id`/`created_at`/
   `expires_at` changes) still lives, unmodified, in `20260907003000_messages.sql`.

Verified directly against `pg_policy` after `db:reset` that INSERT and UPDATE
`WITH CHECK` expressions are now structurally identical:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
    "select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.messages'::regclass order by polname;"

a member who is not blocked in a dm may post|((author_id = ( SELECT auth.uid() AS uid)) AND is_channel_member(channel_id) AND (NOT (EXISTS ( SELECT 1
   FROM channels c
  WHERE ((c.id = messages.channel_id) AND (c.kind = 'dm'::text) AND (EXISTS ( SELECT 1
           FROM channel_members other
          WHERE ((other.channel_id = messages.channel_id) AND (other.user_id <> ( SELECT auth.uid() AS uid)) AND (blocked_with_me(other.user_id) OR i_blocked(other.user_id))))))))))
a message is visible to the channel's members|
an author who is not blocked in a dm may edit or soft-delete th|((author_id = ( SELECT auth.uid() AS uid)) AND is_channel_member(channel_id) AND (NOT (EXISTS ( SELECT 1
   FROM channels c
  WHERE ((c.id = messages.channel_id) AND (c.kind = 'dm'::text) AND (EXISTS ( SELECT 1
           FROM channel_members other
          WHERE ((other.channel_id = messages.channel_id) AND (other.user_id <> ( SELECT auth.uid() AS uid)) AND (blocked_with_me(other.user_id) OR i_blocked(other.user_id))))))))))
```

## Covering tests

Added to `supabase/tests/channels.test.ts`, all run as a real `authenticated`
role via the suite's `asUser` helper (never as `postgres`):

- `lets a group member edit their own message after another member blocks
  them` — (a) the scope fix: bob, blocked by ann elsewhere in the same
  8-... group (3 members here), can still edit his own message.
- `stops the blocker editing their own earlier dm message once they have
  blocked the other party` — (b) symmetry: ann blocks bob in a DM; ann (the
  blocker) is refused editing her own earlier message in that DM.
- `stops the blocked party editing their own earlier dm message once the
  other has blocked them` — (c) bob (the blocked party) is also refused
  editing his own earlier message in that DM.
- `lets an author with no blocks anywhere edit body and soft-delete their own
  message` — (d) the ordinary case is unaffected: body edit and
  `deleted_at` both succeed. (An existing test, `still lets an author edit
  body and soft-delete their own message`, already covered this case; this
  new one keeps it explicit next to the three new block-path tests.)

## Commands and output

```
$ cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
EXIT=0
... Applying migration 20260908000000_group_and_match_blocks_stop_muting_the_whole_room.sql...
Finished supabase db reset on branch main.

$ cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  11 passed (11)
      Tests  217 passed (217)
```

217/217, up from 213 (4 new tests added; +217 confirms the target of "at
least 217").

```
$ cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=1
 Test Files  4 failed | 85 passed (89)
      Tests  4 failed | 1258 passed (1262)
```

All 4 failures were `Test timed out in 5000ms` in files this change never
touched: `pager.test.tsx`, `screen-leaves.test.tsx`, `team-builder.test.tsx`,
`team-saves.test.tsx`. Re-ran once per the machine-starvation protocol:

```
$ cd app && npm run check > /tmp/app2.log 2>&1; echo "EXIT=$?"
EXIT=1
 Test Files  3 failed | 86 passed (89)
      Tests  4 failed | 1258 passed (1262)
```

Same total (1258/1262), but a DIFFERENT set of specific failing tests within
the same unrelated files (e.g. `warns via the load notice...` and `saves the
name exactly as typed` in `team-saves.test.tsx` failed the second time
instead of `replaces the roster outright...`). Non-deterministic timeouts
moving between runs, in files with no relationship to `messages`/`channels`/
RLS, is the machine-starvation signature this task's constraints describe,
not a regression from this change. Not "fixed" — reported as-is, both runs.

## Revert experiment (pinning check)

1. Temporarily replaced the new UPDATE policy's `WITH CHECK` with the OLD
   clause (unconditional `blocked_with_me` across every channel kind, no
   `i_blocked`, no DM scoping) — everything else in the migration file left
   as-is.
2. `npm run db:reset > /tmp/revert_reset.log 2>&1; echo "EXIT=$?"` → `EXIT=0`
3. `npm run check:db > /tmp/revert_db.log 2>&1; echo "EXIT=$?"` → `EXIT=1`

```
 FAIL  ../supabase/tests/channels.test.ts > channels and membership >
       lets a group member edit their own message after another member blocks them
PostgresError: new row violates row-level security policy for table "messages"

 FAIL  ../supabase/tests/channels.test.ts > channels and membership >
       stops the blocker editing their own earlier dm message once they have blocked the other party
Error: expected this statement to be refused, and it SUCCEEDED

 Test Files  1 failed | 10 passed (11)
      Tests  2 failed | 215 passed (217)
```

Exactly the predicted pair failed and nothing else:
- Test (a) failed under the OLD clause because it is unscoped by channel
  kind — bob's edit in the group is refused by the old `blocked_with_me`
  check, which the fix was supposed to remove.
- Test (b) failed under the OLD clause because `blocked_with_me` is
  directional — it asks "did the OTHER party block ME", so ann (the
  blocker) checking `blocked_with_me(bob)` is false and her edit is
  wrongly ALLOWED under the old rule; the test expects a refusal and got a
  success, which is exactly the assertion `refusal()` raises on a query that
  did not throw.
- Test (c) still PASSED under the OLD clause, as expected: bob (the blocked
  party) checking `blocked_with_me(ann)` is true even under the old,
  directional-only rule, so bob was already refused before this fix — that
  half of the DM behaviour was never broken, only ann's half was.
- Test (d) (ordinary case, no blocks) also still passed, as expected.

Restored the fixed clause, then re-verified clean:

```
$ npm run db:reset > /tmp/final_reset.log 2>&1; echo "EXIT=$?"
EXIT=0
$ npm run check:db > /tmp/final_db.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  11 passed (11)
      Tests  217 passed (217)
```

## Roundtrips

Waited the required 60 seconds after the final `db:reset` before running
roundtrips (realtime container restart).

```
m2b EXIT=0 :: 11 passed, 0 failed
m3a EXIT=0 :: 9 passed, 0 failed
m3b EXIT=1 :: failed: 3. THE CHECK THIS SCRIPT EXISTS FOR: bot1 sends into the DM; bot2's live subscribeToChannel delivers it within 5s
```

m3b's single failure was check 3, a live `postgres_changes` delivery within a
5-second window — not the block-policy checks 2 and 8, which both passed on
this same run (check 8 is exactly the DM-symmetric-block scenario). `docker
logs supabase_realtime_paragon-iv` showed the tenant's replication slot and
stream were still being created (`Starting stream replication for slot
supabase_realtime_messages_replication_slot_...`) essentially concurrently
with this run — a warm-up race after the container restart from `db:reset`,
not a policy regression. Retried m3b alone once the realtime container had
had more time to settle:

```
m3b retry EXIT=0 :: 13 passed, 0 failed
```

All three roundtrips green: m2b 11/11, m3a 9/9, m3b 13/13 (including check 8,
the DM-symmetric-block scenario, and check 3, the realtime-delivery check
that flaked on the first attempt).

## Concerns

- The app suite (`npm run check`) sits at 1258/1262 across both runs, with
  the same total but different individual tests failing each time — the
  documented machine-starvation signature, not something this change caused
  or something safe to "fix" by touching those files.
- The first m3b roundtrip attempt hit a realtime-container warm-up race
  (check 3's 5-second delivery window) immediately after `db:reset`; the
  retry was clean. If this task or CI is ever made non-interactive, a longer
  buffer than 60s (or a readiness probe on the realtime replication slot)
  would remove this flake source.
