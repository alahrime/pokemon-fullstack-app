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
-- 'cancelled' is deliberately NOT closed: the organiser counts as a member once
-- closed, so a cancel during registration would otherwise open every roster to
-- the one person the secrecy rule is written against.
create function public.tournament_is_closed(p uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select t.state in ('closed', 'running', 'complete')
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

-- While a non-draft tournament references a format version, any signed-in user
-- may read that version and its format row: entrants must read the rules to
-- register. Both bodies are the live 20260929000100 definitions with one OR arm
-- added; create or replace keeps their grants (authenticated only).
create or replace function public.plays_format_version(p_version uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.match_offers o
      join public.format_versions v on v.id = o.format_version_id
      join public.formats f on f.id = v.format_id
     where o.format_version_id = p_version
       and f.owner_id = o.proposer_id
       and auth.uid() in (o.target_id, o.accepted_by)
  )
  or exists (select 1 from public.tournaments t
              where t.format_version_id = p_version
                and t.state <> 'draft')
$function$;

create or replace function public.plays_format(p_format uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.match_offers o
      join public.format_versions v on v.id = o.format_version_id
      join public.formats f on f.id = v.format_id
     where v.format_id = p_format
       and f.owner_id = o.proposer_id
       and auth.uid() in (o.target_id, o.accepted_by)
  )
  or exists (select 1 from public.tournaments t
               join public.format_versions v on v.id = t.format_version_id
              where v.format_id = p_format
                and t.state <> 'draft')
$function$;

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
  fmt_owner uuid; fmt_vis public.format_visibility; rules_json jsonb; new_id uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select f.owner_id, f.visibility, v.rules into fmt_owner, fmt_vis, rules_json
    from public.format_versions v join public.formats f on f.id = v.format_id
   where v.id = p_format_version;
  if fmt_owner is null or not (fmt_owner = me or fmt_vis = 'public') then
    raise exception 'a tournament needs a format you own or a public one';
  end if;
  if (rules_json -> 'composition' ->> 'size') is distinct from '6' then
    raise exception 'a tournament needs a format of six';
  end if;
  insert into public.tournaments
    (organiser_id, title, description, format_version_id, league, rounds, round_minutes,
     max_players, registration_closes_at)
  values
    (me, btrim(p_title), coalesce(p_description, ''), p_format_version, coalesce(rules_json ->> 'base', 'great'),
     p_rounds, coalesce(p_round_minutes, 25), coalesce(p_max_players, 64), p_closes_at)
  returning public.tournaments.id into new_id;
  perform public._tournament_audit(new_id, 'create', jsonb_build_object('format_version', p_format_version));
  return new_id;
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
  -- Past its close time the rosters are readable; moving the time would reopen
  -- editing after entrants have seen each other's teams.
  if t.state = 'registration' and t.registration_closes_at is not null and t.registration_closes_at <= now() then
    raise exception 'registration is closed';
  end if;
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
  -- One test per IF, each null-safe: a missing key reads as null, `null or false`
  -- is null, and an IF on null is not taken, so an OR chain would pass it.
  if jsonb_typeof(p) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p) <> 6 then return false; end if;
  for m in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(m) <> 'object' then return false; end if;
    if jsonb_typeof(m -> 'ref') is distinct from 'string' or m ->> 'ref' = '' then return false; end if;
    if jsonb_typeof(m -> 'fast') is distinct from 'string' or m ->> 'fast' = '' then return false; end if;
    if jsonb_typeof(m -> 'charges') is distinct from 'array' then return false; end if;
    if jsonb_array_length(m -> 'charges') not between 1 and 2 then return false; end if;
    if exists (select 1 from jsonb_array_elements(m -> 'charges') c
                where jsonb_typeof(c) <> 'string' or c #>> '{}' = '') then return false; end if;
    if jsonb_typeof(m -> 'cp') is distinct from 'number' then return false; end if;
    if (m ->> 'cp') !~ '^[0-9]{1,4}$' then return false; end if;
    if (m ->> 'cp')::int not between 10 and 6000 then return false; end if;
    if jsonb_typeof(m -> 'bestBuddy') is distinct from 'boolean' then return false; end if;
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
  if not found or t.state = 'draft' then raise exception 'registration is not open'; end if;
  if t.state <> 'registration'
     or (t.registration_closes_at is not null and t.registration_closes_at <= now()) then
    raise exception 'registration is closed';
  end if;
  if not public._roster_shape_ok(p_roster) then
    raise exception 'a roster is exactly six Pokémon, each with a species, a fast move, one or two charged moves, a CP and a Best Buddy flag';
  end if;
  select seed into sd from public.tournament_entrants where tournament_id = p_id and player_id = me;
  if sd is null then
    select count(*), coalesce(max(seed), 0) + 1 into n, sd
      from public.tournament_entrants where tournament_id = p_id;
    if n >= t.max_players then raise exception 'this tournament is full'; end if;
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
