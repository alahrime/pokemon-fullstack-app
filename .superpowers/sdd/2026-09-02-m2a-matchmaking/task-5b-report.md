# Task 5b report — saved rosters scoped to team size

## Migration

`supabase/migrations/20260903020000_teams_size.sql` — sorts after `20260903011151` as required.

Contents (verbatim):

```sql
-- Saved rosters gain a size (task 5b — reported by the human partner mid-M2a,
-- ledger Ruling 13).
-- ... (full commentary in the file) ...
alter table public.teams add column size smallint;

update public.teams t
   set size = case when (select count(*) from public.team_members m where m.team_id = t.id) > 3 then 6 else 3 end;

alter table public.teams alter column size set not null;
alter table public.teams add constraint teams_size check (size in (3, 6));

drop index if exists public.teams_owner_name_uniq;
create unique index teams_owner_name_uniq on public.teams (owner_id, size, lower(btrim(name)));
```

Applied with the prescribed command:

```
cd app && ./node_modules/.bin/supabase migration up --workdir .. > /tmp/task-5b-mig.log 2>&1; echo "EXIT=$?"
```

Result: `EXIT=0`, log:
```
Connecting to local database...
Applying migration 20260903020000_teams_size.sql...
{"applied":["/Users/alilahrime/Downloads/paragon-iv/supabase/migrations/20260903020000_teams_size.sql"],"message":"Migrations applied"}
```

**I did not run `supabase db reset`, `db:start`, or `db:stop` as standalone commands at any point.** The only places `db:start` ran were inside the prescribed `npm run check:db` gate (which internally runs `db:start`, per the brief's own gate command) — it detected the stack already running and did not wipe or reinitialize any data, confirmed by re-querying the partner's rows immediately after (see below). Applying the migration used `supabase migration up`, not a reset.

## Partner's real data — before / after

**Before** (queried directly against `postgresql://postgres:postgres@127.0.0.1:54322/postgres` before writing or applying anything):

```json
[
  { "id": "1790edc5-15ec-436b-877b-7d1ad178efda", "name": "first roster",  "league": "great", "member_count": 6 },
  { "id": "eee5a6cb-b523-4d84-a138-73c8e123b8be", "name": "second roster", "league": "great", "member_count": 6 }
]
```

**After** migration + after the full `npm run check:db` gate run (which restarts the stack, without resetting it):

```json
[
  { "id": "1790edc5-15ec-436b-877b-7d1ad178efda", "name": "first roster",  "league": "great", "size": 6, "member_count": 6 },
  { "id": "eee5a6cb-b523-4d84-a138-73c8e123b8be", "name": "second roster", "league": "great", "size": 6, "member_count": 6 }
]
```

Same two ids, same names, same leagues, same member counts. Both backfilled to `size = 6`, matching their actual 6-member content exactly, as the brief's measured facts predicted. No rows lost, no rows added.

## The unique-index decision

**Overridden by the human partner mid-task** (this was flagged to me as the one open design question, and the partner then settled it explicitly — I implemented their ruling rather than my own initial draft):

`teams_owner_name_uniq` becomes `(owner_id, size, lower(btrim(name)))` — dropped and recreated under the *same* index name (not a new one), only after `size` is populated and `NOT NULL`.

Justification: under the new rule a GBL "Core" and a Show 6 "Core" are two different rosters — both builders are independently scoped now, so nothing should stop someone from reusing a name across the two. The old two-column index forbade that for no reason the UI could explain. Keeping the same index name matters because `writeError()` in `app/src/lib/saves.ts` matches the literal string `"teams_owner_name_uniq"` inside the Postgres `23505` message to produce a readable sentence — renaming the index would silently turn that into a raw constraint-violation message reaching the user. I verified this mapping is unaffected: `saves.test.ts`'s `'names the roster when the database refuses a duplicate name'` test (unchanged) still passes, and the DB-level test `'refuses a second roster with the same name and size for one owner'` confirms Postgres still raises with that exact constraint name after the rebuild.

New DB test proving the widened index actually does its job in both directions (`supabase/tests/teams.test.ts`):
- `'lets one owner hold the same name at two different sizes'` — same owner, same name, size 3 then size 6, both inserts succeed.
- `'refuses a second roster with the same name and size for one owner'` (renamed from the old same-name test, size held constant) — proves the index still rejects a true duplicate, so the first assertion isn't just "an index that permits everything."

## Verbatim red (TDD, captured before any implementation code changed)

### DB layer — `vitest run --config vitest.db.config.ts` (before migration)
```
❯ ../supabase/tests/teams.test.ts (23 tests | 23 failed) 110ms
   × team policies > lets an owner insert their own team 11ms
     → column "size" of relation "teams" does not exist
   [... 17 more "column size does not exist" failures across every teams.test.ts case ...]
   × team policies > team size > rejects a team with no size at all 6ms
     → promise resolved "[]" instead of rejecting
   × team policies > team size > rejects a size outside 3 or 6 5ms
     → expected [Function] to throw error matching /teams_size/ but got 'column "size" of relation "teams" doe…'
   × team policies > team size > accepts a size of 3 7ms
     → column "size" of relation "teams" does not exist
   × team policies > team size > accepts a size of 6 5ms
     → column "size" of relation "teams" does not exist

 Test Files  1 failed | 6 passed (7)
      Tests  23 failed | 86 passed (109)
```
Full log: `/tmp/task-5b-db-red.log`. Every failure is the expected reason — the column genuinely does not exist yet — not a false-positive from broken test infrastructure (the specific worry flagged in the brief about a prior "confirmed red" that was actually a `ReferenceError`).

### `app/src/lib/__tests__/saves.test.ts` (before saves.ts changed)
```
❯ src/lib/__tests__/saves.test.ts (17 tests | 4 failed) 159ms
   × saved teams > reads a team and its members into one object 19ms
     → expected undefined to be 3 // Object.is equality
   × saved teams > filters by size server-side rather than trusting the caller to ignore the rest 10ms
     → expected undefined to deeply equal [ 'size', 3 ]
   × saved teams > sends size on the insert path 9ms
     → expected undefined to be 6 // Object.is equality
   × saved teams > sends size on the update path 8ms
     → expected undefined to be 6 // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 13 passed (17)
```
Full log: `/tmp/task-5b-lib-red.log`. Failures are all `undefined` where `size` should appear — exactly the missing-implementation gap, not an infrastructure error.

### `app/src/screens/__tests__/team-saves.test.tsx` (before TeamBuilderScreen.tsx changed)
8 new/updated tests failed, e.g.:
```
FAIL  signed in > enables saving once there are members AND a name...
  expected false to be true  (save button was enabled at 2-of-3, should have stayed disabled)
FAIL  signed in > the save control requires a complete roster > stays disabled for a partial GBL team of three...
  expected false to be true
FAIL  signed in > never shows a Show 6 roster in the GBL picker...
  expected "spy" to be called with [3] — Received: []   (listTeams still called with no args)
FAIL  saving over an existing roster > does not offer to replace a same-named roster of a different size
  expected "bound " to not be called at all, but actually been called 1 times
  Array [ "Replace "GL Squad" with the roster in the slots above?" ]
```
Full log: `/tmp/task-5b-screen-red.log` (8 failed, 16 passed — the 16 were tests not touching size-gated behavior yet). The last failure there is the destructive bug itself, reproduced live in the test harness before the fix: the overwrite prompt fires across sizes.

## Verbatim green

### DB layer, after migration
```
✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 89ms
✓ ../supabase/tests/offers.test.ts (6 tests) 106ms
✓ ../supabase/tests/queue.test.ts (8 tests) 129ms
✓ ../supabase/tests/formats.test.ts (17 tests) 155ms
✓ ../supabase/tests/rls.test.ts (19 tests) 173ms
✓ ../supabase/tests/teams.test.ts (23 tests) 209ms
✓ ../supabase/tests/pairing.test.ts (23 tests) 1202ms
Test Files  7 passed (7)
     Tests  109 passed (109)
```

### `saves.test.ts`, after `saves.ts` implemented
```
✓ src/lib/__tests__/saves.test.ts (17 tests) 157ms
Test Files  1 passed (1)
     Tests  17 passed (17)
```

### `team-saves.test.tsx`, after `TeamBuilderScreen.tsx` implemented
```
✓ src/screens/__tests__/team-saves.test.tsx (24 tests) 15103ms
Test Files  1 passed (1)
     Tests  24 passed (24)
```
(24, not the original 16 + 8 — one new size-scoping test and one new size-on-mount test were added beyond the 8 that were red, all passing.)

## Gates

`cd app && npm run check:db > /tmp/task-5b-db.log 2>&1; echo "EXIT=$?"`
→ **EXIT=0**. 109/109 tests passed across 7 files (including the rebuilt `teams.test.ts`, 23 tests).

`cd app && npm run check > /tmp/task-5b-gate.log 2>&1; echo "EXIT=$?"`
→ **EXIT=0**. `tsc -b`, `oxlint`, themes/tokens/verify/audit-spreads/rules:node all clean; `npm run test` → **1091/1091 tests passed across 79 files**, including the full `team-saves.test.tsx` (24 tests) and `team-builder.test.tsx` (17 tests, unaffected).

I re-verified the partner's real data was still exactly 2 rows, both `size = 6`, immediately after the `check:db` gate run (which restarts — not resets — the stack), confirming the gate run itself didn't touch their data.

## What changed, file by file

- `supabase/migrations/20260903020000_teams_size.sql` — new migration (above).
- `supabase/tests/teams.test.ts` — `teamFor` helper and every raw `insert into public.teams` now supply `size` (required once NOT NULL); the two same-name-duplicate tests are pinned to one size each; added `'lets one owner hold the same name at two different sizes'` and a `describe('team size')` block (NOT NULL, check-constraint reject/accept 3 and 6).
- `app/src/lib/saves.ts` — `SavedTeam.size: 3 | 6`; `listTeams(size: 3 | 6)` now required, filters with `.eq('size', size)`, selects the column; `saveTeam` requires and sends `size` on both insert and update.
- `app/src/lib/__tests__/saves.test.ts` — all existing `saveTeam` fixtures gained `size: 3`; added tests for server-side `eq('size', 3)` filtering and for `size` appearing in both the insert and update payloads.
- `app/src/screens/TeamBuilderScreen.tsx`:
  - `rostersNamed(saved, name, size)` now also requires `t.size === size` — a defense-in-depth check on top of the server-side scoping (see design note below).
  - Mount effect, post-save refresh, and post-delete refresh all call `listTeams(size)` instead of `listTeams()`.
  - `saveTeam` call now sends `size`.
  - Save button: `disabled={team.length !== size || saveName.trim() === '' || saving}` (was `team.length === 0`), plus a `saveIncompleteReason` string (`"Add N more to save this roster."`) shown both as the button's `title` and as a visible hint paragraph (`.team-save-hint`) when the roster is non-empty but short of `size`. `saveRoster`'s own internal guard was tightened the same way (`team.length !== size`), not just the button's `disabled` prop, so calling it any other way is still refused.
- `app/src/screens/__tests__/team-saves.test.tsx` — `savedTeam()` helper gained a `size` parameter (default 3, matching all existing GBL-mount fixtures); the two tests that used to save a 2-of-3 roster now complete it to 3 first (the new gate makes 2-of-3 permanently disabled); added: a `describe('the save control requires a complete roster')` block (4 tests, disabled+reason for both GBL and Show 6, enabled at exactly each size, `size` sent on save); a test that `listTeams` is asked for its own size on mount; a test that a Show-6 roster sharing a name never appears in the GBL picker (mock `listTeams` actually honors the `size` argument, the way the real `.eq` would); and, in the existing overwrite-prompt suite, a test that the replace prompt does **not** fire for a same-named roster of the other size (with `rosterNamed()` there also extended to build a full 3-member roster, since 2-of-3 is no longer saveable).

## Design note: the `rostersNamed` defense-in-depth (mine, kept alongside the partner's index ruling)

The brief said scoping `listTeams` by size is what makes the match "automatic" and safe. I additionally made `rostersNamed` itself check `t.size === size`, not only trust that `savedTeams` was correctly scoped upstream. Reasoning: `listTeams` being scoped is what stops a wrong-size roster from reaching `savedTeams` under normal operation, but the actual decision of whether to offer a destructive replace is made in `rostersNamed`/`saveRoster`, and a stale fetch, a future refactor, or a bug in the scoping call is exactly the kind of thing that shouldn't be able to silently resurrect this bug given how destructive it is (real data loss, already live in the tree once today). This is cheap, has no user-visible cost, and is proven by a dedicated test (`'does not offer to replace a same-named roster of a different size'`) that deliberately puts a wrong-size roster into `savedTeams` (as a scoping bug would) and confirms the prompt still doesn't fire.

## Things I'm not fully certain about

- I chose the exact wording `"Add N more to save this roster."` for the incomplete-roster reason (both as the button `title` and a visible hint paragraph). The brief said only that it "must say why, in the manner the blank-name case already does" — but I could not find any existing visible "why" text for the blank-name case in the current codebase (the blank-name disabled state has no title or hint text today, only a code comment). I treated this as license to add a new, consistent mechanism for both cases going forward rather than literally copying something that doesn't yet exist in the UI. Flagging this in case the partner had a specific existing pattern in mind that I missed.
- The migration's backfill comment says "no partial roster predating this rule" currently exists, but leaves the `> 3` (rather than `= 6`) form in place per the brief's own reasoning, for future-proofing against any partial row that might exist by the time this runs elsewhere (e.g., a fresh environment seeded oddly). This matches the brief's SQL exactly; I did not change that logic.
