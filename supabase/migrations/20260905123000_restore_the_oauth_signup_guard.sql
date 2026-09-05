-- Restore the OAuth-signup guard that 20260904190000 silently dropped.
--
-- 20260901225208 added a three-way null guard to public.handle_confirmed_user()
-- so that a provider signup (Discord is the app's only button) -- which
-- arrives in auth.users ALREADY CONFIRMED, with raw_user_meta_data holding
-- only what the provider sent (full_name, avatar_url, provider_id) -- skips
-- profile creation instead of attempting an INSERT that is guaranteed to hit
-- a NOT NULL violation on display_name, go_username or birth_date. See
-- docs/superpowers/HANDOFF.md, "A defect Task 6 found in Task 4's schema".
--
-- 20260904190000 rewrote this same function from scratch to add the
-- friend_code block below, and in doing so re-based its CREATE OR REPLACE on
-- an earlier copy of the body that predated the guard. The guard was never
-- removed on purpose -- it was simply not there to carry forward -- but the
-- effect is identical to a regression: a not_null_violation is not the
-- unique_violation the handler forgives, so it once again propagates and
-- takes the whole auth.users INSERT down with it, and OAuth signup is broken
-- in production as of that migration. Covered by profile-trigger.test.ts,
-- which has been red since 20260904190000 deployed.
--
-- This migration re-emits the CURRENT (friend_code-aware) body with the guard
-- restored in the same place it originally occupied: after the
-- email_confirmed_at check, before the profiles INSERT. It must stay there
-- through any future rewrite of this function -- if you are about to
-- `create or replace function public.handle_confirmed_user()` again, keep
-- this block or re-derive it; do not let a rebase against a stale copy drop
-- it a second time.
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_constraint text;
  v_code text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  -- Nothing registration collected is here, so there is nothing to insert that
  -- would not violate a NOT NULL. Leave it to the client, under a session.
  -- LOAD-BEARING: without this, a Discord signup's not_null_violation is not
  -- the unique_violation the handler below forgives, and it takes the whole
  -- auth.users INSERT down with it -- OAuth signup becomes impossible.
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

  v_code := new.raw_user_meta_data ->> 'friend_code';
  if v_code ~ '^[0-9]{4} [0-9]{4} [0-9]{4}$'
     and exists (select 1 from public.profiles p where p.id = new.id) then
    insert into public.friend_codes (profile_id, code)
    values (new.id, v_code)
    on conflict (profile_id) do nothing;
  end if;

  return new;
end;
$$;
