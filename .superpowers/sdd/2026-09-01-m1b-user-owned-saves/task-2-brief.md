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

