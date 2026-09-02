-- A saved roster. Owner-only in every direction — unlike profiles, which are
-- broadly readable, nothing about a team is anyone else's business yet. M2
-- stores a team SNAPSHOT on the match rather than sharing this row, precisely
-- so that editing a team cannot rewrite the history of a match it played.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  -- `default auth.uid()`, not just `not null`: Task 3's client code
  -- deliberately never sends owner_id, so exactly one place (this default)
  -- decides who owns a row. Plain auth.uid(), not the (select ...) form used
  -- in policies below — a column default evaluates once per inserted row,
  -- not per row scanned by a predicate, so there is nothing for the planner
  -- to hoist.
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name text not null,
  -- The league id as the client knows it ('great' | 'ultra' | 'master' | …).
  -- Deliberately text, not an enum: leagues are data in this app, and a new cup
  -- must not need a migration to be saveable.
  league text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per slot. `slot` is part of the key rather than an ordering column,
-- because a roster is positional — the chain simulation plays members in order,
-- so "which slot" is data, not presentation.
create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  slot smallint not null,
  -- May carry a `_shadow` suffix. Shadow lives in the ref, per the spec's build
  -- identity section, so there is no separate shadow flag to disagree with it.
  ref text not null,
  -- The fast move's ID, never the index the builder holds it by. species.json is
  -- generated; a regeneration that reorders a movepool would silently repoint a
  -- stored index at a different move, turning a saved team into a different team
  -- with nothing to show for it.
  fast_move text not null,
  charge_moves text[] not null default '{}',
  iv_attack smallint not null,
  iv_defense smallint not null,
  iv_stamina smallint not null,
  -- Recorded, not authoritative: the engine derives level from IVs and the
  -- league cap. Stored so a saved team can be shown without recomputing, and so
  -- a future data change that moves a level can be DETECTED rather than
  -- silently applied.
  level numeric(3,1),
  primary key (team_id, slot),
  constraint team_members_slot_range check (slot between 1 and 6),
  constraint team_members_iv_range check (
    iv_attack between 0 and 15
    and iv_defense between 0 and 15
    and iv_stamina between 0 and 15
  ),
  constraint team_members_charge_count check (cardinality(charge_moves) <= 2)
);

-- The policy below subqueries this column on every row it checks.
create index team_members_team_id_idx on public.team_members (team_id);
create index teams_owner_id_idx on public.teams (owner_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- One `for all` policy rather than a separate select: every verb has the same
-- rule here. friend_codes needed the pair because M3 widens its SELECT branch
-- alone; nothing widens this one.
create policy "a team is its owner's alone"
  on public.teams for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Ownership lives on the parent, so the child asks it. `(select auth.uid())`
-- again: this predicate runs once per member row.
create policy "team members follow their team"
  on public.team_members for all
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.owner_id = (select auth.uid())
    )
  );
