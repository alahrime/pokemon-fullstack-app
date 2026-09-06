-- Task 3: an accepted friendship becomes a second route to a friend code, and
-- a block finally reaches the two places matchmaking can put a blocked pair
-- together. One migration for both, because they are one idea — but
-- implementing the brief this task started from surfaced two places where
-- following it literally would break at query time, invisible to
-- `db:reset`. Both are called out below, next to the fix.

-- ---------------------------------------------------------------------------
-- Part 1: a friend can read your friend code.

-- Correction: `pair_lo`/`pair_hi` are not executable by `authenticated`.
--
-- 20260906000000_friendships_and_blocks.sql revoked EXECUTE on both from
-- public, anon and authenticated, on the reasoning (stated in its own
-- comment) that nothing yet called them from outside a SECURITY DEFINER
-- function. The policy just below is the first caller that is NOT one: an
-- RLS USING clause always runs with the privileges of the QUERYING role, not
-- the table owner's, regardless of what SECURITY DEFINER function happens to
-- be on the call stack elsewhere. Without this grant, every authenticated
-- `select` against `friend_codes` would fail at query time with "permission
-- denied for function pair_lo(uuid,uuid)" — a failure `db:reset` cannot
-- surface, since it never runs a query against the policy it just installed.
--
-- Safe to grant: both functions take two uuids the caller already supplied,
-- touch no table, and return the same `least`/`greatest` for anyone who asks
-- with the same pair. There is nothing here for the grant to leak.
grant execute on function public.pair_lo(uuid, uuid) to authenticated;
grant execute on function public.pair_hi(uuid, uuid) to authenticated;

-- The third route to a friend code, beside "it is yours" and "we share a live
-- match" (both already policies on this table). Accepted only: a pending
-- request must not leak the thing the request is for, or sending one becomes
-- the way to read it.
create policy "an accepted friend may read your friend code"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and f.user_lo = public.pair_lo(friend_codes.profile_id, (select auth.uid()))
         and f.user_hi = public.pair_hi(friend_codes.profile_id, (select auth.uid()))
         and (select auth.uid()) <> friend_codes.profile_id
    )
  );

-- ---------------------------------------------------------------------------
-- Part 2: a block reaches the queue and the offer board.
--
-- `blocks` cannot enforce itself: the blocked side has no read on it at all,
-- by design (see the comment on "a block belongs to the person who made it"
-- in 20260906000000_friendships_and_blocks.sql). Enforcement instead lives in
-- the places a block is supposed to bite — the scattering the spec calls
-- for, made explicit here rather than left implied.

-- 1. The blind queue. The pairing scan must SKIP a blocked pair and leave
--    both entries queued for somebody else — not consume them, and not
--    error, since an error from pairing is a signal the blocked side could
--    read (a blocked user who watches their queue entry vanish while nobody
--    ever appears on the other end of a match has learned nothing; one who
--    gets an error every tick has learned something).
--
--    Rewritten from the single-pass scan in
--    20260903005933_pairing_functions.sql, which paired whichever entry
--    happened to come immediately next in `(verified_hash, league, data_rev,
--    created_at)` order and had no way to reject that one candidate and keep
--    looking within the same group without restructuring the whole scan —
--    exactly what a block needs to do. This version locks one entry (`a`) at
--    a time in `created_at` order and searches for the best remaining
--    partner sharing its hash, league, and data build — everything the old
--    version required to pair, unchanged — excluding anyone `a` is blocked
--    with in either direction. `data_rev` equality is carried over for the
--    same reason it was there before: a random draw both sides compute must
--    deal from the same pool, or two clients on different data would agree
--    on the rules and disagree on what satisfies them.
--
--    The concurrency guarantees `supabase/tests/pairing.test.ts` pins are
--    unchanged by this rewrite: both the outer scan and the inner partner
--    search still use `for update skip locked`, so a locked row is still
--    skipped rather than blocked on, and two overlapping ticks still cannot
--    turn one pair into two matches — each tick's own lock on a row makes it
--    invisible to the other's `skip locked` scan, in the outer loop and the
--    inner search alike.
create or replace function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  a public.queue_entries;
  b public.queue_entries;
  paired integer := 0;
begin
  for a in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by created_at
     for update skip locked
  loop
    -- `a` may have already been consumed as somebody else's `b` earlier in
    -- this same loop.
    if not exists (select 1 from public.queue_entries where id = a.id) then
      continue;
    end if;

    select * into b from public.queue_entries q
     where q.verified_hash = a.verified_hash
       and q.league = a.league
       and q.data_rev = a.data_rev
       and q.user_id <> a.user_id
       and q.expires_at > now()
       and q.id <> a.id
       and not public.blocked_between(a.user_id, q.user_id)
     order by q.created_at
     limit 1
     for update skip locked;

    if not found then continue; end if;

    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (a.user_id, b.user_id, a.format_version_id, a.verified_hash, a.team, b.team,
       a.data_rev, gen_random_uuid()::text, 'queue');

    delete from public.queue_entries where id in (a.id, b.id);
    paired := paired + 1;
  end loop;
  return paired;
end;
$fn$;

-- `create or replace function` preserves the name's existing grants (checked:
-- `pg_proc.proacl` for `pair_queue_entries` already excludes
-- public/anon/authenticated and includes `service_role`, from
-- 20260903005933_pairing_functions.sql) — no revoke/grant pair to repeat
-- here, matching the precedent already noted on `confirm_offer` in
-- 20260905124300_scheduled_matches_carry_their_play_time.sql.

-- 2. The offer board. Accepting is a deliberate act aimed at a named person,
--    so unlike the queue it may refuse out loud — but the sentence it uses
--    says only that the offer is gone, which is also what a genuinely lapsed
--    offer says. A blocked taker who is refused this way cannot tell their
--    block from an offer that simply expired underneath them.
--
--    Correction: this trigger function is declared SECURITY DEFINER, unlike
--    the brief it was drafted from. It fires from `accept_offer`'s own
--    `update ... set accepted_by = taker`, and its body calls
--    `blocked_between`, which is revoked from `authenticated` (see
--    20260906001000_friendship_functions.sql) and must stay that way: it is
--    itself SECURITY DEFINER and answers for ANY pair while bypassing RLS, so
--    granting `authenticated` EXECUTE on it would hand every signed-in user a
--    working detector for whether two arbitrary strangers have blocked each
--    other — exactly the detectability this whole design exists to prevent.
--    A plain (SECURITY INVOKER) trigger function has no grant of its own to
--    fall back on and would need that grant to run at all, which is not a
--    trade worth making. Declaring the trigger itself SECURITY DEFINER lets
--    it call `blocked_between` as the owner instead, so no grant is needed
--    and the function stays exactly as unreachable to `authenticated` as it
--    was before this migration.
create or replace function public.accept_offer_blocked_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.accepted_by is not null
     and public.blocked_between(new.proposer_id, new.accepted_by) then
    raise exception 'this offer is no longer available';
  end if;
  return new;
end;
$fn$;

-- Correction: a bare `before update` fires on EVERY update to this row, not
-- only the acceptance that sets `accepted_by`. `sweep_expired()` (deployed,
-- 20260903005933_pairing_functions.sql) bulk-updates
-- `state in ('open', 'accepted')` rows to 'lapsed' with no `accepted_by`
-- clause, and for an already-accepted, blocked offer that update leaves
-- `new.accepted_by` unchanged (still the taker) — so the guard above raises
-- inside the sweep itself. Reproduced against the live database: the
-- exception propagates out of `sweep_expired()`'s single transaction, which
-- rolls back the `delete from queue_entries where expires_at <= now()` that
-- already ran earlier in the SAME function, and `coordinator/index.ts`
-- discards `sweep_expired`'s RPC error — so the tick keeps returning 200
-- while, from that moment, nothing ever expires from the queue or lapses
-- from the offer board again, for anyone.
--
-- The `when` clause below scopes the trigger to exactly the transition the
-- guard exists to police: `accepted_by` going from one value to another
-- (including null to non-null, the ordinary accept). A sweep's update never
-- changes `accepted_by`, so `old.accepted_by is distinct from
-- new.accepted_by` is false for it and the trigger does not fire at all —
-- while a genuine accept (`accept_offer()` setting `accepted_by = taker` for
-- the first time) still changes the column and still fires, so the guard
-- still catches it. `is distinct from`, not `<>`: `old.accepted_by` is null
-- on the ordinary accept path, and `<>` against a null evaluates to null,
-- which `when` treats as "do not fire" — the one case this guard must never
-- skip.
create trigger match_offers_block_guard
  before update on public.match_offers
  for each row
  when (old.accepted_by is distinct from new.accepted_by)
  execute function public.accept_offer_blocked_guard();
