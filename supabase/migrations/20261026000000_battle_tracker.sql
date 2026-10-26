-- Battle Tracker: a notebook for GO Battle League, the in-game ladder.
--
-- GBL is played in sets of five battles, up to five sets a day, each set moving
-- the player's in-game Elo. Nothing here is verifiable — it is what the player
-- writes down — so it is kept apart from matches/match_rounds, whose results two
-- players confirm. A GBL win is never a Paragon match win, and neither table
-- feeds the other's record.
--
-- Visibility, in three rings:
--   * your own sets and battles: the owner-only policies below;
--   * your friends: your season through gbl_season_sets, like friend_record;
--   * everyone signed in: only if you opt in with profiles.gbl_public, which puts
--     you on gbl_leaderboard and counts your battles toward gbl_meta.
-- A block closes the second and third rings both ways.

alter table public.profiles
  add column gbl_public boolean not null default false;

create table public.gbl_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  season smallint not null check (season between 1 and 999),
  -- A preset format key (great, ultra, master, or a cup such as retro).
  format text not null check (format ~ '^[a-z0-9-]{1,40}$'),
  -- Species refs of the three brought, lead first; empty when not recorded.
  team text[] not null default '{}'
    check (cardinality(team) <= 3 and array_position(team, null) is null),
  elo_start smallint check (elo_start between 0 and 4000),
  elo_end smallint check (elo_end between 0 and 4000),
  started_at timestamptz not null default now()
);
create index gbl_sets_user_season on public.gbl_sets (user_id, season, started_at);

create table public.gbl_battles (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.gbl_sets (id) on delete cascade,
  -- Carried so the policies below need no join; the insert check ties it to the set's owner.
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  idx smallint not null check (idx between 1 and 5),
  -- Null: played, but no result written down (a disconnect, a skipped entry).
  result text check (result in ('win', 'loss', 'tie')),
  -- The opponent's Pokémon as seen, lead first.
  opponents text[] not null default '{}'
    check (cardinality(opponents) <= 3 and array_position(opponents, null) is null),
  -- The moves seen on each of them, by position in `opponents`: {"fast": id | null, "charges": [id]}.
  -- Only what the player saw; an unseen move is absent, never guessed.
  opponent_moves jsonb not null default '[]'
    check (jsonb_typeof(opponent_moves) = 'array' and jsonb_array_length(opponent_moves) <= 3),
  -- The player's own note on this battle. Owner-only: no function below returns it.
  note text check (length(note) <= 1000),
  -- Set by the client when a past day is logged after the fact.
  played_at timestamptz not null default now(),
  unique (set_id, idx)
);
create index gbl_battles_played on public.gbl_battles (played_at);

alter table public.gbl_sets enable row level security;
alter table public.gbl_battles enable row level security;
-- Supabase's default privileges hand new tables to anon too; refused outright rather than filtered to nothing.
revoke all on public.gbl_sets, public.gbl_battles from anon;
grant select, insert, update, delete on public.gbl_sets, public.gbl_battles to authenticated;

create policy "a set is its owner's" on public.gbl_sets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "a battle is its owner's, in its owner's set" on public.gbl_battles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.gbl_sets s where s.id = set_id and s.user_id = (select auth.uid())));

-- Whose GBL season the caller may read: their own, an unblocked friend's, or an
-- unblocked opted-in player's.
create or replace function public.gbl_visible(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_user = (select auth.uid())
      or (not public.blocked_between((select auth.uid()), p_user)
          and (public.are_friends((select auth.uid()), p_user)
               or exists (select 1 from public.profiles p where p.id = p_user and p.gbl_public)))
$fn$;
revoke all on function public.gbl_visible(uuid) from public, anon;
grant execute on function public.gbl_visible(uuid) to authenticated;

-- One player's sets in a season with each set's tally, oldest first; empty for a
-- player the caller may not see.
create or replace function public.gbl_season_sets(p_user uuid, p_season smallint)
returns table (id uuid, format text, elo_start smallint, elo_end smallint, started_at timestamptz,
               wins integer, losses integer, ties integer, battles integer)
language sql stable security definer set search_path = public as $fn$
  select s.id, s.format, s.elo_start, s.elo_end, s.started_at,
         count(*) filter (where b.result = 'win')::integer,
         count(*) filter (where b.result = 'loss')::integer,
         count(*) filter (where b.result = 'tie')::integer,
         count(b.id)::integer
    from public.gbl_sets s
    left join public.gbl_battles b on b.set_id = s.id
   where s.user_id = p_user and s.season = p_season and public.gbl_visible(p_user)
   group by s.id
   order by s.started_at
$fn$;
revoke all on function public.gbl_season_sets(uuid, smallint) from public, anon;
grant execute on function public.gbl_season_sets(uuid, smallint) to authenticated;

-- The season's ladder: every player the caller may see who logged a set in it.
-- Elo is the last one written down (a set's end, else its start).
create or replace function public.gbl_leaderboard(p_season smallint)
returns table (user_id uuid, display_name text, avatar text, elo smallint, peak smallint,
               wins integer, losses integer, ties integer, battles integer, is_friend boolean)
language sql stable security definer set search_path = public as $fn$
  with sets as (
    select s.* from public.gbl_sets s where s.season = p_season and public.gbl_visible(s.user_id)
  ), tally as (
    select s.user_id,
           count(*) filter (where b.result = 'win')::integer as wins,
           count(*) filter (where b.result = 'loss')::integer as losses,
           count(*) filter (where b.result = 'tie')::integer as ties,
           count(b.id)::integer as battles
      from sets s left join public.gbl_battles b on b.set_id = s.id
     group by s.user_id
  ), last as (
    select distinct on (user_id) user_id, coalesce(elo_end, elo_start) as elo
      from sets where coalesce(elo_end, elo_start) is not null
     order by user_id, started_at desc
  ), peak as (
    select user_id, max(greatest(coalesce(elo_end, 0), coalesce(elo_start, 0)))::smallint as peak from sets group by user_id
  )
  select t.user_id, p.display_name, p.avatar, l.elo, nullif(k.peak, 0), t.wins, t.losses, t.ties, t.battles,
         public.are_friends((select auth.uid()), t.user_id)
    from tally t
    join public.profiles p on p.id = t.user_id
    left join last l on l.user_id = t.user_id
    left join peak k on k.user_id = t.user_id
   order by l.elo desc nulls last, t.wins desc
$fn$;
revoke all on function public.gbl_leaderboard(smallint) from public, anon;
grant execute on function public.gbl_leaderboard(smallint) to authenticated;

-- The battles the meta is counted from: a format since a moment, by opted-in
-- players and the caller, optionally only from sets started in an Elo band.
-- Internal — it carries who logged each battle, which the aggregates below
-- reduce to a count — so nobody but those functions may call it.
create or replace function public._gbl_meta_pop(p_format text, p_since timestamptz, p_lo smallint, p_hi smallint)
returns table (owner uuid, result text, opponents text[], opponent_moves jsonb)
language sql stable security definer set search_path = public as $fn$
  select s.user_id, b.result, b.opponents, b.opponent_moves
    from public.gbl_battles b
    join public.gbl_sets s on s.id = b.set_id
    join public.profiles p on p.id = s.user_id
   where s.format = p_format and b.played_at >= p_since
     and (p.gbl_public or s.user_id = (select auth.uid()))
     and not public.blocked_between((select auth.uid()), s.user_id)
     and (p_lo is null or s.elo_start >= p_lo)
     and (p_hi is null or s.elo_start <= p_hi)
$fn$;
revoke all on function public._gbl_meta_pop(text, timestamptz, smallint, smallint) from public, anon, authenticated;

-- What the ladder is bringing: every opponent Pokémon in that population.
-- wins/losses/ties are the logger's results against it, so a high win rate means
-- it is being beaten. battles and players are the population's totals, repeated
-- on every row.
create or replace function public.gbl_meta(p_format text, p_since timestamptz, p_lo smallint default null, p_hi smallint default null)
returns table (ref text, seen integer, wins integer, losses integer, ties integer, battles integer, players integer)
language sql stable security definer set search_path = public as $fn$
  with pop as (
    select * from public._gbl_meta_pop(p_format, p_since, p_lo, p_hi)
  ), totals as (
    select count(*)::integer as battles, count(distinct owner)::integer as players from pop
  )
  select o.ref, count(*)::integer,
         count(*) filter (where pop.result = 'win')::integer,
         count(*) filter (where pop.result = 'loss')::integer,
         count(*) filter (where pop.result = 'tie')::integer,
         t.battles, t.players
    from pop
    cross join lateral unnest(pop.opponents) as o(ref)
    cross join totals t
   group by o.ref, t.battles, t.players
   order by count(*) desc, o.ref
$fn$;
revoke all on function public.gbl_meta(text, timestamptz, smallint, smallint) from public, anon;
grant execute on function public.gbl_meta(text, timestamptz, smallint, smallint) to authenticated;

-- The moves players saw on each opponent Pokémon in the same population: how
-- often each fast and charged move was recorded, and out of how many sightings
-- with any move recorded at all (known), so a share is of what was seen.
create or replace function public.gbl_meta_moves(p_format text, p_since timestamptz, p_lo smallint default null, p_hi smallint default null)
returns table (ref text, kind text, move text, n integer, known integer)
language sql stable security definer set search_path = public as $fn$
  with seen as (
    select o.ref, pop.opponent_moves -> (o.ord::integer - 1) as m
      from public._gbl_meta_pop(p_format, p_since, p_lo, p_hi) pop
      cross join lateral unnest(pop.opponents) with ordinality as o(ref, ord)
  ), recorded as (
    select * from seen
     where m ->> 'fast' is not null or jsonb_array_length(coalesce(m -> 'charges', '[]'::jsonb)) > 0
  ), known as (
    select ref, count(*)::integer as known from recorded group by ref
  )
  select r.ref, 'fast', r.m ->> 'fast', count(*)::integer, k.known
    from recorded r join known k using (ref)
   where r.m ->> 'fast' is not null
   group by r.ref, r.m ->> 'fast', k.known
  union all
  select r.ref, 'charge', c.move, count(*)::integer, k.known
    from recorded r join known k using (ref)
    cross join lateral jsonb_array_elements_text(coalesce(r.m -> 'charges', '[]'::jsonb)) as c(move)
   group by r.ref, c.move, k.known
$fn$;
revoke all on function public.gbl_meta_moves(text, timestamptz, smallint, smallint) from public, anon;
grant execute on function public.gbl_meta_moves(text, timestamptz, smallint, smallint) to authenticated;
