# Tournaments and Roster Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any signed-in player can host a Swiss tournament, players register six Pokémon, teams are revealed when registration closes, rounds are paired and timed, scores are reported and disputed, and the host and judges run the event — with the bracket, standings, roster and matchup views in the app's HUD style.

**Architecture:** New Postgres tables behind RLS with **every write going through SECURITY DEFINER RPCs** (no client table writes). The organiser's client computes each round's Swiss pairings with a pure, isomorphic module; `start_round` validates them server-side (complete, no self-pairing, no rematches, one bye). Time rules (registration close, score finality) are **derived at read time**, so the coordinator needs no change and no redeploy. Opponents reach each other through the existing DM and friend-code machinery by extending `share_a_live_match` and the friend-code policy to cover a live tournament pairing. New Play-section screen `tournaments`, shareable at `#/play/tournaments/<id>`.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql, `supabase/tests` via the db vitest config), React 19 + TS, vitest + Testing Library, existing `lib/*`, `rules` validator, `teamCodec`, `AddPokemonModal` patterns, `ChannelListContext`, `NotificationsContext`.

**Spec:** `docs/superpowers/specs/2026-09-29-shell-challenges-tournaments-design.md`, section C; platform design `2026-08-31-paragon-platform-design.md` (roles, judged-by-people, audit). Builds on the merged shell (plan A) and challenges/chat (plan B).

## Global Constraints

- **Swiss only for v1.** Best of three per pairing (games to win = 2). **Any signed-in user may host**; the host is the organiser and is the root of trust; the organiser appoints **judges** who hold the run-the-event powers (not appointing judges, not cancelling).
- **Every roster is exactly six Pokémon.** A tournament's format must have `composition.size = 6`. Each member carries: species `ref` (Shadow is the `_shadow` ref suffix), fast move id, one or two charged move ids, **CP**, and a **Best Buddy** flag. **No IVs.** The opponent-visible card shows species, moves, CP, and Shadow / Best Buddy badges.
- **Teams are hidden until registration closes — from everyone, the host included.** After close, every entrant, the organiser and judges can read every roster. Registration is "closed" when state is `closed`/`running`/`complete`, or when `registration_closes_at` has passed (derived at read time).
- **No joining after the tournament starts.** Registration ends at close; the roster is editable only while registration is open.
- **Reporting (ruling):** either player reports; it shows on the bracket at once. The other player may confirm (final now) or dispute. An unconfirmed, undisputed report becomes final at `greatest(round_ends_at, reported_at + 10 minutes)`. A dispute goes to the organiser/judges, who settle it by hand (no automated adjudication in a bracket).
- **Round timer is display only.** No automatic forfeits. After the deadline the host sees a "needs attention" list and may award a loss or a double loss.
- **Byes** score 2–0 to the bye player, at most one per round, never the same player twice (override is audited). **Rematches** are refused (override is audited).
- **Drop:** before the start a player withdraws (row removed); after the start they drop (excluded from later rounds; a pending pairing is settled as a 0–2 loss).
- **Everything a host/judge changes is written to `tournament_audit`** with actor, action and the prior values. A result that can be changed without a trace is a result nobody can trust.
- **Roster legality** (`validateTeam` against the format) is checked in the client and shown; it is NOT enforceable in SQL (the validator is TypeScript). Ruling: acceptable because tournaments are judged by people; the organiser/judges can remove an illegal entrant (audited). Say so in the handoff.
- **Formats:** the entrants must be able to read the tournament's format. While a non-draft tournament references a format version, any signed-in user may read that version and its format row (helper extension in Task 1). The host may use their own format or a public one.
- Use design tokens and existing HUD classes (`.panel`, `.chamfer-9`, `.btn`, `.hud-label`, `.friend-notice`, `.seg-btn`); no literal colours; colour is never the only carrier of a result (winner/loser also get a text mark); motion runs once and respects `prefers-reduced-motion`.
- **HARD RULES for the local stack:** the user's local Supabase holds their own test accounts. NEVER run `npm run db:reset`, `supabase db reset` or `db:stop`. Apply migrations with `npx supabase migration up --local --workdir ..` (from `app/`), or `psql`/`docker exec` on the running db if the CLI cannot see a worktree's migrations, and say exactly what you did. Tests create and clean their own rows (random uuids). Never touch the user's rows. `supabase/tests/social.test.ts` has 5 known environmental failures caused by the user's real friendship row: report them, never "fix" them.
- **Deploy:** pushing to `main` applies migrations to the production database (GitHub app). The tournament migrations are additive. Do not push; the controller asks the user.
- Gates: `cd app && npm run check` before every code commit; the db vitest config for SQL tasks (`npx vitest run --config vitest.db.config.ts <path>`, check its include glob). After anything reaching `src/rules`, run `npm run build:coordinator` (this plan does not touch it).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage explicit paths; never commit `.superpowers/`.

## Rulings taken in this plan (recorded so nobody re-litigates them)

1. **Pairings are computed by the organiser's client and validated by `start_round`,** not by an Edge Function. The organiser is the root of trust (platform spec) and can override anything, audited; server validation guarantees structural soundness (every active entrant exactly once, no self-pair, no rematch, one bye), not Swiss optimality. Avoids a second bundled runtime and a manual function deploy.
2. **Pairings do not create `matches` rows.** `matches` is coupled to score adjudication and mismatch sweeps, which the platform spec says must not run inside a bracket. Instead `share_a_live_match` and the friend-code policy learn about live tournament pairings, so DMs, challenges and friend codes work between opponents.
3. **Time is derived, not swept.** Registration close and score finality are evaluated when read (`tournament_is_closed`, `final_at <= now()`); no coordinator change.
4. **Standings are computed client-side** from pairings (pure module, unit-tested), not stored.
5. **No tournament group channel and no spectators in v1.** Members are entrants, judges, organiser; the bracket and standings are visible to every signed-in user, rosters only to members after close.

## Deferred (out of this plan)

- Single/double elimination, round robin; a tournament announcement channel; spectators reading rosters; Glicko/grit statistics from tournament results (platform spec M4); pairing preview/manual pairing edits before applying; tournament search/filters beyond state; web push for round start.

## File Structure

- Create `supabase/migrations/20260930000000_tournaments.sql` (tables, RLS, helpers, host/registration RPCs), `20260930000100_tournament_rounds.sql` (rounds, reporting, judging, audit RPCs, `share_a_live_match` + friend-code + format-read extensions).
- Create `supabase/tests/tournaments.test.ts`, `supabase/tests/tournament_rounds.test.ts`.
- Create `app/src/tournament/swiss.ts` (pure pairing + standings), `app/src/tournament/roster.ts` (pure roster type, CP bounds, validation, public card).
- Create `app/src/lib/tournaments.ts` (types + Supabase wrappers), `app/src/state/useTournament.ts` (loads and polls one tournament).
- Modify `app/src/state/AppState.tsx` (`Screen` += `'tournaments'`, `activeTournamentId`), `app/src/lib/screens.ts`, `app/src/lib/route.ts`, `app/src/lib/badges.ts`, `app/src/lib/notifications.ts`.
- Create `app/src/screens/TournamentsScreen.tsx` (browse + create), `app/src/screens/TournamentScreen.tsx` (one tournament), components under `app/src/components/tournament/`: `RosterForm.tsx`, `RosterCard.tsx`, `Bracket.tsx`, `Standings.tsx`, `PlayersTab.tsx`, `MatchupPanel.tsx`, `HostPanel.tsx`, `RoundClock.tsx`.
- Modify `app/src/styles/components.css`; create `app/tools/m5-tournament-roundtrip.ts`.
- Tests beside each unit.

---

### Task 1: Database — tournaments, registration, roster secrecy

**Files:**
- Create: `supabase/migrations/20260930000000_tournaments.sql`
- Test: `supabase/tests/tournaments.test.ts`

**Interfaces:**
- Produces (SQL): tables `tournaments`, `tournament_entrants`, `tournament_rosters`, `tournament_roles`, `tournament_pairings`, `tournament_audit`; helpers (all `SECURITY DEFINER`, `set search_path = public`, caller-scoped, revoked from `public, anon`, granted to `authenticated`): `tournament_is_closed(uuid) returns boolean`, `tournament_can_run(uuid) returns boolean`, `tournament_is_member(uuid) returns boolean`, `tournament_visible(uuid) returns boolean`; internal `_tournament_audit(uuid, text, jsonb)` (revoked from everyone); RPCs `create_tournament`, `update_tournament`, `open_registration`, `register_roster`, `withdraw_from_tournament`, `close_registration`, `cancel_tournament`, `grant_judge`, `revoke_judge`.
- Signatures:
  - `create_tournament(p_title text, p_description text, p_format_version uuid, p_rounds smallint, p_round_minutes smallint, p_max_players smallint, p_closes_at timestamptz default null) returns uuid`
  - `update_tournament(p_id uuid, p_title text, p_description text, p_round_minutes smallint, p_max_players smallint, p_closes_at timestamptz) returns boolean`
  - `open_registration(p_id uuid) returns boolean`; `close_registration(p_id uuid) returns boolean`; `cancel_tournament(p_id uuid) returns boolean`
  - `register_roster(p_id uuid, p_roster jsonb) returns integer` — the caller's seed
  - `withdraw_from_tournament(p_id uuid) returns boolean`
  - `grant_judge(p_id uuid, p_user uuid) returns boolean`; `revoke_judge(p_id uuid, p_user uuid) returns boolean`
- Consumes: `formats`, `format_versions`, `profiles`, `plays_format_version(uuid)` / `plays_format(uuid)` (20260929000100).

- [ ] **Step 1: Capture the CURRENT definitions the migration patches.** `plays_format_version` and `plays_format` were created in `20260929000100_challenge_formats.sql`; copy from the live DB, never from a guess.

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c "select pg_get_functiondef('public.plays_format_version(uuid)'::regprocedure)" > /tmp/pfv.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c "select pg_get_functiondef('public.plays_format(uuid)'::regprocedure)" > /tmp/pf.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c "select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid in ('public.formats'::regclass,'public.format_versions'::regclass)"
```

(If `psql` is absent: `docker exec supabase_db_paragon-iv psql -U postgres -At -c "…"`.) Read all three fully.

- [ ] **Step 2: Write the failing tests** — `supabase/tests/tournaments.test.ts`. Follow `supabase/tests/challenges.test.ts` exactly for structure (`makeUser`, `befriend`, `asUser`, `refusal`, `POLICY_DENIED`/`PRIVILEGE_DENIED`, afterEach cleanup by the test's own random ids). Fixtures: users `host`, `ann`, `bob`, `cal`, `stranger`; one format whose `rules` is `{"schema":1,"base":"great","pool":[],"composition":{"size":6,"uniqueSpecies":true},"selection":{"mode":"open"}}` owned by `host` (private), one size-3 format owned by host, one public size-6 format owned by ann. Helper `roster(cp = 1500)` builds a valid six-member jsonb `[{"ref":"azumarill","fast":"BUBBLE","charges":["ICE_BEAM","PLAY_ROUGH"],"cp":1498,"bestBuddy":false}, …×6]`. Cases (each asserts real state, not just "no error"):
  1. `create_tournament` as host on their own private size-6 format → `draft`, `organiser_id = host`, `league = 'great'` derived from `rules->>'base'`; refused: a size-3 format (`'a tournament needs a format of six'`), someone else's PRIVATE format (`'a tournament needs a format you own or a public one'`), rounds 0 or 13, max_players 1, empty title; allowed: ann's public size-6 format.
  2. Nobody can INSERT/UPDATE/DELETE any tournament table directly (each of six tables → `PRIVILEGE_DENIED`).
  3. A draft is invisible to everyone but its organiser; after `open_registration` any signed-in user sees it; only the organiser may `open_registration` (a stranger gets `'not allowed'` — the same sentence for "no such tournament").
  4. `register_roster` by ann: entrant + roster rows appear, seed 1; a second call by ann edits (still one entrant); bob gets seed 2; refused: roster of 5 or 7, a member missing `cp`, `cp` < 10 or non-integer, `charges` of length 0 or 3, a duplicate `ref` when the format says `uniqueSpecies` is NOT checked in SQL (legality is client-side — assert a duplicate-ref roster is ACCEPTED here, with a comment); refused when registration is not open (`draft`), when full (`max_players`), and after `close_registration` (`'registration is closed'`); refused by time: set `registration_closes_at` to the past via superuser and register → refused.
  5. **Secrecy:** before close, ann reads her own roster row; bob reads 0 rows of ann's; host (organiser, not an entrant) reads 0 rows of anyone's; a judge reads 0. After `close_registration`: ann, bob, host and a granted judge read all rosters; `stranger` (not a member) still reads 0. Also **lazy close**: with state still `registration` but `registration_closes_at` in the past (set via superuser), members read all rosters and `tournament_is_closed` is true.
  6. `withdraw_from_tournament` before close removes entrant and roster; after close it is refused (`'registration is closed'`).
  7. `close_registration` requires ≥ 2 entrants (`'at least two players are needed'`) and organiser only; writes an audit row (`action = 'close_registration'`) readable by the organiser and a judge, unreadable by an entrant.
  8. `grant_judge`/`revoke_judge`: organiser only; a judge can `tournament_can_run` but cannot grant another judge; both write audit rows with the target in `detail`.
  9. Formats: a stranger cannot read a host's PRIVATE format version while the tournament is `draft`; after `open_registration` any signed-in user reads that one version and its format row, and NOT the host's second private format (assert both counts).
  10. `cancel_tournament` by organiser sets `cancelled`, refused for others, audited; a cancelled tournament stays visible.
  11. Anonymous callers are refused on every RPC (`asAnon()` → `permission denied for function …`).

- [ ] **Step 3: Run to verify failure**

Run: `cd app && npx vitest run --config vitest.db.config.ts ../supabase/tests/tournaments.test.ts`
Expected: FAIL — functions and tables do not exist.

- [ ] **Step 4: Write the migration** — `supabase/migrations/20260930000000_tournaments.sql`:

```sql
-- Tournaments: Swiss brackets run by any signed-in user, judged by people.
-- Every write is a SECURITY DEFINER function. Direct table writes are revoked
-- because a client permitted to write these tables is a client permitted to
-- edit results.

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (btrim(title) <> '' and length(title) <= 80),
  description text not null default '' check (length(description) <= 2000),
  format_version_id uuid not null references public.format_versions (id) on delete restrict,
  league text not null,
  rounds smallint not null check (rounds between 1 and 12),
  round_minutes smallint not null default 25 check (round_minutes between 5 and 240),
  max_players smallint not null default 64 check (max_players between 2 and 512),
  registration_closes_at timestamptz,
  state text not null default 'draft'
    check (state in ('draft', 'registration', 'closed', 'running', 'complete', 'cancelled')),
  current_round smallint not null default 0,
  round_ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index tournaments_state_idx on public.tournaments (state, created_at desc);
create index tournaments_organiser_idx on public.tournaments (organiser_id);

create table public.tournament_entrants (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  seed integer not null,
  dropped boolean not null default false,
  registered_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

-- The roster is the OPPONENT-VISIBLE shape only: no IVs. Kept apart from the
-- entrant row because RLS is per row: metadata is public, the team is secret
-- until registration closes.
create table public.tournament_rosters (
  tournament_id uuid not null,
  player_id uuid not null,
  roster jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id),
  foreign key (tournament_id, player_id)
    references public.tournament_entrants (tournament_id, player_id) on delete cascade
);

create table public.tournament_roles (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'judge' check (role = 'judge'),
  granted_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table public.tournament_pairings (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round smallint not null,
  table_no smallint not null,
  player_a uuid not null references public.profiles (id) on delete cascade,
  player_b uuid references public.profiles (id) on delete cascade, -- null = bye for player_a
  score_a smallint,
  score_b smallint,
  state text not null default 'pending' check (state in ('pending', 'reported', 'disputed', 'settled')),
  reported_by uuid references public.profiles (id) on delete set null,
  reported_at timestamptz,
  final_at timestamptz,
  settled_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  unique (tournament_id, round, table_no),
  constraint pairing_distinct check (player_b is null or player_a <> player_b),
  constraint pairing_bye_is_settled check (
    player_b is not null or (state = 'settled' and score_a = 2 and score_b = 0)
  )
);
create index tournament_pairings_round_idx on public.tournament_pairings (tournament_id, round);
create index tournament_pairings_player_a_idx on public.tournament_pairings (player_a);
create index tournament_pairings_player_b_idx on public.tournament_pairings (player_b);

create table public.tournament_audit (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index tournament_audit_idx on public.tournament_audit (tournament_id, created_at);

alter table public.tournaments enable row level security;
alter table public.tournament_entrants enable row level security;
alter table public.tournament_rosters enable row level security;
alter table public.tournament_roles enable row level security;
alter table public.tournament_pairings enable row level security;
alter table public.tournament_audit enable row level security;

revoke insert, update, delete, truncate on
  public.tournaments, public.tournament_entrants, public.tournament_rosters,
  public.tournament_roles, public.tournament_pairings, public.tournament_audit
  from anon, authenticated;

-- Caller-scoped helpers. Each answers a question about the CALLER only, never
-- about an arbitrary pair, so granting them discloses nothing a signed-in user
-- could not already read. A missing tournament answers false, never null, so a
-- draft cannot be told from a missing row.
create function public.tournament_visible(p uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select t.state <> 'draft' or t.organiser_id = (select auth.uid())
                     from public.tournaments t where t.id = p), false)
$fn$;

create function public.tournament_can_run(p uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select t.organiser_id = (select auth.uid())
                        or exists (select 1 from public.tournament_roles r
                                    where r.tournament_id = t.id and r.user_id = (select auth.uid()))
                     from public.tournaments t where t.id = p), false)
$fn$;

create function public.tournament_is_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.tournament_can_run(p)
      or exists (select 1 from public.tournament_entrants e
                  where e.tournament_id = p and e.player_id = (select auth.uid()))
$fn$;

-- Closed = teams may be read. Derived, not swept: a registration whose close
-- time has passed is closed whether or not anyone pressed the button.
create function public.tournament_is_closed(p uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select t.state in ('closed', 'running', 'complete', 'cancelled')
                          or (t.state = 'registration' and t.registration_closes_at is not null
                              and t.registration_closes_at <= now())
                     from public.tournaments t where t.id = p), false)
$fn$;

create function public._tournament_audit(p uuid, p_action text, p_detail jsonb) returns void
language sql security definer set search_path = public as $fn$
  insert into public.tournament_audit (tournament_id, actor_id, action, detail)
  values (p, (select auth.uid()), p_action, coalesce(p_detail, '{}'::jsonb))
$fn$;

create policy "a tournament is visible once it is not a draft"
  on public.tournaments for select to authenticated
  using (state <> 'draft' or organiser_id = (select auth.uid()));
create policy "entrants follow the tournament"
  on public.tournament_entrants for select to authenticated
  using (public.tournament_visible(tournament_id));
create policy "pairings follow the tournament"
  on public.tournament_pairings for select to authenticated
  using (public.tournament_visible(tournament_id));
create policy "roles follow the tournament"
  on public.tournament_roles for select to authenticated
  using (public.tournament_visible(tournament_id));
-- THE SECRECY RULE. Your own roster always; everyone else's only once
-- registration is closed AND you are a member. The host is not a member of
-- anything until it closes either.
create policy "a roster is its owner's until registration closes"
  on public.tournament_rosters for select to authenticated
  using (
    player_id = (select auth.uid())
    or (public.tournament_is_closed(tournament_id) and public.tournament_is_member(tournament_id))
  );
create policy "the audit is for those who run the event"
  on public.tournament_audit for select to authenticated
  using (public.tournament_can_run(tournament_id));

-- >>> PASTE, from Step 1, the CURRENT `plays_format_version(uuid)` and
-- `plays_format(uuid)` as `create or replace function ...`, adding to each
-- body's boolean expression one more OR arm:
--     or exists (select 1 from public.tournaments t
--                 where t.format_version_id = <the version id (or, for plays_format,
--                       each version of that format)>
--                   and t.state <> 'draft')
-- i.e. while a non-draft tournament references a version, ANY signed-in user may
-- read that version and its format row (entrants must read the rules to
-- register). Change nothing else. Keep their grants. <<<

revoke all on function public.tournament_visible(uuid), public.tournament_can_run(uuid),
  public.tournament_is_member(uuid), public.tournament_is_closed(uuid)
  from public, anon;
grant execute on function public.tournament_visible(uuid), public.tournament_can_run(uuid),
  public.tournament_is_member(uuid), public.tournament_is_closed(uuid) to authenticated;
revoke all on function public._tournament_audit(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- RPCs
create function public.create_tournament(
  p_title text, p_description text, p_format_version uuid, p_rounds smallint,
  p_round_minutes smallint, p_max_players smallint, p_closes_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := (select auth.uid());
  owner uuid; vis public.format_visibility; rules jsonb; id uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select f.owner_id, f.visibility, v.rules into owner, vis, rules
    from public.format_versions v join public.formats f on f.id = v.format_id
   where v.id = p_format_version;
  if owner is null or not (owner = me or vis = 'public') then
    raise exception 'a tournament needs a format you own or a public one';
  end if;
  if (rules -> 'composition' ->> 'size') is distinct from '6' then
    raise exception 'a tournament needs a format of six';
  end if;
  insert into public.tournaments
    (organiser_id, title, description, format_version_id, league, rounds, round_minutes,
     max_players, registration_closes_at)
  values
    (me, btrim(p_title), coalesce(p_description, ''), p_format_version, coalesce(rules ->> 'base', 'great'),
     p_rounds, coalesce(p_round_minutes, 25), coalesce(p_max_players, 64), p_closes_at)
  returning tournaments.id into id;
  perform public._tournament_audit(id, 'create', jsonb_build_object('format_version', p_format_version));
  return id;
end;
$fn$;

create function public.update_tournament(
  p_id uuid, p_title text, p_description text, p_round_minutes smallint,
  p_max_players smallint, p_closes_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state not in ('draft', 'registration') then raise exception 'a running tournament cannot be edited'; end if;
  update public.tournaments set
    title = coalesce(nullif(btrim(p_title), ''), title),
    description = coalesce(p_description, description),
    round_minutes = coalesce(p_round_minutes, round_minutes),
    max_players = coalesce(p_max_players, max_players),
    registration_closes_at = p_closes_at
   where id = p_id;
  perform public._tournament_audit(p_id, 'update', jsonb_build_object(
    'title', t.title, 'round_minutes', t.round_minutes, 'max_players', t.max_players,
    'registration_closes_at', t.registration_closes_at));
  return true;
end;
$fn$;

create function public.open_registration(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state <> 'draft' then raise exception 'registration is already open'; end if;
  update public.tournaments set state = 'registration' where id = p_id;
  perform public._tournament_audit(p_id, 'open_registration', '{}');
  return true;
end;
$fn$;

create function public.close_registration(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state <> 'registration' then raise exception 'registration is not open'; end if;
  select count(*) into n from public.tournament_entrants where tournament_id = p_id;
  if n < 2 then raise exception 'at least two players are needed'; end if;
  update public.tournaments set state = 'closed' where id = p_id;
  perform public._tournament_audit(p_id, 'close_registration', jsonb_build_object('entrants', n));
  return true;
end;
$fn$;

create function public.cancel_tournament(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state in ('complete', 'cancelled') then raise exception 'this tournament is over'; end if;
  update public.tournaments set state = 'cancelled' where id = p_id;
  perform public._tournament_audit(p_id, 'cancel', jsonb_build_object('was', t.state));
  return true;
end;
$fn$;

-- Shape only. Legality against the format is the client's check and the
-- organiser's authority (the validator is TypeScript); see the plan's
-- Global Constraints.
create function public._roster_shape_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $fn$
declare m jsonb;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 6 then return false; end if;
  for m in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(m) <> 'object'
       or coalesce(m ->> 'ref', '') = '' or coalesce(m ->> 'fast', '') = ''
       or jsonb_typeof(m -> 'charges') <> 'array'
       or jsonb_array_length(m -> 'charges') not between 1 and 2
       or jsonb_typeof(m -> 'cp') <> 'number' or (m ->> 'cp') !~ '^[0-9]+$'
       or (m ->> 'cp')::int not between 10 and 6000
       or jsonb_typeof(m -> 'bestBuddy') <> 'boolean' then
      return false;
    end if;
  end loop;
  return true;
end;
$fn$;
revoke all on function public._roster_shape_ok(jsonb) from public, anon, authenticated;

create function public.register_roster(p_id uuid, p_roster jsonb) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := (select auth.uid());
  t public.tournaments; sd integer; n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.state <> 'registration' then raise exception 'registration is not open'; end if;
  if t.registration_closes_at is not null and t.registration_closes_at <= now() then
    raise exception 'registration is closed';
  end if;
  if not public._roster_shape_ok(p_roster) then
    raise exception 'a roster is exactly six Pokémon, each with a species, a fast move, one or two charged moves, a CP and a Best Buddy flag';
  end if;
  select seed into sd from public.tournament_entrants where tournament_id = p_id and player_id = me;
  if sd is null then
    select count(*) into n from public.tournament_entrants where tournament_id = p_id;
    if n >= t.max_players then raise exception 'this tournament is full'; end if;
    sd := n + 1;
    insert into public.tournament_entrants (tournament_id, player_id, seed) values (p_id, me, sd);
  end if;
  insert into public.tournament_rosters (tournament_id, player_id, roster)
  values (p_id, me, p_roster)
  on conflict (tournament_id, player_id) do update set roster = excluded.roster, updated_at = now();
  return sd;
end;
$fn$;

create function public.withdraw_from_tournament(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found then return false; end if;
  if t.state <> 'registration'
     or (t.registration_closes_at is not null and t.registration_closes_at <= now()) then
    raise exception 'registration is closed';
  end if;
  delete from public.tournament_entrants where tournament_id = p_id and player_id = (select auth.uid());
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

create function public.grant_judge(p_id uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments;
begin
  select * into t from public.tournaments where id = p_id;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.profiles where id = p_user) or p_user = t.organiser_id then
    raise exception 'that person cannot be made a judge';
  end if;
  insert into public.tournament_roles (tournament_id, user_id, granted_by)
  values (p_id, p_user, (select auth.uid())) on conflict do nothing;
  perform public._tournament_audit(p_id, 'grant_judge', jsonb_build_object('user', p_user));
  return true;
end;
$fn$;

create function public.revoke_judge(p_id uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  delete from public.tournament_roles where tournament_id = p_id and user_id = p_user;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._tournament_audit(p_id, 'revoke_judge', jsonb_build_object('user', p_user));
  end if;
  return n > 0;
end;
$fn$;

do $g$
declare f text;
begin
  foreach f in array array[
    'create_tournament(text,text,uuid,smallint,smallint,smallint,timestamptz)',
    'update_tournament(uuid,text,text,smallint,smallint,timestamptz)',
    'open_registration(uuid)', 'close_registration(uuid)', 'cancel_tournament(uuid)',
    'register_roster(uuid,jsonb)', 'withdraw_from_tournament(uuid)',
    'grant_judge(uuid,uuid)', 'revoke_judge(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$g$;
```

Replace the `>>> PASTE … <<<` block with the real SQL from Step 1 (delete the marker text). The committed migration must contain no marker text.

- [ ] **Step 5: Apply and run** — apply non-destructively (see Global Constraints), then:

Run: `cd app && npx vitest run --config vitest.db.config.ts ../supabase/tests/tournaments.test.ts ../supabase/tests/formats.test.ts ../supabase/tests/challenges.test.ts`
Expected: PASS. Then the whole db suite once: only the 5 known environmental `social.test.ts` failures may remain.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930000000_tournaments.sql supabase/tests/tournaments.test.ts
git commit -m "feat(db): tournaments, registration and roster secrecy

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database — rounds, reporting, judging, and reaching your opponent

**Files:**
- Create: `supabase/migrations/20260930000100_tournament_rounds.sql`
- Test: `supabase/tests/tournament_rounds.test.ts`

**Interfaces:**
- Produces (SQL):
  - `start_round(p_tournament uuid, p_pairings jsonb, p_force boolean default false, p_override boolean default false) returns smallint` — `p_pairings` is `[{"a":"<uuid>","b":"<uuid>|null"}, …]` in table order; returns the round number.
  - `report_score(p_pairing uuid, p_score_a smallint, p_score_b smallint) returns text` (new state); `confirm_score(p_pairing uuid) returns text`; `dispute_score(p_pairing uuid) returns text`
  - `settle_pairing(p_pairing uuid, p_score_a smallint, p_score_b smallint, p_note text default null) returns text` — organiser/judge; `p_score_a = p_score_b = 0` records a double loss
  - `drop_out(p_id uuid) returns boolean`; `remove_player(p_id uuid, p_player uuid, p_reason text) returns boolean`; `finish_tournament(p_id uuid) returns boolean`
  - `share_a_live_match(a, b)` and the friend-code policy extended to a live tournament pairing.
- Consumes: Task 1 tables/helpers.

**Counting rule (used by `start_round`, `finish_tournament` and the client):** a pairing is *counted* when `state = 'settled'`, or `state = 'reported' and final_at <= now()`.

- [ ] **Step 1: Capture the CURRENT `share_a_live_match(uuid, uuid)` definition** (`pg_get_functiondef`, as in Task 1 Step 1) and the current friend-code policies (`select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.friend_codes'::regclass`). The migration recreates the function with one more OR arm and adds one policy; nothing else in either may change.

- [ ] **Step 2: Write the failing tests** — `supabase/tests/tournament_rounds.test.ts` (same structure as Task 1's file; a `setup()` helper creates host, judge, and four entrants `p1..p4` with valid rosters, closes registration, so each test starts at state `closed`). Cases:
  1. `start_round` round 1 with valid pairings `[{a:p1,b:p2},{a:p3,b:p4}]` → state `running`, `current_round = 1`, `round_ends_at ≈ now() + round_minutes` (within 5 s), two `pending` pairings with `table_no` 1 and 2, audit row. Refused (each its own assertion and message): a non-organiser stranger (`'not allowed'`); an entrant missing (`'every active entrant must be paired exactly once'`); a player twice (`'a player appears twice'`); `a = b`; a non-entrant named; a bye when the count is even; two byes; before registration closes (`'the tournament is not ready for a round'`); when `current_round = rounds` (`'every round has been played'`); a judge succeeds where a plain entrant is refused.
  2. Odd field (five players): exactly one bye required; the bye pairing is `settled` 2–0 with `player_b null`; the same player getting a second bye in a later round is refused without `p_override` and accepted (audited with `override: true`) with it.
  3. Round 2 requires round 1 to be counted: with a `pending` pairing → refused with the count in the message; with `p_force` true → accepted and the audit `detail` records `forced: true` and the number of unsettled pairings; a `reported` pairing whose `final_at` is in the past (set via superuser) counts; one whose `final_at` is in the future does not.
  4. Rematches: round 2 repeating a round-1 pair is refused (`'those two have already played'`) and accepted with `p_override` (audited).
  5. `report_score`: only the two players; valid scores `(2,0),(2,1),(1,2),(0,2)` only — `(2,2)`, `(3,0)`, `(0,0)`, negative → `'not a possible score'`; sets `reported`, `reported_by`, `reported_at`, and `final_at = greatest(round_ends_at, reported_at + 10 minutes)` (assert against both branches by moving `round_ends_at` in the past/future via superuser); the reporter may correct their own report while `reported`; the OTHER player reporting instead of confirming while `reported` is refused (`'confirm or dispute the report'`); a stranger is refused; a `bye` is refused; a settled pairing is refused.
  6. `confirm_score` only by the other player (reporter cannot confirm own) → `settled`; `dispute_score` only by the other player → `disputed`; a disputed pairing cannot be confirmed.
  7. `settle_pairing` by organiser and by judge, from `pending`, `reported` and `disputed`; refused for players and strangers; scores `(0,0)` allowed (double loss) and recorded; `settled_by`, `note` set; audit `detail` holds the previous `score_a`, `score_b`, `state`; a bye cannot be settled.
  8. `drop_out`: a running-tournament player drops; their `pending` current pairing becomes `settled` 0–2 against them; `dropped = true`; a dropped player cannot appear in the next `start_round` pairings (`'pairings may only name active entrants'`); dropping when registration is open removes nothing (use `withdraw_from_tournament` instead: the RPC says so).
  9. `remove_player` by organiser/judge: before start deletes entrant and roster; while running marks dropped and forfeits a pending pairing; audited with the reason; refused for entrants and strangers; the organiser cannot be removed.
  10. `finish_tournament`: organiser only, only when `current_round = rounds` and every pairing counts (else `'unsettled pairings remain'`), sets `complete`, audited.
  11. **Reaching your opponent:** with a live (`pending`/`reported`/`disputed`) pairing between p1 and p2 and NO friendship, both can `open_dm` each other (via `share_a_live_match`) and read each other's friend code; p1 cannot do either with p3 (different table); after the pairing is `settled` AND the round has ended for that pair (a later round exists) the access is gone; a blocked pair (`blocks` row) still cannot open a DM (the existing block rule wins). `create_challenge` between live opponents is accepted (it reuses `share_a_live_match`).
  12. RLS: pairings are readable by any signed-in user of a non-draft tournament; no client may write them; the audit stays unreadable to entrants.
  13. Anonymous callers are refused on every new RPC.

- [ ] **Step 3: Run to verify failure** — `cd app && npx vitest run --config vitest.db.config.ts ../supabase/tests/tournament_rounds.test.ts` → FAIL.

- [ ] **Step 4: Write the migration** — `supabase/migrations/20260930000100_tournament_rounds.sql`:

```sql
-- Counting rule, in one place: settled, or reported and past its finality time.
-- STABLE, not immutable: it reads now().
create function public._pairing_counts(s text, final_at timestamptz) returns boolean
language sql stable as $fn$
  select s = 'settled' or (s = 'reported' and final_at is not null and final_at <= now())
$fn$;
revoke all on function public._pairing_counts(text, timestamptz) from public, anon, authenticated;

create function public.start_round(
  p_tournament uuid, p_pairings jsonb, p_force boolean default false, p_override boolean default false
) returns smallint
language plpgsql security definer set search_path = public as $fn$
declare
  t public.tournaments;
  rnd smallint; active integer; uncounted integer; byes integer := 0; tableno integer := 0;
  elem jsonb; a uuid; b uuid; seen uuid[] := '{}';
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  select * into t from public.tournaments where id = p_tournament for update;
  -- One sentence for "no such tournament" and "not yours to run".
  if not found or not public.tournament_can_run(p_tournament) then raise exception 'not allowed'; end if;
  if t.state not in ('closed', 'running') then raise exception 'the tournament is not ready for a round'; end if;
  if t.current_round >= t.rounds then raise exception 'every round has been played'; end if;

  if t.current_round > 0 then
    select count(*) into uncounted from public.tournament_pairings tp
     where tp.tournament_id = t.id and tp.round = t.current_round
       and not public._pairing_counts(tp.state, tp.final_at);
    if uncounted > 0 and not p_force then
      raise exception '% pairings are unsettled', uncounted;
    end if;
  end if;

  if jsonb_typeof(p_pairings) is distinct from 'array' then raise exception 'pairings must be a list'; end if;
  rnd := t.current_round + 1;
  select count(*) into active from public.tournament_entrants where tournament_id = t.id and not dropped;

  for elem in select * from jsonb_array_elements(p_pairings) loop
    a := nullif(elem ->> 'a', '')::uuid;
    b := nullif(elem ->> 'b', '')::uuid;
    if a is null or a = b then raise exception 'a pairing needs two different players, or a bye'; end if;
    if a = any(seen) or (b is not null and b = any(seen)) then raise exception 'a player appears twice'; end if;
    if not exists (select 1 from public.tournament_entrants where tournament_id = t.id and player_id = a and not dropped)
       or (b is not null and not exists (
             select 1 from public.tournament_entrants where tournament_id = t.id and player_id = b and not dropped)) then
      raise exception 'pairings may only name active entrants';
    end if;
    seen := seen || a;
    if b is null then
      byes := byes + 1;
      if not p_override and exists (
        select 1 from public.tournament_pairings where tournament_id = t.id and player_a = a and player_b is null) then
        raise exception 'that player has already had a bye';
      end if;
    else
      seen := seen || b;
      if not p_override and exists (
        select 1 from public.tournament_pairings
         where tournament_id = t.id and player_b is not null
           and ((player_a = a and player_b = b) or (player_a = b and player_b = a))) then
        raise exception 'those two have already played';
      end if;
    end if;
  end loop;

  if coalesce(array_length(seen, 1), 0) <> active then
    raise exception 'every active entrant must be paired exactly once';
  end if;
  if byes > 1 or byes <> (active % 2) then
    raise exception 'an odd field needs exactly one bye, an even field none';
  end if;

  for elem in select * from jsonb_array_elements(p_pairings) loop
    tableno := tableno + 1;
    a := (elem ->> 'a')::uuid;
    b := nullif(elem ->> 'b', '')::uuid;
    if b is null then
      insert into public.tournament_pairings
        (tournament_id, round, table_no, player_a, player_b, score_a, score_b, state, settled_by, note)
      values (t.id, rnd, tableno, a, null, 2, 0, 'settled', (select auth.uid()), 'bye');
    else
      insert into public.tournament_pairings (tournament_id, round, table_no, player_a, player_b)
      values (t.id, rnd, tableno, a, b);
    end if;
  end loop;

  update public.tournaments
     set state = 'running', current_round = rnd,
         round_ends_at = now() + make_interval(mins => round_minutes)
   where id = t.id;
  perform public._tournament_audit(t.id, 'start_round', jsonb_build_object(
    'round', rnd, 'forced', p_force and coalesce(uncounted, 0) > 0, 'unsettled', coalesce(uncounted, 0),
    'override', p_override));
  return rnd;
end;
$fn$;

create function public._valid_score(a smallint, b smallint) returns boolean
language sql immutable as $fn$
  select a is not null and b is not null
     and ((a = 2 and b in (0, 1)) or (b = 2 and a in (0, 1)))
$fn$;
revoke all on function public._valid_score(smallint, smallint) from public, anon, authenticated;

create function public.report_score(p_pairing uuid, p_score_a smallint, p_score_b smallint) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := (select auth.uid());
  p public.tournament_pairings; t public.tournaments;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.player_b is null then raise exception 'a bye has no score to report'; end if;
  if not public._valid_score(p_score_a, p_score_b) then raise exception 'not a possible score'; end if;
  if p.state in ('settled', 'disputed') then raise exception 'this result is no longer open to reports'; end if;
  if p.state = 'reported' and p.reported_by <> me then raise exception 'confirm or dispute the report'; end if;
  select * into t from public.tournaments where id = p.tournament_id;
  if t.current_round <> p.round then raise exception 'that round is over'; end if;
  update public.tournament_pairings
     set score_a = p_score_a, score_b = p_score_b, state = 'reported',
         reported_by = me, reported_at = now(),
         final_at = greatest(coalesce(t.round_ends_at, now()), now() + interval '10 minutes')
   where id = p_pairing;
  return 'reported';
end;
$fn$;

create function public.confirm_score(p_pairing uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); p public.tournament_pairings;
begin
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.state <> 'reported' then raise exception 'there is nothing to confirm'; end if;
  if p.reported_by = me then raise exception 'the other player confirms your report'; end if;
  update public.tournament_pairings set state = 'settled' where id = p_pairing;
  return 'settled';
end;
$fn$;

create function public.dispute_score(p_pairing uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); p public.tournament_pairings;
begin
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.state <> 'reported' then raise exception 'there is nothing to dispute'; end if;
  if p.reported_by = me then raise exception 'you cannot dispute your own report'; end if;
  update public.tournament_pairings set state = 'disputed' where id = p_pairing;
  return 'disputed';
end;
$fn$;

create function public.settle_pairing(
  p_pairing uuid, p_score_a smallint, p_score_b smallint, p_note text default null
) returns text
language plpgsql security definer set search_path = public as $fn$
declare p public.tournament_pairings;
begin
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or not public.tournament_can_run(p.tournament_id) then raise exception 'not allowed'; end if;
  if p.player_b is null then raise exception 'a bye cannot be settled'; end if;
  if not (public._valid_score(p_score_a, p_score_b) or (p_score_a = 0 and p_score_b = 0)) then
    raise exception 'not a possible score';
  end if;
  update public.tournament_pairings
     set score_a = p_score_a, score_b = p_score_b, state = 'settled',
         settled_by = (select auth.uid()), note = p_note
   where id = p_pairing;
  perform public._tournament_audit(p.tournament_id, 'settle_pairing', jsonb_build_object(
    'pairing', p_pairing, 'was_state', p.state, 'was_score_a', p.score_a, 'was_score_b', p.score_b,
    'score_a', p_score_a, 'score_b', p_score_b, 'note', p_note));
  return 'settled';
end;
$fn$;

-- Forfeit helper: settles this player's pending pairing this round as a 0-2 loss.
create function public._forfeit_pending(p_t uuid, p_player uuid, p_by uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $fn$
declare cur smallint;
begin
  select current_round into cur from public.tournaments where id = p_t;
  update public.tournament_pairings
     set state = 'settled', settled_by = p_by, note = p_note,
         score_a = case when player_a = p_player then 0 else 2 end,
         score_b = case when player_a = p_player then 2 else 0 end
   where tournament_id = p_t and round = cur and player_b is not null
     and state in ('pending', 'reported', 'disputed')
     and p_player in (player_a, player_b);
end;
$fn$;
revoke all on function public._forfeit_pending(uuid, uuid, uuid, text) from public, anon, authenticated;

create function public.drop_out(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found then return false; end if;
  if t.state <> 'running' then raise exception 'withdraw before the tournament starts; you can only drop while it runs'; end if;
  update public.tournament_entrants set dropped = true
   where tournament_id = p_id and player_id = me and not dropped;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._forfeit_pending(p_id, me, me, 'dropped out');
    perform public._tournament_audit(p_id, 'drop_out', jsonb_build_object('player', me));
  end if;
  return n > 0;
end;
$fn$;

create function public.remove_player(p_id uuid, p_player uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or not public.tournament_can_run(p_id) then raise exception 'not allowed'; end if;
  if p_player = t.organiser_id then raise exception 'the organiser cannot be removed'; end if;
  if t.state in ('draft', 'registration', 'closed') then
    delete from public.tournament_entrants where tournament_id = p_id and player_id = p_player;
  else
    update public.tournament_entrants set dropped = true
     where tournament_id = p_id and player_id = p_player and not dropped;
    perform public._forfeit_pending(p_id, p_player, (select auth.uid()), 'removed: ' || coalesce(p_reason, ''));
  end if;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._tournament_audit(p_id, 'remove_player', jsonb_build_object('player', p_player, 'reason', p_reason));
  end if;
  return n > 0;
end;
$fn$;

create function public.finish_tournament(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; open_n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state <> 'running' or t.current_round < t.rounds then raise exception 'unsettled pairings remain'; end if;
  select count(*) into open_n from public.tournament_pairings tp
   where tp.tournament_id = p_id and tp.round = t.current_round
     and not public._pairing_counts(tp.state, tp.final_at);
  if open_n > 0 then raise exception 'unsettled pairings remain'; end if;
  update public.tournaments set state = 'complete' where id = p_id;
  perform public._tournament_audit(p_id, 'finish', '{}');
  return true;
end;
$fn$;

-- >>> PASTE, from Step 1, the CURRENT share_a_live_match(uuid, uuid) as
-- `create or replace function ...`, adding ONE more arm to its boolean:
--     or exists (
--       select 1 from public.tournament_pairings tp
--         join public.tournaments t on t.id = tp.tournament_id
--        where t.state = 'running' and tp.round = t.current_round
--          and tp.player_b is not null
--          and tp.state in ('pending', 'reported', 'disputed')
--          and ((tp.player_a = a and tp.player_b = b) or (tp.player_a = b and tp.player_b = a)))
-- Nothing else changes; the function stays revoked from clients. <<<

create policy "a tournament opponent may read your friend code during the round"
  on public.friend_codes for select to authenticated
  using (
    exists (
      select 1 from public.tournament_pairings tp
        join public.tournaments t on t.id = tp.tournament_id
       where t.state = 'running' and tp.round = t.current_round
         and tp.player_b is not null and tp.state in ('pending', 'reported', 'disputed')
         and ((tp.player_a = friend_codes.profile_id and tp.player_b = (select auth.uid()))
           or (tp.player_b = friend_codes.profile_id and tp.player_a = (select auth.uid())))
    )
  );

do $g$
declare f text;
begin
  foreach f in array array[
    'start_round(uuid,jsonb,boolean,boolean)', 'report_score(uuid,smallint,smallint)',
    'confirm_score(uuid)', 'dispute_score(uuid)', 'settle_pairing(uuid,smallint,smallint,text)',
    'drop_out(uuid)', 'remove_player(uuid,uuid,text)', 'finish_tournament(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$g$;
```

Replace the `>>> PASTE … <<<` block with the real SQL from Step 1 (delete the marker text). The committed migration must contain no marker text.

- [ ] **Step 5: Apply and run**

Run: `cd app && npx vitest run --config vitest.db.config.ts ../supabase/tests/tournament_rounds.test.ts ../supabase/tests/tournaments.test.ts ../supabase/tests/channels.test.ts ../supabase/tests/challenges.test.ts ../supabase/tests/social.test.ts`
Expected: PASS except the 5 known environmental social failures. Then the whole db suite once.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930000100_tournament_rounds.sql supabase/tests/tournament_rounds.test.ts
git commit -m "feat(db): tournament rounds, reporting, judging, and reaching your opponent

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure Swiss pairing and standings

**Files:**
- Create: `app/src/tournament/swiss.ts`
- Test: `app/src/tournament/__tests__/swiss.test.ts`

**Interfaces:**
- Produces:
  - `interface Game { round: number; a: string; b: string | null; scoreA: number; scoreB: number }` (`b === null` is a bye for `a`)
  - `interface Standing { id: string; matches: number; matchWins: number; gameWins: number; gameLosses: number; omw: number; gwp: number; hadBye: boolean; opponents: string[] }`
  - `standings(ids: readonly string[], games: readonly Game[]): Standing[]` — sorted best first
  - `interface Pairing { a: string; b: string | null }`
  - `pairSwiss(active: readonly string[], games: readonly Game[], seed: string): { pairs: Pairing[]; rematches: number }`
  - `defaultRounds(players: number): number` — `max(1, ceil(log2(players)))`
  - `countedGames(pairings, now)` is in Task 4 (`lib/tournaments.ts`); this module only sees finished `Game`s.
- Rules: match win = more games; equal scores (0–0 double loss) give no win to either; a bye is a match win and a 2–0 in the player's own game record but is excluded from opponents' OMW; OMW and GWP floor at 1/3; tiebreak order: match wins, OMW, GWP, head-to-head, id. Round 1 shuffles by `seed`; later rounds pair adjacent players in rank order, refusing rematches, with the bye going to the lowest-ranked player without one.

- [ ] **Step 1: Write the failing tests** — `swiss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defaultRounds, pairSwiss, standings, type Game } from '../swiss';

const g = (round: number, a: string, b: string | null, scoreA: number, scoreB: number): Game =>
  ({ round, a, b, scoreA, scoreB });
const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

describe('defaultRounds', () => {
  it('is ceil(log2 N), at least 1', () => {
    expect(defaultRounds(2)).toBe(1);
    expect(defaultRounds(8)).toBe(3);
    expect(defaultRounds(9)).toBe(4);
    expect(defaultRounds(26)).toBe(5);
    expect(defaultRounds(1)).toBe(1);
  });
});

describe('standings', () => {
  it('ranks by match wins, then opponent match-win %, then game-win %', () => {
    const games = [g(1, 'a', 'b', 2, 0), g(1, 'c', 'd', 2, 1), g(2, 'a', 'c', 2, 0), g(2, 'b', 'd', 0, 2)];
    const s = standings(['a', 'b', 'c', 'd'], games);
    // a is 2-0. c and d are both 1-1, but c's opponents (d at 1/2, a at 1) average
    // 0.75 OMW against d's (c at 1/2, b floored at 1/3) 0.417, so c ranks above d.
    expect(s.map((x) => x.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(s[0]).toMatchObject({ matchWins: 2, matches: 2, gameWins: 4, gameLosses: 0 });
  });
  it('counts a bye as a win and a 2-0 for the player, but not toward anyone\'s OMW', () => {
    const s = standings(['a', 'b', 'c'], [g(1, 'a', null, 2, 0), g(1, 'b', 'c', 2, 0)]);
    const a = s.find((x) => x.id === 'a')!;
    expect(a).toMatchObject({ matchWins: 1, gameWins: 2, hadBye: true, opponents: [] });
    expect(a.omw).toBeCloseTo(1 / 3);
  });
  it('floors OMW and GWP at one third', () => {
    const s = standings(['a', 'b'], [g(1, 'a', 'b', 2, 0)]);
    const b = s.find((x) => x.id === 'b')!;
    expect(b.gwp).toBeCloseTo(1 / 3);
    expect(b.omw).toBeGreaterThanOrEqual(1 / 3);
  });
  it('a 0-0 double loss gives nobody a match win', () => {
    const s = standings(['a', 'b'], [g(1, 'a', 'b', 0, 0)]);
    expect(s.every((x) => x.matchWins === 0 && x.matches === 1)).toBe(true);
  });
  it('breaks a full tie by head-to-head, then by id, deterministically', () => {
    const games = [g(1, 'a', 'b', 2, 1), g(1, 'c', 'd', 2, 1), g(2, 'a', 'c', 1, 2), g(2, 'b', 'd', 2, 1)];
    const first = standings(['a', 'b', 'c', 'd'], games).map((x) => x.id);
    const again = standings(['d', 'c', 'b', 'a'], games).map((x) => x.id);
    expect(first).toEqual(again);
  });
  it('ignores games naming players it was not given', () => {
    expect(() => standings(['a'], [g(1, 'a', 'zz', 2, 0)])).not.toThrow();
  });
});

describe('pairSwiss', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

  it('round 1 pairs everyone once, deterministically for a seed, differently across seeds', () => {
    const a = pairSwiss(ids(8), [], 'seed-1');
    const b = pairSwiss(ids(8), [], 'seed-1');
    const c = pairSwiss(ids(8), [], 'seed-2');
    expect(a).toEqual(b);
    expect(a.pairs).toHaveLength(4);
    expect(new Set(a.pairs.flatMap((p) => [p.a, p.b])).size).toBe(8);
    expect(JSON.stringify(a.pairs)).not.toBe(JSON.stringify(c.pairs));
    expect(a.rematches).toBe(0);
  });

  it('an odd field gets exactly one bye, given to a player who has not had one', () => {
    const r1 = pairSwiss(ids(5), [], 's');
    expect(r1.pairs.filter((p) => p.b === null)).toHaveLength(1);
    const byeR1 = r1.pairs.find((p) => p.b === null)!.a;
    const games: Game[] = r1.pairs.map((p) => (p.b === null ? g(1, p.a, null, 2, 0) : g(1, p.a, p.b, 2, 0)));
    const r2 = pairSwiss(ids(5), games, 's');
    const byeR2 = r2.pairs.find((p) => p.b === null)!.a;
    expect(byeR2).not.toBe(byeR1);
  });

  it('never repeats a pairing over a full Swiss when it is avoidable', () => {
    for (const n of [4, 6, 8, 10, 16]) {
      const players = ids(n);
      const games: Game[] = [];
      const played = new Set<string>();
      for (let round = 1; round <= defaultRounds(n); round++) {
        const { pairs, rematches } = pairSwiss(players, games, `t${n}`);
        expect(rematches).toBe(0);
        for (const p of pairs) {
          if (p.b === null) { games.push(g(round, p.a, null, 2, 0)); continue; }
          const k = key(p.a, p.b);
          expect(played.has(k)).toBe(false);
          played.add(k);
          games.push(g(round, p.a, p.b, round % 2 ? 2 : 0, round % 2 ? 0 : 2));
        }
      }
    }
  });

  it('pairs winners with winners: after round 1, the two unbeaten meet in a 4-player field', () => {
    const games = [g(1, 'p01', 'p02', 2, 0), g(1, 'p03', 'p04', 2, 1)];
    const { pairs } = pairSwiss(['p01', 'p02', 'p03', 'p04'], games, 's');
    const top = pairs.find((p) => [p.a, p.b].includes('p01'))!;
    expect([top.a, top.b].sort()).toEqual(['p01', 'p03']);
  });

  it('falls back to a rematch, and says how many, when no fresh pairing exists', () => {
    // three players, everyone has played everyone: the fallback must still pair the field
    const games = [g(1, 'a', 'b', 2, 0), g(2, 'b', 'c', 2, 0), g(3, 'a', 'c', 2, 0)];
    const r = pairSwiss(['a', 'b', 'c'], games, 's');
    expect(r.pairs.filter((p) => p.b !== null)).toHaveLength(1);
    expect(r.rematches).toBeGreaterThanOrEqual(1);
  });

  it('handles the empty and one-player fields', () => {
    expect(pairSwiss([], [], 's')).toEqual({ pairs: [], rematches: 0 });
    expect(pairSwiss(['a'], [], 's').pairs).toEqual([{ a: 'a', b: null }]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd app && npx vitest run src/tournament/__tests__/swiss.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement** `app/src/tournament/swiss.ts` (no React, no browser API — it must run under Node):

```ts
// Swiss pairing and standings. Pure and isomorphic: the same code pairs a round
// in the organiser's browser and (later) verifies one under Node.
//
// ponytail: adjacent-in-rank DFS with a node budget, not a true Dutch/Burstein
// system. Ceiling: it never repeats a pairing when one exists within the
// budget, but it does not minimise score-group floaters optimally. Upgrade to
// a matching-based pairer if organisers report ugly pairings.

export interface Game { round: number; a: string; b: string | null; scoreA: number; scoreB: number }
export interface Standing {
  id: string; matches: number; matchWins: number; gameWins: number; gameLosses: number;
  omw: number; gwp: number; hadBye: boolean; opponents: string[];
}
export interface Pairing { a: string; b: string | null }

const FLOOR = 1 / 3;
const GAMES_TO_WIN = 2;
const NODE_BUDGET = 50_000;

export const defaultRounds = (players: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(1, players))));

export function standings(ids: readonly string[], games: readonly Game[]): Standing[] {
  const by = new Map<string, Standing>(
    ids.map((id) => [id, { id, matches: 0, matchWins: 0, gameWins: 0, gameLosses: 0, omw: FLOOR, gwp: FLOOR, hadBye: false, opponents: [] }]),
  );
  for (const g of games) {
    const A = by.get(g.a);
    if (!A) continue;
    A.matches++;
    if (g.b === null) { A.hadBye = true; A.matchWins++; A.gameWins += GAMES_TO_WIN; continue; }
    const B = by.get(g.b);
    if (!B) { A.matches--; continue; }
    B.matches++;
    A.opponents.push(g.b); B.opponents.push(g.a);
    A.gameWins += g.scoreA; A.gameLosses += g.scoreB;
    B.gameWins += g.scoreB; B.gameLosses += g.scoreA;
    if (g.scoreA > g.scoreB) A.matchWins++;
    else if (g.scoreB > g.scoreA) B.matchWins++;
  }
  const rate = (id: string) => { const o = by.get(id)!; return Math.max(FLOOR, o.matches ? o.matchWins / o.matches : 0); };
  for (const s of by.values()) {
    s.omw = s.opponents.length ? s.opponents.reduce((n, id) => n + rate(id), 0) / s.opponents.length : FLOOR;
    const gt = s.gameWins + s.gameLosses;
    s.gwp = gt ? Math.max(FLOOR, s.gameWins / gt) : FLOOR;
  }
  const h2h = (x: string, y: string) => {
    let r = 0;
    for (const g of games) {
      if (g.b === null) continue;
      if (g.a === x && g.b === y) r += Math.sign(g.scoreA - g.scoreB);
      if (g.a === y && g.b === x) r += Math.sign(g.scoreB - g.scoreA);
    }
    return r;
  };
  return [...by.values()].sort(
    (p, q) =>
      q.matchWins - p.matchWins || q.omw - p.omw || q.gwp - p.gwp ||
      h2h(q.id, p.id) - h2h(p.id, q.id) || p.id.localeCompare(q.id),
  );
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function solve(order: string[], played: ReadonlySet<string>, budget: { n: number }): Pairing[] | null {
  if (order.length === 0) return [];
  const [first, ...rest] = order;
  for (let i = 0; i < rest.length; i++) {
    if (played.has(pairKey(first, rest[i]))) continue;
    if (--budget.n < 0) return null;
    const next = solve(rest.filter((_, j) => j !== i), played, budget);
    if (next) return [{ a: first, b: rest[i] }, ...next];
  }
  return null;
}

function greedy(order: string[]): Pairing[] {
  const out: Pairing[] = [];
  for (let i = 0; i + 1 < order.length; i += 2) out.push({ a: order[i], b: order[i + 1] });
  return out;
}

export function pairSwiss(
  active: readonly string[], games: readonly Game[], seed: string,
): { pairs: Pairing[]; rematches: number } {
  if (active.length === 0) return { pairs: [], rematches: 0 };
  const played = new Set(games.filter((g) => g.b !== null).map((g) => pairKey(g.a, g.b as string)));
  let order: string[];
  let byeCandidates: string[];
  if (games.length === 0) {
    const rnd = mulberry32(hash(seed));
    order = [...active].sort();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    byeCandidates = [...order].reverse();
  } else {
    const ranked = standings(active, games);
    order = ranked.map((s) => s.id);
    const noBye = ranked.filter((s) => !s.hadBye).map((s) => s.id).reverse();
    byeCandidates = noBye.length ? noBye : [...order].reverse();
  }

  const odd = order.length % 2 === 1;
  const candidates = odd ? byeCandidates : [null];
  for (const bye of candidates) {
    const rest = bye === null ? order : order.filter((id) => id !== bye);
    const pairs = solve(rest, played, { n: NODE_BUDGET });
    if (pairs) return { pairs: bye === null ? pairs : [...pairs, { a: bye, b: null }], rematches: 0 };
  }
  // No fresh pairing exists (or the budget ran out): pair adjacent in rank and report the rematches.
  const bye = odd ? candidates[0] : null;
  const rest = bye === null ? order : order.filter((id) => id !== bye);
  const pairs = greedy(rest);
  const rematches = pairs.filter((p) => p.b !== null && played.has(pairKey(p.a, p.b as string))).length;
  return { pairs: bye === null ? pairs : [...pairs, { a: bye as string, b: null }], rematches };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/tournament/__tests__/swiss.test.ts && npx tsc -b && npx oxlint`
Expected: PASS. Two of the tests constrain the algorithm (`pairs winners with winners`, `never repeats`); if one fails, fix the algorithm, do not loosen the test. Also confirm the module imports nothing from React or `window` (`grep -n "react\|window\|document" app/src/tournament/swiss.ts` → no output).

- [ ] **Step 5: Commit**

```bash
git add app/src/tournament
git commit -m "feat(tournament): pure Swiss pairing and standings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Roster model, and the tournament client layer

**Files:**
- Create: `app/src/tournament/roster.ts`, `app/src/lib/tournaments.ts`
- Test: `app/src/tournament/__tests__/roster.test.ts`, `app/src/lib/__tests__/tournaments.test.ts`

**Interfaces:**
- Produces (`roster.ts`, pure):
  - `interface RosterMember { ref: string; fast: string; charges: string[]; cp: number; bestBuddy: boolean }`
  - `ROSTER_SIZE = 6`
  - `cpBounds(ref: string, bestBuddy: boolean): { min: number; max: number }`
  - `leagueCap(league: LeagueId): number | null` (1500 / 2500 / null)
  - `toBuilds(roster: readonly RosterMember[]): Build[]`
  - `checkRoster(roster: readonly RosterMember[], format: Format, league: LeagueId): { ok: boolean; problems: string[] }`
  - `memberFromChoice(choice: AddPokemonChoice, cp: number, bestBuddy: boolean): RosterMember`
- Produces (`lib/tournaments.ts`):
  - Types `TournamentState = 'draft' | 'registration' | 'closed' | 'running' | 'complete' | 'cancelled'`, `Tournament`, `Entrant`, `PairingState`, `Pairing` (row shape mirrors the SQL: `id, round, tableNo, playerA, playerB, scoreA, scoreB, state, reportedBy, reportedAt, finalAt, note`), `AuditRow`.
  - `effectiveState(t: Tournament, now: Date): TournamentState` — `'registration'` with a passed `registrationClosesAt` reads as `'closed'`.
  - `isCounted(p: Pairing, now: Date): boolean` — the counting rule.
  - `toGames(pairings: Pairing[], now: Date): Game[]` — counted pairings as `Game`s.
  - RPC wrappers (each throws `Error(message)` on failure): `createTournament`, `updateTournament`, `openRegistration`, `closeRegistration`, `cancelTournament`, `registerRoster`, `withdrawFromTournament`, `grantJudge`, `revokeJudge`, `startRound`, `reportScore`, `confirmScore`, `disputeScore`, `settlePairing`, `dropOut`, `removePlayer`, `finishTournament`.
  - Readers: `listTournaments(): Promise<Tournament[]>` (newest first, limit 100), `getTournament(id): Promise<Tournament | null>`, `listEntrants(id): Promise<Entrant[]>`, `listPairings(id): Promise<Pairing[]>`, `listRosters(id): Promise<Map<string, RosterMember[]>>` (RLS decides; empty before close), `listJudges(id): Promise<string[]>`, `listAudit(id): Promise<AuditRow[]>`.
- Consumes: `supabase`, `Format`, `validateTeam`, `speciesOf`, `CPM`/`BB_MAX_LEVEL_IDX`/`MAX_LEVEL_IDX`, `AddPokemonChoice`, `Game` (Task 3), `resolveDisplayNames`.

- [ ] **Step 1: Write the failing tests.**
`roster.test.ts` (uses real species data): `cpBounds` — min 10; max for `azumarill` equals the CP at 15/15/15 and level 50, and with `bestBuddy` true the level-51 CP, which is strictly larger; cross-check against the engine: for three species, `cpBounds(ref, false).max` equals `getEntry(ref, {a:15,d:15,s:15}, 'master', false).entry.cp` (read `engine.getEntry` first; if its signature or field names differ, adapt the test and say so). `leagueCap`. `checkRoster`: a legal six for a Great `Format` from `resolvePool` returns ok; five members → problem naming the count; unknown ref; a fast move not in the species' `fastMoves`; a charge not in `chargeMoves`; zero or three charges; non-integer CP; CP below 10; CP above the species' bound; CP above the league cap (Great 1500); Best Buddy on with CP under the cap is fine; a ref illegal in the format's pool is reported (via `validateTeam`); a duplicate-species roster violates `uniqueSpecies` when the format says so; every problem is human text naming the member's position ("Slot 3: …"). `memberFromChoice` maps `AddPokemonChoice` (fast by index, charges ids) to a member; `toBuilds` maps to `Build`.
`tournaments.test.ts` (mock supabase with the `vi.hoisted` client pattern of `lib/__tests__/matchmaking.test.ts`): `effectiveState` (registration + past close → closed; future close → registration; other states unchanged); `isCounted` (settled true; reported with `finalAt` past true, future false, null false; pending/disputed false); `toGames` includes only counted pairings, maps a bye (`playerB null`) to `b: null`, and leaves scores as given; each RPC wrapper calls `rpc(name, params)` with exactly the SQL parameter names (`p_id`, `p_title`, `p_description`, `p_format_version`, `p_rounds`, `p_round_minutes`, `p_max_players`, `p_closes_at`, `p_roster`, `p_tournament`, `p_pairings`, `p_force`, `p_override`, `p_pairing`, `p_score_a`, `p_score_b`, `p_note`, `p_user`, `p_player`, `p_reason`) and throws the server message on error; `listRosters` groups rows by player and returns an empty map on no rows; readers map snake_case to camelCase.

- [ ] **Step 2: Run to verify failure** — FAIL, modules not found.

- [ ] **Step 3: Implement.** `roster.ts`:

```ts
import type { Build, Format } from '../rules';
import { validateTeam } from '../rules';
import type { LeagueId } from '../lib/types';
import type { AddPokemonChoice } from '../components/AddPokemonModal';
import { speciesOf } from '../lib/data';
import { CPM, MAX_LEVEL_IDX, BB_MAX_LEVEL_IDX } from '../lib/cpm';

export const ROSTER_SIZE = 6;

export interface RosterMember { ref: string; fast: string; charges: string[]; cp: number; bestBuddy: boolean }

const cpAt = (atk: number, def: number, hp: number, cpm: number) =>
  Math.max(10, Math.floor((atk * Math.sqrt(def) * Math.sqrt(hp) * cpm * cpm) / 10));

/** The CP range a form can show: the floor, and the CP of a perfect 15/15/15 at
 *  level 50 (51 with Best Buddy). Loose on purpose — the organiser judges. */
export function cpBounds(ref: string, bestBuddy: boolean): { min: number; max: number } {
  const s = speciesOf(ref);
  if (!s) return { min: 10, max: 10 };
  const idx = bestBuddy ? BB_MAX_LEVEL_IDX : MAX_LEVEL_IDX;
  return { min: 10, max: cpAt(s.atk + 15, s.def + 15, s.hp + 15, CPM[idx]) };
}

export const leagueCap = (league: LeagueId): number | null =>
  league === 'great' ? 1500 : league === 'ultra' ? 2500 : null;

export const toBuilds = (roster: readonly RosterMember[]): Build[] =>
  roster.map((m) => ({ ref: m.ref, fast: m.fast, charges: [...m.charges] }));

export function memberFromChoice(choice: AddPokemonChoice, cp: number, bestBuddy: boolean): RosterMember {
  const s = speciesOf(choice.ref);
  return {
    ref: choice.ref,
    fast: s?.fastMoves[choice.fastIdx]?.id ?? '',
    charges: [...choice.chargeIds],
    cp,
    bestBuddy,
  };
}

export function checkRoster(
  roster: readonly RosterMember[], format: Format, league: LeagueId,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (roster.length !== ROSTER_SIZE) problems.push(`A roster is exactly ${ROSTER_SIZE} Pokémon (you have ${roster.length}).`);
  const cap = leagueCap(league);
  roster.forEach((m, i) => {
    const at = `Slot ${i + 1}`;
    const s = speciesOf(m.ref);
    if (!s) { problems.push(`${at}: unknown Pokémon.`); return; }
    if (!s.fastMoves.some((f) => f.id === m.fast)) problems.push(`${at}: ${s.name} does not learn that fast move.`);
    if (m.charges.length < 1 || m.charges.length > 2) problems.push(`${at}: pick one or two charged moves.`);
    for (const c of m.charges) {
      if (!s.chargeMoves.some((x) => x.id === c)) problems.push(`${at}: ${s.name} does not learn ${c}.`);
    }
    if (!Number.isInteger(m.cp)) { problems.push(`${at}: CP must be a whole number.`); return; }
    const { min, max } = cpBounds(m.ref, m.bestBuddy);
    if (m.cp < min) problems.push(`${at}: CP is below ${min}.`);
    else if (m.cp > max) problems.push(`${at}: ${s.name} cannot reach CP ${m.cp}.`);
    if (cap !== null && m.cp > cap) problems.push(`${at}: CP ${m.cp} is over the ${cap} cap.`);
  });
  if (roster.length === ROSTER_SIZE) {
    for (const v of validateTeam(toBuilds(roster), format).violations) {
      problems.push(`Format: ${describeViolation(v)}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function describeViolation(v: { kind: string } & Record<string, unknown>): string {
  // Read rules/types.ts `Violation` and give each kind a sentence; the default
  // arm keeps an unmapped kind from being silent.
  return `${v.kind}${'ref' in v ? ` (${String(v.ref)})` : ''}`;
}
```

Write `describeViolation` fully against the real `Violation` union in `rules/types.ts` (one plain sentence per `kind`, exhaustive `switch`), and add a test that each kind produces a sentence that is not just the kind name. Verify `CPM`/`MAX_LEVEL_IDX`/`BB_MAX_LEVEL_IDX` semantics in `lib/cpm.ts` before relying on `atk`/`def`/`hp` — if `Species.atk/def/hp` are not the raw base stats the CP formula wants, use the engine's own CP for the perfect spread (`getEntry`) instead and make the cross-check test the source of truth.

`lib/tournaments.ts`: types and wrappers as listed. Row mappers convert snake_case (`organiser_id`, `format_version_id`, `registration_closes_at`, `round_ends_at`, `current_round`, `table_no`, `player_a`, …). `effectiveState`, `isCounted`, `toGames`:

```ts
export function effectiveState(t: Tournament, now: Date): TournamentState {
  return t.state === 'registration' && t.registrationClosesAt && new Date(t.registrationClosesAt) <= now
    ? 'closed' : t.state;
}
export function isCounted(p: Pairing, now: Date): boolean {
  return p.state === 'settled' || (p.state === 'reported' && !!p.finalAt && new Date(p.finalAt) <= now);
}
export function toGames(pairings: readonly Pairing[], now: Date): Game[] {
  return pairings.filter((p) => isCounted(p, now)).map((p) => ({
    round: p.round, a: p.playerA, b: p.playerB, scoreA: p.scoreA ?? 0, scoreB: p.scoreB ?? 0,
  }));
}
```

RPC wrappers follow the `createChallenge`/`declineChallenge` pattern in `lib/challenges.ts` (read it): `supabase.rpc(name, params)`, `if (error) throw new Error(error.message)`.

- [ ] **Step 4: Run to verify pass** — `cd app && npx vitest run src/tournament src/lib/__tests__/tournaments.test.ts && npx tsc -b && npx oxlint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/tournament app/src/lib/tournaments.ts app/src/lib/__tests__/tournaments.test.ts
git commit -m "feat(tournament): roster model and the tournament client layer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Tournaments screen — browse, create, and the route

**Files:**
- Modify: `app/src/state/AppState.tsx` (`Screen` += `'tournaments'`; `activeTournamentId: string | null`, default `null`), `app/src/lib/screens.ts`, `app/src/lib/route.ts`, `app/src/App.tsx`, `app/src/styles/components.css`
- Create: `app/src/screens/TournamentsScreen.tsx`, `app/src/state/useTournaments.ts`
- Test: `app/src/screens/__tests__/tournaments-screen.test.tsx`; update `lib/__tests__/screens.test.ts`, `route.test.ts`

**Interfaces:**
- Consumes: `listTournaments`, `createTournament`, `openRegistration`, `effectiveState` (Task 4); `listServerFormats`/`SavedFormat` (own formats); `useAppState`, `useSession`, `LEAGUE_BY_ID`.
- Produces:
  - `Screen` includes `'tournaments'`; `SCREEN_DEFS` gains `{ id: 'tournaments', label: 'Tournaments', kicker: 'Events', glyph: '⚑', hue: 'var(--type-rock)', blurb: 'Host a Swiss event or join one, six Pokémon a side.' }` (`--type-rock` exists in `styles/types.css`; the distinct-hue test guards uniqueness); `SECTIONS.play.screens` becomes `['matchmaking', 'match', 'friends', 'chat', 'tournaments']`.
  - `hashFor('tournaments') === '#/play/tournaments'`; **`#/play/tournaments/<uuid>` round-trips**: add `tournamentIdFromHash(hash: string): string | null` and `hashForTournament(id: string): string` to `route.ts`; `screenFromHash` maps the deep link to `'tournaments'`; `AppStateProvider` keeps `activeTournamentId` in sync with the hash (hash → state on load and `hashchange`; state → hash when it changes), the same way it already syncs `screen`.
  - `<TournamentsScreen />` — when `state.activeTournamentId` is set it renders `<TournamentScreen id=… />` (Task 6, imported lazily; until then render a placeholder `panel` that names the id so this task is testable alone); otherwise the browse view.

- [ ] **Step 1: Write the failing tests.** `screens.test.ts`: Play is `['matchmaking','match','friends','chat','tournaments']`. `route.test.ts`: `hashFor('tournaments')`; `tournamentIdFromHash('#/play/tournaments/3f2b…')` returns the uuid, `'#/play/tournaments'` and garbage return null; `screenFromHash('#/play/tournaments/<uuid>') === 'tournaments'`; `hashForTournament(id)` round-trips. `tournaments-screen.test.tsx` (mock `lib/tournaments` and `lib/saves`): browse lists tournaments as cards with title, state chip (uses `effectiveState`: a registration past its close time shows "Registration closed"), league name, player count if provided by the list mapper (add `entrants: number` via a count embed `tournament_entrants(count)` in `listTournaments` — extend Task 4's reader and test), and "Round N of M" when running; filter buttons All / Open / Live / Finished (`aria-pressed`); clicking a card sets `activeTournamentId` and the hash; a "Host a tournament" button opens the create form (a dialog like `ChallengeSheet`: title, description, format `<select>` of the user's own formats whose `composition.size === 6` — none → helper text pointing to Formats, rounds (default `defaultRounds(16)` = 4, 1–12), round length minutes (default 25), max players (default 64), optional registration close `datetime-local`); Create calls `createTournament({...})` then, if "Open registration now" is ticked (default on), `openRegistration(id)`, then navigates to the new tournament; a server refusal shows in `role="alert"` and leaves the form open; signed out shows a sign-in prompt in place of "Host a tournament" (browse still works).

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** per the interfaces. `useTournaments()` polls `listTournaments` every 30s while mounted (live guard, failed read keeps the last answer; the same shape as `useBadges`). Cards are `<button>`s reusing the HUD card classes used by `PokemonCard`/route cards; state chip text: Draft (host only) / Registration open / Registration closed / Round N of M / Finished / Cancelled, each also carrying a hue via `--tab-hue`-style custom property from the type palette (colour is never the only carrier: the chip has the text). Add to `App.tsx`: the lazy `TournamentsScreen` case. CSS: `.tournament-card`, `.tournament-chip`, `.tournament-filter`, tokens only (grep each custom property; `npm run tokens`). Update the landing test expectations only if they hard-code the Play card count (they derive from `SECTIONS`).

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/screens/__tests__/tournaments-screen.test.tsx src/lib/__tests__/screens.test.ts src/lib/__tests__/route.test.ts src/screens/__tests__/landing-featured.test.tsx src/components/__tests__/section-rail.test.tsx src/screens/__tests__/app-shell.test.tsx && npx tsc -b && npm run tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(tournament): browse and host on a new Tournaments screen

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: One tournament — the page, registration and the roster form

**Files:**
- Create: `app/src/screens/TournamentScreen.tsx`, `app/src/state/useTournament.ts`, `app/src/components/tournament/RosterForm.tsx`, `RosterCard.tsx`, `RoundClock.tsx`
- Modify: `app/src/screens/TournamentsScreen.tsx` (render `TournamentScreen`), `app/src/styles/components.css`
- Test: `app/src/screens/__tests__/tournament-screen.test.tsx`, `app/src/components/tournament/__tests__/roster-form.test.tsx`, `roster-card.test.tsx`, `round-clock.test.tsx`, `app/src/state/__tests__/useTournament.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`getTournament`, `listEntrants`, `listPairings`, `listRosters`, `listJudges`, `registerRoster`, `withdrawFromTournament`, `effectiveState`, `RosterMember`, `checkRoster`, `memberFromChoice`, `cpBounds`, `leagueCap`), `AddPokemonModal`, `Sprite`, `TypeBadge`, `resolveDisplayNames`, `listServerFormats`… actually the tournament's OWN format: read via `format_versions` by `format_version_id` (readable by everyone once non-draft — Task 1): add `getTournamentFormat(id): Promise<{ name: string; format: Format } | null>` to `lib/tournaments.ts` (`select rules, formats(name)` from `format_versions`), with a test.
- Produces:
  - `useTournament(id): { tournament, entrants, pairings, rosters, judges, names, me, state, refresh, error }` — polls every 15s (10s while running and the viewer has a pending pairing), live guard, failed read keeps last data, `names: Map<string,string>` from `resolveDisplayNames`, `state = effectiveState(tournament, now)` re-derived each render.
  - `<RoundClock endsAt={string | null} />` — "Time until round end" `hh:mm:ss` counting down from `endsAt`, ticking once per second only while mounted and while `endsAt` is in the future, `00:00:00` after; display only.
  - `<RosterCard member entrant name record onRemove? />` and the roster card visual: sprite (`Sprite`), species name with `(Shadow)` for `_shadow` refs, the three moves with their type icons (`TypeBadge`/move type), a CP line, badges "Shadow" and "Best Buddy" (text badges), plus a hide/show toggle prop for the viewer's own team.
  - `<RosterForm tournament format league initial onSaved onCancel />` — six slots; each slot is empty or shows the member with Edit/Clear; an "Add Pokémon" opens `AddPokemonModal` (existing; `league` prop; ignore its IV controls — take `ref`, `fastIdx`, `chargeIds`), then a small inline step asks for **CP** (number input, min/max from `cpBounds`, cap from `leagueCap`) and a **Best Buddy** checkbox; live `checkRoster` problems listed under the slots; "Import a saved team" fills slots from `listTeams(6)` (league-matching) using each `StoredMember` (`ref`, `fast_move`, `charge_moves`; CP prompted for each, defaulting to the league cap or species max); Save calls `registerRoster(id, roster)` only when `checkRoster(...).ok`; errors in `role="alert"`.
- Page layout (`TournamentScreen`): header (title, "Hosted by …" with judges via names, chips "Swiss Bracket" and "Round length: N minutes", format name, league); a state banner — Registration open (with closes time), Registration closed / "Teams of Pokémon Visible" (matching the screenshots' wording), Running "Round N of M", Finished, Cancelled; for a running round the `RoundClock`; the ONE primary action for the viewer: not entered + registration open + not full → "Register" (opens the form); entered + registration open → "Edit roster" and "Withdraw"; entered + running with a live pairing → "View your matchup" (Task 8); signed out → sign-in prompt; **Share tournament page** copies `${location.origin}/${hashForTournament(id)}` with a "Copied" confirmation and a fallback when `navigator.clipboard` is absent; "See your Pokémon" / "Hide Pokémon" toggle for the viewer's own roster (display only, default shown); a `tabs` strip (Bracket, Standings, Players — placeholders here, filled by Task 7) and a host panel slot (Task 9).

- [ ] **Step 1: Write the failing tests.**
`round-clock.test.tsx` (fake timers): counts down each second; shows `00:00:00` after the end and stops its interval; a `null` end shows "—"; cleans up on unmount; announces nothing per tick (no aria-live spam — the container has no live region). `roster-card.test.tsx`: renders name, `(Shadow)` for `_shadow`, both move sets, CP, badges only when true, hides moves/CP when `hidden`. `roster-form.test.tsx` (mock `AddPokemonModal` to a stub that commits a choice, `registerRoster`, `listTeams`): six slots; adding a member requires a CP within bounds (out-of-range disables Add with the bound in text); Best Buddy raises the max; duplicate species violating the format shows the format problem; Save disabled until six legal members; Save calls `registerRoster(id, roster)` with exactly the six `RosterMember`s; server error shown, form stays; import-from-saved-team fills six slots and prompts CP; editing an existing roster starts from `initial`. `useTournament.test.tsx`: polls at 15s, stops on unmount, keeps last data on a failed read, derives the effective state from the clock (registration past close → closed without a refetch). `tournament-screen.test.tsx` (mock the hook via the provider-free module mock): the banner text per state; the ONE primary action per viewer/state combination (table-driven: signed out, not entered/open, entered/open, entered/closed, entered/running with a live pairing, not entered/running, host); Register opens the form; Withdraw calls `withdrawFromTournament` after `window.confirm`; Share writes the link to the clipboard and shows "Copied", and the fallback path when the clipboard is missing shows the link text; See/Hide toggles the viewer's own card contents; rosters of other players are NOT rendered before close even if the mock returns them (the UI trusts RLS but must not leak if a stale map slips through: gate on `state` too).

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** per the interfaces and layout. Reuse `AddPokemonModal`, `Sprite`, `TypeBadge` and the `chat`/`challenge` sheet dialog pattern for the form (focus in on mount, restore on close, Escape closes). Keep effects idempotent (StrictMode). CSS: `.tournament-page`, `.tournament-banner` (+ `.tone-*`), `.roster-card`, `.roster-form`, `.round-clock`, tokens only; `npm run tokens`.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/screens/__tests__/tournament-screen.test.tsx src/components/tournament src/state/__tests__/useTournament.test.tsx src/lib/__tests__/tournaments.test.ts && npx tsc -b && npx oxlint && npm run tokens`
Expected: PASS, pristine output (no act() warnings from new tests).

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(tournament): the tournament page, registration and the six-slot roster form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Bracket, standings and players views

**Files:**
- Create: `app/src/components/tournament/Bracket.tsx`, `Standings.tsx`, `PlayersTab.tsx`
- Modify: `app/src/screens/TournamentScreen.tsx` (mount the three tabs), `app/src/styles/components.css`
- Test: `app/src/components/tournament/__tests__/bracket.test.tsx`, `standings.test.tsx`, `players-tab.test.tsx`

**Interfaces:**
- Consumes: `Pairing`, `Entrant`, `RosterMember`, `isCounted`, `toGames`, `standings` (Task 3), `RosterCard`, `names` map, `useTournament` output.
- Produces:
  - `<Bracket pairings names rounds currentRound me query onOpen? now />` — one column per played round ("Round 1" …), numbered tables, each table showing both players with their game scores; header "R / N Rounds" and a player count; an opponent **search** box that filters tables by player name (case-insensitive) and highlights matches; the viewer's own tables carry a "You" mark. Results: winner row gets a `✓` mark and the type-palette "win" token, loser row a `✗` and "loss" token and struck-through name (as in the screenshots), unplayed/pending rows neutral, `reported` rows show the score with a "reported" tag until counted, `disputed` rows a "disputed" tag; a bye row reads "Bye". **The result is carried by the mark and text, never by colour alone.**
  - `<Standings entrants names pairings now />` — a table from `standings(activeIds, toGames(pairings, now))`: rank, name, match record (W–L), OMW %, GWP %; dropped players shown last with "dropped".
  - `<PlayersTab entrants rosters names state isHost me onRemove pairings now />` — roster cards like the screenshots: name, a record chip "Wins: W (OMW-ish) - Losses: L", six sprite tiles with their three moves, Shadow / Best Buddy / CP; before close it shows only the viewer's own card and "Teams are hidden until registration closes"; host-only "Remove player" (calls `onRemove(playerId)`, confirmed with `window.confirm`); a dropped player's name is struck through.

- [ ] **Step 1: Write the failing tests.** `bracket.test.tsx`: columns equal rounds played; table numbers; winner/loser marks (`✓`/`✗`) and `aria-label`s like "Alice won 2–0 against Bob"; the loser's name has the strike class; search filters tables and clears; the viewer's tables show "You"; a bye row; `reported` shows "reported" until `finalAt` passes then reads as decided (drive `now`); `disputed` tag; header "3 / 5 Rounds" and "26 Players"; empty tournament shows "No pairings yet". `standings.test.tsx`: order matches `standings()` (a fixed fixture with a known answer worked out in the test, not derived by calling the same function), percentages formatted, dropped last, only counted games count. `players-tab.test.tsx`: before close, only my card and the hidden notice; after close, all cards with sprites and moves; records match the counted games; Remove appears only for the host, asks to confirm, calls `onRemove`; dropped struck through.

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement.** Use tokens for win/loss (existing `--type-*` hues or the app's success/danger tokens — grep `--color-` names in `themes.css` and pick the existing semantic ones; add none). Table layout is CSS grid with `min-width: 0` children, one column per round with horizontal scroll INSIDE the bracket container only (the page must not gain a horizontal scrollbar at 375px). `aria-label`s on result rows; the search input labelled. Keep each component under ~200 lines; split helpers into the same file if needed.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/components/tournament src/screens/__tests__/tournament-screen.test.tsx && npx tsc -b && npx oxlint && npm run tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(tournament): bracket, standings and players views

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Your matchup — reporting, confirming, disputing, and reaching your opponent

**Files:**
- Create: `app/src/components/tournament/MatchupPanel.tsx`
- Modify: `app/src/screens/TournamentScreen.tsx`, `app/src/styles/components.css`
- Test: `app/src/components/tournament/__tests__/matchup-panel.test.tsx`

**Interfaces:**
- Consumes: `Pairing`, `reportScore`, `confirmScore`, `disputeScore` (Task 4); `RosterCard`; `opponentFriendCode` (`lib/matchmaking`); `openDm` (`lib/channels`); `useChatDockRequest().requestChannel`; `ChallengeSheet` (from plan B) for "Challenge to a friendly rematch"? — NO: do not add that; out of scope.
- Produces: `<MatchupPanel pairing me tournament rosters names now onChanged />` — shown for the viewer's pairing in the CURRENT round: both rosters side by side (yours left, opponent's right; both readable because registration is closed), the opponent's friend code with a "Copy" button (from `opponentFriendCode(opponentId)`; "No friend code shared" if null; a quiet alert on error), "Message <name>" (`openDm(opponentId)` then `requestChannel(channelId)`), `RoundClock`, and the score control:
  - `pending`: four score buttons (`2–0`, `2–1`, `1–2`, `0–2`, framed from the viewer's side: "I won 2–0" etc.; the component converts to `scoreA/scoreB` using whether the viewer is `playerA`) — "Report result".
  - `reported` by me: shows what I reported and "Waiting for <name> to confirm — final at HH:MM unless disputed"; I may correct it (re-open the four buttons).
  - `reported` by the opponent: shows their reported score, "Confirm" and "Dispute" buttons, and the finality time.
  - `disputed`: "Disputed — the organiser or a judge will settle it" and no actions.
  - `settled`: the final score, no actions. A bye shows "You have a bye this round."
  - After every action call `onChanged()` (the screen refreshes).

- [ ] **Step 1: Write the failing tests** (mock `lib/tournaments`, `lib/matchmaking.opponentFriendCode`, `lib/channels.openDm`, the dock context): each pairing state × viewer role above; the four buttons map to the right `(scoreA, scoreB)` when the viewer is player A AND when the viewer is player B (assert `reportScore('p', 2, 0)` vs `reportScore('p', 0, 2)` for "I won 2–0"); Confirm calls `confirmScore`, Dispute asks `window.confirm` then calls `disputeScore`; errors show in `role="alert"` and the buttons re-enable; friend-code copy uses the clipboard with a fallback that shows the digits; "Message" opens the DM (mock returns a channel id) and requests it; a stale-response guard when the opponent changes between rounds (deferred promises: the previous opponent's friend code never shows beside the new name); a bye renders the bye text and no controls.

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**; mount in `TournamentScreen` under the primary action's "View your matchup" (a section that scrolls into view/expands, not a route). Keep it one component with small internal sub-render functions; tokens only.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/components/tournament/__tests__/matchup-panel.test.tsx src/screens/__tests__/tournament-screen.test.tsx && npx tsc -b && npx oxlint && npm run tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(tournament): your matchup — report, confirm, dispute, reach your opponent

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The host panel

**Files:**
- Create: `app/src/components/tournament/HostPanel.tsx`
- Modify: `app/src/screens/TournamentScreen.tsx`, `app/src/styles/components.css`
- Test: `app/src/components/tournament/__tests__/host-panel.test.tsx`

**Interfaces:**
- Consumes: `updateTournament`, `openRegistration`, `closeRegistration`, `cancelTournament`, `startRound`, `settlePairing`, `removePlayer`, `finishTournament`, `grantJudge`, `revokeJudge`, `listAudit`; `pairSwiss`, `standings`, `toGames`, `isCounted`, `defaultRounds` (Task 3/4); `names`; `searchProfiles`? — judges are chosen from **entrants** (a `<select>` of entrants who are not already judges) to avoid a profile search; a free profile search is deferred.
- Produces: `<HostPanel tournament state entrants pairings names judges isOrganiser now onChanged />` — visible to the organiser and judges (judges see everything except judge management, cancel and finish). Sections, each only when it applies:
  1. **Lifecycle:** registration open → "Close registration" (organiser; enabled when ≥ 2 entrants, with the reason as text otherwise); closed → "Start round 1"; running → "Progress bracket round" (computes `pairSwiss(activeIds, toGames(pairings, now), seed)` with `seed = tournament.id`, shows a **confirm dialog with the proposed pairings and any `rematches` count**, then calls `startRound(id, pairs)`; if the current round has un-counted pairings the button says "Progress anyway (N unsettled)" and passes `force = true` after a `window.confirm` naming N); after the last round with everything counted → "Finish tournament" (organiser). A rematch-forced pairing passes `override = true` only when the organiser ticks "Allow rematches" in the dialog.
  2. **Needs attention** (running, after `round_ends_at` has passed): the list of un-counted pairings of the current round — pending (no report), reported-not-final, disputed — each with "Award <A> the win", "Award <B> the win" (2–0) and "Double loss" (0–0), and a free score picker for exact results; each calls `settlePairing(pairingId, a, b, note)` with an optional note field; disputed ones are listed first with the reporter named.
  3. **Judges** (organiser): the list with Revoke, and "Appoint judge" from entrants.
  4. **Details** (draft/registration): edit title, description, round length, max players, closes-at (`updateTournament`).
  5. **Audit log** (collapsed): the last 50 `listAudit` rows as "actor · action · time" lines with the key `detail` values in plain text.
  6. **Danger:** "Cancel tournament" (organiser, confirmed).
- All buttons `disabled` while a call is in flight; errors in `role="alert"`; after any success call `onChanged()`.

- [ ] **Step 1: Write the failing tests.** Table-driven visibility (organiser vs judge vs entrant vs nobody: an entrant/stranger gets NO panel); lifecycle button per state; Close registration disabled with the text "At least two players are needed" under 2; "Progress bracket round" builds pairs with `pairSwiss` and shows them in a confirm dialog BEFORE calling `startRound` (assert `startRound` not called until confirmed, then called with `(id, pairs, false, false)`); unsettled pairings change the label and pass `force = true`; rematch fallback shows the count and the tick box, `override` only when ticked; needs-attention appears only after `round_ends_at`, lists disputed first, and each action calls `settlePairing` with the exact scores (`2,0`, `0,2`, `0,0`); a judge sees Needs attention but not Judges / Cancel / Finish; Appoint calls `grantJudge`; Revoke calls `revokeJudge`; edit form calls `updateTournament` only with changes and is hidden once running; audit renders rows; Cancel confirms then calls `cancelTournament`; failures shown and buttons re-enabled; a round already counted shows no "needs attention".

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement.** Keep the panel to sub-components in one file per section if it passes ~250 lines (`HostLifecycle`, `NeedsAttention`, `JudgePanel`, `AuditLog` in the same folder). The pairing preview dialog reuses the dialog pattern (focus in/restore, Escape). Tokens only.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/components/tournament src/screens/__tests__/tournament-screen.test.tsx && npx tsc -b && npx oxlint && npm run tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(tournament): host panel — lifecycle, pairing preview, judging, audit

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Notifications, badges and hash routing polish

**Files:**
- Modify: `app/src/lib/notifications.ts`, `app/src/state/useNotifications.ts` (or `NotificationsContext.tsx`), `app/src/lib/badges.ts`, `app/src/state/useBadges.ts`, `app/src/lib/tournaments.ts` (add `myTournamentActivity()`)
- Test: extend `lib/__tests__/notifications.test.ts`, `badges.test.ts`, `tournaments.test.ts`; `state/__tests__/useNotifications.test.tsx`

**Interfaces:**
- `myTournamentActivity(): Promise<{ tournaments: Tournament[]; pairings: Pairing[] }>` — the tournaments the viewer is an entrant/organiser/judge of that are `registration|closed|running`, and the viewer's own CURRENT-round pairings in the running ones (RLS decides; entrants via `tournament_entrants`).
- `Notice.kind` gains `'round' | 'report' | 'attention'`; `buildNotices` input gains `tournaments` and `pairings`: **round** — a running tournament where the viewer has a current-round pairing that is `pending` (id `tr:<pairingId>`, "Round N: you play <opponent>", target screen `tournaments` with `activeTournamentId`); **report** — a pairing where the opponent reported and the viewer must confirm/dispute (`tp:<pairingId>`); **attention** — for organisers/judges of a running tournament past `round_ends_at` with un-counted pairings (`ta:<tournamentId>:<round>`, "N pairings need attention"). `Notice.target` gains an optional `tournamentId`; bell/toast click sets `activeTournamentId` and `screen: 'tournaments'`.
- `computeBadges(friends, offers, me, unreadChannels?, liveRounds?: number)` adds `tournaments` when `liveRounds > 0` (count of pending/needs-report items); `useBadges` passes it from the shared notifications (do NOT add another poll: read from `NotificationsContext`, or extend its single poll to include `myTournamentActivity()`).

- [ ] **Step 1: Write the failing tests:** one case per new notice rule (round notice only for `pending`; none for a bye or for settled; report notice only when the OTHER player reported; attention notice only for run-authority viewers after `round_ends_at` with un-counted pairings; none for entrants), stable ids, ordering (attention/challenge/confirm/report/round before friend before message — state the order in the test), the `fresh` backlog rule still holds (first load no toasts), target carries `tournamentId`, badge appears only when `liveRounds > 0`, signed-out returns nothing, and the poll count: **one** `myTournamentActivity` call per poll interval regardless of how many consumers (bell, toaster, badges).

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** by extending the single existing poll in `useNotifications` (add `myTournamentActivity()` to its `Promise.all`; failed reads keep the last answer). Follow the existing patterns exactly.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/lib/__tests__/notifications.test.ts src/lib/__tests__/badges.test.ts src/state/__tests__/useNotifications.test.tsx src/components/__tests__/notification-bell.test.tsx src/lib/__tests__/tournaments.test.ts src/screens/__tests__/app-shell.test.tsx && npx tsc -b && npx oxlint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(tournament): round, report and attention notices, and the Tournaments badge

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Real-stack roundtrip, browser verification, gates, handoff

**Files:**
- Create: `app/tools/m5-tournament-roundtrip.ts`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: The roundtrip script.** Read `app/tools/m4-challenges-roundtrip.ts` and `m3b-roundtrip.ts` fully first (bot creation/confirmation, run-stamped emails, importing the SHIPPING modules, cleanup, the row-count census, the guard that refuses to act when others' rows are pending). Never re-implement client logic. Five to six throwaway bots, all deleted at the end; the user's rows are never touched. Through `lib/tournaments.ts`, `tournament/swiss.ts`, `tournament/roster.ts` and `lib/challenges.ts`/`lib/channels.ts` only, print PASS/FAIL for each and exit non-zero on any FAIL:
  1. Host saves a private six-format (shipping `saveServerFormat`), `createTournament`, `openRegistration`; a stranger sees it; 5 bots `registerRoster` with rosters from `checkRoster`-valid six.
  2. Secrecy: before close, bot A reads only its own roster and the host reads none; after `closeRegistration`, every member reads all five and a non-entrant reads none.
  3. Round 1 via `pairSwiss` over the entrants, `startRound`; the bye (odd field) is settled 2–0; a repeated bye/rematch call is refused.
  4. Two live opponents can `openDm` each other and read each other's friend code with no friendship; a non-opponent cannot; a blocked pair cannot.
  5. Reporting: A reports, B confirms → settled; another pairing: reported then time-travel `final_at` into the past through the admin client (state that is the only admin use besides verification/cleanup) → counted; a dispute is settled by the host with an audit row holding the previous score; a judge granted by the host can settle, cannot grant.
  6. `startRound` refused with unsettled pairings, accepted with `p_force` (audited); play all rounds; `finishTournament` refused while unsettled, accepted after; `standings()` over `toGames(listPairings)` ranks the bots and matches a hand-computed expectation for the fixed scores the script feeds in.
  7. `dropOut` mid-tournament forfeits the pending pairing and excludes the player from the next `pairSwiss`/`startRound`.
  8. Anonymous client refused on `create_tournament`, `register_roster`, `start_round`, `report_score`.
  9. Census: table sizes before and after are identical for the user's data; the script deletes every tournament it created (cascade) and the bots.
  Run it against the running local stack (NEVER `db:reset`); force nothing the m4 script does not already do; every check must print PASS.

- [ ] **Step 2: Drive the UI in the browser** (`mcp__Claude_Browser__*`; dev server from the worktree with local Supabase env values read from the main checkout's `.env.local`, never printed; two bot accounts on `localhost:5180` and `127.0.0.1:5180` for separate sessions). Measure with `javascript_tool`, don't eyeball; the pane closes dropdowns between calls (open-and-measure in ONE call); reload after `resize_window`; screenshots only at scroll 0. Verify: host creates a tournament from the form and it appears in Browse; two players register through the six-slot form (CP out of range disables Save); Register/Edit/Withdraw behave; the banner text per state; teams hidden to the host before close and visible after (read the DOM); Start round shows the pairing preview and creates the bracket; the bracket has one column per round and the marks (✓/✗) as text; a player reports, the other confirms, the bracket updates within the poll; a dispute appears in the host's needs-attention list after the deadline (set `round_ends_at` in the past through the admin client and say so); the notification bell and toast fire for "you play <opponent>"; the Tournaments rail item badge; **layout:** at 1440 the tabs and roster cards do not overlap, at 375 (after reload) `documentElement.scrollWidth <= clientWidth` on Browse, Tournament and Bracket; deep link `#/play/tournaments/<id>` loads that tournament fresh; Share copies the same link. Report anything you could not drive; do not infer.

- [ ] **Step 3: Gates.** `cd app && npm run check` must pass. Run the db vitest suite once: the ONLY failures allowed are the 5 known environmental `social.test.ts` ones; list them; never delete the user's friendship row.

- [ ] **Step 4: Handoff.** In `docs/superpowers/HANDOFF.md` add a Tournaments row and a "Where this session left off — <date> (tournaments)" section: what shipped; the five rulings at the top of this plan verbatim; the legality-is-client-side caveat; the migration names (`20260930000000_tournaments.sql`, `20260930000100_tournament_rounds.sql`) and the deploy note (pushing to main is a production DB deploy; additive; the coordinator needs no redeploy; frontend must not go live before the migrations apply — the app reads new tables); the deferred list; the environmental `check:db` caveat; known issues found during verification.

- [ ] **Step 5: Commit**

```bash
git add app/tools/m5-tournament-roundtrip.ts docs/superpowers/HANDOFF.md
git commit -m "docs(handoff): tournaments built; m5 roundtrip

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
