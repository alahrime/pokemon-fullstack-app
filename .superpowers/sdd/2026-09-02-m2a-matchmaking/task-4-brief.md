### Task 4: `match_offers` — the live board and the scheduled proposal

Both non-blind modes. They share a table because they are the same object seen at two distances: a proposal with terms an opponent reviews before agreeing. What separates them is `scheduled_for` and the second confirmation.

An offer marked `public` is readable by strangers — the first such row outside `formats`. Copy that pattern; it is already tested.

**Files:**
- Create: `supabase/migrations/<timestamp>_match_offers.sql`
- Create: `supabase/tests/offers.test.ts`

**Interfaces:**
- Produces: `public.match_offers`, states `open → accepted → confirmed | lapsed | converted`.

- [ ] **Step 1: Write the failing policy tests**

```ts
// supabase/tests/offers.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('match offer policies', () => {
  const proposer = randomUUID();
  const taker = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
    await makeUser(taker, `OT_${taker.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
  });

  const offer = (visibility: string, scheduled = 'null') =>
    asUser({ sub: proposer })<{ id: string }>(
      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`);

  it('shows a public offer to any signed-in stranger', async () => {
    const [o] = await offer('public');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('hides a public offer from someone not signed in', async () => {
    const [o] = await offer('public');
    expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
  });

  it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
    const [o] = await offer('unlisted');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('refuses an offer proposed on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: taker })(
        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
         values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
    ).rejects.toThrow(/row-level security/);
  });

  /** A taker may accept. A taker may NOT rewrite the terms they are accepting. */
  it('refuses a taker editing the offer\'s terms', async () => {
    const [o] = await offer('public');
    await expect(
      asUser({ sub: taker })(`update public.match_offers set league = 'master' where id = '${o.id}'`),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  it('refuses a scheduled offer in the past', async () => {
    await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.match_offers" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/<timestamp>_match_offers.sql

-- A proposition, not a queue entry. The difference that earns a separate table
-- is review: an opponent reads the format before agreeing, which a blind queue
-- by definition does not allow.
create table public.match_offers (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  format_version_id uuid not null references public.format_versions (id) on delete restrict,
  claimed_hash text not null,
  verified_hash text,
  league text not null,
  team jsonb not null,
  data_rev text not null,
  visibility public.format_visibility not null default 'public',
  -- Null for the live board: playable now. Set for a proposal at a stated time.
  scheduled_for timestamptz,
  -- The handshake window. Both sides must be inside it, and an offer that
  -- reaches it unconfirmed LAPSES rather than converting — a scheduled battle
  -- on the board is one both people committed to, not one somebody was
  -- nominated for.
  expires_at timestamptz not null default now() + interval '1 hour',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  match_id uuid references public.matches (id) on delete set null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  constraint match_offers_state check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted')),
  constraint match_offers_not_self check (accepted_by is null or accepted_by <> proposer_id),
  constraint match_offers_scheduled_future check (scheduled_for is null or scheduled_for > created_at)
);

create index match_offers_open_idx on public.match_offers (visibility, league, created_at)
  where state = 'open';
create index match_offers_expiry_idx on public.match_offers (expires_at) where state in ('open', 'accepted');

alter table public.match_offers enable row level security;

create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check ((select auth.uid()) = proposer_id);

-- Same shape as "a public format is readable by anyone signed in", which is
-- the precedent this copies rather than invents.
create policy "a public offer is readable by anyone signed in"
  on public.match_offers for select
  to authenticated
  using (visibility = 'public' or (select auth.uid()) = accepted_by);

-- Accepting is done through accept_offer(), not by a client UPDATE. There is
-- deliberately no update policy for a taker: letting them write this row is
-- letting them edit the terms they are agreeing to, and no WITH CHECK
-- expressible here can say "you may set accepted_by and nothing else".
```

- [ ] **Step 4: Apply, re-run, commit**

```bash
cd app && ./node_modules/.bin/supabase db reset --workdir .. > /tmp/reset.log 2>&1; echo "EXIT=$?"
cd app && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"
git add supabase/migrations supabase/tests/offers.test.ts
git commit -m "feat(db): offers you can browse, and offers you schedule"
```

---

