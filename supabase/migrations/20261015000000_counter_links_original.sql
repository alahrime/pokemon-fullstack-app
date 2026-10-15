-- A counter remembers the challenge it answers, so both cards can say so. A counter used to be two client calls
-- (create a new challenge, then decline theirs); create_challenge() now does both in one transaction when given
-- p_counter_of, so a counter can no longer go out while the original stays open.

alter table public.match_offers
  add column counter_of uuid references public.match_offers (id) on delete set null;

-- SELECT on this table is granted column by column (20261013020000); both sides read the link.
grant select (counter_of) on public.match_offers to authenticated;

create index match_offers_counter_of_idx on public.match_offers (counter_of) where counter_of is not null;

-- Server-written like target_id: the owner policy from 20260930000200 with one more conjunct.
drop policy "an offer belongs to the person who proposed it" on public.match_offers;
create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check (
    (select auth.uid()) = proposer_id
    and verified_hash is null
    and accepted_by is null
    and accepted_team is null
    and accepted_at is null
    and confirmed_at is null
    and match_id is null
    and state = 'open'
    and target_id is null
    and counter_of is null
    and public.offer_format_allowed(format_version_id)
  );

-- create_challenge() as deployed (20260929000100) plus p_counter_of. The old seven-argument signature is dropped,
-- not overloaded: a call without p_counter_of resolves to this one through the default.
drop function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz);

create function public.create_challenge(
  p_target uuid,
  p_format_version uuid,
  p_claimed_hash text,
  p_league text,
  p_team jsonb,
  p_data_rev text,
  p_scheduled_for timestamptz default null,
  p_counter_of uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
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

  -- A counter answers an open challenge the target sent the caller, and declines it. Same sentence whether the
  -- offer is missing, someone else's, or already answered.
  if p_counter_of is not null then
    update public.match_offers set state = 'declined'
     where id = p_counter_of and proposer_id = p_target and target_id = me
       and state = 'open' and expires_at > now();
    if not found then raise exception 'that challenge can no longer be countered'; end if;
  end if;

  insert into public.match_offers
    (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev,
     visibility, scheduled_for, expires_at, counter_of)
  values
    (me, p_target, p_format_version, p_claimed_hash, p_league, p_team, p_data_rev,
     'private', p_scheduled_for, coalesce(p_scheduled_for, now() + interval '1 hour'), p_counter_of)
  returning id into offer;

  dm := public.open_dm(p_target);
  insert into public.messages (channel_id, author_id, body, kind, offer_id)
  values (dm, me, 'Challenge', 'challenge', offer);
  return offer;
end;
$fn$;

revoke all on function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz, uuid) to authenticated;
