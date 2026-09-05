# Task 6 report: the report ladder, driven by two real accounts

## Status

Done. `app/tools/m2b-roundtrip.ts` created, all seven checks pass against the
real local stack (run twice, both clean), `npm run check` and `npm run
check:db` both stay green, one commit made on `feat/m2b-reporting`
(`5e677ae1`). Nothing under `supabase/` or `app/src/` was touched.

## The critical fact confirmed

`test-opponent-1@example.test` / `test-opponent-2@example.test` do not exist.
Before writing anything I re-measured what the task brief told me to expect:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from auth.users;"
39
```

39 rows, none of them the seeded bots. The script creates its own two
accounts every run, through the real signup + Mailpit-confirmation path
(`opponents.ts`'s pattern), so `handle_confirmed_user()` fires and the
profile that `matches.player_a`/`player_b` reference by foreign key actually
exists.

## How the accounts are made unique per run

```ts
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
```

Emails are `m2b-<stamp>-bot1@example.test` / `...-bot2@example.test`. A
timestamp alone was not enough: two runs launched in the same millisecond (a
tight retry loop) would mint the same email and collide with `auth.users`'
unique constraint, so a few bytes of `Math.random()` are appended. Verified
by running the script twice back to back — different emails, no collision,
and `auth.users` returned to exactly 39 rows after each run's cleanup.

## The seven checks — full run output (first of two identical runs)

```
M2b round trip — run mtolew7d-ok4kge

PASS  0a. bot1 registers, confirms through Mailpit, and gets a profile
        bot1 2fcc340c-60bb-4791-b4c4-dd3d1cdffc5e <m2b-mtolew7d-ok4kge-bot1@example.test>
PASS  0b. bot2 registers, confirms through Mailpit, and gets a profile
        bot2 febd827b-de79-4d25-bd54-a74453f78223 <m2b-mtolew7d-ok4kge-bot2@example.test>
PASS  0c. a format_versions row exists for the matches to reference
        format_versions 1a866528-134c-49a8-8815-7ddf4b30822f, rules_hash 4f945e60fc4712f576ab3fb1f2f5c33fbe4af085fedfc8df2ec8a633cf56b399
PASS  setup. match 1 is created with the service role (no client INSERT policy exists)
        match cebd8c78-a3a8-4b0d-842e-12d5f14f546d, bot1 is player_a, bot2 is player_b, best_of 3
PASS  1. bot1 submits [true, false, true] -> reported; matches.state is reported
        submitReport(bot1, [true,false,true]) -> 'reported'; myMatches() confirms matches.state = 'reported'
PASS  2. bot1 reads its own report back; bot2 reading match_reports for this match gets ZERO rows
        bot1 reads its own wins ["a","b","a"] (round-trips to [true,false,true] in its own terms); bot2's unfiltered select on the same match_id returns exactly 0 rows, not an error
PASS  3. bot2 submits a disagreeing scoreline -> mismatch; amend_deadline is set
        submitReport(bot2, disagreeing) -> 'mismatch'; amend_deadline = 2026-09-05T16:34:14.144079+00:00
PASS  4. bot2 reads match_reports again and still sees only its own row
        bot2 still sees exactly 1 row of match_reports, reporter_id febd827b-de79-4d25-bd54-a74453f78223 (its own)
PASS  5. bot2 amends to agree -> confirmed; three rounds in order with the right winners; both can now read both reports
        submitReport(bot2, agree) -> 'confirmed'; match_rounds winners ["2fcc340c-60bb-4791-b4c4-dd3d1cdffc5e","febd827b-de79-4d25-bd54-a74453f78223","2fcc340c-60bb-4791-b4c4-dd3d1cdffc5e"] in round order; both bot1 and bot2 now read 2 rows of match_reports each
PASS  6. a second match, forced disputed: both disagree, amend_deadline forced past, sweep_matches -> disputed
        match 5b81f3a3-4170-47cd-af5d-25bf1714a50c: bot1 and bot2 disagreed ('mismatch'), amend_deadline forced to 2026-09-05T16:23:15.000Z, sweep_matches() moved 1 row(s) total, match 2 state is now 'disputed'
PASS  7. bot1 submitting into that disputed match raises "this match is no longer accepting reports"
        submitReport into the disputed match raised: "this match is no longer accepting reports"

11 passed, 0 failed
```

`EXIT=0` for the process. Ran a second time immediately after (different
stamp, `SUPABASE_SERVICE_ROLE_KEY` unchanged) — identical result, 11 passed,
0 failed, `EXIT=0`.

### Cleanup verified by measuring, not by trusting the log

After each run I queried the database directly rather than trusting the
script's own "cleanup ran" print:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
    "select count(*) from auth.users where email like 'm2b-mtolew7d%';"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
    "select count(*) from public.matches where id in ('cebd8c78-...','5b81f3a3-...');"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
    "select count(*) from public.match_reports where match_id in ('cebd8c78-...','5b81f3a3-...');"
0
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc "select count(*) from auth.users;"
39
```

Both accounts, both matches, both match_reports rows (match_rounds cascades
with matches) and the format/format_versions row were gone; `auth.users` is
back to the same 39 it started at.

## Gates

- `npm run check` (`tsc -b`, `oxlint`, data/rules audits, `vitest run`):
  **EXIT=0**, 1220/1220 tests passed. `app/tools/m2b-roundtrip.ts` is inside
  the `tsconfig.scripts.json` project and type-checked clean with `strict`
  and `verbatimModuleSyntax` on (had to fix one thing myself: an unused
  `import type { Side }` I left in from an earlier draft — removed before
  the first typecheck attempt succeeded).
- `npm run check:db` (`supabase/tests/*` against the real local Postgres):
  **EXIT=0**, 155/155 tests passed. Not part of this task's file, but the
  brief's overall definition of done names it, so I ran it; it was
  unaffected by this change as expected.
- All 12 containers, including `supabase_edge_runtime_paragon-iv`, still
  running after both script runs and both gate runs. `npm run db:stop` /
  `db:reset` were never invoked.

## What the script revealed about the product

Nothing wrong. Every one of the seven checks passed on the first attempt with
no product-side surprises. Two things worth recording as confirmation of
design intent rather than defects:

1. **The sealing rule (checks 2 and 4) held exactly as specified**, measured
   through an *unfiltered* `select('*').eq('match_id', ...)` by the
   non-reporting player — not through `myReport()` (which filters to the
   caller's own row by construction and could never have caught a leak) and
   not through a SQL helper run as the table owner. Zero rows, no error, both
   before and after the opponent amends. This is exactly the failure mode the
   brief calls out as the one that "breaks nothing visibly," and it is
   sound.
2. **`sweep_matches()`'s two branches are independent per-row**, confirmed by
   forcing only `amend_deadline` into the past on the disputed match while a
   separate, freshly-created match with no reports sat at `'paired'` — the
   sweep moved exactly the one row this run made eligible (`moved 1 row(s)`),
   not the whole table. I did not need to add a foreign-row guard (the kind
   `m2a-roundtrip.ts` uses before ticking the coordinator) because
   `sweep_matches()`, unlike `pair_queue_entries()`/`sweep_expired()`, only
   ever moves rows already in `'mismatch'` past their own deadline or
   `'paired'`/`'reported'` past 48 hours — nothing this script does could
   accidentally sweep a stranger's fresh match, and the run's own `moved`
   count (1) confirms nothing else in the local stack was sitting in that
   state at the time.

## Things I'm not fully certain of

- **The `moved` count from `sweep_matches()` is inherently global**, the same
  as `pair_queue_entries()`/`sweep_expired()` in `m2a-roundtrip.ts`. On a
  stack with leftover stale fixtures from an unrelated source (e.g. another
  agent's crashed run leaving a `'mismatch'` match with a lapsed deadline),
  the printed count could exceed 1 without the check being wrong — the check
  only asserts on `matchId2`'s own `state`/`amend_deadline` after the sweep,
  which is authoritative regardless of what else got swept. I did not add
  `m2a`'s pre-tick "no foreign rows" guard because `sweep_matches()` never
  *creates* anything (only relabels rows that are already stale by their own
  timestamps), so there is no possibility of it fabricating a match or report
  against a stranger's account the way a pairing tick could. I judged this an
  acceptable difference from `m2a-roundtrip.ts`'s stricter guard rather than
  an oversight, but flagging it since another agent was working in the repo
  concurrently.
- I did not push or merge to `main`. The task brief's Step 3 specifies only
  `git add` + `git commit` on the current branch (`feat/m2b-reporting`), and
  another agent was actively reviewing `app/src/screens/` in this same
  checkout while I worked — merging or fast-forwarding felt out of scope for
  a single delegated task inside a larger plan with review still in flight.
  Leaving that decision to whoever is coordinating the overall plan.
- `docs/superpowers/HANDOFF.md` recording "the new coordinator response
  shape" is listed under the plan's overall Definition of Done, not under
  this task's three steps, and this script never calls the coordinator (no
  need — matches are inserted directly by the service role, not via the
  queue/offer pairing path) — so I left that file untouched. If that
  handoff note is still outstanding, it belongs to whichever task actually
  changed the coordinator's response shape, not this one.
