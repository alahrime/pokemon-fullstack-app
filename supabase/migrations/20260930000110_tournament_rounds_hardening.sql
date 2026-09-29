-- Tournament rounds hardening, after review of 20260930000100. Every function
-- below is its live definition (pg_get_functiondef, 2026-09-29) with only the
-- change its comment names; create or replace keeps the existing grants.

-- 5. An empty field is not a round: with no active entrants, 0 = 0 used to
-- create an empty round.
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

-- 1. A final result stays final, and a finished tournament stays finished.
-- report, confirm and dispute act only on the current round of a running
-- tournament, and never on a report whose final_at has passed (it may already
-- have unlocked start_round or finish_tournament). The tournament row is taken
-- FOR SHARE before the pairing FOR UPDATE: the same order start_round,
-- finish_tournament, drop_out and remove_player lock in (tournament, then
-- pairings), so a result cannot change under a finish or a new round.
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
  if t.current_round <> p.round then raise exception 'that round is over'; end if;
  if p.state = 'reported' and p.final_at <= now() then raise exception 'that result is final'; end if;
  if p.state <> 'reported' then raise exception 'there is nothing to dispute'; end if;
  if p.reported_by = me then raise exception 'you cannot dispute your own report'; end if;
  update public.tournament_pairings set state = 'disputed' where id = p_pairing;
  return 'disputed';
end;
$function$;

-- 2 + 4. No settling once the tournament is over (earlier rounds of a running
-- one stay settleable); the audit also records the previous note and settler.
create or replace function public.settle_pairing(p_pairing uuid, p_score_a smallint, p_score_b smallint, p_note text DEFAULT NULL::text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := (select auth.uid()); p public.tournament_pairings; st text;
begin
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or not public.tournament_can_run(p.tournament_id) then raise exception 'not allowed'; end if;
  select state into st from public.tournaments where id = p.tournament_id;
  if st in ('complete', 'cancelled') then raise exception 'this tournament is over'; end if;
  if p.player_b is null then raise exception 'a bye cannot be settled'; end if;
  if me = p.player_a or me = p.player_b then raise exception 'you cannot settle your own game'; end if;
  if not (public._valid_score(p_score_a, p_score_b) or (p_score_a = 0 and p_score_b = 0)) then
    raise exception 'not a possible score';
  end if;
  update public.tournament_pairings
     set score_a = p_score_a, score_b = p_score_b, state = 'settled',
         settled_by = me, note = p_note
   where id = p_pairing;
  perform public._tournament_audit(p.tournament_id, 'settle_pairing', jsonb_build_object(
    'pairing', p_pairing, 'was_state', p.state, 'was_score_a', p.score_a, 'was_score_b', p.score_b,
    'was_note', p.note, 'was_settled_by', p.settled_by,
    'score_a', p_score_a, 'score_b', p_score_b, 'note', p_note));
  return 'settled';
end;
$function$;

-- 4. The forfeit returns what it changed: each pairing's id with its prior
-- state and scores, for the caller's audit row. The return type changes, so
-- the function is dropped and recreated (its only callers are drop_out and
-- remove_player, recreated below). Same rows as before: this round, not a bye,
-- pending or disputed.
drop function public._forfeit_pending(uuid, uuid, uuid, text);
create function public._forfeit_pending(p_t uuid, p_player uuid, p_by uuid, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cur smallint; res jsonb;
begin
  select current_round into cur from public.tournaments where id = p_t;
  with prior as (
    select id, state, score_a, score_b from public.tournament_pairings
     where tournament_id = p_t and round = cur and player_b is not null
       and state in ('pending', 'disputed')
       and p_player in (player_a, player_b)
     for update
  ), changed as (
    update public.tournament_pairings tp
       set state = 'settled', settled_by = p_by, note = p_note,
           score_a = case when tp.player_a = p_player then 0 else 2 end,
           score_b = case when tp.player_a = p_player then 2 else 0 end
      from prior where tp.id = prior.id
    returning prior.id, prior.state, prior.score_a, prior.score_b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'pairing', id, 'was_state', state, 'was_score_a', score_a, 'was_score_b', score_b)), '[]'::jsonb)
    into res from changed;
  return res;
end;
$function$;
revoke all on function public._forfeit_pending(uuid, uuid, uuid, text) from public, anon, authenticated;

-- 3 + 4. drop_out answers a draft (unless it is yours), a missing tournament
-- and a finished one alike: false. The audit records the forfeit.
create or replace function public.drop_out(p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := (select auth.uid()); t public.tournaments; n integer; f jsonb;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or not public.tournament_visible(p_id) then return false; end if;
  if t.state in ('complete', 'cancelled') then return false; end if;
  if t.state <> 'running' then raise exception 'withdraw before the tournament starts; you can only drop while it runs'; end if;
  update public.tournament_entrants set dropped = true
   where tournament_id = p_id and player_id = me and not dropped;
  get diagnostics n = row_count;
  if n > 0 then
    f := public._forfeit_pending(p_id, me, me, 'dropped out');
    perform public._tournament_audit(p_id, 'drop_out', jsonb_build_object('player', me, 'forfeited', f));
  end if;
  return n > 0;
end;
$function$;

-- 3 + 4. No removals once the tournament is over; the audit records the forfeit.
create or replace function public.remove_player(p_id uuid, p_player uuid, p_reason text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t public.tournaments; n integer; f jsonb := '[]'::jsonb;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or not public.tournament_can_run(p_id) then raise exception 'not allowed'; end if;
  if t.state in ('complete', 'cancelled') then raise exception 'this tournament is over'; end if;
  if p_player = t.organiser_id then raise exception 'the organiser cannot be removed'; end if;
  -- row_count is read straight after the write: a later PERFORM would overwrite it.
  if t.state in ('draft', 'registration', 'closed') then
    delete from public.tournament_entrants where tournament_id = p_id and player_id = p_player;
    get diagnostics n = row_count;
  else
    update public.tournament_entrants set dropped = true
     where tournament_id = p_id and player_id = p_player and not dropped;
    get diagnostics n = row_count;
    if n > 0 then
      f := public._forfeit_pending(p_id, p_player, (select auth.uid()), 'removed: ' || coalesce(p_reason, ''));
    end if;
  end if;
  if n > 0 then
    perform public._tournament_audit(p_id, 'remove_player', jsonb_build_object(
      'player', p_player, 'reason', p_reason, 'forfeited', f));
  end if;
  return n > 0;
end;
$function$;

-- 6. The 20260930000100 name was 64 bytes; Postgres kept the first 63.
alter policy "a tournament opponent may read your friend code during the roun" on public.friend_codes
  rename to "a tournament opponent may read your friend code";
