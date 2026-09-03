-- Saved rosters gain a size (task 5b — reported by the human partner mid-M2a,
-- ledger Ruling 13).
--
-- Both builders — GBL (size=3) and Show 6 (size=6) — rendered the same
-- TeamBuilderScreen and shared one unfiltered `listTeams()`. That meant every
-- roster showed up in both pickers, distinguishable only by name, and the
-- overwrite prompt this screen offers — added the same day this migration was
-- written — matched a same-named roster from EITHER size. Its update path
-- upserts the new slots and then deletes every slot past the new length, so
-- saving a 3-roster under a name already used by a 6-roster silently deleted
-- three of that six's members. This migration is what lets the client scope
-- `listTeams` and the save gate to one size, closing that hole at the source
-- rather than patching the symptom in the screen.
--
-- The rule: size is a consequence of the screen a roster was saved from, not
-- a stored guess. A roster saved from Show 6 is a 6-roster; one from GBL is a
-- 3-roster — never anything else.
alter table public.teams add column size smallint;

-- Backfill is exact for every roster that exists: the partner's local
-- database holds exactly 2 saved rosters, both complete at 6 members, and
-- production holds no rows at all (no accounts yet). All of them are
-- complete, and from here on the save gate guarantees completeness, so member
-- count IS the size. The `> 3` form rather than `= 6` so a partial roster
-- predating this rule (none exist today, but the check below cannot assume
-- that forever) lands somewhere deterministic rather than violating the
-- check that follows.
update public.teams t
   set size = case when (select count(*) from public.team_members m where m.team_id = t.id) > 3 then 6 else 3 end;

alter table public.teams alter column size set not null;
alter table public.teams add constraint teams_size check (size in (3, 6));

-- The name-uniqueness index widens to include size. Under the new rule a GBL
-- "Core" and a Show 6 "Core" are two different rosters, and once each
-- builder's list only ever shows its own size, forbidding the shared name
-- would be a restriction the UI could never explain to the person hitting it.
--
-- A unique index cannot gain a column in place, so this drops
-- `teams_owner_name_uniq` (from migration 20260902163500) and recreates it
-- under the SAME name with size added: (owner_id, size, lower(btrim(name))).
-- The name is kept deliberately — `writeError` in app/src/lib/saves.ts
-- matches the string "teams_owner_name_uniq" in the 23505 Postgres returns to
-- turn it into a readable sentence, and a renamed index would silently break
-- that mapping back down to a raw constraint-violation message.
--
-- Done last, after size is populated and NOT NULL: an index over a column
-- cannot be built while that column is still nullable mid-backfill.
drop index if exists public.teams_owner_name_uniq;
create unique index teams_owner_name_uniq on public.teams (owner_id, size, lower(btrim(name)));
