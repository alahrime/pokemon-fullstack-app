create table public.channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  -- Set only for kind='match'. RESTRICT would strand a channel; a match that
  -- is deleted takes its channel with it.
  match_id uuid references public.matches (id) on delete cascade,
  -- Set only for kind='dm': the canonically ordered pair, as 'lo:hi'. It exists
  -- so "open the DM with this person" is an upsert rather than a search that
  -- two simultaneous clicks can both lose.
  dm_key text,
  title text,
  created_at timestamptz not null default now(),
  constraint channels_kind check (kind in ('dm', 'group', 'match')),
  constraint channels_match_id_only_for_match
    check ((kind = 'match') = (match_id is not null)),
  constraint channels_dm_key_only_for_dm
    check ((kind = 'dm') = (dm_key is not null))
);

create unique index channels_dm_key on public.channels (dm_key) where dm_key is not null;
create unique index channels_match_id on public.channels (match_id) where match_id is not null;

create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  -- Nullable and client-writable, which makes an unread count a comparison
  -- rather than a counter. Counters drift under retries; this cannot.
  last_read_at timestamptz,
  primary key (channel_id, user_id),
  constraint channel_members_role check (role in ('member', 'owner'))
);

create index channel_members_user_idx on public.channel_members (user_id);

-- SECURITY DEFINER on purpose. The policy on `channels` needs to ask about
-- `channel_members`, and the policy on `channel_members` needs to ask about
-- `channel_members` — a policy that selects its own table recurses. Asking
-- through a definer function reads the table with RLS bypassed, which is both
-- the fix and, not incidentally, the thing that keeps this off the per-row
-- policy path the spec warns about.
--
-- Deliberately CALLER-SCOPED to one argument (not the two-argument membership
-- probe an earlier draft of this migration used). SECURITY DEFINER bypasses
-- RLS, and the seven RLS policies across this milestone that call this
-- function are evaluated as the QUERYING role, so the grant to `authenticated`
-- below is unavoidable — but a two-argument version taking an arbitrary
-- p_user would let any signed-in caller who learns a channel id ask whether a
-- stranger is a member of it. Deriving the user from auth.uid() internally
-- means a caller can only ever ask about themselves, so the grant discloses
-- nothing. If a later task genuinely needs to ask about another user, add a
-- separate definer-only two-argument variant with a stated reason — do not
-- widen this one back to two arguments.
create or replace function public.is_channel_member(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and user_id = auth.uid()
  )
$fn$;

-- Postgres auto-grants EXECUTE on a new function to PUBLIC; revoke that
-- default explicitly before granting only to the role that needs it.
revoke all on function public.is_channel_member(uuid) from public, anon;
grant execute on function public.is_channel_member(uuid) to authenticated;

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;

create policy "a channel is visible to its members"
  on public.channels for select
  to authenticated
  using (public.is_channel_member(id));

create policy "the member list is visible to members"
  on public.channel_members for select
  to authenticated
  using (public.is_channel_member(channel_id));

-- Your own read position, and only your own.
create policy "you may move your own read position"
  on public.channel_members for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Creation and membership go through the functions in the next migration, which
-- are the only place the friendship rules are checked.
revoke insert, delete on public.channels from authenticated;
revoke update on public.channels from authenticated;
revoke insert, delete on public.channel_members from authenticated;

-- The policy above constrains WHICH ROW ("user_id = auth.uid()"), not WHICH
-- COLUMN. With no column grants, that row's owner could rewrite channel_id
-- to a channel they are not a member of — including one they were a member
-- of and left, a uuid they still legitimately hold, or one seeded by a
-- solo group of their own creation — attaching themselves to its full
-- history and live realtime feed with no membership check ever run. `role`
-- is exposed the same way, letting a member promote themselves to 'owner'.
-- Column grants are the cleaner fix here, rather than a BEFORE UPDATE
-- trigger (the approach `messages` needs instead, in
-- 20260907003000_messages.sql, because a message's legitimate edit touches
-- more than one column): the legitimate update on THIS table is exactly one
-- column (last_read_at), so naming that column is a smaller, harder-to-drift
-- surface than a trigger's deny-list, which a later migration could add a
-- new column to and simply forget to add to the list.
revoke update on public.channel_members from authenticated;
grant update (last_read_at) on public.channel_members to authenticated;
