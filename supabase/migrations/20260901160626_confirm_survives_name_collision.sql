-- A display_name collision discovered AT CONFIRMATION TIME must not be able
-- to fail the confirming UPDATE on auth.users. Confirming only proves email
-- ownership; minting a profile is a separate concern that happens to be
-- convenient to do here. Before this fix, a unique_violation on
-- display_name rolled back the entire UPDATE, including
-- email_confirmed_at itself -- which strands the losing account
-- permanently: every retry hits the same collision, and re-registering is
-- impossible because the email is already taken in auth.users. Only an
-- administrator could clear that state.
--
-- The account is left confirmed with no profile. That is expected: once
-- confirmed, a real session exists, so the client can insert its own
-- profile under the ordinary insert policy and prompt for a name that is
-- free.
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
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
    -- The display_name was taken between signup and confirmation. Let the
    -- confirmation succeed regardless: it proves email ownership, and
    -- failing it would strand this account permanently -- the user could
    -- neither confirm (same collision every retry) nor re-register (email
    -- taken).
    --
    -- The account is left confirmed with no profile. That state is
    -- expected and Task 6 handles it: on first sign-in a session exists,
    -- so the client can insert its own profile under the ordinary policy
    -- and prompt for a name that is free.
    null;
  end;
  return new;
end;
$$;
