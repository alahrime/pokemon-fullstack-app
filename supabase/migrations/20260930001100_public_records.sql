-- Records and the Pokémon used.
--
-- 1. my_match_records now carries both teams, so a match record shows who played
--    what. Built key by key (ref, fast move, charge moves): matches.team_a/b also
--    hold IVs and a level, and the opponent's spread is not part of a record.
--    Free matches stay private to their two players: the view is still filtered
--    to the caller's own matches.
-- 2. Tournament rosters are readable by every signed-in user once registration is
--    closed (they were members-only), so a tournament's players and viewers can see
--    what everyone brought. Before close a roster is still its owner's alone, and a
--    cancelled-in-registration tournament is still not 'closed' (see
--    tournament_is_closed), so cancelling cannot open the rosters early.
create or replace function public._team_view(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', m ->> 'ref', 'fast', m ->> 'fast_move', 'charges', coalesce(m -> 'charge_moves', '[]'::jsonb))), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) m
$$;
-- The view is security_invoker, so this runs as the caller: authenticated needs EXECUTE.
-- It is pure (reads nothing), so the grant exposes nothing.
revoke all on function public._team_view(jsonb) from public, anon;
grant execute on function public._team_view(jsonb) to authenticated;

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
  public._team_view(case when m.player_a = (select auth.uid()) then m.team_a else m.team_b end) as my_team,
  public._team_view(case when m.player_a = (select auth.uid()) then m.team_b else m.team_a end) as opp_team
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

drop policy "a roster is its owner's until registration closes" on public.tournament_rosters;
create policy "a roster is its owner's until registration closes, then public"
  on public.tournament_rosters for select to authenticated
  using (player_id = (select auth.uid()) or public.tournament_is_closed(tournament_id));
