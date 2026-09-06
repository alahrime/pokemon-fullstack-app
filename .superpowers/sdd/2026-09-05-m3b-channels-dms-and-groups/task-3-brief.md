### Task 3: Every match gets a channel, without either pairing function knowing

A trigger, not two edits. `matches` rows are created by `pair_queue_entries` and by `confirm_offer` today, and by whatever M2b's successor adds tomorrow. A trigger cannot be forgotten by a third writer.

**Files:**
- Create: `supabase/migrations/20260905142000_match_channel_trigger.sql`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Produces: `public.create_match_channel()` trigger function on `matches` AFTER INSERT.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  it('gives every new match a channel with exactly its two players', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Trigger Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'dd') returning id`,
    );
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${ann}', '${bob}', '${v.id}', 'dd', '[]'::jsonb, '[]'::jsonb, 'r', 's', 'queue') returning id`,
    );
    const [c] = await sql<{ id: string; kind: string }>(
      `select id, kind from public.channels where match_id = '${m.id}'`,
    );
    expect(c.kind).toBe('match');
    const members = await sql<{ user_id: string }>(
      `select user_id from public.channel_members where channel_id = '${c.id}' order by user_id`,
    );
    expect(members.map((r) => r.user_id).sort()).toEqual([ann, bob].sort());

    // And it is reachable by both players through RLS, with no friendship.
    expect(await asUser({ sub: ann })(`select * from public.channels where id = '${c.id}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select * from public.channels where id = '${c.id}'`)).toHaveLength(0);

    await sql(`delete from public.matches where id = '${m.id}'`);
    expect(await sql(`select * from public.channels where match_id = '${m.id}'`),
      'the channel goes with the match').toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — no row in `channels` for the new match.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905142000_match_channel_trigger.sql
create or replace function public.create_match_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  channel uuid;
begin
  insert into public.channels (kind, created_by, match_id)
  values ('match', new.player_a, new.id)
  returning id into channel;

  insert into public.channel_members (channel_id, user_id)
  values (channel, new.player_a), (channel, new.player_b);

  return new;
end;
$fn$;

-- AFTER INSERT, not inside the pairing functions. `matches` has two writers
-- today and will have more; a trigger is the only version of this that a third
-- one cannot forget.
create trigger matches_get_a_channel
  after insert on public.matches
  for each row execute function public.create_match_channel();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. `pairing.test.ts` and `offers.test.ts` must stay green — they create matches and now create channels as a side effect.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905142000_match_channel_trigger.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): every match gets a channel, by trigger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

