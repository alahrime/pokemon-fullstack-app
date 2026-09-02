-- Round 1 of this fix dropped DELETE and, along with it, UPDATE, on the
-- reasoning that "the trigger already refuses UPDATE." That reasoning was
-- wrong: with no UPDATE policy at all, RLS filters an owner's UPDATE to zero
-- affected rows *before* the row ever reaches format_versions_immutable —
-- turning a loud, diagnosable "immutable" error into a silent no-op. A
-- client that only checks whether the call threw would believe it had
-- edited an immutable row.
--
-- The layering this migration restores is the one the schema should have
-- had from the start: RLS decides whose rows you may touch; the trigger
-- decides what may change. An owner's UPDATE now passes RLS (same
-- ownership check as SELECT and INSERT), reaches the trigger, and is
-- refused loudly with a message naming the reason. DELETE stays ungranted,
-- so it is still refused by RLS alone; the parent's cascade still works,
-- since a cascade runs as the table owner and bypasses RLS entirely.
create policy "an owner's update reaches the immutability trigger"
  on public.format_versions for update
  to authenticated
  using (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.owner_id = (select auth.uid())
    )
  );
