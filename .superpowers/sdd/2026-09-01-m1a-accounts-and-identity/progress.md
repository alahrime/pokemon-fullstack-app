# SDD ledger — plan: docs/superpowers/plans/2026-09-01-m1a-accounts-and-identity.md

Spec: docs/superpowers/specs/2026-08-31-paragon-platform-design.md (sections 2 and 3)
Branch: feat/m1a-accounts (base d21c7a8, cut from main at 00b0441)
Scope this run: Tasks 1-4 only. Tasks 5-6 need the hosted Supabase project and the Google
  OAuth client, which are the human's to create — the controller cannot create accounts or
  handle credentials.

Preconditions VERIFIED before planning (do not re-derive):
  colima 0.10.3 running on macOS Virtualization.Framework, aarch64, docker 29.7.2 responding,
  hello-world container actually executed. Supabase stack started via npx: 12 containers,
  PostgreSQL 17.6 native aarch64, auth schema present with 16 RLS-enabled tables, stopped
  cleanly leaving 0 containers. `supabase` is NOT on PATH — only `npx supabase` resolves.

## Pre-flight conflict scan

### Shared-file / interface pairs

| Producer | Consumer | Interface | Finding |
|---|---|---|---|
| T1 db:start/db:stop/db:reset scripts | T2, T3, T4 | npm scripts with --workdir .. | Clean — T1 step 6 proves the loop before anything depends on it |
| T1 pinned CLI | T2, T3, T4 | devDependency in app/ | Clean |
| T2 profiles + friend_codes, RLS on, NO policies | T3 | the default-deny state T3 asserts | Deliberate ordering — T3 proves the starting state before T4 relaxes it |
| T3 asUser/asAnon harness | T4 | impersonation via request.jwt.claims | RISK, named in the plan: if auth.uid() does not read claims as described, every policy test is wrong in the SAME direction and passes while proving nothing. T3 must verify with \sf auth.uid against the live stack. |
| T3 temporary zero-policies test | T4 replaces it | — | Clean — the plan says so explicitly and tells T3 to comment it |
| T4 policies | T3's suite | both-direction assertions | Clean |

### Per-task self-consistency

| Task | Finding |
|---|---|
| T1 | Container name in T2's psql example is a guess; T2 is told to check `docker ps` rather than assume |
| T2 | Clean — RLS enabled with zero policies is the intended state, not an oversight |
| T3 | Clean, with the auth.uid() risk carried above |
| T4 | Clean — (select auth.uid()) form specified with its planner reason |

### Rulings from the scan

Ruling: the gate splits. `npm run check` stays Docker-free; `npm run check:db` carries the
  default-deny assertion and policy tests. The spec asked for these in `check`, but that would
  make every run need Docker and a live stack, and a gate people skip protects nothing.
  Cost if wrong: someone merges a policy change without running check:db.
Ruling: supabase/ at repo root, CLI pinned in app/package.json. No root package.json exists;
  creating one is a structural change out of scope. Same pragmatism as app/src/rules in M0.
  Cost if wrong: the --workdir .. flag is needed on every db script.

## Progress
REQUIREMENT CHANGE (user, mid-run): registration must collect Pokemon GO username, email, age,
  and terms acceptance. Plan amended before Task 2 dispatched; briefs 2 and 6 regenerated.
Ruling: go_username is a NEW column, not the existing `handle`. handle is the app's display
  name; go_username is the in-game trainer name, and it is load-bearing beyond display — the
  spec adjudicates disputes from GO battle journal screenshots which show the OPPONENT'S
  in-game username, so without it a judge cannot match a screenshot to a match.
  Cost if wrong: a column that duplicates handle for users whose names match.
Ruling: go_username is unique but explicitly UNVERIFIABLE. There is no public GO API to prove
  someone owns a trainer name, so the constraint prevents obvious collisions and does not
  establish identity. The UI must not describe it as verified.
  Cost if wrong: a squatted trainer name blocks its real owner from registering it.
Ruling: email is NOT stored in profiles. auth.users.email is the source of truth for both
  email signup and Google OAuth; a second copy would drift. Recorded as a comment in the
  migration because someone will otherwise add it.
  Cost if wrong: reading email requires the session rather than a profile join.
Ruling: age stays as birth_date, not an age integer. Age is derived wherever needed — a number
  captured at signup is wrong within a year and silently so.
  Cost if wrong: none identified; strictly more information than an age.
Ruling: go_username goes in `profiles` (broadly readable), NOT alongside friend_codes. The
  spec separates friend codes because they GRANT CONTACT and are unrotatable — a harassment
  vector with no undo. A trainer name identifies without granting contact, and match
  participants and judges need to read it to verify a journal screenshot.
  Cost if wrong: trainer names are visible to any signed-in user.
Ruling: tos_accepted_at is a timestamptz recorded at signup, terms document a placeholder. The
  timestamp is the audit trail regardless of what the document says, and consent nobody
  recorded cannot be backfilled later.
  Cost if wrong: a column referencing a document that changes under it.
REQUIREMENT CHANGE 2 (user): friend codes ARE regenerable in Pokemon GO; usernames change but
  less often; email is the main identifier; the Paragon display name is fixed.
SPEC CORRECTED (docs/.../2026-08-31-paragon-platform-design.md). The spec asserted "GO friend
  codes are not rotatable, so this has no undo" and reasoned about harvesting severity from
  that premise. It is factually wrong — a trainer can regenerate their code in-game. The
  correction is written into the spec rather than only the plan, because the spec is the design
  authority and a false premise there propagates into every milestone that reads it. The
  mitigation stack is unchanged (reveal-on-accept, rate limits, a reveal log) but the severity
  is downgraded: a nuisance the owner can end, not permanent exposure.
Ruling: ONE name field, not two. Dropped `handle`; `display_name` is the Paragon-specific name,
  unique, not null, and IMMUTABLE. A fixed handle plus a mutable pretty name is two things to
  render and two things to disagree.
  Cost if wrong: users cannot fix a display name they regret.
Ruling: immutability enforced by a BEFORE UPDATE trigger, not by the client or an RLS policy.
  A rule the client merely agrees to is not a rule, and the trigger holds against any writer
  including a server process holding the service role key — which is exactly the writer an RLS
  policy would not stop.
  Cost if wrong: changing a display name later needs a migration, deliberately.
Ruling: go_username is now MUTABLE and NOT unique, reversing the earlier unique constraint.
  Email is the identity anchor, so uniqueness on an unverifiable mutable name buys little and
  costs real friction — a user who renames in-game would collide with whoever took their old
  name. Duplicates do not break dispute adjudication: a match names its participants by id, so
  a judge only needs the screenshot to match one of them.
  Cost if wrong: two accounts can display the same trainer name.
Ruling: friend_codes.code is user-editable, following directly from the spec correction.
Task 1: implemented (commit ee51b70; db:start/reset/stop all EXIT=0 captured directly; containers stopped). supabase/.gitignore committed as part of scaffolding.
REQUIREMENT (user): require email confirmation on the password path. Task 4 amended.
Ruling: the confirmation requirement forces a schema addition, caught now rather than at Task 6.
  With confirmations on, signUp returns NO session, so the client has no auth.uid() and cannot
  satisfy the insert policy `with check (auth.uid() = id)`. The insert policy is therefore
  UNUSABLE on its own — nothing could ever create a profile, and the registration fields the
  user asked for would have nowhere to go. A SECURITY DEFINER trigger on auth.users is what
  makes the policy set work, so it lands in Task 4 beside the policies rather than later.
  Cost if wrong: a trigger in the same migration as policies rather than its own task.
Ruling: the trigger fires on CONFIRMATION, not on insert. An insert-time trigger would mint a
  profile for an account that may never be confirmed — and since display_name is UNIQUE, that
  abandoned row would squat a name nobody else can ever claim. Google arrives already confirmed
  and flows through the same path. `on conflict (id) do nothing` covers the double-fire.
  Cost if wrong: a confirmed user without a profile if the update path is missed — which is why
  the task requires asserting the ABSENCE for unconfirmed users, not just the presence later.
Ruling: enable_confirmations = true in supabase/config.toml, not just in the hosted project.
  Left at the default the local stack auto-confirms, and Task 6 would be built and tested
  against a flow that never asks anyone to check their email — then diverge the first time it
  met production. Local must match.
  Cost if wrong: local signup needs the Mailpit inbox at :54324 to complete.
Task 2: implemented (commit e3192be; RLS on both tables, 0 policies, trigger RAISED 'display_name is immutable once chosen' while an unrelated column update on the same row succeeded; containers stopped)
Task 3: implemented (commit 83c57d3, check:db 2/2). IMPERSONATION PROVEN, which was the task's
  whole risk: postgres superuser saw a fixture row (n=1) while an asUser()-impersonated
  authenticated request saw nothing (n=0) in the same state, and auth.uid() resolved to the
  exact sub supplied — checked against Supabase's own definition via \sf auth.uid.
Task 3: found and fixed a real footgun — raw begin/rollback text nested against the harness's
  own client.begin() on a shared connection SILENTLY COMMITTED instead of rolling back. That
  would have leaked fixtures between policy tests in Task 4. Documented for Task 4.
Task 3: deviated from the brief's literal `set local ... = '...'` to parameter-bound
  set_config(..., true), verified equivalent side by side. Accepted — it is also injection-safe,
  which the literal string form is not.
Ruling: review Tasks 1-3 as ONE unit rather than three. They are a single coherent deliverable —
  scaffolding, schema, and the harness that proves the schema is protected — and the question
  that matters spans all three: does the harness genuinely demonstrate the tables deny by
  default? Reviewing them separately would fragment exactly that. Task 4 gets its own review.
  Cost if wrong: a defect isolated to one task gets less focused attention.
Tasks 1-3 joint review: no Critical. 2 Important, BOTH CLOSED by Task 4's normal work — the
  committed rls.test.ts now exercises asUser/asAnon at 13 call sites, and the begin/rollback
  hazard is documented in the committed code with a pointer to where it was found. The review
  was accurate at 83c57d3; Task 4 filled both gaps while it ran.
CONTROLLER ERROR, owned: I read Task 3's "impersonation proven" and treated it as "impersonation
  protected by a test". It was proven by hand, once, in a file the implementer then DELETED
  before committing. Nothing imported asUser/asAnon at 83c57d3, so a break in the harness would
  have passed green — the exact failure the instruction existed to prevent. The reviewer caught
  what I accepted on trust.
Task 4: implemented (commit 6961012, 17/17 db tests). Confirmations proven live three ways:
  /auth/v1/settings flipped mailer_autoconfirm true->false across a restart, survived a
  db:reset, and a real curl signup returned a bare user with no session. Unconfirmed-user
  profile ABSENCE proven directly.
Task 4: Ruling: the duplicate-display_name-on-confirmation case is a LOCKOUT, not the UX edge
  case the report modestly calls it, and it is a consequence of my design (unique immutable
  display_name + a trigger that fires during confirmation). Sequence: A signs up wanting "Ash"
  unconfirmed; B signs up wanting "Ash" and confirms first; A clicks confirm; the trigger raises
  a unique violation which rolls back the whole UPDATE, so email_confirmed_at reverts. A can
  now never confirm, and cannot re-register because the email is taken. That needs admin
  intervention to escape.
  Decision: the trigger must not block confirmation. Confirming proves email ownership, which
  is all that UPDATE is about; profile creation is a separate concern. Wrap the insert in an
  exception handler so a unique_violation lets confirmation succeed with no profile, and Task 6
  prompts for a different name on first sign-in — where a session exists, so the ordinary
  insert policy applies and no SECURITY DEFINER is needed.
  Cost if wrong: a confirmed user can exist without a profile, which Task 6 must handle
  explicitly rather than assuming a profile is always present.
Task 4: fix round 1 implemented (commit 8606399, 19/19; lockout regression proven to fail pre-fix with the exact profiles_display_name_key violation). Stray empty paragon.env.local removed; *.env.local ignore widened.
Task 4 + fix review: READY. No Critical, no Important. Reviewer verified both-direction coverage
  against helpers.ts rather than trusting the report, confirmed (select auth.uid()) used
  consistently, confirmed the trigger's early-return genuinely prevents squatting, and confirmed
  the tests avoid Task 3's begin/rollback footgun.
Task 4: Ruling: fold three Minors into one fix round rather than defer them, because Task 6
  builds directly on all three.
  (a) The friend_codes `for all` policy has no insert-allow and no delete-direction test. It is
      the one place in the diff where "policy broader than what is tested" is literally true,
      and Task 6 will insert friend_codes through it from real client code for the first time.
  (b) No direct anon-deny test for profiles — currently only inferred from the friend_codes anon
      case via the shared `to authenticated` mechanism.
  (c) MY FIX INSTRUCTION carries a latent risk the reviewer caught: the handler catches
      unique_violation by SQLSTATE, not by constraint name. Safe today only because profiles has
      exactly two unique constraints (id, absorbed by ON CONFLICT; and display_name). A future
      unique constraint would be silently swallowed, producing another "confirmed with no
      profile" from an unintended cause — the same silent-failure class the lockout fix existed
      to remove.
  Cost if wrong: three cheap tests and a constraint-name check that were not strictly required.
USER ACTION ADDED: enable_confirmations must ALSO be set on the HOSTED project. It is a GoTrue
  auth setting, not a schema migration, so the GitHub integration will not carry it — the local
  config.toml change does not propagate. Without it the hosted project auto-confirms and the
  email path silently differs from what was built and tested.
REQUIREMENT REVERSAL (user): display names ARE changeable. Reverses the immutability ruling.
Ruling: drop the freeze trigger, KEEP the unique constraint. A display name still identifies a
  person, so uniqueness stands; only the permanence goes. Queued behind Task 4 fix round 2,
  which is touching the same migration area.
  This also softens the lockout case rather than reopening it: someone who loses a name race can
  now pick another and rename later, so the collision is an inconvenience rather than a dead end.
  The confirmation fix still stands on its own merits — confirmation proves email ownership and
  should never fail on a profile concern.
  Cost if wrong: names can be changed, so anything that cached one must re-read it, and
  impersonation-by-rename becomes possible in a way a frozen name prevented.
USER BLOCKED on Google OAuth: Google Cloud demanded billing information. Advised skipping Google
  entirely rather than fighting it — Supabase providers are configuration, not code, so
  signInWithOAuth({provider}) is provider-agnostic and Task 6 builds the same button regardless.
  Recommended Discord (free, no billing, and where competitive GO PvP actually organises —
  Silph Arena, local leagues) and/or GitHub (free, account already authorised). Google can be
  added later as a dashboard toggle with no code change.
USER BLOCKED on repo not appearing in Supabase: authorising the GitHub account is not the same
  as granting repository access. GitHub -> Settings -> Applications -> Installed GitHub Apps ->
  Supabase -> Configure -> tick the repo. Org-owned repos need an owner to approve separately.
Task 4: fix round 2 implemented (commit f5ffdc7, 24/24 db tests; 5 new coverage tests). Honestly reported that the 'different unique violation propagates' test cannot be built without adding a constraint purely for testing — verified via pg_constraint that no second reachable unique constraint exists. Open gap, not faked.
Task 4: fix round 3 implemented (commit 40f7d6c, 26/26). display_name unfrozen, unique kept.
  Cross-user rename still denied AND proven independent — it passed before the migration too,
  so the RLS ownership mechanism never depended on the trigger. Implementer also caught that the
  collision test initially failed for the WRONG reason (the trigger, not the constraint), which
  is the difference between a test that passes and a test that tests.
M1a TASKS 1-4 COMPLETE. 26 db tests + 973 app tests green.
Ruling: DO NOT merge to main yet, despite the standing preference to ship gate-green work.
  Merging is not a neutral act here: the user has connected a Supabase GitHub integration, and
  merging to whichever branch it watches APPLIES THREE MIGRATIONS TO THEIR PRODUCTION DATABASE.
  Two things are unresolved that make that unsafe right now — they have not said which branch is
  watched, and they have not yet enabled Confirm email on the hosted project, which the
  integration does not carry. Applying a confirmation-dependent trigger to a project that
  auto-confirms would create profiles on a path we never tested.
  This is an outward-facing side effect with unclear consequences, which is a stop-and-ask case
  rather than a ship-without-asking one.
  Cost if wrong: the branch sits unmerged slightly longer than the user would prefer.
Task 5: implemented (browser client + SessionContext, 15 new tests, gate green at 988/988).
Task 5: RESOLVED the handoff's open question — the sb_publishable_ key format IS accepted by
  @supabase/supabase-js 2.112.4. Proven against the running local stack rather than by version
  reasoning: a deliberately-wrong password returned 400 invalid_credentials, NOT 401 "Invalid
  API key", and PostgREST answered 200 [] for anon on profiles (RLS denying, as designed). No
  change to .env.local; the legacy anon JWT fallback is not needed.
Task 5: Ruling: read env with STATIC member access (import.meta.env.VITE_SUPABASE_URL), never a
  dynamic lookup. Vite replaces these textually at build time and does not resolve
  import.meta.env[name] — that form works under the dev server and reads undefined in a
  production build. Worst class of bug available here: it only appears once deployed.
  Cost if wrong: none; the static form is strictly safer.
Task 5: Ruling: the test env lives in vitest.config.ts (test.env), not in .env.local. .env.local
  is git-ignored, so a suite that depended on it would be green here and broken on a fresh
  clone. The values are not credentials and reach no network — every test mocks
  @supabase/supabase-js at the package boundary. Verified test.env does populate import.meta.env.
Task 5: Ruling: subscribe to onAuthStateChange BEFORE calling getSession, and let the
  subscription's answer win over a late getSession ('heard' guard). Both directions matter and
  both are tested. Confirmed against the real client that this is not theoretical: GoTrue emits
  INITIAL_SESSION on subscribe, so the subscription always speaks first and getSession's answer
  is the one routinely discarded. Subscribing second would also leave a gap where an event
  fired between the two calls lands on nobody.
Task 5: MUTATION-TESTED the new tests rather than trusting a green run — 8 mutations, 7 caught.
  The 8th exposed a FAKE TEST I had just written: 'ignores an answer that arrives after unmount'
  passed with the `live` guard removed, because React 19 makes a post-unmount setState a silent
  no-op with nothing observable from outside. Deleted it rather than keep a test that cannot
  fail; the guard stays, commented as deliberately untested so nobody re-adds a fake test for it.
Task 5: Verified the mock's shape against the REAL client on the live stack, since 15 tests
  passing against a fictional API would prove nothing: getSession -> {data:{session},error},
  onAuthStateChange -> {data:{subscription:{unsubscribe}}}, signOut -> {error}. All match.
Task 5: NOT DONE here, and deliberately: SessionProvider is not yet mounted in App.tsx. Task 5's
  file list does not include it and nothing consumes useSession until Task 6's SignInScreen, so
  the provider is dead code until then. Task 6 must mount it (and add it to src/test/render.tsx,
  which currently wraps only ThemeProvider and AppStateProvider).
Task 6: implemented (SignInScreen + age gate + profile completion, 36 new app tests, 6 new db
  tests; gate green 1024/1024 app, 32/32 db).
Task 6: DEFECT FOUND AND FIXED, not in this task's code but in Task 4's schema: OAuth signup was
  IMPOSSIBLE at the database level. GoTrue inserts a provider account already confirmed, so
  handle_confirmed_user() fired on the INSERT with raw_user_meta_data holding only Discord's own
  fields -- no display_name, go_username or birth_date, all three NOT NULL. That raised
  not_null_violation (23502), which is NOT the unique_violation the handler forgives, so it
  propagated and took the whole auth.users INSERT with it. Proven directly against the stack
  before writing the fix, and by 5 db tests that failed pre-migration for exactly that reason.
  Migration 20260901225208 skips profile creation when any of the three is absent, leaving the
  account confirmed with no profile -- the SAME state a lost display_name race already produces
  and which Task 6 has to handle anyway. Cost if wrong: a provider account gets no profile until
  the client writes one, which is the intended flow.
Task 6: Ruling: the plan says registration collects four things (go_username, email, birth_date,
  terms). It must collect FIVE -- display_name is NOT NULL and unique, and the trigger reads it
  from metadata. Omitting it would have produced the same not_null_violation lockout on the
  EMAIL path too. The plan's own file list never mentioned it; the schema settled it.
Task 6: Ruling: terms are enforced wherever a PROFILE is created (the registration form and the
  complete-your-profile form), not merely in front of the provider button. Since the trigger no
  longer mints profiles for provider accounts, consent is recorded at the one point every
  account passes through, and a provider signup cannot slip past it.
Task 6: Ruling: OAuth provider is discord, per the earlier recommendation the user was given
  (Google abandoned over Google Cloud billing). This is a one-constant change -- OAUTH_PROVIDER
  in SignInScreen.tsx -- plus a dashboard toggle. The plan's test list says "the Google button";
  deviating deliberately and noting it here.
Task 6: Ruling: the age gate is asked before everything that can CREATE an account, but NOT for
  an account that already has a profile. Re-asking a date of birth every time someone clears
  browser storage is friction with nothing behind it, and a profile row is proof the gate was
  already passed. The answer is persisted in localStorage because the provider round trip leaves
  the page and the birth date is needed on return to write the profile.
Task 6: Ruling: the Supabase client is stubbed for the whole suite in src/test/setup.ts, because
  App now mounts SessionProvider at the root -- without it every test rendering App would make a
  live fetch to 127.0.0.1:54321 and the suite would behave differently depending on whether the
  database happened to be running. Verified empirically that a vi.mock in a setup file does
  apply to files declaring no mock of their own.
Task 6: MUTATION-TESTED the screen: 10 mutations, 10 caught (age refusal, terms on both forms,
  trainer name, display name, provider id, 23505 handling, consent timestamp, email leaking into
  either the signup metadata or the profile insert, and the no-profile branch).
Task 6: VERIFIED END TO END against the running stack with the real client, not the mock: signUp
  with the screen's exact options shape -> metadata lands in raw_user_meta_data -> no profile
  before confirmation -> profile created on confirmation with tos_accepted_at byte-identical to
  what the client sent -> signInWithPassword -> from().select().eq().maybeSingle() returns the
  row, and null (no error) when there is no match.
Task 6: my FIRST collision probe was wrong and said so: inserting with a random id returned 42501
  (RLS refusing a row that is not yours), not the 23505 the screen keys on. Re-ran the real
  case -- a signed-in user with no profile inserting THEIR OWN id under a taken name -- which
  returns 23505 on profiles_display_name_key. The screen's handling is correct; the first probe
  was measuring the wrong thing. Recorded because a less careful reading of that output would
  have produced a "fix" for a bug that does not exist.
Task 6: site_url corrected from :3000 to localhost:5173 and both 5173 hostnames added to
  additional_redirect_urls (exact-match, so a missing one is a rejected redirect at the end of an
  OAuth round trip).
Task 6: entry chunk measured after adding @supabase/supabase-js at the root: 514.58 kB against a
  1100 kB budget, no chunkBudgets warning. Lazy-loading SignInScreen does NOT keep the client out
  of the entry chunk -- SessionProvider is mounted in App -- and the comment saying otherwise was
  corrected rather than left to mislead.
M1a TASKS 1-6 COMPLETE. Merge ruling from Task 4 STANDS: still blocked on the hosted project's
  Confirm email setting and on knowing which branch the Supabase GitHub integration watches.
M1a MERGED to main (42c6d27, fast-forward) and DEPLOYED to production, after all four
  preconditions were verified by probing the hosted project rather than trusting the dashboard:
  mailer_autoconfirm false, discord true (and Discord itself accepts the client_id/callback pair),
  Site URL bouncing to localhost:5173, and the integration confirmed watching main with deploy-to-
  production on. Migrations landed ~45s after the push: /rest/v1/profiles went PGRST205 -> 200.
  Production verified: all seven columns present, friend_codes deployed, and RLS ENFORCING --
  an anonymous insert is refused 42501 and creates nothing.
  Ruling: an empty table returns [] whether RLS is on or off, so a successful SELECT proves
  nothing about protection. Only the refused WRITE distinguishes them. Any future check of a
  deployed policy must attempt the thing that must fail.
  Merging to main is now a production database deploy on every push. Future migrations are
  outward-facing changes and should be treated as such.
