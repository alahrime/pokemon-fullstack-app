-- M5: every tournament has a chat channel. Membership is DERIVED from the
-- tournament's own tables by triggers, so none of the tournament functions is
-- edited and a future writer cannot forget it (the match-channel pattern).
-- Wanted members: the organiser, every judge, every entrant who has not dropped.

alter table public.channels add column tournament_id uuid references public.tournaments (id) on delete cascade;
alter table public.channels drop constraint channels_kind;
alter table public.channels add constraint channels_kind check (kind in ('dm', 'group', 'match', 'tournament'));
alter table public.channels add constraint channels_tournament_id_only_for_tournament
  check ((kind = 'tournament') = (tournament_id is not null));
create unique index channels_tournament_id on public.channels (tournament_id) where tournament_id is not null;

-- Brings one person's membership in line with the tournament tables.
create function public._sync_tournament_member(p_t uuid, p_u uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare ch uuid; wanted boolean;
begin
  select id into ch from public.channels where tournament_id = p_t;
  if ch is null then return; end if;
  select exists (select 1 from public.tournaments where id = p_t and organiser_id = p_u)
      or exists (select 1 from public.tournament_roles where tournament_id = p_t and user_id = p_u)
      or exists (select 1 from public.tournament_entrants where tournament_id = p_t and player_id = p_u and not dropped)
    into wanted;
  if wanted then
    insert into public.channel_members (channel_id, user_id) values (ch, p_u) on conflict do nothing;
  else
    delete from public.channel_members where channel_id = ch and user_id = p_u and role <> 'owner';
  end if;
end;
$fn$;
revoke all on function public._sync_tournament_member(uuid, uuid) from public, anon, authenticated;

create function public._tournament_channel_insert() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare ch uuid;
begin
  insert into public.channels (kind, created_by, tournament_id, title)
  values ('tournament', new.organiser_id, new.id, new.title) returning id into ch;
  insert into public.channel_members (channel_id, user_id, role) values (ch, new.organiser_id, 'owner');
  return new;
end;
$fn$;
create function public._tournament_channel_retitle() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  update public.channels set title = new.title where tournament_id = new.id;
  return new;
end;
$fn$;
create function public._tournament_member_changed() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_table_name = 'tournament_entrants' then
    perform public._sync_tournament_member(coalesce(new.tournament_id, old.tournament_id), coalesce(new.player_id, old.player_id));
  else
    perform public._sync_tournament_member(coalesce(new.tournament_id, old.tournament_id), coalesce(new.user_id, old.user_id));
  end if;
  return null;
end;
$fn$;
revoke all on function public._tournament_channel_insert() from public, anon, authenticated;
revoke all on function public._tournament_channel_retitle() from public, anon, authenticated;
revoke all on function public._tournament_member_changed() from public, anon, authenticated;

create trigger tournaments_get_a_channel after insert on public.tournaments
  for each row execute function public._tournament_channel_insert();
create trigger tournaments_retitle_channel after update of title on public.tournaments
  for each row execute function public._tournament_channel_retitle();
create trigger entrants_sync_channel after insert or update of dropped or delete on public.tournament_entrants
  for each row execute function public._tournament_member_changed();
create trigger roles_sync_channel after insert or delete on public.tournament_roles
  for each row execute function public._tournament_member_changed();

-- Membership follows the tournament, so nobody leaves by hand.
create or replace function public.leave_channel(p_channel uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  k text;
  n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  select kind into k from public.channels where id = p_channel;
  -- A match channel is part of the record of the match; leaving a DM strands the
  -- other side; a tournament channel's members are whoever the tournament says.
  if k in ('match', 'dm', 'tournament') then raise exception 'this channel cannot be left'; end if;
  delete from public.channel_members where channel_id = p_channel and user_id = me;
  get diagnostics n = row_count;
  -- Never deletes the channel: see 20260907001000 for why (cascade would take
  -- the messages and their reports with it).
  return n > 0;
end;
$fn$;

-- Tournaments that already exist.
do $$
declare t record;
begin
  for t in select id, organiser_id, title from public.tournaments loop
    insert into public.channels (kind, created_by, tournament_id, title) values ('tournament', t.organiser_id, t.id, t.title);
    insert into public.channel_members (channel_id, user_id, role)
      select id, t.organiser_id, 'owner' from public.channels where tournament_id = t.id;
    perform public._sync_tournament_member(t.id, u) from (
      select user_id as u from public.tournament_roles where tournament_id = t.id
      union select player_id from public.tournament_entrants where tournament_id = t.id) x;
  end loop;
end $$;
