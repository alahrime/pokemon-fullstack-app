### Task 6: Two accounts, one match, against real Postgres

`app/src/lib/__tests__/matches.test.ts` mocks nothing important, but the screen test mocks the whole data layer, and `saves.test.ts` has twice now proved that a mocked Supabase client agrees with whatever it is told. The ladder is a state machine spread across a check constraint, a policy, a locked function and a cron sweep; no mock can judge it.

This is a fixture in the style of `app/tools/m2a-roundtrip.ts` — it asserts, and it refuses to run anywhere but the local stack.

**Files:**
- Create: `app/tools/m2b-roundtrip.ts`

**Interfaces:**
- Consumes: `app/src/lib/matches.ts` (Task 4) — the SHIPPING module, for the same reason `m2a-roundtrip.ts` does it: rows written by a reimplementation of the client are rows the client never has to be able to read.

- [ ] **Step 1: Write the script**

It must sign in as both bots (`test-opponent-{1,2}@example.test` / `Test-Opponent-{1,2}-fixture`), create a match between them with the service role, then assert this sequence, printing a line per check:

1. Bot 1 submits `[true, false, true]` → returns `reported`; `matches.state` is `reported`.
2. Bot 1 reads its own report back; **bot 2 reading `match_reports` for that match gets zero rows** — the sealing rule, exercised through PostgREST rather than through `asUser`.
3. Bot 2 submits a disagreeing scoreline → returns `mismatch`; `amend_deadline` is set.
4. Bot 2 reads `match_reports` again and still sees only its own row.
5. Bot 2 amends to agree → returns `confirmed`; `match_rounds` holds three rows in round order with the right winners; **both** bots can now read both reports.
6. On a second match, both disagree, `amend_deadline` is forced into the past with the service role, `sweep_matches` is called, and the state is `disputed`.
7. Bot 1 submitting into that disputed match raises `this match is no longer accepting reports`.

Guard it exactly as `opponents.ts` does:

```ts
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  console.error(`REFUSING TO RUN: SUPABASE_URL is ${SUPABASE_URL}, which is not the local stack.`);
  process.exit(2);
}
```

- [ ] **Step 2: Run it and verify every check passes**

```bash
cd app && ./node_modules/.bin/esbuild tools/m2b-roundtrip.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/m2b.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY='<from npm run db:start>' node node_modules/.cache/m2b.mjs > /tmp/rt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` and every numbered check printed as a pass. **Check 2 and check 4 are the ones that matter** — they are the sealing rule measured through the real client, and they are the failure the spec says "breaks nothing visibly".

- [ ] **Step 3: Commit**

```bash
git add app/tools/m2b-roundtrip.ts
git commit -m "test(tools): the report ladder, driven by two real accounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Both gates green: `npm run check` and `npm run check:db`.
- `m2b-roundtrip.ts` passes all seven checks against the local stack.
- Driven by hand through two browser origins (`localhost:5173` and `127.0.0.1:5173`) as two different accounts: report, mismatch, amend, confirm.
- `docs/superpowers/HANDOFF.md` records the new coordinator response shape.

## Deliberately not in M2b

- **Journal evidence** (`match_evidence`, object storage, EXIF stripping, serving from the store's own origin). Steps 4–7 of the spec's ladder. A match reaching `disputed` sits there; nothing is lost, because `disputed` is already the state that excludes it from rating.
- **Ratings and seasons.** `rating_counted` is written here and read by nothing yet; that is M4's job.
- **The match channel.** It is the same `channels` subsystem as DMs — see the M3b plan rather than building a second one here.

## Known gaps this plan accepts

- `best_of` is denormalised onto `match_reports` so a check constraint can validate the scoreline without joining. It agrees with `matches.rounds` because `submit_report` is the only writer and copies it; if a second writer is ever granted, that invariant needs a trigger.
- The 48-hour give-up and the 10-minute amend window are literals in SQL. They belong in a settings table the first time somebody wants to change one without a migration.
- `isCompleteScoreline` in the screen restates `is_valid_scoreline`'s rule in TypeScript. Two statements of one rule can drift; the database is the authority and the client copy only avoids offering a button that must fail. If a third caller needs it, move it to `app/src/rules/` where the coordinator can share it.
