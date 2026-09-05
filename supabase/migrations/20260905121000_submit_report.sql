create or replace function public.submit_report(p_match_id uuid, p_wins text[])
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  m public.matches;
  me uuid := auth.uid();
  other_wins text[];
  i int;
begin
  -- The lock is the point. Two simultaneous submissions without it each read
  -- "the opponent has not reported" and each write 'reported', and a match on
  -- which both sides agreed sits unconfirmed forever.
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'no such match';
  end if;
  if me is null or me not in (m.player_a, m.player_b) then
    raise exception 'this match is not yours';
  end if;
  if m.state not in ('paired', 'reported', 'mismatch') then
    raise exception 'this match is no longer accepting reports';
  end if;
  if not public.is_valid_scoreline(m.rounds, p_wins) then
    raise exception 'that is not a possible best-of-% scoreline', m.rounds;
  end if;

  insert into public.match_reports (match_id, reporter_id, best_of, wins)
  values (p_match_id, me, m.rounds, p_wins)
  on conflict (match_id, reporter_id) do update
    set wins = excluded.wins,
        amended_at = now(),
        amend_count = public.match_reports.amend_count + 1;

  select wins into other_wins
    from public.match_reports
   where match_id = p_match_id and reporter_id <> me;

  if other_wins is null then
    update public.matches set state = 'reported' where id = p_match_id;
    return 'reported';
  end if;

  if other_wins = p_wins then
    -- Defensive, not reachable today: the state guard above only ever lets
    -- this branch run once per match (its allow-list excludes 'confirmed'),
    -- so match_rounds is always empty here. Kept so a future task that
    -- reopens a settled match for re-adjudication can't leave a stale round
    -- behind.
    delete from public.match_rounds where match_id = p_match_id;
    for i in 1..array_length(p_wins, 1) loop
      insert into public.match_rounds (match_id, round_no, winner)
      values (p_match_id, i, case when p_wins[i] = 'a' then m.player_a else m.player_b end);
    end loop;
    update public.matches
       set state = 'confirmed', rating_counted = true, amend_deadline = null
     where id = p_match_id;
    return 'confirmed';
  end if;

  -- coalesce, not assignment: the window opens once. Re-arming it on every
  -- amend would let one side stall a dispute indefinitely.
  update public.matches
     set state = 'mismatch',
         amend_deadline = coalesce(m.amend_deadline, now() + interval '10 minutes')
   where id = p_match_id;
  return 'mismatch';
end;
$fn$;

-- `create function` grants EXECUTE to PUBLIC by default. Without the revoke,
-- an anonymous caller could still invoke this: it cannot mutate anything (the
-- `me is null or me not in (...)` check refuses it before any write), but it
-- would still take the `for update` row lock and could distinguish "no such
-- match" from "this match is not yours" — a match-id existence oracle.
revoke all on function public.submit_report(uuid, text[]) from public, anon;
grant execute on function public.submit_report(uuid, text[]) to authenticated;
