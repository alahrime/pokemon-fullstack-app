# M2a pre-merge fix wave — final report

**Status: done.** Both Criticals closed and proven closed by measurement against the live local
database, before and after. Both gates EXIT=0. The end-to-end round trip passes 14/14 with the
revoke and the two tightened policies in place. All 20 migrations apply from scratch.

| Evidence | Path | Result |
|---|---|---|
| Migration apply | `/tmp/final-fix-mig.log` | EXIT=0, both applied |
| From-scratch reset | `/tmp/final-fix-reset.log` | EXIT=0, all 20 migrations |
| App gate | `/tmp/final-fix-gate.log` | EXIT=0 — 81 files, **1162 tests** |
| DB gate | `/tmp/final-fix-db.log` | EXIT=0 — 7 files, **130 tests** |
| Round trip | `/tmp/final-fix-roundtrip.log` | RUN_EXIT=0 — **14 passed, 0 failed** |
| Exploit, before | `/tmp/final-fix-exploit-before.log` | both Criticals reproduce |
| Exploit, after | `/tmp/final-fix-exploit-after.log` | every step refused |
| SQL mutations | `/tmp/final-fix-mutations.log` | 13 mutations, **13 killed** |
| Screen mutations | `/tmp/final-fix-screen-mutations.log` | 3 mutations, **3 killed** |

Every log above is my own run from this session. Counts before this work: app 1158, db 109.

---

## 1. The two Criticals, verbatim before and after

Reproduced with a probe that creates its own attacker and victim, runs the measured chain, prints
each step's outcome, and deletes everything it made. Run against the unfixed database first, then
against the fixed one, then again against the from-scratch database after the reset.

### C1 — a client verifies its own queue entry

**BEFORE** (`/tmp/final-fix-exploit-before.log`):

```
C1 — a client verifies its own queue entry:
  insert queue_entries with claimed_hash 'I-NEVER-COMPUTED-THIS' and verified_hash 'forged-verified-hash'
    OUTCOME: SUCCEEDED, 1 row(s) [{"id":"17269ceb-...","verified_hash":"forged-verified-hash"}]

C1b — TRUNCATE, which never consults row-level security:
  truncate public.queue_entries (rolled back)
    OUTCOME: SUCCEEDED, 1 row(s) [{"note":"TRUNCATE TABLE succeeded (0 rows left); rolled back"}]
```

**AFTER** (`/tmp/final-fix-exploit-after.log`):

```
C1 — a client verifies its own queue entry:
  insert queue_entries with claimed_hash 'I-NEVER-COMPUTED-THIS' and verified_hash 'forged-verified-hash'
    OUTCOME: REFUSED — [42501] new row violates row-level security policy for table "queue_entries"

C1b — TRUNCATE, which never consults row-level security:
  truncate public.queue_entries (rolled back)
    OUTCOME: REFUSED — [42501] permission denied for table queue_entries
```

The TRUNCATE probe is wrapped in a transaction that always rolls back, with a sentinel that
distinguishes "it ran and we undid it" from "it was refused" — without the sentinel those two are
the same rejected promise. It is not honest to prove a client could empty the partner's queue by
emptying it.

### C2 — a proposer forges a match and harvests a friend code

**BEFORE**:

```
C2 — a proposer forges an acceptance and harvests a friend code:
  1. insert own offer, already carrying verified_hash (C1 again, on the offer table)
    OUTCOME: SUCCEEDED, 1 row(s) [{"id":"f5a6a949-..."}]
  2. UPDATE own offer: accepted_by = <victim>, accepted_team = '[]', state = 'accepted'
    OUTCOME: SUCCEEDED, 1 row(s) [{"id":"f5a6a949-...","accepted_by":"07932012-...","state":"accepted"}]
    ground truth after step 2 (superuser read): [{"state":"accepted","accepted_by":"07932012-..."}]
  3. select public.confirm_offer('f5a6a949-...')
    OUTCOME: SUCCEEDED, 1 row(s) [{"match_id":"2abd17ea-..."}]

  4. the attacker reads the victim's friend code:
    OUTCOME: HARVESTED [{"code":"1111 2222 3333"}]
  phantom matches against the victim: 1 [{"id":"2abd17ea-...","player_a":"b573f8b2-...","player_b":"07932012-..."}]
```

**AFTER**:

```
C2 — a proposer forges an acceptance and harvests a friend code:
  1. insert own offer, already carrying verified_hash (C1 again, on the offer table)
    OUTCOME: REFUSED — [42501] new row violates row-level security policy for table "match_offers"
    (offer planted by the superuser as 'a2ae0b76-...' so step 2 is still exercised)
  2. UPDATE own offer: accepted_by = <victim>, accepted_team = '[]', state = 'accepted'
    OUTCOME: REFUSED — [42501] permission denied for table match_offers
    ground truth after step 2 (superuser read): [{"state":"open","accepted_by":null}]
  3. select public.confirm_offer('a2ae0b76-...')
    OUTCOME: REFUSED — [P0001] this offer has not been accepted yet

  4. the attacker reads the victim's friend code:
    OUTCOME: NOT VISIBLE (0 rows)
  phantom matches against the victim: 0 []
```

Note the probe **concedes step 1** rather than stopping there: when the forged insert is refused it
plants an honest, coordinator-verified offer with the superuser so steps 2–4 are still exercised on
their own merits. A chain that "passes" because its first step failed proves nothing about the rest.

**A finding that came out of measuring rather than reading**: C1 and C2 are not two independent
holes. `confirm_offer` copies `verified_hash` into `matches.rules_hash`, which is `not null`, so the
forged match was only insertable because C1 let the attacker supply a `verified_hash` in the first
place. C1 is the step that armed C2.

---

## 2. The new error classes, and how the tests pin them

Three outcomes, two of which share SQLSTATE 42501 and one of which is not an error at all:

| Class | Shape | Produced by |
|---|---|---|
| **PRIVILEGE** | `42501 permission denied for table match_offers` — raised, before any row is considered | `revoke update ... from authenticated` |
| **POLICY** | `42501 new row violates row-level security policy for table "x"` — raised, the row failed WITH CHECK | the rewritten owner policies |
| **silent** | 0 rows affected, **nothing raised** | a USING clause excluding the row (Ruling 12) |

`rejects.toThrow()` cannot tell any of these apart, and *which one applies* is exactly what this fix
changed. So `supabase/tests/helpers.ts` gained `PRIVILEGE_DENIED`, `POLICY_DENIED` and a `refusal()`
helper that returns `{ code, message }` and **throws if the statement succeeded** — the same trap
that produced this milestone's TypeError-instead-of-AssertionError incident, closed here by design.

### The rewritten test

`supabase/tests/offers.test.ts` — `refuses a taker editing the offer's terms` had a third leg
reading *"Same row, same column, different actor: the proposer can"*. That leg was sound as an
argument and the capability it certified as healthy was step 2 of the exploit.

It is now **`refuses a taker editing the offer's terms — and the proposer too, by privilege`**, with
three legs re-aimed at what is true:

- the taker is refused, asserted `code === '42501'` **and** `message` matches PRIVILEGE — plus an
  explicit `not.toMatch(POLICY_DENIED)`, so a future migration that re-grants UPDATE and leans on
  the policy instead fails here rather than passing under a looser regex;
- the proposer, same row and same column, is refused identically — the leg that used to succeed;
- the row is provably unchanged, read past RLS.

The old shape's value — *"a different actor can, so this is denial and not a dead table"* — was not
thrown away. It moved to a new test, **`filters a stranger's DELETE to nothing without raising,
while the proposer's removes the row`**, on DELETE, the verb clients still hold and whose USING
clause is therefore still live. That test is also the proof that this suite can still **observe the
silent class**, which is what stops the two raised assertions above from degrading into "any refusal
at all".

---

## 3. The negative tests the suite never had

**`supabase/tests/queue.test.ts`** (8 → 11 tests):

- `refuses a queue entry that arrives already verified` — C1, POLICY class.
- `refuses its owner editing verified_hash onto an entry after the fact` — the other route to the
  same column, PRIVILEGE class, with `not.toMatch(POLICY_DENIED)`.
- `refuses a client truncating the whole queue, which RLS would never have seen` — via a
  `rollingBack()` helper that always rolls back and always rejects, with distinct codes for
  "refused" and "succeeded then rolled back".

**`supabase/tests/offers.test.ts`** (6 → 21 tests):

- A control first — `accepts the honest offer the cases below are each one column away from` —
  without which every refusal below could be the shared part of the statement failing.
- Eight table-driven cases, **one per server-owned column**, not one combined row: `verified_hash`,
  `accepted_by`, `accepted_team`, `accepted_at`, `confirmed_at`, and `state` in each of its four
  non-`open` values. A single combined row would still be refused if the policy named only one of
  them.
- `refuses an offer that arrives already pointing at a match` — with a **real** match created first,
  because a dangling `match_id` would be refused by the FK before the policy and prove nothing.
- `refuses an offer that arrives already accepted, and the constraint stands behind the policy`.
- `breaks the whole C2 chain: no forged acceptance, no match, no friend code` — the exploit, end to
  end, with steps 3 and 4 asserted on **the attacker's own reads**, plus a final assertion that the
  friend code is genuinely present, so the zero is a working policy and not a missing row.
- `still lets service_role write verified_hash, which is the coordinator's whole job`.

**`supabase/tests/pairing.test.ts`** (23 → 26 tests) — for the I1 migration, which shipped with no
coverage: a data-build mismatch is refused and the offer stays `open`; a null build is refused; and
the 2-argument `accept_offer` **no longer exists** (`function public.accept_offer(unknown, jsonb)
does not exist`), which is the only way to observe the migration's "drop rather than overload"
decision holding.

### A correction I had to make by measuring

I first wrote the `accepted_by` case asserting `23514` on the grounds that
`match_offers_accepted_needs_team` would refuse the row before the policy could. **The test failed
and told me otherwise**: the refusal is `42501`. RLS's WITH CHECK is evaluated *before* the table's
CHECK constraints. I verified the other half directly rather than infer it —

```
$ psql ... insert ... accepted_by (as superuser, past RLS)
ERROR:  new row for relation "match_offers" violates check constraint "match_offers_accepted_needs_team"
```

— so the test now asserts **both**, from the two sides of RLS, and that is what makes it
discriminating: drop the `accepted_by is null` conjunct and the same row stops being refused at
42501 and starts being refused at 23514, so the code assertion fails rather than the test staying
green on a different denial. Mutation M5.1 confirms exactly this.

### service_role — exercised, not asserted from the migration text

`service_role` **is** reachable through the harness (`set local role service_role`, the mechanism
`pairing.test.ts` already uses), so this is real coverage and not a caveat. Verified independently:

```
service_role | rolbypassrls = t     service_role retains UPDATE and TRUNCATE on both tables
authenticated / anon: UPDATE and TRUNCATE absent from both tables
```

The test updates `verified_hash` as `service_role` and asserts the value comes back, then asserts
the same statement is PRIVILEGE-denied for `authenticated` and `anon`, then asserts the row still
holds the service_role write — unchanged by the refusals, not merely unreported.

---

## 4. The other fixes, verified rather than assumed

**I2 (coordinator guard) — verified, and it does what I2 requires.**
`supabase/functions/coordinator/index.ts` wraps `rulesHash(r.format_versions.rules)` in try/catch
and, on failure, deletes the row and `continue`s. That is the right shape: the `pair_queue_entries`
and `sweep_expired` calls sit *after* the loop, so an unguarded throw killed the entire tick —
verification, pairing and expiry — for everyone, permanently, because the offending row keeps
`verified_hash null` and is re-read every minute. The loop covers **both** tables and `rulesHash` is
the only unguarded call in it. Round-trip check 3 exercises the delete-on-bad-hash branch against
the real Edge Function.

**I1 (client argument) — verified.** `acceptOffer` sends `p_data_rev: DATA_REV`. The existing
payload test was updated and a second added asserting it equals the real `DATA_REV` rather than
`expect.any(String)`, which would keep passing on a literal, on the offer's own rev, or on `''`.

**I3 / I4 (screen gates) — verified, and they had NO tests.** This is the one thing I found that
was not in the brief. `unconfirmableReason`'s two branches and `queueStatusText`'s expiry branch
were all live and all uncovered; the gate was green because nothing exercised them. Three tests
added, each differing from an already-passing fixture in **one field**, so the control disappearing
is the new branch and nothing else.

**`app/tools/m2a-roundtrip.ts`** — the backdate moved from alice's own write to `admin`, correctly:
that write was only ever possible *because* of the Critical. The comment says so.

---

## 5. Mutation testing — 16 mutations, 16 killed

A green suite against a correct migration says nothing about whether it would notice the migration
being wrong. Every mutation was **verified to have landed** before its suite ran (`pg_policies`
inspection, `has_table_privilege`, `pg_proc.prosrc`, or read-back from disk), per this milestone's
own finding that a mutation you have not confirmed landed is as hollow as a red you have not read.
The screen harness additionally asserts each anchor is **unique in the file** — the specific trap
that once put a mutation in `myOffers` while it was aiming at `listOpenOffers`.

| # | Mutation | Verdict |
|---|---|---|
| M1 | re-grant UPDATE on `match_offers` | KILLED (3 reds, incl. the C2 chain) |
| M2 | re-grant UPDATE on `queue_entries` | KILLED |
| M3 | re-grant TRUNCATE on `queue_entries` | KILLED |
| M4 | drop `verified_hash is null` from the queue policy | KILLED |
| M5.0–5.6 | drop each of the **seven** offer-policy conjuncts, one at a time | KILLED (7/7) |
| M6 | `accept_offer` stops comparing `data_rev` | KILLED |
| S1 | `queueStatusText` stops checking expiry | KILLED by the intended test |
| S2 | `unconfirmableReason` stops checking expiry | KILLED by the intended test |
| S3 | `unconfirmableReason` stops checking the deleted taker | KILLED by the intended test |

Every conjunct of both rewritten policies is individually load-bearing and individually pinned by a
named test. Post-run state was asserted, not assumed: UPDATE/TRUNCATE false for `authenticated` on
both tables, all seven conjuncts present, `accept_offer` comparing `data_rev`, and
`MatchmakingScreen.tsx` restored byte-for-byte (SHA-256 identical before and after).

---

## 6. The round trip, and the leftover rows

The first run **failed 7 of 14** — and the failure was not mine. The script's own guard refused to
tick:

```
REFUSING TO TICK before "liar offer": rows that are not this script's exist —
match_offers [{"id":"55555555-...","proposer_id":"11111111-..."}],
matches [{"id":"7d1c9253-...","player_a":"11111111-...","player_b":"22222222-..."}]
```

I inspected them rather than deleting them. They were `attacker@example.com` and
`victim@example.com`, friend code `1111 2222 3333`, a `converted` offer with `verified_hash =
'forged'`, and a phantom match — created at **07:16:46**, thirty seconds before the fix migrations'
own timestamps. These are the partner's own C2 confirmation run, and the phantom match the victim
cannot delete is the finding itself, still sitting there.

Since a reset was authorised and these two migrations had **never been applied from scratch**, I ran
`supabase db reset`: all 20 migrations applied cleanly from nothing (`/tmp/final-fix-reset.log`).
The re-run is **14 passed, 0 failed** — including the queue route pairing
(`{"verified":2,"paired":1}`), the live offer carrying the accepter's real roster, the scheduled
accept-then-confirm, the lapse sweep, and a closing nine-table census identical to the start.

Nothing needed loosening. The revoke does not touch any real client path, because every legitimate
mutation of an existing row here is made by a SECURITY DEFINER function or by `service_role`.

The Edge Function server was started for the run and **stopped afterwards** (verified by `pgrep`) —
a stray one once turned a 44-second gate into a 68-minute run in this repo.

---

## 7. What I could not fix or prove

1. **The `coordinator_schedule` GUC deploy question is untouched**, as instructed. It remains a live
   deploy blocker: `20260903030000` schedules a job whose URL and key come from GUCs that will be
   unset in production, `net.http_post(url := NULL)` violates a NOT NULL, and the job then raises
   every minute forever while nothing is verified. A decision for the human partner, not code.

2. **`supabase/tests/` is type-checked by nothing.** `tsc -b` covers `src`, `vite.config.ts` and
   `scripts` only, and `oxlint` runs from `app/`. The DB tests are transpiled by esbuild without
   checking. My additions are type-clean, but the gate would not have told me if they were not.
   Pre-existing; recorded because I relied on it holding and it does not.

3. **`20260904071717` is not re-runnable.** Its `drop function public.accept_offer(uuid, jsonb)`
   fails on a second application, and `create function` (not `or replace`) fails too. Correct for a
   migration, which runs once and should fail loudly on a surprise — I softened both **only in my
   mutation harness's restore path**, never in the migration. Named so nobody discovers it during an
   incident.

4. **The TRUNCATE revoke is scoped to the three M2a tables.** The same default grant is on every
   other table in `public`. The migration says so explicitly and calls it a separate decision. Still
   open.

5. **Pool validation and the board/queue re-read mechanism are untouched**, as instructed — Ruling
   22 and Ruling 25 respectively.

6. **`check:db` still leaves fixture accounts behind** (pre-existing, noted at Task 9). After the
   reset plus one full `check:db` the database holds those fixtures rather than zero rows.

7. **`accepted_by` cannot be forged at INSERT alone in a way that isolates the policy from the
   constraint** — but this turned out to be a non-problem, since RLS fires first. Both refusals are
   asserted from the two sides of RLS. Recorded because my first attempt got the ordering backwards
   and the test corrected me.
