# Handoff — paragon-iv platform build

**Written:** 2026-09-01, end of session. **Branch:** `feat/m1a-accounts`, 11 commits ahead of `main`.

Read this, then `docs/superpowers/specs/2026-08-31-paragon-platform-design.md`. The spec is the
design authority; the plans argue from it.

---

## Where the work is

| Milestone | State |
|---|---|
| **M0** — format rules engine + builder, offline | **Merged to main** (`00b0441`) |
| **M0b** — builder UI controls (type chips, set view, per-species X) | **Merged to main** |
| **M1a** — accounts and identity | **Tasks 1–4 done** on `feat/m1a-accounts`, **NOT merged**. Tasks 5–6 remain. |
| M1b — user-owned saves (teams, formats migration) | Not started, not planned |
| M2–M5 — matchmaking, social, messaging, records | Not started. Spec covers the design. |

Plans: `docs/superpowers/plans/`. Ledgers with every ruling: `.superpowers/sdd/<plan-name>/progress.md`
(tracked in git, not ignored — read them, they carry the reasoning behind decisions that will
otherwise look arbitrary).

---

## Do this first

```bash
colima start                      # the Docker runtime; Supabase local needs it
cd app && npm run db:start        # 12 containers, PostgreSQL 17.6
npm run check:db                  # 26 database tests
npm run check                     # 973 app tests, Docker-free
cd app && npm run db:stop         # ALWAYS stop it when done
```

**Two gates, deliberately separate.** `npm run check` is the everyday one and needs no Docker.
`npm run check:db` runs the RLS assertion and policy tests against the local stack, and is
**required before merging anything touching a migration or a policy**. The spec asked for these
in one gate; splitting them was a deliberate ruling — a gate people skip protects nothing.

---

## What remains in M1a

**Task 5** — `app/src/lib/supabase.ts` and `app/src/state/SessionContext.tsx`. Create the browser
client from env, fail loudly at startup if the vars are missing. Session context reads the
existing session, subscribes to `onAuthStateChange`, unsubscribes on unmount. Follow
`app/src/state/ThemeContext.tsx` for this codebase's context shape.

**Task 6** — `app/src/screens/SignInScreen.tsx`. Registration collects **GO username, email, date
of birth, terms acceptance**. The age gate refuses under-13s and sits **in front of both** sign-in
methods — a Google/Discord user can otherwise authenticate before ever seeing an age screen.

Full step-by-step in `docs/superpowers/plans/2026-09-01-m1a-accounts-and-identity.md`.

### Three things Task 6 must handle that are not obvious

1. **A confirmed account can exist with no profile.** This is deliberate. The profile trigger
   catches a `unique_violation` on `display_name` so a name collision cannot block confirmation —
   without that, a user whose chosen name was taken between signup and confirmation could never
   confirm (same collision every retry) and never re-register (email taken). Admin-only escape.
   So Task 6 must treat "signed in, no profile" as a real state and prompt for a free name. At
   that point a session exists, so the ordinary insert policy applies and no trigger is needed.

2. **`site_url` in `supabase/config.toml` is wrong.** It points at `:3000`; Vite serves on
   `:5173`. With email confirmation required, that redirect is load-bearing — a local confirmation
   link currently lands on a dead port. Fix it in Task 6.

3. **The key format is unverified against the client.** `app/.env.local` uses
   `sb_publishable_…` (Supabase's newer format) rather than the legacy `eyJ…` anon JWT. Recent
   `@supabase/supabase-js` accepts it; older versions expect the JWT. Task 5's first real check is
   that the client authenticates at all. If it rejects the format, `supabase start` prints the
   legacy `ANON_KEY` too — one-line change, not a redesign.

---

## Blocked on the human — do not invent workarounds

The controller cannot create accounts or handle credentials. If a task needs one of these and it
is missing, report and stop.

- [ ] **Enable "Confirm email" on the hosted Supabase project.** It is a GoTrue auth setting, not
      a schema migration, so **the GitHub integration will not carry it**. Local `config.toml`
      does not propagate. Without it, production auto-confirms and the profile trigger runs a path
      that was never tested — on real accounts.
- [ ] **Choose an OAuth provider.** Google was abandoned: Google Cloud demanded billing. Discord
      is recommended (free, and where competitive GO PvP actually organises — Silph Arena, local
      leagues); GitHub also works. **This costs no code** — `signInWithOAuth({ provider })` is
      provider-agnostic, so it is a dashboard toggle.
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
7. **Vite reads env from `app/`, not the repo root.** `supabase/` is at the repo root; the Vite
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
