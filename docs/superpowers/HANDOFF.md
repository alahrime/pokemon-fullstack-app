# Handoff — paragon-iv platform build

**Written:** 2026-09-01, end of session. **Branch:** `feat/m1a-accounts`, 13 commits ahead of `main`.

Read this, then `docs/superpowers/specs/2026-08-31-paragon-platform-design.md`. The spec is the
design authority; the plans argue from it.

---

## Where the work is

| Milestone | State |
|---|---|
| **M0** — format rules engine + builder, offline | **Merged to main** (`00b0441`) |
| **M0b** — builder UI controls (type chips, set view, per-species X) | **Merged to main** |
| **M1a** — accounts and identity | **Complete** (Tasks 1–6) on `feat/m1a-accounts`, **NOT merged** — see the blockers below. |
| M1b — user-owned saves (teams, formats migration) | Not started, not planned |
| M2–M5 — matchmaking, social, messaging, records | Not started. Spec covers the design. |

Plans: `docs/superpowers/plans/`. Ledgers with every ruling: `.superpowers/sdd/<plan-name>/progress.md`
— read them, they carry the reasoning behind decisions that will otherwise look arbitrary.

**Correction:** an earlier version of this file said those ledgers were tracked in git. They are
not — `.superpowers/sdd/.gitignore` is `*`, so every ruling recorded there exists only on the
machine that wrote it and reaches no clone, no reviewer and no future session on another
checkout. That is worth a decision either way; it has not been taken.

---

## Do this first

```bash
colima start                      # the Docker runtime; Supabase local needs it
cd app && npm run db:start        # 12 containers, PostgreSQL 17.6
npm run check:db                  # 32 database tests
npm run check                     # 1024 app tests, Docker-free
cd app && npm run db:stop         # ALWAYS stop it when done
```

**Two gates, deliberately separate.** `npm run check` is the everyday one and needs no Docker.
`npm run check:db` runs the RLS assertion and policy tests against the local stack, and is
**required before merging anything touching a migration or a policy**. The spec asked for these
in one gate; splitting them was a deliberate ruling — a gate people skip protects nothing.

---

## What M1a delivered

All six tasks. `app/src/lib/supabase.ts` (the browser client, refusing to start without its env),
`app/src/state/SessionContext.tsx` (`useSession()`), `app/src/lib/age.ts` (the 13-year rule
against an injectable clock), `app/src/screens/SignInScreen.tsx`, and `app/public/terms.html`.
The screen is registered as the `account` destination in the nav and on the landing page, and
`SessionProvider` is mounted at the root of `App`.

**The three things the previous handoff flagged are all resolved.** The `sb_publishable_…` key
format is accepted by `@supabase/supabase-js` 2.112.4 (proven against the stack: a wrong password
returns `400 invalid_credentials`, not `401 Invalid API key`). `site_url` now points at
`localhost:5173`, with both 5173 hostnames in `additional_redirect_urls`. "Confirmed account with
no profile" is handled — it is the screen's complete-your-profile form.

### A defect Task 6 found in Task 4's schema

**OAuth signup was impossible at the database level**, and would have failed the moment a provider
was enabled. GoTrue inserts a provider account *already confirmed*, so `handle_confirmed_user()`
fired on the INSERT with `raw_user_meta_data` holding only Discord's own fields — no
`display_name`, `go_username` or `birth_date`, all three `NOT NULL`. The resulting
`not_null_violation` is **not** the `unique_violation` the handler forgives, so it propagated and
took the entire `auth.users` INSERT with it.

Migration `20260901225208` skips profile creation when any of the three is absent. The account is
left confirmed with no profile — the same state a lost `display_name` race already produces, and
the one the screen already had to handle. Six database tests cover it; five of them failed against
the pre-migration schema for exactly this reason.

**Consequence worth knowing:** provider accounts never get a profile from the trigger, so terms
acceptance is collected on the complete-your-profile form rather than only in front of the
provider button. That is the only arrangement where `tos_accepted_at` is true for every account.

### Two deviations from the plan, both deliberate

- **Registration collects five things, not the plan's four.** `display_name` is `NOT NULL` and
  unique and the trigger reads it from metadata; omitting it would have produced the same
  `not_null_violation` lockout on the *email* path.
- **The provider button says Discord, not Google.** One constant (`OAUTH_PROVIDER` in
  `SignInScreen.tsx`) plus a dashboard toggle. Google was abandoned over Google Cloud billing.

## Blocked on the human — do not invent workarounds

The controller cannot create accounts or handle credentials. If a task needs one of these and it
is missing, report and stop.

- [ ] **Enable "Confirm email" on the hosted Supabase project.** It is a GoTrue auth setting, not
      a schema migration, so **the GitHub integration will not carry it**. Local `config.toml`
      does not propagate. Without it, production auto-confirms and the profile trigger runs a path
      that was never tested — on real accounts.
- [ ] **Enable Discord in Supabase → Auth → Providers.** The code now asks for `discord` by
      name. Until it is enabled the button returns a provider error; nothing else breaks. To use
      GitHub or Google instead, change `OAUTH_PROVIDER` in `app/src/screens/SignInScreen.tsx` —
      one constant, no other code.
- [ ] **Confirm which branch the Supabase GitHub integration watches.** Merging M1a to that branch
      applies six migrations to the production database.
- [ ] Grant the Supabase GitHub App access to `pokemon-fullstack-app` specifically (authorising the
      account is not the same as granting the repo).

**Do not merge M1a to main until the first and third are settled.** This is a deliberate departure
from the standing "ship gate-green work" preference: merging is no longer neutral, because the
GitHub integration turns it into a production schema deploy.

---

## Identity model — settled, with reasons

Do not re-litigate these without reading the ledger; each cost discussion.

- **Email is the identity anchor** (`auth.users.email`), verified by the provider, survives renames.
  Deliberately **not** copied into `profiles` — a second copy would drift.
- **`display_name`** — Paragon-specific, unique, **changeable**. It was immutable via trigger; the
  owner reversed that. Uniqueness prevents two people holding a name at once, not sequentially, so
  impersonation-by-rename is now possible. If that bites, the answer is a rename cooldown plus
  visible history, not re-freezing.
- **`go_username`** — the in-game trainer name. **Mutable and deliberately NOT unique.** No public
  GO API can prove ownership, and a unique constraint on unverifiable mutable data collides the
  moment someone renames into a freed name. Duplicates do not harm dispute adjudication: a match
  names its participants by id.
- **`friend_codes`** — a **separate table**, because Postgres RLS is row-level, not column-level: a
  friend code needs different visibility from the rest of a profile and two rules cannot share a
  row. `code` is **user-editable** — trainers can regenerate codes in Pokémon GO. (The spec
  originally claimed otherwise and was corrected; see its "Correction to an earlier draft".)
- **`tos_accepted_at`** — timestamp, terms a placeholder. Consent nobody recorded cannot be
  backfilled.
- **Under-13 registration is refused outright.** Verifiable parental consent is its own compliance
  apparatus, and a restricted-minor tier would mean a permission system across every social surface.

---

## Traps this codebase has actually sprung

Every one of these produced a real false result during the build.

1. **Piped exit codes lie.** `cmd | tail` reports *tail's* status. This produced **three** false
   "success" readings, including one where a nonexistent command reported exit 0. Always
   `cmd > out.log 2>&1; echo "EXIT=$?"`.
2. **`azumarill` is not Shadow-eligible.** It broke test fixtures twice. `registeel` is.
3. **A dev server left running poisons the suite.** One stray vite process turned a 44-second gate
   into a 68-minute run with 20 spurious timeout failures. Always stop what you start.
4. **Nested `begin`/`rollback` text against the test harness's own transaction silently commits.**
   `supabase/tests/helpers.ts` uses a single shared connection. Use plain autocommitting statements
   for fixtures.
5. **jsdom applies no stylesheet.** A component test asserting computed layout asserts nothing.
6. **`app/src/rules/` must import no React and no browser API.** A server will run it. Guarded by
   `isolation.test.ts` *and* `npm run rules:node`, which bundles and executes it under Node — the
   text scan alone cannot see transitive imports, which is how a Vite-only `import.meta.env`
   dependency slipped in once.
7. **A schema can be complete and still untested against a path nobody ran.** The profile
   trigger passed 26 tests and was still incapable of accepting an OAuth signup, because every
   test drove the email path. When a code path is gated behind a config toggle nobody has turned
   on yet, its first real exercise is production.
8. **Vite reads env from `app/`, not the repo root.** `supabase/` is at the repo root; the Vite
   project root is `app/`. Hence `--workdir ..` on the db scripts and `.` as the integration's
   working directory.

---

## Working agreement that produced good results

Subagent per task, review between, fix loops where reviews find something. Reviews caught real
defects repeatedly — including several in the *plans* rather than the implementations. Notably:
a satisfiability search walking permutations instead of combinations; a tautological test that
re-derived production logic instead of calling it; a picker that silently offered a control that
could never work; and an account-lockout path.

Ask reviewers a *specific* question about the thing most likely to be silently wrong. Generic
review prompts found generic issues; pointed ones found the real bugs.
