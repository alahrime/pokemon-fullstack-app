-- A challenge goes to one friend, who accepts or declines; there is no wait for the coordinator to verify the
-- format first. A live challenge becomes a match the moment it is accepted, and the match carries the rules hash the
-- proposer claimed. Offers with no target (the public board) are still verified before they can be accepted.
-- Signatures and grants are unchanged, so no revoke/grant is repeated.

CREATE OR REPLACE FUNCTION public.accept_offer(p_offer uuid, p_team jsonb, p_data_rev text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.match_offers;
  taker uuid := (select auth.uid());
  new_match uuid;
begin
  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
  if p_team is null then raise exception 'you must supply the team you are accepting with'; end if;
  if p_data_rev is null then raise exception 'you must supply the data build you are accepting on'; end if;
  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
  -- told the offer is taken. Skipping would tell them "no such offer", a
  -- different and misleading answer.
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
  -- A challenge is addressed to one friend and is not played on the strength of the coordinator's check: it needs no
  -- verification (the format is only agreed between the two of them). Every other offer still does.
  if o.verified_hash is null and o.target_id is null then raise exception 'this offer has not been verified yet'; end if;
  if o.target_id is not null then
    if o.target_id <> taker then raise exception 'this offer is not open to you'; end if;
  elsif o.visibility <> 'public' then
    raise exception 'this offer is not open to you';
  end if;
  -- Last among the checks, deliberately. Every check above is about the offer
  -- and is the same answer for everyone; this is the only one that is about
  -- the ACCEPTER, so someone on a stale build is told the offer was fine and
  -- they are not, rather than being told the offer is unavailable.
  --
  -- `is distinct from`, not `<>`: a null on either side must REFUSE, and `<>`
  -- against a null evaluates to null, which an `if` treats as false and falls
  -- straight through into creating the match.
  if p_data_rev is distinct from o.data_rev then
    raise exception 'this offer was made on a different data build than yours';
  end if;

  if o.scheduled_for is null then
    -- Live: agreeing is playing. One confirmation is the whole handshake, and
    -- the taker's own team — not an empty roster — is what they play the
    -- match on.
    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (o.proposer_id, taker, o.format_version_id, coalesce(o.verified_hash, o.claimed_hash), o.team, p_team,
       o.data_rev, gen_random_uuid()::text, 'offer')
    returning id into new_match;
    update public.match_offers
       set state = 'converted', accepted_by = taker, accepted_team = p_team, accepted_at = now(),
           confirmed_at = now(), match_id = new_match
     where id = p_offer;
    return new_match;
  end if;

  -- Scheduled: one-sided acceptance is not a match. The proposer must confirm
  -- inside the window or this lapses. The team is captured now, at acceptance
  -- time, because it is the taker's own write and confirm_offer() runs as the
  -- proposer, who has no roster of the taker's to supply.
  --
  -- Nothing stores the taker's `data_rev`, and nothing needs to: the check
  -- above has established it EQUALS `o.data_rev`, which the column already
  -- holds. So confirm_offer() needs no new check either — a taker cannot end
  -- up confirmed on a build they did not accept on without accepting again.
  update public.match_offers
     set state = 'accepted', accepted_by = taker, accepted_team = p_team, accepted_at = now()
   where id = p_offer;
  return null;
end;
$function$;

create or replace function public.confirm_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  me uuid := (select auth.uid());
  new_match uuid;
begin
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
  if o.accepted_by is null then raise exception 'the person who accepted this offer no longer exists'; end if;

  -- team_b is the roster the taker accepted with, captured by accept_offer()
  -- into accepted_team — the proposer confirming does not get to supply it.
  -- play_after = o.scheduled_for: null for a live offer (matches the old
  -- behaviour), the agreed play time for a scheduled one.
  insert into public.matches
    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source, play_after)
  values
    (o.proposer_id, o.accepted_by, o.format_version_id, coalesce(o.verified_hash, o.claimed_hash), o.team, o.accepted_team,
     o.data_rev, gen_random_uuid()::text, 'offer', o.scheduled_for)
  returning id into new_match;
  update public.match_offers
     set state = 'converted', confirmed_at = now(), match_id = new_match
   where id = p_offer;
  return new_match;
end;
$$;
