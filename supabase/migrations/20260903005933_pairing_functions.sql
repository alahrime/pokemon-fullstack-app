-- Pair everything pairable, in one transaction, as the table owner.
--
-- `for update skip locked` is the whole mechanism. Two coordinator ticks
-- overlapping is not hypothetical — a tick that runs long while the next fires
-- is the normal failure of any timer — and without SKIP LOCKED the second tick
-- reads rows the first is about to consume and pairs them a second time. With
-- it, the second tick simply does not see them. This is the same class of bug
-- as M1b's duplicate formats, where two overlapping runs each did the work.
create function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $$
declare
  pending public.queue_entries;
  cur public.queue_entries;
  paired integer := 0;
begin
  for cur in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by verified_hash, league, data_rev, created_at
     for update skip locked
  loop
    if pending.id is not null
       and pending.verified_hash = cur.verified_hash
       and pending.league = cur.league
       -- Same data build, deliberately. A random draw both sides compute must
       -- deal from the same pool; two clients on different data would agree on
       -- the rules and disagree on what satisfies them.
       and pending.data_rev = cur.data_rev
       and pending.user_id <> cur.user_id then
      insert into public.matches
        (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
      values
        (pending.user_id, cur.user_id, pending.format_version_id, pending.verified_hash,
         pending.team, cur.team, pending.data_rev, gen_random_uuid()::text, 'queue');
      delete from public.queue_entries where id in (pending.id, cur.id);
      paired := paired + 1;
      pending := null;
    else
      pending := cur;
    end if;
  end loop;
  return paired;
end;
$$;

-- Accepting is a function, not an UPDATE, for two reasons: the row must be
-- locked while its state is checked, and a taker permitted to write this row is
-- a taker permitted to edit the terms they are agreeing to. The team the taker
-- is bringing has to come in as an argument, not from a client-writable
-- column: `matches.team_b` is NOT NULL, and there is deliberately no update
-- policy that would let a taker stage their roster into match_offers first.
create function public.accept_offer(p_offer uuid, p_team jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  taker uuid := (select auth.uid());
  new_match uuid;
begin
  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
  if p_team is null then raise exception 'you must supply the team you are accepting with'; end if;
  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
  -- told the offer is taken. Skipping would tell them "no such offer", a
  -- different and misleading answer.
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
  if o.verified_hash is null then raise exception 'this offer has not been verified yet'; end if;
  if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;

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
  update public.match_offers
     set state = 'accepted', accepted_by = taker, accepted_team = p_team, accepted_at = now()
   where id = p_offer;
  return null;
end;
$$;

create function public.confirm_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  me uuid := (select auth.uid());
  new_match uuid;
begin
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;

  -- team_b is the roster the taker accepted with, captured by accept_offer()
  -- into accepted_team — the proposer confirming does not get to supply it.
  insert into public.matches
    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
  values
    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, o.accepted_team,
     o.data_rev, gen_random_uuid()::text, 'offer')
  returning id into new_match;
  update public.match_offers
     set state = 'converted', confirmed_at = now(), match_id = new_match
   where id = p_offer;
  return new_match;
end;
$$;

-- Expiry is a sweep, not a trigger: nothing touches a stale row to fire a
-- trigger on. An offer past its window LAPSES — it does not quietly convert,
-- because the calendar has to mean something.
create function public.sweep_expired() returns integer
language plpgsql security definer set search_path = public as $$
declare swept integer := 0;
begin
  delete from public.queue_entries where expires_at <= now();
  get diagnostics swept = row_count;
  update public.match_offers set state = 'lapsed'
   where state in ('open', 'accepted') and expires_at <= now();
  return swept;
end;
$$;

-- The invariant Task 4 deferred: accepted_team was added with no constraint
-- tying it to accepted_by. An accepted_by with no team would be an
-- acceptance whose roster was lost, and confirm_offer() would then try to
-- write a null into matches.team_b, which is NOT NULL — a failure at
-- confirmation time for a mistake made at acceptance time. accept_offer()
-- above always writes both columns together, so this constraint should never
-- fire from that path; it exists to close off any other write reaching the
-- same inconsistent state (a direct UPDATE, a future function).
--
-- Deliberately one-directional (accepted_by null implies nothing about
-- accepted_team), not "both null or both set": accepted_by is
-- `on delete set null`, so deleting the taker's account nulls it while
-- accepted_team stays behind as a snapshot of a roster with nobody attached.
-- A symmetric constraint would turn that ON DELETE SET NULL into a constraint
-- violation and make the account undeletable.
alter table public.match_offers
  add constraint match_offers_accepted_needs_team
  check (accepted_by is null or accepted_team is not null);

-- pair_queue_entries() and sweep_expired() are coordinator-only: Task 6's
-- coordinator calls both over PostgREST as service_role, and nobody else has
-- any business running a global scan of every user's queue and offers.
revoke all on function public.pair_queue_entries() from public, anon, authenticated;
revoke all on function public.sweep_expired() from public, anon, authenticated;
grant execute on function public.pair_queue_entries() to service_role;
grant execute on function public.sweep_expired() to service_role;

-- accept_offer/confirm_offer are user-facing and revoked from PUBLIC (which
-- `create function` grants by default) so an unauthenticated request gets
-- "permission denied" rather than reaching the "you must be signed in" check
-- inside the function body.
revoke all on function public.accept_offer(uuid, jsonb) from public, anon;
revoke all on function public.confirm_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid, jsonb) to authenticated;
grant execute on function public.confirm_offer(uuid) to authenticated;
