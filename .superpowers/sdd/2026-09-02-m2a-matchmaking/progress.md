# SDD ledger — plan: docs/superpowers/plans/2026-09-02-m2a-matchmaking.md

Spec: docs/superpowers/specs/2026-08-31-paragon-platform-design.md (read; binding authority)
Branch: feat/m2a-matchmaking (branched from main @ aa34c18)

## Pre-flight scan

Cross-task rows — every pair sharing a file or an interface:

| Tasks | Produces → consumes | Finding |
|---|---|---|
| 1 → 7, 9 | `DATA_REV` → `data_rev` on queue/offer inserts | clean |
| 2 → 6, 7, 9 | `rulesHash()` → coordinator recompute, client claim | clean |
| 2 → 3,4,5 | sha256 hashes → `rules_hash` columns | clean; tests use opaque 'aa'/'bb'/'cc', no format dependency |
| 3 → 4 | `matches.id` → `match_offers.match_id` FK | clean; T3 runs first, migration order holds |
| 3 → 5 | tables → pairing functions insert/delete | clean |
| 4 → 5 | `match_offers` → accept/confirm/lapse | **F3 below** |
| 5 → 6 | `pair_queue_entries`, `sweep_expired` → coordinator `rpc()` | **F2 below** |
| 5 → 7 | `accept_offer(p_offer)` → `rpc('accept_offer', { p_offer })` | clean; parameter name matches |
| 7 → 8 | `QueueEntry`/`Match`/`Offer` → screen | clean after the self-review fix that defined them |
| 3,4,5,6 | four migrations, one directory | clean; timestamps generated per task at implementation time and tasks run in order |

Per-task self-consistency rows:

| Task | Own text agrees with itself? |
|---|---|
| 1 | **F4 below** — `data.ts` wraps the JSON in `artefact<{moves,species}>(...)`, so the plan's cast fights the existing type |
| 2 | yes — tests, implementation and `rules:node` check agree |
| 3 | yes — every table and policy the tests exercise is in the migration |
| 4 | yes |
| 5 | yes — tests cover each function the migration defines |
| 6 | yes, given F2 |
| 7 | yes |
| 8 | yes — prose steps, no code contradictions |
| 9 | yes |

## Rulings

Ruling 1: Execute on branch `feat/m2a-matchmaking` in the main checkout, not a separate worktree — the local Supabase stack binds to this directory and `config.toml`'s `project_id`, so a second checkout would fight over the same twelve containers, and the human partner is actively running the dev server here. Cost if wrong: the work is not isolated from their local experimentation; recoverable by branch, nothing is lost.

Ruling 2 (F2): Task 5 revokes EXECUTE on `pair_queue_entries()` and `sweep_expired()` from public/anon/authenticated but grants it to nobody, while Task 6 calls both as `service_role`. No migration in this repo grants to `service_role`, so nothing else supplies it. Task 5 must add `grant execute on function public.pair_queue_entries(), public.sweep_expired() to service_role;`. Cost if wrong: none — the alternative is Task 6 failing with permission denied on its first tick.

Ruling 3 (F3): `accept_offer` and `confirm_offer` insert `'[]'::jsonb` as `team_b`, so the taker's roster is never recorded. The spec's entity table says `matches` carries **both** team snapshots, and M2b's reporting needs the opponent's. Task 4 gains an `accepted_team jsonb` column on `match_offers`; `accept_offer` takes a second argument `p_team jsonb` and stores it (using it directly as `team_b` for a live offer); `confirm_offer` reads it. Task 7's `acceptOffer(id, team)` gains the parameter. Cost if wrong: a wider signature than needed. Cost of NOT doing it: M2b inherits matches with no opponent roster and a migration under live data to fix it.

Ruling 4 (F4): Task 1 adds `dataRev: string` to the existing `artefact<{...}>` type parameter in `app/src/lib/data.ts` rather than casting `raw`. Cost if wrong: a type error the gate catches immediately.

Ruling 5: Migration filename timestamps are generated at implementation time with `date -u +%Y%m%d%H%M%S`; tasks run in order, so they sort after `20260902163500`. Cost if wrong: a migration applies out of order; caught by `db reset` in the same task.

## Progress

Task 1: dispatched (sonnet), BASE aa34c18 — carries Ruling 4 (artefact type parameter, not a cast)

Ruling 6: `scripts/sdd-workspace` rewrote `.superpowers/sdd/.gitignore` from `*.diff` to `*`, which would untrack every ledger, brief and report in this directory. Restored the tracked version. This repo decided deliberately in `26bb6a3` that the ledgers ARE tracked, because the handoff tells the next session to read them and that only works if they reach another checkout — a tool silently reverting it would make every ruling in this M2a run invisible to everyone but this machine. Watch for it reappearing after each `sdd-workspace` call. Cost if wrong: scratch files land in git; `*.diff` already covers the review packages, and anything else that appears gets its own ignore line rather than a blanket `*`.

Ruling 7: Task 1's determinism proof is two runs of `node scripts/build-data.mjs`, not two runs of `npm run data`. The plan asked for the latter on the assumption it was the project skill's "two passes"; it is actually `build-data → best-spreads → matrix → teams → summary`, ~13 minutes a run. `dataRev` is computed in the FIRST stage, so the four stages after it cannot affect the hash and re-running them proves nothing about the property under test. Cost if wrong: a nondeterminism introduced by a later stage goes unnoticed here — but no later stage writes `dataRev`, and `verify-data` inside `npm run check` still runs against the final artifacts. Applies to any future task that needs this proof.

Ruling 8 (corrects Ruling 7): `node scripts/build-data.mjs` alone does NOT produce a complete `species.json` — it drops the per-species `bestIv` index that `npm run best-spreads` adds in the following stage. The Task 1 implementer hit this, re-ran `best-spreads` once to restore it, and confirmed `dataRev` was unaffected and verify-data's `bestIv` check passes. The minimal safe regeneration is therefore `node scripts/build-data.mjs && npm run best-spreads` — still avoiding matrix/teams/summary, which are the expensive stages and touch neither field. Cost if wrong: a species.json missing bestIv reaches a commit; `npm run check`'s verify step catches it, as it did here.

Note on the aborted chain: the Task 1 report says the full run was "killed by the coordinator". It was not — I sent no signal to it; my watchers used `pgrep` and `kill -0`, both read-only. The chain stopped by itself after the great-league teams stage, cause unknown, most likely memory (8GB heap, 524M chains). Recording this so the next session does not go looking for a deliberate kill that never happened.

Task 1: complete pending review (commit f19f269, gate green 1078 tests, verify-data 347 checks ok)
Task 1: minor (deferred): bestIv regeneration was not itself double-run for determinism — out of scope per Rulings 7/8, flagged by the implementer itself.
Task 1: minor (fixed): the brief's Step 4 code sample contradicted Ruling 4. Root cause was the PLAN text, since briefs are extracted from it; the plan is now corrected so no later extraction repeats it.
Task 1: complete (commits d74761e..f19f269, review clean — spec compliant, quality approved, 0 Critical/Important)
