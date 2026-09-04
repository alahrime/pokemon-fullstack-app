# Task 5b: saved rosters are scoped to team size

**Not from the original plan.** Reported by the human partner during execution and verified (ledger Ruling 13). Runs between Tasks 5 and 6.

## The defect

`teams` records `name` and `league` but not size. Both builders — GBL (`size=3`) and Show 6 (`size=6`) — render the same `TeamBuilderScreen` and call the same unfiltered `listTeams()`. Three consequences, worst last:

1. Every roster appears in both builders' pickers, distinguishable only by name.
2. `loadSaved` does `setTeam(nextTeam.slice(0, size))` — loading a 6-roster in GBL silently discards three members, while the screen warns about a league mismatch and a moved fast move but says nothing about this.
3. **The overwrite prompt makes it destructive.** `rostersNamed` matches on name alone against that unfiltered list, so saving a 3-roster over a same-named 6-roster offers to replace it, and `saveTeam`'s update path upserts 3 slots then deletes every slot past the new length. Three members gone.

## The rule

**Size is a consequence of the screen you saved from, not a stored guess.** A roster saved from Show 6 is a 6-roster; one saved from GBL is a 3-roster. You cannot save a team of 3 from Show 6, or a team of 6 from GBL.

## Measured facts

- The partner's local database holds exactly 2 saved rosters, both with 6 members. No partial saves exist anywhere.
- Production holds no rows at all — no accounts yet.
- So backfill by member count is exact for every roster that exists.

## Required changes

**1. Migration** — timestamp must sort after `20260903011151`.

Add the column nullable, backfill, then constrain — adding `not null` to a populated table in one step fails.

```sql
alter table public.teams add column size smallint;

-- Backfill is exact for every roster that exists: all of them are complete,
-- and from here on the save gate guarantees completeness, so member count IS
-- the size. The `> 3` form rather than `= 6` so a partial roster predating
-- this rule lands somewhere deterministic rather than violating the check.
update public.teams t
   set size = case when (select count(*) from public.team_members m where m.team_id = t.id) > 3 then 6 else 3 end;

alter table public.teams alter column size set not null;
alter table public.teams add constraint teams_size check (size in (3, 6));
```

**2. `app/src/lib/saves.ts`**
- `SavedTeam` gains `size: 3 | 6`.
- `listTeams(size: 3 | 6)` filters server-side with `.eq('size', size)` and selects the column.
- `saveTeam` accepts and sends `size` on both the insert and the update path.

**3. `app/src/screens/TeamBuilderScreen.tsx`**
- Pass the screen's own `size` prop to `listTeams(size)` everywhere it is called (the mount effect, and the refresh after save and after delete).
- Pass `size` to `saveTeam`.
- **The save control requires a complete roster:** disabled unless `team.length === size`, and it must say why, in the manner the blank-name case already does. Today the only check is `team.length === 0`, which is what allows saving 1-of-6.
- Leave `slice(0, size)` in `loadSaved` alone. Once lists are scoped it is unreachable; it stays as a guard.

**4. Tests**
- `supabase/tests/teams.test.ts`: the column exists, is NOT NULL, rejects a size outside (3,6), and accepts 3 and 6.
- `app/src/lib/__tests__/saves.test.ts`: `listTeams(3)` filters by size (assert the `eq` call carries `('size', 3)`), and `saveTeam` sends `size` on insert and on update.
- `app/src/screens/__tests__/team-saves.test.tsx`:
  - saving is disabled with a partial roster in each builder, and enabled at exactly `size`;
  - a 6-roster returned by `listTeams` does not appear in the GBL picker (mount with `size={3}` and assert `listTeams` was called with 3);
  - the overwrite prompt does not fire for a same-named roster of the other size.

## Gates

`cd app && npm run check:db > /tmp/task-5b-db.log 2>&1; echo "EXIT=$?"` and
`cd app && npm run check > /tmp/task-5b-gate.log 2>&1; echo "EXIT=$?"` — both must exit 0.
