### Task 4: Messages, expiry, and the block that reaches into a DM

`expires_at` defaults to seven days out. The client shows messages as ephemeral well before that; the server holds them exactly long enough for a victim to report and a moderator to act, which is the trade the spec makes explicitly.

**Files:**
- Create: `supabase/migrations/20260905143000_messages.sql`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Produces: `public.messages (id, channel_id, author_id, body, created_at, edited_at, deleted_at, expires_at)`.
- Produces: `messages` added to the `supabase_realtime` publication.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  it('lets a member post and read, and a non-member neither', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    await asUser({ sub: ann })(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'hello')`,
    );
    expect(await asUser({ sub: bob })(`select body from public.messages where channel_id = '${dm.open_dm}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select body from public.messages where channel_id = '${dm.open_dm}'`)).toHaveLength(0);
    const denied_policy_denied = await refusal(() =>
        asUser({ sub: cal })(`insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'intruding')`),
    );
    expect(denied_policy_denied.message).toMatch(POLICY_DENIED);
  });

  it('stops a blocked person posting into a dm they already share', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${bob}')`);
    const denied_policy_denied = await refusal(() =>
        asUser({ sub: bob })(`insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'still here')`),
    );
    expect(denied_policy_denied.message).toMatch(POLICY_DENIED);
    // And ann can still post; a block is one-directional.
    await asUser({ sub: ann })(`insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'fine')`);
  });

  it('gives a new message a seven-day life', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    const [msg] = await asUser({ sub: ann })<{ expires_at: string }>(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'tick')
       returning expires_at`,
    );
    const days = (new Date(msg.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('lets an author edit and soft-delete their own message only', async () => {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    const [msg] = await asUser({ sub: ann })<{ id: string }>(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'typo') returning id`,
    );
    await asUser({ sub: bob })(`update public.messages set body = 'hijacked' where id = '${msg.id}'`);
    const [after] = await sql<{ body: string }>(`select body from public.messages where id = '${msg.id}'`);
    expect(after.body, 'filtered out by USING, 0 rows, no error').toBe('typo');

    await asUser({ sub: ann })(`update public.messages set body = 'fixed', edited_at = now() where id = '${msg.id}'`);
    const [edited] = await sql<{ body: string }>(`select body from public.messages where id = '${msg.id}'`);
    expect(edited.body).toBe('fixed');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.messages" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905143000_messages.sql
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Soft delete: the row survives its author removing it, because a message
  -- deleted the instant it is read is a message no moderator ever sees. The
  -- reader's view is where a deletion is honoured; retention is the server's.
  deleted_at timestamptz,
  -- Seven days. The spec's rule is "the shortest window that still permits
  -- investigation" — long enough for a victim to report, short enough that the
  -- store is not an archive.
  expires_at timestamptz not null default now() + interval '7 days',
  constraint messages_body_not_empty check (btrim(body) <> ''),
  constraint messages_body_length check (length(body) <= 4000)
);

create index messages_channel_idx on public.messages (channel_id, created_at desc);
create index messages_expiry_idx on public.messages (expires_at);

alter table public.messages enable row level security;

create policy "a message is visible to the channel's members"
  on public.messages for select
  to authenticated
  using (public.is_channel_member(channel_id, (select auth.uid())));

-- The block enforcement the spec asks for, as a `not exists` clause in the
-- policy of the table it constrains. It cannot live in `blocks`, because the
-- blocked side has no read on that table by design.
create policy "a member who is not blocked may post"
  on public.messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id, (select auth.uid()))
    and not exists (
      select 1
        from public.channel_members other
       where other.channel_id = messages.channel_id
         and other.user_id <> (select auth.uid())
         and public.blocked_between(other.user_id, (select auth.uid()))
    )
  );

create policy "an author may edit or soft-delete their own message"
  on public.messages for update
  to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- No DELETE policy anywhere. Hard deletion is retention's job, and it runs as
-- the table owner. A user "deleting" a message sets deleted_at.
revoke delete on public.messages from authenticated;

-- Realtime. Without this the client's postgres_changes subscription silently
-- receives nothing — no error, no warning, an empty chat that looks like a
-- network problem.
alter publication supabase_realtime add table public.messages;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905143000_messages.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): messages, ephemeral by default, blocks enforced in policy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

