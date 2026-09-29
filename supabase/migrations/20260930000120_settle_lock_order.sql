-- settle_pairing lock order, after review of 20260930000110. Its live
-- definition (pg_get_functiondef, 2026-09-29) with one change: the tournament
-- row is taken FOR SHARE BEFORE the pairing FOR UPDATE, and the later unlocked
-- read of the state is gone.
--
-- Every function that locks pairings now takes the tournaments row first:
-- start_round, finish_tournament, drop_out and remove_player (and so
-- _forfeit_pending, which only they call) hold it FOR UPDATE; report_score,
-- confirm_score, dispute_score and now settle_pairing hold it FOR SHARE.
-- Before, settle held the pairing and then waited on the tournament (its audit
-- insert takes FOR KEY SHARE through the FK): a deadlock against a drop or a
-- removal of one of its players, and a way past the complete/cancelled freeze
-- (finish_tournament did not wait for it, committed 'complete', and the
-- settle then committed on a finished tournament).
--
-- The prelude raises nothing, so 'not allowed' is still the first answer and a
-- stranger learns nothing from it.
create or replace function public.settle_pairing(p_pairing uuid, p_score_a smallint, p_score_b smallint, p_note text DEFAULT NULL::text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := (select auth.uid()); p public.tournament_pairings; st text;
begin
  select state into st from public.tournaments
   where id = (select tournament_id from public.tournament_pairings where id = p_pairing) for share;
  select * into p from public.tournament_pairings where id = p_pairing for update;
  if not found or not public.tournament_can_run(p.tournament_id) then raise exception 'not allowed'; end if;
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
