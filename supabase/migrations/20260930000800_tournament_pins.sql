-- Pinning in a tournament channel is for the organiser and judges. A pinned message is
-- exempt from the 7-day sweep, so open pinning in a big room would let anyone keep
-- messages forever. Other channel kinds keep the existing "any member" rule.
drop policy "a member may pin and unpin in their own channel" on public.message_pins;

create policy "a member may pin in their channel, in a tournament only if they run it"
  on public.message_pins for insert
  to authenticated
  with check (
    pinned_by = (select auth.uid())
    and exists (
      select 1 from public.messages m join public.channels c on c.id = m.channel_id
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id)
         and (c.kind <> 'tournament' or public.can_announce(c.id))
    )
  );

create policy "a member may unpin in their channel, in a tournament only if they run it"
  on public.message_pins for delete
  to authenticated
  using (
    exists (
      select 1 from public.messages m join public.channels c on c.id = m.channel_id
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id)
         and (c.kind <> 'tournament' or public.can_announce(c.id))
    )
  );
