### Task 5: The pairing functions, and the races they exist to lose safely

Every write that turns two rows into one match happens here, in one transaction, as the table owner. Two coordinator ticks overlapping, or two people accepting the same offer in the same second, are the two races this milestone has — and both are settled by the database rather than by a client's optimism.

**Files:**
- Create: `supabase/migrations/<timestamp>_pairing_functions.sql`
- Create: `supabase/tests/pairing.test.ts`

**Interfaces:**
- Produces: `pair_queue_entries() → integer`, `accept_offer(uuid) → uuid`, `confirm_offer(uuid) → uuid`, `sweep_expired() → integer`.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/tests/pairing.test.ts
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser } from './helpers';

describe('pairing', () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`);
  }

  beforeAll(async () => {
    for (const [id, n] of [[a, 'PA'], [b, 'PB'], [c, 'PC']] as const) await makeUser(id, `${n}_${id.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'Pair Cup') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cc') returning id`);
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.match_offers`);
    await sql(`delete from public.matches`);
    await sql(`delete from public.queue_entries`);
  });

  const enqueue = (user: string, hash: string | null = 'cc') =>
    sql(`insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('${user}', 'great', '${versionId}', 'cc', ${hash === null ? 'null' : `'${hash}'`}, '[]'::jsonb, 'rev1')`);

  it('pairs two verified entries sharing a hash, and consumes them', async () => {
    await enqueue(a); await enqueue(b);
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(1);
    expect(await sql(`select id from public.matches`)).toHaveLength(1);
    expect(await sql(`select id from public.queue_entries`)).toHaveLength(0);
  });

  it('leaves an unverified entry alone — the trust boundary', async () => {
    await enqueue(a); await enqueue(b, null);
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(0);
    expect(await sql(`select id from public.queue_entries`)).toHaveLength(2);
  });

  it('does not pair entries whose hashes differ', async () => {
    await enqueue(a); await enqueue(b, 'dd');
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(0);
  });

  it('leaves the odd one out queued when three are waiting', async () => {
    await enqueue(a); await enqueue(b); await enqueue(c);
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(1);
    expect(await sql(`select id from public.queue_entries`)).toHaveLength(1);
  });

  /**
   * The race. Two independent connections accept the same offer at the same
   * moment. One must win and one must be told no — and crucially there must be
   * exactly ONE match, not two. Counting rejections is not enough: a rejection
   * for the wrong reason counts the same, which is how a false pass gets
   * recorded.
   */
  it('lets only one of two simultaneous accepts through', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility)
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '[]'::jsonb, 'rev1', 'public') returning id`);
    const conn = () => postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
    const [c1, c2] = [conn(), conn()];
    const accept = (client: ReturnType<typeof conn>, who: string) =>
      client.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
        return tx.unsafe(`select public.accept_offer('${o.id}')`);
      });
    const results = await Promise.allSettled([accept(c1, b), accept(c2, c)]);
    await Promise.all([c1.end(), c2.end()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(refused.reason?.message)).toMatch(/no longer open/);
    expect(await sql(`select id from public.matches`)).toHaveLength(1);
  });

  it('holds a scheduled offer until the proposer confirms it too', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '[]'::jsonb, 'rev1', 'public', now() + interval '2 days') returning id`);
    await asUser({ sub: b })(`select public.accept_offer('${o.id}')`);
    // One-sided acceptance is not a match.
    expect(await sql(`select id from public.matches`)).toHaveLength(0);
    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([{ state: 'accepted' }]);
    await asUser({ sub: a })(`select public.confirm_offer('${o.id}')`);
    expect(await sql(`select id from public.matches`)).toHaveLength(1);
  });

  it('lapses an unconfirmed offer rather than converting it', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility, expires_at)
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '[]'::jsonb, 'rev1', 'public', now() - interval '1 minute') returning id`);
    await sql(`select public.sweep_expired()`);
    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([{ state: 'lapsed' }]);
    expect(await sql(`select id from public.matches`)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `function public.pair_queue_entries() does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/<timestamp>_pairing_functions.sql

-- Pair everything pairable, in one transaction, as the table owner.
--
-- `for update skip locked` is the whole mechanism. Two coordinator ticks
-- overlapping is not hypothetical — a tick that runs long while the next fires
-- is the normal failure of any timer — and without SKIP LOCKED the second tick
-- reads rows the first is about to consume and pairs them a second time. With
-- it, the second tick simply does not see them. This is the same class of bug
-- as M1b's duplicate formats, where two overlapping runs each did the work.
create function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $$
declare
  pending public.queue_entries;
  cur public.queue_entries;
  paired integer := 0;
begin
  for cur in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by verified_hash, league, data_rev, created_at
     for update skip locked
  loop
    if pending.id is not null
       and pending.verified_hash = cur.verified_hash
       and pending.league = cur.league
       -- Same data build, deliberately. A random draw both sides compute must
       -- deal from the same pool; two clients on different data would agree on
       -- the rules and disagree on what satisfies them.
       and pending.data_rev = cur.data_rev
       and pending.user_id <> cur.user_id then
      insert into public.matches
        (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
      values
        (pending.user_id, cur.user_id, pending.format_version_id, pending.verified_hash,
         pending.team, cur.team, pending.data_rev, gen_random_uuid()::text, 'queue');
      delete from public.queue_entries where id in (pending.id, cur.id);
      paired := paired + 1;
      pending := null;
    else
      pending := cur;
    end if;
  end loop;
  return paired;
end;
$$;

-- Accepting is a function, not an UPDATE, for two reasons: the row must be
-- locked while its state is checked, and a taker permitted to write this row is
-- a taker permitted to edit the terms they are agreeing to.
create function public.accept_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  taker uuid := (select auth.uid());
  new_match uuid;
begin
  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
  -- told the offer is taken. Skipping would tell it "no such offer", which is a
  -- different and misleading answer.
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
  if o.verified_hash is null then raise exception 'this offer has not been verified yet'; end if;
  if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;

  if o.scheduled_for is null then
    -- Live: agreeing is playing. One confirmation is the whole handshake.
    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (o.proposer_id, taker, o.format_version_id, o.verified_hash, o.team, '[]'::jsonb,
       o.data_rev, gen_random_uuid()::text, 'offer')
    returning id into new_match;
    update public.match_offers
       set state = 'converted', accepted_by = taker, accepted_at = now(),
           confirmed_at = now(), match_id = new_match
     where id = p_offer;
    return new_match;
  end if;

  -- Scheduled: one-sided acceptance is not a match. The proposer must confirm
  -- inside the window or this lapses.
  update public.match_offers
     set state = 'accepted', accepted_by = taker, accepted_at = now()
   where id = p_offer;
  return null;
end;
$$;

create function public.confirm_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  me uuid := (select auth.uid());
  new_match uuid;
begin
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;

  insert into public.matches
    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
  values
    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, '[]'::jsonb,
     o.data_rev, gen_random_uuid()::text, 'offer')
  returning id into new_match;
  update public.match_offers
     set state = 'converted', confirmed_at = now(), match_id = new_match
   where id = p_offer;
  return new_match;
end;
$$;

-- Expiry is a sweep, not a trigger: nothing touches a stale row to fire a
-- trigger on. An offer past its window LAPSES — it does not quietly convert,
-- because the calendar has to mean something.
create function public.sweep_expired() returns integer
language plpgsql security definer set search_path = public as $$
declare swept integer := 0;
begin
  delete from public.queue_entries where expires_at <= now();
  get diagnostics swept = row_count;
  update public.match_offers set state = 'lapsed'
   where state in ('open', 'accepted') and expires_at <= now();
  return swept;
end;
$$;

revoke all on function public.pair_queue_entries() from public, anon, authenticated;
revoke all on function public.sweep_expired() from public, anon, authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.confirm_offer(uuid) to authenticated;
```

- [ ] **Step 4: Apply, re-run, commit**

```bash
cd app && ./node_modules/.bin/supabase db reset --workdir .. > /tmp/reset.log 2>&1; echo "EXIT=$?"
cd app && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"
git add supabase/migrations supabase/tests/pairing.test.ts
git commit -m "feat(db): pairing, accepting and lapsing, with the races settled in SQL"
```

---

