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

