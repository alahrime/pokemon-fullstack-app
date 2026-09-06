# Task 8 report — `app/tools/m3b-roundtrip.ts`

Branch: `main`. Commit: `703efea` — "test(tools): dm, group and match channel, two real accounts".

## Summary

`app/tools/m3b-roundtrip.ts` creates three real accounts through the actual
signup + Mailpit confirmation path, then drives all eight required checks
through the shipping `src/lib/channels.ts` and `src/lib/social.ts` modules
against the real local Postgres, PostgREST, and Realtime server. Two runs in
a row: **13/13 passed** (the 8 checks + a registration/format-setup gate +
one cleanup-verification check), **exit code 0** both times. `npm run check`:
**1256/1256 tests, exit 0**.

## How emails were made unique

`const stamp = \`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}\`;`
— timestamp plus a few bytes of `Math.random()`, not the timestamp alone, so
two runs launched inside the same millisecond can't collide on `auth.users`'
unique email constraint. Emails: `m3b-${stamp}-bot{1,2,3}@example.test`. This
run's stamp was `mtpx20z1-r1jnxd`.

All three accounts went through `supabase.auth.signUp()` → polled Mailpit
(`http://127.0.0.1:54324`) for the confirmation email → followed the
`/auth/v1/verify` link → signed in → polled `profiles` until PostgREST
accepted the token and the row existed (confirming `handle_confirmed_user()`
had actually run and built the profile every foreign key here points at).
No admin-confirm shortcut was used anywhere.

## The two-client trick for check 3

Every other check drives both bots through the app's single `supabase`
singleton, signing in as whichever bot acts immediately before it acts — fine
sequentially. Check 3 needed bot2's `subscribeToChannel` to stay
authenticated and joined as bot2 for the whole wait while bot1 sent — signing
bot1 in on that same singleton mid-wait would have pushed a new access token
to bot2's already-joined realtime channel (Supabase does this on every
sign-in) and started testing something murkier than "bot2, as itself,
receives what bot1 sent." So bot1's one send in check 3 goes out on a second,
genuinely independent `createClient()` instance — built from the same public
anon key the app ships (`import.meta.env.VITE_SUPABASE_ANON_KEY`), never a
hardcoded second key — while bot2's subscription stays on the untouched
singleton throughout. This is exactly what a second real browser tab would
be. Every other check (1, 2, 4-8) uses the shipping functions on the single
singleton, matching the pattern in `m3a-roundtrip.ts` / `m2b-roundtrip.ts`.

## The eight checks — full run output

```
M3b round trip — run mtpx20z1-r1jnxd

before this run (shared local stack, informational only): {"profiles":19,"channels":0,"messages":0,"matches":0}

PASS  0a. bot1 registers, confirms through Mailpit, and gets a profile
        bot1 d3cf3759-b424-4a5c-9cdd-c4886c3ee956 <m3b-mtpx20z1-r1jnxd-bot1@example.test>
PASS  0b. bot2 registers, confirms through Mailpit, and gets a profile
        bot2 0ac896f4-8c9f-451c-8e89-01f1e03675e1 <m3b-mtpx20z1-r1jnxd-bot2@example.test>
PASS  0c. bot3 (the throwaway, friend of neither) registers and gets a profile
        bot3 a9228315-f2ae-4182-8245-ae4585b8a482 <m3b-mtpx20z1-r1jnxd-bot3@example.test>
PASS  0d. a format_versions row exists for check 4's match to reference
        format_versions 3a2f04be-ab7e-400f-9bbe-cd531d72f925, rules_hash 4f945e60fc4712f576ab3fb1f2f5c33fbe4af085fedfc8df2ec8a633cf56b399
PASS  1. not yet friends: openDm(bot1) from bot2 raises exactly "that person cannot be messaged"
        openDm(bot2 -> bot1) before any friendship raised: "that person cannot be messaged"
PASS  2. befriending through the real RPCs makes openDm return a channel id; the OTHER bot gets the SAME id
        requestFriendship -> 'pending'; respondToFriendship(accept) -> 'accepted'; openDm from both bots returns the same channel df1c9a3a-f15a-4cd1-ba8b-100fa0645342
PASS  3. THE CHECK THIS SCRIPT EXISTS FOR: bot1 sends into the DM; bot2's live subscribeToChannel delivers it within 5s
        bot1 sent message f108d103-1314-4006-bf26-b3a1064346c1 on a second client; bot2's subscribeToChannel delivered it live, well under 5s (author d3cf3759-b424-4a5c-9cdd-c4886c3ee956)
PASS  4. a match between bot1 and bot2 (service role) gets a match channel; both are members and both can listMessages on it
        match f60411aa-b66d-4500-9df8-27cbbbbc7e58 -> channel e1c6354e-e6b0-40cd-a52a-f2f425a7c70c; both bot1 and bot2 see it in listChannels() and both can listMessages() on it
PASS  5. bot2 reports bot1's realtime-probe message; bot1's own read of message_reports for it returns ZERO rows
        reportMessage(bot2, msg f108d103-1314-4006-bf26-b3a1064346c1) -> report 531ac89a-43f1-48a6-aa1a-b7e99d3f59cc; bot1's own select on message_reports for it returns exactly 0 rows
PASS  6. forcing that message's expires_at into the past and running sweep_messages: it SURVIVES because its report is still open
        expires_at forced to 2026-09-06T14:36:58.063Z; sweep_messages() removed 0 row(s) total; message f108d103-1314-4006-bf26-b3a1064346c1 still exists — its open report held it
PASS  7. bot3, a throwaway friend of neither, sees none of the DM or match channels in its own listChannels()
        bot3's listChannels() returns 0 channel(s), none of them the DM (df1c9a3a-f15a-4cd1-ba8b-100fa0645342) or the match channel (e1c6354e-e6b0-40cd-a52a-f2f425a7c70c)
PASS  8. bot1 blocks bot2: bot2 sending into the shared DM is refused; bot1 sending still succeeds (one-directional)
        blockUser(bot1 -> bot2) -> true; bot2's sendMessage raised "new row violates row-level security policy for table "messages""; bot1's own sendMessage still succeeded (message c7ecfe74-b530-4904-8bb5-2cdadc3cce5a)
PASS  cleanup. every row this run created is gone
        auth.users: 0 of 3 accounts remain; channels created_by these bots: 0; messages authored by these bots: 0; message_reports filed by these bots: 0; matches involving these bots: 0

after cleanup (shared local stack, informational only): {"profiles":19,"channels":0,"messages":0,"matches":0}

13 passed, 0 failed
```

A second run (fresh stamp, all accounts recreated) produced the identical
result — 13 passed, 0 failed, exit 0 — confirming this isn't a one-off pass.

## Cleanup and how it was verified

Cleanup order (dependency-driven): delete the `matches` row (service role;
`format_versions` is `ON DELETE RESTRICT` from `matches`, so this must go
first or the format delete below is refused) → delete bot1's saved
`formats`/`format_versions` (as bot1, through `deleteServerFormat`) → delete
all three `auth.users` rows (service role; GoTrue owns that table, and the
cascade from the profile it carries takes the DM channel — created by bot1 —
and everything written into it, plus friendships/blocks/message_reports,
with it).

Verification is a dedicated `verifyCleanup()` step folded into the same
pass/fail ladder (so a leak here fails the script's exit code, not just a
printed warning): it counts, scoped to this run's three account ids
specifically, `auth.users`, `channels.created_by`, `messages.author_id`,
`message_reports.reporter_id`, and `matches` involving either player. All
five came back zero. Additionally, informational **before/after** global
counts of `profiles`/`channels`/`messages`/`matches` (the whole shared local
stack, not just this run) are printed at start and end — they matched exactly
(`{"profiles":19,"channels":0,"messages":0,"matches":0}` both times), which
is the honest broader signal but not the load-bearing assertion (another
fixture running concurrently on this machine could move those legitimately;
the scoped per-run check is what actually gates the exit code).

## What check 3 proved

`bot1` sent one message on an independent client holding its own session;
`bot2`'s subscription — the real `subscribeToChannel` from
`src/lib/channels.ts`, on the app's own singleton — received it via a live
`postgres_changes` event well inside the 5-second budget, with the correct
`id`, `authorId`, and `body`. This is the one thing in the entire project
that exercises the `supabase_realtime` publication end to end: I confirmed
independently via
`docker exec supabase_db_paragon-iv psql -U postgres -tAc "select tablename from pg_publication_tables where pubname='supabase_realtime'"`
that `messages` is currently in the publication, and check 3 is the thing
that would go silently red (an empty chat, no error) if a future migration
ever dropped it — no unit test or SQL-level test can see that at all.

## What the script revealed about the product

Nothing wrong. Every one of the eight checks passed on the first attempt with
no workaround, no weakened assertion, and no check disabled. Two things
worth recording as confirmed-intentional rather than surprises:

- Check 8's refusal message is a raw Postgres RLS error
  (`new row violates row-level security policy for table "messages"`), not a
  friendly application-level sentence — consistent with `messages` having no
  application-level block check function of its own (`blocked_with_me` lives
  inside the RLS policy itself, not behind a raised exception like
  `open_dm`/`request_friendship`). This is exactly Ruling B5 in the progress
  ledger (2026-09-06): a block being detectable by a participant is accepted
  behaviour, and the check asserts the refusal happens, not that it's
  disguised.
- Check 4's `matches` insert (service role) fired `create_match_channel()`'s
  `AFTER INSERT` trigger correctly and gave both players a `kind='match'`
  channel in one shot, with no extra step needed from this script.

## Things I'm not fully certain about

- The 1500ms delay before bot1 sends in check 3 (to let bot2's realtime join
  complete before the send) is a fixed sleep rather than an explicit
  "SUBSCRIBED" signal — `subscribeToChannel` doesn't expose a join-status
  callback, so there's no clean way to await the join deterministically
  through the shipping function as written. In two runs this was never close
  to the 5-second budget, but on a slower CI box a much slower join could in
  theory need a longer pre-send delay before the 5s receive-side timer even
  starts being fair. I did not modify `channels.ts` to add a status hook,
  per the "don't touch `src/`" instruction.
- I did not exercise `createGroup`/`addToGroup`/`markRead` in this script —
  they're part of the interface list in the task prompt but none of the
  eight required checks call for a group, so I left them unimported to avoid
  unused-import lint noise. If the Definition of Done's "create a group" item
  (driven by hand through two browser origins) still needs an automated
  companion, it isn't here.

## Commands run

```
cd app && npx supabase status --workdir .. | grep SERVICE_ROLE_KEY
./node_modules/.bin/esbuild tools/m3b-roundtrip.ts --bundle --platform=node --format=esm \
  --outfile=node_modules/.cache/m3b.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY="$KEY" node node_modules/.cache/m3b.mjs > /tmp/rt.log 2>&1; echo "RT=$?"
npm run check > /tmp/check1.log 2>&1; echo "CHECK=$?"
```

Results: `RT=0` (both runs), `CHECK=0` (1256/1256 tests).
