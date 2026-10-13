-- Rosters without IVs. A match, a challenge and a public offer all show the
-- other side's Pokémon and moves, and that is the point of showing them; their
-- IVs (and the level and Best Buddy that follow from them) are not, since
-- knowing a spread is an edge in the battle itself. Until now every roster
-- column was readable whole by both players (and an offer's by anyone it was
-- shown to), so hiding the numbers on screen alone would hide nothing.
--
-- Each roster gets a generated twin with those keys removed, and signed-in
-- users lose SELECT on the originals. The functions that need full spreads
-- (accept_offer, confirm_offer, pair_queue_entries) are SECURITY DEFINER and
-- the coordinator uses the service role, so neither is affected. anon is left
-- alone: RLS already returns it no rows, and revoking would turn those empty
-- reads into errors.
create or replace function public._team_public(p jsonb) returns jsonb
language sql immutable as $$
  -- Only objects carry a spread; anything else (a malformed member, a non-array) passes through as it is.
  select case when jsonb_typeof(p) is distinct from 'array' then p else (
    select coalesce(jsonb_agg(case when jsonb_typeof(m) = 'object'
                                   then m - 'iv_attack' - 'iv_defense' - 'iv_stamina' - 'level' - 'best_buddy' else m end
                              order by i), '[]'::jsonb)
      from jsonb_array_elements(p) with ordinality e(m, i)) end
$$;
revoke all on function public._team_public(jsonb) from public, anon;
grant execute on function public._team_public(jsonb) to authenticated;

alter table public.matches
  add column team_a_public jsonb generated always as (public._team_public(team_a)) stored,
  add column team_b_public jsonb generated always as (public._team_public(team_b)) stored;
alter table public.match_offers
  add column team_public jsonb generated always as (public._team_public(team)) stored,
  add column accepted_team_public jsonb generated always as (public._team_public(accepted_team)) stored;

revoke select on public.matches from authenticated;
grant select (id, player_a, player_b, format_version_id, rules_hash, data_rev, seed, rounds, state, source, created_at,
              rating_counted, amend_deadline, play_after, league, settled_at, team_a_public, team_b_public)
  on public.matches to authenticated;
revoke select on public.match_offers from authenticated;
grant select (id, proposer_id, format_version_id, claimed_hash, verified_hash, league, data_rev, visibility, scheduled_for,
              expires_at, accepted_by, accepted_at, confirmed_at, match_id, state, created_at, target_id,
              team_public, accepted_team_public)
  on public.match_offers to authenticated;

-- Records run as the caller, so they read the public twins (same ref and moves, which is all _team_view keeps).
create or replace view public.my_match_records with (security_invoker = true) as
select
  m.id as match_id,
  coalesce(m.settled_at, m.created_at) as played_at,
  m.league,
  m.source,
  (m.source = 'queue' and m.league in ('great', 'ultra', 'master')) as ranked,
  o.id as opponent_id,
  o.display_name as opponent_name,
  r.mine::integer as my_rounds,
  r.theirs::integer as opp_rounds,
  r.mine > r.theirs as won,
  public._team_view(case when m.player_a = (select auth.uid()) then m.team_a_public else m.team_b_public end) as my_team,
  public._team_view(case when m.player_a = (select auth.uid()) then m.team_b_public else m.team_a_public end) as opp_team
from public.matches m
join public.profiles o
  on o.id = case when m.player_a = (select auth.uid()) then m.player_b else m.player_a end
cross join lateral (
  select count(*) filter (where winner = (select auth.uid())) as mine,
         count(*) filter (where winner <> (select auth.uid())) as theirs
    from public.match_rounds where match_id = m.id
) r
where m.state = 'confirmed'
  and (select auth.uid()) in (m.player_a, m.player_b);
