-- A dropped entrant's kept report must not be amended, confirmed or disputed by them.
-- Bodies as of 20260930000110 with one more refusal after the tournament-state check.

create or replace function public.report_score(p_pairing uuid, p_score_a smallint, p_score_b smallint)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := (select auth.uid());
  p public.tournament_pairings; t public.tournaments;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into t from public.tournaments
   where id = (select tournament_id from public.tournament_pairings where id = p_pairing) for share;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.player_b is null then raise exception 'a bye has no score to report'; end if;
  if t.state <> 'running' then raise exception 'this tournament is over'; end if;
  if exists (select 1 from public.tournament_entrants e
              where e.tournament_id = p.tournament_id and e.player_id = me and e.dropped) then
    raise exception 'you have dropped out of this tournament';
  end if;
  if t.current_round <> p.round then raise exception 'that round is over'; end if;
  if p.state = 'reported' and p.final_at <= now() then raise exception 'that result is final'; end if;
  if not public._valid_score(p_score_a, p_score_b) then raise exception 'not a possible score'; end if;
  if p.state in ('settled', 'disputed') then raise exception 'this result is no longer open to reports'; end if;
  if p.state = 'reported' and p.reported_by <> me then raise exception 'confirm or dispute the report'; end if;
  update public.tournament_pairings
     set score_a = p_score_a, score_b = p_score_b, state = 'reported',
         reported_by = me, reported_at = now(),
         final_at = greatest(coalesce(t.round_ends_at, now()), now() + interval '10 minutes')
   where id = p_pairing;
  return 'reported';
end;
$function$;

create or replace function public.confirm_score(p_pairing uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := (select auth.uid()); p public.tournament_pairings; t public.tournaments;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into t from public.tournaments
   where id = (select tournament_id from public.tournament_pairings where id = p_pairing) for share;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if t.state <> 'running' then raise exception 'this tournament is over'; end if;
  if exists (select 1 from public.tournament_entrants e
              where e.tournament_id = p.tournament_id and e.player_id = me and e.dropped) then
    raise exception 'you have dropped out of this tournament';
  end if;
  if t.current_round <> p.round then raise exception 'that round is over'; end if;
  if p.state = 'reported' and p.final_at <= now() then raise exception 'that result is final'; end if;
  if p.state <> 'reported' then raise exception 'there is nothing to confirm'; end if;
  if p.reported_by = me then raise exception 'the other player confirms your report'; end if;
  update public.tournament_pairings set state = 'settled' where id = p_pairing;
  return 'settled';
end;
$function$;

create or replace function public.dispute_score(p_pairing uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := (select auth.uid()); p public.tournament_pairings; t public.tournaments;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into t from public.tournaments
   where id = (select tournament_id from public.tournament_pairings where id = p_pairing) for share;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if t.state <> 'running' then raise exception 'this tournament is over'; end if;
  if exists (select 1 from public.tournament_entrants e
              where e.tournament_id = p.tournament_id and e.player_id = me and e.dropped) then
    raise exception 'you have dropped out of this tournament';
  end if;
  if t.current_round <> p.round then raise exception 'that round is over'; end if;
  if p.state = 'reported' and p.final_at <= now() then raise exception 'that result is final'; end if;
  if p.state <> 'reported' then raise exception 'there is nothing to dispute'; end if;
  if p.reported_by = me then raise exception 'you cannot dispute your own report'; end if;
  update public.tournament_pairings set state = 'disputed' where id = p_pairing;
  return 'disputed';
end;
$function$;

