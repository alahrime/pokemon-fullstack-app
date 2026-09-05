# Handoff — paragon-iv platform build

**Written:** 2026-09-01. **Last updated:** 2026-09-05. **Branch:** `main`, pushed and up to date
with `origin/main` (`81a6ef4`). Start at "Where this session left off" below — it is the only
part of this document that is about *right now*; everything under it is standing reference.

Read this, then `docs/superpowers/specs/2026-08-31-paragon-platform-design.md`. The spec is the
design authority; the plans argue from it.

---

## Where the work is

| Milestone | State |
|---|---|
| **M0** — format rules engine + builder, offline | **Merged to main** (`00b0441`) |
| **M0b** — builder UI controls (type chips, set view, per-species X) | **Merged to main** |
| **M1a** — accounts and identity | **Merged to main** (`42c6d27`) and **deployed to production** — see below. |
| **M1b** — user-owned saves | **Merged, pushed, and verified in production** — four tables exist, anonymous writes refused `42501`. Two guarantees still unproven there; see below. |
| **M2a** — matchmaking: queue, live offers, scheduled offers | **Merged and deployed** 2026-09-04 18:01Z (`9fca5b9`). Verified in production: all tables `200`, anonymous INSERT refused `42501` RLS, anonymous UPDATE refused `42501` **permission denied** — the revoke that closes the two Criticals. **INERT until the two Vault secrets exist** — see below. |
| **Friend codes** — the account screen collects one | **Merged, deployed, verified** (`996be91`). Migration confirmed present in production's own schema dump; the field renders on the deployed site. |
| **M2b** — reporting and adjudication | **Planned, not started** — `docs/superpowers/plans/2026-09-05-m2b-reporting-and-adjudication.md` |
| **M3a** — friendships and blocks | **Planned, not started** — `docs/superpowers/plans/2026-09-05-m3a-friendships-and-blocks.md` |
| **M3b** — channels: DMs, groups, match channel | **Planned, not started** — `docs/superpowers/plans/2026-09-05-m3b-channels-dms-and-groups.md` |
| M4–M5 — ranked, records, groups | Not started. Spec covers the design. |

---

## Where this session left off — 2026-09-05

**The one thing to do first: prove the coordinator actually ticks.** The two Vault secrets were
created on 2026-09-04 at ~23:53Z (both `create_secret` calls returned ids), but the check that
would prove they WORK was never run. `cron.job_run_details` showing `succeeded` proves nothing —
an unconfigured tick is recorded `succeeded` too, by design (see "Deploying M2a"). The three runs
observed (23:51, 23:52, 23:53) may all predate the secrets. Run this in the SQL editor:

```sql
select id, status_code, left(content, 200) as content, created
  from net._http_response order by id desc limit 3;
select name, created_at from vault.secrets order by name;
```

A row in `net._http_response` is the proof: `net.http_request_queue` never gains one on the
unconfigured path. Expect `200` with `{"verified":0,"paired":0,"swept":0}` — the zeros are right,
production's board is empty. `401` means the value stored under
`coordinator_service_role_key` is not the service-role key; `404` means `coordinator_url` is
wrong; empty, with both names present and a tick newer than them, means a misspelled name.

**Why this matters:** until it is proven, "matchmaking works in production" is unverified, and the
failure mode is silence in every surface — no error in the app, none in the dashboard.

### What was done, and how it was checked

| Change | Evidence it landed |
|---|---|
| Friend-code UI + `20260904190000` migration (`996be91`) | Registered an account through the real browser with `9876-5432-1098`; signup metadata and the `friend_codes` row both read `9876 5432 1098`. Changing it to `555566667777` from the signed-in view stored `5555 6666 7777`. Constraint rejects `12345678` (`23514`). Metadata reading `nonsense` still confirms, with no code. |
| Migration reached production | `supabase db dump --linked` — the constraint at line 377 of the dump, and `handle_confirmed_user` carrying the `friend_code` block. `migration list`: nothing out of sync. |
| Coordinator Edge Function deployed | `functions list` → slug `coordinator`, `ACTIVE`, v1, `verify_jwt: true`. Unauthenticated `POST` → `401`. Platform injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (`secrets list`), so no function secret is set by hand. |
| Frontend live | The friend-code field renders past the age gate on `paragon2.alahrime.workers.dev`. No account was created there. |

### Open, in the order they block things

1. **Prove the tick** — above.
2. **Site URL is still `http://localhost:5173`** — re-measured 2026-09-04, not recalled:
   `GET /auth/v1/verify?token=invalid&type=signup` `303`s there. Fix in Dashboard →
   Authentication → URL Configuration: Site URL to the deployed origin, and add both it and
   `http://localhost:5173/**` to Redirect URLs. **Not** via `supabase config push`, which would
   push the whole auth block from `config.toml` and could clobber the Discord provider settings.
3. **The production account cannot post an offer** and this is not a bug: the Post control is not
   rendered without a saved format for that league (`MatchmakingScreen.tsx:621`). Author one on
   the Formats screen and save it.
4. **Testing Accept on production needs a second account.** You cannot accept your own offer, and
   `app/tools/opponents.ts` refuses any URL that is not localhost, by design — it creates accounts.

### Local stack state, so it is not rediscovered

- Two bot accounts with friend codes `1111 2222 3333` / `4444 5555 6666`, now written by the
  seeder itself rather than by hand.
- Six seeded offers — live and scheduled across all three leagues — **expiring 2026-09-09**.
  Re-run the seeder after that and they come back fresh.
- A throwaway `FriendCodeProof` account from the end-to-end proof. It has no offers and no queue
  entry; delete it or ignore it.
- The database password was rotated on 2026-09-05. Re-run
  `npx supabase link --project-ref kgfxzjgpjsiaxvlneufz` once, or CLI commands carry a stale one.
- **Two signed-in accounts at once, for anything two-sided** (reporting, Accept, DMs). One dev
  server, two origins: `http://localhost:5173` and `http://127.0.0.1:5173`. A different port or
  host is a different *origin*, and `localStorage` — where `supabase-js` keeps the session under
  `sb-127-auth-token` — is partitioned per origin, so the two windows hold independent sessions.
  Both hostnames are already in `additional_redirect_urls` (`config.toml:169`), so email
  confirmation works from either. **Measured, not assumed**: a `probe` key written on one origin
  reads `null` on the other, and two different accounts survived a reload side by side.
  Sign the second one in as a bot — `test-opponent-{1,2}@example.test` /
  `Test-Opponent-{1,2}-fixture` (`app/tools/opponents.ts:119`), already confirmed, with profiles,
  friend codes, formats and rosters. Under the Vite dev server you can skip the sign-in screen:
  `const m = await import('/src/lib/supabase.ts'); await m.supabase.auth.signInWithPassword({…})`
  from the console writes the session into that origin exactly as the app would.
  **This does not work on production**, which is a single origin — use a second browser profile
  or an incognito window there. That is the answer to open item 4.
- `app/.env.local.bak` is untracked and harmless. `app/.env.local` points at the LOCAL stack;
  the commented block at its top is how you point it at production, and Vite reads it only at
  startup.

---

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
npm run check                     # 1209 app tests, Docker-free
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

## M1b — done, pushed, and verified in production

**Correction to this file's previous state.** It said fifteen commits were unpushed and deliberately
held. They were pushed at **2026-09-02 07:37:34 -0700** — 88 seconds after the commit that wrote
that sentence (`0c4441b`, the same SHA that reached `origin/main`). Both gates were green on the
merged tree before the push (1066 app, 63 database).

The hosted project is **`https://kgfxzjgpjsiaxvlneufz.supabase.co`**. The ref is in no file here;
it came from the Supabase GitHub App's check run, which is public on a public repo:

```bash
curl -s https://api.github.com/repos/alahrime/pokemon-fullstack-app/commits/main/check-runs \
  | python3 -c "import json,sys; [print(c['name'],c['conclusion'],c['details_url']) for c in json.load(sys.stdin)['check_runs']]"
```

That check reported **success** at `14:38:12Z`, 38 seconds after the push. **It is a report, not a
measurement** — it says the integration ran and was happy, and nothing about whether a table exists
or a policy refuses a write. It is also named "Supabase Preview", the name the integration uses for
preview branches. What follows is the measurement.

### Measured against the hosted project, 2026-09-02

`$KEY` is the **publishable** key from
`https://supabase.com/dashboard/project/kgfxzjgpjsiaxvlneufz/settings/api-keys`. Never the
service-role key: it bypasses every policy in `supabase/migrations`, so check 2 run with it returns
`201` and writes a junk row to production instead of proving anything.

| Thing | How it was proven |
|---|---|
| The four migrations applied | `GET /rest/v1/{teams,team_members,formats,format_versions}` → `200`, not `PGRST205`. `profiles` and `friend_codes` still `200`, so M1a did not regress. |
| **RLS enforcing on all four** | anonymous `POST` to each → `401` / **`42501 new row violates row-level security policy`**, on `teams`, `team_members`, `formats`, `format_versions` and `profiles` alike. Nothing was created; a `42501` inserts no row. |
| It is RLS, not a missing GRANT | the message is the **policy** one. `permission denied for table …` — also `42501` — would mean `anon` was never granted the table, which protects the same rows for a different reason and would stop protecting them the moment a grant was added. |
| The refusal is not a constraint confound | `owner_id` is `not null default auth.uid()`, which is NULL for `anon`, so an omitted `owner_id` could fail on the NOT NULL alone. Forcing `owner_id` to a nonexistent uuid — a row that would otherwise die on the FK — returns the **same** `42501`. RLS is evaluated ahead of both. |
| Signup config unchanged | `/auth/v1/settings` → `mailer_autoconfirm: false`, `discord: true`, `disable_signup: false`. |

**Two guarantees this could NOT prove, and why.** `format_versions` being undeletable and the
immutability trigger both need a **signed-in owner** to exercise. Anonymous `UPDATE`/`DELETE` are
filtered to zero rows by the SELECT policy and return `204` whether or not the guarantee holds —
the same trap as an empty `SELECT`. Proving them needs a confirmed account, which production does
not yet have. They have since been driven **locally** through the real client as a signed-in
owner — the UPDATE came back `a format version is immutable; append a new version instead`, the
DELETE removed nothing of the three, and deleting the parent format still cascaded them away —
which is stronger than `check:db`'s SQL and still not production.

**`profiles` returns `[]` because production has no accounts at all**, not because a policy hid
them. An empty table proves nothing either way — that is the whole reason check 2 exists.

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

- ~~**`saveTeam`'s update path is unreachable from the UI.**~~ **Done.** Saving under a name the
  load list already holds now asks `Replace "X"…?` and takes the update path on yes; declining
  writes nothing rather than answering "don't replace it" with a duplicate. Matching is trimmed and
  case-insensitive, and the prompt names both leagues when they differ, because the update path
  rewrites `league` along with the members. Two gaps stay open, both deliberate:
  - ~~**It cannot close the two-tab race.**~~ **Closed by migration `20260902163500`** —
    `teams_owner_name_uniq`, a unique index on `(owner_id, lower(btrim(name)))`. The expression
    matches the client's own `name.trim().toLowerCase()`; an index on bare `name` would accept
    `"  gl squad  "` after the prompt had already called it taken, which is two rules disagreeing
    about what a duplicate is. `saveTeam` maps that `23505` to a sentence naming the roster and
    passes every other write error through untouched. **Pushed and deployed** 2026-09-02 18:50Z
    (`6d82156`); the integration reported success in six seconds and the five tables still answer
    `200` with anonymous writes still refused `42501`. **The index itself is NOT measured in
    production** — an anonymous INSERT is stopped by RLS long before it reaches a unique index, so
    proving it needs a signed-in owner, exactly like the immutability trigger. It is proven
    locally: four database tests, plus two concurrent `saveTeam` calls on one account where one
    won, one came back with the sentence, and one row existed.
  - ~~**The update path has never run against real Postgres.**~~ **It has now.** `saves.test.ts`
    mocks the Supabase client, so `upsert(…, { onConflict: 'team_id,slot' })` and the
    `gt('slot', n)` delete had only ever been checked against a mock builder that agrees with
    whatever it is told — trap #7's exact shape. A throwaway script bundled the **real**
    `saves.ts` through esbuild (`--define:import.meta.env=…` supplies what Vite normally
    replaces) and ran it against the local stack as a real confirmed account, created through
    the real signup-and-mailbox path rather than an admin shortcut, so `handle_confirmed_user()`
    made the profile that `teams.owner_id` references. Nine checks, all passing: the insert wrote
    three members in slot order; the update returned the same id, left exactly one row, replaced
    both members and the league, and left `team_members` holding slots 1 and 2 — the shrink from
    three to two is what exercises the delete; and saving the same name **without** an id still
    produced a second row, which is the duplicate the prompt above now stands in front of.
- ~~**`saveServerFormat`'s version lookup is untestable in the current harness.**~~ **Answered by
  measurement, not by a new mock.** The mock's `order` and `limit` still do not reorder rows, so
  that harness still cannot judge this function — the fix was to stop asking it. Three saves
  against the local stack through the real module: the third appended `version = 3` instead of
  colliding on `unique (format_id, version)`, the table held `[1, 2, 3]`, and `listServerFormats`
  returned version 3 with the newest rules — which also exercises the `referencedTable` ordering
  against real PostgREST for the first time. Same throwaway-script recipe as the `saveTeam` one.
  The harness gap is real and remains: a regression here would still pass `npm run check`.
- **An `act()` warning about `SessionProvider`** is latent for every screen test using
  `test/render.tsx`, which now mounts the provider. Console noise, not correctness; settle it in
  the helper when someone is next in there.
- **`rules_hash` stores a canonical serialization, not a hash** (`canonicalize()` returns a string).
  The spec says so, but M2 partitions and indexes on that column — a `sha256` at the write site
  would cost nothing now.
- ~~**`teamCodec` records `level` via `getEntry(..., league)` without `bestBuddy`.**~~ **Fixed.**
  It was a real off-by-a-level, not a theoretical one: every roster stored a level derived from a
  table its IVs were never chosen against — Great League medicham `50` where the builder said
  `50.5`, Ultra a full level out at `50` against `51`. `encodeMember` now passes `true`, matching
  `defaultSpreadFor(ref, league, true)` in the builder and the add modal and
  `bestSpreadFor(ref, league, true)` beside them; `getTable` applies eligibility itself, which is
  why none of those callers guards it. Two `it.each` cases pin it and failed first at exactly
  those numbers. Rows written before this carry the old baseline — harmless while `decodeMember`
  ignores `level`, and worth knowing if anything ever starts reading it.

## When M2 arrives

- **The `matches` FK to `format_versions` must be chosen deliberately — RESTRICT, not CASCADE.**
  Owners can no longer delete a version, but that guarantee is only end-to-end if the FK cooperates.
- **`rules_hash` becomes a trust boundary.** It is computed on the client today, which is fine while
  nothing depends on it being honest. The moment the queue partitions by it, the coordinator must
  recompute it rather than believe a client.

## Deploying M2a — two mandatory operator steps, or matchmaking is inert

M2a adds a `pg_cron` job, `coordinator-tick`, that fires once a minute and POSTs to the
`coordinator` Edge Function. That tick is the only thing in the system that verifies a claimed
rules hash, pairs the queue, and expires stale offers.

**Step 1: deploy the Edge Function.** `supabase db push` does not deploy functions, and this
section originally did not say so — which is how production ended up with every migration applied,
the frontend live, and `supabase functions list` returning `{"functions":[]}`. The symptom is
indistinguishable from the Vault one below: no offer is ever verified, so every offer on the board
reads "Being checked — acceptable once verified" forever and no Accept control is rendered.

```sql
-- not SQL; run it in the repo root, once per environment
-- npx supabase functions deploy coordinator
```

Done on production 2026-09-04: slug `coordinator`, status `ACTIVE`, version 1, `verify_jwt: true`.
An unauthenticated `POST` to it answers `401`, which is the wanted state — the cron job carries the
service-role bearer. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the only two variables
`functions/coordinator/index.ts` reads, are injected by the platform; `supabase secrets list`
shows both, so no function secret has to be set by hand.

**Step 2: the two Vault secrets.** The tick **reads its target and its bearer token from Supabase
Vault, and the migrations deliberately create neither.** Nothing else in the deploy supplies them,
so this is a step a human does, once, per environment.

Run this on the production database (SQL editor, as `postgres`), **after the migrations land**:

```sql
select vault.create_secret(
  '<the project service-role key, from Settings → API>',
  'coordinator_service_role_key',
  'Bearer token the per-minute coordinator-tick cron job sends to the coordinator Edge Function'
);

select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/coordinator',
  'coordinator_url',
  'Target of the per-minute coordinator-tick cron job'
);
```

Then confirm, on the next whole minute:

```sql
select status, return_message, start_time
  from cron.job_run_details order by runid desc limit 3;   -- expect 'succeeded'
select status_code, content from net._http_response order by id desc limit 1;  -- expect 200
```

A healthy tick answers `200` with `{"verified":N,"paired":N,"swept":N}`.

**Names, spelled exactly.** `coordinator_url` and `coordinator_service_role_key`, underscores
throughout. A typo here is not a failure, it is silence — see the symptom below. To change either
value later use `vault.update_secret(id, …)`, **not** `create_secret` again: `vault.secrets.name`
carries a unique index and the second call raises.

**The symptom if you skip this step, or misspell a name.** Nothing errors. Anywhere. The cron job
runs every minute and is recorded `succeeded`; `net.http_request_queue` never gains a row; the app
throws nothing and logs nothing. Users queue and simply never match — offers sit `open` forever,
scheduled proposals never lapse, `verified_hash` stays null on every row, and the Matches screen
is permanently empty for everybody. The only evidence is a `NOTICE` in the Postgres log
(`coordinator-tick: not configured (vault secret coordinator_url missing, …) - skipping`) and the
absence of rows in `net._http_response`. **If matchmaking "doesn't work" and nothing is on fire,
check Vault first.**

That silence is a deliberate trade, made in
`20260904174517_coordinator_tick_reads_vault_and_no_ops_unconfigured.sql`. The alternative was
what M2a originally shipped on the branch: an unguarded `net.http_post` whose NULL url hit a NOT
NULL constraint and **raised on every tick, forever** — 91 failed runs and zero successes on the
local stack, ~1,440 unpurged failure rows a day in production, and matchmaking equally dead the
whole time. A quiet no-op is not better because it is quieter; it is better because it is the
state an unconfigured deployment should be in. It is documented loudly here precisely because it
is quiet there.

**Do not try to configure this with `alter database postgres set app.coordinator_url = …`**, which
is what the superseded migration `20260903030000` told you to do. It cannot work: `postgres` is not
a superuser on Supabase (`select usesuper from pg_user where usename = current_user` → `f`), and
Postgres refuses `ALTER DATABASE/ROLE … SET` on a custom placeholder GUC to non-superusers —
measured on the local stack, which mirrors hosted in this respect:
`ERROR: permission denied to set parameter "app.coordinator_url"`. Vault is where these live
because Vault is the per-environment store the operator can actually write.

## Still outstanding

- [x] **AT DEPLOY TIME (M2a): deploy the coordinator Edge Function** — done on production
      2026-09-04, after the user reported that no offer could be accepted or posted there. See
      "Deploying M2a" above; `db push` does not carry functions.
- [~] **AT DEPLOY TIME (M2a): create the two Vault secrets** — created on production 2026-09-04
      ~23:53Z, both `create_secret` calls returning ids. **Not yet proven to work**: the
      `net._http_response` check was never run, and `succeeded` in `cron.job_run_details` is what
      the unconfigured path produces too. See "Where this session left off". Until proven,
      matchmaking may still be silently and permanently inert: every tick succeeds, no request is
      ever sent, nobody ever pairs, and no error surfaces in the app or the dashboard.
- [ ] **`cron.job_run_details` is still never purged.** The M2a fix changes the rows from `failed`
      to `succeeded`; it does not change that there are ~1,440 of them a day and nothing deletes
      them. Not urgent and not a correctness problem, but it is a table that only grows. A second
      cron job pruning rows older than a few days is the usual answer.
- [ ] **AT DEPLOY TIME: change the hosted Site URL to the real domain.** Still `http://localhost:5173`
      — re-measured 2026-09-04, not assumed: `GET /auth/v1/verify?token=invalid&type=signup` on the
      hosted project `303`s to `http://localhost:5173/#error=access_denied&error_code=otp_expired`.
      The database is now live ahead of any frontend, so this gap is open from here on. Forgotten,
      it sends every confirmation link and OAuth return for real users to a laptop. The accounts
      still confirm — the token is verified at Supabase before the redirect — so it fails as a dead
      page rather than a failed signup, which is exactly the shape of a problem that survives a
      launch.
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
