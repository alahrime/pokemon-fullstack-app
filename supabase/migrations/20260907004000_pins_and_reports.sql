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
  constraint message_reports_reason check (btrim(reason) <> '' and length(reason) <= 500),
  -- `state` and `resolved_at` are otherwise two independent columns, and
  -- sweep_messages()'s `(r.state = 'open' or r.resolved_at > now() -
  -- interval '30 days')` evaluates to NULL, not true, when state='resolved'
  -- and resolved_at is null — silently dropping the entire thirty-day hold
  -- at the very next tick. No resolve path ships in this milestone, so the
  -- first human resolution in production would be a hand-written `update
  -- message_reports set state = 'resolved'` in the SQL editor that forgets
  -- resolved_at — exactly the statement this constraint refuses, at the
  -- moment it is run, rather than thirty days of silence later.
  constraint message_reports_resolved_consistent
    check ((state = 'resolved') = (resolved_at is not null))
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
         and public.is_channel_member(m.channel_id)
    )
  );

create policy "a member may pin and unpin in their own channel"
  on public.message_pins for all
  to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id)
    )
  )
  with check (
    pinned_by = (select auth.uid())
    and exists (
      select 1 from public.messages m
       where m.id = message_pins.message_id
         and public.is_channel_member(m.channel_id)
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
  if not public.is_channel_member(chan) then raise exception 'no such message'; end if;

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

-- Postgres auto-grants EXECUTE on a new function to PUBLIC; revoke that
-- default explicitly before granting only to the role that needs it.
revoke all on function public.report_message(uuid, text) from public, anon;
grant execute on function public.report_message(uuid, text) to authenticated;

-- service_role only: the coordinator carries the service-role bearer, and a
-- client must not be able to sweep other people's messages. Postgres grants
-- EXECUTE to PUBLIC by default on function creation; without revoking from
-- `authenticated` too, that role would inherit the default grant.
revoke all on function public.sweep_messages() from public, anon, authenticated;
grant execute on function public.sweep_messages() to service_role;
