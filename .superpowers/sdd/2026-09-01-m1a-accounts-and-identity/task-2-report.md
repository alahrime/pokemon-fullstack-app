# Task 2 Report: `profiles` and `friend_codes`, denied by default

## What the migration creates

File: `supabase/migrations/20260901153959_profiles.sql` (created via `npx supabase migration new profiles`, filled verbatim from the task brief).

- `public.profiles` — 1:1 with `auth.users` (FK `id → auth.users(id) on delete cascade`).
  - `display_name text unique not null` — the Paragon identity, immutable via trigger (see below).
  - `go_username text not null` — mutable, deliberately not unique (GO trainer name, used only for dispute-adjudication screenshot matching).
  - `tos_accepted_at timestamptz not null`, `birth_date date not null`, `timezone text not null default 'UTC'`, `default_league text not null default 'great'`, `created_at`/`updated_at timestamptz`.
  - No email column — `auth.users.email` remains the sole identity anchor, per the brief's comment.
- `public.friend_codes` — separate table, `profile_id uuid primary key references public.profiles(id) on delete cascade`, `code text not null`, `updated_at timestamptz not null default now()`. Kept apart from `profiles` because it needs its own RLS visibility rule (own/mutual-friends/active-match), which cannot coexist with a broader profile-read rule on the same row.
- `public.freeze_display_name()` — a `plpgsql` trigger function that raises `display_name is immutable once chosen` whenever `new.display_name is distinct from old.display_name`.
- `profiles_display_name_frozen` — `before update` trigger on `public.profiles` calling the function above, for each row.
- `alter table ... enable row level security` on both tables. **No policies created** — intentional, per the brief: RLS-on-with-zero-policies is total default-deny, which Task 3 will assert and Task 4 will deliberately relax.

## Sequence of work

1. Repo was clean on `feat/m1a-accounts` at `17ac621` before starting.
2. `npx supabase migration new profiles` → created empty file, filled with the brief's SQL exactly (comments included, including the brief's own slightly-redundant "Separate table, not a column..." doubled comment on `friend_codes` — left as-is since the brief said use it verbatim).
3. `npm run db:reset` first failed (stack wasn't running yet — `LegacyResetLocalDbNotRunningError`, exit 1, captured directly not through a pipe). Ran `npm run db:start` (exit 0), then `npm run db:reset` (exit 0), which applied `20260901153959_profiles.sql` cleanly with no errors.

## Verification: RLS enabled, zero policies

Real container name confirmed via `docker ps --format '{{.Names}}'` → `supabase_db_paragon-iv` (matches the brief's guess exactly, but was verified rather than assumed).

```
$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select tablename, rowsecurity from pg_tables where schemaname='public';"
profiles|t
friend_codes|t

$ docker exec supabase_db_paragon-iv psql -U postgres -tAc \
  "select count(*) from pg_policies where schemaname='public';"
0
```

Both tables present with `rowsecurity = t`, policy count `0`. Re-checked after the trigger test and cleanup below — unchanged.

## Verification: immutability trigger raises, not silently ignored

Inserted a throwaway `auth.users` row and a matching `profiles` row (`id = 00000000-0000-0000-0000-000000000001`, `display_name = 'TestTrainer'`), then attempted an update:

```
$ docker exec supabase_db_paragon-iv psql -U postgres -c \
  "update public.profiles set display_name = 'NewName' where id = '00000000-0000-0000-0000-000000000001';"
EXIT=1
ERROR:  display_name is immutable once chosen
CONTEXT:  PL/pgSQL function freeze_display_name() line 4 at RAISE
```

Exit code captured directly (not through a pipe) — genuinely `1`, and psql printed a real `ERROR`, not a 0-row silent no-op. Confirmed the value was in fact untouched afterward (`select display_name` still returned `TestTrainer`), and confirmed the trigger does *not* block unrelated columns — `update ... set default_league = 'ultra'` on the same row succeeded (`UPDATE 1`, exit 0) and persisted (`TestTrainer|ultra`). So the trigger is scoped correctly to `display_name` alone, and it is enforced by exception, not by silently discarding the write.

Test rows were deleted afterward (`delete from public.profiles ...`, `delete from auth.users ...`) so the reset-seeded state was left clean; `select count(*) from public.profiles` returned `0` post-cleanup. RLS/policy counts were re-verified unchanged after cleanup (see above — same query, same result).

## Container name used

`supabase_db_paragon-iv` — confirmed via `docker ps --format '{{.Names}}'`, not assumed from the brief's example.

## Stack stopped

`npm run db:stop` → exit 0, `{"message":"Stopped supabase local development setup."}`. Confirmed with `docker ps --format '{{.Names}}'` (empty output) and `docker ps -q | wc -l` → `0`. No containers running.

## Files changed

- `supabase/migrations/20260901153959_profiles.sql` (new, committed).

## Self-review findings

- The brief's SQL contains a doubled/redundant comment above `create table public.friend_codes` ("Separate table, not a column..." appears twice, worded slightly differently). This is in the brief as given; I used it verbatim per instructions rather than editing it, since the task said the SQL is to be used as-is and the comments are part of the deliverable.
- `git status` showed an unrelated modification to `docs/superpowers/plans/2026-09-01-m1a-accounts-and-identity.md` (mtime ~08:41, just before this session's work began — content adds Steps 4-7 covering a later task's `enable_confirmations` / profile-on-confirm trigger work). This was not made by me and is out of scope for Task 2's exact commit instruction (`git add supabase/migrations`), so I left it unstaged and did not commit it. Flagging in case the controller wants to know it's sitting there uncommitted.
- No changes were made under `app/src/`, per the global constraint.
- `npm run check` was not run, per the global constraint.

## Concerns

- None regarding the migration itself — it applied cleanly, RLS/policy state matches the brief's expectation exactly, and the trigger's enforcement was verified to be a genuine raised exception scoped only to `display_name`.
- The unrelated plan-doc modification noted above is worth the controller's attention, but I did not investigate its origin further since it's outside this task's scope and touching it wasn't requested.
