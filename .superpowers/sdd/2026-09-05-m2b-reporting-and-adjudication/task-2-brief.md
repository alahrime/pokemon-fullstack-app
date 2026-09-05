### Task 2: `submit_report()` — the adjudicator, and the race it must lose safely

Both reports are written through one function. It takes `for update` on the match row, which is the whole reason the common path is safe: without it, two simultaneous submissions each read "the other side has not reported" and each set `reported`, and the match never confirms even though both agreed.

The amend deadline is set **once**, with `coalesce`. Extending it on every amend would let one player stall a dispute forever by amending on a timer.

**Files:**
- Create: `supabase/migrations/20260905121000_submit_report.sql`
- Test: `supabase/tests/reports.test.ts` (append)

**Interfaces:**
- Consumes: `public.is_valid_scoreline`, `public.match_reports`, `public.match_rounds` from Task 1.
- Produces: `public.submit_report(p_match_id uuid, p_wins text[]) returns text` — returns the new `matches.state`, one of `reported`, `confirmed`, `mismatch`. Granted to `authenticated`.

- [ ] **Step 1: Write the failing test**

```ts
// append inside the same describe block in supabase/tests/reports.test.ts
  const submit = (who: string, matchId: string, wins: string) =>
    asUser({ sub: who })<{ submit_report: string }>(
      `select public.submit_report('${matchId}', '${wins}'::text[]) as submit_report`,
    );

  it('confirms the match when both sides agree, and writes the rounds', async () => {
    const matchId = await makeMatch();
    const [first] = await submit(userA, matchId, '{a,b,a}');
    expect(first.submit_report).toBe('reported');
    const [second] = await submit(userB, matchId, '{a,b,a}');
    expect(second.submit_report).toBe('confirmed');

    const [m] = await sql<{ state: string; rating_counted: boolean }>(
      `select state, rating_counted from public.matches where id = '${matchId}'`,
    );
    expect(m.state).toBe('confirmed');
    expect(m.rating_counted).toBe(true);

    const rounds = await sql<{ round_no: number; winner: string }>(
      `select round_no, winner from public.match_rounds where match_id = '${matchId}' order by round_no`,
    );
    expect(rounds).toEqual([
      { round_no: 1, winner: userA },
      { round_no: 2, winner: userB },
      { round_no: 3, winner: userA },
    ]);
  });

  it('opens one amend window on disagreement and does not extend it', async () => {
    const matchId = await makeMatch();
    await submit(userA, matchId, '{a,a}');
    const [mismatch] = await submit(userB, matchId, '{b,b}');
    expect(mismatch.submit_report).toBe('mismatch');

    const [first] = await sql<{ amend_deadline: string }>(
      `select amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(first.amend_deadline).not.toBeNull();

    await submit(userB, matchId, '{b,a,b}');
    const [second] = await sql<{ amend_deadline: string }>(
      `select amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(second.amend_deadline).toEqual(first.amend_deadline);
  });

  it('confirms after an amend brings the two claims together', async () => {
    const matchId = await makeMatch();
    await submit(userA, matchId, '{a,a}');
    await submit(userB, matchId, '{b,b}');
    const [amended] = await submit(userB, matchId, '{a,a}');
    expect(amended.submit_report).toBe('confirmed');

    const [r] = await sql<{ amend_count: number }>(
      `select amend_count from public.match_reports where match_id = '${matchId}' and reporter_id = '${userB}'`,
    );
    expect(r.amend_count).toBe(1);

    const [m] = await sql<{ amend_deadline: string | null }>(
      `select amend_deadline from public.matches where id = '${matchId}'`,
    );
    expect(m.amend_deadline).toBeNull();
  });

  it('refuses a stranger, an impossible scoreline, and a settled match', async () => {
    const matchId = await makeMatch();
    await expect(submit(stranger, matchId, '{a,a}')).rejects.toThrow(/this match is not yours/);
    await expect(submit(userA, matchId, '{a,a,a}')).rejects.toThrow(/not a possible best-of-3 scoreline/);

    await submit(userA, matchId, '{a,a}');
    await submit(userB, matchId, '{a,a}');
    await expect(submit(userA, matchId, '{b,b}')).rejects.toThrow(/no longer accepting reports/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"; grep -c "submit_report" /tmp/db.log`
Expected: FAIL with `function public.submit_report(unknown, text[]) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905121000_submit_report.sql
create or replace function public.submit_report(p_match_id uuid, p_wins text[])
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  m public.matches;
  me uuid := auth.uid();
  other_wins text[];
  i int;
begin
  -- The lock is the point. Two simultaneous submissions without it each read
  -- "the opponent has not reported" and each write 'reported', and a match on
  -- which both sides agreed sits unconfirmed forever.
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'no such match';
  end if;
  if me is null or me not in (m.player_a, m.player_b) then
    raise exception 'this match is not yours';
  end if;
  if m.state not in ('paired', 'reported', 'mismatch') then
    raise exception 'this match is no longer accepting reports';
  end if;
  if not public.is_valid_scoreline(m.rounds, p_wins) then
    raise exception 'that is not a possible best-of-% scoreline', m.rounds;
  end if;

  insert into public.match_reports (match_id, reporter_id, best_of, wins)
  values (p_match_id, me, m.rounds, p_wins)
  on conflict (match_id, reporter_id) do update
    set wins = excluded.wins,
        amended_at = now(),
        amend_count = public.match_reports.amend_count + 1;

  select wins into other_wins
    from public.match_reports
   where match_id = p_match_id and reporter_id <> me;

  if other_wins is null then
    update public.matches set state = 'reported' where id = p_match_id;
    return 'reported';
  end if;

  if other_wins = p_wins then
    -- An amend can rewrite an earlier adjudication, so clear before writing.
    delete from public.match_rounds where match_id = p_match_id;
    for i in 1..array_length(p_wins, 1) loop
      insert into public.match_rounds (match_id, round_no, winner)
      values (p_match_id, i, case when p_wins[i] = 'a' then m.player_a else m.player_b end);
    end loop;
    update public.matches
       set state = 'confirmed', rating_counted = true, amend_deadline = null
     where id = p_match_id;
    return 'confirmed';
  end if;

  -- coalesce, not assignment: the window opens once. Re-arming it on every
  -- amend would let one side stall a dispute indefinitely.
  update public.matches
     set state = 'mismatch',
         amend_deadline = coalesce(m.amend_deadline, now() + interval '10 minutes')
   where id = p_match_id;
  return 'mismatch';
end;
$fn$;

grant execute on function public.submit_report(uuid, text[]) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905121000_submit_report.sql supabase/tests/reports.test.ts
git commit -m "feat(matches): one function adjudicates, under a row lock

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

