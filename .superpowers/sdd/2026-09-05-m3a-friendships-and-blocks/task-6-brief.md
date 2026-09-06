### Task 6: Two accounts, against real Postgres

**Files:**
- Create: `app/tools/m3a-roundtrip.ts`

**Interfaces:**
- Consumes: `app/src/lib/social.ts` (Task 4) — the shipping module.

- [ ] **Step 1: Write the script**

Same shape and the same localhost-only guard as `app/tools/opponents.ts`. Sign in as both bots and assert, printing a line per check:

1. Bot 1 requests bot 2 → `pending`; bot 2's `listFriends()` shows it with `theyAsked: true`.
2. Bot 2 cannot yet read bot 1's friend code — **zero rows through PostgREST**, not an error.
3. Bot 2 accepts → `accepted`; **now** bot 2 reads bot 1's friend code and gets `1111 2222 3333`.
4. Bot 1 blocks bot 2. Bot 1's `listFriends()` is empty; the friend code read returns zero rows again.
5. **Bot 2's `listBlocks()` is empty and `listFriends()` is empty** — the block is invisible from the blocked side. This is the check that matters.
6. Bot 2 requesting bot 1 raises exactly `that person cannot be sent a friend request`, the same sentence a random UUID produces.
7. Bot 1 unblocks; a fresh request from bot 2 returns `pending` again.

- [ ] **Step 2: Run it and verify every check passes**

```bash
cd app && ./node_modules/.bin/esbuild tools/m3a-roundtrip.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/m3a.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY='<from npm run db:start>' node node_modules/.cache/m3a.mjs > /tmp/rt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, all seven checks passing.

- [ ] **Step 3: Commit**

```bash
git add app/tools/m3a-roundtrip.ts
git commit -m "test(tools): friendship and block, driven by two real accounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Both gates green, and `pairing.test.ts` still green after `pair_queue_entries` was rewritten.
- `m3a-roundtrip.ts` passes all seven checks.
- Driven by hand through two browser origins as two accounts: request, accept, read the friend code, block, confirm the blocked side sees nothing.

## Deliberately not in M3a

- **DMs, group chats and the match channel.** They are one subsystem — see the M3b plan.
- **Direct challenges between friends.** The spec puts them in M3; they are an offer with a named recipient, and they are better built once `channels` exists so the challenge can be sent somewhere.
- **A friends-only visibility tier on formats or teams.** `formats.visibility` exists; nothing reads it yet.

## Known gaps this plan accepts

- `blocked_between` is called per candidate row inside `pair_queue_entries`'s loop. It is `stable` and `blocks_blocked_idx` covers the lookup, but at a queue of thousands this becomes the scan's inner loop and should become a single anti-join.
- The block guard on `match_offers` is a trigger on UPDATE, so it fires on every update of that table, not only on an accept. Cheap, and it cannot be bypassed by a future second write path — which is why it is a trigger rather than a line inside `accept_offer`.
- People are found by exact `display_name`. There is no search ranking, no pagination and no rate limit on the lookup; a public user-enumeration endpoint is a real consideration before this ships to strangers.
