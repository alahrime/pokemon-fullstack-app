/**
 * M2a end-to-end round trip: three real confirmed accounts, the real modules,
 * the real local Postgres, and the real coordinator Edge Function.
 *
 * Why this file is kept while M1b's equivalents were throwaways: every other
 * test in this milestone either mocks the Supabase client or drives SQL
 * directly. A mock agrees with whatever it is told, and SQL run as the table
 * owner never meets a policy. Neither can see what M1b learned the hard way —
 * a green suite is not evidence about a system nobody ran. This is the only
 * end-to-end proof M2a has.
 *
 * It imports the SHIPPING modules (`src/lib/matchmaking.ts`, `src/lib/saves.ts`,
 * `src/rules`) and never reimplements them. Anything it proves is a property of
 * the code the browser runs.
 *
 * Run it:
 *
 *   cd app
 *   ./node_modules/.bin/esbuild tools/m2a-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/m2a.mjs --log-level=warning \
 *     --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"<sb_publishable_… from npm run db:start>"}'
 *   SUPABASE_SERVICE_ROLE_KEY='<the local SERVICE_ROLE_KEY>' node node_modules/.cache/m2a.mjs
 *
 * The service-role key comes from the environment and is never written into
 * this file: it bypasses every policy in `supabase/migrations`, so a copy of it
 * in the repository would be a copy of it in every clone. It is used for
 * exactly two things, both of which no client is permitted to do and both of
 * which are named at their call sites: deleting `matches` rows (there is
 * deliberately no client DELETE policy) and deleting the test accounts.
 *
 * The coordinator must be reachable. `supabase functions serve --workdir ..`
 * from `app/`, and STOP IT AFTERWARDS — a stray server once turned a
 * 44-second gate into a 68-minute run in this repo.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { DATA_REV } from '../src/lib/data';
import { rulesHash, type Format } from '../src/rules';
import type { StoredMember } from '../src/lib/teamCodec';
import {
  listServerFormats,
  saveServerFormat,
  deleteServerFormat,
  saveTeam,
  listTeams,
  deleteTeam,
} from '../src/lib/saves';
import {
  joinQueue,
  leaveQueue,
  myQueueEntry,
  myMatches,
  createOffer,
  acceptOffer,
  confirmOffer,
  listOpenOffers,
  myOffers,
  opponentFriendCode,
} from '../src/lib/matchmaking';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const COORDINATOR_URL =
  process.env.COORDINATOR_URL ?? 'http://127.0.0.1:54321/functions/v1/coordinator';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. It is needed to delete `matches` rows (no client\n' +
      'DELETE policy exists, by design) and to delete the test accounts at the end. Take it from\n' +
      '`supabase status --workdir ..`; never commit it.',
  );
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
// A results harness that cannot pass for the wrong reason.
//
// Every check runs inside a try/catch, so an assertion that raises (reading a
// property off an undefined row, say) is recorded as a FAILURE rather than
// crashing the run and leaving earlier PASSes on screen as if they were the
// whole story. That exact shape — a TypeError where a red was expected —
// produced false evidence twice in this milestone.
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
const stamp = Date.now().toString(36);

/**
 * ONE ruleset, authored independently by two accounts.
 *
 * There are no canonical league formats in this system: `format_version_id` has
 * to point at a version the account itself saved. Two people who author the
 * same rules produce the same `canonicalize()` string and therefore the same
 * `rules_hash`, which is the ONLY reason they can ever be paired — the queue
 * partitions on the verified hash, not on the format id. That is the design,
 * and check 3a asserts it directly rather than assuming it.
 */
const RULES: Format = {
  schema: 1,
  base: 'great',
  start: 'empty',
  pool: [{ effect: 'allow', select: 'type:steel', note: 'commentary, must not affect the hash' }],
  composition: { size: 3 },
  selection: { mode: 'open' },
};

/** The same rules, written in a different order with a different note. */
const RULES_RESTATED: Format = {
  base: 'great',
  schema: 1,
  pool: [{ select: 'TYPE:STEEL ', effect: 'allow', note: 'a different note entirely' }],
  selection: { mode: 'open' },
  composition: { size: 3 },
  start: 'empty',
};

/**
 * Three rosters with DIFFERENT members per account, deliberately.
 *
 * If all three held the same refs, then "team_b holds the accepter's roster"
 * would pass just as happily against a `team_b` that had been filled with the
 * proposer's — the check that matters most in the live-offer route would be
 * unable to fail. The refs are what tell the two apart.
 */
const ROSTERS: Record<string, StoredMember[]> = {
  a: [
    { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: ['FOCUS_BLAST', 'FLASH_CANNON'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
    { ref: 'skarmory', fast_move: 'AIR_SLASH', charge_moves: ['SKY_ATTACK', 'BRAVE_BIRD'], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 39 },
    { ref: 'medicham', fast_move: 'COUNTER', charge_moves: ['ICE_PUNCH', 'PSYCHIC'], iv_attack: 0, iv_defense: 15, iv_stamina: 14, level: 50 },
  ],
  b: [
    { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM', 'PLAY_ROUGH'], iv_attack: 0, iv_defense: 14, iv_stamina: 15, level: 41 },
    { ref: 'bastiodon', fast_move: 'SMACK_DOWN', charge_moves: ['STONE_EDGE', 'FLAMETHROWER'], iv_attack: 2, iv_defense: 15, iv_stamina: 13, level: 43 },
    { ref: 'swampert', fast_move: 'MUD_SHOT', charge_moves: ['HYDRO_CANNON', 'EARTHQUAKE'], iv_attack: 0, iv_defense: 15, iv_stamina: 14, level: 38 },
  ],
  c: [
    { ref: 'altaria', fast_move: 'DRAGON_BREATH', charge_moves: ['SKY_ATTACK', 'MOONBLAST'], iv_attack: 0, iv_defense: 14, iv_stamina: 14, level: 44 },
    { ref: 'umbreon', fast_move: 'SNARL', charge_moves: ['FOUL_PLAY', 'LAST_RESORT'], iv_attack: 1, iv_defense: 15, iv_stamina: 15, level: 40 },
    { ref: 'venusaur', fast_move: 'VINE_WHIP', charge_moves: ['FRENZY_PLANT', 'SLUDGE_BOMB'], iv_attack: 0, iv_defense: 13, iv_stamina: 15, level: 42 },
  ],
};

function roster(tag: string): StoredMember[] {
  const r = ROSTERS[tag];
  if (!r) throw new Error(`no fixture roster for ${tag}`);
  return r.map((m) => ({ ...m, charge_moves: [...m.charge_moves] }));
}

interface Account {
  label: string;
  email: string;
  password: string;
  displayName: string;
  id: string;
  team: StoredMember[];
  formatId: string;
  versionId: string;
  rulesHash: string;
  friendCode: string;
}

// ---------------------------------------------------------------------------
// Signup through the real mailbox, because the profile trigger reads signup
// metadata: an admin-created user would have no profile and every foreign key
// here points at one.
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

async function signIn(a: Account): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: a.email,
    password: a.password,
  });
  if (error) throw new Error(`${a.label} could not sign in: ${error.message}`);
  const id = data.session?.user.id;
  if (!id) throw new Error(`${a.label} signed in with no session`);
  if (a.id && id !== a.id) throw new Error(`${a.label} signed in as ${id}, expected ${a.id}`);
  a.id = id;
}

/**
 * The gate this whole script rests on.
 *
 * PostgREST's container can hold a clock a second or two behind GoTrue's, which
 * makes a freshly issued JWT "issued at future" and gets every request refused
 * — a refusal indistinguishable from a policy denying the write. That confound
 * produced a false pass during M1b. So: poll a trivial authenticated select
 * until it comes back CLEAN and returns the caller's own profile row, and only
 * then let anything else run. It also confirms `handle_confirmed_user()`
 * actually made the profile every foreign key here needs.
 */
async function waitForTokenAccepted(a: Account): Promise<string> {
  const deadline = Date.now() + 30_000;
  let last = 'never attempted';
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('profiles').select('id, display_name').eq('id', a.id);
    if (error) {
      last = `PostgREST refused the token: ${error.message}`;
    } else if ((data ?? []).length === 1) {
      return `${a.label} ${a.id} — authenticated select returned its own profile row`;
    } else {
      last = `token accepted but no profile row for ${a.id} yet (${(data ?? []).length} rows)`;
    }
    await sleep(300);
  }
  throw new Error(`${a.label}: ${last}`);
}

async function register(label: string, tag: string): Promise<Account> {
  const a: Account = {
    label,
    email: `m2a-${stamp}-${tag}@example.test`,
    password: `Round-Trip-${stamp}-${tag}`,
    displayName: `m2a ${stamp} ${tag}`,
    id: '',
    team: roster(tag),
    formatId: '',
    versionId: '',
    rulesHash: '',
    friendCode: `${tag.toUpperCase()}${stamp}`.padEnd(12, '0').slice(0, 12),
  };
  const { error } = await supabase.auth.signUp({
    email: a.email,
    password: a.password,
    options: {
      emailRedirectTo: 'http://localhost:5173',
      data: {
        display_name: a.displayName,
        go_username: `GO${stamp}${tag}`,
        birth_date: '1990-01-01',
        tos_accepted_at: new Date().toISOString(),
      },
    },
  });
  if (error) throw new Error(`${label} could not sign up: ${error.message}`);
  const link = await confirmationLink(a.email);
  const confirmed = await fetch(link, { redirect: 'manual' });
  if (confirmed.status >= 400) {
    throw new Error(`${label}: confirmation link answered ${confirmed.status}`);
  }
  await signIn(a);
  return a;
}

async function as<T>(a: Account, body: () => Promise<T>): Promise<T> {
  await signIn(a);
  return body();
}

// ---------------------------------------------------------------------------
// The coordinator, and the guard in front of every tick.
//
// `pair_queue_entries()` and `sweep_expired()` are GLOBAL and unscoped: they
// scan every user's rows, not this script's. This machine holds a human
// partner's real account. So before each tick, look — with the admin client,
// which sees past RLS — for any queue entry, offer or match that does not
// belong to one of our three test accounts, and refuse to tick if one exists.
// ---------------------------------------------------------------------------
let accounts: Account[] = [];

async function assertNoForeignRows(label: string): Promise<void> {
  const ours = new Set(accounts.map((a) => a.id));
  const q = await admin.from('queue_entries').select('id, user_id');
  if (q.error) throw new Error(`pre-tick scan of queue_entries failed: ${q.error.message}`);
  const o = await admin.from('match_offers').select('id, proposer_id');
  if (o.error) throw new Error(`pre-tick scan of match_offers failed: ${o.error.message}`);
  const m = await admin.from('matches').select('id, player_a, player_b');
  if (m.error) throw new Error(`pre-tick scan of matches failed: ${m.error.message}`);

  const foreignQ = (q.data ?? []).filter((r) => !ours.has((r as { user_id: string }).user_id));
  const foreignO = (o.data ?? []).filter((r) => !ours.has((r as { proposer_id: string }).proposer_id));
  const foreignM = (m.data ?? []).filter((r) => {
    const row = r as { player_a: string; player_b: string };
    return !ours.has(row.player_a) || !ours.has(row.player_b);
  });
  if (foreignQ.length || foreignO.length || foreignM.length) {
    throw new Error(
      `REFUSING TO TICK before "${label}": rows that are not this script's exist — ` +
        `queue_entries ${show(foreignQ)}, match_offers ${show(foreignO)}, matches ${show(foreignM)}`,
    );
  }
  console.log(
    `      [pre-tick "${label}"] every row belongs to this script: ` +
      `queue_entries ${(q.data ?? []).length}, match_offers ${(o.data ?? []).length}, matches ${(m.data ?? []).length}`,
  );
}

interface Tick {
  verified: number;
  paired: number;
  swept: number;
}

async function tick(label: string): Promise<Tick> {
  await assertNoForeignRows(label);
  const res = await fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`coordinator answered ${res.status}: ${text}`);
  console.log(`      [tick "${label}"] ${text}`);
  return JSON.parse(text) as Tick;
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`M2a round trip — run ${stamp}, DATA_REV ${DATA_REV}`);
  console.log(`coordinator ${COORDINATOR_URL}\n`);

  const before = await censusRow();
  console.log(`census before: ${show(before)}\n`);

  // -- registration ---------------------------------------------------------
  const alice = await register('alice', 'a');
  const bob = await register('bob', 'b');
  const carol = await register('carol', 'c');
  accounts = [alice, bob, carol];

  for (const a of accounts) {
    await check(`0. ${a.label}'s JWT is accepted and its profile exists`, async () => {
      await signIn(a);
      return waitForTokenAccepted(a);
    });
  }
  if (failures > 0) throw new Error('registration gate failed; nothing after it would mean anything');

  // -- formats and rosters, through the real saves module -------------------
  for (const [a, rules] of [
    [alice, RULES],
    [bob, RULES_RESTATED],
    [carol, RULES],
  ] as const) {
    await as(a, async () => {
      a.formatId = await saveServerFormat({ name: `m2a ${stamp} ${a.label}`, format: rules });
      const saved = (await listServerFormats()).find((f) => f.id === a.formatId);
      if (!saved) throw new Error(`${a.label} saved a format it cannot then list`);
      a.versionId = saved.versionId;
      a.rulesHash = saved.rulesHash;
      const teamId = await saveTeam({
        name: `m2a ${stamp} ${a.label}`,
        league: 'great',
        size: 3,
        members: a.team,
      });
      const listed = (await listTeams(3)).find((t) => t.id === teamId);
      if (!listed) throw new Error(`${a.label} saved a 3-roster that listTeams(3) does not return`);
      a.team = listed.members;
    });
  }

  await check('1. two accounts authoring the same rules produce the same rules_hash', async () => {
    const expected = await rulesHash(RULES);
    assert(
      alice.rulesHash === bob.rulesHash,
      `alice ${alice.rulesHash} vs bob ${bob.rulesHash} — restating the same rules changed the hash, ` +
        `so two strangers could never be paired`,
    );
    assert(
      alice.rulesHash === expected,
      `the server stored ${alice.rulesHash} but rulesHash() says ${expected}`,
    );
    assert(
      alice.versionId !== bob.versionId,
      'both accounts somehow point at one format_versions row; this check would be vacuous',
    );
    return `alice ${alice.versionId} and bob ${bob.versionId} are different versions with the same hash ${alice.rulesHash}`;
  });

  // =========================================================================
  // Check 2: leaveQueue() against real Postgres.
  //
  // leaveQueue issues `DELETE … .eq('user_id', me)`. Every unit test mocks the
  // client, so none of them can say whether PostgREST accepts that statement or
  // what it does. The half that matters is the SECOND assertion: a delete that
  // removed both entries would pass a test that only looked at the leaver's.
  // =========================================================================
  await check('2. leaveQueue deletes the leaver\'s row and nobody else\'s', async () => {
    const aliceEntry = await as(alice, () => joinQueue({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team }));
    const bobEntry = await as(bob, () => joinQueue({ league: 'great', formatVersionId: bob.versionId, format: RULES_RESTATED, team: bob.team }));
    const bobBefore = await as(bob, myQueueEntry);
    assert(bobBefore?.id === bobEntry, `bob's own entry did not read back: ${show(bobBefore)}`);

    await as(alice, leaveQueue);

    const aliceAfter = await as(alice, myQueueEntry);
    assert(aliceAfter === null, `alice left the queue and still has an entry: ${show(aliceAfter)}`);
    const bobAfter = await as(bob, myQueueEntry);
    assert(
      bobAfter?.id === bobEntry,
      `alice's leaveQueue took bob's entry with it — bob now reads ${show(bobAfter)}, expected id ${bobEntry}`,
    );
    // And the row is really gone, not merely hidden from alice by a policy.
    const all = await admin.from('queue_entries').select('id, user_id');
    const rows = (all.data ?? []) as { id: string; user_id: string }[];
    assert(
      !rows.some((r) => r.id === aliceEntry),
      `alice's row ${aliceEntry} is still in the table: ${show(rows)}`,
    );
    assert(
      rows.some((r) => r.id === bobEntry),
      `bob's row ${bobEntry} is gone from the table: ${show(rows)}`,
    );

    await as(bob, leaveQueue);
    const empty = await admin.from('queue_entries').select('id');
    assert((empty.data ?? []).length === 0, `queue not empty after both left: ${show(empty.data)}`);
    return `alice's entry ${aliceEntry} deleted; bob's ${bobEntry} survived, confirmed past RLS with the admin client`;
  });

  // =========================================================================
  // Check 3: the coordinator's match_offers liar branch.
  //
  // Task 6 proved this for queue_entries. The match_offers branch is the same
  // loop over a different table name and has never been run. `createOffer`
  // computes the hash itself and cannot lie, so the lie is staged as a raw
  // insert by the signed-in proposer — exactly what a modified client would do,
  // which is the threat the recomputation exists for.
  // =========================================================================
  await check('3. an offer whose claimed_hash lies is DELETED by the coordinator', async () => {
    const lie = 'deadbeef'.repeat(8);
    const inserted = await as(carol, async () =>
      supabase
        .from('match_offers')
        .insert({
          league: 'great',
          format_version_id: carol.versionId,
          claimed_hash: lie,
          team: carol.team,
          data_rev: DATA_REV,
        })
        .select('id, claimed_hash, verified_hash')
        .single(),
    );
    if (inserted.error) throw new Error(`could not stage the lying offer: ${inserted.error.message}`);
    const row = inserted.data as { id: string; claimed_hash: string; verified_hash: string | null };
    assert(row.claimed_hash === lie, `the lie did not survive the insert: ${show(row)}`);
    assert(row.verified_hash === null, `a brand new offer arrived already verified: ${show(row)}`);

    const t = await tick('liar offer');
    assert(t.verified === 0, `the coordinator verified ${t.verified} rows; the only row present was a lie`);
    assert(t.paired === 0, `the coordinator paired ${t.paired} despite an empty queue`);

    const after = await admin.from('match_offers').select('id, state, verified_hash').eq('id', row.id);
    if (after.error) throw new Error(`could not re-read the offer: ${after.error.message}`);
    assert(
      (after.data ?? []).length === 0,
      `the lying offer was not deleted — it is still there as ${show(after.data)}`,
    );
    const matches = await admin.from('matches').select('id');
    assert((matches.data ?? []).length === 0, `a match was created from a lie: ${show(matches.data)}`);
    return `offer ${row.id} claimed ${lie.slice(0, 12)}…, coordinator recomputed a different hash and deleted the row outright`;
  });

  // =========================================================================
  // Check 4: the queue route.
  // =========================================================================
  let queueMatchId = '';
  await check('4. nothing pairs before the coordinator has verified the hashes', async () => {
    await as(alice, () => joinQueue({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team }));
    await as(bob, () => joinQueue({ league: 'great', formatVersionId: bob.versionId, format: RULES_RESTATED, team: bob.team }));
    const aliceEntry = await as(alice, myQueueEntry);
    const bobEntry = await as(bob, myQueueEntry);
    assert(aliceEntry?.verifiedHash === null, `alice's entry was verified without a tick: ${show(aliceEntry)}`);
    assert(bobEntry?.verifiedHash === null, `bob's entry was verified without a tick: ${show(bobEntry)}`);
    const aliceMatches = await as(alice, myMatches);
    const bobMatches = await as(bob, myMatches);
    assert(aliceMatches.length === 0, `alice already has a match: ${show(aliceMatches)}`);
    assert(bobMatches.length === 0, `bob already has a match: ${show(bobMatches)}`);
    return `both entries sit at verified_hash null and neither player has a match`;
  });

  await check('4b. one tick verifies both and pairs exactly one match', async () => {
    const t = await tick('queue route');
    assert(t.verified === 2, `expected verified 2, got ${t.verified} (tick was ${show(t)})`);
    assert(t.paired === 1, `expected paired 1, got ${t.paired} (tick was ${show(t)})`);
    const all = await admin.from('matches').select('id, player_a, player_b, source, rules_hash');
    const rows = (all.data ?? []) as { id: string; player_a: string; player_b: string; source: string; rules_hash: string }[];
    assert(rows.length === 1, `expected exactly one matches row, found ${rows.length}: ${show(rows)}`);
    const match = rows[0]!;
    queueMatchId = match.id;
    assert(match.source === 'queue', `match source is ${match.source}, expected 'queue'`);
    assert(
      match.rules_hash === alice.rulesHash,
      `match carries rules_hash ${match.rules_hash}, expected the verified ${alice.rulesHash}`,
    );
    const players = [match.player_a, match.player_b].sort();
    assert(
      show(players) === show([alice.id, bob.id].sort()),
      `match pairs ${show(players)}, expected alice and bob ${show([alice.id, bob.id].sort())}`,
    );
    const emptied = await admin.from('queue_entries').select('id');
    assert((emptied.data ?? []).length === 0, `paired entries were left in the queue: ${show(emptied.data)}`);
    return `match ${queueMatchId} — source queue, rules_hash ${match.rules_hash}, both entries consumed`;
  });

  await check('4c. both players can read the match; a third account cannot', async () => {
    const a = await as(alice, myMatches);
    assert(a.length === 1 && a[0]!.id === queueMatchId, `alice reads ${show(a.map((m) => m.id))}`);
    assert(a[0]!.opponentId === bob.id, `alice's opponent reads as ${a[0]!.opponentId}, expected bob ${bob.id}`);
    const b = await as(bob, myMatches);
    assert(b.length === 1 && b[0]!.id === queueMatchId, `bob reads ${show(b.map((m) => m.id))}`);
    assert(b[0]!.opponentId === alice.id, `bob's opponent reads as ${b[0]!.opponentId}, expected alice ${alice.id}`);
    const c = await as(carol, myMatches);
    assert(c.length === 0, `carol, who is in no match, can read ${show(c.map((m) => m.id))}`);
    // A row-level check, not a count: carol asking for the match BY ID gets nothing.
    const direct = await as(carol, async () => supabase.from('matches').select('id, team_a').eq('id', queueMatchId));
    if (direct.error) throw new Error(`carol's direct read errored rather than returning nothing: ${direct.error.message}`);
    assert((direct.data ?? []).length === 0, `carol can read match ${queueMatchId} directly: ${show(direct.data)}`);
    return `alice and bob each read ${queueMatchId} with the other as opponent; carol reads 0 rows asking for it by id`;
  });

  // =========================================================================
  // Check 5: friend codes, which the match is what unlocks.
  // =========================================================================
  await check('5. each player reads the other\'s friend code; the third account reads neither', async () => {
    for (const a of accounts) {
      const w = await as(a, async () =>
        supabase.from('friend_codes').insert({ profile_id: a.id, code: a.friendCode }),
      );
      if (w.error) throw new Error(`${a.label} could not save a friend code: ${w.error.message}`);
    }
    const aliceReadsBob = await as(alice, () => opponentFriendCode(bob.id));
    assert(aliceReadsBob === bob.friendCode, `alice read ${show(aliceReadsBob)} for bob, expected ${show(bob.friendCode)}`);
    const bobReadsAlice = await as(bob, () => opponentFriendCode(alice.id));
    assert(bobReadsAlice === alice.friendCode, `bob read ${show(bobReadsAlice)} for alice, expected ${show(alice.friendCode)}`);
    const carolReadsAlice = await as(carol, () => opponentFriendCode(alice.id));
    assert(carolReadsAlice === null, `carol read alice's friend code: ${show(carolReadsAlice)}`);
    const carolReadsBob = await as(carol, () => opponentFriendCode(bob.id));
    assert(carolReadsBob === null, `carol read bob's friend code: ${show(carolReadsBob)}`);
    // And carol is not simply blind to the table — she can still read her own.
    const carolOwn = await as(carol, () => opponentFriendCode(carol.id));
    assert(
      carolOwn === carol.friendCode,
      `carol cannot even read her own code (${show(carolOwn)}), so the two nulls above prove nothing`,
    );
    return `alice↔bob exchanged ${show(alice.friendCode)}/${show(bob.friendCode)}; carol got null for both while still reading her own ${show(carolOwn)}`;
  });

  // =========================================================================
  // Check 6: the live offer route.
  // =========================================================================
  await check('6. a live offer converts to a match on acceptance, carrying the accepter\'s roster', async () => {
    const offerId = await as(alice, () =>
      createOffer({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team }),
    );
    const unverified = await as(bob, () => listOpenOffers('great'));
    const seen = unverified.find((o) => o.id === offerId);
    assert(!!seen, `bob cannot see alice's public offer ${offerId} on the board`);
    assert(seen!.verifiedHash === null, `a brand new offer is already verified: ${show(seen)}`);
    assert(
      seen!.rosterSize === alice.team.length,
      `board says rosterSize ${seen!.rosterSize}, alice posted ${alice.team.length} members`,
    );

    const t = await tick('live offer');
    assert(t.verified === 1, `expected verified 1, got ${show(t)}`);

    const matchId = await as(bob, () => acceptOffer(offerId, bob.team));
    assert(typeof matchId === 'string' && matchId.length > 0, `a live acceptance returned ${show(matchId)}, expected a match id`);

    const stored = await as(bob, async () =>
      supabase.from('matches').select('id, player_a, player_b, source, team_a, team_b').eq('id', matchId!).single(),
    );
    if (stored.error) throw new Error(`bob cannot read the match he just made: ${stored.error.message}`);
    const m = stored.data as { player_a: string; player_b: string; source: string; team_a: StoredMember[]; team_b: StoredMember[] };
    assert(m.source === 'offer', `match source ${m.source}, expected 'offer'`);
    assert(m.player_a === alice.id && m.player_b === bob.id, `players are ${m.player_a}/${m.player_b}`);
    assert(
      Array.isArray(m.team_b) && m.team_b.length === bob.team.length,
      `team_b holds ${show(m.team_b)} — an empty or short roster is the bug this check exists for`,
    );
    assert(
      show(m.team_b.map((x) => x.ref)) === show(bob.team.map((x) => x.ref)),
      `team_b is ${show(m.team_b.map((x) => x.ref))}, bob accepted with ${show(bob.team.map((x) => x.ref))}`,
    );
    assert(
      show(m.team_a.map((x) => x.ref)) === show(alice.team.map((x) => x.ref)),
      `team_a is ${show(m.team_a.map((x) => x.ref))}, alice offered ${show(alice.team.map((x) => x.ref))}`,
    );
    const proposerView = (await as(alice, myOffers)).find((o) => o.id === offerId);
    assert(proposerView?.state === 'converted', `proposer sees state ${show(proposerView?.state)}, expected 'converted'`);
    assert(proposerView?.matchId === matchId, `offer points at match ${show(proposerView?.matchId)}, expected ${matchId}`);
    return `offer ${offerId} → match ${matchId}, team_b = ${show(m.team_b.map((x) => x.ref))} (bob's own roster, not empty)`;
  });

  // =========================================================================
  // Check 7: the scheduled route — acceptance is half a handshake.
  // =========================================================================
  await check('7. a scheduled offer accepted is NOT a match until the proposer confirms', async () => {
    const when = new Date(Date.now() + 45 * 60 * 1000);
    const offerId = await as(alice, () =>
      createOffer({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team, scheduledFor: when }),
    );
    const t = await tick('scheduled offer');
    assert(t.verified === 1, `expected verified 1, got ${show(t)}`);

    const before = await admin.from('matches').select('id');
    const beforeIds = new Set(((before.data ?? []) as { id: string }[]).map((r) => r.id));

    const accepted = await as(bob, () => acceptOffer(offerId, bob.team));
    assert(accepted === null, `accepting a SCHEDULED offer returned ${show(accepted)}; it must not make a match`);

    const after = await admin.from('matches').select('id');
    const afterIds = ((after.data ?? []) as { id: string }[]).map((r) => r.id);
    const created = afterIds.filter((id) => !beforeIds.has(id));
    assert(created.length === 0, `a match appeared on a one-sided acceptance: ${show(created)}`);

    const takerView = (await as(bob, myOffers)).find((o) => o.id === offerId);
    assert(takerView?.state === 'accepted', `taker sees state ${show(takerView?.state)}, expected 'accepted'`);
    assert(takerView?.matchId === null, `an accepted-not-confirmed offer already has match ${show(takerView?.matchId)}`);

    const matchId = await as(alice, () => confirmOffer(offerId));
    assert(typeof matchId === 'string' && matchId.length > 0, `confirmOffer returned ${show(matchId)}`);
    const stored = await as(bob, async () =>
      supabase.from('matches').select('id, player_a, player_b, team_b, source').eq('id', matchId).single(),
    );
    if (stored.error) throw new Error(`the confirmed match is not readable by the taker: ${stored.error.message}`);
    const m = stored.data as { player_a: string; player_b: string; team_b: StoredMember[]; source: string };
    assert(m.player_a === alice.id && m.player_b === bob.id, `players are ${m.player_a}/${m.player_b}`);
    assert(
      show(m.team_b.map((x) => x.ref)) === show(bob.team.map((x) => x.ref)),
      `team_b on the confirmed match is ${show(m.team_b.map((x) => x.ref))}, bob accepted with ${show(bob.team.map((x) => x.ref))}`,
    );
    const finalView = (await as(alice, myOffers)).find((o) => o.id === offerId);
    assert(finalView?.state === 'converted', `after confirming, state is ${show(finalView?.state)}`);
    return `offer ${offerId}: accept → state 'accepted', matchId null, zero new matches; confirm → match ${matchId} with bob's roster`;
  });

  await check('8. a scheduled offer that runs out of time LAPSES rather than converting', async () => {
    const when = new Date(Date.now() + 90 * 60 * 1000);
    const offerId = await as(alice, () =>
      createOffer({ league: 'great', formatVersionId: alice.versionId, format: RULES, team: alice.team, scheduledFor: when }),
    );
    // Backdate the window, as ADMIN. It used to be alice's own write, on the
    // grounds that "an offer belongs to the person who proposed it" permits
    // it — and that was true, which is precisely the Critical this branch
    // then had to fix: UPDATE is now revoked from `authenticated`, because a
    // proposer able to edit their own offer's columns is a proposer able to
    // set `accepted_by` to a stranger and confirm a match against them. The
    // test harness needs the clock moved; it does not need a client to be
    // able to move it, and pretending otherwise is what let the hole sit.
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const moved = await admin
      .from('match_offers')
      .update({ expires_at: past })
      .eq('id', offerId)
      .select('id, expires_at')
      .single();
    if (moved.error) throw new Error(`could not backdate the offer: ${moved.error.message}`);

    const before = await admin.from('matches').select('id');
    const beforeIds = new Set(((before.data ?? []) as { id: string }[]).map((r) => r.id));

    const t = await tick('lapse sweep');
    assert(t.paired === 0, `the sweep tick paired ${t.paired}`);

    const row = await admin.from('match_offers').select('id, state, match_id, expires_at').eq('id', offerId).single();
    if (row.error) throw new Error(`could not re-read the lapsed offer: ${row.error.message}`);
    const o = row.data as { state: string; match_id: string | null };
    assert(o.state === 'lapsed', `expired offer is in state ${show(o.state)}, expected 'lapsed'`);
    assert(o.match_id === null, `a lapsed offer carries match ${show(o.match_id)}`);

    const after = await admin.from('matches').select('id');
    const created = ((after.data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !beforeIds.has(id));
    assert(created.length === 0, `the sweep created a match: ${show(created)}`);

    // And it really is closed, not merely relabelled: accepting it now fails,
    // with the reason named rather than merely "something was refused".
    let refusal = '';
    try {
      await as(bob, () => acceptOffer(offerId, bob.team));
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    assert(
      refusal.includes('no longer open') || refusal.includes('expired'),
      `accepting a lapsed offer was refused with ${show(refusal)}, which is not the state check`,
    );
    return `offer ${offerId} → state 'lapsed', match_id null, no match created; a later accept is refused "${refusal}"`;
  });

  // -- cleanup --------------------------------------------------------------
  await cleanup();

  await check('9. every row this script created is gone', async () => {
    const after = await censusRow();
    const drift = Object.entries(after).filter(([k, v]) => v !== before[k as keyof Census]);
    assert(
      drift.length === 0,
      `the database did not return to its starting shape. before ${show(before)}, after ${show(after)}, drift ${show(drift)}`,
    );
    return `census identical to the start: ${show(after)}`;
  });
}

// ---------------------------------------------------------------------------
interface Census {
  profiles: number;
  teams: number;
  team_members: number;
  formats: number;
  format_versions: number;
  friend_codes: number;
  queue_entries: number;
  match_offers: number;
  matches: number;
}

async function censusRow(): Promise<Census> {
  const tables: (keyof Census)[] = [
    'profiles',
    'teams',
    'team_members',
    'formats',
    'format_versions',
    'friend_codes',
    'queue_entries',
    'match_offers',
    'matches',
  ];
  const out = {} as Census;
  for (const t of tables) {
    const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`census of ${t} failed: ${error.message}`);
    out[t] = count ?? -1;
  }
  return out;
}

/**
 * Undo everything, in dependency order. `format_versions` is ON DELETE RESTRICT
 * from both `matches` and `match_offers`, so those must go first or the format
 * delete is refused — which is the guarantee working, not a bug.
 *
 * Client-side deletes are used wherever a policy permits one, so cleanup itself
 * exercises the shipping code. The two exceptions are named where they happen.
 */
async function cleanup(): Promise<void> {
  for (const a of accounts) {
    if (!a.id) continue;
    try {
      await as(a, async () => {
        await leaveQueue();
        const offers = await supabase.from('match_offers').delete().eq('proposer_id', a.id);
        if (offers.error) console.log(`      [cleanup] ${a.label} offers: ${offers.error.message}`);
        const codes = await supabase.from('friend_codes').delete().eq('profile_id', a.id);
        if (codes.error) console.log(`      [cleanup] ${a.label} friend code: ${codes.error.message}`);
      });
    } catch (e) {
      console.log(`      [cleanup] ${a.label} first pass: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // matches has SELECT-only policies by design: no client may delete one, so
  // this is the first of the two admin-only steps.
  const ours = new Set(accounts.map((a) => a.id));
  const all = await admin.from('matches').select('id, player_a, player_b');
  for (const r of (all.data ?? []) as { id: string; player_a: string; player_b: string }[]) {
    if (ours.has(r.player_a) || ours.has(r.player_b)) {
      const d = await admin.from('matches').delete().eq('id', r.id);
      if (d.error) console.log(`      [cleanup] match ${r.id}: ${d.error.message}`);
    }
  }
  for (const a of accounts) {
    if (!a.id) continue;
    try {
      await as(a, async () => {
        if (a.formatId) await deleteServerFormat(a.formatId);
        for (const t of await listTeams(3)) await deleteTeam(t.id);
      });
    } catch (e) {
      console.log(`      [cleanup] ${a.label} second pass: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await supabase.auth.signOut();
  // The second admin-only step: GoTrue owns auth.users and no client may delete
  // an account. Deleting it cascades the profile every foreign key here points
  // at.
  for (const a of accounts) {
    if (!a.id) continue;
    const { error } = await admin.auth.admin.deleteUser(a.id);
    if (error) console.log(`      [cleanup] account ${a.label}: ${error.message}`);
  }
}

main()
  .then(async () => {
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
