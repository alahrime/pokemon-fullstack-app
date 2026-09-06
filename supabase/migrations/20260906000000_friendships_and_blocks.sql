-- Canonical ordering, as two immutable functions so every caller orders a pair
-- the same way and none of them writes the comparison out by hand.
create or replace function public.pair_lo(a uuid, b uuid) returns uuid
language sql immutable as $fn$ select least(a, b) $fn$;

create or replace function public.pair_hi(a uuid, b uuid) returns uuid
language sql immutable as $fn$ select greatest(a, b) $fn$;

-- `create function` grants EXECUTE to PUBLIC by default. Neither function
-- touches a table or reads a claim, so PUBLIC execute would leak nothing on
-- its own — but nothing in this migration calls them either (the
-- friendships_ordered check below writes `user_lo < user_hi` directly, and
-- no policy here needs a canonical pair computed). Revoking now closes the
-- default rather than leaving it open for however long it takes a later
-- migration to add the first caller; that migration grants execute to
-- whatever role turns out to need it once one exists.
revoke all on function public.pair_lo(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pair_hi(uuid, uuid) from public, anon, authenticated;

-- ONE row per pair. Not one per direction: two rows for one friendship is how
-- "A thinks we are friends and B has a pending request" becomes representable,
-- and it is not a state anyone should have to write code against.
create table public.friendships (
  user_lo uuid not null references public.profiles (id) on delete cascade,
  user_hi uuid not null references public.profiles (id) on delete cascade,
  -- Which of the two asked. Needed to know who may accept: the requester
  -- accepting their own request is the whole point of storing this.
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_lo, user_hi),
  constraint friendships_ordered check (user_lo < user_hi),
  constraint friendships_status check (status in ('pending', 'accepted')),
  constraint friendships_requester_is_a_party check (requested_by in (user_lo, user_hi))
);

create index friendships_hi_idx on public.friendships (user_hi);

-- One-directional, and deliberately not symmetric with friendships.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_distinct check (blocker_id <> blocked_id)
);

-- The blocked side is looked up constantly by the enforcement clauses below.
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.friendships enable row level security;
alter table public.blocks enable row level security;

create policy "a friendship is visible to its two sides"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) in (user_lo, user_hi));

-- No write policy: every change goes through the functions in the next
-- migration, which are the only place that canonicalises a pair and checks a
-- block. Revoked as well as unpoliced, so a later `for all` policy cannot
-- quietly turn default-deny into a grant. `anon` is included alongside
-- `authenticated`, matching the precedent this table's own repo already sets
-- (20260905124000_match_reports_and_rounds.sql revokes writes from
-- `anon, authenticated` together) — RLS default-denies `anon` regardless
-- since no policy below grants it anything, so this closes an inconsistency
-- with that precedent rather than an actual hole.
revoke insert, update, delete on public.friendships from anon, authenticated;

-- A block is yours alone. There is no policy for the blocked side at ALL —
-- not a narrowed one — because any row they can see, or count, is a signal.
--
-- SELECT and DELETE only, not `for all`: creating a block goes through
-- `block_user()` in the next migration, which is SECURITY DEFINER, owned by
-- `postgres` (which owns this table), and so bypasses RLS entirely — the
-- INSERT and UPDATE arms of a `for all` grant are dead to that path and only
-- ever matter to a caller going around it with a direct
-- `POST /rest/v1/blocks`. INSERT would let such a caller create a block
-- while the friendship survives, exactly the state `block_user()`'s own
-- comment says must never exist ("a block that leaves the friendship
-- standing is not a block") — leaving the blocked side able to still read
-- the blocker's friend code, both still listed as each other's friend, and
-- `respond_to_friendship()` able to accept a pending request from someone
-- you meant to have cut off. UPDATE would additionally let a caller repoint
-- `blocked_id` on a row they own. Narrowing to SELECT and DELETE keeps the
-- two things a client legitimately needs to do to its own blocks directly —
-- list them, remove them — while forcing creation through the one function
-- that also tears down the friendship in the same transaction. Two separate
-- policies rather than one `for all`: CREATE POLICY takes exactly one
-- command keyword (or ALL) — "for select, delete" is not valid syntax — and
-- splitting them costs nothing since both share the same USING clause.
create policy "a block belongs to the person who made it"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

create policy "only the blocker may remove their own block"
  on public.blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()));
