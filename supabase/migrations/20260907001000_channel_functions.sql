-- Who may open what. Three rules, and they are the product decision this
-- whole milestone exists to encode: a DM opens with an accepted friend or
-- someone you share a live match with; a group is seeded from the creator's
-- own accepted friends; adding to a group is checked against the ADDER's own
-- friends, never the owner's, which is what makes it a MUTUAL FRIEND group.

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and user_lo = public.pair_lo(a, b)
       and user_hi = public.pair_hi(a, b)
  )
$fn$;

create or replace function public.share_a_live_match(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.matches m
     where m.state in ('paired', 'reported', 'mismatch', 'disputed')
       and ((m.player_a = a and m.player_b = b) or (m.player_a = b and m.player_b = a))
  )
$fn$;

-- One sentence for every reason a DM cannot be opened. A caller that can tell
-- "they blocked me" from "we are not friends" can enumerate blocks.
create or replace function public.open_dm(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  key text;
  existing uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_other is null or p_other = me
     or not exists (select 1 from public.profiles where id = p_other)
     or public.blocked_between(me, p_other)
     or not (public.are_friends(me, p_other) or public.share_a_live_match(me, p_other)) then
    raise exception 'that person cannot be messaged';
  end if;

  key := public.pair_lo(me, p_other)::text || ':' || public.pair_hi(me, p_other)::text;

  select id into existing from public.channels where dm_key = key;
  if found then return existing; end if;

  -- Two simultaneous "open the DM" clicks race here. The unique index on
  -- dm_key is what decides it; the loser reads the winner's row rather than
  -- raising, so both clicks land in the same conversation. The re-select is
  -- guaranteed to find a row: the only way this insert could have hit
  -- unique_violation is that some transaction has already committed a
  -- channels row with this exact dm_key.
  begin
    insert into public.channels (kind, created_by, dm_key) values ('dm', me, key) returning id into existing;
  exception when unique_violation then
    select id into existing from public.channels where dm_key = key;
    return existing;
  end;

  insert into public.channel_members (channel_id, user_id) values (existing, me), (existing, p_other);
  return existing;
end;
$fn$;

create or replace function public.create_group(p_title text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  channel uuid;
  m uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'a group needs a name'; end if;

  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m = me then continue; end if;
    -- The rule that makes this a MUTUAL FRIEND group: you seed it with people
    -- you are actually friends with, and nobody else can be dropped in.
    if not public.are_friends(me, m) or public.blocked_between(me, m) then
      raise exception 'you can only add your own friends to a group';
    end if;
  end loop;

  insert into public.channels (kind, created_by, title) values ('group', me, btrim(p_title))
  returning id into channel;

  insert into public.channel_members (channel_id, user_id, role) values (channel, me, 'owner');
  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m = me then continue; end if;
    insert into public.channel_members (channel_id, user_id) values (channel, m)
    on conflict do nothing;
  end loop;

  return channel;
end;
$fn$;

create or replace function public.add_to_group(p_channel uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  k text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select kind into k from public.channels where id = p_channel;
  if k is null then raise exception 'no such channel'; end if;
  if k <> 'group' then raise exception 'only a group takes new members'; end if;
  if not public.is_channel_member(p_channel) then raise exception 'you are not a member'; end if;
  -- Checked against the ADDER's friendships, not the owner's. Every person in
  -- the room got there through somebody they are friends with.
  if not public.are_friends(me, p_user) or public.blocked_between(me, p_user) then
    raise exception 'you can only add your own friends to a group';
  end if;

  insert into public.channel_members (channel_id, user_id) values (p_channel, p_user)
  on conflict do nothing;
  return true;
end;
$fn$;

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
  -- A match channel is part of the record of the match. Leaving a DM likewise
  -- would strand the other side talking to nobody; hide it client-side instead.
  if k in ('match', 'dm') then raise exception 'this channel cannot be left'; end if;
  delete from public.channel_members where channel_id = p_channel and user_id = me;
  get diagnostics n = row_count;
  -- The last person out closes the room rather than leaving an orphan.
  delete from public.channels c
   where c.id = p_channel
     and not exists (select 1 from public.channel_members where channel_id = c.id);
  return n > 0;
end;
$fn$;

-- Postgres auto-grants EXECUTE on a new function to PUBLIC; revoke that
-- default explicitly before granting only to the roles that actually need it.
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.share_a_live_match(uuid, uuid) from public, anon, authenticated;
revoke all on function public.open_dm(uuid) from public, anon;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.add_to_group(uuid, uuid) from public, anon;
revoke all on function public.leave_channel(uuid) from public, anon;

-- are_friends and share_a_live_match are SECURITY DEFINER and answer for ANY
-- pair, bypassing RLS to do it. Granting either to `authenticated` would let
-- a signed-in caller probe whether two arbitrary strangers are friends, or
-- whether two strangers share a live match — exactly the leak the
-- `friendships` SELECT policy exists to prevent, and the same shape of leak
-- refused for `blocked_between` in M3a. Neither needs the grant: every call
-- site is inside open_dm, create_group, or add_to_group, all SECURITY
-- DEFINER, which reach these as the owner. Granted to nobody — deliberately
-- unreachable from a client.
grant execute on function public.open_dm(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_to_group(uuid, uuid) to authenticated;
grant execute on function public.leave_channel(uuid) to authenticated;
