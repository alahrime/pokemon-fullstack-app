-- The offer path never compared `data_rev`; the queue path refuses to pair
-- across builds and says why.
--
-- pair_queue_entries() will not pair two entries whose `data_rev` differs, and
-- the comment there gives the reason: "a random draw both sides compute must
-- deal from the same pool; two clients on different data would agree on the
-- rules and disagree on what satisfies them". accept_offer() never received
-- the taker's `data_rev` and never compared it, so `matches.data_rev` was the
-- PROPOSER's build alone and the taker was silently entered into a match whose
-- draw they cannot reproduce.
--
-- The offer path is where this matters MOST, not least. A queue entry lives
-- ten minutes; a scheduled offer is explicitly for later. The spec's own
-- example is this exact case — "a random-draw match agreed on Tuesday and
-- played on Friday must deal the same six" — and Tuesday-to-Friday is
-- precisely the interval a data release lands in.
--
-- Done now rather than in M2b because it is a signature change. Today it costs
-- one argument and a call site; after the branch ships it is a migration under
-- live data, against rows already written on the wrong premise.
--
-- The 2-argument form is DROPPED rather than left beside this one as an
-- overload. Keeping it would leave the unchecked path reachable by any client
-- that simply omits the new argument — the same shape of defect as the one
-- being fixed.
drop function public.accept_offer(uuid, jsonb);

create function public.accept_offer(p_offer uuid, p_team jsonb, p_data_rev text) returns uuid
language plpgsql security definer set search_path = public as $$
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
  if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;
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
$$;

-- The same grants the 2-argument form carried. `create function` grants
-- EXECUTE to PUBLIC by default, so without the revoke an unauthenticated
-- request would reach the "you must be signed in" check inside the body
-- instead of being refused at the door.
revoke all on function public.accept_offer(uuid, jsonb, text) from public, anon;
grant execute on function public.accept_offer(uuid, jsonb, text) to authenticated;
