-- Someone waiting to be matched, blind: no opponent chosen, no format browsed.
create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  league text not null,
  format_version_id uuid not null references public.format_versions (id) on delete cascade,
  -- What the CLIENT says this format hashes to. Never trusted: the coordinator
  -- recomputes it from format_versions.rules and writes verified_hash, and only
  -- verified entries are eligible to pair. A client that lies lands in no queue
  -- rather than in a stranger's.
  claimed_hash text not null,
  verified_hash text,
  -- The roster as saved, not a pointer to `teams`: editing a team afterwards
  -- must not change what was queued with.
  team jsonb not null,
  data_rev text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

-- One at a time. Two entries for one person can be paired with each other by a
-- coordinator that only checks "different rows", and a self-match is a bug that
-- looks like a feature until someone reports their own friend code back to them.
create unique index queue_entries_one_per_user on public.queue_entries (user_id);
-- The pairing scan reads exactly this.
create index queue_entries_pairing_idx on public.queue_entries (verified_hash, league, created_at)
  where verified_hash is not null;

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_a uuid not null references public.profiles (id) on delete cascade,
  player_b uuid not null references public.profiles (id) on delete cascade,
  -- RESTRICT, deliberately, not CASCADE. format_versions are immutable so that
  -- a match's terms stay readable for years; letting a delete cascade through
  -- here would make that guarantee hold everywhere except where it matters.
  format_version_id uuid not null references public.format_versions (id) on delete restrict,
  -- The VERIFIED hash, copied from the entries that produced this row.
  rules_hash text not null,
  team_a jsonb not null,
  team_b jsonb not null,
  data_rev text not null,
  seed text not null,
  rounds smallint not null default 3,
  state text not null default 'paired',
  source text not null,
  created_at timestamptz not null default now(),
  constraint matches_distinct_players check (player_a <> player_b),
  constraint matches_rounds check (rounds in (3, 5)),
  constraint matches_source check (source in ('queue', 'offer')),
  constraint matches_state check (state in ('paired', 'abandoned'))
);

create index matches_player_a_idx on public.matches (player_a);
create index matches_player_b_idx on public.matches (player_b);

alter table public.queue_entries enable row level security;
alter table public.matches enable row level security;

create policy "a queue entry is its owner's"
  on public.queue_entries for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- SELECT only, and only for the two people in it. There is deliberately no
-- insert, update or delete policy: a match is created by the pairing functions
-- running as the table owner, so every client write is refused by default-deny
-- rather than by a rule somebody could loosen.
create policy "a match is visible to the two people in it"
  on public.matches for select
  to authenticated
  using ((select auth.uid()) in (player_a, player_b));

-- The one widening in this migration. A friend code was owner-only, because it
-- is the handle someone is contacted by. An opponent gets it for the duration
-- of a match and by no other route.
create policy "an opponent may read your friend code while you have a match"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.state = 'paired'
        and ((m.player_a = friend_codes.profile_id and m.player_b = (select auth.uid()))
          or (m.player_b = friend_codes.profile_id and m.player_a = (select auth.uid())))
    )
  );
