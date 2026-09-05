-- confirm_offer() (20260903011151_confirm_offer_guards_deleted_taker.sql, DEPLOYED
-- TO PRODUCTION — not editable in place) inserts the new match at HANDSHAKE
-- CONFIRMATION time. For a SCHEDULED offer that is not the same instant as the
-- time the two players agreed to play: match_offers.scheduled_for can be days
-- after confirmed_at, and until now `matches` had no column that remembered
-- it. sweep_matches() judged every match's age from created_at alone, so a
-- match confirmed Monday to be played Friday would be swept to 'unverified'
-- on Wednesday — before either side had a chance to play it, let alone
-- report — after which submit_report() refuses ("this match is no longer
-- accepting reports") and the opponent's friend code is no longer visible.
--
-- Fixed by carrying the offer's scheduled_for onto the new match's
-- play_after column (added in 20260905124000, unmerged, so sweep_matches()
-- in 20260905124200 can already fall back to coalesce(play_after,
-- created_at)). accept_offer() (20260904071717_accept_offer_agrees_on_the_data_build.sql,
-- also deployed) only ever inserts a match on the LIVE branch, where
-- scheduled_for is null by construction ("agreeing is playing") — so that
-- path needs no change: its match's play_after is simply null, same as a
-- queue match, and sweep_matches() already falls back to created_at for
-- both. confirm_offer() is the only function that creates a match from an
-- offer that can carry a real scheduled_for, so it is the only one that
-- needs replacing here.
--
-- `create or replace function` preserves the existing grants (checked:
-- pg_proc.proacl for confirm_offer already excludes public/anon), so this
-- migration does not need to repeat the revoke/grant pair from
-- 20260903005933.
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
    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, o.accepted_team,
     o.data_rev, gen_random_uuid()::text, 'offer', o.scheduled_for)
  returning id into new_match;
  update public.match_offers
     set state = 'converted', confirmed_at = now(), match_id = new_match
   where id = p_offer;
  return new_match;
end;
$$;
