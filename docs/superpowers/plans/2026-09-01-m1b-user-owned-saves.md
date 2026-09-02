# M1b — User-Owned Saves: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can save a roster and reload it on another device, and the formats they authored in `localStorage` become theirs on the server — while a signed-out visitor keeps every offline capability M0 shipped.

**Architecture:** Two new table pairs behind row policies (`teams`/`team_members`, `formats`/`format_versions`), a pure codec that converts between the builder's in-memory shapes and the stored ones, and a thin async data layer over PostgREST. The client talks to Postgres directly, so **the row policy is the only check** — there is no handler in between. Format versions are immutable once written; editing appends a version rather than overwriting one.

**Tech Stack:** Supabase (PostgreSQL 17.6 + PostgREST) under colima, `@supabase/supabase-js` 2.112.4, React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-paragon-platform-design.md` — section 1 (milestone M1), section 2 (data model: *Formats*, *Saves*), section 3 (security model).

**Predecessor:** M1a, merged to `main` at `42c6d27` and **deployed to production**.

---

## Read this before Task 1

**Merging to `main` now deploys to production.** The Supabase GitHub integration watches `main`
with "Deploy to production" enabled, verified 2026-09-01. Every migration in this plan reaches a
real database the moment the branch merges. `npm run check:db` is not optional here, and the
branch does not merge until it is green.

**Work on a branch.** `git checkout -b feat/m1b-saves` from `main`.

**Start the stack first:** `colima start`, then `cd app && npm run db:start`. Stop it when done
(`npm run db:stop`) — a stray container and a stray dev server have each cost this repo an hour.

## Global Constraints

- **`app/src/rules/` still imports no React and no browser API.** `rules:node` bundles and *executes*
  it under Node. Nothing in this plan adds to that module.
- **The service role key never enters the repo, the client bundle, or a test fixture.**
- **Every table in `public` gets RLS enabled and at least one policy.** RLS off is world-readable;
  RLS on with no policy denies everything and looks like a broken feature. Both are failures.
- **Policy tests assert both directions.** "User B cannot read user A's team" is the half that
  catches a policy someone loosened to fix a bug, and it is the half usually skipped.
- **`(select auth.uid())`, never a bare `auth.uid()`**, in every policy. RLS predicates evaluate per
  row; the subquery form lets the planner hoist it once.
- **Index every column a policy joins on.** Child-table policies subquery to their parent, and that
  subquery runs per row.
- **No new runtime dependencies.**
- Design tokens only in CSS; no new tokens. Real names: `--color-accent`, `--color-text`,
  `--text-muted`, `--text-faint`, `--font-mono`, `--space-*`, `--text-*`, `--border-hairline`,
  `--border-strong`, `--rule-hairline`, `--rule-strong`, `--surface-2`, `--radius-md`,
  `--color-accent-2-700`. **There is no `--danger` and no `--warn`.**
- **Never hand-edit `app/src/data/species.json`** — it is generated.
- **jsdom applies no stylesheet.** Assert structure and behaviour in component tests, never computed
  layout.
- Append to `app/src/styles/components.css`; do not reflow existing blocks.
- **Read the signature before writing the test.** Assumed APIs are this repo's most repeated
  historical mistake.

## Signatures this plan depends on — verified 2026-09-01, do not assume

```ts
// app/src/components/AddPokemonModal.tsx
export interface AddPokemonChoice { ref: string; chargeIds: string[]; fastIdx: number; iv: IV }
// app/src/lib/types.ts
export interface IV { a: number; d: number; s: number }
export interface StatLine { atk: number; def: number; hp: number; cp: number; lvl: number; sp: number }
// app/src/lib/data.ts
export function speciesOf(ref: string): Species | undefined   // Species.fastMoves[].id
// app/src/lib/engine.ts
export function getEntry(ref: string, iv: IV, leagueId: LeagueId, bestBuddy?: boolean):
  { entry: RankedEntry; table: SpeciesTable }                 // RankedEntry extends StatLine, so .lvl
// app/src/rules/index.ts
export function canonicalize(f: Format): string
// app/src/state/formatStore.ts
export const STORAGE_KEY = 'paragon.formats.v1';
export interface StoredFormat { id: string; name: string; format: Format; updatedAt: number; _seq?: number }
export function listFormats(): StoredFormat[]
export function saveFormat(name: string, format: Format, id?: string): StoredFormat
export function deleteFormat(id: string): void
// supabase/tests/helpers.ts
export function sql<T>(query: string): Promise<T[]>          // postgres superuser, bypasses RLS
export function asUser(claims: { sub: string }): <T>(q: string) => Promise<T[]>
export function asAnon(): <T>(q: string) => Promise<T[]>
```

## Four decisions taken here, and why

**1. `fastIdx` is never stored.** The builder holds a fast move as an *index* into
`speciesOf(ref).fastMoves`. `species.json` is generated, and a regeneration that adds or reorders a
move silently repoints every stored index at a different move — a saved team that quietly becomes a
different team is worse than one that fails to load. The database stores the move **id**, and the
codec converts in both directions. A move id that no longer exists resolves to index `0` **and
reports it**, rather than being silently swapped.

**2. A format version is immutable, and editing appends.** The spec says `format_versions` is
"immutable once published". Enforced by a trigger, not convention, so it holds against any writer.
There is no `current_version_id` column: the current version is `max(version)` for that format.
That avoids a circular foreign key between the two tables, which would otherwise need a deferrable
constraint and a two-statement insert for no gain.

**3. `rules_hash` is computed on the client, and that is a known limit.** Postgres cannot call
`canonicalize()`. Nothing in M1b depends on the hash being honest — it is a convenience for finding
identical rulesets. **M2's queue partitions by `rules_hash`, and at that point a client-supplied
hash becomes a trust boundary the coordinator must recompute.** Written down here so M2 does not
inherit it by accident.

**4. Signed out keeps working, unchanged.** M0 shipped the format builder with no backend at all,
and that stays true: with no session, formats read and write `localStorage` exactly as today. The
server is used only when there is a session. Local formats are uploaded once on first sign-in and
the local copy is **marked, not deleted** — a migration that loses someone's work to a network
error is worse than one that leaves a duplicate.

**`saved_searches` is deliberately out of scope.** The spec lists it in the *Saves* data model, but
the M1 milestone text names only "profiles, teams" plus the formats migration. It is one table with
one policy and no dependency on anything here, so it is a clean later addition rather than
something this plan should carry.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `supabase/migrations/*_teams.sql` | `teams` + `team_members`, RLS enabled, policies, indexes |
| `supabase/migrations/*_formats.sql` | `formats` + `format_versions`, RLS, policies, immutability trigger |
| `supabase/tests/teams.test.ts` | Both-direction policy tests for the team tables |
| `supabase/tests/formats.test.ts` | Both-direction policy tests, plus the immutability trigger |
| `app/src/lib/teamCodec.ts` | Pure conversion between `AddPokemonChoice` and the stored shape |
| `app/src/lib/__tests__/team-codec.test.ts` | Codec tests, including the missing-move case |
| `app/src/lib/saves.ts` | The async data layer: list/save/delete teams and formats |
| `app/src/lib/__tests__/saves.test.ts` | Data-layer tests against a mocked client |
| `app/src/state/useFormats.ts` | The hook that picks local or server storage and runs the migration |
| `app/src/state/__tests__/use-formats.test.tsx` | Hook tests: both sources, and the migration |

**Modified**

| File | Change |
|---|---|
| `app/src/screens/TeamBuilderScreen.tsx` | Save/load controls for a roster |
| `app/src/screens/FormatBuilderScreen.tsx` | Consume `useFormats()` instead of `formatStore` directly |
| `app/src/styles/components.css` | Append the saved-list styles |

---

### Task 1: `teams` and `team_members`, owner-only

**Files:**
- Create: `supabase/migrations/<timestamp>_teams.sql`, `supabase/tests/teams.test.ts`

**Interfaces:**
- Produces: tables `public.teams` (columns `id, owner_id, name, league, created_at, updated_at`) and
  `public.team_members` (`team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense,
  iv_stamina, level`). Task 3's data layer reads and writes exactly these names.

- [ ] **Step 1: Create the migration**

From the repo root: `npx supabase migration new teams`, then fill it:

```sql
-- A saved roster. Owner-only in every direction — unlike profiles, which are
-- broadly readable, nothing about a team is anyone else's business yet. M2
-- stores a team SNAPSHOT on the match rather than sharing this row, precisely
-- so that editing a team cannot rewrite the history of a match it played.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
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
```

- [ ] **Step 2: Write the policy tests**

Create `supabase/tests/teams.test.ts`. Follow `supabase/tests/profile-trigger.test.ts` for fixture
style: **plain autocommitting statements and an explicit `delete` in `afterEach`**, never a wrapping
`begin`/`rollback` — nesting raw transaction text against this shared connection silently commits.

```ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('team policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const createdUsers: string[] = [];

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
    createdUsers.push(id);
  }

  beforeAll(async () => {
    await makeUser(userA, `TeamA_${userA.slice(0, 8)}`);
    await makeUser(userB, `TeamB_${userB.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.teams where owner_id in ('${userA}', '${userB}')`);
  });

  async function teamFor(owner: string): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.teams (owner_id, name, league)
       values ('${owner}', 'Test Roster', 'great') returning id`,
    );
    return row.id;
  }

  it('lets an owner insert their own team', async () => {
    const rows = await asUser({ sub: userA })<{ id: string }>(
      `insert into public.teams (owner_id, name, league)
       values ('${userA}', 'Mine', 'great') returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a team inserted on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.teams (owner_id, name, league)
         values ('${userA}', 'Not mine', 'great')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('shows an owner their own team', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userA })(`select id from public.teams where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  /** The half usually skipped, and the half that catches a loosened policy. */
  it('hides a team from another signed-in user', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userB })(`select id from public.teams where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('hides every team from anonymous requests', async () => {
    await teamFor(userA);
    const rows = await asAnon()(`select id from public.teams`);
    expect(rows).toHaveLength(0);
  });

  it('refuses another user\'s delete', async () => {
    const id = await teamFor(userA);
    await asUser({ sub: userB })(`delete from public.teams where id = '${id}'`);
    // RLS filters the row out rather than raising, so the proof is that it survived.
    const still = await sql(`select id from public.teams where id = '${id}'`);
    expect(still).toHaveLength(1);
  });

  it('refuses another user\'s rename', async () => {
    const id = await teamFor(userA);
    await asUser({ sub: userB })(`update public.teams set name = 'stolen' where id = '${id}'`);
    const [row] = await sql<{ name: string }>(`select name from public.teams where id = '${id}'`);
    expect(row.name).toBe('Test Roster');
  });

  it('lets an owner add a member to their own team', async () => {
    const id = await teamFor(userA);
    const rows = await asUser({ sub: userA })(
      `insert into public.team_members
         (team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)
       values ('${id}', 1, 'registeel_shadow', 'LOCK_ON', '{"FOCUS_BLAST","FLASH_CANNON"}', 0, 14, 15, 41.5)
       returning slot`,
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a member added to a team that is not yours', async () => {
    const id = await teamFor(userA);
    await expect(
      asUser({ sub: userB })(
        `insert into public.team_members
           (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
         values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 15)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides members of another user\'s team', async () => {
    const id = await teamFor(userA);
    await sql(
      `insert into public.team_members
         (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
       values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 15)`,
    );
    const rows = await asUser({ sub: userB })(`select slot from public.team_members`);
    expect(rows).toHaveLength(0);
  });

  it('deletes members with their team', async () => {
    const id = await teamFor(userA);
    await sql(
      `insert into public.team_members
         (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
       values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 15)`,
    );
    await sql(`delete from public.teams where id = '${id}'`);
    const rows = await sql(`select slot from public.team_members where team_id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('rejects an out-of-range IV', async () => {
    const id = await teamFor(userA);
    await expect(
      sql(
        `insert into public.team_members
           (team_id, slot, ref, fast_move, iv_attack, iv_defense, iv_stamina)
         values ('${id}', 1, 'azumarill', 'BUBBLE', 0, 15, 16)`,
      ),
    ).rejects.toThrow(/team_members_iv_range/);
  });

  it('rejects a third charge move', async () => {
    const id = await teamFor(userA);
    await expect(
      sql(
        `insert into public.team_members
           (team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina)
         values ('${id}', 1, 'azumarill', 'BUBBLE', '{"A","B","C"}', 0, 15, 15)`,
      ),
    ).rejects.toThrow(/team_members_charge_count/);
  });
});
```

**`registeel` is Shadow-eligible; `azumarill` is not.** A `*_shadow` fixture on the wrong species
has broken this repo's fixtures twice.

- [ ] **Step 3: Apply and run**

```bash
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
```

Capture exit codes directly, never through a pipe — `cmd | tail` reports *tail's* status, which has
produced three false greens in this repo.

Expected: 32 existing tests still pass, plus the new ones.

- [ ] **Step 4: Prove the deny tests can fail**

Temporarily change the `teams` policy's `using` clause to `using (true)`, re-run, and confirm the
"hides a team from another signed-in user" test **fails**. Restore it. A deny test that passes
against a wide-open policy is testing nothing, and this is the single most likely thing in this task
to be silently wrong.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/teams.test.ts
git commit -m "feat(db): a roster that belongs to exactly one person"
```

---

### Task 2: `formats` and `format_versions`, with versions that cannot be rewritten

**Files:**
- Create: `supabase/migrations/<timestamp>_formats.sql`, `supabase/tests/formats.test.ts`

**Interfaces:**
- Produces: `public.formats` (`id, owner_id, name, visibility, fork_of, created_at, updated_at`) and
  `public.format_versions` (`id, format_id, version, rules, rules_hash, created_at`). Task 3 reads
  and writes these names.

- [ ] **Step 1: Create the migration**

`npx supabase migration new formats`, then:

```sql
-- Visibility is an enum because, unlike league, these three are a closed set the
-- policies branch on. A typo in a text column would silently make a format
-- private forever.
create type public.format_visibility as enum ('private', 'unlisted', 'public');

create table public.formats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
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
```

- [ ] **Step 2: Write the policy tests**

Create `supabase/tests/formats.test.ts`, same fixture discipline as Task 1:

```ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

const RULES = `'{"schema":1,"base":"great","pool":[],"composition":{"size":3,"uniqueSpecies":true},"selection":{"mode":"open"}}'::jsonb`;

describe('format policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(userA, `FmtA_${userA.slice(0, 8)}`);
    await makeUser(userB, `FmtB_${userB.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.formats where owner_id in ('${userA}', '${userB}')`);
  });

  async function formatFor(owner: string, visibility = 'private'): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility)
       values ('${owner}', 'Air Ban', '${visibility}') returning id`,
    );
    return row.id;
  }

  async function versionFor(formatId: string, version = 1): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${formatId}', ${version}, ${RULES}, 'hash-${version}') returning id`,
    );
    return row.id;
  }

  it('shows an owner their private format', async () => {
    const id = await formatFor(userA);
    const rows = await asUser({ sub: userA })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  it('hides a private format from another user', async () => {
    const id = await formatFor(userA);
    const rows = await asUser({ sub: userB })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('shows a public format to another signed-in user', async () => {
    const id = await formatFor(userA, 'public');
    const rows = await asUser({ sub: userB })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  /** Readable is not writable — the widening policy is SELECT-only. */
  it('does not let another user edit a public format', async () => {
    const id = await formatFor(userA, 'public');
    await asUser({ sub: userB })(`update public.formats set name = 'stolen' where id = '${id}'`);
    const [row] = await sql<{ name: string }>(`select name from public.formats where id = '${id}'`);
    expect(row.name).toBe('Air Ban');
  });

  it('hides an unlisted format from another user, since sharing does not exist yet', async () => {
    const id = await formatFor(userA, 'unlisted');
    const rows = await asUser({ sub: userB })(`select id from public.formats where id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('hides every format from anonymous requests', async () => {
    await formatFor(userA, 'public');
    const rows = await asAnon()(`select id from public.formats`);
    expect(rows).toHaveLength(0);
  });

  it('shows versions of a public format to another user', async () => {
    const id = await formatFor(userA, 'public');
    await versionFor(id);
    const rows = await asUser({ sub: userB })(`select version from public.format_versions where format_id = '${id}'`);
    expect(rows).toHaveLength(1);
  });

  it('hides versions of a private format from another user', async () => {
    const id = await formatFor(userA);
    await versionFor(id);
    const rows = await asUser({ sub: userB })(`select version from public.format_versions where format_id = '${id}'`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a version appended to a format that is not yours', async () => {
    const id = await formatFor(userA, 'public');
    await expect(
      asUser({ sub: userB })(
        `insert into public.format_versions (format_id, version, rules, rules_hash)
         values ('${id}', 1, ${RULES}, 'hash-x')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  describe('immutability', () => {
    it('refuses to rewrite a version, even for its owner', async () => {
      const id = await formatFor(userA);
      await versionFor(id);
      await expect(
        asUser({ sub: userA })(
          `update public.format_versions set rules_hash = 'tampered' where format_id = '${id}'`,
        ),
      ).rejects.toThrow(/immutable/);
    });

    /** Holds against the superuser too, which is the point of a trigger. */
    it('refuses to rewrite a version even as the table owner', async () => {
      const id = await formatFor(userA);
      await versionFor(id);
      await expect(
        sql(`update public.format_versions set rules_hash = 'tampered' where format_id = '${id}'`),
      ).rejects.toThrow(/immutable/);
    });

    it('allows a second version alongside the first', async () => {
      const id = await formatFor(userA);
      await versionFor(id, 1);
      await versionFor(id, 2);
      const rows = await sql(`select version from public.format_versions where format_id = '${id}'`);
      expect(rows).toHaveLength(2);
    });

    it('refuses a duplicate version number', async () => {
      const id = await formatFor(userA);
      await versionFor(id, 1);
      await expect(versionFor(id, 1)).rejects.toThrow(/duplicate key/);
    });
  });
});
```

- [ ] **Step 3: Apply, run, and prove a deny test can fail**

```bash
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
```

Then temporarily widen `"a public format is readable by anyone signed in"` to `using (true)` and
confirm "hides a private format from another user" **fails**. Restore it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations supabase/tests/formats.test.ts
git commit -m "feat(db): formats on the server, with versions nobody can rewrite"
```

---

### Task 3: The codec and the data layer

**Files:**
- Create: `app/src/lib/teamCodec.ts`, `app/src/lib/__tests__/team-codec.test.ts`,
  `app/src/lib/saves.ts`, `app/src/lib/__tests__/saves.test.ts`

**Interfaces:**
- Consumes: the table and column names from Tasks 1 and 2.
- Produces:

```ts
// teamCodec.ts
export interface StoredMember {
  ref: string; fast_move: string; charge_moves: string[];
  iv_attack: number; iv_defense: number; iv_stamina: number; level: number | null;
}
export interface DecodedMember { choice: AddPokemonChoice; unknownMove: string | null }
export function encodeMember(choice: AddPokemonChoice, league: LeagueId): StoredMember
export function decodeMember(stored: StoredMember): DecodedMember

// saves.ts
export interface SavedTeam { id: string; name: string; league: LeagueId; members: StoredMember[] }
export async function listTeams(): Promise<SavedTeam[]>
export async function saveTeam(t: { id?: string; name: string; league: LeagueId; members: StoredMember[] }): Promise<string>
export async function deleteTeam(id: string): Promise<void>
export interface SavedFormat { id: string; name: string; format: Format; version: number; rulesHash: string }
export async function listServerFormats(): Promise<SavedFormat[]>
export async function saveServerFormat(f: { id?: string; name: string; format: Format }): Promise<string>
export async function deleteServerFormat(id: string): Promise<void>
```

- [ ] **Step 1: Write the failing codec tests**

Create `app/src/lib/__tests__/team-codec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeMember, decodeMember } from '../teamCodec';
import { speciesOf } from '../data';

/**
 * The index/id conversion, which is the whole reason this module exists.
 * `species.json` is generated, so a stored fastIdx would silently repoint at a
 * different move the next time the data is rebuilt.
 */
describe('team member codec', () => {
  const ref = 'registeel';
  const fastMoves = speciesOf(ref)!.fastMoves;

  it('stores the fast move id, not the index', () => {
    const stored = encodeMember({ ref, chargeIds: [], fastIdx: 1, iv: { a: 0, d: 14, s: 15 } }, 'great');
    expect(stored.fast_move).toBe(fastMoves[1].id);
    expect(Object.values(stored)).not.toContain(1);
  });

  it('round-trips a member back to the same choice', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST'], fastIdx: 0, iv: { a: 2, d: 15, s: 13 } };
    const { choice: back, unknownMove } = decodeMember(encodeMember(choice, 'great'));
    expect(back).toEqual(choice);
    expect(unknownMove).toBeNull();
  });

  it('records the level the engine derives, rather than leaving it null', () => {
    const stored = encodeMember({ ref, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 14, s: 15 } }, 'great');
    expect(stored.level).toBeGreaterThan(1);
    expect(stored.level).toBeLessThanOrEqual(51);
  });

  /**
   * The failure this design exists to make loud. A move that has left the data
   * must not resolve to whatever now sits at that index.
   */
  it('reports a fast move that no longer exists instead of silently picking another', () => {
    const { choice, unknownMove } = decodeMember({
      ref, fast_move: 'MOVE_THAT_WAS_REMOVED', charge_moves: [],
      iv_attack: 0, iv_defense: 14, iv_stamina: 15, level: 41.5,
    });
    expect(unknownMove).toBe('MOVE_THAT_WAS_REMOVED');
    expect(choice.fastIdx).toBe(0);
  });

  it('reports an unknown ref rather than throwing', () => {
    const { choice, unknownMove } = decodeMember({
      ref: 'not_a_pokemon', fast_move: 'BULLET_PUNCH', charge_moves: [],
      iv_attack: 0, iv_defense: 0, iv_stamina: 0, level: null,
    });
    expect(unknownMove).toBe('BULLET_PUNCH');
    expect(choice.ref).toBe('not_a_pokemon');
  });

  it('keeps both charge moves in order', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST', 'FLASH_CANNON'], fastIdx: 0, iv: { a: 0, d: 0, s: 0 } };
    expect(encodeMember(choice, 'great').charge_moves).toEqual(['FOCUS_BLAST', 'FLASH_CANNON']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/team-codec.test.ts
```

Expected: FAIL — `Cannot find module '../teamCodec'`.

- [ ] **Step 3: Write the codec**

Create `app/src/lib/teamCodec.ts`:

```ts
import type { AddPokemonChoice } from '../components/AddPokemonModal';
import type { LeagueId } from './types';
import { speciesOf } from './data';
import { getEntry } from './engine';

export interface StoredMember {
  ref: string;
  fast_move: string;
  charge_moves: string[];
  iv_attack: number;
  iv_defense: number;
  iv_stamina: number;
  level: number | null;
}

export interface DecodedMember {
  choice: AddPokemonChoice;
  /** The stored move id, when it no longer exists in the data. Null when fine. */
  unknownMove: string | null;
}

export function encodeMember(choice: AddPokemonChoice, league: LeagueId): StoredMember {
  const species = speciesOf(choice.ref);
  const fast = species?.fastMoves[choice.fastIdx];
  // Level is recorded, not authoritative — the engine derives it from the IVs
  // and the cap. Stored so a later data change that moves it can be seen.
  let level: number | null = null;
  try {
    level = getEntry(choice.ref, choice.iv, league).entry.lvl;
  } catch {
    // An unknown ref has no table. The member is still worth storing.
  }
  return {
    ref: choice.ref,
    fast_move: fast?.id ?? '',
    charge_moves: [...choice.chargeIds],
    iv_attack: choice.iv.a,
    iv_defense: choice.iv.d,
    iv_stamina: choice.iv.s,
    level,
  };
}

export function decodeMember(stored: StoredMember): DecodedMember {
  const species = speciesOf(stored.ref);
  const idx = species?.fastMoves.findIndex((m) => m.id === stored.fast_move) ?? -1;
  return {
    choice: {
      ref: stored.ref,
      chargeIds: [...stored.charge_moves],
      // Fall back to the first move, and SAY SO through unknownMove. Resolving
      // silently is how a saved team quietly becomes a different team.
      fastIdx: idx >= 0 ? idx : 0,
      iv: { a: stored.iv_attack, d: stored.iv_defense, s: stored.iv_stamina },
    },
    unknownMove: idx >= 0 ? null : stored.fast_move,
  };
}
```

- [ ] **Step 4: Run the codec tests**

Expected: PASS, all 7.

- [ ] **Step 5: Write the failing data-layer tests**

Create `app/src/lib/__tests__/saves.test.ts`. Mock `@supabase/supabase-js` at the package boundary,
the way `src/screens/__tests__/sign-in.test.tsx` does — the setup-file stub is not enough here
because these tests assert the exact calls made.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RULES_SCHEMA, type Format } from '../../rules';

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

// No `as Format` cast: every required field is present, so the annotation alone
// type-checks. A cast here would hide the next real mismatch.
const FORMAT: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

function harness(rows: Record<string, unknown[]>) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  function table(name: string) {
    const q: Record<string, unknown> = {
      select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
      eq: vi.fn(() => q),
      order: vi.fn(() => q),
      insert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'insert', payload }); return q; }),
      upsert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'upsert', payload }); return q; }),
      delete: vi.fn(() => { calls.push({ table: name, op: 'delete' }); return q; }),
      single: vi.fn(async () => ({ data: rows[name]?.[0] ?? null, error: null })),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows[name] ?? [], error: null }).then(res),
    };
    return q;
  }
  pkg.client = { from: vi.fn((n: string) => table(n)) };
  return { calls };
}

beforeEach(() => vi.resetModules());

describe('saved teams', () => {
  it('reads a team and its members into one object', async () => {
    harness({
      teams: [{ id: 't1', name: 'Mine', league: 'great',
        team_members: [{ slot: 1, ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM'],
          iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }] }],
    });
    const { listTeams } = await import('../saves');
    const teams = await listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe('Mine');
    expect(teams[0].members[0].ref).toBe('azumarill');
  });

  it('writes members in slot order, one row each', async () => {
    const { calls } = harness({ teams: [{ id: 't1' }] });
    const { saveTeam } = await import('../saves');
    await saveTeam({
      name: 'Mine', league: 'great',
      members: [
        { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
        { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: [], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 41 },
      ],
    });
    const members = calls.find((c) => c.table === 'team_members' && c.op === 'insert');
    expect((members?.payload as { slot: number }[]).map((m) => m.slot)).toEqual([1, 2]);
  });

  it('never writes an owner_id from the client', async () => {
    const { calls } = harness({ teams: [{ id: 't1' }] });
    const { saveTeam } = await import('../saves');
    await saveTeam({ name: 'Mine', league: 'great', members: [] });
    const insert = calls.find((c) => c.table === 'teams' && c.op === 'insert');
    // owner_id comes from a column default of auth.uid(); a client-supplied one
    // is a value the policy then has to agree with, which is a second source of
    // truth for who owns a row.
    expect(Object.keys(insert?.payload as object)).not.toContain('owner_id');
  });
});

describe('saved formats', () => {
  it('appends a version rather than updating one', async () => {
    const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 3 }] });
    const { saveServerFormat } = await import('../saves');
    await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
    expect(calls.some((c) => c.table === 'format_versions' && c.op === 'insert')).toBe(true);
    expect(calls.some((c) => c.table === 'format_versions' && c.op === 'upsert')).toBe(false);
  });

  it('stores the canonical hash alongside the rules', async () => {
    const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 0 }] });
    const { saveServerFormat } = await import('../saves');
    const { canonicalize } = await import('../../rules');
    await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
    const v = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
    expect((v?.payload as { rules_hash: string }).rules_hash).toBe(canonicalize(FORMAT));
  });
});
```

- [ ] **Step 6: Run and watch it fail, then implement `saves.ts`**

```bash
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/saves.test.ts
```

Expected: FAIL — `Cannot find module '../saves'`. Then write `app/src/lib/saves.ts`:

```ts
import { supabase } from './supabase';
import { canonicalize, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';

export interface SavedTeam {
  id: string;
  name: string;
  league: LeagueId;
  members: StoredMember[];
}

/**
 * `owner_id` is never sent from here. It defaults to `auth.uid()` in the
 * database, so who owns a row is decided in one place; a client-supplied owner
 * is a second source of truth the policy then has to agree with.
 */
export async function listTeams(): Promise<SavedTeam[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, league, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as { id: string; name: string; league: LeagueId; team_members: (StoredMember & { slot: number })[] };
    return {
      id: r.id,
      name: r.name,
      league: r.league,
      members: [...r.team_members].sort((a, b) => a.slot - b.slot),
    };
  });
}

export async function saveTeam(t: {
  id?: string;
  name: string;
  league: LeagueId;
  members: StoredMember[];
}): Promise<string> {
  let id = t.id;
  if (id) {
    const { error } = await supabase
      .from('teams')
      .update({ name: t.name, league: t.league, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    // Slots are positional and the roster may have shrunk, so the old rows go
    // rather than being upserted over — an upsert would leave a stale slot 3
    // behind when a three becomes a two.
    const { error: clearError } = await supabase.from('team_members').delete().eq('team_id', id);
    if (clearError) throw new Error(clearError.message);
  } else {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: t.name, league: t.league })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  }
  if (t.members.length > 0) {
    const { error } = await supabase
      .from('team_members')
      .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
    if (error) throw new Error(error.message);
  }
  return id;
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface SavedFormat {
  id: string;
  name: string;
  format: Format;
  version: number;
  rulesHash: string;
}

export async function listServerFormats(): Promise<SavedFormat[]> {
  const { data, error } = await supabase
    .from('formats')
    .select('id, name, format_versions(version, rules, rules_hash)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const r = row as { id: string; name: string; format_versions: { version: number; rules: Format; rules_hash: string }[] };
    // The current version is the highest one; there is no pointer column to
    // disagree with it.
    const latest = [...r.format_versions].sort((a, b) => b.version - a.version)[0];
    if (!latest) return [];
    return [{ id: r.id, name: r.name, format: latest.rules, version: latest.version, rulesHash: latest.rules_hash }];
  });
}

export async function saveServerFormat(f: { id?: string; name: string; format: Format }): Promise<string> {
  let id = f.id;
  if (id) {
    const { error } = await supabase
      .from('formats')
      .update({ name: f.name, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from('formats').insert({ name: f.name }).select('id').single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  }
  const { data: prior } = await supabase
    .from('format_versions')
    .select('version')
    .eq('format_id', id)
    .order('version', { ascending: false })
    .limit(1);
  const next = ((prior as { version: number }[] | null)?.[0]?.version ?? 0) + 1;
  // Append. A version is immutable in the database, so this is the only way to
  // change what a format says.
  const { error } = await supabase.from('format_versions').insert({
    format_id: id,
    version: next,
    rules: f.format,
    rules_hash: canonicalize(f.format),
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteServerFormat(id: string): Promise<void> {
  const { error } = await supabase.from('formats').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 7: Add the `owner_id` default the data layer relies on**

`saves.ts` deliberately never sends `owner_id`, so the column needs a default. Add a migration —
`npx supabase migration new owner_defaults`:

```sql
-- The client never sends owner_id, so there is exactly one place that decides
-- who owns a row. Without this default the insert fails a NOT NULL, and the
-- obvious fix — sending it from the client — creates a second source of truth
-- the policy then has to agree with.
alter table public.teams alter column owner_id set default auth.uid();
alter table public.formats alter column owner_id set default auth.uid();
```

- [ ] **Step 8: Run both gates**

```bash
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 9: Commit**

```bash
git add app/src/lib supabase/migrations
git commit -m "feat(saves): a codec that stores move ids, and the layer that writes them"
```

---

### Task 4: Saving and loading a roster

**Files:**
- Modify: `app/src/screens/TeamBuilderScreen.tsx`, `app/src/styles/components.css`
- Test: `app/src/screens/__tests__/team-saves.test.tsx`

**Interfaces:**
- Consumes: `listTeams`, `saveTeam`, `deleteTeam` from `app/src/lib/saves.ts`; `encodeMember`,
  `decodeMember` from `app/src/lib/teamCodec.ts`; `useSession` from `app/src/state/SessionContext.tsx`.

**Read `TeamBuilderScreen.tsx` before touching it.** The roster is `team: string[]` (refs) with a
parallel `builds: Record<string, AddPokemonChoice>`. Loading a saved team must set **both**, and the
existing `useEffect` that recomputes the analysis keys off `team`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/screens/__tests__/team-saves.test.tsx`:

```ts
// Assertions, written before the UI exists:
// - Signed out: no save control is rendered, and the builder still works.
// - Signed in with an empty roster: the save control is disabled.
// - Signed in with two members: saving calls saveTeam with both, in slot order.
// - The saved name is what was typed.
// - Loading a saved team replaces the roster outright rather than appending —
//   the screen already has this bug class; see the comment at
//   TeamBuilderScreen.tsx:225 about members silently dropping.
// - Loading a team whose fast move no longer exists shows a notice naming the
//   move, rather than loading a different move silently.
// - Deleting asks for confirmation, and calls deleteTeam only after it.
```

Write each of those as a real `it(...)` using the mock-harness shape from
`src/screens/__tests__/sign-in.test.tsx` (`vi.hoisted` holder + `vi.mock('@supabase/supabase-js')`),
rendering inside `SessionProvider`.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd app && ./node_modules/.bin/vitest run src/screens/__tests__/team-saves.test.tsx
```

- [ ] **Step 3: Implement the controls**

A `.hud-label`ed name field, a `.btn.btn-primary` Save, and a list of saved teams as `.chip-btn`
rows with a delete affordance. Reuse `.account-form`-style stacking; append any new rules to
`components.css` rather than reflowing existing blocks. **Overlay, don't expand** — the saved-team
list must not shove the roster down the page when it grows.

- [ ] **Step 4: Run the app gate**

```bash
cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 5: Verify in the browser, by measuring**

Start the dev server, sign in, save a roster of three, reload the page, load it back. Confirm with
`getBoundingClientRect()` that the saved-team list does not push the roster below the fold, and
confirm the loaded roster has exactly three members — **not** by screenshot. jsdom applies no
stylesheet and a screenshot hides a 5px shove; this repo has been caught by both.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens app/src/styles/components.css
git commit -m "feat(teams): a roster that survives the tab closing"
```

---

### Task 5: Formats move to the server, without breaking offline

**Files:**
- Create: `app/src/state/useFormats.ts`, `app/src/state/__tests__/use-formats.test.tsx`
- Modify: `app/src/screens/FormatBuilderScreen.tsx`

**Interfaces:**
- Consumes: `listServerFormats`, `saveServerFormat`, `deleteServerFormat`; `listFormats`,
  `saveFormat`, `deleteFormat` from `formatStore`; `useSession`.
- Produces:

```ts
export const MIGRATED_KEY = 'paragon.formats.migrated.v1';
export interface FormatsApi {
  formats: { id: string; name: string; format: Format }[];
  source: 'local' | 'server';
  loading: boolean;
  migrating: boolean;
  error: string | null;
  save: (name: string, format: Format, id?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}
export function useFormats(): FormatsApi
```

- [ ] **Step 1: Write the failing tests**

Create `app/src/state/__tests__/use-formats.test.tsx`:

```ts
// - Signed out: source is 'local', formats come from formatStore, and saving
//   writes to localStorage and never touches the client.
// - Signed in with nothing local: source is 'server', and listServerFormats
//   is what is read.
// - Signed in with two local formats and nothing migrated yet: both are
//   uploaded exactly once, and MIGRATED_KEY records their local ids.
// - The local copy still EXISTS after a successful migration. A migration that
//   deletes is a migration that loses work when the second upload fails.
// - A second sign-in does not upload them again.
// - A failed upload leaves MIGRATED_KEY untouched, so it retries next time,
//   and surfaces `error` rather than throwing into the screen.
// - Migration is skipped entirely when there is nothing local.
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement the hook**

The shape, in prose so the implementer writes it rather than transcribes it: read `useSession()`;
with no `user`, wrap `formatStore` synchronously and report `source: 'local'`. With a `user`, on
mount, read `MIGRATED_KEY` (a JSON array of local ids), diff it against `listFormats()`, upload each
missing one with `saveServerFormat`, and append its local id to `MIGRATED_KEY` **only after that
upload resolves**. Then `listServerFormats()`. Every `catch` sets `error` and leaves `MIGRATED_KEY`
alone.

- [ ] **Step 4: Point the builder at the hook**

Replace the direct `formatStore` calls in `FormatBuilderScreen.tsx` with `useFormats()`. The screen
becomes async where it was synchronous — disable Save while `migrating` or `loading`, and render
`error` in an `.account-alert`-style block.

- [ ] **Step 5: Run both gates**

```bash
cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 6: Verify the migration against a real database**

With the stack running and a real signed-in user: seed two formats into `localStorage`, sign in,
and confirm with SQL (`select name from public.formats`) that exactly two arrived, that
`localStorage` still holds them, and that signing out and in again adds nothing. A migration is
exactly the kind of code whose tests can all pass while the real thing double-writes.

- [ ] **Step 7: Commit**

```bash
git add app/src/state app/src/screens/FormatBuilderScreen.tsx
git commit -m "feat(formats): yours on the server, still yours offline"
```

---

## Before merging

1. `npm run check` green, `npm run check:db` green, exit codes captured directly.
2. `npm run db:stop`, and stop any dev server you started.
3. Update `docs/superpowers/HANDOFF.md` and the ledger at
   `.superpowers/sdd/2026-09-01-m1b-user-owned-saves/progress.md` (now tracked in git).
4. **Merging to `main` deploys these migrations to production.** Confirm the two new table pairs
   behave on production the way M1a's did: after the deploy, an anonymous `POST` to
   `/rest/v1/teams` must be refused `42501`. An empty table returns `[]` whether RLS is on or off,
   so only a refused write proves the policy is live.

---

## Self-Review

**Spec coverage.** Section 2's *Saves* → `teams` and `team_members` in Task 1, keyed on `ref` with
Shadow in the ref as the spec requires. Section 2's *Formats* → `formats` and `format_versions` in
Task 2, with `rules` + `rules_hash` and immutability. The M1 milestone's "formats migrate from
`localStorage` to the server" → Task 5. Section 3's child-table performance trap — `(select
auth.uid())` and an index on every joined column — is a global constraint and is applied in both
migrations. `saved_searches` is the one *Saves* row not covered, deferred deliberately and argued
above.

**Placeholder scan.** Tasks 1–3 carry complete SQL and TypeScript. Tasks 4 and 5 describe their
tests as an enumerated list of behaviours plus the harness to copy, rather than full source: both
modify screens whose current shape the implementer must read first, and transcribing a stale copy of
`TeamBuilderScreen` into this plan would age worse than naming what to assert. Every behaviour is
named specifically enough to write directly.

**Type consistency.** `StoredMember` is defined once in `teamCodec.ts` and consumed by `saves.ts`
and Task 4 under that name. Its fields match the `team_members` columns exactly (`fast_move`,
`charge_moves`, `iv_attack`, `iv_defense`, `iv_stamina`, `level`) so no mapping layer hides a typo.
`SavedTeam.members` is `StoredMember[]`, and `slot` is added by `saveTeam` at write time rather than
carried on the type — which is why `listTeams` sorts by it before dropping it.

**Known risk.** Task 5's dual store is the piece most able to be subtly wrong, because its failure
mode is silent duplication rather than an error. The `MIGRATED_KEY`-after-success ordering is what
makes a retry safe; if that ordering is reversed, every failed upload becomes permanent data loss
and no test in the list above would catch it unless it asserts the *ordering* rather than the
outcome. Write that test first.
