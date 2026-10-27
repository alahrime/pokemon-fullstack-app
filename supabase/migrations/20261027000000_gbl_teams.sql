-- Battle Tracker: saved teams of three.
--
-- Some players lock in one team for the whole day; others switch between a
-- handful or more. A saved team is just the three species refs, lead first, so
-- the logging panel can fill "Your team" with one tap. Kept per player, shared
-- by their alt accounts. Only the owner ever reads them.

create table public.gbl_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  team text[] not null check (cardinality(team) = 3),
  created_at timestamptz not null default now()
);
create unique index gbl_teams_team on public.gbl_teams (user_id, team);

alter table public.gbl_teams enable row level security;
revoke all on public.gbl_teams from anon;
grant select, insert, delete on public.gbl_teams to authenticated;
create policy "a saved team is its owner's" on public.gbl_teams for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
