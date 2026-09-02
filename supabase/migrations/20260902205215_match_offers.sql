-- A proposition, not a queue entry. The difference that earns a separate table
-- is review: an opponent reads the format before agreeing, which a blind queue
-- by definition does not allow.
create table public.match_offers (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  format_version_id uuid not null references public.format_versions (id) on delete restrict,
  claimed_hash text not null,
  verified_hash text,
  league text not null,
  team jsonb not null,
  data_rev text not null,
  visibility public.format_visibility not null default 'public',
  -- Null for the live board: playable now. Set for a proposal at a stated time.
  scheduled_for timestamptz,
  -- The handshake window. Both sides must be inside it, and an offer that
  -- reaches it unconfirmed LAPSES rather than converting — a scheduled battle
  -- on the board is one both people committed to, not one somebody was
  -- nominated for.
  expires_at timestamptz not null default now() + interval '1 hour',
  accepted_by uuid references public.profiles (id) on delete set null,
  -- The taker's roster as saved at the moment they accepted, not a pointer
  -- into `teams`: editing a team afterwards must not change what was accepted
  -- with, and Task 5's accept_offer() writes it here alongside accepted_by so
  -- a converted offer has both rosters that matches.team_a/team_b need.
  -- Null until someone accepts.
  accepted_team jsonb,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  match_id uuid references public.matches (id) on delete set null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  constraint match_offers_state check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted')),
  constraint match_offers_not_self check (accepted_by is null or accepted_by <> proposer_id),
  constraint match_offers_scheduled_future check (scheduled_for is null or scheduled_for > created_at)
);

create index match_offers_open_idx on public.match_offers (visibility, league, created_at)
  where state = 'open';
create index match_offers_expiry_idx on public.match_offers (expires_at) where state in ('open', 'accepted');

alter table public.match_offers enable row level security;

create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check ((select auth.uid()) = proposer_id);

-- Same shape as "a public format is readable by anyone signed in", which is
-- the precedent this copies rather than invents.
create policy "a public offer is readable by anyone signed in"
  on public.match_offers for select
  to authenticated
  using (visibility = 'public' or (select auth.uid()) = accepted_by);

-- Accepting is done through accept_offer(), not by a client UPDATE. There is
-- deliberately no update policy for a taker: letting them write this row is
-- letting them edit the terms they are agreeing to, and no WITH CHECK
-- expressible here can say "you may set accepted_by and nothing else".
