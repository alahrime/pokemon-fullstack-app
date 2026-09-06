/**
 * M3a friendship-and-block round trip: two real confirmed accounts driving
 * request / read-friend-code / block / unblock through the SHIPPING
 * `src/lib/social.ts` module against the real local Postgres.
 *
 * WHY THIS FILE EXISTS: everything else proving M3a is a unit test or a
 * SQL-level test that runs as `set role authenticated` with
 * `set_config('request.jwt.claims', ...)` faked in — never a real signed-in
 * client going through PostgREST. That gap has bitten this repo before (see
 * the header of `m2b-roundtrip.ts`): a mock agrees with whatever it is told,
 * and SQL run as the table owner never meets a policy. The central invariant
 * of this whole milestone — a blocked user must never be able to detect the
 * block — has never been exercised end to end through the shipping client
 * module until this script. It imports `src/lib/social.ts` and never
 * reimplements it, for the same reason `m2b-roundtrip.ts` imports
 * `src/lib/matches.ts`: rows written and read by a reimplementation of the
 * client are rows the client never has to be able to read.
 *
 * The seeded bot accounts (`test-opponent-{1,2}@example.test`, from
 * `opponents.ts`) may or may not exist — repeated `db:reset`s during this
 * milestone have wiped them more than once — so this script depends on
 * neither their presence nor their absence. It creates its OWN two accounts,
 * the same way `opponents.ts` and `m2b-roundtrip.ts` do: sign up through the
 * real client, fetch the confirmation link out of Mailpit, and follow it. An
 * admin-confirmed account never fires `handle_confirmed_user()` and so never
 * gets the profile that `friendships.user_lo` / `user_hi` / `requested_by`
 * and `blocks.blocker_id` / `blocked_id` reference by foreign key — the
 * trigger is what builds it, and there is no shortcut around that.
 *
 * Emails are stamped with the run's timestamp PLUS a few bytes of
 * `Math.random()` (see `stamp` below), not the timestamp alone — two runs
 * launched inside the same millisecond would otherwise mint the same email
 * and collide with `auth.users`' unique constraint on it. That makes every
 * run's accounts disposable and collision-free without a state file to go
 * stale.
 *
 * `blocked_between(uuid, uuid)` is deliberately NOT granted to
 * `authenticated` — it is `security definer` and answers for any pair, so a
 * client able to call it directly would have a working detector for whether
 * two arbitrary strangers have blocked each other, which is exactly the
 * side channel this whole design exists to close (see
 * `20260906001000_friendship_functions.sql`). This script never calls it,
 * from either the bot clients or the admin client — the seven checks below
 * only ever need what a real signed-in client can see, which is the entire
 * point of running them this way.
 *
 * ---------------------------------------------------------------------------
 * RUN IT (from `app/`, against the LOCAL stack only)
 *
 *   ./node_modules/.bin/esbuild tools/m3a-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/m3a.mjs --log-level=warning \
 *     --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
 *   SUPABASE_SERVICE_ROLE_KEY='<SERVICE_ROLE_KEY from `supabase status --workdir ..`>' \
 *     node node_modules/.cache/m3a.mjs
 *
 * The service-role key comes from the environment and is never written into
 * this file: it bypasses every policy in `supabase/migrations`, so a copy of
 * it in the repository would be a copy of it in every clone. It is used for
 * exactly one thing, named again at its call site: deleting the two
 * `auth.users` rows this run creates. GoTrue owns that table and no client
 * may delete a row in it; deleting it cascades the profile (and, from there,
 * `friend_codes`, `friendships` and `blocks`) that every foreign key above
 * points at, so no other admin cleanup is needed.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import {
  listFriends,
  requestFriendship,
  respondToFriendship,
  blockUser,
  listBlocks,
  unblockUser,
  type Friend,
  type FriendshipStatus,
} from '../src/lib/social';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. It is needed for exactly one thing: deleting the\n' +
      'two auth.users rows this run creates (GoTrue owns that table; no client may delete a\n' +
      'row in it). Take it from `supabase status --workdir ..`; never commit it.',
  );
  process.exit(2);
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  console.error(`REFUSING TO RUN: SUPABASE_URL is ${SUPABASE_URL}, which is not the local stack.`);
  process.exit(2);
}

/**
 * The admin client. Separate from `supabase` on purpose — the shipping
 * client is the thing under test and must never hold this key.
 */
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// A results harness that cannot pass for the wrong reason. Verbatim in spirit
// from m2b-roundtrip.ts: every check runs inside a try/catch, so an assertion
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

interface Bot {
  label: string;
  email: string;
  password: string;
  displayName: string;
  goUsername: string;
  /** Only bot1 needs one for this script's reads; both get one for realism. */
  friendCode: string;
  id: string;
}

function makeBot(n: 1 | 2): Bot {
  return {
    label: `bot${n}`,
    email: `m3a-${stamp}-bot${n}@example.test`,
    password: `M3a-Roundtrip-${stamp}-${n}`,
    displayName: `m3a ${stamp} bot${n}`,
    goUsername: `M3A${stamp.replace(/[^a-z0-9]/gi, '').toUpperCase()}BOT${n}`,
    // Obviously fake, and in the shape `friend_codes_twelve_digits` enforces.
    friendCode: `${n}${n}${n}${n} ${n}${n}${n}${n} ${n}${n}${n}${n}`,
    id: '',
  };
}

// Module-level, not local to main(): the abort handler at the bottom of this
// file cleans up whatever exists at the point of failure, and it needs these
// same objects. Building them (no I/O yet — just an object with a freshly
// stamped email) is safe to do unconditionally at load time.
const bot1: Bot = makeBot(1);
const bot2: Bot = makeBot(2);

// ---------------------------------------------------------------------------
// Signup through the real mailbox, verbatim in approach from opponents.ts and
// m2b-roundtrip.ts: the profile trigger reads signup metadata, so an
// admin-created user would have no profile and every foreign key here points
// at one.
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
 * The gate this whole script rests on, same as m2b-roundtrip.ts,
 * opponents.ts and m2a-roundtrip.ts: PostgREST's container can hold a clock a
 * second or two behind GoTrue's, which makes a freshly issued JWT "issued at
 * future" and gets every request refused — indistinguishable from a policy
 * denying the write. Poll a trivial authenticated select until it comes back
 * clean AND returns this account's own profile row, which also confirms
 * `handle_confirmed_user()` built the profile that `friendships` and
 * `blocks` reference by foreign key.
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
        go_username: b.goUsername,
        birth_date: '1990-01-01',
        friend_code: b.friendCode,
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

/**
 * An unfiltered-by-nothing-but-id read of `friend_codes`, through whichever
 * bot is currently the caller. Used to prove checks 2, 3 and 4: zero rows is
 * asserted by array length, never by a truthy/falsy value on `.single()` or
 * similar, because a `.single()` miss and a policy denial can both surface as
 * "no data" while meaning very different things.
 */
async function readFriendCode(reader: Bot, ownerId: string): Promise<{ rows: number; code: string | null }> {
  const { data, error } = await supabase.from('friend_codes').select('code').eq('profile_id', ownerId);
  if (error) throw new Error(`${reader.label}'s friend_codes read errored rather than returning nothing: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`${reader.label}'s friend_codes read returned non-array data: ${show(data)}`);
  return { rows: data.length, code: data.length === 1 ? ((data[0] as { code: string }).code ?? null) : null };
}

function friendRow(friends: Friend[], otherId: string): Friend | undefined {
  return friends.find((f) => f.otherId === otherId);
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`M3a round trip — run ${stamp}\n`);

  await check('0a. bot1 registers, confirms through Mailpit, and gets a profile + friend code', async () => {
    await register(bot1);
    return `bot1 ${bot1.id} <${bot1.email}> friend code ${bot1.friendCode}`;
  });
  await check('0b. bot2 registers, confirms through Mailpit, and gets a profile + friend code', async () => {
    await register(bot2);
    return `bot2 ${bot2.id} <${bot2.email}> friend code ${bot2.friendCode}`;
  });
  if (failures > 0) throw new Error('registration gate failed; nothing after it would mean anything');

  // =========================================================================
  await check(
    "1. bot1 requests bot2 -> pending; bot2's listFriends() shows it with theyAsked: true",
    async () => {
      const status: FriendshipStatus = await as(bot1, () => requestFriendship(bot2.id));
      assert(status === 'pending', `requestFriendship(bot1 -> bot2) returned ${show(status)}, expected 'pending'`);

      const bot2View = await as(bot2, listFriends);
      const row = friendRow(bot2View, bot1.id);
      assert(!!row, `bot2's listFriends() does not contain bot1 at all: ${show(bot2View)}`);
      assert(row!.status === 'pending', `bot2 sees status ${show(row!.status)}, expected 'pending'`);
      assert(row!.theyAsked === true, `bot2 sees theyAsked ${show(row!.theyAsked)}, expected true (bot1 asked)`);
      return `requestFriendship(bot1 -> bot2) -> 'pending'; bot2's listFriends() shows bot1 as {status: 'pending', theyAsked: true}`;
    },
  );

  // =========================================================================
  await check(
    '2. bot2 cannot yet read bot1\'s friend code — ZERO ROWS through PostgREST, not an error',
    async () => {
      const read = await as(bot2, () => readFriendCode(bot2, bot1.id));
      assert(read.rows === 0, `bot2 read ${read.rows} row(s) of bot1's friend_codes before accepting, expected 0`);
      return `bot2's select on friend_codes.profile_id = bot1.id returns exactly 0 rows, not an error`;
    },
  );

  // =========================================================================
  await check(
    "3. bot2 accepts -> accepted; now bot2 reads bot1's friend code and gets the real value",
    async () => {
      const status = await as(bot2, () => respondToFriendship(bot1.id, true));
      assert(status === 'accepted', `respondToFriendship(bot2, accept) returned ${show(status)}, expected 'accepted'`);

      const bot2View = await as(bot2, listFriends);
      const row = friendRow(bot2View, bot1.id);
      assert(!!row && row.status === 'accepted', `bot2's listFriends() shows ${show(row)}, expected status 'accepted'`);

      const read = await as(bot2, () => readFriendCode(bot2, bot1.id));
      assert(read.rows === 1, `bot2 read ${read.rows} row(s) of bot1's friend_codes after accepting, expected exactly 1`);
      assert(
        read.code === bot1.friendCode,
        `bot2 read bot1's friend code as ${show(read.code)}, expected ${show(bot1.friendCode)}`,
      );
      return `respondToFriendship(bot2, accept) -> 'accepted'; bot2 now reads bot1's friend code as ${read.code}`;
    },
  );

  // =========================================================================
  await check(
    "4. bot1 blocks bot2; bot1's listFriends() is empty; the friend-code read returns zero rows again",
    async () => {
      const blocked = await as(bot1, () => blockUser(bot2.id));
      assert(blocked === true, `blockUser(bot1 -> bot2) returned ${show(blocked)}, expected true`);

      const bot1View = await as(bot1, listFriends);
      assert(bot1View.length === 0, `bot1's listFriends() shows ${show(bot1View)} after blocking, expected []`);

      const read = await as(bot2, () => readFriendCode(bot2, bot1.id));
      assert(read.rows === 0, `bot2 read ${read.rows} row(s) of bot1's friend_codes after the block, expected 0 again`);
      return `blockUser(bot1 -> bot2) -> true; bot1's listFriends() is []; bot2's read of bot1's friend code is 0 rows again`;
    },
  );

  // =========================================================================
  await check(
    "5. THE CHECK THAT MATTERS: bot2's listBlocks() is empty AND listFriends() is empty — the block is invisible from the blocked side",
    async () => {
      const bot2Blocks = await as(bot2, listBlocks);
      assert(
        bot2Blocks.length === 0,
        `bot2's listBlocks() returns ${show(bot2Blocks)} — the blocked side can see it was blocked, which must never happen`,
      );
      const bot2Friends = await as(bot2, listFriends);
      assert(
        bot2Friends.length === 0,
        `bot2's listFriends() returns ${show(bot2Friends)} after being blocked, expected [] — a torn-down friendship must not remain visible`,
      );
      return `bot2's listBlocks() is []; bot2's listFriends() is []; the block leaves nothing for the blocked side to see`;
    },
  );

  // =========================================================================
  let refusalForBlockedPair = '';
  let refusalForRandomUuid = '';
  await check(
    '6. bot2 requesting bot1 raises exactly "that person cannot be sent a friend request" — the SAME sentence a random, nonexistent uuid produces',
    async () => {
      try {
        await as(bot2, () => requestFriendship(bot1.id));
        throw new Error('requestFriendship(bot2 -> blocked bot1) did not raise at all');
      } catch (e) {
        refusalForBlockedPair = e instanceof Error ? e.message : String(e);
      }

      const nonexistent = '00000000-0000-4000-8000-000000000000';
      try {
        await as(bot2, () => requestFriendship(nonexistent));
        throw new Error('requestFriendship(bot2 -> a random nonexistent uuid) did not raise at all');
      } catch (e) {
        refusalForRandomUuid = e instanceof Error ? e.message : String(e);
      }

      const expected = 'that person cannot be sent a friend request';
      assert(
        refusalForBlockedPair === expected,
        `blocked-pair request raised ${show(refusalForBlockedPair)}, expected exactly ${show(expected)}`,
      );
      assert(
        refusalForRandomUuid === expected,
        `nonexistent-uuid request raised ${show(refusalForRandomUuid)}, expected exactly ${show(expected)}`,
      );
      assert(
        refusalForBlockedPair === refusalForRandomUuid,
        `the two refusals differ: blocked-pair ${show(refusalForBlockedPair)} vs nonexistent-uuid ${show(refusalForRandomUuid)} — a caller could tell them apart`,
      );
      return `both raised the identical string: ${show(refusalForBlockedPair)}`;
    },
  );

  // =========================================================================
  await check(
    '7. bot1 unblocks; a fresh request from bot2 returns pending again',
    async () => {
      await as(bot1, () => unblockUser(bot2.id));
      const bot1Blocks = await as(bot1, listBlocks);
      assert(
        !bot1Blocks.includes(bot2.id),
        `bot1's listBlocks() still contains bot2 (${show(bot1Blocks)}) after unblockUser`,
      );

      const status = await as(bot2, () => requestFriendship(bot1.id));
      assert(status === 'pending', `requestFriendship(bot2 -> bot1) after the unblock returned ${show(status)}, expected 'pending'`);
      return `unblockUser(bot1, bot2) removed the block; a fresh requestFriendship(bot2 -> bot1) -> 'pending'`;
    },
  );
}

/**
 * Undo everything. The only admin step is deleting the two `auth.users`
 * rows — GoTrue owns that table and no client may delete a row in it.
 * Deleting it cascades the profile (and from there `friend_codes`,
 * `friendships`, `blocks`) every foreign key above points at, so nothing
 * else needs a manual delete: `friendships` and `blocks` both reference
 * `profiles (id) on delete cascade`.
 */
async function cleanup(): Promise<void> {
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
