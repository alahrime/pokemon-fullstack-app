# Task 3 report: every match gets a channel, by trigger

## What changed

- `supabase/tests/channels.test.ts`: appended the brief's test verbatim
  ("gives every new match a channel with exactly its two players") inside the
  existing `describe('channels and membership', ...)` block, right before its
  closing `});`. No changes needed for the one-argument `is_channel_member`
  correction — the appended test never calls it directly.
- `supabase/migrations/20260907002000_match_channel_trigger.sql` (new,
  correctly named to sort after `20260907001000_channel_functions.sql` and
  NOT reusing the brief's `20260905142000`):
  - `public.create_match_channel()` — `security definer`, `set search_path =
    public`, inserts one `channels` row (`kind='match'`, `created_by =
    new.player_a`, `match_id = new.id`) and two `channel_members` rows (for
    `new.player_a` and `new.player_b`).
  - `revoke all on function public.create_match_channel() from public, anon,
    authenticated;` — no grant to any role, since it is only ever invoked as
    part of the triggering INSERT statement.
  - `create trigger matches_get_a_channel after insert on public.matches for
    each row execute function public.create_match_channel();`

No other files were touched. I did not edit `pair_queue_entries` or
`confirm_offer` — the whole point of Task 3 is that neither needs to know
about channels.

## TDD sequence (commands and real output)

**1. Test written, ran to confirm it fails (before the migration existed):**

```
cd app && npm run check:db > /tmp/db-before.log 2>&1; echo "EXIT=$?"
```
`EXIT=1`

```
 FAIL  ../supabase/tests/channels.test.ts > channels and membership > gives every new match a channel with exactly its two players
TypeError: Cannot read properties of undefined (reading 'kind')
 ❯ ../supabase/tests/channels.test.ts:197:14
    197|     expect(c.kind).toBe('match');

 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 191 passed (192)
```

Confirmed: no channel row existed for the new match, exactly as expected —
`select ... where match_id = ...` returned zero rows, so destructuring `[c]`
left `c` undefined.

**2. Migration written**, then reset and re-ran:

```
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
```
`EXIT=0` — reset applied all migrations cleanly, ending with
`20260907002000_match_channel_trigger.sql`, then "Finished supabase db reset
on branch main." / `{"target":"local","version":"","message":"Reset local
database."}`.

```
cd app && npm run check:db > /tmp/db-after.log 2>&1; echo "EXIT=$?"
```
`EXIT=0`

```
 Test Files  11 passed (11)
      Tests  192 passed (192)
```

(191 prior + 1 new = 192, matches the constraint "currently 191/191 — your
tests add to that.")

## Regression check — pairing and offers

Grepped the same `check:db` run's output:

```
✓ ../supabase/tests/pairing.test.ts (26 tests) 938ms
✓ ../supabase/tests/offers.test.ts (21 tests) 144ms
```

Both suites stayed at their full counts (26 and 21) and all green. Neither
test file was touched. The trigger fires inside both `pair_queue_entries()`
and `confirm_offer()` on every `matches` insert they perform, including the
two-independent-connection race tests in `pairing.test.ts`, and nothing
regressed.

## Full app gate

```
cd app && npm run check > /tmp/check-full.log 2>&1; echo "EXIT=$?"
```
`EXIT=0`

```
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```

## SECURITY DEFINER / grant verification

```
docker exec supabase_db_paragon-iv psql -U postgres -tAc "select proname, prosecdef, coalesce(array_to_string(proacl,' | '),'(null: PUBLIC may execute)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='create_match_channel';"
```

Output:
```
create_match_channel|t|postgres=X/postgres | service_role=X/postgres
```

`prosecdef = t` (SECURITY DEFINER, as required — an AFTER INSERT trigger
firing on an authenticated client's insert into `matches` would otherwise hit
`permission denied` on `channels`/`channel_members`, both of which have
`insert`/`delete` revoked from `authenticated`). No `PUBLIC`, `anon`, or
`authenticated` entry in the ACL — only the owner (`postgres`) and
`service_role` carry the implicit owner grant. This matches the "no grant at
all" requirement: the trigger runs as part of the triggering statement, so no
role ever needs `EXECUTE` on the function directly.

## Roundtrips

```
cd app && KEY=$(npx supabase status --workdir .. 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
DEF='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
for t in m3a m2b; do
  ./node_modules/.bin/esbuild tools/$t-roundtrip.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/$t-t3.mjs --log-level=warning --define:import.meta.env="$DEF" > /tmp/b-$t.log 2>&1
  SUPABASE_SERVICE_ROLE_KEY="$KEY" node node_modules/.cache/$t-t3.mjs > /tmp/rt-$t.log 2>&1
  echo "$t EXIT=$?"
  tail -2 /tmp/rt-$t.log
done
```

Output:
```
m3a EXIT=0

9 passed, 0 failed
m2b EXIT=0

11 passed, 0 failed
```

Both roundtrips create real matches through the real client and both landed
at their expected full tallies (m3a 9/9, m2b 11/11) with no failures — the
trigger did not break either live-pairing or live-offer flow.

## Commit

```
git add supabase/migrations/20260907002000_match_channel_trigger.sql supabase/tests/channels.test.ts
git commit -m "feat(chat): every match gets a channel, by trigger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Commit: `d7e685b feat(chat): every match gets a channel, by trigger`
(2 files changed, 73 insertions(+), no deletions). Not pushed, per
instructions.

## Uncertainties / things worth a second look

- None found during implementation. The design in the brief matched the
  already-shipped `is_channel_member`/RLS shape from Tasks 1-2 exactly (single
  argument, `security definer`, `set search_path = public`), so no adaptation
  beyond following the brief and the stated correction was needed — and the
  correction turned out not to touch anything in this task's own test or
  migration, since neither calls `is_channel_member` with a second argument.
- I did not touch `app/.env.local.bak`, which appeared in the original git
  status snapshot but is not tracked/staged by my `git add` — left untouched.
- Did not run `npm run db:stop` at any point, and the Supabase stack was left
  running as instructed.
