-- The friend code gets a format, and a way to arrive.
--
-- `friend_codes.code` has been `text not null` and nothing more since
-- 20260901153959_profiles.sql, on the reasoning that no screen wrote it. That
-- is no longer true — the account screen writes it now — and it was never a
-- reason for the COLUMN to be permissive: the seeder writes this column, and
-- so does anyone at a psql prompt. A friend code is twelve digits; the game
-- shows them in groups of four; storing exactly one spelling means
-- `opponentFriendCode` can render what it reads without a formatting pass, and
-- means two codes that are the same number are the same string.
--
-- Existing rows are normalized first rather than the constraint being added
-- `not valid`. A row that cannot be normalized — anything that is not twelve
-- digits and separators — fails this migration loudly and on purpose: it is
-- either a real friend code stored in a shape nobody anticipated, which
-- someone should look at, or it is not a friend code at all, which someone
-- should look at harder. Silently exempting it would leave the column with a
-- format the reader could still not rely on.
update public.friend_codes
set code = regexp_replace(
  regexp_replace(code, '[^0-9]', '', 'g'),
  '^([0-9]{4})([0-9]{4})([0-9]{4})$',
  '\1 \2 \3'
)
where code !~ '^[0-9]{4} [0-9]{4} [0-9]{4}$'
  and regexp_replace(code, '[^0-9]', '', 'g') ~ '^[0-9]{12}$';

alter table public.friend_codes
  add constraint friend_codes_twelve_digits
  check (code ~ '^[0-9]{4} [0-9]{4} [0-9]{4}$');

-- Where a code comes from for an account made with email and password.
--
-- The registration form has nowhere to write it at the time it is typed: there
-- is no session until the emailed link is followed, and the insert policy on
-- `friend_codes` needs one. Every other field on that form takes the same route
-- — signup metadata, read back here when the account confirms — so the friend
-- code takes it too rather than becoming the one field that is asked for twice.
--
-- Three guards, each for a state that actually occurs:
--
--   * absent or malformed metadata is skipped, not raised. A provider signup
--     carries no metadata at all, and this trigger must never be the reason an
--     account cannot confirm. The account screen asks for the code again when
--     it finds none on file, which is the same path every account created
--     before this migration takes.
--   * the profile must exist, because `friend_codes.profile_id` references it.
--     The display-name collision forgiven above leaves a confirmed account with
--     no profile row; inserting here anyway would turn that forgiven state back
--     into a failed confirmation.
--   * `on conflict do nothing`, because the trigger fires on INSERT and on any
--     UPDATE of `email_confirmed_at` — it can run more than once for one
--     account, and a code the owner has since changed must not be reverted to
--     what they typed at signup.
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
