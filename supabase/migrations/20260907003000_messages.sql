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
-- direction". Directional is still the right shape in a GROUP or a MATCH
-- channel — messaging there silences the BLOCKED party, not the blocker, and
-- a symmetric check would let one blocker mute themselves to every other
-- member of a room they didn't block. A DM is different: a channel with only
-- two members and no one else to protect, where letting the blocker keep
-- posting to a party who blocked them (or who they blocked) makes the block
-- a one-way loudspeaker rather than a wall. `i_blocked` below is the other
-- direction this function deliberately does NOT cover, and the two are
-- combined below only inside the `kind = 'dm'` branch of the INSERT policy.
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

-- The caller-scoped mirror of `blocked_with_me`: that one answers "did
-- p_other block ME", this one answers "did I block p_other". Product
-- decision: a block is SYMMETRIC inside a DM (once either party has blocked
-- the other, neither may post there — see the INSERT policy below), but
-- stays DIRECTIONAL everywhere else, so the policy needs both halves of the
-- pair to enforce the DM case and only `blocked_with_me` for the rest.
--
-- Caller-scoped for the same reason `blocked_with_me` and `is_channel_member`
-- are: it derives ONE side of the pair (here, the blocker) from `auth.uid()`
-- internally, so a caller can only ever ask "did I block this specific
-- person I already share a channel with" — never "did X block Y" for an
-- arbitrary pair. That is what makes it safe to grant, unlike
-- `blocked_between`, which is SECURITY DEFINER, bypasses RLS, and answers for
-- any pair — it stays ungranted to `authenticated`, exactly as it has been
-- since M3a, and this function must never be widened to take both sides as
-- arguments to work around that.
create or replace function public.i_blocked(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.blocks
     where blocker_id = (select auth.uid()) and blocked_id = p_other
  )
$fn$;

-- Three roles, not two: this stack's default privileges grant EXECUTE on a
-- new function to `authenticated` in addition to Postgres's own PUBLIC
-- grant, so revoking only `public, anon` (as `blocked_with_me` above does,
-- immediately followed by an explicit grant to `authenticated`) would leave
-- an *unintended* grant standing on any function whose revoke line forgot to
-- also name `authenticated` explicitly before its own considered grant.
revoke all on function public.i_blocked(uuid) from public, anon, authenticated;
grant execute on function public.i_blocked(uuid) to authenticated;

-- The block enforcement the spec asks for, as a `not exists` clause in the
-- policy of the table it constrains. It cannot live in `blocks`, because the
-- blocked side has no read on that table by design.
--
-- The `kind = 'dm'` branch is why this is `not exists (... and (A or (B and
-- C)))` rather than a flat `blocked_with_me` check: in a DM the two
-- `channel_members` rows are its only two parties, so the "other" row this
-- loop ever sees IS the whole other side of the block, and asking `i_blocked`
-- about them is exactly the symmetric rule the product decision calls for. In
-- a group or match channel, `other` ranges over every member but the two
-- extra clauses stay false for every one of them (the channel's own kind
-- fails `= 'dm'`), leaving only `blocked_with_me` — unchanged, directional.
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
         and (
           public.blocked_with_me(other.user_id)
           or (
             public.i_blocked(other.user_id)
             and exists (
               select 1 from public.channels c
                where c.id = messages.channel_id and c.kind = 'dm'
             )
           )
         )
    )
  );

-- WITH CHECK repeats the INSERT policy's membership and block clauses, not
-- just author_id: with no column grants in this project (Supabase's default
-- privileges grant table-wide UPDATE to `authenticated`), RLS is the only
-- gate on every column of this row, and `author_id = auth.uid()` alone lets
-- the author rewrite channel_id to ANY channel they belong to, moving the
-- message there — which is a post, and must pass the same gate a post does:
-- reproduced live, an author used this to move a message from a solo group
-- they control straight into a DM whose direct-insert path is blocked.
create policy "an author may edit or soft-delete their own message"
  on public.messages for update
  to authenticated
  using (author_id = (select auth.uid()))
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

-- The WITH CHECK above still cannot stop channel_id, author_id, created_at or
-- expires_at from moving to another value that ALSO satisfies it — an author
-- moving their own message into a second channel they are also a member of,
-- or backdating/postponing expires_at, both pass every clause above and need
-- a real OLD-vs-NEW comparison RLS cannot express. A BEFORE UPDATE trigger is
-- the only place that comparison can happen.
--
-- `expires_at` is pinned here on INSERT too, not just UPDATE: the column's
-- `default now() + interval '7 days'` only applies when a client omits the
-- column, and nothing before this trigger stops a client supplying its own
-- value at insert time to extend retention upward or collapse it to the past
-- (hard-deleting their own message at the next sweep before anyone can
-- report it — precisely the window the 7 days exists to preserve). Forcing
-- it here, in the same function that already owns "what may this row's
-- timestamps be", was chosen over `revoke insert (expires_at)` because a
-- column-level INSERT revoke would then require naming every OTHER column
-- back in a matching grant (id, channel_id, author_id, body, ...) for
-- authenticated inserts to keep working at all — more surface for a future
-- migration to get wrong than one branch in one trigger.
-- Deliberately NOT security definer, unlike most trigger functions in this
-- milestone: this one calls no other table and no revoked function, so it
-- needs no elevated privilege to do its job, and staying security invoker is
-- what makes the role check below meaningful. `current_user` inside a
-- SECURITY DEFINER function is the function's OWNER for the whole call —
-- tried first, and confirmed live: with `security definer` on, this guard
-- was always true and enforcement never ran no matter who fired the update.
-- Security invoker keeps `current_user` as the ACTUAL querying role (`set
-- local role authenticated`, in PostgREST's own session and in this suite's
-- `asUser` helper alike), which is what lets this tell apart the two kinds
-- of caller that can reach an UPDATE on this table: a signed-in client
-- through PostgREST, which always runs as `authenticated`, versus
-- server-side maintenance running as `postgres` or `service_role` — this
-- migration's own test suite moves `expires_at` into the past directly, as
-- `postgres`, to simulate a message aging out without a real seven-day wait,
-- and that is not the attack this trigger exists to stop.
create or replace function public.messages_protect_columns() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.expires_at := now() + interval '7 days';
    return new;
  end if;

  if new.channel_id is distinct from old.channel_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'channel_id, author_id, created_at and expires_at cannot be changed after insert';
  end if;
  return new;
end;
$fn$;

-- A trigger function needs no grant of its own — only Postgres invokes it, as
-- the trigger below fires — but `create function` still grants EXECUTE to
-- PUBLIC by default; revoke it from all three roles for consistency with
-- every other function in this migration.
revoke all on function public.messages_protect_columns() from public, anon, authenticated;

create trigger messages_protect_columns
  before insert or update on public.messages
  for each row execute function public.messages_protect_columns();

-- No DELETE policy anywhere. Hard deletion is retention's job, and it runs as
-- the table owner. A user "deleting" a message sets deleted_at.
revoke delete on public.messages from authenticated;

-- Realtime. Without this the client's postgres_changes subscription silently
-- receives nothing — no error, no warning, an empty chat that looks like a
-- network problem.
alter publication supabase_realtime add table public.messages;
