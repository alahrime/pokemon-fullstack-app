-- Organiser announcements in a tournament channel: a message of kind 'announcement'
-- that only the organiser or a judge may post, and only in that tournament's own channel.

alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'challenge', 'announcement'));

-- Caller-scoped on purpose (same shape as is_channel_member): it answers only about
-- the caller, so the grant discloses nothing about anyone else. Judges are read from
-- tournament_roles, so a revoked judge stops being able to announce at once.
create function public.can_announce(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.channels c join public.tournaments t on t.id = c.tournament_id
     where c.id = p_channel and c.kind = 'tournament'
       and (t.organiser_id = (select auth.uid())
            or exists (select 1 from public.tournament_roles r where r.tournament_id = t.id and r.user_id = (select auth.uid())))
  )
$fn$;
revoke all on function public.can_announce(uuid) from public, anon;
grant execute on function public.can_announce(uuid) to authenticated;

-- The live INSERT policy (20260929000000), with the tail widened from "plain text only".
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
  );
