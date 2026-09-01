### Task 1: Scaffolding, pinned, and a stack that comes up

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `app/.env.example`
- Modify: `app/package.json`, `.gitignore`

**Interfaces:**
- Produces: `npm run db:start`, `db:stop`, `db:reset` in `app/package.json`, and the pinned `supabase` devDependency. Later tasks call these by name.

**Verified preconditions** (do not re-derive, but do re-check if something fails): colima is installed and running; `npx supabase` resolves to 2.116.0; the stack starts, gives PostgreSQL 17.6 on aarch64 with the `auth` schema present, and stops cleanly.

- [ ] **Step 1: Pin the CLI**

From `app/`: `npm install --save-dev supabase`

Pinning matters here for the same reason esbuild and vitest are pinned — an unpinned `npx --yes` fetches whatever is newest, and a CLI version drift changes generated migrations.

- [ ] **Step 2: Initialise, at the repo root**

From the repo root: `npx supabase init`

If it asks about generating VS Code or IntelliJ settings, decline — this repo carries neither.

- [ ] **Step 3: Add the scripts**

In `app/package.json`, alongside the existing scripts:

```json
"db:start": "supabase start --workdir ..",
"db:stop": "supabase stop --workdir ..",
"db:reset": "supabase db reset --workdir ..",
"check:db": "npm run db:start && vitest run --config vitest.db.config.ts"
```

`--workdir ..` because `supabase/` is at the repo root while npm runs in `app/`. **Verify each script actually works before moving on** — run `npm run db:start`, confirm it prints the API and DB URLs, then `npm run db:stop`. Capture the exit code directly (`cmd; echo $?`), never through a pipe: a pipeline reports the last command's status, and that has produced false greens in this repo three times.

- [ ] **Step 4: Ignore what should not be committed**

Add to `.gitignore`:

```
.env.local
supabase/.branches
supabase/.temp
```

`supabase/config.toml` and `supabase/migrations/` **are** committed — they are the schema's source of truth.

- [ ] **Step 5: Document the environment**

Create `app/.env.example`:

```
# Both values are public by design and safe to commit in a real .env.local.
# The SERVICE ROLE key is not among them and must never appear in this app.
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key printed by `npm run db:start`>
```

- [ ] **Step 6: Prove the loop works end to end**

Run `npm run db:start`, then `npm run db:reset`, then `npm run db:stop`. Report each exit code, captured directly.

- [ ] **Step 7: Commit**

```bash
git add supabase/config.toml app/package.json app/package-lock.json app/.env.example .gitignore
git commit -m "chore(db): a local Postgres this repo can start, stopped when it is done"
```

---

