-- A challenge is a match offer aimed at one person. Everything after posting —
-- verification, accept/confirm, expiry, conversion, the match channel, block
-- enforcement — is the existing offer machinery, so this migration adds only
-- the aim, the way to decline, and the card that carries it into a DM.

alter table public.match_offers
  add column target_id uuid references public.profiles (id) on delete cascade;

alter table public.match_offers drop constraint match_offers_state;
alter table public.match_offers add constraint match_offers_state
  check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted', 'declined'));

create index match_offers_target_idx on public.match_offers (target_id) where target_id is not null;

-- Clients may never post an aimed offer themselves: eligibility (friends or a
-- live match, not blocked, a public format) is enforced in create_challenge(),
-- and a direct INSERT would bypass all of it. Recreate the owner policy from
-- 20260904071716 with one more conjunct.
drop policy "an offer belongs to the person who proposed it" on public.match_offers;
create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check (
    (select auth.uid()) = proposer_id
    and verified_hash is null
    and accepted_by is null
    and accepted_team is null
    and accepted_at is null
    and confirmed_at is null
    and match_id is null
    and state = 'open'
    and target_id is null
  );

create policy "a challenge is readable by its target"
  on public.match_offers for select
  to authenticated
  using (target_id = (select auth.uid()));

-- The card. `kind` and `offer_id` are server-written: the messages INSERT
-- policy below only lets a client post plain text, and the protect trigger
-- refuses to let either be rewritten afterwards.
alter table public.messages
  add column kind text not null default 'text' check (kind in ('text', 'challenge')),
  add column offer_id uuid references public.match_offers (id) on delete set null;

-- The live INSERT policy is the one 20260908000000 recreated (named "... in a
-- dm may post"); reproduced verbatim with two conjuncts appended so a client
-- can only ever post plain text.
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
    and kind = 'text'
    and offer_id is null
  );

-- messages_protect_columns() as deployed (20260907003000), with kind and
-- offer_id added to the columns an authenticated client may never rewrite.
-- The new columns lead the message so its existing tail, which channels.test.ts
-- matches on, is unchanged.
create or replace function public.messages_protect_columns()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.expires_at := now() + interval '7 days';
    return new;
  end if;

  if new.channel_id is distinct from old.channel_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.kind is distinct from old.kind
     or new.offer_id is distinct from old.offer_id then
    raise exception 'kind, offer_id, channel_id, author_id, created_at and expires_at cannot be changed after insert';
  end if;
  return new;
end;
$function$;

create function public.create_challenge(
  p_target uuid,
  p_format_version uuid,
  p_claimed_hash text,
  p_league text,
  p_team jsonb,
  p_data_rev text,
  p_scheduled_for timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := (select auth.uid());
  vis public.format_visibility;
  offer uuid;
  dm uuid;
begin
  if me is null then raise exception 'not signed in'; end if;

  -- One sentence for every reason, exactly as open_dm does: a caller that can
  -- tell "blocked" from "not friends" can enumerate blocks.
  if p_target is null or p_target = me
     or not exists (select 1 from public.profiles where id = p_target)
     or public.blocked_between(me, p_target)
     or not (public.are_friends(me, p_target) or public.share_a_live_match(me, p_target)) then
    raise exception 'that person cannot be challenged';
  end if;

  -- Versions are readable by others only for a PUBLIC format, and the target
  -- has to be able to read the terms they are agreeing to.
  select f.visibility into vis
    from public.format_versions v join public.formats f on f.id = v.format_id
   where v.id = p_format_version;
  if vis is distinct from 'public' then
    raise exception 'a challenge needs a public format';
  end if;

  if p_scheduled_for is not null and p_scheduled_for <= now() then
    raise exception 'a scheduled challenge cannot be in the past';
  end if;

  insert into public.match_offers
    (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev,
     visibility, scheduled_for, expires_at)
  values
    (me, p_target, p_format_version, p_claimed_hash, p_league, p_team, p_data_rev,
     'private', p_scheduled_for, coalesce(p_scheduled_for, now() + interval '1 hour'))
  returning id into offer;

  dm := public.open_dm(p_target);
  insert into public.messages (channel_id, author_id, body, kind, offer_id)
  values (dm, me, 'Challenge', 'challenge', offer);
  return offer;
end;
$fn$;

-- Declining is a function, not an UPDATE, for the reason accept_offer is: no
-- client may write this table. Returns false rather than raising for "not
-- yours / not open" so a stranger learns nothing about which offers exist.
create function public.decline_challenge(p_offer uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  update public.match_offers set state = 'declined'
   where id = p_offer
     and target_id = (select auth.uid())
     and state = 'open';
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

-- accept_offer() as deployed (20260904071717), with one change: a challenge
-- is open to its target alone; any other offer keeps the public-only rule.
CREATE OR REPLACE FUNCTION public.accept_offer(p_offer uuid, p_team jsonb, p_data_rev text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.match_offers;
  taker uuid := (select auth.uid());
  new_match uuid;
begin
  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
  if p_team is null then raise exception 'you must supply the team you are accepting with'; end if;
  if p_data_rev is null then raise exception 'you must supply the data build you are accepting on'; end if;
  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
  -- told the offer is taken. Skipping would tell them "no such offer", a
  -- different and misleading answer.
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
  if o.verified_hash is null then raise exception 'this offer has not been verified yet'; end if;
  if o.target_id is not null then
    if o.target_id <> taker then raise exception 'this offer is not open to you'; end if;
  elsif o.visibility <> 'public' then
    raise exception 'this offer is not open to you';
  end if;
  -- Last among the checks, deliberately. Every check above is about the offer
  -- and is the same answer for everyone; this is the only one that is about
  -- the ACCEPTER, so someone on a stale build is told the offer was fine and
  -- they are not, rather than being told the offer is unavailable.
  --
  -- `is distinct from`, not `<>`: a null on either side must REFUSE, and `<>`
  -- against a null evaluates to null, which an `if` treats as false and falls
  -- straight through into creating the match.
  if p_data_rev is distinct from o.data_rev then
    raise exception 'this offer was made on a different data build than yours';
  end if;

  if o.scheduled_for is null then
    -- Live: agreeing is playing. One confirmation is the whole handshake, and
    -- the taker's own team — not an empty roster — is what they play the
    -- match on.
    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (o.proposer_id, taker, o.format_version_id, o.verified_hash, o.team, p_team,
       o.data_rev, gen_random_uuid()::text, 'offer')
    returning id into new_match;
    update public.match_offers
       set state = 'converted', accepted_by = taker, accepted_team = p_team, accepted_at = now(),
           confirmed_at = now(), match_id = new_match
     where id = p_offer;
    return new_match;
  end if;

  -- Scheduled: one-sided acceptance is not a match. The proposer must confirm
  -- inside the window or this lapses. The team is captured now, at acceptance
  -- time, because it is the taker's own write and confirm_offer() runs as the
  -- proposer, who has no roster of the taker's to supply.
  --
  -- Nothing stores the taker's `data_rev`, and nothing needs to: the check
  -- above has established it EQUALS `o.data_rev`, which the column already
  -- holds. So confirm_offer() needs no new check either — a taker cannot end
  -- up confirmed on a build they did not accept on without accepting again.
  update public.match_offers
     set state = 'accepted', accepted_by = taker, accepted_team = p_team, accepted_at = now()
   where id = p_offer;
  return null;
end;
$function$;

revoke all on function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz) from public, anon;
revoke all on function public.decline_challenge(uuid) from public, anon;
grant execute on function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz) to authenticated;
grant execute on function public.decline_challenge(uuid) to authenticated;
