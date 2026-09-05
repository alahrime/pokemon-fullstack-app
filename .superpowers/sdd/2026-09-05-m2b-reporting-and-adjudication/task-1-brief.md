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

