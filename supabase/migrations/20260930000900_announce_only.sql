-- Announce-only tournament channels: while on, only the organiser and judges may post.
-- Off by default; tournament channels only (no other kind has a role to hold the switch).
alter table public.channels add column announce_only boolean not null default false;
alter table public.channels add constraint channels_announce_only_tournament_only
  check (not announce_only or kind = 'tournament');

-- Caller-scoped, like can_announce: only the organiser flips the switch, judges do not.
create function public.is_tournament_organiser(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.channels c join public.tournaments t on t.id = c.tournament_id
     where c.id = p_channel and c.kind = 'tournament' and t.organiser_id = (select auth.uid()))
$fn$;
revoke all on function public.is_tournament_organiser(uuid) from public, anon;
grant execute on function public.is_tournament_organiser(uuid) to authenticated;

-- channels UPDATE is revoked from clients, so this is the only way to change the flag.
create function public.set_announce_only(p_channel uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $fn$
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if not public.is_tournament_organiser(p_channel) then raise exception 'only the organiser can change this'; end if;
  update public.channels set announce_only = p_on where id = p_channel;
  return p_on;
end;
$fn$;
revoke all on function public.set_announce_only(uuid, boolean) from public, anon;
grant execute on function public.set_announce_only(uuid, boolean) to authenticated;

-- The live INSERT policy (20260930000700) plus one clause: plain text in an announce-only
-- channel needs can_announce. Announcement-kind messages were already gated by it.
drop policy "a member who is not blocked in a dm may post" on public.messages;
create policy "a member who is not blocked in a dm may post"
  on public.messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id)
    and not exists (
      select 1
        from public.channels c
       where c.id = messages.channel_id
         and c.kind = 'dm'
         and exists (
           select 1
             from public.channel_members other
            where other.channel_id = messages.channel_id
              and other.user_id <> (select auth.uid())
              and (
                public.blocked_with_me(other.user_id)
                or public.i_blocked(other.user_id)
              )
         )
    )
    and offer_id is null
    and (kind = 'text' or (kind = 'announcement' and public.can_announce(channel_id)))
    and (
      not exists (select 1 from public.channels c where c.id = messages.channel_id and c.announce_only)
      or public.can_announce(channel_id)
    )
  );
