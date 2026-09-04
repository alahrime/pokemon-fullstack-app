# Task 9 report: three accounts, three routes into a match, against real Postgres

**Status: done. 14 checks, 14 passing, exit 0.** The script is committed at `app/tools/m2a-roundtrip.ts`.

Every log path cited here exists and was produced by this run:
`/tmp/task-9-functions-serve.log`, `/tmp/task-9-tick0.log`, `/tmp/task-9-build.log`,
`/tmp/task-9-final.log`, `/tmp/task-9-run1.log`, `/tmp/task-9-mut1-*.log`,
`/tmp/task-9-mut2-*.log`, `/tmp/task-9-mut3-*.log`, `/tmp/task-9-check.log`,
`/tmp/task-9-checkdb.log`, `/tmp/task-9-counts-*.log`, `/tmp/task-9-tsc.log`.

---

## 1. `supabase functions serve` boots. This is the first direct evidence that Task 6's fix works.

Task 6 could not run it at all: `rules.bundle.d.ts` imported a type from `app/src/rules/types`,
which the CLI's edge-runtime container never bind-mounts, so Deno failed at graph construction
before any code ran. That import was removed — the file is now one self-contained line:

```
export declare function rulesHash(format: unknown): Promise<string>;
```

`cd app && ./node_modules/.bin/supabase functions serve --workdir ..`, full output
(`/tmp/task-9-functions-serve.log`):

```
Setting up Edge Functions runtime...
2026-09-04T06:42:06.294264865Z Serving functions on http://127.0.0.1:54321/functions/v1/<function-name>
2026-09-04T06:42:06.294333865Z  - http://127.0.0.1:54321/functions/v1/coordinator
2026-09-04T06:42:06.294335782Z Using supabase-edge-runtime-1.74.3 (compatible with Deno v2.1.4)
2026-09-04T06:42:42.085351745Z Legacy token type detected, attempting HS256 verification.
2026-09-04T06:42:42.090360727Z serving the request with supabase/functions/coordinator
```

**"Serving functions" alone is not the proof** — the CLI prints that line before any worker boots
the module graph, and Task 6's failure was a *worker boot error* on first request. The proof is the
last two lines plus the response. First invocation, against an empty database
(`/tmp/task-9-tick0.log`):

```
{"verified":0,"paired":0,"swept":0}
HTTP=200
```

Two notes on that invocation, both real:

- The `sb_publishable_…` key is **not** accepted by the functions gateway —
  `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT format"}`, HTTP 401. The
  function's `Authorization` header has to carry a JWT (the legacy `ANON_KEY`/`SERVICE_ROLE_KEY`
  form). That is a difference from PostgREST, which takes the publishable key happily, and it is
  worth knowing before someone wires a client-side invoke.
- **The hosted `deploy` path remains unverified.** Nothing here touches
  `supabase functions deploy`, and this local boot is not evidence about it. Task 6's diagnosis was
  that hosted deploy bundles the whole reachable graph and would have worked even with the old
  import; that diagnosis is still untested, and now moot for the local path.

The edge runtime was **stopped** when the runs finished — `docker ps | grep edge_runtime` returns
nothing and no `functions serve` process remains. It was still stopped after `npm run check:db`
brought the rest of the stack up.

## 2. The partner's rows, before every tick

The partner has one account with 2 saved rosters on this machine. `pair_queue_entries()` and
`sweep_expired()` are global and unscoped, so this was checked, and it is checked **twice**: by me
with psql, and by the script itself before every single tick.

By hand, before anything ran (`/tmp/task-9-counts-before.log`):

```
 profiles | teams | formats | queue_entries | offers | matches
----------+-------+---------+---------------+--------+---------
      203 |     2 |      37 |             0 |      0 |       0
```

and again immediately before the final run (`/tmp/task-9-counts-final-before.log`): `qe 0, mo 0, m 0`.

The script's own guard is `assertNoForeignRows()`: with the admin client it reads every row of
`queue_entries`, `match_offers` and `matches`, and **refuses to tick** — naming the offending row
ids — if any row does not belong to one of its three test accounts. It ran before each of the five
ticks in the final run and printed, in order (`/tmp/task-9-final.log`):

```
[pre-tick "liar offer"]      every row belongs to this script: queue_entries 0, match_offers 1, matches 0
[pre-tick "queue route"]     every row belongs to this script: queue_entries 2, match_offers 0, matches 0
[pre-tick "live offer"]      every row belongs to this script: queue_entries 0, match_offers 1, matches 1
[pre-tick "scheduled offer"] every row belongs to this script: queue_entries 0, match_offers 2, matches 2
[pre-tick "lapse sweep"]     every row belongs to this script: queue_entries 0, match_offers 3, matches 3
```

A related hazard that was checked and turned out to be harmless: the `coordinator-tick` `pg_cron`
job from migration `20260903030000` is registered and **active**, firing every minute. But
`app.coordinator_url` and `app.service_role_key` are both unset on this database (Task 6 reset
them), so every run fails at `net.http_post` — `cron.job_run_details` shows an unbroken run of
`failed` (runids 254-258 checked before starting). No background tick could reach the coordinator
while these tests ran, so every `verified`/`paired` number below is the script's own tick. I did
not set those GUCs.

## 3. The final run, verbatim

Built against the **real** modules, no reimplementation:

```
cd app && ./node_modules/.bin/esbuild tools/m2a-roundtrip.ts --bundle --platform=node --format=esm \
  --outfile=node_modules/.cache/m2a.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
BUILD_EXIT=0
```

The bundle was checked for the real code before running (both greps, separately, not piped):
`delete().eq("user_id", userId)` present once; the mutation text absent.

```
SUPABASE_SERVICE_ROLE_KEY='<local>' node node_modules/.cache/m2a.mjs
RUN_EXIT=0
```

`/tmp/task-9-final.log` in full:

```
M2a round trip — run mtmlik52, DATA_REV 22be034799f47a66
coordinator http://127.0.0.1:54321/functions/v1/coordinator

census before: {"profiles":203,"teams":2,"team_members":12,"formats":37,"format_versions":37,"friend_codes":3,"queue_entries":0,"match_offers":0,"matches":0}

PASS  0. alice's JWT is accepted and its profile exists
        alice 8f0b7912-78b0-4f4d-bc4d-c1497864e900 — authenticated select returned its own profile row
PASS  0. bob's JWT is accepted and its profile exists
        bob 369cbd20-88b8-4f35-b010-89218f31f6e6 — authenticated select returned its own profile row
PASS  0. carol's JWT is accepted and its profile exists
        carol 4dcc9e9b-74f2-4c7b-8caa-a332a9106eab — authenticated select returned its own profile row
PASS  1. two accounts authoring the same rules produce the same rules_hash
        alice 5243a70c-b39c-43fb-bdbf-bcdeabfde034 and bob 35a2d8c5-4cac-4d7d-b10d-8f6ada872809 are different versions with the same hash 4f945e60fc4712f576ab3fb1f2f5c33fbe4af085fedfc8df2ec8a633cf56b399
PASS  2. leaveQueue deletes the leaver's row and nobody else's
        alice's entry 1d0098f5-e529-4755-b5f3-97b6580f38b5 deleted; bob's 577fdac8-614e-45bc-98f8-3c048fbb8938 survived, confirmed past RLS with the admin client
      [pre-tick "liar offer"] every row belongs to this script: queue_entries 0, match_offers 1, matches 0
      [tick "liar offer"] {"verified":0,"paired":0,"swept":0}
PASS  3. an offer whose claimed_hash lies is DELETED by the coordinator
        offer 1e845fa9-1771-4e7e-afdb-b1d5eb2bb2aa claimed deadbeefdead…, coordinator recomputed a different hash and deleted the row outright
PASS  4. nothing pairs before the coordinator has verified the hashes
        both entries sit at verified_hash null and neither player has a match
      [pre-tick "queue route"] every row belongs to this script: queue_entries 2, match_offers 0, matches 0
      [tick "queue route"] {"verified":2,"paired":1,"swept":0}
PASS  4b. one tick verifies both and pairs exactly one match
        match 6ab1b184-1085-4985-9df0-8df77369e31b — source queue, rules_hash 4f945e60fc4712f576ab3fb1f2f5c33fbe4af085fedfc8df2ec8a633cf56b399, both entries consumed
PASS  4c. both players can read the match; a third account cannot
        alice and bob each read 6ab1b184-1085-4985-9df0-8df77369e31b with the other as opponent; carol reads 0 rows asking for it by id
PASS  5. each player reads the other's friend code; the third account reads neither
        alice↔bob exchanged "Amtmlik52000"/"Bmtmlik52000"; carol got null for both while still reading her own "Cmtmlik52000"
      [pre-tick "live offer"] every row belongs to this script: queue_entries 0, match_offers 1, matches 1
      [tick "live offer"] {"verified":1,"paired":0,"swept":0}
PASS  6. a live offer converts to a match on acceptance, carrying the accepter's roster
        offer ebf19cab-bac3-4728-a6f3-34c3364ad921 → match aded6e55-e50e-4904-ba85-e01c378d7506, team_b = ["azumarill","bastiodon","swampert"] (bob's own roster, not empty)
      [pre-tick "scheduled offer"] every row belongs to this script: queue_entries 0, match_offers 2, matches 2
      [tick "scheduled offer"] {"verified":1,"paired":0,"swept":0}
PASS  7. a scheduled offer accepted is NOT a match until the proposer confirms
        offer f7fab63f-9963-4dc5-877e-d0293876cf93: accept → state 'accepted', matchId null, zero new matches; confirm → match 5590a765-b388-4b9b-8f4e-7029e48e4443 with bob's roster
      [pre-tick "lapse sweep"] every row belongs to this script: queue_entries 0, match_offers 3, matches 3
      [tick "lapse sweep"] {"verified":1,"paired":0,"swept":0}
PASS  8. a scheduled offer that runs out of time LAPSES rather than converting
        offer e89eb0f7-4181-4585-b133-653f370767c5 → state 'lapsed', match_id null, no match created; a later accept is refused "this offer is no longer open"
PASS  9. every row this script created is gone
        census identical to the start: {"profiles":203,"teams":2,"team_members":12,"formats":37,"format_versions":37,"friend_codes":3,"queue_entries":0,"match_offers":0,"matches":0}

14 passed, 0 failed
```

### What each check actually establishes

**0 — the JWT gate.** After confirming each account through Mailpit's real link, the script polls
`select id, display_name from profiles where id = <self>` until it returns **cleanly and with one
row**, and nothing else runs until all three have. This is the M1b confound: PostgREST's container
can hold a clock behind GoTrue's, making a fresh token "issued at future", and that refusal is
indistinguishable from a policy denying a write. It also proves `handle_confirmed_user()` made the
profile that every foreign key here points at. The three accounts are made by the real
signup-and-mailbox path, never `admin.createUser` — an admin-created user would have no profile.

**1 — the pairing precondition, asserted rather than assumed.** There are no canonical league
formats: `format_version_id` must point at a version the account itself saved. Alice and Bob each
call `saveServerFormat`, then take their `versionId` from `listServerFormats`. Bob's copy of the
rules is deliberately **restated** — different key order, `"TYPE:STEEL "` with different case and a
trailing space, a different `note` — and the two land on the same `rules_hash`
`4f945e60…6b399` while sitting on different `format_versions` rows. That equality is the only
reason two strangers can ever be paired, since the queue partitions on the verified hash and not on
the format id. The check also asserts the two `versionId`s differ, so it cannot pass vacuously.

**2 — `leaveQueue()` against real Postgres, which nothing had ever done.** Alice and Bob both join;
Bob's entry is read back by id; Alice calls `leaveQueue()`; then Alice's `myQueueEntry()` is null,
Bob's still returns *his own id*, and — past RLS, with the admin client — Alice's row is absent from
the table while Bob's is present. See the honest limitation in section 5.

**3 — the `match_offers` liar branch, previously proven only by code symmetry.** `createOffer`
computes the hash itself and cannot lie, so the lie is staged as a raw insert by the signed-in
proposer (which is exactly what a modified client would do, and is the threat the recomputation
exists for). The insert is read back to confirm the lie survived it and that `verified_hash` is
null. After the tick the row is **absent** — asserted by selecting it by id and getting zero rows,
not by watching a count fall — and `matches` is still empty. The tick reported
`{"verified":0,"paired":0,"swept":0}`; section 4 shows that those numbers are identical when the
branch is broken, which is precisely why the row assertion is the one that matters.

**4 / 4b / 4c — the queue route.** Both entries sit at `verified_hash: null` and both players have
zero matches *before* the tick — nothing pairs until the hashes are verified. One tick returns
exactly `verified: 2, paired: 1`. Exactly one `matches` row exists, `source = 'queue'`, carrying
the verified hash, pairing exactly Alice and Bob, and both queue entries are consumed. Alice and Bob
each read it through `myMatches()` with the *other* as `opponentId`; Carol reads zero matches, and
asking for that match **by id** returns zero rows without an error.

**5 — friend codes.** Alice reads Bob's code and Bob reads Alice's, compared against the literal
strings, not merely "non-null". Carol gets `null` for both. The check that keeps those two nulls
from being vacuous: Carol still reads *her own* code successfully, so she is not simply blind to the
table.

**6 — the live route.** The offer appears on Bob's board with `verifiedHash: null` and
`rosterSize: 3` before the tick (the board is right about both). After one tick, `acceptOffer(id,
bob.team)` returns a match id immediately. The stored row has `source = 'offer'`, players
alice/bob, `team_a = ["registeel","skarmory","medicham"]` and
`team_b = ["azumarill","bastiodon","swampert"]`. **The three fixture rosters hold different
species on purpose** — if all three accounts brought the same members, "team_b holds the accepter's
roster" would pass just as happily against a `team_b` filled with the proposer's, and the check
would be unable to fail. The proposer's own `myOffers()` then shows `state: 'converted'` pointing at
that match id.

**7 — the scheduled route.** `acceptOffer` returns **null**, the set of match ids is unchanged
(compared before and after, not counted), the taker's `myOffers()` shows `state: 'accepted'` with
`matchId: null`. Then `confirmOffer` as the proposer returns a match id, the taker can read that
match, its `team_b` is the taker's own roster (captured at acceptance, since `confirm_offer` runs as
the proposer who has no roster of the taker's), and the offer moves to `converted`.

**8 — the lapse.** `createOffer` cannot take `expires_at`, so the window is backdated by the
proposer's own UPDATE under the "an offer belongs to the person who proposed it" policy — a
client-authorized write, not an admin one. After the tick the offer is `state = 'lapsed'` with
`match_id` null and no new match. And it is genuinely closed rather than relabelled: a later
`acceptOffer` is refused, with the message asserted to be the state check —
`this offer is no longer open` — rather than merely "something was refused".

**9 — cleanup.** A nine-table census (`profiles`, `teams`, `team_members`, `formats`,
`format_versions`, `friend_codes`, `queue_entries`, `match_offers`, `matches`) taken at the start
and again at the end, compared field by field. Identical. Client-side deletes are used wherever a
policy permits one, so cleanup itself exercises the shipping code; the service role is used for
exactly two things that no client may do, both named at their call sites — deleting `matches` rows
(there is deliberately no client DELETE policy) and deleting the three accounts. The service-role
key is read from the environment and is **not** in the committed file.

## 4. Three mutations, because 14/14 on the first run is not evidence on its own

This milestone has produced five false-evidence incidents, so each of the two checks the dispatch
carried in specially was run against a deliberately broken implementation. The committed
`mutate.mjs` harness was used, which asserts the anchor is unique before touching anything.

**Mutation A — `leaveQueue` made a no-op** (`.eq('user_id', userId)` →
`.eq('user_id', '00000000-…')`; `/tmp/task-9-mut1-*.log`). Check 2 goes **red**, with the right
message and the offending row printed:

```
FAIL  2. leaveQueue deletes the leaver's row and nobody else's
        alice left the queue and still has an entry: {"id":"c5eac595-…","league":"great",…,"verifiedHash":null,…}
```
`9 passed, 5 failed` — the four cascades are checks 3/4/4b/4c, poisoned by the queue entry that
should have been gone. Cleanup still restored the census.

**Mutation B — the `user_id` predicate removed entirely** (`.delete().eq('user_id', userId)` →
`.delete().neq('id', '00000000-…')`, i.e. "delete every queue entry you can see";
`/tmp/task-9-mut2-*.log`). Check 2 **still passes, 14/14.** This is a real finding and it is stated
here rather than buried: **Bob's entry survives because of the RLS policy, not because of the
client-side predicate.** "A queue entry is its owner's" scopes the DELETE at the database, so an
unscoped delete from an authenticated client removes only that client's own row. The predicate is
defence in depth exactly as its comment in `matchmaking.ts` claims — *"a redundant predicate that
matches what RLS already computes"* — and no black-box test through an authenticated client can
distinguish its presence from its absence. What check 2 does prove is what the dispatch asked for:
PostgREST accepts the statement, it removes the leaver's row, and it does not remove the other
player's. What it cannot prove is that the predicate is load-bearing, because it is not — the policy
is. If that policy is ever loosened, this check will not notice.

**Mutation C — the coordinator's liar deletion removed** (`await admin.from(table).delete()…` →
a comment, leaving the `continue`; `/tmp/task-9-mut3-*.log`). Check 3 goes **red, alone**:

```
FAIL  3. an offer whose claimed_hash lies is DELETED by the coordinator
        the lying offer was not deleted — it is still there as [{"id":"6d3208c6-…","state":"open","verified_hash":null}]
```
`13 passed, 1 failed`. Two things worth keeping from this run. First, the check has teeth and is
isolated — no other check moved. Second, the tick response was `{"verified":0,"paired":0,"swept":0}`
in **both** the broken and the working case, byte for byte. A check that had asserted on the
coordinator's counts, or on "the offer count fell", would have passed against a coordinator that
leaves liars in the queue forever. This is the dispatch's "assert on rows, not counts" made
concrete.

Both source files were restored and verified: `mutate.mjs restore` reported
`RESTORED (anchor present, mutation absent)` for each, `git status --porcelain app/src supabase/`
is clean, and no `.premutation` backups remain. The final 14/14 run in section 3 was made **after**
the restores, from a freshly rebuilt bundle that was grepped to confirm it contained the real
predicate and none of the mutation text.

## 5. What this does not prove

- **`leaveQueue`'s `user_id` predicate is not proven load-bearing** — see mutation B above. RLS is
  what scopes that delete.
- **The hosted `functions deploy` path is untested.** The local boot says nothing about it.
- **The `pg_cron` → Edge Function hop was not re-exercised.** Task 6 proved it once, with the
  GUCs set and a container reachable by name on the Docker network. They are unset now and I left
  them unset deliberately, so that the only ticks during these tests were the script's own. The
  cron job is active and failing every minute on this machine as a result; that is the correct
  state for a dev box and would need the two `alter database … set` lines on any environment that
  actually wants the schedule.
- **Nothing about a hosted database.** All of this is the local stack.
- **`data_rev` matching is exercised only in the agreeing direction.** Both accounts run the same
  build, so `pair_queue_entries`' `data_rev` equality was satisfied, never violated. Two clients on
  different data builds failing to pair is still covered only by `check:db`.
- **Concurrency is untested here.** `for update skip locked` and the "second accept waits" path are
  covered by `pairing.test.ts` in `check:db`; this script is single-threaded.

## 6. Gates

```
cd app && npm run check      → EXIT=0   81 files, 1158 tests   (/tmp/task-9-check.log)
cd app && npm run check:db   → EXIT=0    7 files,  109 tests   (/tmp/task-9-checkdb.log)
```

Both exit codes were captured with `echo "EXIT=$?"` on their own, never through a pipe.

`app/tools/` had no typecheck at all — `tsconfig.app` covers `src`, `tsconfig.node` covers
`vite.config.ts`, and `tsconfig.scripts` covered only `scripts`. A round trip nobody typechecks is
a round trip that fails at minute three of a run, which is the same complaint `tsconfig.scripts.json`
was created to answer. It now includes `tools` as well, and needed `"jsx": "react-jsx"` added
because `src/lib/teamCodec.ts` takes a type from a `.tsx` component. `tsc -b` exits 0
(`/tmp/task-9-tsc.log`); that is the first line of `npm run check`, so the round trip is now inside
the everyday gate even though running it is not.

**One observation about `check:db`, not caused by this task.** `profiles` went 203 → 213 and
`formats` 37 → 39 across the `check:db` run. The ten new rows are its own fixtures
(`QT_d8009d17`, `TeamA_2d6b38d6`, `FmtA_fa26eef7`, `OP_becbb997`, …, all created at 06:52:59), and
the same pattern is visible from the 2026-09-03 run, so the database suite leaves fixture accounts
behind. None of them are this script's (`m2a …`), whose census closed at exactly its starting
numbers before `check:db` ran. Worth someone's attention eventually; it is not a Task 9 defect.

## 7. Where things stand

- Edge runtime stopped, no `functions serve` process left running.
- The rest of the local stack is still up (`supabase stop` was **not** run, and `db reset` was never
  run — the partner's account and its 2 rosters are untouched; `teams` and `team_members` read 2 and
  12 before and after).
- `queue_entries`, `match_offers` and `matches` are all 0, as they were at the start.
