# Task 1b — fix the two regressions from `20260904190000_friend_codes_are_twelve_digits.sql`

## Method actually followed

1. Ran `cd app && npm run check:db > /tmp/before.log 2>&1; echo "EXIT=$?"` before any change.
2. Diffed `handle_confirmed_user()` between `20260901225208_profile_only_when_registration_supplied_one.sql`
   (has the three-way null guard) and `20260904190000_friend_codes_are_twelve_digits.sql` (guard gone,
   friend_code block added) by reading both files in full.
3. Read `docs/superpowers/HANDOFF.md` section "A defect Task 6 found in Task 4's schema" for why the
   guard exists.
4. Added new migration `supabase/migrations/20260905123000_restore_the_oauth_signup_guard.sql`
   (`create or replace function public.handle_confirmed_user()` = friend_code body + restored guard).
5. `cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"` — EXIT=0, all 26 migrations
   applied including the two new ones.
6. `cd app && npm run check:db > /tmp/after.log 2>&1; echo "EXIT=$?"` — EXIT=1. Group A's 5 failures
   were gone; the 5 `reports.test.ts` failures from the baseline were also gone (they were just stale
   local-db state — `db:reset` picked up `20260905120000_match_reports_and_rounds.sql`, which the local
   stack hadn't applied yet). But 3 `rls.test.ts` failures remained (Group B), plus one previously
   undetected problem — see below.
7. Fixed the 3 named Group B fixtures in `supabase/tests/rls.test.ts` (the
   `friend_codes write policy — insert and delete` describe block) to use the
   `NNNN NNNN NNNN` format the check constraint requires.
8. Re-ran `check:db` — still EXIT=1. Found an ADDITIONAL problem not called out in the brief: the
   outer `describe('profiles and friend_codes policies', ...)` block's `beforeAll` also inserts fixture
   friend codes in the old plain-digit format (`userA.code = '111122223333'`,
   `userB.code = '444455556666'`), and one of its tests updates a code to `'999988887777'`. That
   `beforeAll` throwing meant the ENTIRE 14-test suite was reported as skipped (a "Failed Suite", not
   individual "failed tests") in both the baseline and the Group-A-only run — which is why the baseline
   tallied "13 failed / 117 passed / 14 skipped" rather than the brief's expected "8 failed / 122
   passed / 14 skipped": those 14 skipped tests were silently a consequence of the same regression,
   just surfaced as a suite-level hook failure instead of per-test failures, so they weren't in either
   named group's count. Fixed those three fixture values the same way (added the required spaces) since
   the brief's final bar — `check:db` EXIT=0, ZERO failures — requires it and the constraint/test intent
   is identical to Group B's.
9. Re-ran `check:db` — EXIT=0, `Test Files 9 passed (9)`, `Tests 144 passed (144)`, 0 skipped.
10. Ran `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"` — EXIT=0, `Test Files 83 passed
    (83)`, `Tests 1209 passed (1209)`.

## Before / after `check:db`

### Before (`/tmp/before.log`, tail)

```
 FAIL  ../supabase/tests/profile-trigger.test.ts > the profile-creation trigger > a signup that collected nothing to build a profile from > lets an OAuth account be created at all
 FAIL  ../supabase/tests/profile-trigger.test.ts > the profile-creation trigger > a signup that collected nothing to build a profile from > leaves that account with no profile, for the client to complete
 FAIL  ../supabase/tests/profile-trigger.test.ts > the profile-creation trigger > a signup that collected nothing to build a profile from > still confirms the account
 FAIL  ../supabase/tests/profile-trigger.test.ts > the profile-creation trigger > a signup that collected nothing to build a profile from > skips the profile when go_username is missing rather than failing
 FAIL  ../supabase/tests/profile-trigger.test.ts > the profile-creation trigger > a signup that collected nothing to build a profile from > skips the profile when birth_date is missing rather than failing
 FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > accepts only scorelines a best-of could actually produce
 FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > seals a report from the opponent until the match is confirmed
 FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > lets nobody write a report or an adjudicated round directly
 FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > shows an adjudicated round to the two players and to nobody else
 FAIL  ../supabase/tests/reports.test.ts > match reports and adjudicated rounds > keeps the opponent friend code readable while the match is still live
 FAIL  ../supabase/tests/rls.test.ts > friend_codes write policy — insert and delete > lets the owner insert their own friend code
 FAIL  ../supabase/tests/rls.test.ts > friend_codes write policy — insert and delete > lets the owner delete their own friend code
 FAIL  ../supabase/tests/rls.test.ts > friend_codes write policy — insert and delete > does not let a different user delete someone else's friend code

 Test Files  3 failed | 6 passed (9)
      Tests  13 failed | 117 passed | 14 skipped (144)
```

Plus a separate "Failed Suites 1" entry for `rls.test.ts > profiles and friend_codes policies` (its
`beforeAll` throwing `PostgresError: new row for relation "friend_codes" violates check constraint
"friend_codes_twelve_digits"`), which is why 14 tests show `↓` (skipped) rather than failed — this is
the extra problem described in step 8 above. It was present at baseline too, just not counted in the
brief's "8 failures" because a hook failure reports as a failed suite, not failed tests.

The 5 `reports.test.ts` failures were a stale-local-db artifact (the previous task's migration
`20260905120000_match_reports_and_rounds.sql` existed on disk but the local stack hadn't been reset
since it landed) — `db:reset` in step 5 fixed them as a side effect, independent of this task's two
migrations/fixture fixes.

### After (`/tmp/after2.log`, tail)

```
 ✓ ../supabase/tests/coordinator-tick.test.ts (9 tests) 90ms
 ✓ ../supabase/tests/profile-trigger.test.ts (13 tests) 152ms
 ✓ ../supabase/tests/reports.test.ts (5 tests) 220ms
 ✓ ../supabase/tests/formats.test.ts (17 tests) 250ms
 ✓ ../supabase/tests/queue.test.ts (11 tests) 287ms
 ✓ ../supabase/tests/rls.test.ts (19 tests) 300ms
 ✓ ../supabase/tests/teams.test.ts (23 tests) 363ms
 ✓ ../supabase/tests/offers.test.ts (21 tests) 469ms
 ✓ ../supabase/tests/pairing.test.ts (26 tests) 1238ms

 Test Files  9 passed (9)
      Tests  144 passed (144)
```

EXIT=0. Zero skipped (the previously-skipped 14-test suite now runs and passes).

## The two function bodies diffed (Group A)

**`20260901225208` (has the guard):**

```sql
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_constraint text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  if new.raw_user_meta_data ->> 'display_name' is null
    or new.raw_user_meta_data ->> 'go_username' is null
    or new.raw_user_meta_data ->> 'birth_date' is null
  then
    return new;
  end if;

  begin
    insert into public.profiles (id, display_name, go_username, birth_date, tos_accepted_at)
    values (...)
    on conflict (id) do nothing;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'profiles_display_name_key' then
      raise;
    end if;
  end;
  return new;
end;
$$;
```

**`20260904190000` (guard dropped, friend_code block added):**

```sql
create or replace function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_constraint text;
  v_code text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  begin
    insert into public.profiles (id, display_name, go_username, birth_date, tos_accepted_at)
    values (...)
    on conflict (id) do nothing;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'profiles_display_name_key' then
      raise;
    end if;
  end;

  v_code := new.raw_user_meta_data ->> 'friend_code';
  if v_code ~ '^[0-9]{4} [0-9]{4} [0-9]{4}$'
     and exists (select 1 from public.profiles p where p.id = new.id) then
    insert into public.friend_codes (profile_id, code)
    values (new.id, v_code)
    on conflict (profile_id) do nothing;
  end if;

  return new;
end;
$$;
```

The three-way null guard (`display_name`/`go_username`/`birth_date` all `is null` → `return new`) is
simply absent between the `email_confirmed_at` check and the `insert into public.profiles`. This is
consistent with `20260904190000` having been written against a base copy of the function that predates
`20260901225208`, rather than a deliberate removal.

## Fix (new migration)

`supabase/migrations/20260905123000_restore_the_oauth_signup_guard.sql` — `create or replace` carrying
the current (friend_code-aware) body from `20260904190000` with the guard re-inserted right after the
`email_confirmed_at` check and before the `profiles` insert, commented as load-bearing so a future
rewrite of this function doesn't drop it again. Did not edit `20260904190000` (already deployed).

## Group B fixture fixes

Constraint (from `20260904190000`): `check (code ~ '^[0-9]{4} [0-9]{4} [0-9]{4}$')` — twelve digits in
three groups of four separated by single spaces. Other passing tests already used this format (e.g.
`rls.test.ts` update test earlier in the file used `'5555 6666 7777'`-shaped values, and
`friend_codes_are_twelve_digits`'s own migration normalizes toward `\1 \2 \3`).

Reformatted in `supabase/tests/rls.test.ts` (values only — no assertions about policy behavior changed):

- `friend_codes write policy — insert and delete` suite (the 3 named failures):
  `'123412341234'` → `'1234 1234 1234'`, `'567856785678'` → `'5678 5678 5678'`,
  `'999900009999'` → `'9999 0000 9999'` (and its matching `.toBe('999900009999')` assertion updated to
  the same reformatted string — the test still asserts the code round-trips unchanged, just spelled with
  spaces).
- `profiles and friend_codes policies` suite's `beforeAll` fixtures (the undisclosed 14-test failure
  described above): `userA.code` `'111122223333'` → `'1111 2222 3333'`, `userB.code` `'444455556666'`
  → `'4444 5555 6666'`, and the "lets a user change their own friend code" test's update value
  `'999988887777'` → `'9999 8888 7777'` (assertion updated to match, same round-trip semantics).
- Left `'000000000000'` (line ~308, the cross-user insert-denial test) untouched: that insert is
  expected to `rejects.toThrow()` regardless of which mechanism denies it (RLS or the check constraint),
  so it was not part of either failing group and changing it isn't required by the brief's "don't touch
  what tests assert" instruction — it's already correct as an attack fixture.

Did not touch the constraint itself, and did not change what any test asserts about policy behavior —
only the code *values* used, plus updating the two literal-comparison assertions to match the
reformatted (but semantically identical) round-tripped values.

## Final verification

- `npm run check:db` → EXIT=0, `Test Files 9 passed (9)`, `Tests 144 passed (144)`, 0 skipped, 0 failed.
- `npm run check` (app) → EXIT=0, `Test Files 83 passed (83)`, `Tests 1209 passed (1209)`.
- The 5 `reports.test.ts` tests from the previous task are among the 144 and pass.

## Things I'm not fully sure about

- The brief said "exactly 8 failures in two groups" and expected a baseline of
  "8 failed / 122 passed / 14 skipped". The actual baseline was 13 failed / 117 passed / 14 skipped,
  with 5 extra failures in `reports.test.ts` (resolved by `db:reset` alone, unrelated to either
  migration fix) and a 14-test skipped suite whose root failure was the same check-constraint problem
  as Group B but wasn't enumerated as one of the "8". I fixed it as part of Group B's commit since the
  brief's hard final bar is `check:db` EXIT=0 with zero failures, and leaving it would have left the
  suite failing (or skipped, if I'd only silenced the hook). If the intent was narrower — literally only
  touch the 3 named tests — this went beyond that, but I judged "zero failures" as the controlling
  requirement over the literal scope of Group B's bullet list.
- I did not modify `'000000000000'` at line ~308; flagging in case reviewer wants every plain-digit
  fixture in the file normalized for consistency even where not strictly required.
