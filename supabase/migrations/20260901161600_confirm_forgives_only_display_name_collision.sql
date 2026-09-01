-- The previous version of this function caught `unique_violation` by
-- SQLSTATE alone, which is broader than intended: it happened to be safe
-- only because public.profiles has exactly two unique constraints today —
-- `id`, fully absorbed by ON CONFLICT (id) DO NOTHING before this handler
-- ever sees it, and `display_name`, the one collision this handler exists
-- to forgive (see 20260901160626_confirm_survives_name_collision.sql).
--
-- A future unique constraint added to this table would inherit forgiveness
-- by accident: any violation of it would be silently swallowed here too,
-- producing another "confirmed with no profile" from a cause nobody
-- intended to forgive — the exact silent-failure class the original fix
-- was written to remove. Narrowed to check the constraint name explicitly,
-- so a new unique constraint on profiles must have someone deliberately
-- decide whether it belongs in this handler, rather than silently
-- inheriting this behaviour.
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_constraint text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  begin
    insert into public.profiles (id, display_name, go_username, birth_date, tos_accepted_at)
    values (
      new.id,
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'go_username',
      (new.raw_user_meta_data ->> 'birth_date')::date,
      coalesce((new.raw_user_meta_data ->> 'tos_accepted_at')::timestamptz, now())
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- Only the display_name race is ours to forgive. Anything else is an
    -- unanticipated failure and must propagate, not be swallowed.
    if v_constraint is distinct from 'profiles_display_name_key' then
      raise;
    end if;
  end;
  return new;
end;
$$;
