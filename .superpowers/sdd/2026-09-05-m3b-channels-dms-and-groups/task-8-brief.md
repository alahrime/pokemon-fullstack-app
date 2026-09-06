### Task 8: Two accounts, three kinds of channel, against real Postgres

**Files:**
- Create: `app/tools/m3b-roundtrip.ts`

**Interfaces:**
- Consumes: `app/src/lib/channels.ts` (Task 6) — the shipping module.

- [ ] **Step 1: Write the script**

Same shape and localhost-only guard as `app/tools/opponents.ts`. Sign in as both bots and assert, printing a line per check:

1. Not yet friends: `openDm` raises `that person cannot be messaged`.
2. Befriend them through `request_friendship` / `respond_to_friendship`; `openDm` now returns a channel id, and calling it from the *other* bot returns **the same id**.
3. Bot 1 sends a message; **bot 2 receives it on a live `subscribeToChannel` within 5 seconds.** This is the check no unit test can make — the Realtime publication is a piece of server configuration, and the failure mode when it is missing is an empty chat and no error anywhere.
4. Create a match between the two bots with the service role; a `match` channel appears with both as members, and both can `listMessages` on it.
5. Bot 2 reports bot 1's message; bot 1's `message_reports` read returns **zero rows**.
6. Force that message's `expires_at` into the past, call `sweep_messages`, and the message **survives** — the open report holds it.
7. A third throwaway account is created, is a friend of neither, and `listChannels()` for it returns none of the above.
8. Bot 1 blocks bot 2; bot 2 sending into the shared DM is refused, and bot 1 sending still succeeds.

- [ ] **Step 2: Run it and verify every check passes**

```bash
cd app && ./node_modules/.bin/esbuild tools/m3b-roundtrip.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/m3b.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY='<from npm run db:start>' node node_modules/.cache/m3b.mjs > /tmp/rt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, all eight checks passing. **Check 3 is the one this script exists for.**

- [ ] **Step 3: Commit**

```bash
git add app/tools/m3b-roundtrip.ts
git commit -m "test(tools): dm, group and match channel, two real accounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Both gates green; `pairing.test.ts` and `offers.test.ts` still green after the match-channel trigger started firing on every match they create.
- `m3b-roundtrip.ts` passes all eight checks, check 3 included.
- Driven by hand through two browser origins as two accounts: open a DM, watch a message arrive without a reload, create a group, report a message.
- `docs/superpowers/HANDOFF.md` records the coordinator's response shape.

## Deliberately not in M3b

- **Tournament channels.** `channels.kind` has room for them; M5 fills it.
- **Attachments and images.** They bring re-encoding, EXIF stripping and serving from the object store's own origin — three rules the spec states and none of which are cheap. Text only here.
- **Typing indicators and presence.** Realtime supports both; neither is load-bearing.
- **Direct challenges.** An offer aimed at a friend. It belongs with matchmaking, now that it has somewhere to be delivered.

## Known gaps this plan accepts

- **The moderation queue has no operator.** `message_reports` fills up and nothing drains it; `state` never leaves `'open'` without someone writing SQL by hand. That is the honest state of it, and it is why retention holds a reported message indefinitely rather than for a fixed window — an unresolved report must not expire the evidence. A minimal moderator view is the next thing this subsystem needs.
- **`is_channel_member` is `security definer` and is called from three policies.** That is what stops the `channel_members` policy recursing into itself, and it means the check runs with RLS bypassed — correct here, and worth a second look before any new policy starts calling it.
- **`listChannels` reads `channel_members(last_read_at)` and takes element 0.** In a group this returns some member's row rather than reliably the viewer's. It is right for DMs and match channels, and unread counts in groups will need the query filtered by `user_id` before they can be trusted.
- **The spec puts a `channel` column on `matches`; this puts `match_id` on `channels`.** Same relationship, opposite direction, chosen so that `matches` needs no migration when a channel is added and so the unique index that guarantees one channel per match lives beside the channel. If anything later wants to read a match's channel in the same query as the match, that is a join rather than a column.
- **No rate limit on `messages`.** The body length is capped at 4,000 characters and nothing caps the rate. A public signup with DMs needs one before it meets strangers.
- **Message edits keep no history.** `edited_at` records that an edit happened, not what it replaced, so a reported message can be edited after the report. Holding the reported *version* rather than the row is the fix, and it is not built here.
