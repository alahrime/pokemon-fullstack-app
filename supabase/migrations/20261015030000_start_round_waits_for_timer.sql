-- The organiser (and their judges) advance rounds on the timer (user's rule, 2026-10-15): before the round
-- timer ends the next round starts only when every game is settled; after it, open games may be forced past as
-- before. `start_round` is otherwise its 20260930000110 definition (create or replace keeps its grants).

CREATE OR REPLACE FUNCTION public.start_round(p_tournament uuid, p_pairings jsonb, p_force boolean DEFAULT false, p_override boolean DEFAULT false)
 RETURNS smallint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.tournaments;
  rnd smallint; active integer; uncounted integer; byes integer := 0; tableno integer := 0;
  elem jsonb; a uuid; b uuid; seen uuid[] := '{}';
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  select * into t from public.tournaments where id = p_tournament for update;
  -- One sentence for "no such tournament" and "not yours to run".
  if not found or not public.tournament_can_run(p_tournament) then raise exception 'not allowed'; end if;
  if t.state not in ('closed', 'running') then raise exception 'the tournament is not ready for a round'; end if;
  if t.current_round >= t.rounds then raise exception 'every round has been played'; end if;

  if t.current_round > 0 then
    select count(*) into uncounted from public.tournament_pairings tp
     where tp.tournament_id = t.id and tp.round = t.current_round
       and not public._pairing_counts(tp.state, tp.final_at);
    if uncounted > 0 and not p_force then
      raise exception '% pairings are unsettled', uncounted;
    end if;
    -- Forcing past open games waits for the round timer. Before it, the next round starts only once every game
    -- is settled (both players agreed the result); a reported game counts by itself once the timer ends.
    if uncounted > 0 and t.round_ends_at is not null and now() < t.round_ends_at then
      raise exception 'the round timer has not ended: % pairings are unsettled', uncounted;
    end if;
  end if;

  if jsonb_typeof(p_pairings) is distinct from 'array' then raise exception 'pairings must be a list'; end if;
  rnd := t.current_round + 1;
  select count(*) into active from public.tournament_entrants where tournament_id = t.id and not dropped;
  if active = 0 then raise exception 'nobody is left to pair'; end if;

  for elem in select * from jsonb_array_elements(p_pairings) loop
    a := nullif(elem ->> 'a', '')::uuid;
    b := nullif(elem ->> 'b', '')::uuid;
    if a is null or a = b then raise exception 'a pairing needs two different players, or a bye'; end if;
    if a = any(seen) or (b is not null and b = any(seen)) then raise exception 'a player appears twice'; end if;
    if not exists (select 1 from public.tournament_entrants where tournament_id = t.id and player_id = a and not dropped)
       or (b is not null and not exists (
             select 1 from public.tournament_entrants where tournament_id = t.id and player_id = b and not dropped)) then
      raise exception 'pairings may only name active entrants';
    end if;
    seen := seen || a;
    if b is null then
      byes := byes + 1;
      if not p_override and exists (
        select 1 from public.tournament_pairings where tournament_id = t.id and player_a = a and player_b is null) then
        raise exception 'that player has already had a bye';
      end if;
    else
      seen := seen || b;
      if not p_override and exists (
        select 1 from public.tournament_pairings
         where tournament_id = t.id and player_b is not null
           and ((player_a = a and player_b = b) or (player_a = b and player_b = a))) then
        raise exception 'those two have already played';
      end if;
    end if;
  end loop;

  if coalesce(array_length(seen, 1), 0) <> active then
    raise exception 'every active entrant must be paired exactly once';
  end if;
  if byes > 1 or byes <> (active % 2) then
    raise exception 'an odd field needs exactly one bye, an even field none';
  end if;

  for elem in select * from jsonb_array_elements(p_pairings) loop
    tableno := tableno + 1;
    a := (elem ->> 'a')::uuid;
    b := nullif(elem ->> 'b', '')::uuid;
    if b is null then
      insert into public.tournament_pairings
        (tournament_id, round, table_no, player_a, player_b, score_a, score_b, state, settled_by, note)
      values (t.id, rnd, tableno, a, null, 2, 0, 'settled', (select auth.uid()), 'bye');
    else
      insert into public.tournament_pairings (tournament_id, round, table_no, player_a, player_b)
      values (t.id, rnd, tableno, a, b);
    end if;
  end loop;

  update public.tournaments
     set state = 'running', current_round = rnd,
         round_ends_at = now() + make_interval(mins => round_minutes)
   where id = t.id;
  perform public._tournament_audit(t.id, 'start_round', jsonb_build_object(
    'round', rnd, 'forced', p_force and coalesce(uncounted, 0) > 0, 'unsettled', coalesce(uncounted, 0),
    'override', p_override));
  return rnd;
end;
$function$;
