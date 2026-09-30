-- Close the forged-offer hole: the owner INSERT policy on match_offers pinned
-- WHO posts but not WHAT — a client could name someone else's private
-- format_version_id. An offer may now only name a version of a format the
-- poster owns or one that is public (the rule create_challenge already applies).
-- security definer because the caller may not be able to read the version.
create function public.offer_format_allowed(p_version uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from public.format_versions v
      join public.formats f on f.id = v.format_id
     where v.id = p_version
       and (f.owner_id = auth.uid() or f.visibility = 'public')
  )
$fn$;

revoke all on function public.offer_format_allowed(uuid) from public, anon;
grant execute on function public.offer_format_allowed(uuid) to authenticated;

-- Policy as of 20260929000000, plus one conjunct.
drop policy "an offer belongs to the person who proposed it" on public.match_offers;
create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check (
    (select auth.uid()) = proposer_id
    and verified_hash is null
    and accepted_by is null
    and accepted_team is null
    and accepted_at is null
    and confirmed_at is null
    and match_id is null
    and state = 'open'
    and target_id is null
    and public.offer_format_allowed(format_version_id)
  );

-- Both columns are used by the read-policy helpers (plays_format*).
create index match_offers_format_version_idx on public.match_offers (format_version_id);
create index match_offers_accepted_by_idx on public.match_offers (accepted_by) where accepted_by is not null;
