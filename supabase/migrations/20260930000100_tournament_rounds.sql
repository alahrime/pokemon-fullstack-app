-- Tournament rounds: pairing, reporting, judging, dropping, finishing, and
-- reaching your current opponent. Every write is a SECURITY DEFINER function;
-- the tables stay write-revoked from clients (20260930000000).

-- Counting rule, in one place: settled, or reported and past its finality time.
-- STABLE, not immutable: it reads now().
create function public._pairing_counts(s text, final_at timestamptz) returns boolean
language sql stable as $fn$
  select s = 'settled' or (s = 'reported' and final_at is not null and final_at <= now())
$fn$;
revoke all on function public._pairing_counts(text, timestamptz) from public, anon, authenticated;

create function public.start_round(
  p_tournament uuid, p_pairings jsonb, p_force boolean default false, p_override boolean default false
) returns smallint
language plpgsql security definer set search_path = public as $fn$
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
$fn$;

create function public._valid_score(a smallint, b smallint) returns boolean
language sql immutable as $fn$
  select a is not null and b is not null
     and ((a = 2 and b in (0, 1)) or (b = 2 and a in (0, 1)))
$fn$;
revoke all on function public._valid_score(smallint, smallint) from public, anon, authenticated;

create function public.report_score(p_pairing uuid, p_score_a smallint, p_score_b smallint) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := (select auth.uid());
  p public.tournament_pairings; t public.tournaments;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.player_b is null then raise exception 'a bye has no score to report'; end if;
  if not public._valid_score(p_score_a, p_score_b) then raise exception 'not a possible score'; end if;
  if p.state in ('settled', 'disputed') then raise exception 'this result is no longer open to reports'; end if;
  if p.state = 'reported' and p.reported_by <> me then raise exception 'confirm or dispute the report'; end if;
  select * into t from public.tournaments where id = p.tournament_id;
  if t.current_round <> p.round then raise exception 'that round is over'; end if;
  update public.tournament_pairings
     set score_a = p_score_a, score_b = p_score_b, state = 'reported',
         reported_by = me, reported_at = now(),
         final_at = greatest(coalesce(t.round_ends_at, now()), now() + interval '10 minutes')
   where id = p_pairing;
  return 'reported';
end;
$fn$;

create function public.confirm_score(p_pairing uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); p public.tournament_pairings;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.state <> 'reported' then raise exception 'there is nothing to confirm'; end if;
  if p.reported_by = me then raise exception 'the other player confirms your report'; end if;
  update public.tournament_pairings set state = 'settled' where id = p_pairing;
  return 'settled';
end;
$fn$;

create function public.dispute_score(p_pairing uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); p public.tournament_pairings;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or me not in (p.player_a, coalesce(p.player_b, p.player_a)) then
    raise exception 'that pairing is not yours';
  end if;
  if p.state <> 'reported' then raise exception 'there is nothing to dispute'; end if;
  if p.reported_by = me then raise exception 'you cannot dispute your own report'; end if;
  update public.tournament_pairings set state = 'disputed' where id = p_pairing;
  return 'disputed';
end;
$fn$;

-- Organiser or judge. Never one of the two players: an organiser or judge who
-- is also an entrant has their own game settled by someone else.
create function public.settle_pairing(
  p_pairing uuid, p_score_a smallint, p_score_b smallint, p_note text default null
) returns text
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); p public.tournament_pairings;
begin
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or not public.tournament_can_run(p.tournament_id) then raise exception 'not allowed'; end if;
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
    'score_a', p_score_a, 'score_b', p_score_b, 'note', p_note));
  return 'settled';
end;
$fn$;

-- Forfeit helper: settles this player's unplayed or contested pairing this
-- round as a 0-2 loss. A bye (player_b null) is never touched. A 'reported'
-- pairing is left alone: a result was entered for a game that was played, and
-- it stands (the opponent may still confirm or dispute; it finalises at
-- final_at; a judge may settle it).
create function public._forfeit_pending(p_t uuid, p_player uuid, p_by uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $fn$
declare cur smallint;
begin
  select current_round into cur from public.tournaments where id = p_t;
  update public.tournament_pairings
     set state = 'settled', settled_by = p_by, note = p_note,
         score_a = case when player_a = p_player then 0 else 2 end,
         score_b = case when player_a = p_player then 2 else 0 end
   where tournament_id = p_t and round = cur and player_b is not null
     and state in ('pending', 'disputed')
     and p_player in (player_a, player_b);
end;
$fn$;
revoke all on function public._forfeit_pending(uuid, uuid, uuid, text) from public, anon, authenticated;

create function public.drop_out(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare me uuid := (select auth.uid()); t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found then return false; end if;
  if t.state <> 'running' then raise exception 'withdraw before the tournament starts; you can only drop while it runs'; end if;
  update public.tournament_entrants set dropped = true
   where tournament_id = p_id and player_id = me and not dropped;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._forfeit_pending(p_id, me, me, 'dropped out');
    perform public._tournament_audit(p_id, 'drop_out', jsonb_build_object('player', me));
  end if;
  return n > 0;
end;
$fn$;

create function public.remove_player(p_id uuid, p_player uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or not public.tournament_can_run(p_id) then raise exception 'not allowed'; end if;
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
      perform public._forfeit_pending(p_id, p_player, (select auth.uid()), 'removed: ' || coalesce(p_reason, ''));
    end if;
  end if;
  if n > 0 then
    perform public._tournament_audit(p_id, 'remove_player', jsonb_build_object('player', p_player, 'reason', p_reason));
  end if;
  return n > 0;
end;
$fn$;

create function public.finish_tournament(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare t public.tournaments; open_n integer;
begin
  select * into t from public.tournaments where id = p_id for update;
  if not found or t.organiser_id is distinct from (select auth.uid()) then raise exception 'not allowed'; end if;
  if t.state <> 'running' or t.current_round < t.rounds then raise exception 'unsettled pairings remain'; end if;
  select count(*) into open_n from public.tournament_pairings tp
   where tp.tournament_id = p_id and tp.round = t.current_round
     and not public._pairing_counts(tp.state, tp.final_at);
  if open_n > 0 then raise exception 'unsettled pairings remain'; end if;
  update public.tournaments set state = 'complete' where id = p_id;
  perform public._tournament_audit(p_id, 'finish', '{}');
  return true;
end;
$fn$;

-- The live share_a_live_match (pg_get_functiondef, 2026-09-29) with one OR arm
-- added: the two players of a live pairing in the CURRENT round of a running
-- tournament. create or replace keeps its grants (postgres and service_role
-- only; no client may call it with an arbitrary pair).
create or replace function public.share_a_live_match(a uuid, b uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.matches m
     where m.state in ('paired', 'reported', 'mismatch', 'disputed')
       and ((m.player_a = a and m.player_b = b) or (m.player_a = b and m.player_b = a))
  )
  or exists (
    select 1 from public.tournament_pairings tp
      join public.tournaments t on t.id = tp.tournament_id
     where t.state = 'running' and tp.round = t.current_round
       and tp.player_b is not null
       and tp.state in ('pending', 'reported', 'disputed')
       and ((tp.player_a = a and tp.player_b = b) or (tp.player_a = b and tp.player_b = a)))
$function$;

create policy "a tournament opponent may read your friend code during the round"
  on public.friend_codes for select to authenticated
  using (
    exists (
      select 1 from public.tournament_pairings tp
        join public.tournaments t on t.id = tp.tournament_id
       where t.state = 'running' and tp.round = t.current_round
         and tp.player_b is not null and tp.state in ('pending', 'reported', 'disputed')
         and ((tp.player_a = friend_codes.profile_id and tp.player_b = (select auth.uid()))
           or (tp.player_b = friend_codes.profile_id and tp.player_a = (select auth.uid())))
    )
  );

do $g$
declare f text;
begin
  foreach f in array array[
    'start_round(uuid,jsonb,boolean,boolean)', 'report_score(uuid,smallint,smallint)',
    'confirm_score(uuid)', 'dispute_score(uuid)', 'settle_pairing(uuid,smallint,smallint,text)',
    'drop_out(uuid)', 'remove_player(uuid,uuid,text)', 'finish_tournament(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$g$;
