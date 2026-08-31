# Paragon as a platform — accounts, formats, matchmaking, social

**Date:** 2026-08-31
**Status:** design approved in conversation; not yet planned or implemented
**Covers:** the decomposition, data model, security model, rules language, and
build identity (Shadows, megas, movesets)
**Does not cover:** implementation plans. Each milestone gets its own.

---

## Why this document exists

The request was to "expand this project" with user registration, authentication,
user-specific saves, a matchmaking lobby, friends, messaging, and group chats.

That framing understates it. What follows is a second system that the existing
app becomes a client of, and the request's own observation — that the changes
seem "seemingly unrelated" — is the signal. They are unrelated because they are
not one project.

## What the repo is today, measured

- **25,426 lines** of TypeScript/TSX. `app/` is a Vite + React 19 SPA.
- **No backend.** No server, no API, no database, no auth. The only runtime
  `fetch` calls pull static generated JSON artefacts.
- **Persistence is `localStorage`, for theme and layout only.** Nothing else
  survives a reload.
- **No concept of a user anywhere.** `state/AppState.tsx` is one in-memory React
  context holding species selections, move indices and league. Singular,
  anonymous, ephemeral.
- **Never deployed.** No Vercel, Netlify, Docker, Fly, wrangler or CI config
  exists. `origin` is `github.com/alahrime/pokemon-fullstack-app` — the name
  anticipated this.
- The client is heavy but static: a ~1.1MB entry chunk plus `species.json`
  (704KB), with `rankings.json` (3.3MB) and `teams.json` (4.1MB) lazy-loaded
  behind route splits, budgeted per-chunk in `vite.config.ts`.

## Decisions already taken

These were settled in conversation and are inputs to everything below, not open
questions.

**Coordination only; the engine never moves server-side.** When two users are
matched, the app shows each the other's Pokémon GO friend code with the relevant
team pre-loaded, opens a chat, and both parties report the score after playing
the rounds inside Pokémon GO. Paragon never simulates a versus match. This
removes an entire category of risk — no server-side engine, no divergence
between two implementations of the same battle maths, no team-secrecy problem,
no anti-cheat on battle mechanics.

It also relocates the integrity problem rather than removing it. See *Reporting
and disputes*.

**Public, open signup, thousands of users.** This makes moderation, abuse
prevention, rate limiting and account recovery first-class requirements of the
first milestone rather than later additions.

**Registration is refused under 13.** The alternative is verifiable parental
consent under COPPA — a compliance apparatus — and once direct messaging exists,
a restricted-minor tier means building a permission system across every social
surface. A neutral age screen at signup that declines under-13s is hours of
work; the other path is its own sub-project. Store the birth date rather than a
derived flag, because a twelve-year-old becomes thirteen.

**Supabase.** Postgres, auth, row-level security, realtime and storage in one
service with a first-class TypeScript client. It collapses the identity
sub-project from months to days, and its data layer is ordinary Postgres, so the
lock-in is narrower than it looks: auth and realtime are the proprietary parts
and both are replaceable later with contained effort.

The alternative of rolling identity by hand was rejected: password hashing,
session rotation, email delivery, reset flows, rate limiting and lockout are
months of undifferentiated work whose failure mode is a public security
incident. A hybrid — managed auth plus a bespoke API — is a defensible end state
and a reasonable later migration.

**"League creations" and "custom formats" are the same entity.** The original
request listed them separately. Folding them removes a subsystem.

---

## 1. Decomposition and build order

### Sub-projects

| # | Sub-project | Contains | Blocked by |
|---|---|---|---|
| 0 | Backend + identity | Server, DB, auth, profile including friend code | — |
| 1 | User-owned saves | Teams, search history. *The battle logs named in the original request are match records, owned by 5 and 6.* | 0 |
| 2 | Formats | Rules schema, validator, builder, sharing | validator: nothing |
| 3 | Social graph | Friends: request / accept / block | 0 |
| 4 | Messaging | DMs, then rooms: tournaments, groups | 0, 3 |
| 5 | Matchmaking lobby | Queues by format, code exchange, score reporting | 1, 2, 3, 4 |
| 6 | Records and rating | Rating, seasons, grit, unique opponents, calendar, export | 5 |

### The three tiers

The coordination-only decision pays off structurally: the engine stays where it
is, and the server never simulates anything.

| Tier | Owns |
|---|---|
| Client (the existing SPA) | All simulation, ranking and analysis. Unchanged. |
| Supabase | Auth, all CRUD via PostgREST + RLS, realtime for chat and lobby presence |
| Coordinator (small Node service) | Queue matching, adjudication timeouts, rating computation, rate limits, moderation actions |

Four of the six sub-projects need no custom server code at all. Saves, formats,
friends and messaging are client plus row policies. Only matchmaking and rating
need the coordinator — which is exactly the set of things row-level security
structurally cannot express.

### One module runs in both places

The format validator runs client-side for authoring, so a rule shows its effect
as you type, and server-side because the coordinator cannot trust a client's
claim that its team satisfies the format. Same logic, two runtimes, and it must
not diverge or a client can submit an illegal team into a ranked queue.

The repo has already solved this once without naming it. `scripts/build-matrix.ts`
bundles `app/src/lib/engine.ts` through esbuild and runs it under Node; the lib
layer is already isomorphic, and the project's rule about bundling against the
real engine rather than reimplementing it is the same rule. Formalise it:

```
app/                  existing SPA
packages/rules/       format schema + validator — imported by both sides
server/               coordinator
supabase/             migrations, policies, policy tests
```

`packages/rules` imports no React and touches no browser API. That constraint is
the entire reason it can be trusted on both sides.

### Milestones

Ordered for value and risk rather than strictly by dependency.

**M0 — Formats, offline.** Rules schema, validator, builder UI, saved to
`localStorage`. Ships into the app as it stands today with **no backend at all**.
This is the strongest single recommendation in this document: it delivers real
user value immediately, requires no infrastructure decisions, and de-risks the
hardest unsolved problem in the project before it is entangled with auth, row
policies or a queue.

**M1 — Accounts and saves.** Supabase project, auth, age gate, profiles, teams.
Formats migrate from `localStorage` to the server. The RLS assertion joins
`npm run check`. This is also the first deployment this app has ever had: static
client to a CDN, nothing else yet.

**M2 — The walking skeleton.** One real match end to end — queue, paired with an
actual second human, codes revealed on mutual accept, match channel opens, both
report per round, adjudicated, stored. Unranked only; no rating, no seasons. The
coordinator is born here. This is the milestone that proves the architecture or
breaks it.

**M3 — Social.** Friends, blocks, DMs, direct challenges between friends.

**M4 — Ranked.** Ratings, seasons, leaderboards, grit, unique opponents, the
daily calendar and spreadsheet export.

**M5 — Groups.** Tournament channels and the Slack-shaped thing.

**Moderation is not a milestone.** A report button and a queue behind it land in
M2, the moment two strangers can type at each other, and grow from there. It is
a requirement of every milestone from M2 onward.

### Keeping one gate

`npm run check` stays the single gate and absorbs the new surfaces: the RLS
assertion, the policy allow/deny suite, the rules validator's tests, the
coordinator's tests. This repo's discipline is that one command tells you
whether you are green. Splitting that across four commands is how the security
tests become the ones nobody runs.

---

## 2. Data model

### Entities

**Identity**

| Table | Notes |
|---|---|
| `auth.users` | Supabase-managed. Not touched. |
| `profiles` | 1:1 with `auth.users`. Handle, display name, birth date, timezone, default league |
| `friend_codes` | A separate table, deliberately — see *Security model* |

**Formats** (sub-project 2)

| Table | Notes |
|---|---|
| `formats` | Identity: name, owner, visibility, `fork_of` |
| `format_versions` | `rules` jsonb + `rules_hash`; immutable once published |

**Saves** (1)

| Table | Notes |
|---|---|
| `teams` | Owner, name, league |
| `team_members` | **`ref`** (`machamp_shadow` form — Shadow lives in the ref), fast move, two charge moves, IVs, level |
| `saved_searches` | Query string against the existing `lib/query.ts` language |

**Social** (3)

| Table | Notes |
|---|---|
| `friendships` | Canonical ordered pair `(user_lo, user_hi)`, `requested_by`, `status` |
| `blocks` | Separate: blocks are one-directional, friendship is not |

**Messaging** (4)

| Table | Notes |
|---|---|
| `channels` | kind: `dm` / `group` / `tournament` / `match` |
| `channel_members` | Role, `last_read_at`, which makes unread counts free |
| `messages` | Body, `edited_at`, `deleted_at`, **`expires_at`** — ephemeral by default |
| `message_pins` | Who pinned, what, and when. A pin lifts a message out of expiry |
| `message_reports` | The moderation queue. Required at this audience, not optional |

**Matchmaking and records** (5, 6)

| Table | Notes |
|---|---|
| `queue_entries` | Blind matching. Profile, league, **`rules_hash`**, team snapshot, expiry |
| `match_offers` | Proposals: proposer, format version, `rules_hash`, visibility, `scheduled_for`, the handshake window, `accepted_by`, `confirmed_at` |
| `matches` | Both players, both team snapshots, format version, `rules_hash`, `data_rev`, `seed`, `rounds` (3 or 5), channel, state, season, **`rating_counted`** |
| `match_reports` | Two rows per match: each side's independent claim |
| `match_rounds` | The adjudicated per-round truth, written on confirmation |
| `match_evidence` | Journal screenshots backing a disputed report. Object-store keys, uploader, verification verdict |
| `seasons`, `ratings` | Glicko-2 rating, deviation and volatility, per season, per league |

**Tournaments** (5, 6)

| Table | Notes |
|---|---|
| `tournaments` | Organiser, format version, bracket shape, rounds, state |
| `tournament_roles` | Judge and organiser grants, scoped to one tournament |
| `tournament_entrants` | Seeding, standing, elimination state |

### Rating is narrower than the match log

**Rating attaches only to the open queue on the three canonical leagues** —
Great, Ultra and Master. Not to friend battles, not to direct challenges, not to
curated custom formats, and not to tournaments. Everything else is played and
recorded but does not move a number.

This settles the stratification problem outright rather than mitigating it:
there are exactly three rating pools, each fed by the entire open population,
so Glicko-2 has the sample it needs and no per-format ladder can be farmed into
existence. It also confines collusion to the one mode where nobody picks their
opponent.

**Every match is still recorded for analytics** regardless of rating
eligibility — species usage, matchup outcomes, unique opponents, activity. The
`rating_counted` flag on `matches` is what separates the two, and it is
deliberately a distinct column from `state`: a match can be perfectly valid,
fully confirmed and simply not rating-bearing.

A consequence worth stating: since ranked is only the three canonical leagues,
**moveset-restricted formats can never be ranked**, because the canonical
leagues carry no moveset restrictions. The unenforceability problem in section 5
is therefore structurally out of reach of the rating system rather than
defended against.

### Disputes are settled with journal evidence

Pokemon GO's own battle journal records who won each round, when, and the
opponent's in-game username. That is the adjudication mechanism:

1. Both sides report. Agreement confirms the match; no evidence needed.
2. Reports conflict, or one side never reports, and the match enters `disputed`.
3. The disputing party supplies a journal screenshot, which is verified.
4. **No screenshot, no ranking.** The match is marked unverified, `rating_counted`
   goes false, and the win/loss is excluded from every rating and record.
5. **The data is still kept for analytics** — which species were brought, what
   was played — with the outcome flagged unverified rather than deleted.

The virtue of this rule is that it needs no adjudicator in the common case and
cannot be gamed by simply refusing to engage: silence costs the rating, and it
costs it symmetrically.

### Message retention follows an ephemeral model

Messages expire by default. A **pin** lifts a message out of expiry and records
who pinned it and when, so a tournament's rulings and arrangements survive while
ordinary chatter does not.

**This conflicts with moderation, and the conflict has to be designed for rather
than discovered.** If a message is gone the moment it is read, the abusive one is
gone before any moderator sees it. The resolution is the one Snapchat itself
uses: ephemerality is a property of the *reader's view*, not of the server. A
short server-side retention window backs every message for moderation purposes,
and anything reported or pinned is retained indefinitely, independent of what the
sender or reader sees. The window length is a stated number in the privacy
policy, not an implementation detail.

### Decisions that are expensive to reverse

**Normalise fixed shapes; use jsonb for open ones.** A team member has a known
shape — species, moves, IVs, level, shadow — so it is a table. Format rules are
a small open-ended language whose clauses users compose freely, so they are
jsonb behind a versioned schema and a validator. Normalising rules would mean a
table per restriction kind and a join for every query.

**Published format versions are immutable, and matches reference the version.**
This is the decision most likely to be regretted if skipped. If someone plays
forty ranked matches under a format and the owner then edits it, every one of
those records describes rules that were never played. Editing publishes a new
version; history stays honest.

**Match records snapshot both teams rather than referencing `teams.id`.** Same
reasoning. Editing a team tomorrow must not change the record of what was
actually brought today.

**Friend codes live in their own table because Postgres RLS is row-level, not
column-level.** The rest of a profile is broadly readable; a friend code is
readable only under much narrower conditions. Two visibility rules cannot live
on one row under RLS, so they are two rows in two tables. This is the mechanism
that makes reveal-on-mutual-accept a policy rather than a feature.

**Reports are stored separately from truth.** `match_reports` holds what each
side claimed; `match_rounds` holds what was adjudicated. Collapsing them
destroys the only evidence available in a dispute, and because rating makes
lying profitable, there will be disputes.

**Derived statistics are views, not counters.** Grit, unique opponents and win
rate are computed over match history rather than incremented in columns.
Counters drift under retries and partial failures, and a drifted lifetime
statistic is unrecoverable.

**Grit is a tournament statistic only.** It is computed over tournament matches
and never over public open-lobby logs, which is the right call: a bracket gives
"after a loss" a definite meaning — the next match in a known sequence, against
a field you are still in — where an open queue gives only an arbitrary ordering
of unrelated strangers.

It sharpens the sample-size problem rather than easing it. Grit was already a
ratio over a subsample; restricting it to tournaments makes that subsample far
smaller, so the minimum-N gate before display matters more, not less.

**Grit needs ordering and per-round outcomes stored, not a final tally.** Grit is
performance after losing, and it has two readings the schema must not foreclose:
the within-set one — down 0–2 in a Bo5, took it 3–2 — needs per-round results,
and the across-match one — win rate in matches immediately following a loss —
needs timestamped ordered history per user. Per-round data is being collected
anyway, since both parties report after the rounds; it must be *stored* that
way. Collapsed to `3-2` on write, every grit variant is lost permanently,
including the ones nobody has thought of yet.

**A user timezone is load-bearing.** The daily-battle calendar and the
spreadsheet export need a definition of "day". UTC puts evening matches on
tomorrow's row for anyone west of London. Cheap now, a migration later.

---

## 3. Security model

### The shift being made

Today the app has no secrets: everything ships to the browser and all of it is
public Pokémon data. The moment accounts exist the client becomes untrusted, and
under Supabase that is sharper than usual. The client does not call an API
somebody wrote; it issues queries directly against Postgres through PostgREST
with its JWT. **Every table created is an endpoint.** There is no handler in
between where a check was forgotten — the check *is* the row policy, and a
missing policy means a world-readable table.

### Default deny, enforced by the gate

New tables in Supabase ship with RLS **off**. That single default is the most
common Supabase data leak there is.

Therefore: RLS enabled on every table in `public` without exception, plus a check
inside `npm run check` that reads `pg_tables` and fails if any public table has
`rowsecurity = false`, or has RLS enabled with zero policies — which denies
everything and presents as a broken feature rather than as a security hole.

This repo already gates on `verify-data`, token parity and a spread audit. A
schema assertion belongs in that company, and it converts "remember to add a
policy" into something that cannot be forgotten.

### The policies carrying real weight

**`friend_codes`.** Readable only if it is yours, you have an accepted
friendship, or you share a currently active match. This policy *is* the
reveal-on-mutual-accept behaviour; there is no separate feature to build.

**`match_reports` are sealed until both sides submit.** If a player can read
their opponent's report before filing their own, the honest path and the exploit
are the same click: see the claim, then either match it or contradict it
strategically. The SELECT policy is `reporter_id = auth.uid() OR match.state =
'confirmed'`. Getting this wrong breaks nothing visibly; it quietly makes
disputes unwinnable.

**`blocks` are enforced elsewhere, on purpose.** Only the blocker may read their
own block rows, because a blocked user must not be able to detect the block.
Enforcement therefore cannot live in this table: it lives as `NOT EXISTS`
clauses in the policies on `messages`, `friendships` and queue matching.
Blocking is a constraint scattered across the tables it constrains, not a
feature in one place.

**`ratings` and `match_rounds` are never client-writable.** Adjudicated truth
and computed rating are written only by the coordinator using the service role
key — which bypasses RLS entirely. Hence the rule that makes everything above
real rather than decorative: **the service role key never enters the client
bundle.** If it ships to a browser once, every policy in this section is
theatre.

**One performance trap, built in from the start.** Policies on child tables —
`team_members`, `messages`, `channel_members` — need a subquery to their parent
to check ownership, and RLS subqueries evaluate per row. Wrap `auth.uid()` as
`(select auth.uid())` so the planner hoists it, and index every column a policy
joins on, `channel_members(channel_id, profile_id)` above all since it is the
hottest path in the app. Retrofitting this once a chat table is large is a bad
afternoon.

### What RLS structurally cannot do

Row policies answer "may this user touch this row". They cannot answer "has this
user done this four hundred times in the last minute". So none of the following
are expressible as policies, and all of them are why sub-project 5 needs a real
server process:

- Rate limits on signup, messages, friend requests and queue joins
- Report adjudication with timeouts
- Rating computation
- Moderation actions and the report queue

### Abuse surfaces specific to this app

**Friend code harvesting.** Queue repeatedly, collect codes, leave. GO friend
codes are not rotatable, so this has no undo. Reveal-on-accept plus rate-limited
queue joins plus a log of every reveal covers it; without the log there is no
way to tell it is happening.

**Rating collusion.** Two accounts feeding each other wins is the standard attack
on any rating system. Usefully, **the unique-opponents statistic already
requested is also the detector**: a rating that climbed against four opponents
looks nothing like one that climbed against sixty. A feature wanted for its own
sake pays for itself twice.

**Messaging, given the audience.** Public signup plus DMs means a report queue
with actual humans behind it, and soft-deleted messages retained on a fixed
window so a reported message still exists when a moderator opens the ticket.
There is a real privacy tension in that retention; name the window explicitly
rather than keeping everything forever.

### Evidence, roles and automated verification

Three surfaces that the dispute and tournament decisions add.

**Journal screenshots contain someone else's data.** A GO battle journal
screenshot shows the opponent's in-game username, which means uploading it
places a third party's identifier in the object store. Evidence therefore lives
in a private bucket readable only by the match's participants and the
moderation or judging role acting on that match, is never public-by-URL, and
carries its own retention window ending when the dispute closes and the appeal
period lapses. It is not ordinary user content and should not inherit ordinary
user-content policies.

**Judge and organiser are scoped roles, not global ones.** A tournament
organiser may overwrite a result, advance a round and settle a dispute *within
their own tournament* and nowhere else. That is a row policy joining
`tournament_roles`, not a flag on `profiles`. Every such override is written as
an audit row naming the actor and the prior value; a result that can be changed
without a trace is a result nobody can trust.

**Automated verification is advisory.** Screenshot checking runs as a vision
model against the journal image, and it is subject to two limits that must be
designed around rather than assumed away. It can be fooled by an edited
screenshot — it raises the cost of cheating without eliminating it — and it can
simply misread a real one. So its verdict is a recommendation with a confidence,
never a final ruling: high confidence auto-resolves, low confidence escalates to
a human, and **every automated decision is appealable to a judge.** A model
silently costing somebody their rating with no route of appeal is the failure
mode to avoid.

### Testing it

Policies are code and are tested like code: a suite that impersonates several
users and asserts both directions. **The deny tests are the half that matters
and the half most often skipped** — "user B cannot read user A's teams" is the
assertion that catches a policy someone loosened to fix a bug. Given this
codebase already runs 571 tests and treats its gate as load-bearing, these
belong inside that discipline rather than beside it.

---

## 4. The rules language

The repo already contains the hard half. `app/src/lib/query.ts` defines
`Term = (s: Species) => boolean` — a compiled predicate over a species — with
types, tags, generations, regions, evolution families (`+politoed`), movepool
predicates (`@fighting`, `@1fighting`), negation and and/or at or-of-ands
precedence. It is tested, and `QUERY_FORMS` already generates the in-app legend
from the same source the parser uses.

**A ban is a query.** This section is therefore much less about inventing syntax
than expected.

### Three kinds of rule, kept orthogonal

The original description — "random 6, only certain types allowed, air banned,
airdropped exceptions to previous rules" — mixes three things that need
different machinery. Separating them is most of the design.

| Axis | Question | Shape |
|---|---|---|
| Pool | Is this build legal at all? | Predicate over one ref |
| Composition | Is this assembled team legal? | Predicate over a set |
| Selection | How was the team arrived at? | Open pick vs random draft |

**"Random 6" is not a filter.** It is a selection mode, and no amount of pool
filtering expresses it. Likewise "max one of each type" is a set property: every
individual member passes and the team still fails. Conflating these is the
mistake that makes rules engines collapse.

### The pool unit is a ref, which the engine already defines

`lib/data.ts` models a Shadow as a **ref** — `machamp_shadow` — via
`parseRef`/`makeRef`. `ROSTER` carries roughly 1,650 entries, a base row plus a
Shadow row for each eligible species; `opponentCandidatesFor` returns refs;
`rankFor` is Shadow-aware; and `mkBattleMon(ref, …)` parses the suffix to apply
`SHADOW_ATK_MULT` and `SHADOW_DEF_MULT`. Only the picker collapses the two,
deliberately, so its list stays around 1,100 rather than 1,650.

So the rules layer resolves to refs, not to species:

```ts
resolvePool(rules, league): { legal: Ref[]; decidedBy: Map<Ref, number> }
```

This is what makes a ban more specific than a species, which is a requirement:
`forretress` and `forretress_shadow` are separate pool entries that can be
allowed and denied independently.

**Selectors match refs, and a species-level term matches all of that species'
refs.** No new syntax is needed, because the existing grammar already composes:

| Clause | Effect |
|---|---|
| `deny forretress` | both variants |
| `deny forretress&!shadow` | the normal form only |
| `allow forretress&shadow` | the Shadow only |
| `deny shadow` | every Shadow in the pool |

The builder surfaces these as three explicit actions — ban species, ban normal
only, ban Shadow only — so the precision is discoverable without teaching
anyone the syntax.

**One deliberate divergence from the search language.** In `query.ts`, `shadow`
maps to the `shadoweligible` tag and means *"has a Shadow variant"* — a property
of a species. In rules it must mean *"is the Shadow variant"* — a property of a
ref. Same token, rebound. This is the concrete reason `packages/rules` **wraps**
`query.ts` rather than re-exporting it: it expands species to refs, rebinds a
small number of terms, and pins the rest.

`packages/rules` also respects `UNSIMULATED_IDS`, so a format cannot be authored
around a species the engine is unable to model.

### Pool: an ordered pipeline, last match wins

```
base: great
1. deny   flying        — air banned
2. allow  +mantine      — airdropped exception
```

A ref starts legal if it is in the base league pool. Each clause is evaluated in
order and **the last clause that matches decides.** These are `.gitignore`
semantics, and iptables', and CSS's: well-trodden, explainable, and able to
express exceptions-to-exceptions at arbitrary depth, which a fixed
allow-then-deny phase ordering cannot.

Two things fall out of last-match-wins for free, and they are what make the
builder usable.

Every ref has exactly one deciding clause, so "why is my Mantine illegal?" is
answerable precisely — *denied by rule 1: `flying`* — with a button to add the
exception. That is the most important affordance in the builder and it costs
nothing, because the evaluator already knows the answer.

And since the roster is roughly 1,650 refs and `Term` compiles to a closure, the
pool can be recomputed live per keystroke and each clause annotated with its
delta: −87, +1. The author sees the format being built rather than imagining it.

### Composition: quota clauses

Rather than enumerating named rules and adding one whenever a new idea arrives,
composition is a list of **quotas, each a selector plus a count range**, reusing
the same selector language as the pool:

```json
"composition": {
  "size": 6,
  "uniqueSpecies": true,
  "uniqueFamilies": true,
  "quotas": [
    { "select": "shadow",    "min": 1, "max": 2, "note": "some shadows" },
    { "select": "legendary", "max": 1 },
    { "select": "water",     "max": 2 }
  ]
}
```

"No shadows" is a pool clause (`deny shadow`); "some shadows" is a quota; "all
shadows" is `min: size`. Type caps, legendary caps and anything thought of later
are the same mechanism with no new code.

**`uniqueSpecies` is separate from `uniqueFamilies` and necessary.** With refs as
the unit, Azumarill plus Shadow Azumarill is two legal refs of one species, and
a format needs to be able to say whether that is allowed.

**Moveset restrictions are composition rules, not pool rules.** The pool answers
"may I bring Forretress"; composition answers "may I bring *this* Forretress".
Keeping build-level constraints in composition leaves `resolvePool` keyed on
refs, exactly matching the engine, and requires no pipeline change at all —
`species.json` already ships every species' full movepool, so the client can
validate a build offline today.

**Cost, stated honestly:** quotas with *minimums* turn the publish-time
feasibility check from a count into a small constraint-satisfaction problem.
"Min 1 Shadow, max 1 Water, unique families, size 6" can be unsatisfiable in
ways no count detects. At team sizes of six or fewer it remains tractable with
backtracking search, but it is a solver, not a greedy pass.

### Selection: the random draft

A separate unranked mode with its own parameters. Both players roll
independently from one shared seed.

```json
"selection": {
  "mode": "random",
  "seed": "<per-match>",
  "source": { "topN": 100 },
  "playerPicks": 1,
  "rollMoves": true
}
```

- **`source`** — draw from the whole legal pool, or the top N by `leagueRank`.
  The data carries per-league ranks, with separate Shadow ranks, so this works
  directly on refs.
- **`playerPicks`** — partial randomness: *k* slots chosen by the player,
  `size − k` rolled.
- **`rollMoves`** — whether the draw also deals each slot's loadout. The draw
  source is `loadoutsFor()` from `scripts/build-matrix.ts`, which already
  generates up to twelve plausible sets per species ranked by real usage, so a
  rolled build is realistic rather than absurd. With `rollMoves` off, players
  are dealt refs and choose their own moves.
- **Each player's draw is `f(seed, playerId, rules_hash, data_rev)`** —
  deterministic, reproducible and independently verifiable after the fact, which
  is what makes it auditable when someone claims a bad roll.

**Both draws are visible to both players, and only in Show 6.** The app already
has this concept — `TeamBuilderScreen` switches on `size === 3 ? 'GBL Teams' :
'Show 6'`, and `teams.json` already stores best Show 6s — so the format maps
onto something the codebase understands.

The protocol is the competitive one: each player is dealt six, both sixes are
open, and each brings **three** of their six into a best of three or five.

```json
"composition": { "size": 6, "bring": 3 },
"match":       { "rounds": 5 }
```

`bring` and `rounds` are new. `bring` is a battle-protocol field rather than a
composition constraint — the team of six is what is validated, the three are
what is played — and `rounds` lives on the match because a best-of length is a
property of the meeting, not of the roster. Outside Show 6 the draw stays
private, since seeing an opponent's rolled three before a single elimination
match is simply seeing their team.

**A scheduled random match must pin `data_rev` at proposal time.** The same seed
against a regenerated roster yields a different draw, so a match proposed on
Tuesday and played on Friday would silently deal different teams. This is the
case that makes the `data_rev` column load-bearing rather than decorative.

### Publishing gates

The empty-format problem is worse than empty:

- **Unsatisfiable composition** — the pool is all Water, the rule says max one
  per type across three members. Every member is legal; no team is. This is the
  CSP above rather than a count.
- **Error, random modes:** pool ≥ 4 × `size`. A "random" draw of six from a pool
  of nine is not random.
- **Warning, narrowness:** pool below 10% of base-league refs — fewer than 114 in
  Great, 84 in Ultra, 37 in Master — or below about 30 refs absolute. Legal, but
  the author may be the only person queuing it.
- **Warning, dead clauses** — matching nothing, or entirely shadowed by a later
  clause. Nearly always a typo, and saying so is a kindness.

Both thresholds are tunable constants. They are scaled to league size because a
flat floor is either trivial in Great or crippling in Master: the measured pools
are 1,143 refs in Great, 841 in Ultra and 365 in Master.

Errors block publishing. Warnings do not.

### Which terms re-evaluate, and which are pinned

Rules are *intentional*: they re-evaluate against current data. "Ban legendary"
should cover a legendary added next year; "ban flying" should cover a new Flying
type. That is the wanted behaviour, and it means a published format's legal pool
legitimately shifts as `species.json` regenerates.

**But name matching in the search language is substring matching.** The header of
`query.ts` says so directly: `water` is a type and `wat` a name. That is correct
for search and unsafe as a rule — a format banning `wat` silently acquires new
members whenever upstream adds a species with those letters in it. That is not
intentionality, it is a lexical accident.

So the rules subset uses the same grammar with stricter resolution: **names and
families resolve to concrete refs at authoring time and are stored as refs,
while types, tags, generations and move predicates stay live.** Semantic
categories absorb new data; lexical matches do not.

### Queues partition by `rules_hash`

Queues partition by a canonical serialisation hash of the resolved rules rather
than by `format_version_id`: two people who independently author the same format
should match each other, and ranked ratings should pool across them. The
format's name and owner are presentation; the hash is identity.

### Three ways into a match

| Mode | Blind | Ranked | Entity |
|---|---|---|---|
| Open queue, canonical league format | yes | yes | `queue_entries` |
| Live dashboard — browse offers, inspect the format, opt in | no | no | `match_offers` |
| Scheduled proposal for a later time | no | no | `match_offers` + `scheduled_for` + handshake |
| Direct friend challenge (M3) | no | no | `match_offers`, targeted |

A queue entry says *match me with anyone on these terms*. An offer says *here is
my proposition, come and look at it* — the requirement that an opponent can
review a curated format before accepting is what makes these separate tables
rather than a flag.

**Scheduled battles get their own view and their own handshake.** An offer for a
future time carries an invite window: a bounded period during which the
opponent may accept, and within which **both sides must confirm** before the
offer expires. One-sided acceptance is not a match. An offer that reaches its
expiry unconfirmed lapses rather than converting, which keeps the calendar
honest — a scheduled battle on the board is one both people have actually
committed to, not one somebody was nominated for.

This is also the case that makes `data_rev` pinning mandatory rather than
advisory: a random-draw match agreed on Tuesday and played on Friday must deal
the same six it promised.

Only the open queue feeds rating. That confines the collusion surface to the one
mode where nobody chooses their opponent.

### The shared package

```ts
// packages/rules — no React, no browser APIs
resolvePool(rules, league): { legal: Ref[]; decidedBy: Map<Ref, number> }
validateTeam(builds, rules): { ok: boolean; violations: Violation[] }
lintFormat(rules, league): Diagnostic[]
rollTeam(rules, seed, playerId): Build[]
canonicalize(rules): string        // → rules_hash
```

The client uses all of it. **The coordinator uses `validateTeam` and `rollTeam`,
and those calls are the trust boundary** — the one place a client's claim that
its team is legal is checked by something the client does not control, and the
one place a random draw is generated where neither player can influence it.

### The risk, named

Reusing `query.ts` couples formats to a language designed for search. If search
later grows a form, formats inherit it — and a format's meaning must stay stable
for years while a search box may change freely.

Reuse is still clearly right: users already know the syntax, the legend is
already generated, the parser is already tested, and a second predicate language
over the same `Species` type would be strictly worse. But it needs a guard.
`packages/rules` accepts a pinned subset of `QUERY_FORMS`, and a test asserts
that a corpus of stored formats still resolves to identical pools. The repo
already does exactly this trick, asserting in `verify-data` that each documented
query form still works.

---

## 5. Build identity — Shadows, megas and movesets

What has to be refactored so that Shadow Bug Bite Forretress and regular Volt
Switch Forretress can be told apart. The short answer is much less than expected
for Shadows, nothing in the engine for movesets, and nothing at all for megas.

### Shadows are already first-class

Covered in section 4: `parseRef`/`makeRef`, a Shadow row per eligible species in
`ROSTER`, Shadow-aware ranking, and the multipliers applied in `mkBattleMon`.
There is **no engine refactor**. The platform work is consistency — key
`team_members` on `ref`, resolve `packages/rules` to refs, and give the format
builder an affordance the picker deliberately lacks, since it collapses the two
forms behind a toggle.

### Movesets are already computed, then discarded

In `scripts/build-matrix.ts`:

- `loadoutsFor()` generates up to `MOVESETS_MAX = 12` plausible sets per species
  (`FAST_K = 3`, `CHARGE_K = 4`), ranked by real usage
- `buildPool()` builds a `Variant` per **ref × loadout**
- `sweep()` rates every variant against every foe, in every scenario, under both
  shield policies
- **`perRefBest()` collapses that to one Overall per ref**, retaining
  `bestVariant` — the index of the winning loadout — which is never emitted

The battles distinguishing those two Forretresses **already run**. The pipeline
computes the distinction and drops it at the last step; the word "variant" in
this codebase already means ref plus loadout.

So the constraint is not compute, it is **artefact size**. `rankings.json` is
3.3MB per-ref, and per-variant is roughly twelve times that. That is a shipping
problem with cheaper answers than emitting everything.

**What must not change:** opponents are swept only at their rated loadout. The
file header records this as a modelling decision rather than a cost shortcut —
sweeping both sides lets sets nobody plays vote in the average, and it is 6.56
billion battles against 244 million. Build identity on the player's own side
does not require touching it.

### Megas: included, gated on a floor-CP test

There are 56 mega entries and none is currently in any league pool. They are
included, and league membership is derived rather than inherited — because the
question is not whether a mega is strong but whether it is **obtainable at a
level that fits under the cap.**

Mega Sableye is legal in Great. Mega Mewtwo is not, and not because of its
stats: Mewtwo comes from raids at level 20 and cannot be lowered, so its floor
CP is already far above 1500.

**The rule:** a mega is eligible for a league when its CP at its *minimum
obtainable level*, with worst-case IVs, is at or below the cap. Minimum
obtainable level is 20 for raid-sourced legendaries and mythicals, and 1
otherwise, since anything else can be traded down.

Measured over all 56, using the CPM table in `lib/cpm.ts`:

| | floor CP | eligible |
|---|---|---|
| Sableye (Mega) | 22 | Great, Ultra |
| Gengar (Mega) | 54 | Great, Ultra |
| Diancie (Mega) | 2,190 | Ultra only |
| Latias (Mega) | 2,450 | Ultra only |
| Mewtwo (Mega X / Y) | 3,152 / 3,323 | **Master only** |

**48 of 56 are Great-eligible, 50 Ultra-eligible, and 6 are Master-only** —
Mewtwo X and Y, Rayquaza, Primal Kyogre, Primal Groudon and Latios. So the
exclusion is real but narrow, and it is a computed property rather than a
curated list that would drift.

Two caveats. The level-20 floor is inferred from the `legendary` and `mythical`
tags rather than from a per-species acquisition record; that reproduces every
case checked, but a genuine `minLevel` field in the generator would be more
honest than a tag proxy and is the better long-term fix. And megas have no
PvPoke ranking, so `leagueRank` and `bestIv` are absent for them: the eligible
set has to run through `build-best-spreads` and the matrix build to acquire the
precomputed rank-1 IV per league that `mkBattleMon` expects, or every mega falls
into the 4,096-spread search path at runtime.

**This is data-pipeline work and it is not in M0.** Formats can reference megas
as soon as the pipeline emits them; nothing in the rules layer needs to change,
because a mega is just another ref.

### The refactor, in order

| Work | Where | Cost | Milestone |
|---|---|---|---|
| Pool and teams key on `ref` | `packages/rules`, `team_members` | small | M0 / M1 |
| Builder addresses Shadow variants separately | builder UI | small | M0 |
| Build ref — `{ ref, fast, charge1, charge2 }` plus a canonical string | `packages/rules` | small, additive | M0 |
| Moveset restrictions as composition quotas | `packages/rules` | small | M0 |
| Rules layer respects `UNSIMULATED_IDS` | `packages/rules` | trivial | M0 |
| Emit `bestVariant` per ref | `build-matrix.ts` | one int per ref | cheap follow-up |
| Emit per-variant rows | `build-matrix.ts`, artefact split | ~12× `rankings.json` | deferred |
| Mega league membership by floor CP, plus spreads and ranks for the eligible set | `build-data.mjs`, `build-best-spreads`, `build-matrix` | full data regeneration | own data task, after M1 |

**M0 needs no pipeline change at all.** Emitting `bestVariant` is worth taking
early regardless of the platform: it is a single integer per ref and it exposes
the gap between the set PvPoke rates and the set that actually scores best —
something the pipeline has computed all along and never reported.

### The enforceability caveat

**A moveset restriction cannot be verified against an opponent.** What Forretress
they brought is unknowable until they throw it. A moveset rule is therefore a
validated commitment on one's own submitted team and a social contract on the
other side — the same trust model as score reporting.

That is acceptable for curated and friend matches. Whether moveset-restricted
formats should be eligible for **ranked** is a separate decision, since ranked is
where the incentive to defect exists. In random mode the question is softer,
because `rollMoves` deals the loadout rather than trusting a claim about it.

---

## Open questions

Most of the original list is now settled and folded into the sections above:
Glicko-2, rating confined to the three open leagues, journal-screenshot
disputes, ephemeral messaging with pins, agentic verification with judge
override, the scheduled-battle handshake, grit as a tournament-only statistic,
no ranked moveset formats, Show 6 draw visibility, and megas gated on floor CP.

What remains:

1. **Grit's minimum-N gate.** Now restricted to tournament matches, the
   subsample is small enough that a threshold is required rather than advisable.
   Decide before M4.
2. **Coordinator hosting**, and whether M2's version can be a scheduled function
   before it needs a long-lived process.
3. **The ephemeral retention window** — the concrete number of hours a message
   is held server-side for moderation while presenting as expired to readers.
   This is a privacy-policy commitment, not an implementation detail. Decide
   before M2.
4. **Evidence retention** — how long a journal screenshot is kept after its
   dispute closes, given it carries a third party's username. Decide before M2.
5. **Confidence threshold for automated verification**, and whether a low-
   confidence verdict escalates to a judge or defaults to unverified. Decide
   before M2.
6. **A real `minLevel` field** in the generator, replacing the legendary and
   mythical tag proxy used for mega eligibility. Correct in every case checked,
   but a proxy. No milestone blocks on it.
7. **Moderation staffing** for the non-tournament report queue. Agentic
   verification covers match results; it does not cover a message someone
   reports. Decide before M2.

## What comes next

M0 — formats offline — is the first implementation plan. It needs no
infrastructure decision, ships into the current app, and de-risks section 4,
which is the least certain part of this design.
