-- `(select auth.uid())` rather than a bare `auth.uid()` throughout: RLS
-- predicates evaluate per row, and the subquery form lets the planner
-- hoist it once instead of re-evaluating it on every row scanned.

create policy "profiles are readable by anyone signed in"
  on public.profiles for select
  to authenticated
  using (true);

create policy "a profile is editable only by its owner"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "a profile is created only by its owner"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Readable only by its owner today. M3 adds an accepted-friendship branch and
-- M5 a shared-active-match branch as further `or` conditions; this policy IS
-- the reveal-on-mutual-accept behaviour, not a feature to be written later.
create policy "a friend code is readable by its owner"
  on public.friend_codes for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create policy "a friend code is written only by its owner"
  on public.friend_codes for all
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);
