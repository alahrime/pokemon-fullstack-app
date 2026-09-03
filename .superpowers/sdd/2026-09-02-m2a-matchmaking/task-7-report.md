# Task 7: The client data layer — implementation report

## Exported signatures

`app/src/lib/matchmaking.ts`:

```ts
export interface QueueEntry { id: string; league: LeagueId; formatVersionId: string; verifiedHash: string | null; expiresAt: string; }
export interface Match { id: string; opponentId: string; formatVersionId: string; rulesHash: string; dataRev: string; rounds: number; source: 'queue' | 'offer'; createdAt: string; }
export interface Offer { id: string; proposerId: string; league: LeagueId; formatVersionId: string; scheduledFor: string | null; expiresAt: string; state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted'; acceptedBy: string | null; }

export async function joinQueue(a: { league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[] }): Promise<string>
export async function leaveQueue(): Promise<void>
export async function myQueueEntry(): Promise<QueueEntry | null>
export async function myMatches(): Promise<Match[]>
export async function listOpenOffers(league: LeagueId): Promise<Offer[]>
export async function createOffer(a: { league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[]; scheduledFor?: Date }): Promise<string>
export async function acceptOffer(id: string, team: StoredMember[]): Promise<string | null>
export async function confirmOffer(id: string): Promise<string>
export async function opponentFriendCode(profileId: string): Promise<string | null>
```

These match the brief's three top-level interfaces verbatim (field names load-bearing for Task 8), and the function list with one deliberate correction — see "Disagreements with the brief" below.

## Red — verbatim output

`cd app && ./node_modules/.bin/vitest run src/lib/__tests__/matchmaking.test.ts > /tmp/task-7-red.log 2>&1; echo "EXIT=$?"` → `EXIT=1`

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app


⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/__tests__/matchmaking.test.ts [ src/lib/__tests__/matchmaking.test.ts ]
Error: Failed to resolve import "../matchmaking" from "src/lib/__tests__/matchmaking.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: /Users/alilahrime/Downloads/paragon-iv/app/src/lib/__tests__/matchmaking.test.ts:68:39
  72 |    it("never sends user_id — the database default decides who owns the entry", async () => {
  73 |      const { calls } = harness({ queue_entries: [{ id: "q1" }] });
  74 |      const { joinQueue } = await import("../matchmaking");
     |                                         ^
  75 |      await joinQueue({ league: "great", formatVersionId: "v1", format: FORMAT, team: [] });
  76 |      const insert = calls.find((c) => c.table === "queue_entries" && c.op === "insert");
 ❯ TransformPluginContext._formatLog node_modules/vitest/node_modules/vite/dist/node/chunks/config.js:29079:43
...
 Test Files  1 failed (1)
      Tests  no tests
```

**Why this is the right red**: it's a module-resolution error, not a test assertion failure or a `ReferenceError` inside an already-loaded module — `app/src/lib/matchmaking.ts` did not exist yet at this point, so Vite's import analysis refused to transform the test file at all and zero tests even ran ("no tests"). This is exactly the failure the brief predicted ("cannot resolve `../matchmaking`"), and it rules out the failure mode the milestone previously got burned by (a `ReferenceError` from an undefined helper, which looks identical whether the real code is right or wrong) — here nothing downstream of the import ran at all, so there is nothing this red could be confusing with a logic bug.

## Green — verbatim output

`cd app && ./node_modules/.bin/vitest run src/lib/__tests__/matchmaking.test.ts > /tmp/task-7-green.log 2>&1; echo "EXIT=$?"` → `EXIT=0`

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ src/lib/__tests__/matchmaking.test.ts (20 tests) 193ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  18:56:20
   Duration  819ms (transform 98ms, setup 49ms, collect 106ms, tests 193ms, environment 267ms, prepare 39ms)
```

20 tests: the 4 mandated by the brief (one adapted, see below) plus 16 I added to cover the remaining five functions (`leaveQueue`, `myQueueEntry`, `myMatches`, `listOpenOffers`, `confirmOffer`, `opponentFriendCode`) and additional angles on `joinQueue`/`createOffer`/`acceptOffer` (data_rev, id-return, camelCase mapping, ISO scheduling, no-network-call on the past-schedule guard).

## Gate

`cd app && npm run check > /tmp/task-7-gate.log 2>&1; echo "EXIT=$?"` → **EXIT=0**

Full pipeline ran: `tsc -b && oxlint && themes && tokens && verify && audit:spreads && rules:node && verify:coordinator-bundle && test`. Final line: `Test Files 80 passed (80)` / `Tests 1111 passed (1111)`, including the 20 new ones. oxlint warnings present in the log are all pre-existing (react-hooks/only-export-components/no-unsafe-optional-chaining in files this task never touched) — none in `matchmaking.ts` or `matchmaking.test.ts`.

## Disagreements between the brief and the database — and what I did

1. **`acceptOffer` signature.** The brief's interface list says `acceptOffer(id: string): Promise<string | null>`. Per the task instructions (which take precedence over the brief here), `accept_offer`'s real signature is `accept_offer(p_offer uuid, p_team jsonb)` — confirmed by reading `supabase/migrations/20260903005933_pairing_functions.sql`: for a live offer it inserts `p_team` directly as `matches.team_b` (`NOT NULL`), and for a scheduled offer it stores `p_team` as `match_offers.accepted_team`, guarded by the `match_offers_accepted_needs_team` constraint. I implemented `acceptOffer(id: string, team: StoredMember[]): Promise<string | null>`, calling `supabase.rpc('accept_offer', { p_offer: id, p_team: team })`.

   The brief's own verbatim test for this (`accepts an offer through the function, never by writing the row`) calls `acceptOffer('o1')` with one argument, which cannot compile against the corrected two-argument signature. I adapted it to `acceptOffer('o1', [])`, keeping its assertion (`match_offers` is never `update`d from this module) unchanged, and noted the adaptation inline in the test file's docblock and here.

2. **`verifiedHash` / `verified_hash`.** The brief's `QueueEntry` interface already gets this right (`verifiedHash: string | null`), so no correction was needed there — I just made sure `myQueueEntry` passes `verified_hash` straight through without ever synthesizing a non-null value, and added a test (`renders an unverified entry with a null verifiedHash, not a fabricated one`) asserting that explicitly, plus one confirming a non-null hash is carried through once the coordinator sets it.

3. **`myMatches` / `opponentId`.** Not something the brief got wrong exactly — it just doesn't say how to derive `opponentId`, and it can't: `matches` (migration `20260902204023_queue_and_matches.sql`) has `player_a`/`player_b`, not an `opponent_id` column, because a match row is symmetric between its two players. I resolved this by calling `supabase.auth.getUser()` to learn which id is "me", then picking whichever of `player_a`/`player_b` is not that id. This is the one function in the module that reads `supabase.auth` rather than only `supabase.from`/`supabase.rpc`, which required extending the test harness with an `auth.getUser` mock (parameterized on a `meId`, default `'me'`) beyond what the brief's harness snippet showed. Tested with two rows where "me" lands in each of `player_a` and `player_b`, to prove the mapping doesn't hardcode a side.

## Things I'm not fully certain about

- **`leaveQueue()` sends no filter at all**, relying entirely on `queue_entries_one_per_user` (the unique index) plus RLS to scope the delete to the caller's own row — there is nothing else to filter by, since this call has no id parameter in the brief's interface. This mirrors the "never send the owner column" rule taken to its logical end (nothing owner-shaped is sent, ever), but it is a slightly different shape from every `saves.ts` delete, which all filter by an explicit `id`. If a future reviewer wants an explicit no-op filter for readability/defense-in-depth, that's a one-line addition; I left it as the minimal correct statement.
- **`opponentFriendCode` and `listOpenOffers`/`myMatches` don't call `.single()`** — I used `.select(...)` and took `rows[0]`, matching `saves.ts`'s `listTeams` pattern (bare select, map the array) rather than its `saveTeam` pattern (`.select('id').single()` on insert). This seemed like the correct precedent (there's no guarantee of exactly one row for these three reads), but it's a judgment call the brief didn't spell out.
- I did not add an explicit `.eq('visibility', 'public')` to `listOpenOffers` — the `match_offers` select RLS policy already restricts a `public` request to `visibility = 'public' or accepted_by = auth.uid()`, and I filter to `state = 'open'`, which an accepted-by-me row would never be in (accepting flips state away from `open`). So the policy and the `state='open'` filter together should already exclude anything a "browse the board" caller shouldn't see, but I did not write a test proving the RLS side of that (out of reach of a client-side unit test with a mocked Supabase client).

## Commit

Committed as a single commit on `feat/m2a-matchmaking` (branch was already checked out, not created/switched):

```
git add app/src/lib/matchmaking.ts app/src/lib/__tests__/matchmaking.test.ts
git commit -m "feat(matchmaking): the client data layer for queue, offers and matches"
```
