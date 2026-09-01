-- Create the profile when an account becomes usable, reading what registration
-- collected out of the signup metadata.
--
-- Fires on confirmation rather than on insert. An insert-time trigger would
-- mint a profile for an account that may never be confirmed, and since
-- display_name is UNIQUE that abandoned row would squat a name nobody can
-- claim. Google arrives already confirmed and is handled by the same path.
--
-- SECURITY DEFINER because the row is created before any session exists, so
-- there is no auth.uid() for a policy to check. search_path is pinned empty,
-- which is Supabase's own hardening guidance for definer functions.
create function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  insert into public.profiles (id, display_name, go_username, birth_date, tos_accepted_at)
  values (
    new.id,
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'go_username',
    (new.raw_user_meta_data ->> 'birth_date')::date,
    coalesce((new.raw_user_meta_data ->> 'tos_accepted_at')::timestamptz, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_confirmed_user();
