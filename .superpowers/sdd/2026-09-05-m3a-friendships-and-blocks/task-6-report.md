# Task 6 report — M3a friendship/block round trip through the real client

## What was built

`app/tools/m3a-roundtrip.ts` — the only new file, modeled on `app/tools/m2b-roundtrip.ts`'s
structure, guard, bundling recipe, and house style. It imports the shipping
`app/src/lib/social.ts` (`listFriends`, `requestFriendship`, `respondToFriendship`,
`blockUser`, `listBlocks`, `unblockUser`, `Friend`, `FriendshipStatus`) and never
reimplements it. Nothing under `supabase/` or `app/src/` was touched.

## How the accounts were made unique

Two accounts are created fresh on every run, never reused and never seeded via
`opponents.ts`'s bot accounts (which are known to be wiped by repeated `db:reset`s
during this milestone). The uniqueness stamp is:

```ts
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
```

i.e. the run's timestamp base-36 PLUS 6 random base-36 characters — not the
timestamp alone, so two runs launched inside the same millisecond cannot mint
colliding emails against `auth.users`' unique constraint. Emails are
`m3a-${stamp}-bot{1,2}@example.test`. Both accounts sign up through the real
client (`supabase.auth.signUp`), pull the confirmation link out of Mailpit
(`http://127.0.0.1:54324`), and follow it — never an admin-confirm shortcut —
so `handle_confirmed_user()` fires and builds the profile that
`friendships.user_lo/user_hi/requested_by` and `blocks.blocker_id/blocked_id`
reference by foreign key. Each bot also gets a friend code
(`1111 1111 1111` / `2222 2222 2222`, matching the `friend_codes_twelve_digits`
check constraint) via signup metadata, exactly as `opponents.ts` does it.

## `blocked_between`

Never called anywhere in the script, by either bot or the admin client. It is
`security definer`, unrevealed to `authenticated`, and answers for any pair —
granting or calling it from the client half would itself be the side channel
this milestone exists to close. The service-role key is used for exactly one
thing, named at its call site: deleting the two `auth.users` rows in cleanup
(GoTrue owns that table; no client may delete from it). Deleting it cascades
the profile, and from there `friend_codes`, `friendships`, and `blocks` (all
`references profiles(id) on delete cascade`) — so no other admin step was
needed.

## Full run output — all seven checks

```
M3a round trip — run mtpawyx4-xtzlfu

PASS  0a. bot1 registers, confirms through Mailpit, and gets a profile + friend code
        bot1 882eded4-5116-4c89-91f2-2db0f2d2fc80 <m3a-mtpawyx4-xtzlfu-bot1@example.test> friend code 1111 1111 1111
PASS  0b. bot2 registers, confirms through Mailpit, and gets a profile + friend code
        bot2 3d93c113-c23d-4e4e-9509-2a8847090e98 <m3a-mtpawyx4-xtzlfu-bot2@example.test> friend code 2222 2222 2222
PASS  1. bot1 requests bot2 -> pending; bot2's listFriends() shows it with theyAsked: true
        requestFriendship(bot1 -> bot2) -> 'pending'; bot2's listFriends() shows bot1 as {status: 'pending', theyAsked: true}
PASS  2. bot2 cannot yet read bot1's friend code — ZERO ROWS through PostgREST, not an error
        bot2's select on friend_codes.profile_id = bot1.id returns exactly 0 rows, not an error
PASS  3. bot2 accepts -> accepted; now bot2 reads bot1's friend code and gets the real value
        respondToFriendship(bot2, accept) -> 'accepted'; bot2 now reads bot1's friend code as 1111 1111 1111
PASS  4. bot1 blocks bot2; bot1's listFriends() is empty; the friend-code read returns zero rows again
        blockUser(bot1 -> bot2) -> true; bot1's listFriends() is []; bot2's read of bot1's friend code is 0 rows again
PASS  5. THE CHECK THAT MATTERS: bot2's listBlocks() is empty AND listFriends() is empty — the block is invisible from the blocked side
        bot2's listBlocks() is []; bot2's listFriends() is []; the block leaves nothing for the blocked side to see
PASS  6. bot2 requesting bot1 raises exactly "that person cannot be sent a friend request" — the SAME sentence a random, nonexistent uuid produces
        both raised the identical string: "that person cannot be sent a friend request"
PASS  7. bot1 unblocks; a fresh request from bot2 returns pending again
        unblockUser(bot1, bot2) removed the block; a fresh requestFriendship(bot2 -> bot1) -> 'pending'

9 passed, 0 failed
```

`RT=0`.

Check 2 and check 4 assert on `Array.isArray(data) && data.length === 0` from an
unfiltered-by-nothing-but-`profile_id` select (`readFriendCode` in the script),
never on `.single()` or a truthy/falsy check — so a policy denial (zero rows)
cannot be confused with a `.single()` miss or a thrown error. Check 5 asserts
`listBlocks().length === 0` and `listFriends().length === 0` as two independent
assertions in the same check, both against real arrays.

## Cleanup verification — row counts before and after

Captured with `docker exec supabase_db_paragon-iv psql -U postgres -tAc "..."` (`psql` is
not installed on the host):

| table | before run | after cleanup |
|---|---|---|
| `auth.users` | 16 | 16 |
| `public.profiles` | 16 | 16 |
| `public.friendships` | 0 | 0 |
| `public.blocks` | 0 | 0 |
| `public.friend_codes` | 2 | 2 |

Additionally, `select count(*) from auth.users where email like 'm3a-%'` returned
`0` after cleanup — no stamped account survived. All five counts are exactly
back to baseline, and the leftover-scan confirms it isn't a coincidental match
(e.g. one bot's row swapped for a pre-existing one).

Cleanup itself (`cleanup()` in the script) does exactly one thing:
`admin.auth.admin.deleteUser(b.id)` for each bot, relying on the cascade chain
`auth.users -> profiles -> {friend_codes, friendships, blocks}` that already
exists in the schema (all three tables reference `profiles(id) on delete
cascade`). No manual row deletes were needed or added.

## `npm run check`

`CHECK=0`. `Test Files 87 passed (87)`, `Tests 1230 passed (1230)`. No
`Test timed out` or `no Azumarill` starvation symptoms observed — ran once,
clean.

## Commit

```
8510102b4a66054a2060d79d07d99bb5a1f43690  test(tools): friendship and block, driven by two real accounts
```

Only `app/tools/m3a-roundtrip.ts` was staged and committed (verified with
`git status --short` before commit — the working tree has several unrelated
untracked `.superpowers/` planning files and an `app/.env.local.bak` that were
deliberately left alone). Not pushed, per the task's explicit instruction.

## What the script revealed about the product

Nothing adverse — all seven checks passed on the first real run, with no check
weakened to get there. The one thing worth flagging as a genuine finding
(not a defect): check 5, the central invariant of the whole milestone, held
cleanly through the real client on the first try — `block_user`'s
`delete from friendships` plus the total absence of a blocked-side read policy
on `blocks` really do add up to zero observable signal for bot2, exactly as
designed. This had only been exercised at the SQL/RLS-policy level before;
this is the first time it's been proven through PostgREST end to end.

## Things I'm unsure about

- The brief's literal text for check 3 says bot2 should read back
  `1111 2222 3333` specifically; the top-level task instructions (which
  supersede the brief per its own "CRITICAL FACTS THE BRIEF DOES NOT KNOW"
  framing) say only "the real value." I used `1111 1111 1111` /
  `2222 2222 2222` (bot-number-derived, matching `opponents.ts`'s own
  convention) rather than hardcoding the brief's literal digits, and the
  script asserts the value it reads back equals the value it wrote at signup
  — which is the substantive check either way.
- I did not additionally exercise `removeFriendship` (imported by the brief's
  "Interfaces you consume" list in the brief file but not by the top-level
  instructions' seven checks or its narrower import list) since none of the
  seven numbered checks call for it. `app/src/lib/social.ts` does export it
  and it is covered elsewhere (unit/SQL tests); I did not add an eighth check
  for it since the task was explicit about "the seven checks (the
  deliverable)" and warned against gold-plating implicitly by defining scope
  tightly.
