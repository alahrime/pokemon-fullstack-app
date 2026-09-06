### Task 2: Who may open what — friends, opponents, and mutual friend groups

Three rules, and they are the product decision this whole plan exists to encode:

- **A DM** may be opened with an accepted friend, **or** with someone you share a live match with. That is "message friends and opponents".
- **A group** is created with people who are already your accepted friends.
- **Adding to a group** is done by a member, and only with *their own* accepted friends. That is what makes a group a *mutual friend* group: nobody is ever in a room with a stranger somebody else dragged in without a friendship somewhere.

**Files:**
- Create: `supabase/migrations/20260905141000_channel_functions.sql`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Consumes: `public.pair_lo`, `public.pair_hi`, `public.blocked_between`, `public.friendships` from the M3a plan; `public.is_channel_member` from Task 1.
- Produces, all granted to `authenticated`:
  - `public.are_friends(a uuid, b uuid) returns boolean`
  - `public.open_dm(p_other uuid) returns uuid`
  - `public.create_group(p_title text, p_members uuid[]) returns uuid`
  - `public.add_to_group(p_channel uuid, p_user uuid) returns boolean`
  - `public.leave_channel(p_channel uuid) returns boolean`

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  async function befriend(a: string, b: string) {
    const [lo, hi] = [a, b].sort();
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by, status)
               values ('${lo}', '${hi}', '${a}', 'accepted')`);
  }

  const openDm = (who: string, other: string) =>
    asUser({ sub: who })<{ open_dm: string }>(`select public.open_dm('${other}') as open_dm`);

  it('opens a dm with a friend, and returns the same channel twice', async () => {
    await befriend(ann, bob);
    const [first] = await openDm(ann, bob);
    const [second] = await openDm(bob, ann);
    expect(second.open_dm).toBe(first.open_dm);
    expect(await sql(`select * from public.channel_members where channel_id = '${first.open_dm}'`)).toHaveLength(2);
  });

  it('opens a dm with an opponent you share a live match with, without a friendship', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Chat Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cc') returning id`,
    );
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${ann}', '${cal}', '${v.id}', 'cc', '[]'::jsonb, '[]'::jsonb, 'r', 's', 'queue')`,
    );
    const [dm] = await openDm(ann, cal);
    expect(dm.open_dm).toBeTruthy();
  });

  it('refuses a dm with a stranger, and says the same thing to a blocked user', async () => {
    await expect(openDm(ann, bob)).rejects.toThrow(/cannot be messaged/);
    await befriend(ann, bob);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${bob}')`);
    await expect(openDm(bob, ann)).rejects.toThrow(/cannot be messaged/);
    await expect(openDm(ann, randomUUID())).rejects.toThrow(/cannot be messaged/);
  });

  it('creates a group only out of the creator s own friends', async () => {
    await befriend(ann, bob);
    await expect(
      asUser({ sub: ann })(`select public.create_group('Squad', array['${bob}','${cal}']::uuid[])`),
    ).rejects.toThrow(/only add your own friends/);

    await befriend(ann, cal);
    const [g] = await asUser({ sub: ann })<{ create_group: string }>(
      `select public.create_group('Squad', array['${bob}','${cal}']::uuid[]) as create_group`,
    );
    expect(await sql(`select * from public.channel_members where channel_id = '${g.create_group}'`)).toHaveLength(3);
  });

  it('lets a member add their own friend, and refuses to add a stranger', async () => {
    await befriend(ann, bob);
    const [g] = await asUser({ sub: ann })<{ create_group: string }>(
      `select public.create_group('Squad', array['${bob}']::uuid[]) as create_group`,
    );
    // bob is a member but is not friends with cal.
    await expect(
      asUser({ sub: bob })(`select public.add_to_group('${g.create_group}', '${cal}')`),
    ).rejects.toThrow(/only add your own friends/);

    await befriend(bob, cal);
    const [added] = await asUser({ sub: bob })<{ add_to_group: boolean }>(
      `select public.add_to_group('${g.create_group}', '${cal}') as add_to_group`,
    );
    expect(added.add_to_group).toBe(true);
  });

  it('refuses to add someone to a group they are not a member of', async () => {
    await befriend(ann, bob);
    await befriend(cal, bob);
    const [g] = await asUser({ sub: ann })<{ create_group: string }>(
      `select public.create_group('Squad', array['${bob}']::uuid[]) as create_group`,
    );
    await expect(
      asUser({ sub: cal })(`select public.add_to_group('${g.create_group}', '${bob}')`),
    ).rejects.toThrow(/not a member/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL with `function public.open_dm(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905141000_channel_functions.sql
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and user_lo = public.pair_lo(a, b)
       and user_hi = public.pair_hi(a, b)
  )
$fn$;

create or replace function public.share_a_live_match(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.matches m
     where m.state in ('paired', 'reported', 'mismatch', 'disputed')
       and ((m.player_a = a and m.player_b = b) or (m.player_a = b and m.player_b = a))
  )
$fn$;

-- One sentence for every reason a DM cannot be opened. A caller that can tell
-- "they blocked me" from "we are not friends" can enumerate blocks.
create or replace function public.open_dm(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  key text;
  existing uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_other is null or p_other = me
     or not exists (select 1 from public.profiles where id = p_other)
     or public.blocked_between(me, p_other)
     or not (public.are_friends(me, p_other) or public.share_a_live_match(me, p_other)) then
    raise exception 'that person cannot be messaged';
  end if;

  key := public.pair_lo(me, p_other)::text || ':' || public.pair_hi(me, p_other)::text;

  select id into existing from public.channels where dm_key = key;
  if found then return existing; end if;

  -- Two simultaneous "open the DM" clicks race here. The unique index on
  -- dm_key is what decides it; the loser reads the winner's row rather than
  -- raising, so both clicks land in the same conversation.
  begin
    insert into public.channels (kind, created_by, dm_key) values ('dm', me, key) returning id into existing;
  exception when unique_violation then
    select id into existing from public.channels where dm_key = key;
    return existing;
  end;

  insert into public.channel_members (channel_id, user_id) values (existing, me), (existing, p_other);
  return existing;
end;
$fn$;

create or replace function public.create_group(p_title text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  channel uuid;
  m uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'a group needs a name'; end if;

  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m = me then continue; end if;
    -- The rule that makes this a MUTUAL FRIEND group: you seed it with people
    -- you are actually friends with, and nobody else can be dropped in.
    if not public.are_friends(me, m) or public.blocked_between(me, m) then
      raise exception 'you can only add your own friends to a group';
    end if;
  end loop;

  insert into public.channels (kind, created_by, title) values ('group', me, btrim(p_title))
  returning id into channel;

  insert into public.channel_members (channel_id, user_id, role) values (channel, me, 'owner');
  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m = me then continue; end if;
    insert into public.channel_members (channel_id, user_id) values (channel, m)
    on conflict do nothing;
  end loop;

  return channel;
end;
$fn$;

create or replace function public.add_to_group(p_channel uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  k text;
begin
  if me is null then raise exception 'not signed in'; end if;
  select kind into k from public.channels where id = p_channel;
  if k is null then raise exception 'no such channel'; end if;
  if k <> 'group' then raise exception 'only a group takes new members'; end if;
  if not public.is_channel_member(p_channel, me) then raise exception 'you are not a member'; end if;
  -- Checked against the ADDER's friendships, not the owner's. Every person in
  -- the room got there through somebody they are friends with.
  if not public.are_friends(me, p_user) or public.blocked_between(me, p_user) then
    raise exception 'you can only add your own friends to a group';
  end if;

  insert into public.channel_members (channel_id, user_id) values (p_channel, p_user)
  on conflict do nothing;
  return true;
end;
$fn$;

create or replace function public.leave_channel(p_channel uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  k text;
  n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  select kind into k from public.channels where id = p_channel;
  -- A match channel is part of the record of the match. Leaving a DM likewise
  -- would strand the other side talking to nobody; hide it client-side instead.
  if k in ('match', 'dm') then raise exception 'this channel cannot be left'; end if;
  delete from public.channel_members where channel_id = p_channel and user_id = me;
  get diagnostics n = row_count;
  -- The last person out closes the room rather than leaving an orphan.
  delete from public.channels c
   where c.id = p_channel
     and not exists (select 1 from public.channel_members where channel_id = c.id);
  return n > 0;
end;
$fn$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.share_a_live_match(uuid, uuid) to authenticated;
grant execute on function public.open_dm(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_to_group(uuid, uuid) to authenticated;
grant execute on function public.leave_channel(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905141000_channel_functions.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): dms with friends and opponents, mutual-friend groups

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

