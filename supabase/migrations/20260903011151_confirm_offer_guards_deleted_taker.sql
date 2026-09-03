-- confirm_offer() previously trusted that state = 'accepted' implied
-- accepted_by was a live player. It is not: accepted_by is
-- `on delete set null`, and the constraint added in the previous migration
-- is deliberately one-directional (accepted_by null implies nothing about
-- accepted_team), so a taker who accepted a scheduled offer and then deleted
-- their account leaves the offer sitting in 'accepted' with accepted_by
-- null and accepted_team still populated. Nothing about account deletion
-- touches state, and confirm_offer only checked state <> 'accepted' — so the
-- proposer, still inside the window, could reach the INSERT below with
-- accepted_by null, and matches.player_b is NOT NULL. The insert rolled
-- back, but the failure a client saw was a raw Postgres constraint
-- violation instead of a clean domain error.
--
-- Deliberately NOT also transitioning the offer to 'lapsed' here.
-- sweep_expired() already reaches this exact row once expires_at passes
-- (state in ('open', 'accepted')), so the terminal transition already has a
-- single, already-tested owner; having confirm_offer additionally mutate
-- state on this error path would duplicate that responsibility for no gain
-- — the window is time-bounded regardless, and a proposer who retries before
-- expiry just gets the same clean error again.
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
  insert into public.matches
    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
  values
    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, o.accepted_team,
     o.data_rev, gen_random_uuid()::text, 'offer')
  returning id into new_match;
  update public.match_offers
     set state = 'converted', confirmed_at = now(), match_id = new_match
   where id = p_offer;
  return new_match;
end;
$$;
