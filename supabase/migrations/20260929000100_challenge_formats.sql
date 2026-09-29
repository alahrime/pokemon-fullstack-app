-- A challenge may be played on the proposer's OWN private format, and both
-- people in it must be able to read the terms. Nothing publishes the format:
-- it becomes readable only to the offer's target or taker, and only while an
-- offer on it was made by the format's owner.

-- Caller-scoped, like is_channel_member: the caller is always auth.uid(), so
-- this cannot be asked about anyone else's offers. SECURITY DEFINER because
-- the policies below would otherwise recurse (formats -> format_versions ->
-- formats) and because the check spans three RLS-protected tables.
--
-- Only offers whose PROPOSER OWNS the format count. match_offers' owner
-- policy does not check format ownership, so a client could post an offer on
-- someone else's private version id; that offer must expose nothing.
create function public.plays_format_version(p_version uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.match_offers o
      join public.format_versions v on v.id = o.format_version_id
      join public.formats f on f.id = v.format_id
     where o.format_version_id = p_version
       and f.owner_id = o.proposer_id
       and auth.uid() in (o.target_id, o.accepted_by)
  )
$fn$;

-- The same question for a format row: one of its versions is played on.
create function public.plays_format(p_format uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.match_offers o
      join public.format_versions v on v.id = o.format_version_id
      join public.formats f on f.id = v.format_id
     where v.format_id = p_format
       and f.owner_id = o.proposer_id
       and auth.uid() in (o.target_id, o.accepted_by)
  )
$fn$;

revoke all on function public.plays_format_version(uuid) from public, anon;
revoke all on function public.plays_format(uuid) from public, anon;
grant execute on function public.plays_format_version(uuid) to authenticated;
grant execute on function public.plays_format(uuid) to authenticated;

create policy "a version is readable by the other side of an offer on it"
  on public.format_versions for select
  to authenticated
  using (public.plays_format_version(id));

create policy "a format is readable by the other side of an offer on it"
  on public.formats for select
  to authenticated
  using (public.plays_format(id));

-- create_challenge() as deployed (20260929000000), with the public-only rule
-- replaced by "yours or public".
CREATE OR REPLACE FUNCTION public.create_challenge(p_target uuid, p_format_version uuid, p_claimed_hash text, p_league text, p_team jsonb, p_data_rev text, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := (select auth.uid());
  vis public.format_visibility;
  owner uuid;
  offer uuid;
  dm uuid;
begin
  if me is null then raise exception 'not signed in'; end if;

  -- One sentence for every reason, exactly as open_dm does: a caller that can
  -- tell "blocked" from "not friends" can enumerate blocks.
  if p_target is null or p_target = me
     or not exists (select 1 from public.profiles where id = p_target)
     or public.blocked_between(me, p_target)
     or not (public.are_friends(me, p_target) or public.share_a_live_match(me, p_target)) then
    raise exception 'that person cannot be challenged';
  end if;

  -- The caller's own format (private or not) or anyone's public one. The
  -- target reads a private one through plays_format_version(); someone else's
  -- private format is refused, so a challenge can never leak it.
  select f.visibility, f.owner_id into vis, owner
    from public.format_versions v join public.formats f on f.id = v.format_id
   where v.id = p_format_version;
  if not (owner = me or vis = 'public') or owner is null then
    raise exception 'a challenge needs a format you own or a public one';
  end if;

  if p_scheduled_for is not null and p_scheduled_for <= now() then
    raise exception 'a scheduled challenge cannot be in the past';
  end if;

  insert into public.match_offers
    (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev,
     visibility, scheduled_for, expires_at)
  values
    (me, p_target, p_format_version, p_claimed_hash, p_league, p_team, p_data_rev,
     'private', p_scheduled_for, coalesce(p_scheduled_for, now() + interval '1 hour'))
  returning id into offer;

  dm := public.open_dm(p_target);
  insert into public.messages (channel_id, author_id, body, kind, offer_id)
  values (dm, me, 'Challenge', 'challenge', offer);
  return offer;
end;
$function$;
