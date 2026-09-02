### Task 6: The coordinator — the one thing that is not SQL

It recomputes `rules_hash` from the stored rules using the same `rulesHash` the client runs, writes `verified_hash`, then calls the SQL functions. That recomputation is the trust boundary the spec names: the one place a client's claim about its own format is checked by something the client does not control.

**Files:**
- Create: `supabase/functions/coordinator/index.ts`
- Create: `supabase/migrations/<timestamp>_coordinator_schedule.sql`
- Modify: `app/package.json` (a `build:coordinator` script)

**Interfaces:**
- Consumes: `rulesHash` from Task 2, `pair_queue_entries`/`sweep_expired` from Task 5.
- Produces: an HTTP endpoint `/functions/v1/coordinator` returning `{ verified, paired, swept }`.

- [ ] **Step 0: Emit a type declaration beside the bundle**

Add `--outfile` sibling `supabase/functions/coordinator/rules.bundle.d.ts` containing exactly:

```ts
import type { Format } from '../../../app/src/rules/types';
export declare function rulesHash(format: Format): Promise<string>;
```

Without it the import above is `any`, and a signature change in `rulesHash` would reach production as a runtime error rather than a build failure.

- [ ] **Step 1: Bundle the rules module for Deno**

Add to `app/package.json` scripts:

```json
"build:coordinator": "esbuild src/rules/index.ts --bundle --format=esm --platform=neutral --outfile=../supabase/functions/coordinator/rules.bundle.js --log-level=warning"
```

`--platform=neutral` because this runs in Deno, not Node — a Node-targeted bundle would emit `require` shims Deno cannot resolve. There is no second copy of the rules: this is the same `src/rules` the browser imports, which is the entire reason `isolation.test.ts` exists.

- [ ] **Step 2: Write the function**

```ts
// supabase/functions/coordinator/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
// The esbuild output carries no type declarations, so Deno sees `any` here.
// That is deliberate and is exactly why Task 9 exists: the only thing checking
// that this is the same function the browser runs is a test that runs both.
// @ts-types="./rules.bundle.d.ts"
import { rulesHash } from './rules.bundle.js';

/**
 * The coordinator tick.
 *
 * Runs as the service role, which bypasses every policy — so it must be the
 * only thing here that needs to. It does exactly what SQL cannot: recompute a
 * format's hash with the client's own code. Everything else is a function call.
 */
Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let verified = 0;
  for (const table of ['queue_entries', 'match_offers'] as const) {
    const { data, error } = await admin
      .from(table)
      .select('id, claimed_hash, format_versions!inner(rules)')
      .is('verified_hash', null)
      .limit(200);
    if (error) return new Response(error.message, { status: 500 });

    for (const row of data ?? []) {
      const r = row as unknown as { id: string; claimed_hash: string; format_versions: { rules: unknown } };
      const actual = await rulesHash(r.format_versions.rules);
      if (actual !== r.claimed_hash) {
        // The claim was wrong. Drop the entry rather than correcting it: a
        // client that computed a different hash disagrees with the server about
        // what its own format IS, and silently requeueing it under the real
        // hash would put someone into a match on terms they did not compute.
        await admin.from(table).delete().eq('id', r.id);
        continue;
      }
      await admin.from(table).update({ verified_hash: actual }).eq('id', r.id);
      verified++;
    }
  }

  const { data: paired } = await admin.rpc('pair_queue_entries');
  const { data: swept } = await admin.rpc('sweep_expired');
  return Response.json({ verified, paired, swept });
});
```

- [ ] **Step 3: Serve it and invoke it by hand**

```bash
cd app && npm run build:coordinator > /tmp/bundle.log 2>&1; echo "EXIT=$?"
cd app && ./node_modules/.bin/supabase functions serve coordinator --workdir .. > /tmp/serve.log 2>&1 &
sleep 5
curl -s -X POST http://127.0.0.1:54321/functions/v1/coordinator \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" > /tmp/tick.log 2>&1; echo "EXIT=$?"; cat /tmp/tick.log
```

Expected: `{"verified":N,"paired":M,"swept":K}`. Insert two entries with a correct `claimed_hash` and one with a wrong one first, and confirm the liar is deleted while the honest pair become a match. **Stop the `functions serve` process when done** — a stray server is trap #3 in the handoff.

- [ ] **Step 4: Schedule it**

```sql
-- supabase/migrations/<timestamp>_coordinator_schedule.sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every minute. Latency is a later optimisation; the spec's whole point in
-- starting with a scheduled function is that nothing here holds a socket.
select cron.schedule(
  'coordinator-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := current_setting('app.coordinator_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    )
  );
  $$
);
```

**Reviewer note:** the URL and key come from settings rather than being written into the migration, because a migration is committed and a service-role key must never be. Set them per environment with `alter database postgres set app.coordinator_url = '…'`. If that indirection proves awkward on the hosted project, the fallback is Supabase's dashboard-managed cron — but do not inline the key to make this step pass.

- [ ] **Step 5: Verify the schedule exists**

Run: `docker exec supabase_db_paragon-iv psql -U postgres -d postgres -At -c "select jobname, schedule, active from cron.job;"`
Expected: one row, `coordinator-tick | * * * * * | t`. This proves the job is registered — it does **not** prove a tick succeeded. Read `cron.job_run_details` for that, and treat a registered-but-failing job as the likeliest outcome of a wrong URL.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions app/package.json supabase/migrations
git commit -m "feat(coordinator): verify what a client claims, then pair what agrees"
```

---

