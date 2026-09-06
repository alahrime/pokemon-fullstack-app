### Task 2: The three things you can do to a friendship

Requesting someone who has already requested you is an **accept**, not a duplicate — that falls out of the one-row-per-pair design, and it is the behaviour a user expects.

Every refusal a blocked user can see is worded identically to the refusal for a person who does not exist. That is not politeness; a distinguishable error is a block detector.

**Files:**
- Create: `supabase/migrations/20260905131000_friendship_functions.sql`
- Test: `supabase/tests/social.test.ts` (append)

**Interfaces:**
- Consumes: `public.pair_lo`, `public.pair_hi`, `public.friendships`, `public.blocks` from Task 1.
- Produces, all granted to `authenticated`:
  - `public.request_friendship(p_target uuid) returns text` — `'pending'` or `'accepted'`
  - `public.respond_to_friendship(p_other uuid, p_accept boolean) returns text` — `'accepted'` or `'removed'`
  - `public.remove_friendship(p_other uuid) returns boolean`
  - `public.block_user(p_target uuid) returns boolean` — blocks and tears down any friendship

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/social.test.ts
  const request = (who: string, target: string) =>
    asUser({ sub: who })<{ request_friendship: string }>(
      `select public.request_friendship('${target}') as request_friendship`,
    );
  const respond = (who: string, other: string, accept: boolean) =>
    asUser({ sub: who })<{ respond_to_friendship: string }>(
      `select public.respond_to_friendship('${other}', ${accept}) as respond_to_friendship`,
    );

  it('turns a mutual request into an accepted friendship', async () => {
    const [first] = await request(ann, bob);
    expect(first.request_friendship).toBe('pending');
    const [second] = await request(bob, ann);
    expect(second.request_friendship).toBe('accepted');
    const [f] = await sql<{ status: string }>(`select status from public.friendships`);
    expect(f.status).toBe('accepted');
  });

  it('will not let the requester accept their own request', async () => {
    await request(ann, bob);
    await expect(respond(ann, bob, true)).rejects.toThrow(/you sent this request/);
    const [f] = await sql<{ status: string }>(`select status from public.friendships`);
    expect(f.status).toBe('pending');
  });

  it('deletes the row when a request is declined', async () => {
    await request(ann, bob);
    const [r] = await respond(bob, ann, false);
    expect(r.respond_to_friendship).toBe('removed');
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
  });

  it('refuses a request in both directions once either side blocks', async () => {
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    // Both messages are the SAME, and the same one a nonexistent user gets.
    await expect(request(bob, ann)).rejects.toThrow(/cannot be sent a friend request/);
    await expect(request(ann, bob)).rejects.toThrow(/cannot be sent a friend request/);
    await expect(request(ann, randomUUID())).rejects.toThrow(/cannot be sent a friend request/);
  });

  it('tears down an existing friendship when one side blocks', async () => {
    await request(ann, bob);
    await respond(bob, ann, true);
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(1);
  });

  it('lets either side remove an accepted friendship', async () => {
    await request(ann, bob);
    await respond(bob, ann, true);
    const [gone] = await asUser({ sub: bob })<{ remove_friendship: boolean }>(
      `select public.remove_friendship('${ann}') as remove_friendship`,
    );
    expect(gone.remove_friendship).toBe(true);
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
  });

  it('refuses a stranger acting on a friendship that is not theirs', async () => {
    await request(ann, bob);
    const [nothing] = await asUser({ sub: cal })<{ remove_friendship: boolean }>(
      `select public.remove_friendship('${ann}') as remove_friendship`,
    );
    expect(nothing.remove_friendship).toBe(false);
    expect(await sql(`select * from public.friendships`)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL with `function public.request_friendship(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905131000_friendship_functions.sql

-- One sentence, used for every reason a request cannot be sent: blocked in
-- either direction, no such profile, or yourself. A caller that can tell those
-- apart can enumerate who has blocked them.
create or replace function public.friend_request_refusal() returns text
language sql immutable as $fn$
  select 'that person cannot be sent a friend request'
$fn$;

create or replace function public.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  )
$fn$;

create or replace function public.request_friendship(p_target uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid;
  h uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_target is null or p_target = me
     or not exists (select 1 from public.profiles where id = p_target)
     or public.blocked_between(me, p_target) then
    raise exception '%', public.friend_request_refusal();
  end if;

  l := public.pair_lo(me, p_target);
  h := public.pair_hi(me, p_target);

  select * into existing from public.friendships where user_lo = l and user_hi = h for update;

  if found then
    if existing.status = 'accepted' then return 'accepted'; end if;
    -- They asked first and now we have asked back. That is an accept, not a
    -- duplicate, and it is the behaviour a person expects.
    if existing.requested_by <> me then
      update public.friendships set status = 'accepted', responded_at = now()
       where user_lo = l and user_hi = h;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (user_lo, user_hi, requested_by) values (l, h, me);
  return 'pending';
end;
$fn$;

create or replace function public.respond_to_friendship(p_other uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid := public.pair_lo(auth.uid(), p_other);
  h uuid := public.pair_hi(auth.uid(), p_other);
  existing public.friendships;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into existing from public.friendships where user_lo = l and user_hi = h for update;
  if not found then raise exception 'there is no request to respond to'; end if;
  if existing.status = 'accepted' then return 'accepted'; end if;
  if existing.requested_by = me then raise exception 'you sent this request'; end if;

  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where user_lo = l and user_hi = h;
    return 'accepted';
  end if;

  delete from public.friendships where user_lo = l and user_hi = h;
  return 'removed';
end;
$fn$;

create or replace function public.remove_friendship(p_other uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  l uuid := public.pair_lo(auth.uid(), p_other);
  h uuid := public.pair_hi(auth.uid(), p_other);
  n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- The `me in (l, h)` guard is what stops a stranger deleting a pair they
  -- named: pair_lo/pair_hi of (me, other) always contains me, so this is only
  -- false when the caller passed a pair they are not part of.
  delete from public.friendships
   where user_lo = l and user_hi = h and me in (user_lo, user_hi);
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

create or replace function public.block_user(p_target uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_target is null or p_target = me then return false; end if;

  insert into public.blocks (blocker_id, blocked_id) values (me, p_target)
  on conflict do nothing;

  -- A block that leaves the friendship standing is not a block. This is why
  -- blocking is a function and not an insert policy.
  delete from public.friendships
   where user_lo = public.pair_lo(me, p_target)
     and user_hi = public.pair_hi(me, p_target);
  return true;
end;
$fn$;

grant execute on function public.request_friendship(uuid) to authenticated;
grant execute on function public.respond_to_friendship(uuid, boolean) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.blocked_between(uuid, uuid) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905131000_friendship_functions.sql supabase/tests/social.test.ts
git commit -m "feat(social): request, accept, remove, block

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

