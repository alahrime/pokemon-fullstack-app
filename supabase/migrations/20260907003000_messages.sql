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
  using (public.is_channel_member(channel_id));

-- `blocked_between(a, b)` is deliberately NOT granted to `authenticated` (see
-- 20260906001000_friendship_functions.sql): it is SECURITY DEFINER and
-- answers for any arbitrary pair, so granting it directly would let any
-- signed-in caller probe whether two strangers have blocked each other. An
-- RLS policy expression runs as the QUERYING role, not as the definer of any
-- function it happens to call — SECURITY DEFINER only changes who owns the
-- function's own execution, not who needs EXECUTE to invoke it — so this
-- policy cannot call the two-argument function directly no matter how it is
-- written. `blocked_with_me` below is the caller-scoped variant that closes
-- that gap: it takes only the OTHER party and derives the caller from
-- auth.uid() internally, so granting it discloses nothing beyond "did this
-- one specific person, who I already share a channel with, block me" — a
-- fact the caller is entitled to for exactly the row they're trying to
-- insert.
--
-- Deliberately DIRECTIONAL, unlike `blocked_between`: it asks only "did
-- p_other block ME", not "does a block exist between us in either
-- direction". Messaging silences the BLOCKED party, not the blocker — a
-- symmetric check (mirroring `blocked_between`, which is right for mutual-
-- exclusion contexts like matchmaking and friend requests) would also stop
-- the person who did the blocking from posting into a DM they chose to stay
-- in, which contradicts the one-directional block this table's own test
-- asserts ("and ann can still post; a block is one-directional").
--
-- Do not widen this back to a two-argument (p_a, p_b) function and do not
-- grant execute on blocked_between(uuid, uuid) to authenticated to work
-- around this — both were tried and rejected in M3a for the reason above.
create or replace function public.blocked_with_me(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.blocks
     where blocker_id = p_other and blocked_id = auth.uid()
  )
$fn$;

-- Postgres auto-grants EXECUTE on a new function to PUBLIC; revoke that
-- default explicitly before granting only to the role that needs it.
revoke all on function public.blocked_with_me(uuid) from public, anon;
grant execute on function public.blocked_with_me(uuid) to authenticated;

-- The block enforcement the spec asks for, as a `not exists` clause in the
-- policy of the table it constrains. It cannot live in `blocks`, because the
-- blocked side has no read on that table by design.
create policy "a member who is not blocked may post"
  on public.messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id)
    and not exists (
      select 1
        from public.channel_members other
       where other.channel_id = messages.channel_id
         and other.user_id <> (select auth.uid())
         and public.blocked_with_me(other.user_id)
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
