# Task 3 Report: The passage of time, which is the coordinator's only remaining job

## Summary

Implemented `public.sweep_matches()`, wired it into the coordinator tick, and updated the
operator-facing HANDOFF.md instruction to match the new response shape. Followed TDD: appended
the three tests from the brief, watched them fail with `function public.sweep_matches() does not
exist`, wrote the migration, wired the coordinator, then watched both gates go green.

One deviation from the brief's verbatim SQL, described in detail below: the migration's GRANT
needed an accompanying REVOKE to actually satisfy the task's own binding constraint
("`sweep_matches()` is granted to `service_role` ONLY, never to `authenticated`"). The brief's SQL
as given does not do this.

## Files changed

- Created: `supabase/migrations/20260905122000_sweep_matches.sql`
- Modified: `supabase/functions/coordinator/index.ts`
- Modified: `supabase/tests/reports.test.ts` (appended 3 tests to the existing describe block)
- Modified: `docs/superpowers/HANDOFF.md` (2 occurrences updated)

## Step-by-step

### Step 1-2: Failing test

Appended the three tests verbatim from the brief to the end of the `describe('match reports and
adjudicated rounds', ...)` block in `supabase/tests/reports.test.ts` (before the closing `});`).

Ran:
```
cd app && npm run check:db > /tmp/db_fail.log 2>&1; echo "EXIT=$?"
```
Output: `EXIT=1`

Relevant log excerpt:
```
   × match reports and adjudicated rounds > turns a lapsed amend window into a dispute, and only once it has lapsed 4ms
     → function public.sweep_matches() does not exist
   × match reports and adjudicated rounds > gives up on a match nobody reported, and does not count it 3ms
     → function public.sweep_matches() does not exist
   × match reports and adjudicated rounds > leaves a confirmed match alone forever 10ms
     → function public.sweep_matches() does not exist
...
 Test Files  1 failed | 8 passed (9)
      Tests  3 failed | 150 passed (153)
```

This confirms the baseline (150/150) and the exact expected failure mode.

### Step 3: Migration

Wrote `supabase/migrations/20260905122000_sweep_matches.sql` using the brief's SQL verbatim, with
one addition — see Deviation below. Final file:

```sql
create or replace function public.sweep_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  moved integer := 0;
  n integer;
begin
  update public.matches
     set state = 'disputed', amend_deadline = null
   where state = 'mismatch'
     and amend_deadline is not null
     and amend_deadline <= now();
  get diagnostics n = row_count;
  moved := moved + n;

  update public.matches
     set state = 'unverified', rating_counted = false
   where state in ('paired', 'reported')
     and created_at < now() - interval '48 hours';
  get diagnostics n = row_count;
  moved := moved + n;

  return moved;
end;
$fn$;

revoke all on function public.sweep_matches() from public, anon, authenticated;
grant execute on function public.sweep_matches() to service_role;
```

### Step 4: Coordinator

`supabase/functions/coordinator/index.ts`, last lines now:
```ts
  const { data: paired } = await admin.rpc('pair_queue_entries');
  const { data: swept } = await admin.rpc('sweep_expired');
  const { data: sweptMatches } = await admin.rpc('sweep_matches');
  return Response.json({ verified, paired, swept, matches: sweptMatches ?? 0 });
```

### Step 5: HANDOFF.md

Searched with `grep -n "verified" docs/superpowers/HANDOFF.md`. Found exactly **2** occurrences of
the stale response shape, matching the brief's prediction:

- Line 44: `... Expect \`200\` with \`{"verified":0,"paired":0,"swept":0}\` — the zeros are right, ...`
  → now `{"verified":0,"paired":0,"swept":0,"matches":0}`
- Line 385: `A healthy tick answers \`200\` with \`{"verified":N,"paired":N,"swept":N}\`.`
  → now `{"verified":N,"paired":N,"swept":N,"matches":N}`

No other occurrences of the response shape existed elsewhere in the file (checked every line
mentioning "verified"; the rest are unrelated prose about verification state, not the JSON body).

### Step 6: Both gates

```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET=$?"
```
`RESET=0`

```
cd app && npm run check:db > /tmp/db.log 2>&1; echo "DB=$?"
```
`DB=0`
```
 Test Files  9 passed (9)
      Tests  153 passed (153)
```
(150 baseline + 3 new = 153, all green.)

After discovering the grant gap (see Deviation), re-ran `db:reset` + `check:db` again post-fix —
same result: `RESET=0`, `DB=0`, `153 passed (153)`.

```
cd app && npm run check > /tmp/app.log 2>&1; echo "APP=$?"
```
`APP=0`
```
 Test Files  83 passed (83)
      Tests  1209 passed (1209)
```
Confirmed `verify:coordinator-bundle` executed as part of the `check` script chain (grep on the
log shows the step ran; overall exit 0 means it passed, i.e. the coordinator still builds after
the `index.ts` edit).

Direct DB verification of the grant, via `docker exec supabase_db_paragon-iv psql -U postgres
-tAc "select grantee, privilege_type from information_schema.role_routine_grants where
routine_name = 'sweep_matches';"`:

Before the fix:
```
PUBLIC|EXECUTE
postgres|EXECUTE
anon|EXECUTE
authenticated|EXECUTE
service_role|EXECUTE
```

After the fix:
```
postgres|EXECUTE
service_role|EXECUTE
```

### Step 7: Commit

```
git add supabase/migrations/20260905122000_sweep_matches.sql supabase/functions/coordinator/index.ts supabase/tests/reports.test.ts docs/superpowers/HANDOFF.md
git commit -m "feat(coordinator): expire the amend window, give up on silence

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Commit SHA: `43a1a70fceb0462a2adf91b09c71c121a5bd2665`

Left `.superpowers/sdd/2026-09-05-m2b-reporting-and-adjudication/progress.md` (pre-existing
modification, not part of this task) and `app/.env.local.bak` (untracked, looks like it may hold
local secrets) untouched and unstaged.

## Deviation: the brief's GRANT alone does not satisfy the brief's own constraint

The task's global constraints state explicitly:

> `sweep_matches()` is granted to `service_role` ONLY, never to `authenticated`. The coordinator
> carries the service-role bearer; a client must not be able to expire its own dispute window.

The brief's Step 3 SQL contains only:
```sql
grant execute on function public.sweep_matches() to service_role;
```

PostgreSQL grants `EXECUTE` on a newly created function to `PUBLIC` by default. A bare `grant ...
to service_role` is additive — it does not revoke that default grant. I verified this directly
against the running DB (see grants query above): with the brief's SQL applied verbatim, `anon`,
`authenticated`, and `PUBLIC` all still held `EXECUTE` on `sweep_matches()`, alongside
`service_role`. That is precisely the hole the constraint warns about: any authenticated client
could have called `select public.sweep_matches()` directly and expired its own (or anyone's)
amend window early, or forced any of its own stale matches into `unverified` at will.

The sibling function in this same file family, `sweep_expired()`
(`supabase/migrations/20260903005933_pairing_functions.sql`), establishes the correct pattern for
exactly this reason:
```sql
revoke all on function public.sweep_expired() from public, anon, authenticated;
grant execute on function public.sweep_expired() to service_role;
```

I added the matching `revoke all on function public.sweep_matches() from public, anon,
authenticated;` line before the grant, with a comment explaining why. This is not a case of
"weakening a test to make it pass" — none of the brief's three given tests exercise the grant at
all (they all run as `sql()`, which is the postgres superuser connection, so they'd pass either
way). It is a fix required to satisfy an explicit constraint in the task instructions that the
given SQL, taken verbatim, does not meet. Re-ran `db:reset` + both gates after the fix; nothing
regressed (153/153, 1209/1209), and the grant is now exactly `postgres` (owner) + `service_role`.

## The "reason about, don't transcribe" check: does `state in ('paired','reported')` protect a confirmed match?

Traced it directly:

- The give-up UPDATE's filter is `where state in ('paired', 'reported') and created_at < now() -
  interval '48 hours'`. `'confirmed'` is not in that list, so a confirmed match — regardless of
  how old `created_at` is — can never match this UPDATE's WHERE clause. Verified this holds by
  running the brief's third test (age a confirmed match 400 days, sweep, assert state stays
  `'confirmed'`) — it passes.
- The dispute UPDATE's filter is `where state = 'mismatch' and amend_deadline is not null and
  amend_deadline <= now()`. A confirmed match's `amend_deadline` was cleared to `null` by
  `submit_report` on confirmation (per Task 2's interface, and observable in the "confirms after
  an amend" test), and its state is `'confirmed'` not `'mismatch'`, so this UPDATE also cannot
  touch it. Two independent filters both exclude it; there is no path by which `sweep_matches()`
  moves a confirmed match.

I also checked the reverse direction — is there a state the sweep fails to touch when it should,
or touches when it should not, beyond what the three given tests check?

- `'disputed'` and `'unverified'` and `'abandoned'` are terminal with respect to this function by
  design — nothing in the brief or the interfaces from earlier tasks describes a further
  time-based transition out of them, so leaving them alone is correct, not an oversight.
- `'mismatch'` rows are excluded from the give-up UPDATE's `state in ('paired','reported')` list.
  This is intentional and correct: a mismatched match already has its own dedicated clock
  (`amend_deadline`, set once on first mismatch per Task 2), so it should resolve through the
  dispute path, not silently vanish into `'unverified'` if the reporters happen to stay
  disagreeing for 48+ hours from `created_at`. Handling it under the wrong branch would double-book
  the same match into two different administrative queues.
- `'paired'` and `'reported'` are the only two silence states (nobody reported, or only one side
  reported) and both are correctly covered by the give-up UPDATE.

I did not find a state the sweep touches when it should not, or fails to touch when it should,
beyond the GRANT issue documented above (which is a privilege issue, not a state-filter issue).

## Test counts

- Before this task: `check:db` 150/150.
- After this task: `check:db` 153/153 (3 new tests, all passing).
- `check` (app gate): 1209/1209, both before starting (implied by "currently green") and
  confirmed again after this task's changes.

## Concerns / things I'm not fully certain about

- The GRANT deviation above is the main thing worth double-checking against whatever review
  process this plan uses — I made a judgment call to add a `revoke` line not present in the
  brief's verbatim SQL, because the task's own binding constraint required it and the sibling
  function established the exact precedent. I did not weaken, skip, or delete any test to get
  there; I added a line of SQL the brief omitted.
- I did not push or merge to `main`. This branch (`feat/m2b-reporting`) appears to be a multi-task
  plan still in progress (this is "Task 3"), so I stopped at a local commit on the feature branch
  as the task instructions specified, rather than treating this as a finished, shippable unit on
  its own.
- `app/.env.local.bak` is untracked and present in the working tree; I left it alone since it was
  not part of this task's file list and may contain local secrets — flagging it here in case it
  needs cleanup or `.gitignore` attention separately.

---

## Addendum: two review findings fixed (2026-09-05)

A follow-up review of this same task surfaced two findings against the work above. Both are fixed
here, in the same migration/test files, no new migration added.

### Finding 1 (Important): `submit_report` was callable by PUBLIC and anon

**What was wrong.** `supabase/migrations/20260905121000_submit_report.sql` ended with only:
```sql
grant execute on function public.submit_report(uuid, text[]) to authenticated;
```
with no `revoke`. Postgres grants `EXECUTE` on a newly created function to `PUBLIC` by default, so
the bare grant is additive, not exclusive — it left `PUBLIC` (and therefore `anon`, which inherits
PUBLIC's grants) still able to call the function. Every sibling security-definer function in this
schema (`accept_offer`, `sweep_matches`, ...) revokes PUBLIC explicitly; this one, alone, did not.
Ironically this migration was written in the very same task whose own report (above) documents
discovering and fixing this exact default-grant hazard for `sweep_matches()` — the same mistake
recurred one function over.

Consequence, precisely: an anonymous caller cannot mutate anything — `submit_report`'s own
`me is null or me not in (m.player_a, m.player_b)` check refuses before any write — but it COULD
reach that check, and the `for update` row lock taken just before it, which lets it distinguish
`'no such match'` from `'this match is not yours'`. That is a match-id existence oracle exposed to
an unauthenticated caller.

**What I changed.** Edited `supabase/migrations/20260905121000_submit_report.sql` in place (not a
new migration — this migration has never reached production; `main` is at `bc31250` and contains
only `20260905123000`, so a corrective follow-up migration here would be a permanent two-step
apology for a file nobody outside this branch has run). Added, immediately before the existing
grant, following the exact pattern in `20260904071717_accept_offer_agrees_on_the_data_build.sql`
(line 97):
```sql
-- `create function` grants EXECUTE to PUBLIC by default. Without the revoke,
-- an anonymous caller could still invoke this: it cannot mutate anything (the
-- `me is null or me not in (...)` check refuses it before any write), but it
-- would still take the `for update` row lock and could distinguish "no such
-- match" from "this match is not yours" — a match-id existence oracle.
revoke all on function public.submit_report(uuid, text[]) from public, anon;
grant execute on function public.submit_report(uuid, text[]) to authenticated;
```

**Covering test.** `refuses the anonymous role for lack of privilege, not merely for lack of
standing` in `supabase/tests/reports.test.ts`. It calls `submit_report` via `asAnon()` and asserts
on the message directly:
```ts
expect(denied.message).toMatch(/permission denied for function submit_report/);
```
Deliberately NOT the shared `PRIVILEGE_DENIED` regex from `helpers.ts` — that regex is
`/permission denied for table (match_offers|queue_entries|matches|match_reports|match_rounds)/`,
scoped to table names only, used by other suites for table-privilege assertions. Widening it to
also match function names would change what it means everywhere it's imported; a local assertion
on the exact function-privilege message keeps that constant's meaning intact for its other callers
and is more precise here besides. This test is built to fail on exactly the vulnerable state: with
the grant left in (i.e. the bug present), `submit_report` would run and raise `'this match is not
yours'` instead — a different message, on a `refusal()` that still resolves, but with the wrong
class of error, so the `toMatch` assertion fails and names what actually happened.

**Command run and real output:**
```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"     → EXIT=0
cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"        → EXIT=0
  Test Files  9 passed (9)
       Tests  155 passed (155)
cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"          → EXIT=0
  Test Files  83 passed (83)
       Tests  1209 passed (1209)
```

**Before/after ACL**, measured directly against the running DB (not inferred), via:
```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, array_to_string(proacl,' | ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='submit_report';"
```
Before (migration reverted, `db:reset` re-applied specifically to capture this — then restored and
reset again to the fixed state before finishing):
```
submit_report|=X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
```
After (the fix in place):
```
submit_report|postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```
No bare `=X/postgres` (PUBLIC) and no `anon=X` remain. This is now byte-for-byte the same shape
`accept_offer`'s ACL has (`postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres`),
confirmed by querying both in the same session.

### Finding 2 (Minor, coverage): the 48-hour give-up rule was only tested from `paired`

**What was wrong.** `sweep_matches`'s give-up UPDATE targets `state in ('paired', 'reported')`, but
every existing test that exercises it (`gives up on a match nobody reported...`, `leaves a
confirmed match alone forever`) only ever ages a `paired` match (nobody reported at all). If
`'reported'` were ever dropped from that `in (...)` list, every test in the file would still pass
— and in production, a match where exactly one side reported and the other went silent would sit
in `'reported'` forever: never swept to `'unverified'`, never excluded from rating.

**What I changed.** Added a test that reaches `'reported'` through the real path — one genuine
`submit_report` call, not a hand-written `update ... set state = 'reported'` — asserts that
precondition explicitly, then ages the match past 48 hours and sweeps it.

**Covering test.** `gives up on a match where only one side reported, and does not count it` in
`supabase/tests/reports.test.ts`:
```ts
it('gives up on a match where only one side reported, and does not count it', async () => {
  const matchId = await makeMatch();
  await submit(userA, matchId, '{a,a}');
  const [before] = await sql<{ state: string }>(`select state from public.matches where id = '${matchId}'`);
  expect(before.state, 'precondition: only one side has reported').toBe('reported');

  await sql(`update public.matches set created_at = now() - interval '49 hours' where id = '${matchId}'`);
  await sql(`select public.sweep_matches()`);
  const [m] = await sql<{ state: string; rating_counted: boolean }>(
    `select state, rating_counted from public.matches where id = '${matchId}'`,
  );
  expect(m.state).toBe('unverified');
  expect(m.rating_counted).toBe(false);
});
```
This would fail if `'reported'` were removed from the give-up UPDATE's `state in (...)` list: `m`
would stay in `'reported'` instead of becoming `'unverified'`, and `rating_counted` would remain
whatever it started as rather than being forced to `false`.

**Command run and real output:** same `db:reset` / `check:db` / `check` runs as Finding 1 above
(both fixes were verified together) — `EXIT=0` for all three, `check:db` 155/155, `check`
1209/1209. Baseline before this addendum was `check:db` 153/153; 155 = 153 + 2 new tests (one per
finding).

### Concerns

- None outstanding. Both fixes are additive (a `revoke` line and two tests); no existing test was
  weakened, skipped, or deleted. The shared `PRIVILEGE_DENIED` regex in `helpers.ts` was left
  untouched — Finding 1's test asserts locally instead, per the task's own guidance to prefer that
  over widening a constant other suites depend on.
- `app/.env.local.bak` remains untracked and unaddressed, as before; still out of scope for this
  fix.
