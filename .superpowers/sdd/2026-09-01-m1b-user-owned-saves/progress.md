# SDD ledger — plan: docs/superpowers/plans/2026-09-01-m1b-user-owned-saves.md

Spec: docs/superpowers/specs/2026-08-31-paragon-platform-design.md (reachable; rulings are binding
against it, not provisional).
Branch: feat/m1b-saves, from main at 86ec2be.

## Pre-flight scan

### Task pairs sharing a file or an interface

| Pair | Produced → consumed | Finding |
|---|---|---|
| T1 → T3 | `teams(id, owner_id, name, league, created_at, updated_at)`, `team_members(team_id, slot, ref, fast_move, charge_moves, iv_*, level)` → `saves.ts` select strings | Column names match exactly, including the `updated_at` both `listTeams` orders by and `saveTeam` writes. **BUT: `owner_id` is NOT NULL with no default in T1, and T3's `saveTeam` deliberately never sends it.** T3 Step 7 patches this with a follow-up migration. See R1. |
| T2 → T3 | `formats(id, owner_id, name, visibility, fork_of, …)`, `format_versions(id, format_id, version, rules, rules_hash)` → `saves.ts` | Names match. Same `owner_id` default issue via `saveServerFormat`'s `insert({ name })`. See R1. |
| T3 → T4 | `StoredMember`, `listTeams`/`saveTeam`/`deleteTeam`, `encodeMember`/`decodeMember` | Consistent. `SavedTeam.members: StoredMember[]`; `slot` added at write time, sorted away at read time. No mismatch. |
| T3 → T5 | `listServerFormats`/`saveServerFormat`/`deleteServerFormat` | Consistent. `FormatsApi.formats` is `{id,name,format}[]`, a subset of `SavedFormat` — narrowing, not a conflict. |
| T5 → existing `formatStore` | `listFormats`/`saveFormat`/`deleteFormat`, `STORAGE_KEY` | Verified against the real file 2026-09-01. Match. |
| T4 ∥ T5 | Both modify a screen and may append to `components.css` | Different screens (`TeamBuilderScreen` vs `FormatBuilderScreen`); CSS appends are sequential. No conflict. |

### Each task against itself

| Task | Finding |
|---|---|
| T1 | Migration and tests agree. Deny tests use the right mechanics: an INSERT violating `with check` raises, a DELETE/UPDATE filtered by `using` silently affects 0 rows — and the tests assert survival, not a throw, for the latter. CHECK-constraint tests run as superuser, which bypasses RLS but not CHECKs. Correct. One leak noted below (N1). |
| T2 | Self-consistent. The immutability trigger is BEFORE UPDATE, so it fires for the table owner too — the "even as the table owner" test is sound, since ownership bypasses RLS but never triggers. |
| T3 | **DEFECT: the mock harness is missing methods its own code paths call.** `saveServerFormat` with an `id` calls `.update(...)`, and its version lookup calls `.limit(1)`; neither exists on the harness object. The "appends a version rather than updating one" test passes `id: 'f1'` and would die on `q.update is not a function`. See R2. |
| T4 | Prose-specified tests, self-consistent. Correctly warns that the roster is `team: string[]` plus a parallel `builds` record and that loading must set both. |
| T5 | Prose-specified, self-consistent. `MIGRATED_KEY` named identically in the interface block and the test list. |

### Rulings taken before execution

Ruling R1: **Fold the `owner_id` defaults into Tasks 1 and 2 and delete Task 3 Step 7.** The plan
as written creates the columns without a default, then amends them one task later — a migration
whose only job is to fix the previous one, on a database where migrations are now a production
deploy. Setting `default auth.uid()` at creation is the same end state with one fewer migration,
and it does not disturb T1/T2's own tests, which pass `owner_id` explicitly (an explicit value
beats a default). The spec's security model wants exactly one place deciding who owns a row.
Cost if wrong: two migrations carry a default that a later task would have had to add anyway.

Ruling R2: **Task 3's mock harness gains `update` and `limit`.** They are not embellishment — the
code under test calls both, so without them a test the plan mandates cannot run at all. Adding
them is the minimum that makes the plan's own assertions executable.
Cost if wrong: none; a harness that models the client less completely than the code uses.

Note N1: T1/T2 create `auth.users` fixtures in `beforeAll` and only clean up teams/formats in
`afterEach`, so the users persist for the run. Harmless — `db:reset` precedes the suite and the ids
are random per run — and cleaning them would fight the FK from `profiles`. Recorded, not fixed.

---

## Progress
Task 1: implemented (commit dc10a7d, 45/45 db tests — 32 pre-existing + 13 new).
Task 1: review — spec ✅, quality Approved, 1 Important + 1 Minor.
  Important: the `default auth.uid()` folded in by Ruling R1 has zero test coverage. Every insert
  in the test file supplies owner_id explicitly, so the omitted-owner_id path — the entire reason
  the default exists, and load-bearing for Task 3 — is untested. Reviewer confirmed by hand
  against the live stack that the behaviour is correct, so a coverage gap, not a live defect.
Task 1: minor (deferred): the mandated widen-and-confirm-failure exercise widened only the
  `teams` policy, never `team_members` — so the report demonstrated nothing about the child
  policy's `exists(...)` subquery, which is the more intricate of the two. The reviewer closed
  this itself: it widened the child policy against the live DB, saw the two expected deny tests
  fail, and restored it. Not a code defect; a gap in what the report showed. Future tasks doing
  this exercise should widen the child policy too.
Task 1: note — the reviewer mutated the RUNNING DATABASE to perform that check. It restored the
  policy and I verified independently (pg_policies shows both predicates intact, 45/45 green).
  Worth watching: a reviewer told to be "read-only on this checkout" reasonably reads that as
  saying nothing about the database the checkout talks to.
Task 1: fix round 1/5 dispatched — resumed implementer a269a5fd1fbdb0899 with the Important
  finding. FIX_BASE dc10a7d.
Task 1: fix round 1/5 (1 addressed, 0 open — owner_id default now covered by a test that asserts
  the defaulted VALUE equals the signed-in user, not merely that the insert succeeded; commits
  dc10a7d..44732fe). Re-reviewer confirmed the fix is additive-only and introduces no fixture leak.
Task 1: complete (commits 86ec2be..44732fe, review clean). 46/46 db tests.
Task 2: implemented (commit 68b53f2, 60/60 db tests — 46 pre-existing + 14 new). Widen-and-confirm
  done for BOTH parent and child policies this time, closing Task 1's deferred minor as a practice.
Task 2: review — spec ✅ (reviewer diffed migration and tests byte-for-byte against the brief
  rather than by eye), quality Approved, 1 Important (plan-mandated) + 1 Minor.
Task 2: Ruling: the Important finding is REAL and I am fixing it now rather than carrying it
  forward. `format_versions` claims to be immutable, and the trigger enforces that against UPDATE
  only — the owner's `for all` policy still permits DELETE, so a version can vanish. The spec says
  "immutable once published", and M2 decides matches under a specific version; a ruleset that can
  disappear after the fact is the integrity failure the immutability was for.
  The OBVIOUS fix is wrong and worth recording: a BEFORE DELETE trigger also fires on the cascade
  from `formats`, which would make a format undeletable — trading a small gap for a bigger one.
  The fix is to narrow the policy instead: replace the child `for all` with explicit select/insert
  policies (no delete). A direct client DELETE is then denied by RLS, while the parent's
  `on delete cascade` still works, because a cascade runs as the table owner and bypasses RLS.
  This also converts the reviewer's Minor into a requirement: narrowing the policy means an
  owner's own append must be proven to still work through RLS, which the suite did not test
  (every fixture inserted versions as the superuser).
  Cost if wrong: format versions accumulate with no way for a user to remove one directly, which
  is the behaviour the spec asks for and can be relaxed later; and if the narrowing is wrong in
  the other direction, Task 3 fails loudly on its first append rather than silently.
Task 2: ⚠️ carried forward for M2, not this milestone: whichever task adds `matches` must decide
  its FK to `format_versions` deliberately (RESTRICT, not CASCADE) — the reviewer correctly noted
  the end-to-end guarantee depends on it.
Task 2: fix round 1/5 dispatched — resumed implementer a47d1f4175c877f06. FIX_BASE 68b53f2.
Task 2: fix round 1/5 (1 addressed, 1 NEW open — commits 68b53f2..c8af5ae). DELETE gap correctly
  closed by policy narrowing, all three mandated tests correctly shaped. But the fix also dropped
  the UPDATE grant, which the re-reviewer caught as new breakage: an owner's UPDATE is now filtered
  by RLS to zero rows BEFORE reaching the trigger, so a loud `immutable` error became a silent
  no-op, and the implementer rewrote a passing test to match rather than flagging the trade.
Task 2: Ruling: MY RULING WAS AT FAULT — it specified "no delete" and said nothing about UPDATE,
  and the implementer reasonably read that as dropping both grants. Correcting it: grant UPDATE to
  the owner and let the TRIGGER refuse it, keeping DELETE ungranted. That is the layering this
  schema should have — RLS decides WHOSE rows, the trigger decides WHAT MAY CHANGE — and it
  restores a loud, diagnosable error on the one path a client actually takes. As built, the
  trigger was dead code on every client path, reachable only by the superuser.
  This also restores the original assertion (`rejects.toThrow(/immutable/)`) rather than keeping a
  test that was bent to fit the code. A silent no-op is the failure mode this codebase least wants:
  a caller that checks only for a thrown error now believes an edit to an immutable row succeeded.
  Cost if wrong: an owner's UPDATE raises instead of no-opping, which is the behaviour the test
  asserted before this task touched it.
Task 2: fix round 2/5 dispatched — resumed implementer a47d1f4175c877f06. FIX_BASE c8af5ae.
Task 2: fix round 2/5 (1 addressed, 0 open — commits c8af5ae..413a961). UPDATE policy restored as
  `for update` only (not `for all`, which would have silently undone round 1), owner UPDATE now
  reaches the trigger and raises loudly, DELETE still ungranted, cascade test untouched, and the
  bent test restored to `rejects.toThrow(/immutable/)` with a survival check kept alongside.
Task 2: complete (commits 44732fe..413a961, review clean). 63/63 db tests.
Task 3: implemented (commit bbec0ad, 1035/1035 app gate, 63/63 db unaffected). TDD evidence
  genuine — real "Cannot find module" RED for both modules before the source existed.
Task 3: implementer also caught and reverted a stray uncommitted edit to .superpowers/sdd/.gitignore
  that would have silently un-tracked every ledger. Verified independently: ignore intact, 20
  ledger files tracked, tree clean.
Task 3: review — spec ✅, quality NEEDS FIXES. 2 Important (both plan-mandated), 2 Minor.
Task 3: Ruling on Important #1 (saveTeam's update path untested): REAL, fix it. The delete-then-
  reinsert exists precisely so a roster shrinking from three to two does not strand a stale slot 3,
  and no test calls saveTeam with an id at all — so the one behaviour the design was built for is
  unguarded. My plan's own test list omitted it; the implementer copied it faithfully.
Task 3: Ruling on Important #2 (the update path is non-atomic): REAL, and I am fixing it rather
  than documenting it. As written it updates the team, deletes ALL members, then inserts — with no
  transaction. An insert that fails after the delete succeeds leaves the team with zero members
  when the user only meant to edit it. I wrote that sequence into the plan.
  Rejected: wrapping it in an RPC/stored procedure. That is a new migration and a server function
  to remove a window a reordering closes for free.
  The fix is to invert the order so there is never a moment with no members: UPSERT the new members
  at slots 1..n (the (team_id, slot) primary key makes this an overwrite), THEN delete only the
  slots beyond n. A failed upsert leaves the old roster untouched; a failed delete leaves stale
  extra slots, which are visible and recoverable rather than an empty team. Strictly better than
  delete-first in both failure directions.
  Cost if wrong: upsert semantics depend on the composite PK being the conflict target, so the fix
  names it explicitly; if that is wrong the shrink test fails loudly rather than silently.
Task 3: minor (deferred): teamCodec's `fast?.id ?? ''` stores an empty string for an unresolvable
  fast move, so decode returns unknownMove = '' — falsy, and indistinguishable from "no problem" to
  a caller doing `if (unknownMove)`. Unreachable from the UI today. Same loud-vs-silent class the
  codec exists to serve; worth the final review's triage.
Task 3: minor (deferred): the "never writes an owner_id" assertion covers only saveTeam's insert
  branch, not its update branch or either saveServerFormat branch.
Task 3: fix round 1/5 dispatched — resumed implementer aac0676e05c267d31. FIX_BASE bbec0ad.
Task 3: fix round 1/5 (1 addressed, 1 open — commits bbec0ad..9caebf9). Ordering fix confirmed
  real: upsert-before-scoped-delete with a position-based assertion (findIndex on the ordered call
  list), and the implementer proved it load-bearing by reintroducing delete-first and watching that
  test fail. Finding 1 NOT addressed: the update branch is now exercised, but the harness's `eq`
  and `gt` are bare no-ops recording nothing, so no test inspects the delete's SCOPING. Dropping
  `.gt('slot', n)` outright would leave every test green — the stranded-slot property, and its
  mirror image of wiping the whole roster, are both still unguarded beneath a passing shrink test.
Task 3: fix round 2/5 dispatched — make `eq`/`gt` record their arguments, assert the delete chain
  is scoped by both `team_id` and `slot > n` with the bound value checked, add the edit-to-empty
  case, and prove the new assertions load-bearing by dropping `.gt(...)` and confirming failure.
  FIX_BASE 9caebf9.
Note: `sdd-workspace` (line 39: `printf '*\n' > "$base/.gitignore"`) unconditionally overwrites
  the ledger-tracking ignore rule with `*`, and `review-package` invokes it — so every review
  package I generate clobbers it. Not the implementers' doing; two of them noticed and reverted it.
  Restoring it after each review-package call rather than fighting the script.
Task 3: fix round 2/5 (1 addressed, 0 open — commits 9caebf9..ce3c519). Harness now records eq/gt
  arguments; shrink and new empty-roster tests assert exact scoping and bound values. Re-reviewer
  traced all three mutation directions independently — drop `.gt`, wrong bound, drop `.eq` — and
  each now fails at least one assertion. saves.ts byte-unchanged this round; no other chain
  disturbed by the recording.
Task 3: complete (commits 413a961..ce3c519, review clean). 1039/1039 app, 63/63 db.
Task 4: Ruling: the browser measurement in Task 4's Step 5 stays with ME, not the implementer.
  The Browser pane is a session-level resource I already have open on the dev server, and two
  agents driving it would interleave; the repo's own guidance is also that panels closing on an
  outside click cannot be opened in one tool call and measured in another. The implementer does
  implementation, jsdom tests and the gate; I measure the rendered result myself before calling
  the task complete. Cost if wrong: one verification step happens in the controller rather than
  the subagent, and I report it as mine.
Task 4: implemented (commit 3958740, 1046/1046 app gate). Implementer also added SessionProvider to
  the shared test/render.tsx harness — outside the brief's file list but required, since
  TeamBuilderScreen now calls useSession() and 33 tests in 6 files broke without it. Safe because
  M1a already stubs @supabase/supabase-js suite-wide in test/setup.ts, so this adds no network.
Task 4: BROWSER VERIFICATION done by me, per the ruling above. Against the real local stack with a
  real confirmed account signed in through the app's own screen:
  - signed out: no save UI offered (#team-save-name absent)
  - signed in: save UI present; saving a roster hit the real database and returned "Saved teams (1)"
    with no error
  - overlay-not-expand HOLDS, measured not eyeballed: opening the saved-teams panel moved the
    element below it by 0.0px (665.2 -> 665.2), scrollHeight grew 0, panel computed position
    `absolute`
  - full round trip: after a page reload the session persisted, the saved roster was listed, and
    loading it back refilled the roster
  My first probe reported "no save UI while signed in" — that was MY wrong selector (#team-name vs
  the actual #team-save-name, "Save" vs "Save roster"), not a defect. Recorded because a less
  careful reading of that output would have opened a fix round against working code.
Task 4: review — spec ✅, quality Approved. No Critical, no Important. Reviewer independently
  confirmed the replace-vs-append test is load-bearing (pre-populates with different species and
  asserts scoped to .team-slots), that loadSaved sets BOTH team and builds, that the unknown-move
  notice runs through a real unmocked decodeMember, and that the render.tsx nesting matches
  App.tsx's real order.
Task 4: minor (deferred): the act() console warning in team-builder.test.tsx is NEW, not
  "pre-existing" as the report claimed — renderApp did not mount SessionProvider at all before this
  change, so a synchronous test now renders and asserts before SessionContext's getSession()
  microtask resolves. Benign and gate-green, but test output should be pristine; the final review
  should triage whether to silence it.
Task 4: minor (deferred): saving under an existing name creates a second row rather than updating
  (saveTeam is always called without an id), so saveTeam's update path — the one Task 3 fixed and
  tested — is currently unreachable from the UI.
Task 4: minor (deferred): the unknown-move notice prints the raw move id; save/delete refetch the
  whole list rather than updating local state.
Task 4: complete (commits ce3c519..3958740, review clean). 1046/1046 app.
Task 5: implementer ae743bcb1cf46f490 was terminated mid-task by an API session rate limit (not a
  capability failure). Assessed the wreckage rather than re-dispatching blind: useFormats.ts (169
  lines) and use-formats.test.tsx (291 lines) survived uncommitted, all eight brief behaviours are
  real it() blocks with the marking-after-success ordering test written FIRST, and the file runs
  8/8 green. FormatBuilderScreen.tsx untouched; nothing committed; HEAD still 3958740.
  Ruling: RESUME the same agent rather than dispatch a fresh one. The failure was infrastructure,
  its context is intact, and the remaining work (wire the screen, gate, commit) is the part that
  most needs to know why the hook is shaped as it is. A fresh implementer would have to re-derive
  that from a 460-line diff it did not write.
  Cost if wrong: the resumed agent's context is large, so if it stalls again the fallback is a
  fresh implementer carrying the report file as its memory.
Task 5: implemented (commit 290bcb2, 1054/1054 app gate). Migration mechanics verified correct and
  genuinely tested — the reviewer independently traced the ordering assertion against a reversed
  implementation and confirmed it inverts and fails, so the safety property is real.
Task 5: review — spec ❌, quality NEEDS FIXES. 1 Important (plan-mandated) + 2 Minor.
Task 5: Ruling: the Important finding is REAL and blocks the task. Signed-out Save now DUPLICATES
  instead of updating: `editing` is set only by onLoad/onNew, and nothing sets it after a save,
  because `FormatsApi.save` returns Promise<void> and discards the id `formatStore.saveFormat`
  hands back. Before this diff the screen called setEditing(entry.id) on every save. So: create a
  format, Save, edit, Save again — and a signed-out user now has two formats where they had one.
  That is a regression in the exact behaviour this task was required to leave untouched, and the
  fact that my own brief specified Promise<void> is what caused it, not an excuse for it.
  The fix is to change the interface I wrote: `save` returns Promise<string>, the saved format's
  id, and the screen sets `editing` from it. Both paths already have an id to hand back —
  formatStore.saveFormat returns a StoredFormat and saveServerFormat returns the id — so the void
  return was throwing away something both sides already knew. Rejected as worse: diffing the
  formats list before and after to infer which entry is new (fragile, and ambiguous for two
  formats with the same name), and a separate lastSavedId field (extra state for a value the call
  already produces).
  Cost if wrong: one more field crosses the hook's boundary than the brief imagined, which is the
  boundary the brief got wrong.
Task 5: minor (deferred, now SECOND occurrence): the act() SessionProvider warning has appeared in
  format-builder.test.tsx as well as team-builder.test.tsx, each time newly introduced by wrapping
  a previously-bare test file in SessionProvider. Two occurrences make this a pattern rather than
  an incident — the final review should decide whether to settle it centrally in the render helper
  rather than let each new screen test reintroduce it.
Task 5: minor (deferred): no test for a MULTI-item partial migration failure (first upload
  succeeds, a later one fails). Single-item failure is covered. This is the exact silent-duplication
  mode the plan's own known-risk section names.
Task 5: fix round 1/5 dispatched — resumed implementer ae743bcb1cf46f490. FIX_BASE 290bcb2.
Task 5: fix round 1/5 (1 addressed, 0 open — commits 290bcb2..f9b3712). `save` now returns the id,
  the screen sets `editing` from it, and both required tests assert the right discriminator: COUNT
  for signed-out (toHaveLength(1)) and the ARGUMENT identity for signed-in (second call carries the
  first call's id, not undefined). Re-reviewer confirmed no existing assertion was loosened — the
  two Save tests became async but their assertions are byte-identical — and that the one consumer
  handles the new return without a floating promise.
Task 5: complete (commits 3958740..f9b3712, review clean). 1056/1056 app.
ALL FIVE TASKS COMPLETE. Next: my own verification of the migration against a real database, then
  the final whole-branch review.
Task 5: CRITICAL DEFECT found by my own database verification, after the task review had passed and
  all 1056 unit tests were green. Seeded two local formats, signed in, opened Formats: the server
  received FOUR — "Air Ban" and "Ground Cup" twice each. This is exactly the silent-duplication
  failure the plan's known-risk section named, and no test caught it.
  MECHANISM (confirmed by reading the effect, not guessed): the migration's `live` flag guards
  setState only, never the upload loop. React StrictMode mounts the effect, tears it down, and
  mounts again; the teardown sets live=false for the first run but its awaits keep running, and the
  second run calls readMigrated() before the first has written anything. Both see an empty
  MIGRATED_KEY and both upload every format.
  NOT merely a StrictMode artifact: any remount of the Formats screen while a migration is in
  flight — navigating away and back — reproduces this in production.
  Why every test missed it: the unit tests mount the hook ONCE. The concurrency only exists across
  two overlapping mounts, which no test in the file creates.
Task 5: Ruling: this blocks the branch and goes back for a fix round. The guard must live OUTSIDE
  React state, because the whole problem is that React state does not survive the remount that
  causes it: a module-scoped in-flight promise keyed by user id, so a second mount AWAITS the
  first migration instead of starting a second one. Rejected: re-reading MIGRATED_KEY inside the
  loop (narrows the window, does not close it — both runs can sit between read and write), and
  relying on `live` (it cannot help; the second run is a different closure with its own live=true).
  Cost if wrong: a module-level singleton is process-wide rather than per-hook, which is correct
  here precisely because the resource being protected — localStorage plus the user's server rows —
  is also process-wide.
Task 5: fix round 2/5 (1 addressed, 0 open — commits f9b3712..0e9cc53). Module-scoped
  inFlightMigrations Map keyed by user id, written SYNCHRONOUSLY before the first await so a second
  mount awaits the existing promise instead of re-reading MIGRATED_KEY. Re-reviewer independently
  re-derived that the new concurrency test creates genuine overlap (deferred promise, first upload
  left unresolved, mid-flight toHaveBeenCalledTimes(1) assertion) and would catch the race; also
  confirmed the .catch(() => {}) is attached to the DERIVED .finally() promise, so it silences only
  the orphan and cannot swallow what a real awaiter observes. Unhandled rejection closed; gate
  EXIT=0, 1057 tests.
Task 5: MY END-TO-END RE-VERIFICATION against the real database, from the same starting state that
  previously produced four rows: exactly TWO formats, one version each; local copies preserved;
  MIGRATED_KEY records both ids; and a SECOND sign-in adds nothing (still 2 — idempotent).
Task 5: minor (deferred): `migrating` now flips true->false on every signed-in mount rather than
  only when something needs migrating — inert today because `loading` already covers the same
  window and the screen ORs the two, but it is a drift from the flag's own documentation.
Task 5: complete (commits 3958740..0e9cc53, review clean). 1057/1057 app, 63/63 db.
ALL FIVE TASKS COMPLETE. Dispatching the final whole-branch review.

## Final whole-branch review

Dispatched on the most capable model. Verdict: NO Critical. Six Important. Recommendation was to
fix two before merge; I ruled to fix ALL SIX, because each was a small, clearly-correct change with
a traced consequence, and the branch is about to become a production deploy.
  1. A saved team's league was stored, fetched, then silently DISCARDED on load — a Great-league
     roster loaded under Ultra put Great IVs in an Ultra-capped slot with every derived stat wrong
     and nothing said. The same failure the codec exists to prevent, arriving through another door.
  2. Save roster accepted an empty name, writing a row whose Load button had no text.
  3. listServerFormats fetched every version of every format (full rules jsonb) and picked the max
     client-side, re-running after every save while every save appends a version.
  4. No test asserted the appended version number, and the harness could not express one — a
     reversed sort or a hardcoded next=1 passed everything, and would be a unique violation on the
     user's THIRD save.
  5. Format delete had no confirmation though it now cascades the whole version history.
  6. A failed migration left a signed-in user with an empty list and no way to read it.
Final fix wave: one dispatch, all six (commit 3b15564), 1066/1066. Scoped re-review: all six
  ADDRESSED, no new breakage, and it independently verified the PostgREST `referencedTable` option
  against the INSTALLED CLIENT'S RUNTIME SOURCE rather than its type declarations — a misspelled
  option is silently ignored, so the types would not have caught it.
Deferred-item triage by the final review: none of the seven must be fixed before merge. Item 6
  (`migrating` drift) ruled Not a real issue; the rest fine to defer, with item 2 noted as partly
  stale (saveTeam's update branch IS now covered).

## Final state

App gate: 1066/1066, EXIT=0. Database suite: 63/63, EXIT=0. Both re-run by me on the final commit.
Branch feat/m1b-saves, 14 commits ahead of main. Local test account and its data removed.
NOT MERGED — merging to main deploys four migrations to production, which is a stop-and-ask.
