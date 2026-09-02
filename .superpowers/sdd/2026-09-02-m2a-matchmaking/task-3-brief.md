### Task 3: `queue_entries` and `matches`

The blind queue and the terminal object both entry modes converge on. `matches` is the first table in this schema **no client may write at all** — pairing is the coordinator's alone — so its deny tests are the point rather than a formality.

**Files:**
- Create: `supabase/migrations/<timestamp>_queue_and_matches.sql` — generate `<timestamp>` as `date -u +%Y%m%d%H%M%S`; it must sort after `20260902163500`
- Create: `supabase/tests/queue.test.ts`

**Interfaces:**
- Produces: tables `public.queue_entries` and `public.matches` with the columns below; later tasks read `queue_entries.verified_hash` and insert into `matches` from `security definer` functions only.

- [ ] **Step 1: Write the failing policy tests**

```ts
// supabase/tests/queue.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('queue and match policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(userA, `QA_${userA.slice(0, 8)}`);
    await makeUser(userB, `QB_${userB.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${userA}', 'Queue Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a in ('${userA}','${userB}') or player_b in ('${userA}','${userB}')`);
    await sql(`delete from public.queue_entries where user_id in ('${userA}','${userB}')`);
  });

  const enqueue = (owner: string) =>
    asUser({ sub: owner })<{ id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning id`,
    );

  it('lets someone join the queue without naming themselves', async () => {
    const rows = await asUser({ sub: userA })<{ user_id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning user_id`,
    );
    expect(rows[0].user_id).toBe(userA);
  });

  it('refuses a queue entry made on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, team, data_rev)
         values ('${userA}', 'great', '${versionId}', 'aa', '[]'::jsonb, 'rev1')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides a queue entry from everyone but its owner', async () => {
    await enqueue(userA);
    expect(await asUser({ sub: userB })(`select id from public.queue_entries`)).toHaveLength(0);
    expect(await asAnon()(`select id from public.queue_entries`)).toHaveLength(0);
  });

  it('allows only one queue entry per person', async () => {
    await enqueue(userA);
    await expect(enqueue(userA)).rejects.toThrow(/queue_entries_one_per_user/);
  });

  it('lets a player see a match they are in, and nobody else see it', async () => {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-1','queue') returning id`,
    );
    expect(await asUser({ sub: userA })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(1);
    const stranger = randomUUID();
    await makeUser(stranger, `QS_${stranger.slice(0, 8)}`);
    expect(await asUser({ sub: stranger })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(0);
  });

  /** The reason this table exists as coordinator-only. */
  it('refuses a match inserted by a player, even one they are in', async () => {
    await expect(
      asUser({ sub: userA })(
        `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
         values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-2','queue')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('reveals an opponent\'s friend code, and only to an opponent', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')`);
    const stranger = randomUUID();
    await makeUser(stranger, `QT_${stranger.slice(0, 8)}`);
    // Before any match: invisible.
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-3','queue')`);
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
    expect(await asUser({ sub: stranger })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.queue_entries" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/<timestamp>_queue_and_matches.sql

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
```

- [ ] **Step 4: Apply and re-run**

Run: `cd app && ./node_modules/.bin/supabase db reset --workdir .. > /tmp/reset.log 2>&1; echo "EXIT=$?" && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"`
Expected: both EXIT=0, all tests in `queue.test.ts` passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/queue.test.ts
git commit -m "feat(db): a blind queue, and matches no client may write"
```

---

