### Task 9: Two humans, one match, against real Postgres

Every test above either mocks the client or drives SQL directly. Neither can see what M1b's duplicate-formats bug taught this repo: a green suite is not evidence about a system nobody ran. This task runs the real modules against the real database as two real confirmed accounts.

**Files:**
- Create: `app/tools/m2a-roundtrip.ts` (kept, unlike the throwaway scripts — it is the only end-to-end proof of this milestone)

- [ ] **Step 1: Write the script**

Model it on the M1b round trips: bundle through esbuild with `--define:import.meta.env={…}`, sign up two accounts, confirm each by pulling the link out of Mailpit's API at `http://127.0.0.1:54324` (the real confirmation path, so `handle_confirmed_user()` makes the profiles the foreign keys need), then:

1. **Wait for each token to be accepted** before doing anything else — poll a trivial authenticated select until it returns without error. PostgREST's container clock can put a fresh JWT "issued at future", and that rejection is indistinguishable from a refused write unless you gate on it. This exact confound produced a false pass during M1b.
2. Both accounts `joinQueue` on the same format. Assert **no match yet** — nothing is paired until the coordinator has verified the hashes.
3. Invoke the coordinator once. Assert `verified: 2, paired: 1`, exactly one `matches` row, and that **both** players can read it while a third account cannot.
4. Assert each player can now read the other's friend code, and the third account cannot.
5. A third account joins with a deliberately wrong `claimed_hash`. Tick. Assert its entry was **deleted** and no match was made.
6. Create a live offer, accept it from the other account, assert a match exists immediately.
7. Create a scheduled offer, accept it, assert **no match**, confirm it as the proposer, assert a match. Then create one with `expires_at` in the past, tick, assert `lapsed` and still no match.
8. Delete every row it created.

- [ ] **Step 2: Run it**

```bash
cd app && ./node_modules/.bin/esbuild tools/m2a-roundtrip.ts --bundle --platform=node --format=esm \
  --outfile=node_modules/.cache/m2a.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"<the sb_publishable_ key npm run db:start prints>"}' > /tmp/build.log 2>&1; echo "EXIT=$?"
node node_modules/.cache/m2a.mjs > /tmp/m2a.log 2>&1; echo "EXIT=$?"; cat /tmp/m2a.log
```

Expected: every check PASS, exit 0. **A check that passes for the wrong reason is worse than a failure** — assert on the message or the row, never merely on "something was refused".

- [ ] **Step 3: Commit, and stop the stack**

```bash
git add app/tools/m2a-roundtrip.ts
git commit -m "test(m2a): two accounts, three routes into a match, against real Postgres"
cd app && npm run db:stop
```

---

## Definition of done

- `npm run check` and `npm run check:db` both exit 0.
- Task 9's round trip passes every check against a real local stack.
- The deploy note is understood: this plan adds **four migrations**, and merging to `main` applies them to the production database. Before pushing, re-read the deploy section of `docs/superpowers/HANDOFF.md`.

## Deliberately not in M2a

Result reporting, adjudication, the dispute and evidence ladder, the match channel and Realtime presence, rating and seasons, direct friend challenges (M3), and the moderation report button. The spec places the report button in M2 "the moment two strangers can type at each other" — M2a gives them no way to type at each other, so it arrives with the match channel in M2b and must not be forgotten there.

## Known gaps this plan accepts

- **`data_rev` is recorded and matched on, not enforced.** Two clients on different data builds will not pair, and a match stores the rev it was made under. Nothing yet *replays* an older data build, so a scheduled match played after a data change can detect the drift but not undo it. Full pinning needs versioned data and belongs with the random draw.
- **Unlisted offers cannot be accepted.** `accept_offer` requires `public`, because RLS hides unlisted rows from the taker and a share-link flow is its own design.
- **The local `pg_cron` → Edge Function hop is the riskiest step here.** If `net.http_post` cannot reach the edge runtime from the database container, fall back to invoking the coordinator by hand in tests and schedule it on the hosted project only — but say so plainly rather than marking Task 6 done.
