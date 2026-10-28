-- Battle Tracker: the 25, 50 or 100 battles a day was set to.
--
-- 25 a day, 50 on a GO Battle Thursday, 100 in GO Battle Week. The player picks
-- it per account and per day; until now that pick lived in one browser, so a
-- phone and a laptop could disagree. `day` is the player's own calendar day (the
-- client's local date), the same day the tracker groups battles by. An alt's
-- rows go with it; the main account is account_id null.

create table public.gbl_day_sizes (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  account_id uuid references public.gbl_accounts (id) on delete cascade,
  day date not null,
  size smallint not null check (size in (25, 50, 100)),
  unique nulls not distinct (user_id, account_id, day)
);

alter table public.gbl_day_sizes enable row level security;
revoke all on public.gbl_day_sizes from anon;
grant select, insert, update, delete on public.gbl_day_sizes to authenticated;
create policy "a day size is its owner's, on its owner's account" on public.gbl_day_sizes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (account_id is null or exists (select 1 from public.gbl_accounts a where a.id = account_id and a.user_id = (select auth.uid()))));
