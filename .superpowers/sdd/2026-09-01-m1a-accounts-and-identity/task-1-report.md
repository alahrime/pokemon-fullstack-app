# Task 1 report: Scaffolding, pinned, and a stack that comes up

## Status: DONE

## What was created / changed

- `app/package.json` — added `supabase": "^2.116.0"` devDependency, and scripts `db:start`, `db:stop`, `db:reset`, `check:db` exactly as specified in the brief.
- `app/package-lock.json` — updated by `npm install --save-dev supabase` (222 lines added, 8 packages).
- `supabase/config.toml` — created by `npx supabase init` run from the repo root. `project_id = "paragon-iv"`.
- `.gitignore` (repo root, did not exist before) — created with the three brief-specified entries: `.env.local`, `supabase/.branches`, `supabase/.temp`.
- `app/.env.example` — created verbatim per the brief (public URL + anon key placeholder, comment distinguishing public keys from the service-role key that must never appear).

Commit: `ee51b70` — `chore(db): a local Postgres this repo can start, stopped when it is done`, containing exactly the five files the brief's Step 7 listed (`supabase/config.toml`, `app/package.json`, `app/package-lock.json`, `app/.env.example`, `.gitignore`).

## Step-by-step verification

**Step 1 — pin CLI.** `cd app && npm install --save-dev supabase > log 2>&1; echo EXIT=$?` → `EXIT=0`. `node_modules/.bin/supabase --version` → `2.116.0`, matching the precondition's `npx supabase` resolution.

**Step 2 — init at repo root.** `cd <repo root> && npx supabase init > log 2>&1; echo EXIT=$?` → `EXIT=0`, output `Finished supabase init.`. It did **not** prompt about VS Code or IntelliJ settings (this CLI version apparently doesn't ask), so there was nothing to decline; no `.vscode/` or `.idea/` was created — confirmed with `ls`. It did generate `supabase/.gitignore` (not mentioned in the brief) — see "Findings" below.

**Step 3 — scripts, verified individually.** All captured directly (`cmd > log 2>&1; echo "EXIT=$?"`), never through a pipe:

| Script | Exit code | Evidence |
|---|---|---|
| `npm run db:start` | `EXIT=0` | Printed JSON with `DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `API_URL: http://127.0.0.1:54321`, anon/service keys, etc. |
| `npm run db:reset` | `EXIT=0` | `Resetting local database... Finished supabase db reset on branch feat/m1a-accounts. {"message":"Reset local database."}` |
| `npm run db:stop` | `EXIT=0` | `{"message":"Stopped supabase local development setup."}` |

Between start and stop, `docker ps --format '{{.Names}}'` showed 12 `supabase_*_paragon-iv` containers, matching the precondition. After `db:stop`, `docker ps -q | wc -l` → `0`.

The `--workdir ..` form worked exactly as written in the brief — no adjustment needed. `check:db` was added as specified but not run to completion: it depends on `vitest.db.config.ts`, which does not exist yet (out of scope for this task; presumably a later task's deliverable). Running it would fail on the vitest half, not the `db:start` half, so I left it unexercised rather than working around a missing file that isn't mine to create here.

**Step 4 — .gitignore.** No root `.gitignore` existed before this task (only `app/.gitignore`, which predates this work and is unrelated). Created a new root `.gitignore` with exactly the three brief-specified lines. `supabase/.branches` and `supabase/.temp` need to live in a *root* gitignore because they're root-relative paths (a pattern containing `/` is anchored to the directory holding the `.gitignore` that declares it); putting them in `app/.gitignore` would not have matched.

**Step 5 — `app/.env.example`.** Written verbatim per the brief.

**Step 6 — end-to-end loop.** The Step 3 verification above *is* the full `db:start` → `db:reset` → `db:stop` loop, run in that order, each exit code captured directly and non-zero would have stopped me. All three: `EXIT=0`.

**Step 7 — commit.** `git add supabase/config.toml app/package.json app/package-lock.json app/.env.example .gitignore && git commit -m "chore(db): a local Postgres this repo can start, stopped when it is done"` → commit `ee51b70`, 5 files changed, 648 insertions(+), 1 deletion(-).

## Confirmation: no containers left running

`docker ps -q | wc -l` → `0` after the final `db:stop`. `colima status` still reports running (colima itself is left up, per the preconditions — only the Supabase containers were expected to be torn down, which they are).

## Files changed

- `app/package.json` (modified, committed)
- `app/package-lock.json` (modified, committed)
- `supabase/config.toml` (created, committed)
- `.gitignore` (created, committed)
- `app/.env.example` (created, committed)
- `supabase/.gitignore` (created by `supabase init`, **left untracked** — see finding below)

## Self-review findings / concerns

1. **`supabase/.gitignore` is untracked and not part of the commit.** `npx supabase init` (2.116.0) auto-generates `supabase/.gitignore` containing `.branches`, `.temp`, `.env.keys`, `.env.local`, `.env.*.local`. The brief's Files list only mentions `supabase/config.toml` as created by init, and Step 7's exact `git add` list does not include it — so I followed the brief literally and left it untracked rather than unilaterally adding an extra file to the commit. Functionally this is low-risk: the root `.gitignore` I created already covers `.env.local`, `supabase/.branches`, and `supabase/.temp` globally (patterns without a leading `/` match at any depth), so nothing is at risk of being committed by accident either way. It does mean `git status` will show this one untracked file going forward until a future task either commits it or the root `.gitignore` is told to ignore it. Flagging for the controller's call rather than deciding unilaterally.

2. **Two unrelated files show as modified in `git status`, from before this task started and untouched by me:**
   - `docs/superpowers/plans/2026-09-01-m1a-accounts-and-identity.md`
   - `docs/superpowers/specs/2026-08-31-paragon-platform-design.md`
   
   I did not edit either file (I never touched `docs/`). They were already dirty when I began (the session's initial `git status` at conversation start showed `app/src/lib/query.ts` modified instead, which is no longer present — the working tree's dirty set appears to have shifted between sessions, presumably from other work happening on this checkout outside this task). Left as-is, unstaged, out of scope for Task 1.

3. **`check:db` is unexercised beyond `db:start`.** It calls `vitest run --config vitest.db.config.ts`, and that config file doesn't exist yet. This is expected per the task's scope (no changes to `app/src/`, and no vitest DB config was part of this brief) — flagging so a later task doesn't assume `check:db` has been proven end-to-end.

4. No secrets were committed. `supabase/config.toml` only contains the word "service_role" once, as a role name in a comment from the standard Supabase template — not a key value. The actual local anon/service-role keys (printed to stdout by `db:start`) only ever landed in scratch log files outside the repo, never in a committed file.
