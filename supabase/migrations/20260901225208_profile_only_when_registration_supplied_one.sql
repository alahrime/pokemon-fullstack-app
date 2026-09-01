-- Build a profile only when the signup actually collected one to build.
--
-- An OAuth signup does not. GoTrue inserts a provider account into auth.users
-- ALREADY CONFIRMED, so this trigger fires on the INSERT, and
-- raw_user_meta_data holds only what Discord or Google sent -- full_name,
-- avatar_url, provider_id. display_name, go_username and birth_date are all
-- absent, because no step of an OAuth flow collects them, and all three are
-- NOT NULL on public.profiles.
--
-- The result was a not_null_violation on display_name. That is NOT the
-- unique_violation the handler forgives (see
-- 20260901161600_confirm_forgives_only_display_name_collision.sql), so it
-- propagated and took the entire auth.users INSERT down with it: signing up
-- with a provider was impossible, and it surfaced as an opaque provider error
-- with nothing pointing back here. Proven against the local stack before this
-- migration, and covered by profile-trigger.test.ts.
--
-- Half-filled metadata is the same hazard by another route -- a signup missing
-- go_username or birth_date would fail confirmation exactly as the missing
-- display_name did -- so the guard checks all three rather than only the one
-- that happened to be first.
--
-- Leaving the account confirmed with no profile is not a new state to reason
-- about: it is the same one a lost display_name race already produces, and the
-- sign-in screen already has to handle it. There a session exists, so the
-- client inserts its own profile under the ordinary insert policy and asks for
-- a name that is free. That is also what keeps terms acceptance honest for
-- provider signups: consent is recorded where the profile is created, and this
-- trigger no longer creates one for an account that was never asked.
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_constraint text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  -- Nothing registration collected is here, so there is nothing to insert that
  -- would not violate a NOT NULL. Leave it to the client, under a session.
  if new.raw_user_meta_data ->> 'display_name' is null
    or new.raw_user_meta_data ->> 'go_username' is null
    or new.raw_user_meta_data ->> 'birth_date' is null
  then
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
