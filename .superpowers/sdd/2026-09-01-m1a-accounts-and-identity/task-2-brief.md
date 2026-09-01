### Task 2: `profiles` and `friend_codes`, denied by default

**Files:**
- Create: `supabase/migrations/<timestamp>_profiles.sql`
- Test: exercised by Task 3's harness

**Interfaces:**
- Produces: tables `public.profiles` and `public.friend_codes`, both with RLS **enabled and no policies yet** — deliberately, so Task 3's default-deny assertion has something to prove before Task 4 opens access.

**Why two tables.** Postgres RLS is row-level, not column-level. A profile is broadly readable; a GO friend code is readable only if it is yours, you are accepted friends, or you share an active match. Two visibility rules cannot live on one row, so they are two rows in two tables. This is the mechanism that makes reveal-on-mutual-accept a policy rather than a feature to remember to write.

- [ ] **Step 1: Write the migration**

`npx supabase migration new profiles` from the repo root, then fill it:

```sql
-- A person, 1:1 with auth.users. GoTrue owns auth.users; we never write to it.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- The Paragon display name: unique to this app, chosen once, and IMMUTABLE.
  -- One name field, not two — a fixed handle plus a mutable pretty name is two
  -- things to show and two things to disagree. Immutability is enforced by a
  -- trigger below rather than by convention, so it holds against any writer
  -- including one holding the service role key.
  --
  -- NOTE this is deliberately NOT the identity anchor. auth.users.email is,
  -- because it is verified by the auth provider and survives every rename.
  display_name text unique not null,
  -- The in-game trainer name, collected at registration. Load-bearing well
  -- beyond a display string: the spec adjudicates disputes from GO battle
  -- journal screenshots, which show the OPPONENT'S in-game username — without
  -- this stored, a judge cannot match a screenshot to a match.
  --
  -- Unique, but unverifiable: there is no public GO API to prove someone owns
  -- a trainer name, so this prevents obvious collisions rather than
  -- establishing identity. Do not describe it in the UI as verified.
  -- MUTABLE and deliberately NOT unique. Trainer names change, and there is no
  -- public GO API to prove ownership of one — a unique constraint on
  -- unverifiable mutable data buys little and costs real friction, since a user
  -- who renames in-game would collide with whoever took their old name. Two
  -- accounts sharing a trainer name does not break dispute adjudication: a
  -- match record names its two participants by id, so a judge only needs the
  -- screenshot to match one of them.
  go_username text not null,
  -- Email is deliberately NOT stored here. auth.users.email is the source of
  -- truth for both email signup and Google, and a second copy would drift.
  -- Read it through the session, never from this table.
  --
  -- Terms acceptance, recorded at signup. The terms themselves are a
  -- placeholder for now; the timestamp is the audit trail either way, and
  -- backfilling consent nobody recorded is not possible.
  tos_accepted_at timestamptz not null,
  -- Stored rather than an age number or a derived is_minor flag: a
  -- twelve-year-old becomes thirteen, and either would be frozen at signup and
  -- never notice. Age is computed from this wherever it is needed.
  birth_date date not null,
  -- Load-bearing for the daily-battle calendar in a later milestone: UTC would
  -- put an evening match on tomorrow's row for anyone west of London.
  timezone text not null default 'UTC',
  default_league text not null default 'great',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Separate table, not a column, because RLS is row-level and this needs a
-- different visibility rule from the rest of the profile. See the plan.
-- Separate table, not a column, because RLS is row-level and a friend code
-- needs a different visibility rule from the rest of the profile.
--
-- The code is USER-EDITABLE. A trainer can regenerate their code in Pokemon GO
-- itself, so a code that could not be changed here would go stale the moment
-- they did. This also softens the harvesting risk: a harvested code is a
-- nuisance its owner can end, not a permanent exposure.
create table public.friend_codes (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null,
  updated_at timestamptz not null default now()
);

-- Immutability enforced in the database, not in the client. A rule the client
-- merely agrees to is not a rule; this one holds against any writer, including
-- a server process holding the service role key.
create function public.freeze_display_name() returns trigger
language plpgsql as $$
begin
  if new.display_name is distinct from old.display_name then
    raise exception 'display_name is immutable once chosen';
  end if;
  return new;
end;
$$;

create trigger profiles_display_name_frozen
  before update on public.profiles
  for each row execute function public.freeze_display_name();

alter table public.profiles enable row level security;
alter table public.friend_codes enable row level security;
```

**No policies in this migration.** RLS on with zero policies denies everything — that is the correct starting state, and Task 3 asserts it before Task 4 relaxes it deliberately.

- [ ] **Step 2: Apply and inspect**

`npm run db:reset`, then confirm both tables exist with `rowsecurity = true` and zero policies:

```bash
docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select tablename, rowsecurity from pg_tables where schemaname='public';
   select count(*) from pg_policies where schemaname='public';"
```

The container name depends on the project directory — check `docker ps` rather than assuming the name above.

Expected: both tables listed with `t`, and a policy count of `0`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): a profile, and a friend code that lives apart from it"
```

---

