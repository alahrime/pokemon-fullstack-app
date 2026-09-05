# M2b — Match reporting and adjudication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two people in a `matches` row each file a per-round scoreline; agreement confirms the match and writes the adjudicated truth; disagreement opens an amend window and, unresolved, lands on `disputed`.

**Architecture:** Reports and truth are two tables, deliberately — `match_reports` holds what each side *claimed*, `match_rounds` holds what was *adjudicated*, and collapsing them destroys the only evidence a dispute has. Both reports are written through one `security definer` function that takes a row lock on the match, so the common path (both agree) confirms synchronously in the same transaction rather than waiting up to sixty seconds for a coordinator tick. The coordinator keeps only the work that is genuinely about the passage of time: expiring the amend window, and giving up on matches nobody reported.

**Tech Stack:** Postgres 17.6 + RLS, Supabase Edge Functions (Deno), pg_cron, React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-paragon-platform-design.md` — sections 2 (entities: `match_reports`, `match_rounds`), 3 (security model: reports sealed until both submit; `match_rounds` never client-writable), and "Disputes are settled with journal evidence" (the seven-step ladder this plan implements steps 1–3 of).

## Global Constraints

- `npm run check` (Docker-free) and `npm run check:db` (needs the local stack) are the two gates. **`check:db` is required before merging anything touching a migration or a policy.** Both must be green at the end of every task.
- **Merging to `main` deploys every migration to the production database.** Treat each migration as an outward-facing change.
- `owner_id` / `user_id` / `reporter_id` columns default to `auth.uid()` and are never sent by the client. One place decides who owns a row.
- Every policy gets an allow test **and** a deny test. An empty table returns `[]` whether RLS is on or off; only a refused write distinguishes them.
- Distinguish the two refusals. `PRIVILEGE_DENIED` (`permission denied for table x`) means the grant is absent; `POLICY_DENIED` (`new row violates row-level security policy`) means a WITH CHECK rejected the row. They share SQLSTATE 42501 and are otherwise nothing alike. `supabase/tests/helpers.ts` exports both regexes — extend `PRIVILEGE_DENIED`'s alternation to include the new tables.
- An UPDATE or DELETE whose USING clause excludes the row reports 0 rows and raises **nothing**. Never assert "it threw" when you mean "it changed nothing".
- Piped exit codes lie: run `cmd > out.log 2>&1; echo "EXIT=$?"`, never `cmd | tail`.
- Stop any dev server you start. A stray vite process once turned a 44-second gate into a 68-minute run.
- Two signed-in accounts in one browser: `http://localhost:5173` and `http://127.0.0.1:5173` are different origins and hold independent sessions. Both are already in `additional_redirect_urls`. Bot credentials are `test-opponent-{1,2}@example.test` / `Test-Opponent-{1,2}-fixture`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/*_match_reports_and_rounds.sql` (create) | Both tables, the scoreline validator, the extended `matches.state`, the friend-code visibility fix |
| `supabase/migrations/*_submit_report.sql` (create) | `submit_report()` — the synchronous adjudicator |
| `supabase/migrations/*_sweep_matches.sql` (create) | `sweep_matches()` — the time-based transitions only |
| `supabase/functions/coordinator/index.ts` (modify) | Call `sweep_matches` on each tick |
| `app/src/lib/matches.ts` (create) | Client data layer: match detail, submit, read own report, read adjudicated rounds |
| `app/src/lib/matchmaking.ts` (modify) | Re-export `Match` from `matches.ts`; stop duplicating the row shape |
| `app/src/screens/MatchScreen.tsx` (create) | The report form and the state of one match |
| `app/src/lib/screens.ts` (modify) | Register the `match` destination |
| `supabase/tests/reports.test.ts` (create) | Policy, constraint and adjudication tests |
| `app/tools/m2b-roundtrip.ts` (create) | Two real accounts through the ladder against real Postgres |

---

### Task 1: The two tables, and a scoreline that cannot be impossible

`match_reports` holds claims; `match_rounds` holds adjudicated truth. The interesting work here is the check constraint: a best-of-3 cannot end `[a,a,a]` (the third round would never be played) and cannot end `[a,b]` (nobody reached two). Rejecting those in the database rather than in a form validator means a client that skips the form still cannot write nonsense.

This task also fixes a defect it would otherwise introduce. The policy "an opponent may read your friend code while you have a match" keys on `m.state = 'paired'`. Extending the state machine means the friend code would vanish from the opponent's screen the instant either side reported — mid-match, exactly when it is needed.

**Files:**
- Create: `supabase/migrations/20260905120000_match_reports_and_rounds.sql`
- Modify: `supabase/tests/helpers.ts` (extend `PRIVILEGE_DENIED`)
- Test: `supabase/tests/reports.test.ts`

**Interfaces:**
- Produces: table `public.match_reports (match_id, reporter_id, best_of, wins, submitted_at, amended_at, amend_count)`, PK `(match_id, reporter_id)`.
- Produces: table `public.match_rounds (match_id, round_no, winner)`, PK `(match_id, round_no)`.
- Produces: `public.is_valid_scoreline(best_of smallint, wins text[]) returns boolean`, immutable.
- Produces: `matches.state` accepts `paired|reported|confirmed|mismatch|disputed|unverified|abandoned`; new columns `matches.rating_counted boolean not null default false` and `matches.amend_deadline timestamptz`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/reports.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

describe('match reports and adjudicated rounds', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const stranger = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  async function makeMatch(rounds = 3): Promise<string> {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches
         (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, rounds, source)
       values ('${userA}', '${userB}', '${versionId}', 'aa', '[]'::jsonb, '[]'::jsonb, 'rev1', 's', ${rounds}, 'queue')
       returning id`,
    );
    return m.id;
  }

  beforeAll(async () => {
    await makeUser(userA, `RA_${userA.slice(0, 8)}`);
    await makeUser(userB, `RB_${userB.slice(0, 8)}`);
    await makeUser(stranger, `RS_${stranger.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${userA}', 'Report Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a = '${userA}' or player_b = '${userA}'`);
  });

  it('accepts only scorelines a best-of could actually produce', async () => {
    const valid = [
      [3, `'{a,a}'`], [3, `'{b,b}'`], [3, `'{a,b,a}'`], [3, `'{b,a,b}'`],
      [5, `'{a,a,a}'`], [5, `'{a,b,a,b,a}'`], [5, `'{b,a,b,b}'`],
    ] as const;
    for (const [n, arr] of valid) {
      const [r] = await sql<{ ok: boolean }>(
        `select public.is_valid_scoreline(${n}::smallint, ${arr}::text[]) as ok`,
      );
      expect(r.ok, `best-of-${n} ${arr} should be valid`).toBe(true);
    }

    const invalid = [
      [3, `'{a,a,a}'`],   // the third round would never have been played
      [3, `'{a,b}'`],     // nobody reached two
      [3, `'{a}'`],       // ditto
      [3, `'{a,b,a,b}'`], // longer than the best-of
      [3, `'{a,c}'`],     // not a side
      [3, `'{}'`],        // empty
      [5, `'{a,a}'`],     // nobody reached three
      [5, `'{a,a,a,b}'`], // decided in round 3; round 4 never happened
    ] as const;
    for (const [n, arr] of invalid) {
      const [r] = await sql<{ ok: boolean }>(
        `select public.is_valid_scoreline(${n}::smallint, ${arr}::text[]) as ok`,
      );
      expect(r.ok, `best-of-${n} ${arr} should be invalid`).toBe(false);
    }
  });

  it('seals a report from the opponent until the match is confirmed', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.match_reports (match_id, reporter_id, best_of, wins)
       values ('${matchId}', '${userA}', 3, '{a,a}')`,
    );

    const mine = await asUser({ sub: userA })(
      `select wins from public.match_reports where match_id = '${matchId}'`,
    );
    expect(mine).toHaveLength(1);

    const theirs = await asUser({ sub: userB })(
      `select wins from public.match_reports where match_id = '${matchId}'`,
    );
    expect(theirs).toHaveLength(0);

    await sql(`update public.matches set state = 'confirmed' where id = '${matchId}'`);
    const afterConfirm = await asUser({ sub: userB })(
      `select wins from public.match_reports where match_id = '${matchId}'`,
    );
    expect(afterConfirm).toHaveLength(1);
  });

  it('lets nobody write a report or an adjudicated round directly', async () => {
    const matchId = await makeMatch();
    await refusal(
      asUser({ sub: userA })(
        `insert into public.match_reports (match_id, reporter_id, best_of, wins)
         values ('${matchId}', '${userA}', 3, '{a,a}')`,
      ),
      PRIVILEGE_DENIED,
    );
    await refusal(
      asUser({ sub: userA })(
        `insert into public.match_rounds (match_id, round_no, winner)
         values ('${matchId}', 1, '${userA}')`,
      ),
      PRIVILEGE_DENIED,
    );
  });

  it('shows an adjudicated round to the two players and to nobody else', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.match_rounds (match_id, round_no, winner)
       values ('${matchId}', 1, '${userA}')`,
    );
    expect(await asUser({ sub: userA })(`select * from public.match_rounds where match_id = '${matchId}'`)).toHaveLength(1);
    expect(await asUser({ sub: userB })(`select * from public.match_rounds where match_id = '${matchId}'`)).toHaveLength(1);
    expect(await asUser({ sub: stranger })(`select * from public.match_rounds where match_id = '${matchId}'`)).toHaveLength(0);
  });

  it('keeps the opponent friend code readable while the match is still live', async () => {
    const matchId = await makeMatch();
    await sql(
      `insert into public.friend_codes (profile_id, code) values ('${userB}', '1111 2222 3333')
       on conflict (profile_id) do update set code = excluded.code`,
    );
    for (const state of ['paired', 'reported', 'mismatch', 'disputed']) {
      await sql(`update public.matches set state = '${state}' where id = '${matchId}'`);
      const rows = await asUser({ sub: userA })(
        `select code from public.friend_codes where profile_id = '${userB}'`,
      );
      expect(rows, `friend code should be readable while ${state}`).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"; grep -A3 "reports" /tmp/db.log`
Expected: FAIL — `function public.is_valid_scoreline(smallint, text[]) does not exist` and `relation "public.match_reports" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260905120000_match_reports_and_rounds.sql

-- A best-of-N ends the moment one side reaches N/2+1 wins, and not before.
-- Both facts are checkable from the array alone: the side that won the LAST
-- round must hold exactly the needed count (so it reached it on that round and
-- not earlier), and the other side must hold fewer.
create or replace function public.is_valid_scoreline(best_of smallint, wins text[])
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select best_of in (3, 5)
     and wins is not null
     and array_length(wins, 1) is not null
     and array_length(wins, 1) between (best_of / 2 + 1) and best_of
     and not exists (select 1 from unnest(wins) w where w is null or w not in ('a', 'b'))
     and (select count(*) from unnest(wins) w where w = wins[array_length(wins, 1)])
         = (best_of / 2 + 1)
     and (select count(*) from unnest(wins) w where w <> wins[array_length(wins, 1)])
         < (best_of / 2 + 1)
$fn$;

-- What each side CLAIMED. Never the truth; see match_rounds for that.
create table public.match_reports (
  match_id uuid not null references public.matches (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  -- Copied from matches.rounds by submit_report, which is the only writer, so
  -- a check constraint can validate the pair without joining to matches.
  best_of smallint not null,
  -- 'a' or 'b' per round, in MATCH terms (matches.player_a / player_b), not
  -- reporter-relative: two reports are then compared with `=` rather than by
  -- flipping one side's perspective, and a perspective flip is exactly the
  -- kind of thing that is right in tests and wrong in the one caller that
  -- matters.
  wins text[] not null,
  submitted_at timestamptz not null default now(),
  amended_at timestamptz,
  amend_count smallint not null default 0,
  primary key (match_id, reporter_id),
  constraint match_reports_scoreline check (public.is_valid_scoreline(best_of, wins))
);

-- The adjudicated per-round truth.
create table public.match_rounds (
  match_id uuid not null references public.matches (id) on delete cascade,
  round_no smallint not null,
  -- RESTRICT: a profile that is deleted must not silently rewrite a settled
  -- record into one with a missing winner. The match itself cascades away.
  winner uuid not null references public.profiles (id) on delete restrict,
  primary key (match_id, round_no),
  constraint match_rounds_round_no check (round_no between 1 and 5)
);

alter table public.matches drop constraint matches_state;
alter table public.matches add constraint matches_state
  check (state in ('paired', 'reported', 'confirmed', 'mismatch', 'disputed', 'unverified', 'abandoned'));

alter table public.matches add column rating_counted boolean not null default false;
alter table public.matches add column amend_deadline timestamptz;

alter table public.match_reports enable row level security;
alter table public.match_rounds enable row level security;

-- The sealing rule, verbatim from the spec. If a player can read the opponent's
-- claim before filing their own, the honest path and the exploit are the same
-- click. Note what this does NOT need: at 'mismatch' both sides learn they
-- disagree from matches.state, which they can already read, so nothing has to
-- be widened to tell them.
create policy "your own report always, your opponent's only once confirmed"
  on public.match_reports for select
  to authenticated
  using (
    reporter_id = (select auth.uid())
    or exists (
      select 1 from public.matches m
       where m.id = match_reports.match_id
         and m.state = 'confirmed'
         and (select auth.uid()) in (m.player_a, m.player_b)
    )
  );

create policy "an adjudicated round is visible to the two people in the match"
  on public.match_rounds for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
       where m.id = match_rounds.match_id
         and (select auth.uid()) in (m.player_a, m.player_b)
    )
  );

-- Belt and braces, and a DIFFERENT error class on purpose. With no write policy
-- these tables are already default-deny, but that produces a policy refusal
-- which a later `for all` policy could quietly convert into a grant. Revoking
-- the verb means a mistake like that still cannot write, and the test can tell
-- the two apart.
revoke insert, update, delete on public.match_reports from authenticated;
revoke insert, update, delete on public.match_rounds from authenticated;

-- The friend code must stay readable for the whole live match, not just while
-- 'paired'. Without this, reporting hides the code mid-match — the one moment
-- both players still need it.
drop policy "an opponent may read your friend code while you have a match" on public.friend_codes;
create policy "an opponent may read your friend code while you have a match"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.state in ('paired', 'reported', 'mismatch', 'disputed')
        and ((m.player_a = friend_codes.profile_id and m.player_b = (select auth.uid()))
          or (m.player_b = friend_codes.profile_id and m.player_a = (select auth.uid())))
    )
  );
```

- [ ] **Step 4: Extend the privilege-denied matcher**

In `supabase/tests/helpers.ts`, widen the alternation so the new tables are matched:

```ts
export const PRIVILEGE_DENIED =
  /permission denied for table (match_offers|queue_entries|matches|match_reports|match_rounds)/;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "RESET=$?"; npm run check:db > /tmp/db.log 2>&1; echo "EXIT=$?"`
Expected: `RESET=0`, `EXIT=0`, and the five new tests in `reports.test.ts` green.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260905120000_match_reports_and_rounds.sql supabase/tests/reports.test.ts supabase/tests/helpers.ts
git commit -m "feat(matches): claims and adjudicated truth, in two tables

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

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

### Task 4: The client data layer

`matchmaking.ts` already declares a `Match` shape and reads the row. This task moves match reading into its own module and extends it, rather than growing a 424-line file that is about getting *into* a match with everything about what happens *inside* one.

The perspective conversion lives here and nowhere else. The database stores `'a'`/`'b'` in match terms; a player thinks in "I won". One function converts, and every caller uses it.

**Files:**
- Create: `app/src/lib/matches.ts`
- Modify: `app/src/lib/matchmaking.ts`
- Test: `app/src/lib/__tests__/matches.test.ts`

**Interfaces:**
- Consumes: `public.submit_report` from Task 2; `supabase` from `app/src/lib/supabase.ts`.
- Produces:
  - `type MatchState = 'paired' | 'reported' | 'confirmed' | 'mismatch' | 'disputed' | 'unverified' | 'abandoned'`
  - `type Side = 'a' | 'b'`
  - `interface Match { id, opponentId, mySide: Side, formatVersionId, rulesHash, dataRev, rounds, state: MatchState, ratingCounted: boolean, amendDeadline: string | null, source: 'queue' | 'offer', createdAt }`
  - `myMatches(): Promise<Match[]>`
  - `submitReport(matchId: string, wins: Side[]): Promise<MatchState>`
  - `myReport(matchId: string): Promise<{ wins: Side[]; amendCount: number } | null>`
  - `adjudicatedRounds(matchId: string): Promise<{ roundNo: number; winner: string }[]>`
  - `toMatchTerms(iWon: boolean[], mySide: Side): Side[]`
  - `toMyTerms(wins: Side[], mySide: Side): boolean[]`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/matches.test.ts
import { describe, it, expect } from 'vitest';
import { toMatchTerms, toMyTerms } from '../matches';

describe('perspective conversion', () => {
  it('converts what I claim into match terms, from either seat', () => {
    expect(toMatchTerms([true, false, true], 'a')).toEqual(['a', 'b', 'a']);
    expect(toMatchTerms([true, false, true], 'b')).toEqual(['b', 'a', 'b']);
  });

  it('round-trips from both seats', () => {
    const claim = [true, true, false, false, true];
    for (const side of ['a', 'b'] as const) {
      expect(toMyTerms(toMatchTerms(claim, side), side)).toEqual(claim);
    }
  });

  it('reads the same stored array oppositely for the two players', () => {
    const stored = ['a', 'b', 'a'] as const;
    expect(toMyTerms([...stored], 'a')).toEqual([true, false, true]);
    expect(toMyTerms([...stored], 'b')).toEqual([false, true, false]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/__tests__/matches.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../matches"`.

- [ ] **Step 3: Write the module**

```ts
// app/src/lib/matches.ts
import { supabase } from './supabase';

export type MatchState =
  | 'paired' | 'reported' | 'confirmed' | 'mismatch' | 'disputed' | 'unverified' | 'abandoned';

/** Which seat of the match row you are sitting in. */
export type Side = 'a' | 'b';

export interface Match {
  id: string;
  opponentId: string;
  mySide: Side;
  formatVersionId: string;
  rulesHash: string;
  dataRev: string;
  rounds: number;
  state: MatchState;
  ratingCounted: boolean;
  amendDeadline: string | null;
  source: 'queue' | 'offer';
  createdAt: string;
}

/**
 * The stored array names the winner of each round in MATCH terms. A player
 * thinks in "I won round 2". These two functions are the only place that
 * conversion happens — a flip applied twice, or in one caller and not its
 * neighbour, is a scoreline reported backwards.
 */
export function toMatchTerms(iWon: boolean[], mySide: Side): Side[] {
  const them: Side = mySide === 'a' ? 'b' : 'a';
  return iWon.map((won) => (won ? mySide : them));
}

export function toMyTerms(wins: Side[], mySide: Side): boolean[] {
  return wins.map((w) => w === mySide);
}

const COLUMNS =
  'id, player_a, player_b, format_version_id, rules_hash, data_rev, rounds, state, rating_counted, amend_deadline, source, created_at';

interface Row {
  id: string;
  player_a: string;
  player_b: string;
  format_version_id: string;
  rules_hash: string;
  data_rev: string;
  rounds: number;
  state: MatchState;
  rating_counted: boolean;
  amend_deadline: string | null;
  source: 'queue' | 'offer';
  created_at: string;
}

function toMatch(r: Row, me: string | undefined): Match {
  const mySide: Side = r.player_a === me ? 'a' : 'b';
  return {
    id: r.id,
    opponentId: r.player_a === me ? r.player_b : r.player_a,
    mySide,
    formatVersionId: r.format_version_id,
    rulesHash: r.rules_hash,
    dataRev: r.data_rev,
    rounds: r.rounds,
    state: r.state,
    ratingCounted: r.rating_counted,
    amendDeadline: r.amend_deadline,
    source: r.source,
    createdAt: r.created_at,
  };
}

/**
 * `getSession()`, not `getUser()`: `getUser()` is a network round trip that
 * revalidates the JWT and would abort this read on a transient error for an id
 * the caller already holds locally. `SessionContext.tsx` and the old
 * `matchmaking.myMatches` make the same choice for the same reason.
 */
async function myId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id;
}

export async function myMatches(): Promise<Match[]> {
  const me = await myId();
  const { data, error } = await supabase
    .from('matches')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toMatch(row as unknown as Row, me));
}

export async function submitReport(matchId: string, wins: Side[]): Promise<MatchState> {
  const { data, error } = await supabase.rpc('submit_report', {
    p_match_id: matchId,
    p_wins: wins,
  });
  if (error) throw new Error(error.message);
  return data as MatchState;
}

export async function myReport(
  matchId: string,
): Promise<{ wins: Side[]; amendCount: number } | null> {
  const me = await myId();
  if (!me) return null;
  const { data, error } = await supabase
    .from('match_reports')
    .select('wins, amend_count')
    .eq('match_id', matchId)
    .eq('reporter_id', me)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as { wins: Side[]; amend_count: number };
  return { wins: r.wins, amendCount: r.amend_count };
}

export async function adjudicatedRounds(
  matchId: string,
): Promise<{ roundNo: number; winner: string }[]> {
  const { data, error } = await supabase
    .from('match_rounds')
    .select('round_no, winner')
    .eq('match_id', matchId)
    .order('round_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as { round_no: number; winner: string };
    return { roundNo: r.round_no, winner: r.winner };
  });
}
```

- [ ] **Step 4: Point `matchmaking.ts` at it**

Delete `matchmaking.ts`'s own `Match` interface and its `myMatches` implementation, and re-export instead, so there is one row shape:

```ts
export { myMatches, type Match } from './matches';
```

`MatchmakingScreen.tsx` imports both from `matchmaking` and needs no change.

- [ ] **Step 5: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"; grep -E "Tests  " /tmp/app.log`
Expected: `EXIT=0`, test count up by 3 on the previous total.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/matches.ts app/src/lib/matchmaking.ts app/src/lib/__tests__/matches.test.ts
git commit -m "feat(matches): a data layer for what happens inside a match

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The match screen

Today a paired match renders as the words "Match paired" and a friend code (`MatchmakingScreen.tsx:709-724`) — the end of the road. This gives it somewhere to go.

`MatchmakingScreen.tsx` is 919 lines and is about getting into a match. This is a new screen rather than a tenth section of that one.

**Files:**
- Create: `app/src/screens/MatchScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Modify: `app/src/screens/MatchmakingScreen.tsx:709-724`
- Test: `app/src/screens/__tests__/match-screen.test.tsx`

**Interfaces:**
- Consumes: everything exported by `app/src/lib/matches.ts` (Task 4).
- Produces: a `match` screen id registered in `screens.ts`, reached with a `matchId`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/screens/__tests__/match-screen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/render';
import { MatchScreen } from '../MatchScreen';
import type { Match } from '../../lib/matches';

const base: Match = {
  id: 'm1', opponentId: 'opp', mySide: 'a', formatVersionId: 'fv1', rulesHash: 'aa',
  dataRev: 'rev1', rounds: 3, state: 'paired', ratingCounted: false, amendDeadline: null,
  source: 'queue', createdAt: '2026-09-05T00:00:00Z',
};

const submitReport = vi.fn();
vi.mock('../../lib/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/matches')>()),
  submitReport: (...args: unknown[]) => submitReport(...args),
  myReport: async () => null,
  adjudicatedRounds: async () => [],
}));

beforeEach(() => submitReport.mockReset().mockResolvedValue('reported'));

describe('match screen', () => {
  it('will not submit an impossible best-of-3 scoreline', async () => {
    render(<MatchScreen match={base} onChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /round 1: i won/i }));
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /round 2: i won/i }));
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
  });

  it('sends the scoreline in match terms for the seat you are in', async () => {
    render(<MatchScreen match={{ ...base, mySide: 'b' }} onChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /round 1: i won/i }));
    await user.click(screen.getByRole('button', { name: /round 2: i won/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(submitReport).toHaveBeenCalledWith('m1', ['b', 'b']));
  });

  it('tells both sides they disagree without showing the opponent claim', async () => {
    render(<MatchScreen match={{ ...base, state: 'mismatch' }} onChanged={() => {}} />);
    expect(await screen.findByText(/scores don't match/i)).toBeInTheDocument();
    expect(screen.queryByText(/opponent reported/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/screens/__tests__/match-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../MatchScreen"`.

- [ ] **Step 3: Write the screen**

```tsx
// app/src/screens/MatchScreen.tsx
import { useEffect, useState } from 'react';
import {
  adjudicatedRounds, myReport, submitReport, toMatchTerms, toMyTerms,
  type Match, type Side,
} from '../lib/matches';

/** A best-of-N ends when one side reaches this many. */
const needed = (bestOf: number) => Math.floor(bestOf / 2) + 1;

/**
 * The same rule `is_valid_scoreline` enforces in the database, so the Submit
 * button is not offered for a claim the server will refuse. The database is
 * still the authority — this only spares the round trip.
 */
export function isCompleteScoreline(iWon: boolean[], bestOf: number): boolean {
  if (iWon.length < needed(bestOf) || iWon.length > bestOf) return false;
  const mine = iWon.filter(Boolean).length;
  const theirs = iWon.length - mine;
  const last = iWon[iWon.length - 1];
  const winner = last ? mine : theirs;
  const loser = last ? theirs : mine;
  return winner === needed(bestOf) && loser < needed(bestOf);
}

const HEADLINE: Record<Match['state'], string> = {
  paired: 'Play your rounds in Pokémon GO, then report the result.',
  reported: 'Reported. Waiting for your opponent.',
  confirmed: 'Confirmed. Both of you reported the same result.',
  mismatch: "Your scores don't match. Check your battle journal and amend if you got it wrong.",
  disputed: 'Disputed — the amend window closed while the reports still disagreed.',
  unverified: 'Nobody reported in time. This one counts for nothing.',
  abandoned: 'Abandoned.',
};

export function MatchScreen({ match, onChanged }: { match: Match; onChanged: () => void }) {
  const [iWon, setIWon] = useState<boolean[]>([]);
  const [rounds, setRounds] = useState<{ roundNo: number; winner: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void myReport(match.id).then((r) => {
      if (live && r) setIWon(toMyTerms(r.wins, match.mySide));
    });
    void adjudicatedRounds(match.id).then((r) => {
      if (live) setRounds(r);
    });
    return () => {
      live = false;
    };
  }, [match.id, match.mySide]);

  const open = match.state === 'paired' || match.state === 'reported' || match.state === 'mismatch';
  const complete = isCompleteScoreline(iWon, match.rounds);

  function setRound(i: number, won: boolean) {
    setIWon((prev) => {
      const next = prev.slice(0, i);
      while (next.length < i) next.push(false);
      next[i] = won;
      return next;
    });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await submitReport(match.id, toMatchTerms(iWon, match.mySide));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="hud-label">Match</div>
      <p role="status">{HEADLINE[match.state]}</p>

      {open && (
        <ul className="round-list">
          {Array.from({ length: match.rounds }, (_, i) => (
            <li key={i} className="round-row">
              <span>Round {i + 1}</span>
              <button
                type="button"
                aria-pressed={iWon[i] === true}
                onClick={() => setRound(i, true)}
              >
                Round {i + 1}: I won
              </button>
              <button
                type="button"
                aria-pressed={iWon[i] === false && i < iWon.length}
                onClick={() => setRound(i, false)}
              >
                Round {i + 1}: they won
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <button type="button" disabled={!complete || busy} onClick={() => void send()}>
          {match.state === 'mismatch' ? 'Amend my report' : 'Submit my report'}
        </button>
      )}

      {error && <p className="error">{error}</p>}

      {rounds.length > 0 && (
        <ol className="adjudicated">
          {rounds.map((r) => (
            <li key={r.roundNo}>
              Round {r.roundNo}: {r.winner === match.opponentId ? 'they won' : 'you won'}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Register the screen and link to it**

In `app/src/lib/screens.ts`, add a `match` entry beside the existing `matchmaking` one (id `'match'`, a title of `Match`, and a blurb of `Report the rounds you played and see the adjudicated result.`). In `MatchmakingScreen.tsx:709-724`, make each `<li className="match-row">` render a button that navigates to the `match` destination carrying `m.id`, keeping the friend code where it is.

- [ ] **Step 5: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"; grep -E "Tests  " /tmp/app.log`
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/MatchScreen.tsx app/src/lib/screens.ts app/src/screens/MatchmakingScreen.tsx app/src/screens/__tests__/match-screen.test.tsx
git commit -m "feat(matches): a screen where a paired match can be reported

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Two accounts, one match, against real Postgres

`app/src/lib/__tests__/matches.test.ts` mocks nothing important, but the screen test mocks the whole data layer, and `saves.test.ts` has twice now proved that a mocked Supabase client agrees with whatever it is told. The ladder is a state machine spread across a check constraint, a policy, a locked function and a cron sweep; no mock can judge it.

This is a fixture in the style of `app/tools/m2a-roundtrip.ts` — it asserts, and it refuses to run anywhere but the local stack.

**Files:**
- Create: `app/tools/m2b-roundtrip.ts`

**Interfaces:**
- Consumes: `app/src/lib/matches.ts` (Task 4) — the SHIPPING module, for the same reason `m2a-roundtrip.ts` does it: rows written by a reimplementation of the client are rows the client never has to be able to read.

- [ ] **Step 1: Write the script**

It must sign in as both bots (`test-opponent-{1,2}@example.test` / `Test-Opponent-{1,2}-fixture`), create a match between them with the service role, then assert this sequence, printing a line per check:

1. Bot 1 submits `[true, false, true]` → returns `reported`; `matches.state` is `reported`.
2. Bot 1 reads its own report back; **bot 2 reading `match_reports` for that match gets zero rows** — the sealing rule, exercised through PostgREST rather than through `asUser`.
3. Bot 2 submits a disagreeing scoreline → returns `mismatch`; `amend_deadline` is set.
4. Bot 2 reads `match_reports` again and still sees only its own row.
5. Bot 2 amends to agree → returns `confirmed`; `match_rounds` holds three rows in round order with the right winners; **both** bots can now read both reports.
6. On a second match, both disagree, `amend_deadline` is forced into the past with the service role, `sweep_matches` is called, and the state is `disputed`.
7. Bot 1 submitting into that disputed match raises `this match is no longer accepting reports`.

Guard it exactly as `opponents.ts` does:

```ts
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  console.error(`REFUSING TO RUN: SUPABASE_URL is ${SUPABASE_URL}, which is not the local stack.`);
  process.exit(2);
}
```

- [ ] **Step 2: Run it and verify every check passes**

```bash
cd app && ./node_modules/.bin/esbuild tools/m2b-roundtrip.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/m2b.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
SUPABASE_SERVICE_ROLE_KEY='<from npm run db:start>' node node_modules/.cache/m2b.mjs > /tmp/rt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` and every numbered check printed as a pass. **Check 2 and check 4 are the ones that matter** — they are the sealing rule measured through the real client, and they are the failure the spec says "breaks nothing visibly".

- [ ] **Step 3: Commit**

```bash
git add app/tools/m2b-roundtrip.ts
git commit -m "test(tools): the report ladder, driven by two real accounts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Both gates green: `npm run check` and `npm run check:db`.
- `m2b-roundtrip.ts` passes all seven checks against the local stack.
- Driven by hand through two browser origins (`localhost:5173` and `127.0.0.1:5173`) as two different accounts: report, mismatch, amend, confirm.
- `docs/superpowers/HANDOFF.md` records the new coordinator response shape.

## Deliberately not in M2b

- **Journal evidence** (`match_evidence`, object storage, EXIF stripping, serving from the store's own origin). Steps 4–7 of the spec's ladder. A match reaching `disputed` sits there; nothing is lost, because `disputed` is already the state that excludes it from rating.
- **Ratings and seasons.** `rating_counted` is written here and read by nothing yet; that is M4's job.
- **The match channel.** It is the same `channels` subsystem as DMs — see the M3b plan rather than building a second one here.

## Known gaps this plan accepts

- `best_of` is denormalised onto `match_reports` so a check constraint can validate the scoreline without joining. It agrees with `matches.rounds` because `submit_report` is the only writer and copies it; if a second writer is ever granted, that invariant needs a trigger.
- The 48-hour give-up and the 10-minute amend window are literals in SQL. They belong in a settings table the first time somebody wants to change one without a migration.
- `isCompleteScoreline` in the screen restates `is_valid_scoreline`'s rule in TypeScript. Two statements of one rule can drift; the database is the authority and the client copy only avoids offering a button that must fail. If a third caller needs it, move it to `app/src/rules/` where the coordinator can share it.
