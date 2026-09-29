-- Tournament hardening, after review of 20260930000000. Every function below is
-- its live definition (pg_get_functiondef) with only the change its comment
-- names; create or replace keeps the existing grants.

-- I1. The tournament arm counts only when the ORGANISER OWNS the format, the
-- same rule as the offer arm. Otherwise a stranger's tournament on a public
-- format would keep it readable to everyone after its owner made it private.
-- A tournament on someone else's public format is covered by the public policy.
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
               join public.format_versions v on v.id = t.format_version_id
               join public.formats f on f.id = v.format_id
              where t.format_version_id = p_version
                and f.owner_id = t.organiser_id
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
               join public.formats f on f.id = v.format_id
              where v.format_id = p_format
                and f.owner_id = t.organiser_id
                and t.state <> 'draft')
$function$;

-- I2. A member is EXACTLY { ref, fast, charges, cp, bestBuddy }: the roster is
-- read by every member after close, so an extra key (ivs) must never get in.
-- Strings are bounded.
create or replace function public._roster_shape_ok(p jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare m jsonb;
begin
  -- One test per IF, each null-safe: a missing key reads as null, `null or false`
  -- is null, and an IF on null is not taken, so an OR chain would pass it.
  if jsonb_typeof(p) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p) <> 6 then return false; end if;
  for m in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(m) <> 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(m)) <> 5 then return false; end if;
    if jsonb_typeof(m -> 'ref') is distinct from 'string' or length(m ->> 'ref') not between 1 and 64 then return false; end if;
    if jsonb_typeof(m -> 'fast') is distinct from 'string' or length(m ->> 'fast') not between 1 and 64 then return false; end if;
    if jsonb_typeof(m -> 'charges') is distinct from 'array' then return false; end if;
    if jsonb_array_length(m -> 'charges') not between 1 and 2 then return false; end if;
    if exists (select 1 from jsonb_array_elements(m -> 'charges') c
                where jsonb_typeof(c) <> 'string' or length(c #>> '{}') not between 1 and 64) then return false; end if;
    if jsonb_typeof(m -> 'cp') is distinct from 'number' then return false; end if;
    if (m ->> 'cp') !~ '^[0-9]{1,4}$' then return false; end if;
    if (m ->> 'cp')::int not between 10 and 6000 then return false; end if;
    if jsonb_typeof(m -> 'bestBuddy') is distinct from 'boolean' then return false; end if;
  end loop;
  return true;
end;
$function$;

-- M2 + M3. No judges on a draft (a judge could read the audit of a tournament
-- they cannot see), and the audit row is written only when a role was added.
create or replace function public.grant_judge(p_id uuid, p_user uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state = 'draft' then raise exception 'open registration before appointing judges'; end if;
  if not exists (select 1 from public.profiles where id = p_user) or p_user = t.organiser_id then
    raise exception 'that person cannot be made a judge';
  end if;
  insert into public.tournament_roles (tournament_id, user_id, granted_by)
  values (p_id, p_user, (select auth.uid())) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._tournament_audit(p_id, 'grant_judge', jsonb_build_object('user', p_user));
  end if;
  return true;
end;
$function$;

-- M2. The audit also follows the tournament's visibility.
alter policy "the audit is for those who run the event" on public.tournament_audit
  using (public.tournament_visible(tournament_id) and public.tournament_can_run(tournament_id));

-- M1. A draft answers like a missing tournament.
create or replace function public.withdraw_from_tournament(p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.state = 'draft' then return false; end if;
  if t.state <> 'registration'
     or (t.registration_closes_at is not null and t.registration_closes_at <= now()) then
    raise exception 'registration is closed';
  end if;
  delete from public.tournament_entrants where tournament_id = p_id and player_id = (select auth.uid());
  get diagnostics n = row_count;
  return n > 0;
end;
$function$;

-- M3. Backstop for register_roster's max(seed)+1.
alter table public.tournament_entrants
  add constraint tournament_entrants_seed_key unique (tournament_id, seed);
