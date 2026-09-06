-- The three things you can do to a friendship, plus the fourth thing that
-- tears one down. These are the ONLY way a friendships row is ever written:
-- Task 1 revoked insert/update/delete on the table from `authenticated`.

-- One sentence, used for every reason a request cannot be sent: blocked in
-- either direction, no such profile, or yourself. A caller that can tell those
-- apart can enumerate who has blocked them.
create or replace function public.friend_request_refusal() returns text
language sql immutable as $fn$
  select 'that person cannot be sent a friend request'
$fn$;

-- Not granted to `authenticated` (see the bottom of this file): a client
-- that could call this directly would have a block detector with a boolean
-- return value, which is exactly the side channel `friend_request_refusal()`
-- exists to close. It is only ever reached from inside the security definer
-- functions below, which run as the owner and need no grant to call it.
create or replace function public.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  )
$fn$;

create or replace function public.request_friendship(p_target uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid;
  h uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;

  l := public.pair_lo(me, p_target);
  h := public.pair_hi(me, p_target);

  -- Serializes every function in this file against this specific pair for the
  -- rest of the transaction. Without it, two callers requesting each other
  -- for the FIRST time (no row exists yet, so `select ... for update` below
  -- has nothing to lock) can both pass the "not found" check and both try to
  -- insert, and the loser sees a raw duplicate-key error instead of
  -- 'accepted'. It also closes a second gap: `block_user` on this pair does a
  -- plain `insert` into blocks then `delete` from friendships with no lock
  -- between them, so a `request_friendship` that read `blocked_between` as
  -- false a moment before the block committed could insert a friendship
  -- after the block's delete already ran, leaving both rows live. Taking this
  -- lock before the block-check closes that window too, since `block_user`
  -- takes the same lock before its own insert.
  perform pg_advisory_xact_lock(hashtext(l::text), hashtext(h::text));

  if p_target is null or p_target = me
     or not exists (select 1 from public.profiles where id = p_target)
     or public.blocked_between(me, p_target) then
    raise exception '%', public.friend_request_refusal();
  end if;

  select * into existing from public.friendships where user_lo = l and user_hi = h for update;

  if found then
    if existing.status = 'accepted' then return 'accepted'; end if;
    -- They asked first and now we have asked back. That is an accept, not a
    -- duplicate, and it is the behaviour a person expects.
    if existing.requested_by <> me then
      update public.friendships set status = 'accepted', responded_at = now()
       where user_lo = l and user_hi = h;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (user_lo, user_hi, requested_by) values (l, h, me);
  return 'pending';
end;
$fn$;

create or replace function public.respond_to_friendship(p_other uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid := public.pair_lo(auth.uid(), p_other);
  h uuid := public.pair_hi(auth.uid(), p_other);
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- Same lock `request_friendship` and `block_user` take on this pair before
  -- touching a row. Without it, a plain `delete` from a concurrent
  -- `block_user` and this function's own `select ... for update` would still
  -- serialize correctly against EACH OTHER (both need the row's lock), but
  -- only because both happen to touch the same row via the primary key.
  -- Taking the pair lock up front makes that guarantee explicit rather than
  -- incidental, and keeps every mutator here consistent with the others.
  perform pg_advisory_xact_lock(hashtext(l::text), hashtext(h::text));

  select * into existing from public.friendships where user_lo = l and user_hi = h for update;
  if not found then raise exception 'there is no request to respond to'; end if;
  if existing.status = 'accepted' then return 'accepted'; end if;
  if existing.requested_by = me then raise exception 'you sent this request'; end if;

  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where user_lo = l and user_hi = h;
    return 'accepted';
  end if;

  delete from public.friendships where user_lo = l and user_hi = h;
  return 'removed';
end;
$fn$;

create or replace function public.remove_friendship(p_other uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid := public.pair_lo(auth.uid(), p_other);
  h uuid := public.pair_hi(auth.uid(), p_other);
  n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext(l::text), hashtext(h::text));

  -- `l` and `h` are always derived from `auth.uid()` (one of the two
  -- pair_lo/pair_hi inputs is always `me`), so `me in (user_lo, user_hi)` is
  -- true of every row this WHERE clause could ever match — it can never be
  -- the reason a row survives. What actually stops a stranger deleting a
  -- friendship they named is that `l, h` computed from (me, p_other) will
  -- not equal the stored canonical pair unless `me` is one of its two
  -- parties, so the delete simply finds no matching row to begin with.
  delete from public.friendships
   where user_lo = l and user_hi = h and me in (user_lo, user_hi);
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

create or replace function public.block_user(p_target uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid;
  h uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_target is null or p_target = me then return false; end if;

  l := public.pair_lo(me, p_target);
  h := public.pair_hi(me, p_target);
  -- Same pair lock as request_friendship/respond_to_friendship: taking it
  -- before the insert below is what stops a concurrent request_friendship
  -- from reading `blocked_between` as false a moment before this block
  -- commits and inserting a friendship this function's delete has already
  -- run past.
  perform pg_advisory_xact_lock(hashtext(l::text), hashtext(h::text));

  insert into public.blocks (blocker_id, blocked_id) values (me, p_target)
  on conflict do nothing;

  -- A block that leaves the friendship standing is not a block. This is why
  -- blocking is a function and not an insert policy.
  delete from public.friendships where user_lo = l and user_hi = h;
  return true;
end;
$fn$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default. Close that
-- on every function this migration creates, then open exactly what a client
-- role needs: the four things listed at the top of the file, and nothing
-- else. `friend_request_refusal` and `blocked_between` are not granted to
-- `authenticated` at all — both run only inside the security definer
-- functions below, which execute as the owner and need no grant, and
-- `blocked_between` in particular must never be reachable directly (see the
-- comment above its definition).
revoke all on function public.friend_request_refusal() from public, anon, authenticated;
revoke all on function public.blocked_between(uuid, uuid) from public, anon, authenticated;

revoke all on function public.request_friendship(uuid) from public, anon;
grant execute on function public.request_friendship(uuid) to authenticated;

revoke all on function public.respond_to_friendship(uuid, boolean) from public, anon;
grant execute on function public.respond_to_friendship(uuid, boolean) to authenticated;

revoke all on function public.remove_friendship(uuid) from public, anon;
grant execute on function public.remove_friendship(uuid) to authenticated;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
