-- M4c: grit = how you do in the game right after a loss, across a tournament's
-- rounds. One row per player per counted, non-bye, decisive pairing; post_loss
-- means that player's previous such game in the same tournament was a loss (a bye
-- or a drawn round in between is skipped, because those rows are not emitted).
-- Internal: clients only ever reach it through my_grit().
create function public._grit_games() returns table (player_id uuid, tournament_id uuid, post_loss boolean, won boolean)
language sql stable security definer set search_path = public as $fn$
  with sides as (
    select p.tournament_id, p.round, p.player_a as player_id, p.score_a > p.score_b as won
      from public.tournament_pairings p join public.tournaments t on t.id = p.tournament_id
     where p.player_b is not null and p.score_a is not null and p.score_b is not null and p.score_a <> p.score_b
       and t.state in ('running', 'complete') and public._pairing_counts(p.state, p.final_at)
    union all
    select p.tournament_id, p.round, p.player_b, p.score_b > p.score_a
      from public.tournament_pairings p join public.tournaments t on t.id = p.tournament_id
     where p.player_b is not null and p.score_a is not null and p.score_b is not null and p.score_a <> p.score_b
       and t.state in ('running', 'complete') and public._pairing_counts(p.state, p.final_at)
  )
  select s.player_id, s.tournament_id,
         coalesce(lag(not s.won) over (partition by s.player_id, s.tournament_id order by s.round), false) as post_loss,
         s.won
    from sides s
$fn$;
revoke all on function public._grit_games() from public, anon, authenticated;

-- Your own grit, and the platform gate for showing it. The gate is an aggregate
-- (median post-loss sample among everyone who has any, floor 10); nothing about
-- any other player is returned.
create function public.my_grit()
returns table (post_loss_games integer, post_loss_wins integer, tournaments integer, gate integer)
language sql stable security definer set search_path = public as $fn$
  with g as (select * from public._grit_games()),
  per as (select player_id, count(*) as n from g where post_loss group by player_id)
  select
    (select count(*) from g where player_id = (select auth.uid()) and post_loss)::integer,
    (select count(*) from g where player_id = (select auth.uid()) and post_loss and won)::integer,
    (select count(distinct tournament_id) from g where player_id = (select auth.uid()) and post_loss)::integer,
    greatest(10, coalesce(ceil((select percentile_cont(0.5) within group (order by n) from per)), 0))::integer
   where (select auth.uid()) is not null
$fn$;
revoke all on function public.my_grit() from public, anon;
grant execute on function public.my_grit() to authenticated;
