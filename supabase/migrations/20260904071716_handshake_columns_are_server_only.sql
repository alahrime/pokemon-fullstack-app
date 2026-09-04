-- The trust boundary was opt-in. Two Criticals, both measured against this
-- database before this migration was written, both closed here.
--
-- ROOT CAUSE, shared by both. Supabase grants every table privilege to `anon`
-- and `authenticated` at creation time, and RLS narrows those grants by ROW,
-- never by COLUMN. Both owner policies read
--
--     for all ... using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- which says "this row must be yours" and says NOTHING about which columns you
-- may write in it. So every column of a row you own — including the ones the
-- coordinator and the two SECURITY DEFINER functions are the sole intended
-- authors of — was client-writable.
--
-- C1, measured: a plain authenticated user ran
--
--   insert into public.queue_entries
--     (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
--   values ('great', '<own version>', 'I-NEVER-COMPUTED-THIS',
--           'forged-verified-hash', '[]'::jsonb, 'rev1');
--
-- and it returned INSERT 0 1. The coordinator reads only rows where
-- `verified_hash is null`, so a self-verified row is never examined, never
-- recomputed, and pairs on the next tick. That falsifies the comment this
-- codebase wrote on the column ("A client that lies lands in no queue rather
-- than in a stranger's") and the whole claim that recomputation is the one
-- place a client's claim about its own format is checked by something the
-- client does not control. Verification was, until now, something a client
-- could decline.
--
-- C2, measured: a proposer forges a match against ANY user and harvests their
-- friend code. Four steps, every one of which succeeded:
--   1. create their own offer (legitimate);
--   2. UPDATE that row setting accepted_by = <a victim who never saw it>,
--      accepted_team = '[]'::jsonb, accepted_at = now(), state = 'accepted' —
--      reported UPDATE 1, and both CHECK constraints pass, because
--      match_offers_not_self only forbids accepting your OWN offer and
--      match_offers_accepted_needs_team is satisfied by the empty roster;
--   3. select public.confirm_offer(<offer>) — returns a real match id with
--      player_b = <victim>, because confirm_offer trusts state = 'accepted'
--      and accepted_by as things only accept_offer could have written;
--   4. select the victim's friend code — returned, because "an opponent may
--      read your friend code while you have a match" is now true.
-- Victims are enumerable: `profiles` is readable by anyone signed in. And the
-- victim cannot undo it: `matches` has no UPDATE and no DELETE policy for
-- clients, and nothing in M2a sets state = 'abandoned'.
--
-- THE FIX, in three parts.

-- 1. Clients need INSERT (join a queue, post an offer) and DELETE (leave,
-- withdraw). They never need UPDATE. Every legitimate mutation of an existing
-- row here is made by something that is not the client: the coordinator writes
-- `verified_hash` as `service_role`, and accept_offer/confirm_offer/
-- sweep_expired write the handshake columns as SECURITY DEFINER functions
-- owned by `postgres`. Removing the privilege is what makes that sentence
-- true, rather than merely intended.
--
-- This is the part that closes C2 outright: step 2 of the chain is an UPDATE,
-- and it is now refused with `42501 permission denied for table match_offers`
-- — a raised error, not a silently-filtered zero-row statement.
revoke update on public.queue_entries from anon, authenticated;
revoke update on public.match_offers from anon, authenticated;

-- 1b. TRUNCATE, found while measuring the above and in the same family: the
-- default grant included it, and TRUNCATE does not consult row-level security
-- at all. `truncate public.queue_entries` as a plain authenticated user
-- returned TRUNCATE TABLE — one client emptying every user's queue, every
-- open offer, and (cascading through the match_offers FK) every match. There
-- is no legitimate client truncate of anything, ever.
--
-- Scoped to the three M2a tables because they are what this milestone owns.
-- The same default grant is on every other table in `public` and revoking it
-- there is a separate migration and a separate decision, recorded rather than
-- silently half-done.
revoke truncate on public.queue_entries, public.match_offers, public.matches
  from anon, authenticated;

-- 2. Narrow what a client may INSERT. The revoke above stops a row being
-- edited into a privileged state after the fact; this stops one being CREATED
-- in it — which is exactly C1, an INSERT that arrives already verified.
--
-- WITH CHECK is the only tool that can say this, and it can only say it about
-- the row as a whole, which is why every server-owned column has to be named
-- as "must still be null" rather than "you may not write it". The effect is
-- the same: the only value a client may supply for any of them is the value
-- they would have had anyway.
--
-- The policies stay `for all` and keep their names. USING is unchanged, so
-- SELECT and DELETE behave exactly as before and every existing test of them
-- still describes the truth. WITH CHECK now also guards UPDATE — dead today
-- because the privilege is gone, and deliberately kept as the second line: if
-- some future migration re-grants UPDATE, forging an acceptance is refused by
-- the policy rather than becoming possible again by omission.
drop policy "a queue entry is its owner's" on public.queue_entries;
create policy "a queue entry is its owner's"
  on public.queue_entries for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    -- The trust boundary, stated where it is enforceable. `verified_hash` is
    -- the coordinator's answer to `claimed_hash`; a client supplying it is a
    -- client marking its own homework.
    and verified_hash is null
  );

drop policy "an offer belongs to the person who proposed it" on public.match_offers;
create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check (
    (select auth.uid()) = proposer_id
    and verified_hash is null
    -- The whole handshake, in the state a brand new offer has. accept_offer()
    -- writes the first four; confirm_offer() writes the last two and moves
    -- state; sweep_expired() moves state. A client posting an offer has
    -- nothing to say about any of it.
    and accepted_by is null
    and accepted_team is null
    and accepted_at is null
    and confirmed_at is null
    and match_id is null
    and state = 'open'
  );

-- 3. What this does NOT touch, checked rather than assumed:
--
--   * `service_role` has rolbypassrls = t on this stack (verified: select
--     rolname, rolbypassrls from pg_roles). It is not named in either revoke
--     and keeps its own UPDATE grant, so the coordinator's
--     `update({verified_hash}).eq('id', ...)` over PostgREST is unaffected by
--     both halves of this migration — the grant and the policy.
--   * accept_offer, confirm_offer, pair_queue_entries and sweep_expired are
--     SECURITY DEFINER, owned by `postgres`, which owns these tables. They
--     execute with the owner's privileges and bypass RLS on their own tables,
--     so they too are unaffected — and they are now the ONLY writers of the
--     columns above, which is what they were always documented to be.
--   * `postgres` keeps everything; the test suite's fixture connection and
--     every migration run as that role.
