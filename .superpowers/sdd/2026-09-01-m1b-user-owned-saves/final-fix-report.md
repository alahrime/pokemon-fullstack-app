# Final fix wave — M1b (feat/m1b-saves)

Base: 0e9cc53. Six Important findings from the whole-branch review, all in application code and
tests. No migration or policy files touched.

## 1. A saved team's league is stored, fetched, then silently discarded

**File:** `app/src/screens/TeamBuilderScreen.tsx`

`loadSaved` never read `t.league`, and the picker rendered `{t.name}` alone — a Great League
roster loaded while viewing Ultra silently applied Great-capped IVs to an Ultra slot with nothing
on screen saying so.

**Change:**
- The saved-teams list now renders each team's league beside its name (`.team-load-league`, a
  small `text-faint` span using `LEAGUE_BY_ID` — already imported, no new import needed).
- `loadSaved` compares `t.league` to the screen's current `league` and, on a mismatch, pushes a
  message onto the same `notices` array the vanished-fast-move case already uses, so it surfaces
  through the existing `loadNotice` mechanism rather than a second channel. The load still
  proceeds (the roster is a legitimate starting point in any league) — it just no longer happens
  quietly.

**CSS:** appended `.team-load-league { flex: none; font-size: var(--text-xs); }` to
`components.css`, using existing tokens only.

**Covering tests** (`app/src/screens/__tests__/team-saves.test.tsx`):
- `shows each saved team's league beside its name` — asserts `.team-load-league` text for a Great
  row and an Ultra row independently.
- `warns via the load notice when loading a team saved for a different league` — loads a team
  saved as `ultra` while the screen defaults to `great`, asserts the load still happens (Registeel
  lands on the roster) and `.team-load-notice` names both the team and the league.
- `does not warn when loading a team saved for the league already selected` — same setup with
  `league: 'great'`, asserts no `.team-load-notice` renders.

All three would fail against the pre-fix code: the league span didn't exist, and `loadSaved` never
read `t.league` at all.

## 2. Save roster accepts an empty name

**File:** `app/src/screens/TeamBuilderScreen.tsx`

The Save button's `disabled` expression only checked `team.length === 0 || saving`; `saveTeam`
sends `saveName.trim()`, and `teams.name` is `not null` but not non-empty, so a blank name produced
a row with an unreadable Load button.

**Change:** `disabled={team.length === 0 || saveName.trim() === '' || saving}` — same concept
`FormatBuilderScreen` already uses (`name.trim() === ''`).

**Covering tests:**
- Rewrote `enables saving once there are members, and saves both in slot order` →
  `enables saving once there are members AND a name...`: after adding two members with the name
  field still blank, asserts the button is **disabled**; only after typing a name does it assert
  enabled. This is the assertion that would fail pre-fix (the old test asserted `disabled === false`
  with a blank name, which was itself exercising the bug).
- New: `keeps save disabled for a whitespace-only name, even with members added` —
  `saveName.trim() === ''` specifically catches `"   "`, not just `""`.

## 3. `listServerFormats` fetches every version of every format

**File:** `app/src/lib/saves.ts`

The embed pulled the full `rules` jsonb for every version of every format, sorted client-side, and
threw away everything but the newest — re-run after every save and delete, while every save
appends a new version.

**Change:** added
`.order('version', { referencedTable: 'format_versions', ascending: false })` and
`.limit(1, { referencedTable: 'format_versions' })` to the query, so PostgREST does the
over-fetch-avoidance server-side. Kept the client-side "highest version wins" sort as a
correctness backstop (updated the comment to say so explicitly) rather than removing it.

**Covering tests** (`app/src/lib/__tests__/saves.test.ts`):
- Extended the mock query harness so `order`/`limit` record their real arguments (table + payload)
  instead of being no-ops — the pre-existing harness could not express this assertion at all,
  which is exactly what the finding says.
- New `describe('listServerFormats', …)`:
  - `orders and limits the embedded versions by referencedTable, not just the top-level query` —
    asserts the exact `order('version', { referencedTable: 'format_versions', ascending: false })`
    and `limit(1, { referencedTable: 'format_versions' })` calls against the `formats` table
    builder. Fails pre-fix because those calls never happened.
  - `still returns the highest version when the embed hands back more than one row` — exercises the
    backstop sort directly.

## 4. No test asserts the appended version number

**File:** `app/src/lib/__tests__/saves.test.ts`

`saveServerFormat` computes `next = prior[0].version + 1`. Nothing asserted the actual number, so a
reversed sort, a dropped `.order`, or a hardcoded `next = 1` all passed the existing suite.

**Change:** new test `computes the next version from the highest existing version, not just any
row`, with the fixture exactly as specified — `format_versions: [{ version: 3 }, { version: 1 }]`
— asserting the inserted row's `payload.version === 4`.

**Load-bearing proof (as requested):**

Before (mutated `saves.ts` line ~151 to `const next = 1;`):

```
 ❯ src/lib/__tests__/saves.test.ts (12 tests | 1 failed) 118ms
   ✓ saved formats > appends a version rather than updating one 9ms
   × saved formats > computes the next version from the highest existing version, not just any row 11ms
     → expected 1 to be 4 // Object.is equality
   ✓ saved formats > stores the canonical hash alongside the rules 10ms
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```
Only the new assertion failed; every other test in the file — including the pre-existing
"appends a version rather than updating one" — stayed green, confirming those never covered the
number.

After (reverted to `const next = ((prior as { version: number }[] | null)?.[0]?.version ?? 0) + 1;`):

```
 ✓ src/lib/__tests__/saves.test.ts (12 tests) 112ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## 5. Delete has no confirmation in FormatBuilderScreen

**File:** `app/src/screens/FormatBuilderScreen.tsx`

`onClick={() => void remove(s.id)}` was carried over from the localStorage version. On this branch
it calls `deleteServerFormat`, which cascades the format's entire version history irrecoverably —
same blast-radius change `TeamBuilderScreen`'s `deleteSaved` already accounts for with a
`window.confirm`.

**Change:** added `onDelete(s)` that calls `window.confirm(...)` and only calls `remove(s.id)` if
confirmed — same pattern as `TeamBuilderScreen.tsx:388`.

**Covering test** (`app/src/screens/__tests__/format-builder.test.tsx`):
`asks for confirmation before deleting a saved format, and only deletes after confirming` — saves a
format, spies `window.confirm` to return `false` and asserts `listFormats()` is unchanged (real
localStorage, not a mock recording a call count), then flips the spy to `true` and asserts the
format is actually gone. Fails pre-fix because the format is deleted regardless of the (unspied,
never-called) confirm.

## 6. A failed migration leaves a signed-in user staring at an empty list

**File:** `app/src/state/useFormats.ts`

`run()`'s `catch` set `error` and returned without ever loading formats, so `formats` stayed `[]`
while `source` stayed `'local'` — a state with real local data on disk that never surfaced.

**Change:** in the `catch`, in addition to `setError`, now calls
`setFormats(listFormats().map(...))` and `setSource('local')` — the same call pattern the
signed-out branch already uses — so the failure is additive rather than replacing the screen's
content.

**Covering tests** (`app/src/state/__tests__/use-formats.test.tsx`):
- Extended the existing `a failed upload` test with two new assertions:
  `expect(api.formats.map((f) => f.id)).toContain(a.id)` and `expect(api.source).toBe('local')`.
  These are the assertions that actually distinguish the fix — the pre-existing assertions in that
  test (error truthy, MIGRATED_KEY untouched, local copy intact) all held even with the bug
  present, since they never looked at `formats` or `source` after the catch.
- New `falls back to local formats when listServerFormats fails even though the migration itself
  succeeded` — covers the second path into the same `catch` (upload succeeds, the subsequent
  `listServerFormats()` call throws), confirming the fallback isn't tied to one specific failure
  site.

## Full gate

```
cd app && npm run check > /tmp/final.log 2>&1; echo "EXIT=$?"
EXIT=0
...
 Test Files  78 passed (78)
      Tests  1066 passed (1066)
```

1057 baseline + 9 new (3 in `saves.test.ts`, 4 in `team-saves.test.tsx`, 1 in
`format-builder.test.tsx`, 1 in `use-formats.test.tsx`). `tsc -b`, `oxlint`, `themes`, `tokens`
(token-parity), `verify` (verify-data), `audit:spreads`, and `rules:node` all ran as part of the
same `check` script and all exited clean — the single `EXIT=0` covers the whole chain, not just
`vitest`.

oxlint emits 5 `no-unsafe-optional-chaining` warnings in `saves.test.ts` (was 4 before this change,
confirmed via `git stash`) — pre-existing style in that file's `harness()`-based tests
(`(x?.payload as T).field` chains), not new to this branch's convention, and warnings don't affect
`npm run check`'s exit code.

Database suite untouched (no migration/policy changes) — not re-run as part of this pass since the
constraint explicitly excludes that surface.

## Self-review

- No new runtime dependencies; no imports added under `app/src/rules/`.
- No new CSS design tokens — `.team-load-league` uses only `--space-*`/`--text-*` already defined,
  and no `--danger`/`--warn` was introduced; the notice text for finding 1 reuses the existing
  `.team-load-notice` block verbatim (no CSS change needed there).
- `components.css` was only appended to, both times after the last existing rule in the relevant
  block — no reflow of existing declarations.
- `supabase/migrations/` and RLS policies: untouched.
- Every finding's test was checked against the specific bug it targets by re-reading the pre-fix
  code path, and finding 4's was additionally proven by mutation (see above). Finding 1, 2, 5 and 6
  were each confirmed to fail if the corresponding source edit is reverted, by inspection of what
  each new assertion reads (a DOM node that doesn't exist pre-fix, a `disabled` value that was
  `false` pre-fix, a `listFormats()` count that drops to 0 pre-fix because confirm is never called,
  and a `formats` array that stays `[]` pre-fix).
