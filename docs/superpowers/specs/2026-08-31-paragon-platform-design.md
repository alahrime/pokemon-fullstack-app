# Paragon as a platform — accounts, formats, matchmaking, social

**Date:** 2026-08-31
**Status:** design approved in conversation; not yet planned or implemented
**Covers:** the decomposition, data model, security model, and rules language
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
| `team_members` | Species, fast move, two charge moves, IVs, level, shadow flag |
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
| `messages` | Body, `edited_at`, `deleted_at` |
| `message_reports` | The moderation queue. Required at this audience, not optional |

**Matchmaking and records** (5, 6)

| Table | Notes |
|---|---|
| `queue_entries` | Profile, format version, **`rules_hash`** (the actual partition key), ranked flag, team snapshot, expiry |
| `matches` | Both players, both team snapshots, format version, `rules_hash`, `data_rev`, channel, state, season |
| `match_reports` | Two rows per match: each side's independent claim |
| `match_rounds` | The adjudicated per-round truth, written on confirmation |
| `seasons`, `ratings` | Per season, per scope, with deviation columns |

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
| Pool | Is this species legal at all? | Predicate over one species |
| Composition | Is this assembled team legal? | Predicate over a set |
| Selection | How was the team arrived at? | Open pick vs random draft |

**"Random 6" is not a filter.** It is a selection mode, and no amount of species
filtering expresses it. Likewise "max one of each type" is a set property: every
individual member passes and the team still fails. Conflating these is the
mistake that makes rules engines collapse.

### Pool: an ordered pipeline, last match wins

```
base: great
1. deny   flying        — air banned
2. allow  +mantine      — airdropped exception
```

A species starts legal if it is in the base league pool. Each clause is
evaluated in order and **the last clause that matches decides.** These are
`.gitignore` semantics, and iptables', and CSS's: well-trodden, explainable, and
able to express exceptions-to-exceptions at arbitrary depth, which a fixed
allow-then-deny phase ordering cannot.

Two things fall out of last-match-wins for free, and they are what make the
builder usable.

Every species has exactly one deciding clause, so "why is my Mantine illegal?"
is answerable precisely — *denied by rule 1: `flying`* — with a button to add
the exception. That is the most important affordance in the builder and it costs
nothing, because the evaluator already knows the answer.

And since the roster is roughly 1,100 species and `Term` compiles to a closure,
the pool can be recomputed live per keystroke and each clause annotated with its
delta: −87, +1. The author sees the format being built rather than imagining it.

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
families resolve to concrete ids at authoring time and are stored as ids, while
types, tags, generations and move predicates stay live.** Semantic categories
absorb new data; lexical matches do not.

Consequence: because the pool genuinely moves under a fixed ruleset, match
records store `rules_hash` *and* the data revision — the same instinct as the
existing `engineRev` stamp on the artefacts.

### Publishing gates

The empty-format problem is worse than empty:

- **Pool too small** for the composition — three cannot be fielded from two.
- **Unsatisfiable composition** — the pool is all Water, the rule says max one
  per type across three members. Every member is legal; no team is. This needs a
  real satisfiability check rather than a count, and at these sizes a greedy
  brute force suffices.
- **Dead clauses** — matching nothing, or entirely shadowed by a later clause.
  Warn rather than block; it is nearly always a typo, and saying so is a
  kindness.
- **Viable but lonely** — legal, but so narrow nobody else will queue it.

Errors block publishing. Warnings do not.

### Queues partition by `rules_hash`

Queues partition by a canonical serialisation hash of the resolved rules rather
than by `format_version_id`:
two people who independently author the same format should match each other, and
ranked ratings should pool across them. The format's name and owner are
presentation; the hash is identity.

### The shared package

```ts
// packages/rules — no React, no browser APIs
resolvePool(rules, roster): { legal: Species[]; decidedBy: Map<SpeciesId, number> }
validateTeam(team, rules, roster): { ok: boolean; violations: Violation[] }
lintFormat(rules, roster): Diagnostic[]
canonicalize(rules): string        // → rules_hash
```

The client uses all four. **The coordinator uses only `validateTeam`, and that
call is the trust boundary** — the one place a client's claim that its team is
legal is checked by something the client does not control.

Stored shape, with a `schema` field from day one so migration is possible:

```json
{ "schema": 1, "base": "great",
  "pool": [ {"effect":"deny","select":"flying","note":"air banned"},
            {"effect":"allow","select":"+mantine"} ],
  "composition": { "size": 3, "maxPerType": 1, "uniqueFamilies": true },
  "selection": { "mode": "open" } }
```

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

## Open questions

Not blocking M0. Each should be settled before the milestone that needs it.

1. **Rating algorithm.** The request said ELO. Glicko-2's rating deviation is a
   better fit for irregular play and small samples, since it knows when it is
   uncertain, and the schema above already reserves deviation columns. Decide
   before M4.
2. **Rating scope.** One rating per base league, or per format? Rating is
   population-hungry; many small pools produce noise that describes matchup luck
   rather than skill. A single pooled rating with format as context is the safer
   default. Decide before M4.
3. **Dispute resolution policy.** What happens on contradictory reports, on one
   side never reporting, and on repeat offenders. The schema supports any
   policy; the policy is unchosen. Decide before M2.
4. **Message retention window** for moderation, balanced against privacy.
   Decide before M2.
5. **Moderation staffing.** A report queue needs people. Decide before M2.
6. **Coordinator hosting**, and whether M2's version can be a scheduled function
   before it needs a long-lived process.
7. **Grit's minimum-N gate.** Grit is a ratio over a subsample — only matches
   following a loss count — so it converges far slower than win rate and reads
   as noise over a user's first few dozen matches. Decide the display threshold
   before M4.

## What comes next

M0 — formats offline — is the first implementation plan. It needs no
infrastructure decision, ships into the current app, and de-risks section 4,
which is the least certain part of this design.
