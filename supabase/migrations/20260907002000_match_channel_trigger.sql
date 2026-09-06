-- Every match gets a channel, by trigger rather than by editing pairing
-- functions. `matches` rows are created by pair_queue_entries() and by
-- confirm_offer() today, and by whatever a future writer adds tomorrow; a
-- trigger cannot be forgotten by a third writer the way an edit to two
-- functions could.

-- SECURITY DEFINER on purpose: a trigger function without it runs as the role
-- that performed the triggering statement, and every authenticated client
-- write to `channels` and `channel_members` is revoked (see
-- 20260907000000_channels_and_members.sql). Without this, every insert into
-- `matches` made by an authenticated caller would raise permission denied.
create or replace function public.create_match_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  channel uuid;
begin
  insert into public.channels (kind, created_by, match_id)
  values ('match', new.player_a, new.id)
  returning id into channel;

  insert into public.channel_members (channel_id, user_id)
  values (channel, new.player_a), (channel, new.player_b);

  return new;
end;
$fn$;

-- Postgres auto-grants EXECUTE on a new function to PUBLIC; revoke that
-- default explicitly. Unlike the other functions in this milestone, this one
-- needs no grant at all: it is never called directly, only fired by the
-- trigger below as part of whatever statement inserts into `matches`.
revoke all on function public.create_match_channel() from public, anon, authenticated;

-- AFTER INSERT, not inside the pairing functions. `matches` has two writers
-- today and will have more; a trigger is the only version of this that a
-- third one cannot forget.
create trigger matches_get_a_channel
  after insert on public.matches
  for each row execute function public.create_match_channel();
