# Task 5 report: pins, reports, and the sweep that makes expiry real

## Status
Done. Commit `3d0eb05` on `main` (not pushed). Both gates green.

## Files changed
- `supabase/migrations/20260907004000_pins_and_reports.sql` (new) — `message_pins`, `message_reports`, `report_message()`, `sweep_messages()`, policies and grants.
- `supabase/functions/coordinator/index.ts` — wired `sweep_messages` RPC in, surfacing its error, added `messages` to the JSON body.
- `supabase/tests/channels.test.ts` — appended the brief's 4 tests plus 3 more (see "Deviations").
- `supabase/tests/helpers.ts` — added `message_reports` to the `PRIVILEGE_DENIED` regex (needed by one of the added tests).
- `docs/superpowers/HANDOFF.md` — updated both occurrences of the coordinator's healthy-tick JSON body to include `"messages"`.

## Naming deviation (per your correction)
Used `supabase/migrations/20260907004000_pins_and_reports.sql`, not the brief's `20260905144000_pins_and_reports.sql` (which sorts before already-deployed migrations). Confirmed `20260907003000_messages.sql` was the newest migration before this change.

## Corrections applied
1. **`is_channel_member` one-argument signature.** The brief's migration text called `public.is_channel_member(m.channel_id, (select auth.uid()))` in three places (the pin SELECT policy's `using`, the pin ALL policy's `using`, and the pin ALL policy's `with check`), and `public.is_channel_member(chan, me)` once inside `report_message`. Confirmed the real function in `20260907000000_channels_and_members.sql` takes only `p_channel uuid` and derives the user from `auth.uid()` internally. Dropped the second argument in all four call sites.
2. **`refusal` thunk form.** None of the brief's four given tests actually called `refusal`, so this correction applied to the three tests I added for full policy coverage (see below) — all use `const x = await refusal(() => asUser(...)(...))`, each with a uniquely named `const` (`pinDenied`, `insertDenied`) to avoid the duplicate-name bug you flagged.

## Deviation: 3 tests added beyond the brief's 4
The global constraint "every policy gets an allow test AND a deny test" wasn't fully satisfied by the brief's 4 tests alone:
- `message_pins` has two policies (SELECT "visible to members", ALL "member may pin/unpin"). The brief's tests only exercised an *allow* insert (bob pinning in his own channel) — no SELECT test at all, and no deny test for the ALL policy.
- `message_reports`' INSERT/UPDATE/DELETE are revoked from `authenticated` entirely (only `report_message()` can write), which is exactly the kind of privilege-revoke this project has hit bugs on before ("bitten three times") — there was no direct test that a raw `insert` is actually blocked.

Added:
- `'lets a channel member see a pin and nobody else'` — ann (member) sees the pin, cal (non-member, no shared channel) sees zero rows. Allow + deny for the SELECT policy.
- `'stops a non-member pinning a message'` — cal's insert into `message_pins` is refused with `POLICY_DENIED` (fails the ALL policy's `with check` because cal isn't a channel member). Deny for the ALL policy.
- `'stops a direct insert into message_reports; only report_message may write it'` — bob (a real member) attempts `insert into public.message_reports (...)` directly and is refused with `PRIVILEGE_DENIED`. This required adding `message_reports` to the `PRIVILEGE_DENIED` regex in `supabase/tests/helpers.ts`, following the same pattern by which every other table name already in that regex was added task-by-task.

None of these weaken or replace anything in the brief — they're additive, in the same style as the surrounding suite.

## Grant-trap fix (found by inspection, not by the brief)
The brief's migration text only had `revoke all on function public.sweep_messages() from public, anon;` before granting to `service_role`. I initially wrote it that way per your literal instruction ("`revoke all ... from public, anon` BEFORE its grant"), reset, and checked the ACL — `sweep_messages` showed `authenticated=X/postgres`, which is exactly the failure mode you warned about.

Root cause: this Supabase stack's bootstrap runs `alter default privileges ... grant execute on functions to anon, authenticated, service_role` (or equivalent), so a brand-new function is auto-granted directly to `authenticated`, not just to `PUBLIC`. Revoking from `public, anon` alone doesn't touch that. I checked the three existing service_role-only functions in this codebase (`sweep_matches`, `sweep_expired`, `pair_queue_entries`) and every one of them revokes `from public, anon, authenticated` — three roles, not two — with `sweep_matches`'s own comment stating this exact reason ("Without an explicit revoke here, `authenticated` would inherit that default grant"). Fixed `sweep_messages`'s revoke line to match that pattern and re-verified. `report_message` correctly revokes from only `public, anon` (it goes on to grant to `authenticated` anyway, matching `is_channel_member`/`blocked_with_me`'s pattern).

## Coordinator change
Followed the existing `sweep_expired`/`sweep_matches` pattern exactly — no swallowed error:
```ts
const { data: sweptMessages, error: sweepMessagesError } = await admin.rpc('sweep_messages');
if (sweepMessagesError) return new Response(sweepMessagesError.message, { status: 500 });
return Response.json({ verified, paired, swept, matches: sweptMatches ?? 0, messages: sweptMessages ?? 0 });
```
Left `pair_queue_entries`'s existing swallow untouched, as instructed.

## HANDOFF.md — 2 occurrences found and changed
Both `"verified"` hits, both updated to add `"messages"` to the example body and to the prose that says a `500` can come from either sweep RPC:
- Line ~166 (unconfigured-path check): `{"verified":0,"paired":0,"swept":0,"matches":0}` → `...,"messages":0}`, plus the following sentence naming `sweep_matches` now also names `sweep_messages`.
- Line ~509 (healthy-tick check): `{"verified":N,"paired":N,"swept":N,"matches":N}` → `...,"messages":N}`, plus the explanatory sentence extended to cover both non-swallowed RPCs.

## Commands run, verbatim, with real output

**Step 1/2 — tests written, then run to see them fail:**
```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"
EXIT=1
```
Relevant log lines:
```
→ function public.sweep_messages() does not exist
→ relation "public.message_pins" does not exist
→ function public.report_message(unknown, unknown) does not exist
Test Files  1 failed | 10 passed (11)
     Tests  7 failed | 196 passed (203)
```
All 7 new tests failed for the expected reason (missing relations/functions), 196 pre-existing tests still passed.

**Step 3 — migration written. First reset + ACL check caught the grant-trap bug:**
```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('report_message','sweep_messages') order by 1;"
report_message|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
sweep_messages|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```
`sweep_messages` had `authenticated` — a failure. Fixed the revoke line (see above), re-reset, re-checked:
```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('report_message','sweep_messages') order by 1;"
report_message|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
sweep_messages|postgres=X/postgres | service_role=X/postgres
```
`sweep_messages` now shows no `authenticated` and no bare `=X/postgres` (PUBLIC). Correct.

**Step 5 — both gates:**
```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET=$?"
RESET=0
...
Applying migration 20260907004000_pins_and_reports.sql...
Finished supabase db reset on branch main.

cd app && npm run check:db > /tmp/db.log 2>&1; echo "DB=$?"
DB=0
 Test Files  11 passed (11)
      Tests  203 passed (203)

cd app && npm run check > /tmp/app.log 2>&1; echo "APP=$?"
APP=0
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```
`verify:coordinator-bundle` ran inside `npm run check` and passed (visible in the log around `> node scripts/verify-coordinator-bundle.mjs`), confirming the coordinator still builds after the `index.ts` edit.

**Step 6 — commit:**
```
git add supabase/migrations/20260907004000_pins_and_reports.sql supabase/functions/coordinator/index.ts supabase/tests/channels.test.ts supabase/tests/helpers.ts docs/superpowers/HANDOFF.md
git commit -m "feat(chat): pins, reports, and a sweep that makes expiry real

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
[main 3d0eb05] feat(chat): pins, reports, and a sweep that makes expiry real
 5 files changed, 208 insertions(+), 9 deletions(-)
 create mode 100644 supabase/migrations/20260907004000_pins_and_reports.sql
```
Not pushed, per instructions.

## Test counts
- `check:db` before migration: 196 passed / 7 failed (203 total) — expected failure.
- `check:db` after migration: 203/203 passed.
- `check` (app suite, full gate incl. coordinator bundle verify): 1233/1233 passed.

## The three retention rules — verified in one `sweep_messages()` DELETE
```sql
delete from public.messages m
 where m.expires_at <= now()
   and not exists (select 1 from public.message_pins p where p.message_id = m.id)
   and not exists (
     select 1 from public.message_reports r
      where r.message_id = m.id
        and (r.state = 'open' or r.resolved_at > now() - interval '30 days')
   );
```
- Unpinned/unreported: governed entirely by `expires_at` (Task 4's 7-day default) — no change to that interval.
- Pinned: `not exists (... message_pins ...)` — held for as long as any pin row exists, no separate interval.
- Reported: `not exists (... open, or resolved less than 30 days ago ...)` — held indefinitely while `state = 'open'`, then 30 more days after `resolved_at`.
All three conditions are `and`-ed into the single `where` clause of one `delete`, so there is no way for them to disagree with each other about a given row.

## Anything I'm unsure about
- The grant-trap fix (revoking from `authenticated` too for `sweep_messages`) is a deviation from your literal correction text ("revoke all ... from public, anon before its grant"), but it's required to actually pass your own stated bar ("`sweep_messages` must show no `authenticated`"), and it matches the codebase's own established pattern and its own comment explaining exactly this failure mode. I'm confident this is right, but flagging it since it technically contradicts the literal wording of instruction 3 while satisfying its actual verification requirement.
- I added 3 tests and one line to `helpers.ts` beyond the brief's exact verbatim test code, reasoning from the "every policy gets an allow test AND a deny test" global constraint. If the intent was strictly "use only the brief's 4 tests, verbatim plus the 2 named corrections," this is a scope expansion — but it's small, additive, in-pattern, and all 7 new + 196 old tests pass.
