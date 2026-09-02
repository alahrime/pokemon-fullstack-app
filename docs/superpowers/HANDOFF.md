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
| **M1a** — accounts and identity | **Merged to main** (`42c6d27`) and **deployed to production** — see below. |
| **M1b** — user-owned saves | **Merged and pushed to `main`** (`0c4441b`, 2026-09-02 07:37 -0700) — production apply **not verified**, see below. |
| M2–M5 — matchmaking, social, messaging, records | Not started. Spec covers the design. |

Plans: `docs/superpowers/plans/`. Ledgers with every ruling: `.superpowers/sdd/<plan-name>/progress.md`
— read them, they carry the reasoning behind decisions that will otherwise look arbitrary.

**They are tracked, and this paragraph used to say otherwise.** It claimed
`.superpowers/sdd/.gitignore` was `*` and that the rulings never left the machine that wrote
them. That was true until `26bb6a3` ("chore: track the decision ledgers, which were only ever
local"), which committed 25 files across both milestones and rewrote that `.gitignore` to ignore
only `*.diff` — the review diffs, which `git diff A..B` regenerates from commits this repository
already has. `git ls-files .superpowers` is the check. The decision the paragraph said had not
been taken was taken.

---

## Do this first

```bash
colima start                      # the Docker runtime; Supabase local needs it
cd app && npm run db:start        # 12 containers, PostgreSQL 17.6
npm run check:db                  # 63 database tests
npm run check                     # 1066 app tests, Docker-free
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

## M1a is deployed — what was verified, and how

Merged to `main` as a fast-forward at `42c6d27`. The Supabase GitHub integration watches `main`
with "Deploy to production" on, so the merge applied all seven migrations to the production
database. Everything below was **measured against the hosted project**, not read off a dashboard.

| Thing | How it was proven |
|---|---|
| Confirm email on | `/auth/v1/settings` → `mailer_autoconfirm: false` |
| Discord enabled | `/auth/v1/settings` → `"discord": true`; `/auth/v1/authorize?provider=discord` 302s to Discord, which accepts the client_id and callback |
| Site URL correct | `/auth/v1/verify` with an invalid token bounces to `http://localhost:5173/#error=…` |
| Migrations applied | `/rest/v1/profiles` went from `PGRST205` (no such table) to `200` about 45s after the push |
| Schema shape correct | selecting all seven columns returns `200`, not `column does not exist` |
| **RLS enforcing** | an anonymous INSERT is refused `42501 new row violates row-level security policy`, and creates nothing |

That last row is the one worth repeating. An empty table returns `[]` whether RLS is on or off, so
"the table is there and returns nothing" proves nothing about protection. Only a **refused write**
distinguishes them. Any future check of a deployed policy should attempt the thing that must fail.

## M1b — done, pushed, production apply NOT verified

**Correction to this file's previous state.** It said fifteen commits were unpushed and deliberately
held. They were pushed at **2026-09-02 07:37:34 -0700** — 88 seconds after the commit that wrote
that sentence (`0c4441b`, the same SHA now on `origin/main`). Both gates were green on the merged
tree before the push (1066 app, 63 database).

Pushing `main` is what triggers the Supabase integration, so the branch's **four migrations**
— `teams`, `formats`, `format_versions_undeletable`,
`format_versions_update_reaches_the_trigger` — have reached the production database, or are on
their way there. M1a measured that apply at roughly 45 seconds after the push.

**Nobody has measured the hosted project since.** M1a's rule applies unchanged: an empty table
returns `[]` whether RLS is on or off, so only a **refused write** proves protection. Run both
checks against `teams`, `team_members`, `formats` and `format_versions`:

```bash
# 1. the table is there:  expect 200, not PGRST205
curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $KEY" "$URL/rest/v1/teams?select=id&limit=1"

# 2. RLS is enforcing:    expect 42501 new row violates row-level security policy
curl -s -X POST -H "apikey: $KEY" -H 'Content-Type: application/json' \
  -d '{"name":"rls probe"}' "$URL/rest/v1/teams"
```

**`$URL` is `https://kgfxzjgpjsiaxvlneufz.supabase.co`.** The project ref is not in this repo; it
came from the Supabase GitHub App's check run, which is public on a public repo:

```bash
curl -s https://api.github.com/repos/alahrime/pokemon-fullstack-app/commits/main/check-runs \
  | python3 -c "import json,sys; [print(c['name'],c['conclusion'],c['details_url']) for c in json.load(sys.stdin)['check_runs']]"
```

That check reports **success**, started `14:38:08Z` and completed `14:38:12Z` — 38 seconds after
the push, matching M1a's ~45s. **Treat it as a report, not a measurement.** It says the
integration ran and was happy; it does not say `teams` exists, and it says nothing whatsoever
about whether a policy refuses an anonymous write. It is also named "Supabase Preview", which is
the same check name the integration uses for preview branches.

`$KEY` is still missing — the hosted publishable key is in neither the repo nor its history
(`git log --all -S sb_publishable_` finds only test fixtures), and `app/.env.local` holds the
local stack's. It is at
`https://supabase.com/dashboard/project/kgfxzjgpjsiaxvlneufz/settings/api-keys`. Take the
**publishable** key: the service-role key bypasses every policy in `supabase/migrations`, so
check 2 run with it returns `201` and silently writes a junk row to production instead of proving
anything. Without any key both endpoints answer `401 No API key found in request` — which does at
least prove the project is up and routing.

**What it delivered.** `teams`/`team_members` and `formats`/`format_versions` behind owner-scoped
policies; `format_versions` immutable by trigger, with UPDATE reaching the trigger (loud error) and
DELETE denied by RLS (the parent cascade still works, because a cascade runs as the table owner).
`app/src/lib/teamCodec.ts` converts between the builder's fast-move INDEX and the stored move ID —
`species.json` is generated, so a stored index would silently repoint after a rebuild.
`app/src/lib/saves.ts` is the data layer; the team builder saves and loads rosters; and
`app/src/state/useFormats.ts` migrates localStorage formats to the server on first sign-in while
leaving the signed-out path completely offline.

### The bug that matters more than the feature

Task 5 passed its review with 1056 green tests. Then the real end-to-end migration against Postgres
turned two local formats into **four** server rows.

React StrictMode mounts an effect, tears it down, and mounts it again. The migration's `live` flag
guarded `setState` and not the upload loop, so the first run's uploads kept going after teardown
while the second run read `MIGRATED_KEY` before the first had written to it. Both uploaded
everything. **This is not a StrictMode artifact** — navigating away from Formats and back
mid-migration reproduces it in production.

Every unit test missed it because they all mount the hook once. The guard now lives in a
module-scoped in-flight promise keyed by user id, because the thing that breaks is precisely the
remount that React state does not survive. The test that pins it mounts twice concurrently and
asserts the CALL COUNT.

**The general lesson, worth more than the fix:** a suite that mounts a hook once cannot see a
remount race, and no amount of green in it is evidence about one.

## Follow-ups M1b deliberately left

None block the deploy. Triaged by the whole-branch review.

- **`saveTeam`'s update path is unreachable from the UI.** Saving a roster under an existing name
  creates a second row; the update path exists, is tested, and has no caller. An "overwrite"
  affordance is the natural next change.
- **`saveServerFormat`'s version lookup is untestable in the current harness.** The mock's `order`
  and `limit` do not reorder rows, so a reversed sort in *that* function still passes. It would
  surface as a `unique (format_id, version)` violation on a user's third save.
- **An `act()` warning about `SessionProvider`** is latent for every screen test using
  `test/render.tsx`, which now mounts the provider. Console noise, not correctness; settle it in
  the helper when someone is next in there.
- **`rules_hash` stores a canonical serialization, not a hash** (`canonicalize()` returns a string).
  The spec says so, but M2 partitions and indexes on that column — a `sha256` at the write site
  would cost nothing now.
- **`teamCodec` records `level` via `getEntry(..., league)` without `bestBuddy`**, while the builder
  draws its spread from `defaultSpreadFor(..., true)`. Inert today (`decodeMember` ignores `level`),
  but the column exists to detect a level that moved, and it cannot do that against an inconsistent
  baseline.

## When M2 arrives

- **The `matches` FK to `format_versions` must be chosen deliberately — RESTRICT, not CASCADE.**
  Owners can no longer delete a version, but that guarantee is only end-to-end if the FK cooperates.
- **`rules_hash` becomes a trust boundary.** It is computed on the client today, which is fine while
  nothing depends on it being honest. The moment the queue partitions by it, the coordinator must
  recompute it rather than believe a client.

## Still outstanding

- [ ] **AT DEPLOY TIME: change the hosted Site URL to the real domain.** It is `http://localhost:5173`
      today, which is correct only while nothing is deployed. Forgotten, it sends every confirmation
      link and OAuth return for real users to a laptop. The accounts still confirm — the token is
      verified at Supabase before the redirect — so it fails as a dead page rather than a failed
      signup, which is exactly the shape of a problem that survives a launch.
- [ ] The Supabase GitHub App is granted `pokemon-fullstack-app` and deploys on every push to
      `main`. **Merging to `main` is now a production database deploy, every time.** Treat any
      future migration as an outward-facing change.

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
7. **A test suite that mounts once cannot see a remount race.** M1b's format migration duplicated
   every format under StrictMode's mount/unmount/mount, and 1056 green tests plus a full task
   review missed it — the bug only exists across two overlapping mounts, which nothing in the suite
   created. It was found by running the real thing against the real database.
8. **A schema can be complete and still untested against a path nobody ran.** The profile
   trigger passed 26 tests and was still incapable of accepting an OAuth signup, because every
   test drove the email path. When a code path is gated behind a config toggle nobody has turned
   on yet, its first real exercise is production.
9. **Vite reads env from `app/`, not the repo root.** `supabase/` is at the repo root; the Vite
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
