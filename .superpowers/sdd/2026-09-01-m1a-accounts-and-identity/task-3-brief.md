### Task 3: The harness, and default-deny as an assertion

**Files:**
- Create: `supabase/tests/helpers.ts`, `supabase/tests/rls.test.ts`, `app/vitest.db.config.ts`

**Interfaces:**
- Produces: `asUser(jwtClaims)` / `asAnon()` returning a Postgres client whose requests carry a given identity, and `npm run check:db` running the suite.

**The assertion that matters most.** New tables in Supabase ship with RLS **off** — that single default is the most common Supabase data leak there is. So the suite fails if any table in `public` has `rowsecurity = false`, **and** fails if a table has RLS on with zero policies once Task 4 has run, because that state denies everything while looking like a broken feature.

- [ ] **Step 1: Write the failing test**

`supabase/tests/rls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from './helpers';

describe('every public table is protected', () => {
  it('has row level security enabled', async () => {
    const rows = await sql(
      `select tablename from pg_tables where schemaname='public' and rowsecurity = false`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('starts denying everything before any policy is written', async () => {
    const rows = await sql(`select count(*)::int as n from pg_policies where schemaname='public'`);
    expect(rows[0].n).toBe(0);
  });
});
```

The second test is **temporary and Task 4 replaces it** — it exists so the default-deny starting state is proven rather than assumed. Say so in a comment, or a later reader will treat it as a rule.

- [ ] **Step 2: Run it and watch it fail**

`npm run check:db` — it fails because `helpers.ts` and the vitest config do not exist yet.

- [ ] **Step 3: Write the harness**

`supabase/tests/helpers.ts` connects to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Impersonation works by setting the role and the JWT claims PostgREST would set, inside a transaction:

```
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
```

`auth.uid()` reads `request.jwt.claims`, so this is what makes a policy behave exactly as it will for a real signed-in user. **Verify that against the running stack** — read Supabase's own `auth.uid()` definition with `\sf auth.uid` before trusting this description.

Use `postgres` (already available) or `pg` as the driver. If a new devDependency is needed, that is acceptable here and only here — it is test-only tooling, not a runtime dependency.

- [ ] **Step 4: Add the vitest config**

`app/vitest.db.config.ts` — a **node** environment, not jsdom, including only `../supabase/tests/**/*.test.ts`. These tests talk to a real database and have nothing to do with the browser suite.

- [ ] **Step 5: Green, then commit**

```bash
git add supabase/tests app/vitest.db.config.ts app/package.json
git commit -m "test(db): prove the tables deny everything before anything opens them"
```

---

