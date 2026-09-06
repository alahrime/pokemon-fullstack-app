### Task 5: Pins, reports, and the sweep that makes ephemerality real

Three retention rules, exactly as the spec's table states them. A pin holds a message while it is pinned; a report holds it through resolution and thirty days after; everything else goes at seven days.

**Files:**
- Create: `supabase/migrations/20260905144000_pins_and_reports.sql`
- Modify: `supabase/functions/coordinator/index.ts`
- Modify: `docs/superpowers/HANDOFF.md`
- Test: `supabase/tests/channels.test.ts` (append)

**Interfaces:**
- Produces: `public.message_pins (message_id, pinned_by, pinned_at)`, `public.message_reports (id, message_id, reporter_id, reason, state, created_at, resolved_at)`.
- Produces: `public.report_message(p_message uuid, p_reason text) returns uuid`, granted to `authenticated`.
- Produces: `public.sweep_messages() returns integer`, granted to `service_role`.
- Produces: the coordinator's JSON body gains a `messages` key.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/channels.test.ts
  async function aMessage(): Promise<{ dm: string; id: string }> {
    await befriend(ann, bob);
    const [dm] = await openDm(ann, bob);
    const [msg] = await asUser({ sub: ann })<{ id: string }>(
      `insert into public.messages (channel_id, body) values ('${dm.open_dm}', 'said') returning id`,
    );
    return { dm: dm.open_dm, id: msg.id };
  }

  it('deletes an expired message and keeps an unexpired one', async () => {
    const { id } = await aMessage();
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`)).toHaveLength(1);
    await sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`)).toHaveLength(0);
  });

  it('keeps a pinned message past its expiry', async () => {
    const { id } = await aMessage();
    await asUser({ sub: bob })(`insert into public.message_pins (message_id) values ('${id}')`);
    await sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`)).toHaveLength(1);
  });

  it('holds a reported message through resolution, then thirty days', async () => {
    const { id } = await aMessage();
    await asUser({ sub: bob })(`select public.report_message('${id}', 'abusive')`);
    await sql(`update public.messages set expires_at = now() - interval '1 minute' where id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`),
      'an open report holds it indefinitely').toHaveLength(1);

    await sql(`update public.message_reports set state = 'resolved', resolved_at = now() - interval '31 days' where message_id = '${id}'`);
    await sql(`select public.sweep_messages()`);
    expect(await sql(`select * from public.messages where id = '${id}'`),
      'thirty days after resolution it goes').toHaveLength(0);
  });

  it('shows a report to its reporter and to no other member', async () => {
    const { id } = await aMessage();
    await asUser({ sub: bob })(`select public.report_message('${id}', 'abusive')`);
    expect(await asUser({ sub: bob })(`select * from public.message_reports`)).toHaveLength(1);
    expect(await asUser({ sub: ann })(`select * from public.message_reports`),
      'the author must not learn they were reported').toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.message_pins" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905144000_pins_and_reports.sql
create table public.message_pins (
  message_id uuid primary key references public.messages (id) on delete cascade,
  pinned_by uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  pinned_at timestamptz not null default now()
);

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  reason text not null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_id),
  constraint message_reports_state check (state in ('open', 'resolved')),
  constraint message_reports_reason check (btrim(reason) <> '' and length(reason) <= 500)
);

create index message_reports_open_idx on public.message_reports (state, created_at) where state = 'open';

alter table public.message_pins enable row level security;
alter table public.message_reports enable row level security;

create policy "a pin is visible to the channel's members"
  on public.message_pins for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id, (select auth.uid()))
    )
  );

create policy "a member may pin and unpin in their own channel"
  on public.message_pins for all
  to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id, (select auth.uid()))
    )
  )
  with check (
    pinned_by = (select auth.uid())
    and exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id, (select auth.uid()))
    )
  );

-- Your own reports and nobody else's. The author of a reported message must not
-- be able to learn they were reported — that is what turns reporting into a
-- risk for the person doing it.
create policy "a report belongs to the person who filed it"
  on public.message_reports for select
  to authenticated
  using (reporter_id = (select auth.uid()));

revoke insert, update, delete on public.message_reports from authenticated;

create or replace function public.report_message(p_message uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  chan uuid;
  report uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select channel_id into chan from public.messages where id = p_message;
  if chan is null then raise exception 'no such message'; end if;
  if not public.is_channel_member(chan, me) then raise exception 'no such message'; end if;

  insert into public.message_reports (message_id, reporter_id, reason)
  values (p_message, me, p_reason)
  on conflict (message_id, reporter_id) do update set reason = excluded.reason
  returning id into report;

  return report;
end;
$fn$;

-- The three retention rules, in one statement so they cannot disagree.
create or replace function public.sweep_messages()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  removed integer;
begin
  delete from public.messages m
   where m.expires_at <= now()
     -- Pinned: held while pinned. User-controlled and deliberate.
     and not exists (select 1 from public.message_pins p where p.message_id = m.id)
     -- Reported: held through resolution, then thirty days.
     and not exists (
       select 1 from public.message_reports r
        where r.message_id = m.id
          and (r.state = 'open' or r.resolved_at > now() - interval '30 days')
     );
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

grant execute on function public.report_message(uuid, text) to authenticated;
grant execute on function public.sweep_messages() to service_role;
```

- [ ] **Step 4: Call it from the coordinator**

Beside the existing RPC calls in `supabase/functions/coordinator/index.ts`:

```ts
  const { data: sweptMessages } = await admin.rpc('sweep_messages');
```

and add `messages: sweptMessages ?? 0` to the returned JSON body. Update the two places in `docs/superpowers/HANDOFF.md` that name the expected body so an operator proving the tick is alive is not comparing against a stale shape.

- [ ] **Step 5: Run both gates to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "DB=$?"; npm run check > /tmp/app.log 2>&1; echo "APP=$?"`
Expected: `DB=0`, `APP=0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905144000_pins_and_reports.sql supabase/functions/coordinator/index.ts supabase/tests/channels.test.ts docs/superpowers/HANDOFF.md
git commit -m "feat(chat): pins, reports, and a sweep that makes expiry real

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

