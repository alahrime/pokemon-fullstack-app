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
  update public.matches
     set state = 'disputed', amend_deadline = null
   where state = 'mismatch'
     and amend_deadline is not null
     and amend_deadline <= now();
  get diagnostics n = row_count;
  moved := moved + n;

  -- Silence costs the record, and it costs it symmetrically: a match neither
  -- side reported is kept for analytics and excluded from every rating.
  update public.matches
     set state = 'unverified', rating_counted = false
   where state in ('paired', 'reported')
     and created_at < now() - interval '48 hours';
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
