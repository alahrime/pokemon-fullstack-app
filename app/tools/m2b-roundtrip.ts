/**
 * M2b report ladder round trip: two real confirmed accounts driving the
 * report / seal / mismatch / amend / confirm / dispute state machine through
 * the SHIPPING `src/lib/matches.ts` module against the real local Postgres.
 *
 * WHY THIS FILE EXISTS: everything else proving M2b runs either against a
 * mocked Supabase client or a SQL-level test helper running as the table
 * owner. Both have been wrong here before — `saveTeam`'s update path and
 * `saveServerFormat`'s version lookup both passed against a mock and were
 * wrong against real Postgres (docs/superpowers/HANDOFF.md, the M1b notes). A
 * mock agrees with whatever it is told, and SQL run as the table owner never
 * meets a policy. The report ladder is a state machine spread across a check
 * constraint (`is_valid_scoreline`), an RLS policy (the sealing rule on
 * `match_reports`), a row-locked function (`submit_report`) and a cron sweep
 * (`sweep_matches`). No mock can judge any of that, and neither can SQL run
 * as the owner. This script drives all four through the client the browser
 * actually ships.
 *
 * It imports the SHIPPING module (`src/lib/matches.ts`) and never
 * reimplements it, for the same reason `m2a-roundtrip.ts` does: rows written
 * by a reimplementation of the client are rows the client never has to be
 * able to read.
 *
 * `test-opponent-{1,2}@example.test` (the accounts `app/tools/opponents.ts`
 * seeds) do NOT exist by the time this runs — repeated `npm run db:reset`s
 * during this plan wiped `auth.users` down to 39 rows, every one a
 * UUID-named fixture left behind by the database test suites, none of them a
 * seeded bot. So this script creates its OWN two accounts, the same way
 * `opponents.ts` does: sign up through the real client, fetch the
 * confirmation link out of Mailpit, and follow it. An admin-confirmed account
 * never fires `handle_confirmed_user()` and so never gets the profile that
 * `matches.player_a` / `player_b` reference by foreign key — the trigger is
 * what builds it, and there is no shortcut around that.
 *
 * Emails are stamped with the run's timestamp PLUS a few bytes of
 * `Math.random()` (see `stamp` below), not the timestamp alone — two runs
 * launched inside the same millisecond (a retry loop, say) would otherwise
 * mint the same email and collide with `auth.users`' unique constraint on it.
 * That makes every run's accounts disposable and collision-free without a
 * state file to go stale.
 *
 * ---------------------------------------------------------------------------
 * RUN IT (from `app/`, against the LOCAL stack only — `edge_runtime` need not
 * be up; this script never calls the coordinator)
 *
 *   ./node_modules/.bin/esbuild tools/m2b-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/m2b.mjs --log-level=warning \
 *     --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
 *   SUPABASE_SERVICE_ROLE_KEY='<SERVICE_ROLE_KEY from `supabase status --workdir ..`>' \
 *     node node_modules/.cache/m2b.mjs
 *
 * The service-role key comes from the environment and is never written into
 * this file: it bypasses every policy in `supabase/migrations`, so a copy of
 * it in the repository would be a copy of it in every clone. It is used for
 * exactly four things, each named at its call site: inserting `matches` rows
 * (there is deliberately no client INSERT policy on that table), forcing
 * `amend_deadline` into the past, calling `sweep_matches()` (granted to
 * `service_role` only), and — in cleanup — deleting the `matches` rows this
 * run created plus the two accounts.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { DATA_REV } from '../src/lib/data';
import type { StoredMember } from '../src/lib/teamCodec';
import type { Format } from '../src/rules';
import { saveServerFormat, deleteServerFormat, listServerFormats } from '../src/lib/saves';
import { myMatches, submitReport, myReport, adjudicatedRounds, toMatchTerms, toMyTerms } from '../src/lib/matches';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. It is needed to insert `matches` rows (no client\n' +
      'INSERT policy exists on that table, by design), to force `amend_deadline` into the past,\n' +
      'to call `sweep_matches()` (granted to service_role only), and to delete the matches and\n' +
      'the two accounts this run creates. Take it from `supabase status --workdir ..`; never\n' +
      'commit it.',
  );
  process.exit(2);
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  console.error(`REFUSING TO RUN: SUPABASE_URL is ${SUPABASE_URL}, which is not the local stack.`);
  process.exit(2);
}

/**
 * The admin client. Separate from `supabase` on purpose — the shipping client
 * is the thing under test and must never hold this key.
 */
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// A results harness that cannot pass for the wrong reason. Verbatim in spirit
// from m2a-roundtrip.ts: every check runs inside a try/catch, so an assertion
// that raises is recorded as a FAILURE rather than crashing the run and
// leaving earlier PASSes on screen as if they were the whole story.
// ---------------------------------------------------------------------------
let passes = 0;
let failures = 0;
const failed: string[] = [];

async function check(name: string, body: () => Promise<string>): Promise<void> {
  try {
    const detail = await body();
    passes++;
    console.log(`PASS  ${name}\n        ${detail}`);
  } catch (e) {
    failures++;
    failed.push(name);
    const message = e instanceof Error ? `${e.message}` : String(e);
    console.log(`FAIL  ${name}\n        ${message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** One ruleset, saved once, referenced by both matches below. */
const RULES: Format = {
  schema: 1,
  base: 'great',
  start: 'empty',
  pool: [{ effect: 'allow', select: 'type:steel', note: 'fixture format, contents do not matter' }],
  composition: { size: 3 },
  selection: { mode: 'open' },
};

/**
 * Arbitrary rosters. `matches.team_a` / `team_b` is a jsonb copy with no
 * shape check of its own — every constraint this script exercises
 * (`is_valid_scoreline`) looks only at `wins` — so anything StoredMember
 * shaped will do.
 */
const TEAM_A: StoredMember[] = [
  { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: ['FOCUS_BLAST', 'FLASH_CANNON'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
  { ref: 'skarmory', fast_move: 'AIR_SLASH', charge_moves: ['SKY_ATTACK', 'BRAVE_BIRD'], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 39 },
  { ref: 'medicham', fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH', 'PSYCHIC'], iv_attack: 0, iv_defense: 15, iv_stamina: 14, level: 50 },
];
const TEAM_B: StoredMember[] = [
  { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM', 'PLAY_ROUGH'], iv_attack: 0, iv_defense: 14, iv_stamina: 15, level: 41 },
  { ref: 'bastiodon', fast_move: 'SMACK_DOWN', charge_moves: ['STONE_EDGE', 'FLAMETHROWER'], iv_attack: 2, iv_defense: 15, iv_stamina: 13, level: 43 },
  { ref: 'swampert', fast_move: 'MUD_SHOT', charge_moves: ['HYDRO_CANNON', 'EARTHQUAKE'], iv_attack: 0, iv_defense: 15, iv_stamina: 14, level: 38 },
];

interface Bot {
  label: string;
  email: string;
  password: string;
  displayName: string;
  id: string;
}

function makeBot(n: 1 | 2): Bot {
  return {
    label: `bot${n}`,
    email: `m2b-${stamp}-bot${n}@example.test`,
    password: `M2b-Roundtrip-${stamp}-${n}`,
    displayName: `m2b ${stamp} bot${n}`,
    id: '',
  };
}

// Module-level, not local to main(): the abort handler at the bottom of this
// file cleans up whatever exists at the point of failure, and it needs these
// same objects. Building them (no I/O yet — just an object with a freshly
// stamped email) is safe to do unconditionally at load time.
const bot1: Bot = makeBot(1);
const bot2: Bot = makeBot(2);
let matchId1 = '';
let matchId2 = '';

// ---------------------------------------------------------------------------
// Signup through the real mailbox, verbatim in approach from opponents.ts:
// the profile trigger reads signup metadata, so an admin-created user would
// have no profile and every foreign key here points at one.
// ---------------------------------------------------------------------------
interface MailpitSummary {
  ID: string;
  To?: { Address: string }[];
}

async function confirmationLink(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  let last = 'no message ever arrived';
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: MailpitSummary[] };
      const hit = (body.messages ?? []).find((m) =>
        (m.To ?? []).some((t) => t.Address?.toLowerCase() === email.toLowerCase()),
      );
      if (hit) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`);
        const parsed = (await detail.json()) as { Text?: string; HTML?: string };
        const text = `${parsed.Text ?? ''}\n${parsed.HTML ?? ''}`.replace(/&amp;/g, '&');
        const link = /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/.exec(text);
        if (link) return link[0];
        last = `a message for ${email} had no /auth/v1/verify link in it`;
      }
    } else {
      last = `Mailpit answered ${res.status} for the message list`;
    }
    await sleep(400);
  }
  throw new Error(last);
}

async function signIn(b: Bot): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: b.email, password: b.password });
  if (error) throw new Error(`${b.label} could not sign in: ${error.message}`);
  const id = data.session?.user.id;
  if (!id) throw new Error(`${b.label} signed in with no session`);
  if (b.id && id !== b.id) throw new Error(`${b.label} signed in as ${id}, expected ${b.id}`);
  b.id = id;
}

/**
 * The gate this whole script rests on, same as m2a-roundtrip.ts and
 * opponents.ts: PostgREST's container can hold a clock a second or two
 * behind GoTrue's, which makes a freshly issued JWT "issued at future" and
 * gets every request refused — indistinguishable from a policy denying the
 * write. Poll a trivial authenticated select until it comes back clean AND
 * returns this account's own profile row, which also confirms
 * `handle_confirmed_user()` built the profile that `matches.player_a` /
 * `player_b` reference by foreign key.
 */
async function waitForTokenAccepted(b: Bot): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = 'never attempted';
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('profiles').select('id').eq('id', b.id);
    if (error) last = `PostgREST refused the token: ${error.message}`;
    else if ((data ?? []).length === 1) return;
    else last = `token accepted but no profile row for ${b.id} yet`;
    await sleep(300);
  }
  throw new Error(`${b.label}: ${last}`);
}

async function register(b: Bot): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: b.email,
    password: b.password,
    options: {
      emailRedirectTo: 'http://localhost:5173',
      data: {
        display_name: b.displayName,
        go_username: `M2B${stamp.replace(/[^a-z0-9]/gi, '').toUpperCase()}${b.label.toUpperCase()}`,
        birth_date: '1990-01-01',
        tos_accepted_at: new Date().toISOString(),
      },
    },
  });
  if (error) throw new Error(`${b.label} could not sign up: ${error.message}`);
  const link = await confirmationLink(b.email);
  const confirmed = await fetch(link, { redirect: 'manual' });
  if (confirmed.status >= 400) throw new Error(`${b.label}: confirmation link answered ${confirmed.status}`);
  await signIn(b);
  await waitForTokenAccepted(b);
}

async function as<T>(b: Bot, body: () => Promise<T>): Promise<T> {
  await signIn(b);
  return body();
}

// ---------------------------------------------------------------------------
// Match creation. There is deliberately no client INSERT policy on `matches`
// (a match is created by the pairing functions running as the table owner),
// so this — like `opponents.ts` widening `expires_at` — is the admin client
// doing something no client is permitted to do.
// ---------------------------------------------------------------------------
async function makeMatch(formatVersionId: string, rulesHash: string, seed: string): Promise<string> {
  const { data, error } = await admin
    .from('matches')
    .insert({
      player_a: bot1.id,
      player_b: bot2.id,
      format_version_id: formatVersionId,
      rules_hash: rulesHash,
      team_a: TEAM_A,
      team_b: TEAM_B,
      data_rev: DATA_REV,
      seed,
      rounds: 3,
      state: 'paired',
      source: 'queue',
    })
    .select('id')
    .single();
  if (error) throw new Error(`admin could not insert a match: ${error.message}`);
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`M2b round trip — run ${stamp}\n`);

  await check('0a. bot1 registers, confirms through Mailpit, and gets a profile', async () => {
    await register(bot1);
    return `bot1 ${bot1.id} <${bot1.email}>`;
  });
  await check('0b. bot2 registers, confirms through Mailpit, and gets a profile', async () => {
    await register(bot2);
    return `bot2 ${bot2.id} <${bot2.email}>`;
  });
  if (failures > 0) throw new Error('registration gate failed; nothing after it would mean anything');

  // A shared format_versions row both matches reference, saved through the
  // shipping saves.ts module (Task 3) as bot1's own format.
  let versionId = '';
  let rulesHash = '';
  await check('0c. a format_versions row exists for the matches to reference', async () => {
    await as(bot1, async () => {
      const formatId = await saveServerFormat({ name: `m2b ${stamp}`, format: RULES });
      const saved = (await listServerFormats()).find((f) => f.id === formatId);
      if (!saved) throw new Error('saved a format it cannot then list');
      versionId = saved.versionId;
      rulesHash = saved.rulesHash;
    });
    return `format_versions ${versionId}, rules_hash ${rulesHash}`;
  });
  if (failures > 0) throw new Error('no format_versions row; every match insert below would fail its foreign key');

  await check('setup. match 1 is created with the service role (no client INSERT policy exists)', async () => {
    matchId1 = await makeMatch(versionId, rulesHash, `${stamp}-1`);
    return `match ${matchId1}, bot1 is player_a, bot2 is player_b, best_of ${3}`;
  });
  if (failures > 0) throw new Error('no match 1; nothing in the report ladder has anywhere to write');

  // =========================================================================
  await check('1. bot1 submits [true, false, true] -> reported; matches.state is reported', async () => {
    const state = await as(bot1, () => submitReport(matchId1, toMatchTerms([true, false, true], 'a')));
    assert(state === 'reported', `submitReport returned ${show(state)}, expected 'reported'`);
    const mine = (await as(bot1, myMatches)).find((m) => m.id === matchId1);
    assert(!!mine, `bot1 cannot read match ${matchId1} back through myMatches()`);
    assert(mine!.state === 'reported', `myMatches() says state ${show(mine!.state)}, expected 'reported'`);
    return `submitReport(bot1, [true,false,true]) -> 'reported'; myMatches() confirms matches.state = 'reported'`;
  });

  // =========================================================================
  await check(
    "2. bot1 reads its own report back; bot2 reading match_reports for this match gets ZERO rows",
    async () => {
      const own = await as(bot1, () => myReport(matchId1));
      assert(!!own, `bot1's own report did not read back at all`);
      assert(
        show(own!.wins) === show(['a', 'b', 'a']),
        `bot1's own report reads ${show(own!.wins)} (match terms), expected ${show(['a', 'b', 'a'])}`,
      );
      // Round-trip toMatchTerms/toMyTerms against each other: what bot1
      // reads back, converted to its own perspective, must be exactly what
      // it submitted. If either function ever flipped the wrong way, or
      // flipped twice, this is where it would show up.
      const backToMine = toMyTerms(own!.wins, 'a');
      assert(
        show(backToMine) === show([true, false, true]),
        `toMyTerms(own.wins, 'a') = ${show(backToMine)}, expected the original [true,false,true]`,
      );

      // The sealing rule, through PostgREST — not through a SQL helper run as
      // the table owner, and not through myReport (which filters to the
      // caller's own row by construction and could never demonstrate this).
      // An UNFILTERED select by match_id is what proves the row is actually
      // absent from bot2's view rather than merely not asked for.
      const sealed = await as(bot2, async () =>
        supabase.from('match_reports').select('*').eq('match_id', matchId1),
      );
      if (sealed.error) {
        throw new Error(`bot2's read errored rather than returning nothing: ${sealed.error.message}`);
      }
      assert(
        Array.isArray(sealed.data) && sealed.data.length === 0,
        `THE SEALING RULE FAILED: bot2 can see ${sealed.data?.length ?? 'null'} row(s) of match_reports ` +
          `before filing its own report: ${show(sealed.data)}`,
      );
      return (
        `bot1 reads its own wins ${show(own!.wins)} (round-trips to ${show(backToMine)} in its own terms); ` +
        `bot2's unfiltered select on the same match_id returns exactly 0 rows, not an error`
      );
    },
  );

  // =========================================================================
  await check('3. bot2 submits a disagreeing scoreline -> mismatch; amend_deadline is set', async () => {
    const state = await as(bot2, () => submitReport(matchId1, toMatchTerms([true, true], 'b')));
    assert(state === 'mismatch', `submitReport returned ${show(state)}, expected 'mismatch'`);
    const mine = (await as(bot2, myMatches)).find((m) => m.id === matchId1);
    assert(!!mine, `bot2 cannot read match ${matchId1} back`);
    assert(mine!.state === 'mismatch', `myMatches() says state ${show(mine!.state)}, expected 'mismatch'`);
    assert(mine!.amendDeadline !== null, `amend_deadline is null after a mismatch`);
    return `submitReport(bot2, disagreeing) -> 'mismatch'; amend_deadline = ${mine!.amendDeadline}`;
  });

  // =========================================================================
  await check('4. bot2 reads match_reports again and still sees only its own row', async () => {
    const rows = await as(bot2, async () =>
      supabase.from('match_reports').select('reporter_id').eq('match_id', matchId1),
    );
    if (rows.error) throw new Error(`bot2's read errored: ${rows.error.message}`);
    const seen = (rows.data ?? []) as { reporter_id: string }[];
    assert(
      seen.length === 1 && seen[0]!.reporter_id === bot2.id,
      `bot2 sees ${show(seen)} — expected exactly one row, its own (${bot2.id})`,
    );
    return `bot2 still sees exactly 1 row of match_reports, reporter_id ${seen[0]!.reporter_id} (its own)`;
  });

  // =========================================================================
  await check(
    '5. bot2 amends to agree -> confirmed; three rounds in order with the right winners; both can now read both reports',
    async () => {
      // What bot1 claimed, in match terms, translated into BOT2's own
      // perspective via toMyTerms — this is the "I actually lost rounds 1
      // and 3, and won round 2" bot2 has to submit to agree, derived from
      // the interface rather than hand-typed.
      const bot1Claim = await as(bot1, () => myReport(matchId1));
      assert(!!bot1Claim, `bot1's own report is unreadable even to bot1`);
      const agreeInBot2Terms = toMyTerms(bot1Claim!.wins, 'b');

      const state = await as(bot2, () => submitReport(matchId1, toMatchTerms(agreeInBot2Terms, 'b')));
      assert(state === 'confirmed', `submitReport returned ${show(state)}, expected 'confirmed'`);

      const rounds = await as(bot1, () => adjudicatedRounds(matchId1));
      assert(rounds.length === 3, `match_rounds holds ${rounds.length} row(s), expected 3`);
      assert(
        show(rounds.map((r) => r.roundNo)) === show([1, 2, 3]),
        `round numbers are ${show(rounds.map((r) => r.roundNo))}, expected in order [1,2,3]`,
      );
      const winners = rounds.map((r) => r.winner);
      assert(
        show(winners) === show([bot1.id, bot2.id, bot1.id]),
        `winners are ${show(winners)}, expected [bot1, bot2, bot1] = ${show([bot1.id, bot2.id, bot1.id])}`,
      );

      const bothForBot1 = await as(bot1, async () =>
        supabase.from('match_reports').select('reporter_id').eq('match_id', matchId1),
      );
      const bothForBot2 = await as(bot2, async () =>
        supabase.from('match_reports').select('reporter_id').eq('match_id', matchId1),
      );
      if (bothForBot1.error) throw new Error(`bot1 could not read match_reports: ${bothForBot1.error.message}`);
      if (bothForBot2.error) throw new Error(`bot2 could not read match_reports: ${bothForBot2.error.message}`);
      assert(
        (bothForBot1.data ?? []).length === 2,
        `bot1 sees ${show(bothForBot1.data)} once confirmed, expected both reports`,
      );
      assert(
        (bothForBot2.data ?? []).length === 2,
        `bot2 sees ${show(bothForBot2.data)} once confirmed, expected both reports`,
      );
      return (
        `submitReport(bot2, agree) -> 'confirmed'; match_rounds winners ${show(winners)} in round order; ` +
        `both bot1 and bot2 now read 2 rows of match_reports each`
      );
    },
  );

  // =========================================================================
  await check(
    '6. a second match, forced disputed: both disagree, amend_deadline forced past, sweep_matches -> disputed',
    async () => {
      matchId2 = await makeMatch(versionId, rulesHash, `${stamp}-2`);
      const s1 = await as(bot1, () => submitReport(matchId2, toMatchTerms([true, true], 'a')));
      assert(s1 === 'reported', `bot1's first report on match 2 returned ${show(s1)}, expected 'reported'`);
      const s2 = await as(bot2, () => submitReport(matchId2, toMatchTerms([true, true], 'b')));
      assert(s2 === 'mismatch', `bot2's disagreeing report on match 2 returned ${show(s2)}, expected 'mismatch'`);

      // ADMIN: forcing amend_deadline into the past is not something any
      // client can do (there is no client UPDATE policy on `matches` at
      // all), and it is the only way to exercise sweep_matches()'s dispute
      // branch without actually waiting 10 minutes.
      const past = new Date(Date.now() - 60_000).toISOString();
      const forced = await admin
        .from('matches')
        .update({ amend_deadline: past })
        .eq('id', matchId2)
        .select('id, amend_deadline');
      if (forced.error) throw new Error(`admin could not force amend_deadline into the past: ${forced.error.message}`);
      assert((forced.data ?? []).length === 1, `forcing the deadline touched ${show(forced.data)} rows, expected 1`);

      // ADMIN: sweep_matches() is granted to service_role only.
      const swept = await admin.rpc('sweep_matches');
      if (swept.error) throw new Error(`admin's sweep_matches() call failed: ${swept.error.message}`);

      const after = await admin.from('matches').select('state, amend_deadline').eq('id', matchId2).single();
      if (after.error) throw new Error(`could not re-read match 2 after the sweep: ${after.error.message}`);
      const row = after.data as { state: string; amend_deadline: string | null };
      assert(row.state === 'disputed', `match 2 state is ${show(row.state)}, expected 'disputed'`);
      return (
        `match ${matchId2}: bot1 and bot2 disagreed ('mismatch'), amend_deadline forced to ${past}, ` +
        `sweep_matches() moved ${show(swept.data)} row(s) total, match 2 state is now 'disputed'`
      );
    },
  );

  // =========================================================================
  await check(
    '7. bot1 submitting into that disputed match raises "this match is no longer accepting reports"',
    async () => {
      let message = '';
      try {
        await as(bot1, () => submitReport(matchId2, toMatchTerms([true, false, true], 'a')));
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(
        message.includes('this match is no longer accepting reports'),
        `submitReport was refused with ${show(message)}, expected the "no longer accepting reports" message`,
      );
      return `submitReport into the disputed match raised: "${message}"`;
    },
  );
}

/**
 * Undo everything, in dependency order. `format_versions` is ON DELETE
 * RESTRICT from `matches`, so the matches must go first or the format delete
 * is refused — that is the guarantee working, not a bug. Both admin steps
 * here are things no client is permitted to do: deleting a `matches` row (a
 * SELECT-only policy, by design) and deleting an `auth.users` row (GoTrue
 * owns that table; deleting it cascades the profile every foreign key above
 * points at).
 */
async function cleanup(): Promise<void> {
  for (const id of [matchId1, matchId2]) {
    if (!id) continue;
    const d = await admin.from('matches').delete().eq('id', id);
    if (d.error) console.log(`      [cleanup] match ${id}: ${d.error.message}`);
  }
  if (bot1.id) {
    try {
      await as(bot1, async () => {
        for (const f of await listServerFormats()) await deleteServerFormat(f.id);
      });
    } catch (e) {
      console.log(`      [cleanup] bot1 formats: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await supabase.auth.signOut();
  for (const b of [bot1, bot2]) {
    if (!b.id) continue;
    const { error } = await admin.auth.admin.deleteUser(b.id);
    if (error) console.log(`      [cleanup] account ${b.label}: ${error.message}`);
  }
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${passes} passed, ${failures} failed`);
    if (failures > 0) console.log(`failed: ${failed.join(', ')}`);
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.log(`\nABORTED: ${e instanceof Error ? e.stack : String(e)}`);
    try {
      await cleanup();
      console.log('cleanup ran after the abort');
    } catch (c) {
      console.log(`cleanup after abort also failed: ${c instanceof Error ? c.message : String(c)}`);
    }
    console.log(`${passes} passed, ${failures} failed before the abort`);
    process.exit(1);
  });
