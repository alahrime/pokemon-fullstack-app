-- A friend's free-match record, as totals only. Free matches stay private to
-- their two players (my_match_records is filtered to the caller); this opens
-- the aggregate — wins, losses, unique opponents — to the player themself and
-- to their accepted friends, never the matches, opponents or teams behind it.
-- Anyone else gets no row, which reads the same as "no such player".
create or replace function public.friend_record(p_user uuid)
returns table (wins integer, losses integer, opponents integer)
language sql stable security definer set search_path = public as $fn$
  with mine as (
    select m.id, case when m.player_a = p_user then m.player_b else m.player_a end as opp,
           count(*) filter (where r.winner = p_user) as w,
           count(*) filter (where r.winner <> p_user) as l
      from public.matches m
      join public.match_rounds r on r.match_id = m.id
     where m.state = 'confirmed' and p_user in (m.player_a, m.player_b)
     group by m.id
  )
  select t.* from (
    select count(*) filter (where w > l)::integer, count(*) filter (where w <= l)::integer, count(distinct opp)::integer
      from mine
  ) t
   where (select auth.uid()) = p_user
      or (public.are_friends((select auth.uid()), p_user) and not public.blocked_between((select auth.uid()), p_user))
$fn$;
revoke all on function public.friend_record(uuid) from public, anon;
grant execute on function public.friend_record(uuid) to authenticated;
