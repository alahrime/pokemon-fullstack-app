-- Battle Tracker: alternate GO accounts.
--
-- Many players run more than one GO account, each with its own GBL Elo and its
-- own 25 battles a day. A player may log up to two alts besides their main —
-- three accounts in all. An alt is named after its in-game trainer, which must
-- differ from the main account's (profiles.go_username) and from the other alt.
--
-- A set belongs to the main account (account_id null) or to one alt. Each
-- account is its own row on the season ladder and its own season; the meta still
-- counts every battle a player logs, on whichever account.

create table public.gbl_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 30 and name = btrim(name)),
  created_at timestamptz not null default now()
);
create unique index gbl_accounts_name on public.gbl_accounts (user_id, lower(name));

-- At most two, and never the main account's own trainer name.
create or replace function public.gbl_accounts_guard() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' and (select count(*) from public.gbl_accounts where user_id = new.user_id) >= 2 then
    raise exception 'two alternate accounts at most' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.profiles p where p.id = new.user_id and lower(p.go_username) = lower(new.name)) then
    raise exception 'an alternate account cannot share the main account''s trainer name' using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;
create trigger gbl_accounts_guard before insert or update of name on public.gbl_accounts
  for each row execute function public.gbl_accounts_guard();

alter table public.gbl_accounts enable row level security;
revoke all on public.gbl_accounts from anon;
grant select, insert, update, delete on public.gbl_accounts to authenticated;
create policy "an alt account is its owner's" on public.gbl_accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Deleting an alt deletes its sets and, through them, its battles.
alter table public.gbl_sets add column account_id uuid references public.gbl_accounts (id) on delete cascade;
create index gbl_sets_account on public.gbl_sets (account_id) where account_id is not null;

drop policy "a set is its owner's" on public.gbl_sets;
create policy "a set is its owner's, on its owner's account" on public.gbl_sets for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (account_id is null or exists (select 1 from public.gbl_accounts a where a.id = account_id and a.user_id = (select auth.uid()))));

-- One account's season: null is the main account.
drop function public.gbl_season_sets(uuid, smallint);
create or replace function public.gbl_season_sets(p_user uuid, p_season smallint, p_account uuid default null)
returns table (id uuid, format text, elo_start smallint, elo_end smallint, started_at timestamptz,
               wins integer, losses integer, ties integer, battles integer)
language sql stable security definer set search_path = public as $fn$
  select s.id, s.format, s.elo_start, s.elo_end, s.started_at,
         count(*) filter (where b.result = 'win')::integer,
         count(*) filter (where b.result = 'loss')::integer,
         count(*) filter (where b.result = 'tie')::integer,
         count(b.id)::integer
    from public.gbl_sets s
    left join public.gbl_battles b on b.set_id = s.id
   where s.user_id = p_user and s.season = p_season and s.account_id is not distinct from p_account
     and public.gbl_visible(p_user)
   group by s.id
   order by s.started_at
$fn$;
revoke all on function public.gbl_season_sets(uuid, smallint, uuid) from public, anon;
grant execute on function public.gbl_season_sets(uuid, smallint, uuid) to authenticated;

-- The ladder, one row per account: an alt climbs on its own Elo.
drop function public.gbl_leaderboard(smallint);
create or replace function public.gbl_leaderboard(p_season smallint)
returns table (user_id uuid, account_id uuid, account_name text, display_name text, avatar text, elo smallint, peak smallint,
               wins integer, losses integer, ties integer, battles integer, is_friend boolean)
language sql stable security definer set search_path = public as $fn$
  with sets as (
    select s.* from public.gbl_sets s where s.season = p_season and public.gbl_visible(s.user_id)
  ), tally as (
    select s.user_id, s.account_id,
           count(*) filter (where b.result = 'win')::integer as wins,
           count(*) filter (where b.result = 'loss')::integer as losses,
           count(*) filter (where b.result = 'tie')::integer as ties,
           count(b.id)::integer as battles
      from sets s left join public.gbl_battles b on b.set_id = s.id
     group by s.user_id, s.account_id
  ), last as (
    select distinct on (user_id, account_id) user_id, account_id, coalesce(elo_end, elo_start) as elo
      from sets where coalesce(elo_end, elo_start) is not null
     order by user_id, account_id, started_at desc
  ), peak as (
    select user_id, account_id, max(greatest(coalesce(elo_end, 0), coalesce(elo_start, 0)))::smallint as peak
      from sets group by user_id, account_id
  )
  select t.user_id, t.account_id, a.name, p.display_name, p.avatar, l.elo, nullif(k.peak, 0),
         t.wins, t.losses, t.ties, t.battles, public.are_friends((select auth.uid()), t.user_id)
    from tally t
    join public.profiles p on p.id = t.user_id
    left join public.gbl_accounts a on a.id = t.account_id
    left join last l on l.user_id = t.user_id and l.account_id is not distinct from t.account_id
    left join peak k on k.user_id = t.user_id and k.account_id is not distinct from t.account_id
   order by l.elo desc nulls last, t.wins desc
$fn$;
revoke all on function public.gbl_leaderboard(smallint) from public, anon;
grant execute on function public.gbl_leaderboard(smallint) to authenticated;
