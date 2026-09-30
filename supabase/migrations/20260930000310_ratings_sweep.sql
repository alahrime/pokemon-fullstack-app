-- M4a: the sweep, the leaderboard, and the queue pairing learns `league`.
-- `matches` had no league, so canonical-league eligibility was underivable
-- (see the note in submit_report). New queue matches carry it from the entry;
-- earlier rows stay null and are never rated.

create or replace function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  a public.queue_entries;
  b public.queue_entries;
  paired integer := 0;
begin
  for a in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by created_at
     for update skip locked
  loop
    -- `a` may have already been consumed as somebody else's `b` earlier in
    -- this same loop.
    if not exists (select 1 from public.queue_entries where id = a.id) then
      continue;
    end if;

    select * into b from public.queue_entries q
     where q.verified_hash = a.verified_hash
       and q.league = a.league
       and q.data_rev = a.data_rev
       and q.user_id <> a.user_id
       and q.expires_at > now()
       and q.id <> a.id
       and not public.blocked_between(a.user_id, q.user_id)
     order by q.created_at
     limit 1
     for update skip locked;

    if not found then continue; end if;

    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source, league)
    values
      (a.user_id, b.user_id, a.format_version_id, a.verified_hash, a.team, b.team,
       a.data_rev, gen_random_uuid()::text, 'queue', a.league);

    delete from public.queue_entries where id in (a.id, b.id);
    paired := paired + 1;
  end loop;
  return paired;
end;
$fn$;

-- Re-emitted: there is no ACL to lean on in production (same reasoning as
-- 20260906002000).
revoke all on function public.pair_queue_entries() from public, anon, authenticated;
grant execute on function public.pair_queue_entries() to service_role;

create function public.sweep_ratings() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  m record; c record; ra public.ratings; rb public.ratings; na record; nb record;
  sid uuid; wa integer; wb integer; sa float8; done integer := 0;
begin
  -- One pass at a time. Only this function writes ratings, so holding this
  -- lock is also what makes the row updates below race-free.
  if not pg_try_advisory_xact_lock(hashtext('sweep_ratings')) then return 0; end if;
  select * into c from public.rating_constants();
  for m in
    select id, player_a, player_b, league, settled_at from public.matches
     where source = 'queue' and state = 'confirmed' and rated_at is null
       and league in ('great', 'ultra', 'master') and settled_at is not null
     order by settled_at, id limit 200
  loop
    begin
      select count(*) filter (where winner = m.player_a), count(*) filter (where winner = m.player_b)
        into wa, wb from public.match_rounds where match_id = m.id;
      if wa = wb then raise exception 'no decided winner'; end if;
      sid := public.season_for(m.settled_at);
      insert into public.ratings (season_id, league, user_id)
      values (sid, m.league, m.player_a), (sid, m.league, m.player_b) on conflict do nothing;
      select * into ra from public.ratings where season_id = sid and league = m.league and user_id = m.player_a;
      select * into rb from public.ratings where season_id = sid and league = m.league and user_id = m.player_b;
      sa := (wa > wb)::integer;
      select * into na from public.glicko2_update(ra.rating, ra.rd, ra.vol, array[rb.rating], array[rb.rd], array[sa], c.tau);
      select * into nb from public.glicko2_update(rb.rating, rb.rd, rb.vol, array[ra.rating], array[ra.rd], array[1 - sa], c.tau);
      update public.ratings set rating = na.rating, rd = na.rd, vol = na.vol, games = games + 1,
             wins = wins + sa::integer, updated_at = now()
       where season_id = sid and league = m.league and user_id = m.player_a;
      update public.ratings set rating = nb.rating, rd = nb.rd, vol = nb.vol, games = games + 1,
             wins = wins + (1 - sa)::integer, updated_at = now()
       where season_id = sid and league = m.league and user_id = m.player_b;
      update public.matches set rated_at = now() where id = m.id;
      done := done + 1;
    exception when others then
      -- ponytail: a poisoned match stays unrated and is retried each pass; it only costs a slot of the 200.
      raise warning 'sweep_ratings: match % skipped: %', m.id, sqlerrm;
    end;
  end loop;
  return done;
end;
$fn$;

create function public.leaderboard(p_season uuid, p_league text, p_limit integer default 100)
returns table (pos bigint, user_id uuid, display_name text, rating integer, rd integer, games integer, wins integer)
language sql stable security definer set search_path = public as $$
  select rank() over (order by r.rating desc), r.user_id, p.display_name,
         round(r.rating)::integer, round(r.rd)::integer, r.games, r.wins
    from public.ratings r
    join public.profiles p on p.id = r.user_id
    cross join public.rating_constants() c
   where r.season_id = p_season and r.league = p_league
     and r.games >= c.min_games and r.rd <= c.max_rd
   order by 1, p.display_name
   limit least(greatest(p_limit, 1), 200)
$$;

revoke all on function public.sweep_ratings() from public, anon, authenticated;
revoke all on function public.leaderboard(uuid, text, integer) from public, anon;
grant execute on function public.leaderboard(uuid, text, integer) to authenticated;

-- Direct, not via the coordinator: no secrets, works once this migration applies.
select cron.schedule('sweep-ratings', '* * * * *', 'select public.sweep_ratings()');
