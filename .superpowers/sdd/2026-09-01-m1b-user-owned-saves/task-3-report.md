# Task 3 report: the codec and the data layer

Branch: `feat/m1b-saves`

## Summary

Implemented `app/src/lib/teamCodec.ts` (pure conversion between the team
builder's in-memory `AddPokemonChoice` and the stored `StoredMember` row
shape) and `app/src/lib/saves.ts` (the async Supabase data layer for
`teams`/`team_members` and `formats`/`format_versions`), both by TDD, using
the exact code given in the task brief. Step 7 (the `owner_id` default
migration) was skipped per the task instructions — Tasks 1 and 2 already
fold `default auth.uid()` into their own migrations for `teams.owner_id` and
`formats.owner_id`.

The brief's `saves.test.ts` harness was missing `update` and `limit` on the
mock query object; both were added, matching the shape of the existing
chainable mocks (`update` records a call like `insert` and returns `q`;
`limit` returns `q`).

Both new source files are byte-identical to the implementations given in the
brief (verified with `diff` against the brief's code blocks). Both new test
files are byte-identical to the brief's test code, except for the two added
harness methods in `saves.test.ts`.

## TDD evidence

### Codec — RED

```
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/team-codec.test.ts > /tmp/codec-red.log 2>&1; echo "EXIT=$?"
```

```
EXIT=1
 FAIL  src/lib/__tests__/team-codec.test.ts [ src/lib/__tests__/team-codec.test.ts ]
Error: Failed to resolve import "../teamCodec" from "src/lib/__tests__/team-codec.test.ts". Does the file exist?
```

Expected failure: `teamCodec.ts` did not exist yet, so the import could not
resolve. This is the correct RED — a module-resolution failure, not an
assertion failure, because nothing had been implemented.

### Codec — GREEN

```
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/team-codec.test.ts > /tmp/codec-green.log 2>&1; echo "EXIT=$?"
```

```
EXIT=0
 ✓ src/lib/__tests__/team-codec.test.ts (6 tests) 9ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

(The brief's Step 4 says "all 7" but the test file it specifies contains
exactly 6 `it` blocks — a brief typo, not a discrepancy in what was
implemented; all 6 specified cases pass.)

The case that matters most — "reports a fast move that no longer exists
instead of silently picking another" — passes because `decodeMember` looks
up the stored `fast_move` id by `findIndex` against `speciesOf(ref).fastMoves`
rather than trusting a stored index: when the id isn't found, `unknownMove`
carries the stale id and `fastIdx` falls back to `0` rather than resolving to
whatever move now happens to sit there. The round-trip test (`encodeMember`
then `decodeMember` returns the same `choice` with `unknownMove: null`)
proves the ordinary path stays lossless, which is what makes the failure
path a real distinction and not just a permissive decoder.

### Data layer — RED

```
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/saves.test.ts > /tmp/saves-red.log 2>&1; echo "EXIT=$?"
```

```
EXIT=1
 FAIL  src/lib/__tests__/saves.test.ts [ src/lib/__tests__/saves.test.ts ]
Error: Failed to resolve import "../saves" from "src/lib/__tests__/saves.test.ts". Does the file exist?
```

Expected failure, same reason: `saves.ts` did not exist yet.

### Data layer — GREEN

```
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/saves.test.ts > /tmp/saves-green.log 2>&1; echo "EXIT=$?"
```

```
EXIT=0
 ✓ src/lib/__tests__/saves.test.ts (5 tests) 51ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

All 5 pass, including "never writes an owner_id from the client" (asserting
`owner_id` is absent from the `teams` insert payload — the client leaves that
entirely to the database column default) and "appends a version rather than
updating one" / "stores the canonical hash alongside the rules" for
`saveServerFormat`, which needed the two added harness methods
(`update`, `limit`) to even execute — without them the harness dies on
`q.update is not a function` the moment `saveServerFormat({ id: 'f1', ... })`
calls `.from('formats').update(...)`.

## Gates

### App gate

```
cd app && npm run check > /tmp/check3.log 2>&1; echo "EXIT=$?"
```

```
EXIT=0
```

Tail of the log: `Test Files 76 passed (76)`, `Tests 1035 passed (1035)`.
`tsc -b`, `oxlint`, token parity, data verification, and the full vitest
suite (including the two new files) all passed.

### Database gate (no migration in this task; run to confirm no regression)

```
cd app && ./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db3.log 2>&1; echo "EXIT=$?"
```

```
EXIT=0
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 90ms
 ✓ ../supabase/tests/teams.test.ts (14 tests) 105ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 123ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 125ms
 Test Files  4 passed (4)
      Tests  63 passed (63)
```

63/63, as expected — no migration was added, and none of Tasks 1/2's
database-side tests regressed.

## An unrelated stray change found and reverted

`.superpowers/sdd/.gitignore` had an uncommitted local edit changing its
content from `*.diff` (the committed version, from `26bb6a3 chore: track the
decision ledgers, which were only ever local`) to a bare `*` — which would
have silently un-tracked every ledger under `.superpowers/sdd/`, including
this task's own report, and undone the entire point of that commit. It was
unrelated to this task (codec/data layer), so it was reverted with
`git checkout -- .superpowers/sdd/.gitignore` rather than built on top of or
committed. Nothing was lost: the M1b ledger directory
(`2026-09-01-m1b-user-owned-saves/`) had never been committed before, so
reverting the `.gitignore` only restored the correct ignore rule going
forward.

## Self-review

- Diffed both new source files against the brief's code blocks with
  `diff` — byte-identical.
- Diffed both new test files against the brief's test code blocks —
  byte-identical except for the two harness additions in `saves.test.ts`,
  which are exactly the two methods (`update`, `limit`) the task instructions
  called for, in the same style as the existing chainable mocks.
- Confirmed `app/src/rules/` was not touched (no import added there); the
  codec and data layer only *import from* `../rules` (`canonicalize`,
  `Format`, `RULES_SCHEMA`), which is explicitly allowed.
- Confirmed `app/src/data/species.json` was not touched.
- Confirmed no new runtime dependency was added — `saves.ts` and
  `teamCodec.ts` only import from existing modules (`./supabase`,
  `../rules`, `./types`, `./data`, `./engine`, `../components/AddPokemonModal`).
- Verified the signatures used (`speciesOf`, `getEntry`, `AddPokemonChoice`,
  `IV`, `Format`, `canonicalize`, `RULES_SCHEMA`) by reading the actual
  source files (`app/src/lib/data.ts`, `app/src/lib/engine.ts`,
  `app/src/components/AddPokemonModal.tsx`, `app/src/lib/types.ts`,
  `app/src/rules/types.ts`, `app/src/rules/canonical.ts`,
  `app/src/rules/index.ts`) rather than trusting memory, per the task's own
  warning about this repo's most repeated mistake.
- Checked `app/src/lib/__tests__/supabase.test.ts` and
  `app/src/screens/__tests__/sign-in.test.tsx` to confirm the
  `vi.hoisted` + `vi.mock('@supabase/supabase-js', ...)` mocking pattern used
  in `saves.test.ts` matches this repo's established convention for mocking
  the client at the package boundary, and that `src/test/setup.ts`'s
  whole-suite Supabase stub explicitly defers to a file-level mock like this
  one.
- Cross-checked `saves.ts`'s table/column names (`teams`, `team_members`,
  `formats`, `format_versions`, `owner_id`, `fast_move`, `charge_moves`,
  `iv_attack`/`iv_defense`/`iv_stamina`, `level`, `rules`, `rules_hash`,
  `version`, `format_id`, `team_id`, `slot`) against the actual Task 1/2
  migrations (`supabase/migrations/20260902043432_teams.sql`,
  `20260902044726_formats.sql`, and the two follow-up format_versions
  migrations) — all match, including that `format_versions` is
  insert-and-select only for the owner (no client UPDATE path exists, which
  is why `saveServerFormat` only ever appends via insert, never touches an
  existing version row) and that `team_members` has no independent RLS
  policy of its own, only one keyed off `teams.owner_id` — consistent with
  `saveTeam` never sending an explicit owner check.
- Confirmed `t.members.length > 0` guards the `team_members` insert in
  `saveTeam`, so saving a team with an empty roster does not call
  `.insert([])` (an edge case exercised precisely by the "never writes an
  owner_id" test, which saves a team with `members: []`).
- Found and reverted the unrelated stray `.gitignore` edit described above,
  rather than silently working around it or committing it.

No concerns beyond that stray, unrelated `.gitignore` edit (already
reverted, not committed). The implementation is exactly what the brief
specified, both new tests genuinely distinguish the round-trip case from the
unknown-move case as required, and both gates are green with no regression.
