-- Visibility is an enum because, unlike league, these three are a closed set the
-- policies branch on. A typo in a text column would silently make a format
-- private forever.
create type public.format_visibility as enum ('private', 'unlisted', 'public');

create table public.formats (
  id uuid primary key default gen_random_uuid(),
  -- `default auth.uid()`, not just `not null`: Task 3's client code
  -- deliberately never sends owner_id, so exactly one place (this default)
  -- decides who owns a row. Plain auth.uid(), not the (select ...) form used
  -- in policies below — a column default evaluates once per inserted row,
  -- not per row scanned by a predicate, so there is nothing for the planner
  -- to hoist.
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name text not null,
  visibility public.format_visibility not null default 'private',
  -- Where this was forked from, if anywhere. `on delete set null`: deleting the
  -- original must not cascade away every fork of it, and a fork is still a real
  -- format once its parent is gone.
  fork_of uuid references public.formats (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Immutable once written. Editing a format appends a version; nothing rewrites
-- one. There is deliberately no current_version_id on `formats` — the current
-- version is max(version), which avoids a circular foreign key between these two
-- tables and the deferrable constraint it would need.
create table public.format_versions (
  id uuid primary key default gen_random_uuid(),
  format_id uuid not null references public.formats (id) on delete cascade,
  version integer not null,
  rules jsonb not null,
  -- canonicalize() from app/src/rules. Computed on the CLIENT, because Postgres
  -- cannot run it. Nothing in M1b trusts this value; M2's queue partitions by it
  -- and MUST recompute it in the coordinator rather than believing a client.
  rules_hash text not null,
  created_at timestamptz not null default now(),
  unique (format_id, version)
);

create index format_versions_format_id_idx on public.format_versions (format_id);
create index formats_owner_id_idx on public.formats (owner_id);

-- Enforced in the database, not by convention: a rule the client merely agrees
-- to is not a rule. A format's meaning has to stay stable for years, and a
-- silently edited version would change which teams were legal in matches
-- already played under it.
create function public.freeze_format_version() returns trigger
language plpgsql as $$
begin
  raise exception 'a format version is immutable; append a new version instead';
end;
$$;

create trigger format_versions_immutable
  before update on public.format_versions
  for each row execute function public.freeze_format_version();

alter table public.formats enable row level security;
alter table public.format_versions enable row level security;

create policy "a format is its owner's to change"
  on public.formats for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Policies are OR'd, so this widens SELECT only. Unlisted is deliberately not
-- here: unlisted means "reachable if you have the id", which is a share
-- mechanism M1b does not have yet, and a policy is the wrong place to invent it.
create policy "a public format is readable by anyone signed in"
  on public.formats for select
  to authenticated
  using (visibility = 'public');

create policy "format versions follow their format"
  on public.format_versions for all
  to authenticated
  using (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.owner_id = (select auth.uid())
    )
  );

create policy "versions of a public format are readable by anyone signed in"
  on public.format_versions for select
  to authenticated
  using (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.visibility = 'public'
    )
  );
