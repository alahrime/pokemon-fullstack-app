create or replace function public.sweep_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  moved integer := 0;
  n integer;
begin
  -- `amend_deadline is null` is included, not just `<= now()`: today
  -- submit_report is the only writer of state = 'mismatch' and it always
  -- sets the deadline in the same statement, so a null deadline never
  -- happens. But if that ever changes, a 'mismatch' row with a null deadline
  -- would match NEITHER this update NOR the one below (which only targets
  -- 'paired'/'reported') and would be stuck in 'mismatch' forever with no
  -- path out. Treating a null deadline as already-expired closes that class
  -- of stuck row for free.
  update public.matches
     set state = 'disputed', amend_deadline = null
   where state = 'mismatch'
     and (amend_deadline is null or amend_deadline <= now());
  get diagnostics n = row_count;
  moved := moved + n;

  -- Silence costs the record, and it costs it symmetrically: a match neither
  -- side reported is kept for analytics and excluded from every rating.
  --
  -- coalesce(play_after, created_at), not created_at alone: a SCHEDULED
  -- offer's `matches` row is created at handshake CONFIRMATION, which can be
  -- days before the time the two players actually agreed to play
  -- (match_offers.scheduled_for, carried onto play_after by confirm_offer()).
  -- Judging age by created_at alone would sweep a match agreed for Friday as
  -- stale on Wednesday, before either side had the chance to play it. A live
  -- offer or a queue match has no play_after, so this falls back to
  -- created_at for them exactly as before.
  update public.matches
     set state = 'unverified', rating_counted = false
   where state in ('paired', 'reported')
     and coalesce(play_after, created_at) < now() - interval '48 hours';
  get diagnostics n = row_count;
  moved := moved + n;

  return moved;
end;
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation. Without
-- an explicit revoke here, `authenticated` would inherit that default grant
-- and any client could call sweep_matches() directly to expire its own
-- dispute window early. sweep_expired() (20260903005933_pairing_functions.sql)
-- establishes this exact pattern for the same reason.
revoke all on function public.sweep_matches() from public, anon, authenticated;
grant execute on function public.sweep_matches() to service_role;
