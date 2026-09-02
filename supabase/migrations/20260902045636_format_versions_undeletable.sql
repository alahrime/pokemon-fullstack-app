-- format_versions claims to be immutable once published, but the previous
-- migration only enforced that against UPDATE. The owner's `for all` policy
-- still permitted DELETE, so a version could vanish outright — which is a
-- bigger integrity failure than a rewrite, since M2 decides matches under a
-- specific version and a ruleset that can disappear after the fact is
-- exactly what immutability exists to prevent.
--
-- The obvious fix — a `before delete` trigger mirroring the UPDATE one — is
-- wrong. format_versions.format_id references formats(id) on delete cascade,
-- so a `before delete` trigger on format_versions would also fire when a
-- format itself is deleted, which would make every format undeletable. Do
-- not "fix" this back to a trigger; a cascade running as the table owner
-- bypasses RLS but NOT triggers, so a delete trigger here defeats the
-- cascade rather than defeating a stray client DELETE.
--
-- The actual fix is to narrow the policy instead: grant the owner SELECT and
-- INSERT, but not DELETE. A direct client DELETE is then denied by RLS
-- (silently filtered to zero rows, same as any other RLS-denied write), while
-- `formats`'s `on delete cascade` still removes a format's versions when the
-- format itself goes, because that cascade runs as the table owner and
-- bypasses RLS entirely — it was never going through this policy in the
-- first place.
drop policy "format versions follow their format" on public.format_versions;

create policy "an owner can read their format's versions"
  on public.format_versions for select
  to authenticated
  using (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.owner_id = (select auth.uid())
    )
  );

create policy "an owner can append a version to their format"
  on public.format_versions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.formats f
      where f.id = format_versions.format_id and f.owner_id = (select auth.uid())
    )
  );

-- UPDATE is deliberately left ungranted for anyone, owner included: the
-- format_versions_immutable trigger already refuses every UPDATE, but the
-- policy should be the first line of defense rather than leaning on the
-- trigger to catch what a grant should never have allowed through.
--
-- DELETE is deliberately left ungranted for everyone (including the owner):
-- that is the entire point of this migration.
