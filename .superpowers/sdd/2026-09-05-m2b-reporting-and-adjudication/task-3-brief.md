### Task 3: The passage of time, which is the coordinator's only remaining job

Agreement is deterministic and settled in Task 2. What is left genuinely needs a clock: an amend window that expires, and matches nobody ever reported.

Note the response-shape change. The coordinator answers `{"verified":N,"paired":N,"swept":N}` today, and `docs/superpowers/HANDOFF.md` tells an operator to expect exactly that when proving the tick is alive. Adding a key means that instruction has to change with it.

**Files:**
- Create: `supabase/migrations/20260905122000_sweep_matches.sql`
- Modify: `supabase/functions/coordinator/index.ts`
- Modify: `docs/superpowers/HANDOFF.md`
- Test: `supabase/tests/reports.test.ts` (append)

**Interfaces:**
- Produces: `public.sweep_matches() returns integer` — the number of match rows it moved. Granted to `service_role` only.
- Produces: the coordinator's JSON body gains a `matches` key: `{"verified":N,"paired":N,"swept":N,"matches":N}`.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/reports.test.ts
  it('turns a lapsed amend window into a dispute, and only once it has lapsed', async () => {
    const matchId = await makeMatch();
    await submit(userA, matchId, '{a,a}');
    await submit(userB, matchId, '{b,b}');

    await sql(`select public.sweep_matches()`);
    const [early] = await sql<{ state: string }>(`select state from public.matches where id = '${matchId}'`);
    expect(early.state, 'still inside the window').toBe('mismatch');

    await sql(`update public.matches set amend_deadline = now() - interval '1 minute' where id = '${matchId}'`);
    await sql(`select public.sweep_matches()`);
    const [late] = await sql<{ state: string; amend_deadline: string | null }>(
      `select state, amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(late.state).toBe('disputed');
    expect(late.amend_deadline).toBeNull();
  });

  it('gives up on a match nobody reported, and does not count it', async () => {
    const matchId = await makeMatch();
    await sql(`update public.matches set created_at = now() - interval '49 hours' where id = '${matchId}'`);
    await sql(`select public.sweep_matches()`);
    const [m] = await sql<{ state: string; rating_counted: boolean }>(
      `select state, rating_counted from public.matches where id = '${matchId}'`,
    );
    expect(m.state).toBe('unverified');
    expect(m.rating_counted).toBe(false);
  });

  it('leaves a confirmed match alone forever', async () => {
    const matchId = await makeMatch();
    await submit(userA, matchId, '{a,a}');
    await submit(userB, matchId, '{a,a}');
    await sql(`update public.matches set created_at = now() - interval '400 days' where id = '${matchId}'`);
    await sql(`select public.sweep_matches()`);
    const [m] = await sql<{ state: string }>(`select state from public.matches where id = '${matchId}'`);
    expect(m.state).toBe('confirmed');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: FAIL with `function public.sweep_matches() does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905122000_sweep_matches.sql
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

  -- Silence costs the record, and it costs it symmetrically: a match neither
  -- side reported is kept for analytics and excluded from every rating.
  update public.matches
     set state = 'unverified', rating_counted = false
   where state in ('paired', 'reported')
     and created_at < now() - interval '48 hours';
  get diagnostics n = row_count;
  moved := moved + n;

  return moved;
end;
$fn$;

grant execute on function public.sweep_matches() to service_role;
```

- [ ] **Step 4: Call it from the coordinator**

In `supabase/functions/coordinator/index.ts`, beside the existing `pair_queue_entries` / `sweep_expired` calls:

```ts
  const { data: paired } = await admin.rpc('pair_queue_entries');
  const { data: swept } = await admin.rpc('sweep_expired');
  const { data: sweptMatches } = await admin.rpc('sweep_matches');
```

and add `matches: sweptMatches ?? 0` to the JSON body the function returns, beside `verified`, `paired` and `swept`.

- [ ] **Step 5: Update the operator instruction that names the body**

In `docs/superpowers/HANDOFF.md`, the two places that say a healthy tick answers `{"verified":0,"paired":0,"swept":0}` must now say `{"verified":0,"paired":0,"swept":0,"matches":0}`. An operator checking the tick against a stale shape will read a correct tick as a wrong one.

- [ ] **Step 6: Run both gates to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "DB=$?"; npm run check > /tmp/app.log 2>&1; echo "APP=$?"`
Expected: `DB=0`, `APP=0`. `npm run check` includes `verify:coordinator-bundle`, which is what catches a coordinator that no longer builds.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260905122000_sweep_matches.sql supabase/functions/coordinator/index.ts supabase/tests/reports.test.ts docs/superpowers/HANDOFF.md
git commit -m "feat(coordinator): expire the amend window, give up on silence

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

