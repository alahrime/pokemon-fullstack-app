-- M4b: your own records. A view, not counters: win rate and unique opponents are
-- computed over history. security_invoker so the matches/match_rounds/profiles
-- policies apply to the CALLER; the auth.uid() filter is belt and braces, and
-- keeps the view from ever listing someone else's matches to a role that bypasses RLS.
create view public.my_match_records with (security_invoker = true) as
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
  r.mine > r.theirs as won
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

revoke all on public.my_match_records from public, anon, authenticated;
grant select on public.my_match_records to authenticated;
