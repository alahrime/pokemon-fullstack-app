# M2a — Matchmaking: queue, live offers, scheduled offers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two signed-in people can reach one `matches` row by three routes — a blind queue, a live offer they browse and accept, or a scheduled offer both sides confirm — and see each other's friend codes.

**Architecture:** Three entry tables converge on one terminal object. `queue_entries` is blind and paired by a scheduled coordinator; `match_offers` carries both the live-dashboard and scheduled-proposal modes and is accepted by the opponent directly under RLS. Every write that turns two rows into one match happens inside a single SQL function using `for update skip locked`, so overlapping coordinator ticks and simultaneous accepts cannot double-pair. A Supabase Edge Function on `pg_cron` does only the work SQL cannot: recomputing `rules_hash` from the stored rules with the same code the client runs, which is the one place a client's claim about its own format is checked by something it does not control.

**Tech Stack:** Postgres 17.6 + RLS, Supabase Edge Functions (Deno), pg_cron, pg_net, React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-paragon-platform-design.md` — sections 1 (decomposition, tiers), 2 (entities), 3 (security model), 4 (queues partition by `rules_hash`, three ways into a match, the shared package).

## Global Constraints

- `npm run check` (Docker-free) and `npm run check:db` (needs the local stack) are the two gates. **`check:db` is required before merging anything touching a migration or a policy.** Both must be green at the end of every task.
- **Merging to `main` deploys every migration to the production database.** Treat each migration as an outward-facing change.
- `app/src/rules/` imports no React and touches no browser API. `isolation.test.ts` and `npm run rules:node` enforce it. Anything the Edge Function shares lives there, and **`packages/rules` is deliberately NOT created in this plan** — `app/src/rules` already is that module, and a second copy is how a validator drifts from the client.
- `owner_id` / `user_id` columns default to `auth.uid()` and are never sent by the client. One place decides who owns a row.
- Every policy gets an allow test **and** a deny test. An empty table returns `[]` whether RLS is on or off; only a refused write distinguishes them.
- Piped exit codes lie: run `cmd > out.log 2>&1; echo "EXIT=$?"`, never `cmd | tail`.
- `azumarill` is not Shadow-eligible; `registeel` is. Use `registeel` in Shadow fixtures.
- Stop any dev server you start. A stray vite process once turned a 44-second gate into a 68-minute run.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/scripts/build-data.mjs` (modify) | Emit a deterministic `dataRev` into `species.json` |
| `app/src/lib/data.ts` (modify) | Export `DATA_REV` |
| `app/src/rules/hash.ts` (create) | `rulesHash(format)` — sha256 over `canonicalize`, runs in browser and Deno |
| `app/src/rules/index.ts` (modify) | Export `rulesHash` |
| `app/src/lib/saves.ts` (modify) | Store the digest in `format_versions.rules_hash` |
| `supabase/migrations/*_queue_and_matches.sql` (create) | `queue_entries`, `matches`, policies, opponent friend-code read |
| `supabase/migrations/*_match_offers.sql` (create) | `match_offers` — live and scheduled, with the handshake |
| `supabase/migrations/*_pairing_functions.sql` (create) | `pair_queue_entries()`, `accept_offer()`, `confirm_offer()`, `sweep_expired()` |
| `supabase/migrations/*_coordinator_schedule.sql` (create) | `pg_cron` + `pg_net` schedule invoking the Edge Function |
| `supabase/functions/coordinator/index.ts` (create) | Verify `rules_hash`, call the SQL functions |
| `app/src/lib/matchmaking.ts` (create) | Client data layer for queue, offers, matches |
| `app/src/screens/MatchmakingScreen.tsx` (create) | Queue control, live offer board, scheduled offers |
| `supabase/tests/queue.test.ts`, `offers.test.ts`, `pairing.test.ts` (create) | Policy and concurrency tests |

---

### Task 1: A deterministic data revision

A scheduled match agreed Tuesday and played Friday must deal the six it promised. Nothing in the repo identifies a data build today, so `matches.data_rev` would have nothing to store. The digest is over the generated payload, so an unchanged rebuild produces an unchanged rev — `species.json` is already asserted byte-identical across regenerations, and this must not break that.

**Files:**
- Modify: `app/scripts/build-data.mjs`
- Modify: `app/src/lib/data.ts`
- Test: `app/src/lib/__tests__/data.test.ts`

**Interfaces:**
- Produces: `DATA_REV: string` exported from `app/src/lib/data.ts` — 16 lowercase hex characters.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/data.test.ts — append inside the existing describe
it('exposes a data revision that identifies this build', async () => {
  const { DATA_REV } = await import('../data');
  expect(DATA_REV).toMatch(/^[0-9a-f]{16}$/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && ./node_modules/.bin/vitest run src/lib/__tests__/data.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `DATA_REV` is undefined, so the regex match throws.

- [ ] **Step 3: Emit the rev from the data build**

In `app/scripts/build-data.mjs`, after the output object is assembled and immediately before it is written, add:

```js
import { createHash } from 'node:crypto';

// A stable identity for this data build. Taken over the payload with the key
// order the writer already fixes, so regenerating unchanged inputs yields the
// same rev — `verify-data` asserts species.json is byte-identical across
// rebuilds and this must not be what breaks it.
const payload = JSON.stringify({ moves: out.moves, species: out.species });
out.dataRev = createHash('sha256').update(payload).digest('hex').slice(0, 16);
```

- [ ] **Step 4: Export it**

In `app/src/lib/data.ts`, beside the other top-level exports derived from the JSON:

`app/src/lib/data.ts` already wraps the parsed JSON in `artefact<{moves, species}>(speciesRaw, 'species.json', ['moves','species'], 'npm run data')`, a guard whose stated purpose is turning "the compiler saw a typed field and the screen got `undefined`" into a loud named failure at import. Extend that call rather than casting past it — add `dataRev: string` to the type parameter **and** to the required-keys list, then:

```ts
/**
 * Identifies the generated data this build carries.
 *
 * Matches and scheduled offers pin it: a random draw agreed on Tuesday and
 * played on Friday must deal the same six, and the only way to notice that the
 * data moved underneath it is to have recorded which data it was.
 */
export const DATA_REV: string = raw.dataRev;
```

A `?? 'unknown'` fallback would defeat the point: this value exists so staleness is *noticed*, and a silent default is staleness going unnoticed.

- [ ] **Step 5: Regenerate and verify determinism**

Run: `cd app && node scripts/build-data.mjs > /tmp/data.log 2>&1; echo "EXIT=$?" && git diff --stat src/data/species.json`
Expected: EXIT=0, and `species.json` shows the added `dataRev` key only.

**`build-data.mjs` alone, NOT `npm run data`.** That script is the first stage of a chain — `build-data → best-spreads → matrix → teams → summary` — whose later stages take upwards of half an hour (`teams` alone burned 108 minutes of CPU when this was measured). None of them writes `dataRev`, and none is affected by a new key in `species.json`, so running them proves nothing about the hash and costs the whole afternoon.

Then run `node scripts/build-data.mjs` a SECOND time and confirm `git diff --stat src/data/species.json` reports no change — that is the determinism assertion, and a differing rev between two runs means the hash input is unstable. Fix that rather than working around it: an unstable rev poisons every `data_rev` value downstream.

- [ ] **Step 6: Run the test and the gate**

Run: `cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0.

- [ ] **Step 7: Commit**

```bash
git add app/scripts/build-data.mjs app/src/lib/data.ts app/src/lib/__tests__/data.test.ts app/src/data/species.json
git commit -m "feat(data): a deterministic revision identifying this data build"
```

---

### Task 2: `rules_hash` becomes an actual hash

`canonicalize()` returns the whole canonical string and `rules_hash` stores it verbatim. That was fine while nothing read the column. M2a indexes and partitions queues on it, which is the moment a 32-byte digest stops being cosmetic — and changing it later means rewriting stored values underneath a live queue.

Web Crypto's `crypto.subtle` exists in browsers and in Deno, which is why the digest lives here rather than in a Node-only helper: the Edge Function must compute it with this exact code.

**Files:**
- Create: `app/src/rules/hash.ts`
- Modify: `app/src/rules/index.ts`
- Modify: `app/src/lib/saves.ts:~150` (the `format_versions` insert)
- Test: `app/src/rules/__tests__/hash.test.ts`

**Interfaces:**
- Produces: `rulesHash(format: Format): Promise<string>` — 64 lowercase hex characters. Async because `crypto.subtle.digest` is.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/rules/__tests__/hash.test.ts
import { describe, it, expect } from 'vitest';
import { RULES_SCHEMA, type Format } from '../index';
import { rulesHash } from '../hash';

const base: Format = {
  schema: RULES_SCHEMA, base: 'great', start: 'empty', pool: [],
  composition: { size: 3, uniqueSpecies: true }, selection: { mode: 'open' },
};

describe('rulesHash', () => {
  it('is 64 hex characters', async () => {
    expect(await rulesHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agrees for two independently authored identical formats', async () => {
    // The whole point of partitioning queues by hash rather than by
    // format_version_id: two people who wrote the same rules must meet.
    const twin: Format = { ...base, composition: { ...base.composition } };
    expect(await rulesHash(twin)).toBe(await rulesHash(base));
  });

  it('differs when a rule differs', async () => {
    const bigger: Format = { ...base, composition: { ...base.composition, size: 6 } };
    expect(await rulesHash(bigger)).not.toBe(await rulesHash(base));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && ./node_modules/.bin/vitest run src/rules/__tests__/hash.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — cannot resolve `../hash`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/rules/hash.ts
import { canonicalize } from './canonical';
import type { Format } from './types';

/**
 * The queue identity of a format.
 *
 * `canonicalize` decides what "the same rules" means — key order irrelevant,
 * notes irrelevant, clause order significant. This only compresses that string
 * into something worth indexing.
 *
 * `crypto.subtle` rather than a Node import on purpose: this exact function
 * runs in the browser AND in the Edge Function that recomputes the hash it
 * refuses to take on trust. Two implementations would be two answers.
 */
export async function rulesHash(format: Format): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(format));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Export it and use it at the write site**

Add to `app/src/rules/index.ts`:

```ts
export { rulesHash } from './hash';
```

In `app/src/lib/saves.ts`, change the `format_versions` insert to await the digest. The import line becomes `import { canonicalize, rulesHash, type Format } from '../rules';` and the insert becomes:

```ts
  const { error } = await supabase.from('format_versions').insert({
    format_id: id,
    version: next,
    rules: f.format,
    rules_hash: await rulesHash(f.format),
  });
```

`canonicalize` stays imported — it remains the definition of format identity and is what the hash is taken over.

- [ ] **Step 5: Run the tests**

Run: `cd app && ./node_modules/.bin/vitest run src/rules src/lib/__tests__/saves.test.ts > /tmp/green.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0. If `saves.test.ts` asserted the old string value, update that assertion to a 64-hex regex — the stored value genuinely changed.

- [ ] **Step 6: Confirm the module still runs outside a browser**

Run: `cd app && npm run rules:node > /tmp/rules.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0. This is the check that matters — if `crypto.subtle` were unavailable under Node this is where it surfaces, not in production.

- [ ] **Step 7: Run the gate and commit**

```bash
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
git add app/src/rules/hash.ts app/src/rules/index.ts app/src/rules/__tests__/hash.test.ts app/src/lib/saves.ts app/src/lib/__tests__/saves.test.ts
git commit -m "feat(rules): rules_hash is a sha256, now that a queue partitions on it"
```

**Note for the reviewer:** existing `format_versions` rows keep the old canonical-string value. Production holds none. A local stack is rebuilt with `npm run db:reset`.

---

### Task 3: `queue_entries` and `matches`

The blind queue and the terminal object both entry modes converge on. `matches` is the first table in this schema **no client may write at all** — pairing is the coordinator's alone — so its deny tests are the point rather than a formality.

**Files:**
- Create: `supabase/migrations/<timestamp>_queue_and_matches.sql` — generate `<timestamp>` as `date -u +%Y%m%d%H%M%S`; it must sort after `20260902163500`
- Create: `supabase/tests/queue.test.ts`

**Interfaces:**
- Produces: tables `public.queue_entries` and `public.matches` with the columns below; later tasks read `queue_entries.verified_hash` and insert into `matches` from `security definer` functions only.

- [ ] **Step 1: Write the failing policy tests**

```ts
// supabase/tests/queue.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('queue and match policies', () => {
  const userA = randomUUID();
  const userB = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(userA, `QA_${userA.slice(0, 8)}`);
    await makeUser(userB, `QB_${userB.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${userA}', 'Queue Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a in ('${userA}','${userB}') or player_b in ('${userA}','${userB}')`);
    await sql(`delete from public.queue_entries where user_id in ('${userA}','${userB}')`);
  });

  const enqueue = (owner: string) =>
    asUser({ sub: owner })<{ id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning id`,
    );

  it('lets someone join the queue without naming themselves', async () => {
    const rows = await asUser({ sub: userA })<{ user_id: string }>(
      `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
       values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning user_id`,
    );
    expect(rows[0].user_id).toBe(userA);
  });

  it('refuses a queue entry made on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: userB })(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, team, data_rev)
         values ('${userA}', 'great', '${versionId}', 'aa', '[]'::jsonb, 'rev1')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides a queue entry from everyone but its owner', async () => {
    await enqueue(userA);
    expect(await asUser({ sub: userB })(`select id from public.queue_entries`)).toHaveLength(0);
    expect(await asAnon()(`select id from public.queue_entries`)).toHaveLength(0);
  });

  it('allows only one queue entry per person', async () => {
    await enqueue(userA);
    await expect(enqueue(userA)).rejects.toThrow(/queue_entries_one_per_user/);
  });

  it('lets a player see a match they are in, and nobody else see it', async () => {
    const [m] = await sql<{ id: string }>(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-1','queue') returning id`,
    );
    expect(await asUser({ sub: userA })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(1);
    const stranger = randomUUID();
    await makeUser(stranger, `QS_${stranger.slice(0, 8)}`);
    expect(await asUser({ sub: stranger })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(0);
  });

  /** The reason this table exists as coordinator-only. */
  it('refuses a match inserted by a player, even one they are in', async () => {
    await expect(
      asUser({ sub: userA })(
        `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
         values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-2','queue')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('reveals an opponent\'s friend code, and only to an opponent', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')`);
    const stranger = randomUUID();
    await makeUser(stranger, `QT_${stranger.slice(0, 8)}`);
    // Before any match: invisible.
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-3','queue')`);
    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
    expect(await asUser({ sub: stranger })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.queue_entries" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/<timestamp>_queue_and_matches.sql

-- Someone waiting to be matched, blind: no opponent chosen, no format browsed.
create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  league text not null,
  format_version_id uuid not null references public.format_versions (id) on delete cascade,
  -- What the CLIENT says this format hashes to. Never trusted: the coordinator
  -- recomputes it from format_versions.rules and writes verified_hash, and only
  -- verified entries are eligible to pair. A client that lies lands in no queue
  -- rather than in a stranger's.
  claimed_hash text not null,
  verified_hash text,
  -- The roster as saved, not a pointer to `teams`: editing a team afterwards
  -- must not change what was queued with.
  team jsonb not null,
  data_rev text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

-- One at a time. Two entries for one person can be paired with each other by a
-- coordinator that only checks "different rows", and a self-match is a bug that
-- looks like a feature until someone reports their own friend code back to them.
create unique index queue_entries_one_per_user on public.queue_entries (user_id);
-- The pairing scan reads exactly this.
create index queue_entries_pairing_idx on public.queue_entries (verified_hash, league, created_at)
  where verified_hash is not null;

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  player_a uuid not null references public.profiles (id) on delete cascade,
  player_b uuid not null references public.profiles (id) on delete cascade,
  -- RESTRICT, deliberately, not CASCADE. format_versions are immutable so that
  -- a match's terms stay readable for years; letting a delete cascade through
  -- here would make that guarantee hold everywhere except where it matters.
  format_version_id uuid not null references public.format_versions (id) on delete restrict,
  -- The VERIFIED hash, copied from the entries that produced this row.
  rules_hash text not null,
  team_a jsonb not null,
  team_b jsonb not null,
  data_rev text not null,
  seed text not null,
  rounds smallint not null default 3,
  state text not null default 'paired',
  source text not null,
  created_at timestamptz not null default now(),
  constraint matches_distinct_players check (player_a <> player_b),
  constraint matches_rounds check (rounds in (3, 5)),
  constraint matches_source check (source in ('queue', 'offer')),
  constraint matches_state check (state in ('paired', 'abandoned'))
);

create index matches_player_a_idx on public.matches (player_a);
create index matches_player_b_idx on public.matches (player_b);

alter table public.queue_entries enable row level security;
alter table public.matches enable row level security;

create policy "a queue entry is its owner's"
  on public.queue_entries for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- SELECT only, and only for the two people in it. There is deliberately no
-- insert, update or delete policy: a match is created by the pairing functions
-- running as the table owner, so every client write is refused by default-deny
-- rather than by a rule somebody could loosen.
create policy "a match is visible to the two people in it"
  on public.matches for select
  to authenticated
  using ((select auth.uid()) in (player_a, player_b));

-- The one widening in this migration. A friend code was owner-only, because it
-- is the handle someone is contacted by. An opponent gets it for the duration
-- of a match and by no other route.
create policy "an opponent may read your friend code while you have a match"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.state = 'paired'
        and ((m.player_a = friend_codes.profile_id and m.player_b = (select auth.uid()))
          or (m.player_b = friend_codes.profile_id and m.player_a = (select auth.uid())))
    )
  );
```

- [ ] **Step 4: Apply and re-run**

Run: `cd app && ./node_modules/.bin/supabase db reset --workdir .. > /tmp/reset.log 2>&1; echo "EXIT=$?" && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"`
Expected: both EXIT=0, all tests in `queue.test.ts` passing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/queue.test.ts
git commit -m "feat(db): a blind queue, and matches no client may write"
```

---

### Task 4: `match_offers` — the live board and the scheduled proposal

Both non-blind modes. They share a table because they are the same object seen at two distances: a proposal with terms an opponent reviews before agreeing. What separates them is `scheduled_for` and the second confirmation.

An offer marked `public` is readable by strangers — the first such row outside `formats`. Copy that pattern; it is already tested.

**Files:**
- Create: `supabase/migrations/<timestamp>_match_offers.sql`
- Create: `supabase/tests/offers.test.ts`

**Interfaces:**
- Produces: `public.match_offers`, states `open → accepted → confirmed | lapsed | converted`.

- [ ] **Step 1: Write the failing policy tests**

```ts
// supabase/tests/offers.test.ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('match offer policies', () => {
  const proposer = randomUUID();
  const taker = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
    await makeUser(taker, `OT_${taker.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
  });

  const offer = (visibility: string, scheduled = 'null') =>
    asUser({ sub: proposer })<{ id: string }>(
      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`);

  it('shows a public offer to any signed-in stranger', async () => {
    const [o] = await offer('public');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('hides a public offer from someone not signed in', async () => {
    const [o] = await offer('public');
    expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
  });

  it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
    const [o] = await offer('unlisted');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('refuses an offer proposed on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: taker })(
        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
         values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
    ).rejects.toThrow(/row-level security/);
  });

  /** A taker may accept. A taker may NOT rewrite the terms they are accepting. */
  it('refuses a taker editing the offer\'s terms', async () => {
    const [o] = await offer('public');
    await expect(
      asUser({ sub: taker })(`update public.match_offers set league = 'master' where id = '${o.id}'`),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  it('refuses a scheduled offer in the past', async () => {
    await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `relation "public.match_offers" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/<timestamp>_match_offers.sql

-- A proposition, not a queue entry. The difference that earns a separate table
-- is review: an opponent reads the format before agreeing, which a blind queue
-- by definition does not allow.
create table public.match_offers (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  format_version_id uuid not null references public.format_versions (id) on delete restrict,
  claimed_hash text not null,
  verified_hash text,
  league text not null,
  team jsonb not null,
  data_rev text not null,
  visibility public.format_visibility not null default 'public',
  -- Null for the live board: playable now. Set for a proposal at a stated time.
  scheduled_for timestamptz,
  -- The handshake window. Both sides must be inside it, and an offer that
  -- reaches it unconfirmed LAPSES rather than converting — a scheduled battle
  -- on the board is one both people committed to, not one somebody was
  -- nominated for.
  expires_at timestamptz not null default now() + interval '1 hour',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  match_id uuid references public.matches (id) on delete set null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  constraint match_offers_state check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted')),
  constraint match_offers_not_self check (accepted_by is null or accepted_by <> proposer_id),
  constraint match_offers_scheduled_future check (scheduled_for is null or scheduled_for > created_at)
);

create index match_offers_open_idx on public.match_offers (visibility, league, created_at)
  where state = 'open';
create index match_offers_expiry_idx on public.match_offers (expires_at) where state in ('open', 'accepted');

alter table public.match_offers enable row level security;

create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check ((select auth.uid()) = proposer_id);

-- Same shape as "a public format is readable by anyone signed in", which is
-- the precedent this copies rather than invents.
create policy "a public offer is readable by anyone signed in"
  on public.match_offers for select
  to authenticated
  using (visibility = 'public' or (select auth.uid()) = accepted_by);

-- Accepting is done through accept_offer(), not by a client UPDATE. There is
-- deliberately no update policy for a taker: letting them write this row is
-- letting them edit the terms they are agreeing to, and no WITH CHECK
-- expressible here can say "you may set accepted_by and nothing else".
```

- [ ] **Step 4: Apply, re-run, commit**

```bash
cd app && ./node_modules/.bin/supabase db reset --workdir .. > /tmp/reset.log 2>&1; echo "EXIT=$?"
cd app && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"
git add supabase/migrations supabase/tests/offers.test.ts
git commit -m "feat(db): offers you can browse, and offers you schedule"
```

---

### Task 5: The pairing functions, and the races they exist to lose safely

Every write that turns two rows into one match happens here, in one transaction, as the table owner. Two coordinator ticks overlapping, or two people accepting the same offer in the same second, are the two races this milestone has — and both are settled by the database rather than by a client's optimism.

**Files:**
- Create: `supabase/migrations/<timestamp>_pairing_functions.sql`
- Create: `supabase/tests/pairing.test.ts`

**Interfaces:**
- Produces: `pair_queue_entries() → integer`, `accept_offer(uuid) → uuid`, `confirm_offer(uuid) → uuid`, `sweep_expired() → integer`.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/tests/pairing.test.ts
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser } from './helpers';

describe('pairing', () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`);
  }

  beforeAll(async () => {
    for (const [id, n] of [[a, 'PA'], [b, 'PB'], [c, 'PC']] as const) await makeUser(id, `${n}_${id.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${a}', 'Pair Cup') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cc') returning id`);
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.match_offers`);
    await sql(`delete from public.matches`);
    await sql(`delete from public.queue_entries`);
  });

  const enqueue = (user: string, hash: string | null = 'cc') =>
    sql(`insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('${user}', 'great', '${versionId}', 'cc', ${hash === null ? 'null' : `'${hash}'`}, '[]'::jsonb, 'rev1')`);

  it('pairs two verified entries sharing a hash, and consumes them', async () => {
    await enqueue(a); await enqueue(b);
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(1);
    expect(await sql(`select id from public.matches`)).toHaveLength(1);
    expect(await sql(`select id from public.queue_entries`)).toHaveLength(0);
  });

  it('leaves an unverified entry alone — the trust boundary', async () => {
    await enqueue(a); await enqueue(b, null);
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(0);
    expect(await sql(`select id from public.queue_entries`)).toHaveLength(2);
  });

  it('does not pair entries whose hashes differ', async () => {
    await enqueue(a); await enqueue(b, 'dd');
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(0);
  });

  it('leaves the odd one out queued when three are waiting', async () => {
    await enqueue(a); await enqueue(b); await enqueue(c);
    const [{ pair_queue_entries: n }] = await sql<{ pair_queue_entries: number }>(`select public.pair_queue_entries()`);
    expect(n).toBe(1);
    expect(await sql(`select id from public.queue_entries`)).toHaveLength(1);
  });

  /**
   * The race. Two independent connections accept the same offer at the same
   * moment. One must win and one must be told no — and crucially there must be
   * exactly ONE match, not two. Counting rejections is not enough: a rejection
   * for the wrong reason counts the same, which is how a false pass gets
   * recorded.
   */
  it('lets only one of two simultaneous accepts through', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility)
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '[]'::jsonb, 'rev1', 'public') returning id`);
    const conn = () => postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
    const [c1, c2] = [conn(), conn()];
    const accept = (client: ReturnType<typeof conn>, who: string) =>
      client.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
        return tx.unsafe(`select public.accept_offer('${o.id}')`);
      });
    const results = await Promise.allSettled([accept(c1, b), accept(c2, c)]);
    await Promise.all([c1.end(), c2.end()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(refused.reason?.message)).toMatch(/no longer open/);
    expect(await sql(`select id from public.matches`)).toHaveLength(1);
  });

  it('holds a scheduled offer until the proposer confirms it too', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '[]'::jsonb, 'rev1', 'public', now() + interval '2 days') returning id`);
    await asUser({ sub: b })(`select public.accept_offer('${o.id}')`);
    // One-sided acceptance is not a match.
    expect(await sql(`select id from public.matches`)).toHaveLength(0);
    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([{ state: 'accepted' }]);
    await asUser({ sub: a })(`select public.confirm_offer('${o.id}')`);
    expect(await sql(`select id from public.matches`)).toHaveLength(1);
  });

  it('lapses an unconfirmed offer rather than converting it', async () => {
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility, expires_at)
       values ('${a}', '${versionId}', 'cc', 'cc', 'great', '[]'::jsonb, 'rev1', 'public', now() - interval '1 minute') returning id`);
    await sql(`select public.sweep_expired()`);
    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([{ state: 'lapsed' }]);
    expect(await sql(`select id from public.matches`)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd app && npm run check:db > /tmp/db-red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `function public.pair_queue_entries() does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/<timestamp>_pairing_functions.sql

-- Pair everything pairable, in one transaction, as the table owner.
--
-- `for update skip locked` is the whole mechanism. Two coordinator ticks
-- overlapping is not hypothetical — a tick that runs long while the next fires
-- is the normal failure of any timer — and without SKIP LOCKED the second tick
-- reads rows the first is about to consume and pairs them a second time. With
-- it, the second tick simply does not see them. This is the same class of bug
-- as M1b's duplicate formats, where two overlapping runs each did the work.
create function public.pair_queue_entries() returns integer
language plpgsql security definer set search_path = public as $$
declare
  pending public.queue_entries;
  cur public.queue_entries;
  paired integer := 0;
begin
  for cur in
    select * from public.queue_entries
     where verified_hash is not null and expires_at > now()
     order by verified_hash, league, data_rev, created_at
     for update skip locked
  loop
    if pending.id is not null
       and pending.verified_hash = cur.verified_hash
       and pending.league = cur.league
       -- Same data build, deliberately. A random draw both sides compute must
       -- deal from the same pool; two clients on different data would agree on
       -- the rules and disagree on what satisfies them.
       and pending.data_rev = cur.data_rev
       and pending.user_id <> cur.user_id then
      insert into public.matches
        (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
      values
        (pending.user_id, cur.user_id, pending.format_version_id, pending.verified_hash,
         pending.team, cur.team, pending.data_rev, gen_random_uuid()::text, 'queue');
      delete from public.queue_entries where id in (pending.id, cur.id);
      paired := paired + 1;
      pending := null;
    else
      pending := cur;
    end if;
  end loop;
  return paired;
end;
$$;

-- Accepting is a function, not an UPDATE, for two reasons: the row must be
-- locked while its state is checked, and a taker permitted to write this row is
-- a taker permitted to edit the terms they are agreeing to.
create function public.accept_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  taker uuid := (select auth.uid());
  new_match uuid;
begin
  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
  -- told the offer is taken. Skipping would tell it "no such offer", which is a
  -- different and misleading answer.
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
  if o.verified_hash is null then raise exception 'this offer has not been verified yet'; end if;
  if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;

  if o.scheduled_for is null then
    -- Live: agreeing is playing. One confirmation is the whole handshake.
    insert into public.matches
      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
    values
      (o.proposer_id, taker, o.format_version_id, o.verified_hash, o.team, '[]'::jsonb,
       o.data_rev, gen_random_uuid()::text, 'offer')
    returning id into new_match;
    update public.match_offers
       set state = 'converted', accepted_by = taker, accepted_at = now(),
           confirmed_at = now(), match_id = new_match
     where id = p_offer;
    return new_match;
  end if;

  -- Scheduled: one-sided acceptance is not a match. The proposer must confirm
  -- inside the window or this lapses.
  update public.match_offers
     set state = 'accepted', accepted_by = taker, accepted_at = now()
   where id = p_offer;
  return null;
end;
$$;

create function public.confirm_offer(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.match_offers;
  me uuid := (select auth.uid());
  new_match uuid;
begin
  select * into o from public.match_offers where id = p_offer for update;
  if not found then raise exception 'no such offer'; end if;
  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;

  insert into public.matches
    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
  values
    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, '[]'::jsonb,
     o.data_rev, gen_random_uuid()::text, 'offer')
  returning id into new_match;
  update public.match_offers
     set state = 'converted', confirmed_at = now(), match_id = new_match
   where id = p_offer;
  return new_match;
end;
$$;

-- Expiry is a sweep, not a trigger: nothing touches a stale row to fire a
-- trigger on. An offer past its window LAPSES — it does not quietly convert,
-- because the calendar has to mean something.
create function public.sweep_expired() returns integer
language plpgsql security definer set search_path = public as $$
declare swept integer := 0;
begin
  delete from public.queue_entries where expires_at <= now();
  get diagnostics swept = row_count;
  update public.match_offers set state = 'lapsed'
   where state in ('open', 'accepted') and expires_at <= now();
  return swept;
end;
$$;

revoke all on function public.pair_queue_entries() from public, anon, authenticated;
revoke all on function public.sweep_expired() from public, anon, authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.confirm_offer(uuid) to authenticated;
```

- [ ] **Step 4: Apply, re-run, commit**

```bash
cd app && ./node_modules/.bin/supabase db reset --workdir .. > /tmp/reset.log 2>&1; echo "EXIT=$?"
cd app && npm run check:db > /tmp/db-green.log 2>&1; echo "EXIT=$?"
git add supabase/migrations supabase/tests/pairing.test.ts
git commit -m "feat(db): pairing, accepting and lapsing, with the races settled in SQL"
```

---

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

### Task 7: The client data layer

One module, mirroring `lib/saves.ts` in shape and in its rule: `user_id` is never sent, the database default decides it.

**Files:**
- Create: `app/src/lib/matchmaking.ts`
- Test: `app/src/lib/__tests__/matchmaking.test.ts`

**Interfaces:**
- Consumes: `rulesHash` (Task 2), `DATA_REV` (Task 1), `StoredMember` from `lib/teamCodec`.
- Produces, all used by Task 8. Define these three at the top of the module — Task 8 destructures them, so the field names are load-bearing:

```ts
export interface QueueEntry {
  id: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null until the coordinator has recomputed the hash. Render as "checking…". */
  verifiedHash: string | null;
  expiresAt: string;
}

export interface Match {
  id: string;
  opponentId: string;
  formatVersionId: string;
  rulesHash: string;
  dataRev: string;
  rounds: number;
  source: 'queue' | 'offer';
  createdAt: string;
}

export interface Offer {
  id: string;
  proposerId: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null for the live board; a timestamp for a scheduled proposal. */
  scheduledFor: string | null;
  expiresAt: string;
  state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
  acceptedBy: string | null;
}
```

  - `joinQueue(a: { league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[] }): Promise<string>`
  - `leaveQueue(): Promise<void>`
  - `myQueueEntry(): Promise<QueueEntry | null>`
  - `myMatches(): Promise<Match[]>`
  - `listOpenOffers(league: LeagueId): Promise<Offer[]>`
  - `createOffer(a: { league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[]; scheduledFor?: Date }): Promise<string>`
  - `acceptOffer(id: string): Promise<string | null>`
  - `confirmOffer(id: string): Promise<string>`
  - `opponentFriendCode(profileId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

Copy the `harness(rows, errors)` helper from `app/src/lib/__tests__/saves.test.ts` — including the `errors` parameter added when `saveTeam` learned to name a duplicate roster. Then:

```ts
// app/src/lib/__tests__/matchmaking.test.ts
it('never sends user_id — the database default decides who owns the entry', async () => {
  const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
  const { joinQueue } = await import('../matchmaking');
  await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
  const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
  expect(Object.keys(insert.payload as object)).not.toContain('user_id');
});

it('sends the hash it computed, not one it was handed', async () => {
  const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
  const { joinQueue } = await import('../matchmaking');
  const { rulesHash } = await import('../../rules');
  await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
  const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
  expect((insert.payload as { claimed_hash: string }).claimed_hash).toBe(await rulesHash(FORMAT));
});

it('accepts an offer through the function, never by writing the row', async () => {
  const { calls } = harness({});
  const { acceptOffer } = await import('../matchmaking');
  await acceptOffer('o1');
  expect(calls.some((c) => c.table === 'match_offers' && c.op === 'update')).toBe(false);
  // accept_offer holds the row lock while it checks state; an UPDATE from here
  // would race a second taker and could edit the terms being agreed to.
});

it('refuses to schedule an offer in the past before the database has to', async () => {
  harness({});
  const { createOffer } = await import('../matchmaking');
  await expect(createOffer({
    league: 'great', formatVersionId: 'v1', format: FORMAT, team: [],
    scheduledFor: new Date(Date.now() - 60_000),
  })).rejects.toThrow(/in the past/);
});
```

Add the `rpc` recorder to the copied harness so the third test can observe it:

```ts
pkg.client = {
  from: vi.fn((n: string) => table(n)),
  rpc: vi.fn(async (fn: string, args?: unknown) => {
    calls.push({ table: 'rpc', op: fn, payload: args });
    return { data: 'm1', error: null };
  }),
};
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd app && ./node_modules/.bin/vitest run src/lib/__tests__/matchmaking.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — cannot resolve `../matchmaking`.

- [ ] **Step 3: Write the module**

Follow `lib/saves.ts` exactly for error handling (`throw new Error(error.message)`), for never sending the owner column, and for typing the PostgREST rows at the boundary. `joinQueue` computes `claimed_hash` with `await rulesHash(format)` and sends `data_rev: DATA_REV`. `acceptOffer` and `confirmOffer` call `supabase.rpc('accept_offer', { p_offer: id })` / `rpc('confirm_offer', …)` and return `data as string | null`. `createOffer` throws `new Error('a scheduled offer cannot be in the past')` before any network call when `scheduledFor <= new Date()`.

- [ ] **Step 4: Run the tests, run the gate, commit**

```bash
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
git add app/src/lib/matchmaking.ts app/src/lib/__tests__/matchmaking.test.ts
git commit -m "feat(matchmaking): the client data layer for queue, offers and matches"
```

---

### Task 8: The Matchmaking screen

Three panels on one screen, because they are three answers to one question. Signed out, the screen says so and offers nothing — the same shape `TeamBuilderScreen` uses for its save panel.

**Files:**
- Create: `app/src/screens/MatchmakingScreen.tsx`
- Modify: `app/src/lib/screens.ts` (add the `SCREEN_DEFS` entry)
- Modify: `app/src/App.tsx` (add the `case 'matchmaking'`)
- Test: `app/src/screens/__tests__/matchmaking.test.tsx`

**Interfaces:**
- Consumes: everything Task 7 produces, `useSession()`, `LEAGUE_BY_ID`.

- [ ] **Step 1: Write the failing tests**

Mock `../../lib/matchmaking` at the module boundary exactly as `team-saves.test.tsx` mocks `../../lib/saves`, and reuse its `mount()` harness (`vi.resetModules()` then dynamic imports, so the Supabase client mock is in place before `lib/supabase` is imported). Cover:

```ts
it('offers nothing to sign in with when signed out', async () => {
  const { container } = await mount(null);
  expect(container.querySelector('.queue-join')).toBeFalsy();
  expect(container.textContent).toMatch(/sign in/i);
});

it('joins the queue with the roster and format on screen', async () => { /* click, assert joinQueue arg */ });

it('shows the opponent\'s friend code once a match exists', async () => { /* listed match → code rendered */ });

it('asks before leaving a queue it is already in', async () => { /* confirm idiom, as deleteSaved uses */ });

it('disables accept on an offer the signed-in person proposed', async () => {
  // The database refuses it too (match_offers_not_self), but a control that
  // can only fail is a control that should not be offered.
});

it('shows a scheduled offer awaiting confirmation as awaiting, not as a match', async () => {
  // accept_offer returns null for a scheduled offer. Rendering that as
  // "matched" would put a battle on the calendar nobody confirmed.
});
```

- [ ] **Step 2: Run and watch them fail** — `cd app && ./node_modules/.bin/vitest run src/screens/__tests__/matchmaking.test.tsx > /tmp/red.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 3: Build the screen**

Use the existing design language rather than new CSS: `.hud-label` for the micro-labels, `.chip-btn`/`.seg-btn` for the view controls, `.move-picker-panel` for the offer list, `btn btn-primary` for the primary action. **Overlay, do not expand** — the offer board must not shove the panels below it down the page as offers arrive. Never assert layout in jsdom; it applies no stylesheet.

- [ ] **Step 4: Register the screen**

In `app/src/lib/screens.ts`, add to `SCREEN_DEFS`:

```ts
  {
    id: 'matchmaking',
    label: 'Matches',
    kicker: 'Opponents',
    glyph: '⚔',
    hue: 'var(--type-fighting)',
    blurb: 'Queue for a blind match, browse an open offer, or schedule one for later.',
  },
```

In `app/src/App.tsx`, beside the other cases:

```tsx
    case 'matchmaking':
      return <LazyScreen key="matchmaking"><MatchmakingScreen /></LazyScreen>;
```

- [ ] **Step 5: Run the gate and commit**

```bash
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
git add app/src/screens/MatchmakingScreen.tsx app/src/screens/__tests__/matchmaking.test.tsx app/src/lib/screens.ts app/src/App.tsx
git commit -m "feat(matchmaking): queue, the open board, and scheduled proposals"
```

---

### Task 9: Two humans, one match, against real Postgres

Every test above either mocks the client or drives SQL directly. Neither can see what M1b's duplicate-formats bug taught this repo: a green suite is not evidence about a system nobody ran. This task runs the real modules against the real database as two real confirmed accounts.

**Files:**
- Create: `app/tools/m2a-roundtrip.ts` (kept, unlike the throwaway scripts — it is the only end-to-end proof of this milestone)

- [ ] **Step 1: Write the script**

Model it on the M1b round trips: bundle through esbuild with `--define:import.meta.env={…}`, sign up two accounts, confirm each by pulling the link out of Mailpit's API at `http://127.0.0.1:54324` (the real confirmation path, so `handle_confirmed_user()` makes the profiles the foreign keys need), then:

1. **Wait for each token to be accepted** before doing anything else — poll a trivial authenticated select until it returns without error. PostgREST's container clock can put a fresh JWT "issued at future", and that rejection is indistinguishable from a refused write unless you gate on it. This exact confound produced a false pass during M1b.
2. Both accounts `joinQueue` on the same format. Assert **no match yet** — nothing is paired until the coordinator has verified the hashes.
3. Invoke the coordinator once. Assert `verified: 2, paired: 1`, exactly one `matches` row, and that **both** players can read it while a third account cannot.
4. Assert each player can now read the other's friend code, and the third account cannot.
5. A third account joins with a deliberately wrong `claimed_hash`. Tick. Assert its entry was **deleted** and no match was made.
6. Create a live offer, accept it from the other account, assert a match exists immediately.
7. Create a scheduled offer, accept it, assert **no match**, confirm it as the proposer, assert a match. Then create one with `expires_at` in the past, tick, assert `lapsed` and still no match.
8. Delete every row it created.

- [ ] **Step 2: Run it**

```bash
cd app && ./node_modules/.bin/esbuild tools/m2a-roundtrip.ts --bundle --platform=node --format=esm \
  --outfile=node_modules/.cache/m2a.mjs --log-level=warning \
  --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"<the sb_publishable_ key npm run db:start prints>"}' > /tmp/build.log 2>&1; echo "EXIT=$?"
node node_modules/.cache/m2a.mjs > /tmp/m2a.log 2>&1; echo "EXIT=$?"; cat /tmp/m2a.log
```

Expected: every check PASS, exit 0. **A check that passes for the wrong reason is worse than a failure** — assert on the message or the row, never merely on "something was refused".

- [ ] **Step 3: Commit, and stop the stack**

```bash
git add app/tools/m2a-roundtrip.ts
git commit -m "test(m2a): two accounts, three routes into a match, against real Postgres"
cd app && npm run db:stop
```

---

## Definition of done

- `npm run check` and `npm run check:db` both exit 0.
- Task 9's round trip passes every check against a real local stack.
- The deploy note is understood: this plan adds **four migrations**, and merging to `main` applies them to the production database. Before pushing, re-read the deploy section of `docs/superpowers/HANDOFF.md`.

## Deliberately not in M2a

Result reporting, adjudication, the dispute and evidence ladder, the match channel and Realtime presence, rating and seasons, direct friend challenges (M3), and the moderation report button. The spec places the report button in M2 "the moment two strangers can type at each other" — M2a gives them no way to type at each other, so it arrives with the match channel in M2b and must not be forgotten there.

## Known gaps this plan accepts

- **`data_rev` is recorded and matched on, not enforced.** Two clients on different data builds will not pair, and a match stores the rev it was made under. Nothing yet *replays* an older data build, so a scheduled match played after a data change can detect the drift but not undo it. Full pinning needs versioned data and belongs with the random draw.
- **Unlisted offers cannot be accepted.** `accept_offer` requires `public`, because RLS hides unlisted rows from the taker and a share-link flow is its own design.
- **The local `pg_cron` → Edge Function hop is the riskiest step here.** If `net.http_post` cannot reach the edge runtime from the database container, fall back to invoking the coordinator by hand in tests and schedule it on the hosted project only — but say so plainly rather than marking Task 6 done.
