### Task 3: A friend can see your friend code; a blocked stranger cannot reach you

Two widenings, in one migration because they are one idea: an accepted friendship is the second route to a friend code, and a block has to actually stop the matchmaking that M2a already ships.

The queue clause is the subtle one. `pair_queue_entries` scans for two entries with the same verified hash and league; it must skip a pair where either has blocked the other, **without** either of them learning why they are waiting longer.

**Files:**
- Create: `supabase/migrations/20260905132000_friend_codes_for_friends.sql`
- Create: `supabase/migrations/20260905133000_blocks_reach_the_queue.sql`
- Test: `supabase/tests/social.test.ts` (append)

**Interfaces:**
- Consumes: `public.blocked_between` from Task 2.
- Produces: `friend_codes` readable by accepted friends; `pair_queue_entries` and `accept_offer` refuse blocked pairs.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/social.test.ts
  it('shows a friend code to an accepted friend and to nobody else', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${bob}', '4444 5555 6666')
               on conflict (profile_id) do update set code = excluded.code`);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(0);

    await request(ann, bob);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`),
      'pending is not accepted').toHaveLength(0);

    await respond(bob, ann, true);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(0);
  });

  it('never pairs two people who have blocked each other', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Block Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`,
    );
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    for (const who of [ann, bob]) {
      await asUser({ sub: who })(
        `insert into public.queue_entries (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('great', '${v.id}', 'bb', 'bb', '[]'::jsonb, 'rev1')`,
      );
    }
    // verified_hash is set by hand here: the coordinator is not running in this suite.
    await sql(`update public.queue_entries set verified_hash = 'bb' where user_id in ('${ann}','${bob}')`);
    await sql(`select public.pair_queue_entries()`);
    expect(await sql(`select * from public.matches where player_a in ('${ann}','${bob}')`)).toHaveLength(0);
    // And both are still queued — a skipped pair is not a consumed one.
    expect(await sql(`select * from public.queue_entries where user_id in ('${ann}','${bob}')`)).toHaveLength(2);
    await sql(`delete from public.queue_entries where user_id in ('${ann}','${bob}')`);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — the friend code is not visible to a friend, and the blocked pair is matched.

- [ ] **Step 3: Write the friend-code migration**

```sql
-- supabase/migrations/20260905132000_friend_codes_for_friends.sql
-- The third route to a friend code, beside "it is yours" and "we share a live
-- match". Accepted only: a pending request must not leak the thing the request
-- is for, or sending one becomes the way to read it.
create policy "an accepted friend may read your friend code"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and f.user_lo = public.pair_lo(friend_codes.profile_id, (select auth.uid()))
         and f.user_hi = public.pair_hi(friend_codes.profile_id, (select auth.uid()))
         and (select auth.uid()) <> friend_codes.profile_id
    )
  );
```

- [ ] **Step 4: Write the blocks-enforcement migration**

```sql
-- supabase/migrations/20260905133000_blocks_reach_the_queue.sql
-- `blocks` cannot enforce itself: the blocked side has no read on it by design.
-- Enforcement lives in the places a block is supposed to bite. This is the
-- scattering the spec calls for, made explicit rather than implied.

-- 1. The blind queue. The pairing scan must SKIP a blocked pair and leave both
--    entries queued for somebody else — not consume them, and not error, since
--    an error is a signal the blocked side could read.
create or replace function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  a public.queue_entries;
  b public.queue_entries;
  paired integer := 0;
begin
  for a in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by created_at
     for update skip locked
  loop
    -- `a` may have been consumed as somebody's `b` earlier in this same loop.
    if not exists (select 1 from public.queue_entries where id = a.id) then
      continue;
    end if;

    select * into b from public.queue_entries q
     where q.verified_hash = a.verified_hash
       and q.league = a.league
       and q.user_id <> a.user_id
       and q.expires_at > now()
       and q.id <> a.id
       and not public.blocked_between(a.user_id, q.user_id)
     order by q.created_at
     limit 1
     for update skip locked;

    if not found then continue; end if;

    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (a.user_id, b.user_id, a.format_version_id, a.verified_hash, a.team, b.team,
       a.data_rev, gen_random_uuid()::text, 'queue');

    delete from public.queue_entries where id in (a.id, b.id);
    paired := paired + 1;
  end loop;
  return paired;
end;
$fn$;

grant execute on function public.pair_queue_entries() to service_role;

-- 2. The offer board. Accepting is a deliberate act aimed at a named person, so
--    unlike the queue it may refuse out loud — but the sentence says the offer
--    is gone, which is also what a lapsed offer says.
create or replace function public.accept_offer_blocked_guard() returns trigger
language plpgsql as $fn$
begin
  if new.accepted_by is not null
     and public.blocked_between(new.proposer_id, new.accepted_by) then
    raise exception 'this offer is no longer available';
  end if;
  return new;
end;
$fn$;

create trigger match_offers_block_guard
  before update on public.match_offers
  for each row execute function public.accept_offer_blocked_guard();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. **The existing `pairing.test.ts` must still be green** — this task rewrites `pair_queue_entries`, and its concurrency guarantees are what that suite pins.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905132000_friend_codes_for_friends.sql supabase/migrations/20260905133000_blocks_reach_the_queue.sql supabase/tests/social.test.ts
git commit -m "feat(social): friends see codes, blocks reach the queue

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

