# Task 1 report: a deterministic data revision

Commit: `f19f269` — "feat(data): a deterministic revision identifying this data build"
Branch: `feat/m2a-matchmaking`

## What changed and why

**`app/scripts/build-data.mjs`**
- Imported `createHash` from `node:crypto`.
- Assembled the write payload into a named `out` object (`{ moves: moveTable, species }`) instead of an inline literal, so it could be hashed before being written.
- Computed `out.dataRev = createHash('sha256').update(JSON.stringify({ moves: out.moves, species: out.species })).digest('hex').slice(0, 16)` and wrote `out` (now carrying `dataRev`) to `species.json`. The hash is taken over `moves` + `species` only, in the key order the writer already fixes — not over the whole `out` object, so adding `dataRev` to the object afterward cannot feed back into its own hash.

**`app/src/lib/data.ts`**
- Per the brief's correction, did **not** use the `(raw as { dataRev?: string }).dataRev ?? 'unknown'` cast shown in the original brief text. Instead:
  - Added `dataRev: string` to the type parameter passed to `artefact<...>()`.
  - Added `'dataRev'` to the `required` keys array: `artefact<{...}>(speciesRaw, 'species.json', ['moves', 'species', 'dataRev'], 'npm run data')`.
  - Exported `export const DATA_REV: string = raw.dataRev;` directly — no cast needed, since `artefact()`'s runtime check plus the widened type parameter already guarantee the field is present and typed.

**Required-keys decision:** I added `dataRev` to the `required` list. Rationale, from reading `artefact.ts` before making the call: the whole point of `artefact()` (per its own doc comment) is to convert "the compiler saw a perfectly typed field and the screen got `undefined`, gate green" into a loud, named failure at import time. If `dataRev` is declared as non-optional `string` on the type parameter but *not* added to `required`, a stale `species.json` from before this change (or any future artefact missing the field) would type-check fine and silently hand `DATA_REV` the value `undefined` — exactly the failure mode `artefact()` exists to prevent, and precisely the scenario this rev is meant to protect against (a stale build going unnoticed by a scheduled match). Adding it to `required` makes that case throw `Artefact species.json is unusable: missing dataRev. Re-run \`npm run data\`.` instead.

**`app/src/lib/__tests__/data.test.ts`**
- Added the test from the brief's Step 1 verbatim, inside the existing `describe('roster', ...)` block, immediately after the "is populated and internally consistent" test.

**`app/src/data/species.json`**
- Regenerated; gained the `dataRev` field. See determinism section below — the final committed file also carries the `bestIv` per-species index (see "A complication" below for why that mattered).

## TDD: failing test, verbatim

Command: `cd app && ./node_modules/.bin/vitest run src/lib/__tests__/data.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"` → `EXIT=1`

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ❯ src/lib/__tests__/data.test.ts (20 tests | 1 failed) 13ms
   ✓ refs > round-trips a plain species 1ms
   ✓ refs > round-trips a shadow 0ms
   ✓ refs > does not mistake a form suffix for a shadow 0ms
   ✓ refs > names a shadow distinctly 0ms
   ✓ refs > resolves a species from either form of ref 0ms
   ✓ roster > is populated and internally consistent 0ms
   × roster > exposes a data revision that identifies this build 3ms
     → .toMatch() expects to receive a string, but got undefined
   ✓ roster > ROSTER includes shadows and BASE_ROSTER does not 0ms
   ✓ roster > excludes every unsimulated species from every picker 1ms
   ✓ roster > gives every league a substantial opponent list 1ms
   ✓ movesFor > returns a fast move and at least one charge 0ms
   ✓ movesFor > never exceeds two charged moves 1ms
   ✓ team legality > blocks a species against itself 0ms
   ✓ team legality > blocks regional forms sharing a dex 0ms
   ✓ team legality > blocks a Pokemon and its own shadow 0ms
   ✓ team legality > allows genuinely different species 0ms
   ✓ team legality > teamIsLegal applies the rule pairwise across the whole team 0ms
   ✓ randomMatchup > returns two different Pokémon from the league pool 4ms
   ✓ randomMatchup > actually varies, rather than looking random and repeating 0ms
   ✓ randomMatchup > draws every position, not just the head of the pool 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/__tests__/data.test.ts > roster > exposes a data revision that identifies this build
TypeError: .toMatch() expects to receive a string, but got undefined
 ❯ src/lib/__tests__/data.test.ts:39:22
     37|   it('exposes a data revision that identifies this build', async () =>…
     38|     const { DATA_REV } = await import('../data');
     39|     expect(DATA_REV).toMatch(/^[0-9a-f]{16}$/);
       |                      ^
     40|   });
     41|   it('ROSTER includes shadows and BASE_ROSTER does not', () => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
   Start at  12:16:08
   Duration  844ms (transform 62ms, setup 76ms, collect 55ms, tests 13ms, environment 448ms, prepare 41ms)
```

## TDD: passing test, verbatim

Command: `cd app && ./node_modules/.bin/vitest run src/lib/__tests__/data.test.ts > /tmp/green.log 2>&1; echo "EXIT=$?"` → `EXIT=0`

```
 RUN  v3.2.7 /Users/alilahrime/Downloads/paragon-iv/app

 ✓ src/lib/__tests__/data.test.ts (20 tests) 10ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  13:25:14
   Duration  697ms (transform 54ms, setup 67ms, collect 50ms, tests 10ms, environment 389ms, prepare 35ms)
```

## Ruling followed: the determinism proof is two runs of `build-data.mjs`, not two runs of `npm run data`

Ruling 7 (recorded in `progress.md`) applies here: `npm run data` is `build-data.mjs → best-spreads → matrix → teams → summary`, and `dataRev` is computed entirely inside the first stage. The stages after it cannot affect the hash, and re-running them (~13+ minutes, dominated by the exhaustive team-chain search) proves nothing about the property under test. **I did not run the full `npm run data` chain as its own determinism proof; I ran `node scripts/build-data.mjs` alone, twice, and diffed the two outputs directly.**

### A complication worth recording

Before that clean proof, a background `npm run data` I had started earlier (to regenerate the artefact per the brief's original Step 5) was killed by the coordinator partway through the `teams` stage — it printed the `great`-league line (524M chains, ~1966s) and then stopped; no `ultra`/`master`/`summary` output. This is unrelated to my change (a one-key addition to `species.json` cannot affect a team-chain search) and the coordinator confirmed it directly. That run's `build-data.mjs` stage *had* completed, and its `best-spreads` stage had also completed (confirmed by `matrix.json`/`rankings.json` timestamps and content — both were rewritten but git reported no diff, i.e. byte-identical to the committed versions).

While investigating, I ran `node scripts/build-data.mjs` standalone twice more to get a clean determinism pair. Comparing one of those standalone runs against the leftover file from the killed pipeline run showed a *different* whole-file SHA-256 despite an *identical* `dataRev`. I chased this down rather than assuming a bug: `scripts/build-best-spreads.ts` (stage 2, `npm run best-spreads`) reads `species.json`, adds a per-species `bestIv`/`bestIvBB` index, and rewrites the whole file — and it ran as part of the killed pipeline but not as part of my standalone `build-data.mjs`-only runs. Since `dataRev` is computed *before* `bestIv` exists (over `{moves, species}` only), matching `dataRev` values with differing whole-file hashes is exactly what you'd expect once `bestIv` is in the picture — not non-determinism in the hash. I confirmed this by reading `build-best-spreads.ts` (it parses, mutates `row.bestIv`/`row.bestIvBB` in place, and does `JSON.stringify(raw)` — `dataRev` passes through untouched) and by direct byte-for-byte diffing (below).

This also meant my standalone `build-data.mjs` reruns had *dropped* the `bestIv` index that the previously-committed `species.json` carried, and that `scripts/verify-data.ts` checks for (`species.json carries the bestIv index`). I restored it by running `npm run best-spreads` once on top of the freshly-built file (a single stage, not the whole chain — it took well under a minute and does not touch `dataRev`), confirmed the final file still carries `dataRev: 22be034799f47a66`, and confirmed `npm run check`'s `verify` step passes that check (`ok   species.json carries the bestIv index — 829 species indexed`).

### The determinism proof itself

Two isolated, back-to-back invocations of `node scripts/build-data.mjs` alone, saving each output to a separate file before rerunning:

```
$ node scripts/build-data.mjs > /tmp/run_a.log 2>&1; echo "EXIT_A=$?"
EXIT_A=0
$ cp src/data/species.json /tmp/species_run_a.json
$ shasum -a 256 /tmp/species_run_a.json
9f22efc0779d314994378ffbef3b160b14768e2e0863a5cea4768ddcae3de42b  /tmp/species_run_a.json

$ node scripts/build-data.mjs > /tmp/run_b.log 2>&1; echo "EXIT_B=$?"
EXIT_B=0
$ cp src/data/species.json /tmp/species_run_b.json
$ shasum -a 256 /tmp/species_run_b.json
9f22efc0779d314994378ffbef3b160b14768e2e0863a5cea4768ddcae3de42b  /tmp/species_run_b.json

$ diff /tmp/species_run_a.json /tmp/species_run_b.json > /tmp/ab.diff; echo "diff exit=$?"; wc -l /tmp/ab.diff
diff exit=0
       0 /tmp/ab.diff
```

Two consecutive `build-data.mjs`-only runs are byte-for-byte identical (same SHA-256, zero-line diff), and both carry `dataRev: 22be034799f47a66`. That is the determinism assertion the brief asked for, narrowed to the stage that actually computes the hash per the coordinator's ruling.

After that pair, I ran `npm run best-spreads` once (not a determinism-proof step — just to restore the `bestIv` index that shipping needs) and reconfirmed `dataRev` was unchanged by it (`22be034799f47a66`).

## `npm run check`, verbatim final line

Command: `cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"` → **`EXIT=0`**

Test summary from that run: `Test Files  78 passed (78)` / `Tests  1078 passed (1078)`, including `✓ src/lib/__tests__/data.test.ts (20 tests) 33ms`.

`verify-data` (part of `npm run check`) reported 347 `ok` lines and zero failures, including:

```
── rank-1 spread index ────────────────────────────────
  ok   species.json carries the bestIv index — 829 species indexed — if 0, run `npm run best-spreads` after build-data.mjs
```

No `FAIL` / `not ok` / `✗` lines anywhere in the 5164-line gate log. `oxlint` reported only pre-existing warnings (react-refresh export shape, `useMemo` deps, an unsafe-optional-chaining warning in an unrelated existing test) that do not fail the gate and are unrelated to this change.

## Files touched

- `app/scripts/build-data.mjs` — emits `dataRev`
- `app/src/lib/data.ts` — exports `DATA_REV`, added `dataRev` to the artefact's required keys
- `app/src/lib/__tests__/data.test.ts` — the new test
- `app/src/data/species.json` — regenerated (`dataRev` added; `bestIv` index re-attached after the standalone reruns dropped it — see above)

Commit `f19f269` contains exactly these four files (`git diff --stat` against the parent: `4 files changed, 27 insertions(+), 3 deletions(-)`).

## What I'm unsure about / flagging for review

1. **`bestIv` regeneration was mine, not the brief's.** The brief only asked for `node scripts/build-data.mjs` (Step 3) and referenced `npm run data` (Step 5) for regeneration; nothing in it anticipated `species.json` losing its `bestIv` index mid-task. I ran `npm run best-spreads` on my own judgment to restore it (verified by `npm run check`'s `verify` step, which explicitly checks for it), rather than leaving `species.json` incomplete relative to what a full pipeline run would produce. I'm confident this was the right call — the alternative was shipping a `species.json` state that no real pipeline run ever actually produces — but it's outside the brief's literal steps and worth the reviewer's eyes.
2. **`bestIv` values were not independently determinism-tested by me.** I trust `build-best-spreads.ts`'s own search is deterministic (it's an exhaustive 16×16×16 search over fixed inputs with a fixed tie-break), and `npm run check` passed, but I did not run best-spreads twice and diff — only `build-data.mjs`, which is what this task and the coordinator's ruling actually scope.
3. **The originally-started `npm run data` background run never completed** (killed mid-`teams`-stage, unrelated to this change per the coordinator). I did not attempt to re-run the full chain to complete it — Ruling 7 says that proof is unnecessary for this task, and `npm run check`'s green gate is the arbiter that the artifact set (`species.json`, `matrix.json`, `rankings.json`, the pre-existing `teams.json`/`summary.json`) is internally consistent, which it is (`engineRev` 14 agrees across all three; verify-data's cross-checks all pass).
4. A stray `git stash` I created while investigating the `bestIv` discrepancy was dropped (`git stash drop`) before finishing — confirmed empty (`git stash list` shows nothing) so it left no residue.
