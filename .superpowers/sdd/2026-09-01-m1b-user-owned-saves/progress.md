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
