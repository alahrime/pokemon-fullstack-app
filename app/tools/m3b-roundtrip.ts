/**
 * M3b channel round trip: two real confirmed accounts (plus a disposable
 * third) driving DMs, a match channel, message reports and a block through
 * the SHIPPING `src/lib/channels.ts` and `src/lib/social.ts` modules against
 * the real local Postgres AND the real local Realtime server.
 *
 * WHY THIS FILE EXISTS: everything else proving M3b is a unit test (a mocked
 * Supabase client, which agrees with whatever it is told) or a SQL-level test
 * (run as `set role authenticated` with a faked JWT, which never goes through
 * PostgREST or a real websocket). Two things in this milestone cannot be
 * proven either way:
 *
 *   - The `supabase_realtime` publication is server configuration, not code.
 *     Before Task 5 it held NO tables. If `messages` were ever dropped from
 *     it, a `postgres_changes` subscription would receive nothing at all —
 *     no error, no warning, an empty chat that looks like a network problem.
 *     Check 3 below is the only thing in this project that would notice.
 *   - RLS enforced through PostgREST as a genuinely signed-in client, not
 *     through `set_config('request.jwt.claims', ...)` faked in as the table
 *     owner.
 *
 * It imports the SHIPPING modules and never reimplements their logic, for
 * the same reason `m3a-roundtrip.ts` and `m2b-roundtrip.ts` do: rows written
 * and read by a reimplementation of the client are rows the client never has
 * to be able to read.
 *
 * Emails are stamped with the run's timestamp plus a few bytes of
 * `Math.random()` (see `stamp` below), not the timestamp alone — two runs
 * launched inside the same millisecond would otherwise mint the same email
 * and collide with `auth.users`' unique constraint on it.
 *
 * THE TWO-CLIENT TRICK (check 3 only): every other check in this file drives
 * both bots through the single app singleton `supabase`, signing in as
 * whichever bot is acting immediately before it acts — fine when nothing
 * needs two identities alive at once. Check 3 does: bot2's `subscribeToChannel`
 * has to stay authenticated and joined as bot2 for the whole wait, while bot1
 * sends. Signing bot1 in on that SAME singleton mid-wait would swap the
 * session the websocket's `postgres_changes` authorization is pinned to out
 * from under bot2's live subscription (Supabase pushes the new access token
 * to every already-joined channel on sign-in) — which would stop testing
 * "bot2, as itself, receives what bot1 sent" and start testing something
 * murkier that happens to still pass because bot1 is also a member. So bot1
 * sends that one message on a second, genuinely independent client — exactly
 * what a second real browser tab would be — while bot2's subscription stays
 * on the untouched singleton the whole time.
 *
 * `is_channel_member(p_channel uuid)` takes ONE argument, caller-scoped —
 * every call site derives the caller from `auth.uid()` internally, so this
 * script never passes another user's id to it (it cannot; there is no
 * two-argument variant, deliberately: see `20260907000000_channels_and_members.sql`).
 * `are_friends`, `share_a_live_match` and `blocked_between` are NOT granted to
 * `authenticated` — they are SECURITY DEFINER and answer for any arbitrary
 * pair, so a client able to call them directly would have a working detector
 * for strangers' relationships. This script never calls any of the three,
 * from either bot client or the admin client. `blocked_with_me(p_other)` and
 * `i_blocked(p_other)` ARE granted and caller-scoped, but this script never
 * needs to call either — check 8 only needs to observe the refusals they
 * produce indirectly, through the `messages` INSERT policy.
 *
 * Check 8 asserts a REFUSAL, not concealment: Ruling B5 in this plan's
 * progress ledger (2026-09-06) is a product decision that a block being
 * detectable by a participant is accepted behaviour — the `messages` INSERT
 * policy's refusal is observable by design, and that is intended, not a gap.
 * Do not "fix" check 8 into asserting silence.
 *
 * Check 8 asserts a SYMMETRIC refusal in the DM, a later product ruling on
 * top of B5: a block inside a DM now silences BOTH parties, not just the
 * blocked one (see `20260907003000_messages.sql`'s `i_blocked` and the
 * `kind = 'dm'` branch of the INSERT policy). This is a deliberate behaviour
 * change from this script's earlier version, which asserted the opposite —
 * that the blocker could still post ("one-directional") — because a DM with
 * only two members has nobody else for a directional block to protect, and
 * the previous rule left the blocked party still receiving every message
 * live while unable to answer. A group or match channel is unaffected: there
 * a symmetric rule would mute a blocker to every OTHER member of the room
 * over a block aimed at just one of them, so `blocked_with_me` alone still
 * governs there, unchanged.
 *
 * ---------------------------------------------------------------------------
 * RUN IT (from `app/`, against the LOCAL stack only, WITH `edge_runtime` up —
 * this script does not call the coordinator, but the brief requires the full
 * stack running)
 *
 *   KEY=$(npx supabase status --workdir .. 2>/dev/null | python3 -c \
 *     "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
 *   ./node_modules/.bin/esbuild tools/m3b-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/m3b.mjs --log-level=warning \
 *     --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
 *   SUPABASE_SERVICE_ROLE_KEY="$KEY" node node_modules/.cache/m3b.mjs
 *
 * The service-role key comes from the environment and is never written into
 * this file: it bypasses every policy in `supabase/migrations`, so a copy of
 * it in the repository would be a copy of it in every clone. It is used for
 * exactly four things, each named at its call site: inserting a `matches` row
 * (there is deliberately no client INSERT policy on that table), forcing a
 * message's `expires_at` into the past, calling `sweep_messages()` (granted to
 * `service_role` only), and — in cleanup and its verification — deleting the
 * `matches` row this run created, deleting the three accounts, and counting
 * what (if anything) is left behind.
 *
 * `VITE_SUPABASE_ANON_KEY` is read from `import.meta.env`, the same way
 * `src/lib/supabase.ts` reads it, so that the SECOND client this script opens
 * for check 3 is built from the exact same public key the app ships — never
 * hardcoded here as a second literal.
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { DATA_REV } from '../src/lib/data';
import type { StoredMember } from '../src/lib/teamCodec';
import type { Format } from '../src/rules';
import { saveServerFormat, deleteServerFormat, listServerFormats } from '../src/lib/saves';
import {
  listChannels,
  listMessages,
  sendMessage,
  openDm,
  reportMessage,
  subscribeToChannel,
  type Message,
} from '../src/lib/channels';
import { requestFriendship, respondToFriendship, blockUser } from '../src/lib/social';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. It is needed to insert a `matches` row (no client\n' +
      'INSERT policy exists on that table, by design), to force a message\'s `expires_at` into\n' +
      'the past, to call `sweep_messages()` (granted to service_role only), and to delete the\n' +
      'match and the three accounts this run creates. Take it from `supabase status --workdir ..`;\n' +
      'never commit it.',
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
// from m2b-roundtrip.ts and m3a-roundtrip.ts: every check runs inside a
// try/catch, so an assertion that raises is recorded as a FAILURE rather than
// crashing the run and leaving earlier PASSes on screen as if they were the
// whole story.
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

/** One ruleset, saved once, referenced by the match created in check 4. */
const RULES: Format = {
  schema: 1,
  base: 'great',
  start: 'empty',
  pool: [{ effect: 'allow', select: 'type:steel', note: 'fixture format, contents do not matter' }],
  composition: { size: 3 },
  selection: { mode: 'open' },
};

/** Arbitrary rosters — `matches.team_a`/`team_b` is jsonb with no shape check
 *  of its own, and nothing in this script exercises the report ladder, so
 *  anything StoredMember-shaped will do. */
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

const REALTIME_PROBE_BODY = `m3b realtime probe ${stamp}`;

interface Bot {
  label: string;
  email: string;
  password: string;
  displayName: string;
  id: string;
}

function makeBot(n: 1 | 2 | 3): Bot {
  return {
    label: `bot${n}`,
    email: `m3b-${stamp}-bot${n}@example.test`,
    password: `M3b-Roundtrip-${stamp}-${n}`,
    displayName: `m3b ${stamp} bot${n}`,
    id: '',
  };
}

// Module-level, not local to main(): the abort handler at the bottom of this
// file cleans up whatever exists at the point of failure, and it needs these
// same objects. Building them (no I/O yet — just an object with a freshly
// stamped email) is safe to do unconditionally at load time.
const bot1: Bot = makeBot(1);
const bot2: Bot = makeBot(2);
/** The throwaway third account for check 7 — friend of neither bot. */
const bot3: Bot = makeBot(3);

let dmId = '';
let matchId = '';
let matchChannelId = '';
let realtimeMessageId = '';
let versionId = '';
let rulesHash = '';

// ---------------------------------------------------------------------------
// Signup through the real mailbox, verbatim in approach from opponents.ts,
// m2b-roundtrip.ts and m3a-roundtrip.ts: the profile trigger reads signup
// metadata, so an admin-created user would have no profile and
// `channel_members.user_id` / `matches.player_a` / `matches.player_b` /
// `message_reports.reporter_id` all reference one by foreign key.
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
 * m3a-roundtrip.ts and opponents.ts: PostgREST's container can hold a clock a
 * second or two behind GoTrue's, which makes a freshly issued JWT "issued at
 * future" and gets every request refused — indistinguishable from a policy
 * denying the write. Poll a trivial authenticated select until it comes back
 * clean AND returns this account's own profile row, which also confirms
 * `handle_confirmed_user()` built the profile every foreign key above needs.
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
        go_username: `M3B${stamp.replace(/[^a-z0-9]/gi, '').toUpperCase()}${b.label.toUpperCase()}`,
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
// so — like m2b-roundtrip.ts's `makeMatch` — this is the admin client doing
// something no client is permitted to do. The point of this insert is not the
// match itself; it is that `matches_get_a_channel` (the AFTER INSERT trigger
// added in this milestone) fires and gives it a `kind='match'` channel with
// both players as members.
// ---------------------------------------------------------------------------
async function makeMatch(formatVersionId: string, rulesHashArg: string, seed: string): Promise<string> {
  const { data, error } = await admin
    .from('matches')
    .insert({
      player_a: bot1.id,
      player_b: bot2.id,
      format_version_id: formatVersionId,
      rules_hash: rulesHashArg,
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

/** A snapshot of table sizes this script does not own, printed before setup
 *  and again after cleanup so a reader can see the run leaves the shared
 *  local stack no bigger than it found it — not asserted against directly
 *  (other fixtures may come and go on this machine independently of this
 *  run), which is why `verifyCleanup` below asserts something narrower and
 *  load-bearing: zero rows scoped to THIS run's own three account ids. */
async function globalCounts(): Promise<Record<string, number | null>> {
  const [profiles, channels, messages, matches] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('channels').select('id', { count: 'exact', head: true }),
    admin.from('messages').select('id', { count: 'exact', head: true }),
    admin.from('matches').select('id', { count: 'exact', head: true }),
  ]);
  return {
    profiles: profiles.count ?? null,
    channels: channels.count ?? null,
    messages: messages.count ?? null,
    matches: matches.count ?? null,
  };
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`M3b round trip — run ${stamp}\n`);
  console.log(`before this run (shared local stack, informational only): ${show(await globalCounts())}\n`);

  await check('0a. bot1 registers, confirms through Mailpit, and gets a profile', async () => {
    await register(bot1);
    return `bot1 ${bot1.id} <${bot1.email}>`;
  });
  await check('0b. bot2 registers, confirms through Mailpit, and gets a profile', async () => {
    await register(bot2);
    return `bot2 ${bot2.id} <${bot2.email}>`;
  });
  await check('0c. bot3 (the throwaway, friend of neither) registers and gets a profile', async () => {
    await register(bot3);
    return `bot3 ${bot3.id} <${bot3.email}>`;
  });
  if (failures > 0) throw new Error('registration gate failed; nothing after it would mean anything');

  await check('0d. a format_versions row exists for check 4\'s match to reference', async () => {
    await as(bot1, async () => {
      const formatId = await saveServerFormat({ name: `m3b ${stamp}`, format: RULES });
      const saved = (await listServerFormats()).find((f) => f.id === formatId);
      if (!saved) throw new Error('saved a format it cannot then list');
      versionId = saved.versionId;
      rulesHash = saved.rulesHash;
    });
    return `format_versions ${versionId}, rules_hash ${rulesHash}`;
  });
  if (failures > 0) throw new Error('no format_versions row; check 4\'s match insert would fail its foreign key');

  // =========================================================================
  await check(
    '1. not yet friends: openDm(bot1) from bot2 raises exactly "that person cannot be messaged"',
    async () => {
      let message = '';
      try {
        await as(bot2, () => openDm(bot1.id));
        throw new Error('openDm did not raise at all');
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      assert(
        message === 'that person cannot be messaged',
        `openDm raised ${show(message)}, expected exactly 'that person cannot be messaged'`,
      );
      return `openDm(bot2 -> bot1) before any friendship raised: "${message}"`;
    },
  );

  // =========================================================================
  await check(
    '2. befriending through the real RPCs makes openDm return a channel id; the OTHER bot gets the SAME id',
    async () => {
      const reqStatus = await as(bot1, () => requestFriendship(bot2.id));
      assert(reqStatus === 'pending', `requestFriendship(bot1 -> bot2) returned ${show(reqStatus)}, expected 'pending'`);
      const respStatus = await as(bot2, () => respondToFriendship(bot1.id, true));
      assert(respStatus === 'accepted', `respondToFriendship(bot2, accept) returned ${show(respStatus)}, expected 'accepted'`);

      const fromBot1 = await as(bot1, () => openDm(bot2.id));
      const fromBot2 = await as(bot2, () => openDm(bot1.id));
      assert(!!fromBot1, 'openDm(bot1 -> bot2) returned a falsy id');
      assert(
        fromBot1 === fromBot2,
        `openDm returned different ids depending on the caller: bot1 got ${fromBot1}, bot2 got ${fromBot2}`,
      );
      dmId = fromBot1;
      return `requestFriendship -> 'pending'; respondToFriendship(accept) -> 'accepted'; openDm from both bots returns the same channel ${dmId}`;
    },
  );
  if (failures > 0) throw new Error('no DM channel; every check after this one needs it');

  // =========================================================================
  await check(
    "3. THE CHECK THIS SCRIPT EXISTS FOR: bot1 sends into the DM; bot2's live subscribeToChannel delivers it within 5s",
    async () => {
      // bot2 is the RECEIVER, on the app's own singleton client — exactly the
      // `subscribeToChannel` code path the chat screen calls. This stays the
      // ONLY identity signed in on `supabase` for the whole check.
      await signIn(bot2);
      let resolveReceived!: (m: Message) => void;
      const waitForIt = new Promise<Message>((resolve) => {
        resolveReceived = resolve;
      });
      const stop = subscribeToChannel(dmId, (m) => resolveReceived(m));

      // Give the websocket a moment to actually join the channel and have the
      // server start streaming it postgres_changes before bot1 sends — a send
      // issued before the join completes would legitimately go unseen and
      // would say nothing about whether the realtime publication is wired.
      await sleep(1500);

      // bot1 sends on a SECOND, independent client (see the file header for
      // why: signing bot1 in on the singleton mid-wait would swap the token
      // bot2's live subscription is authorized under). This is exactly what a
      // second real browser tab would be, holding its own session.
      const bot1Client = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signedIn = await bot1Client.auth.signInWithPassword({ email: bot1.email, password: bot1.password });
      if (signedIn.error || !signedIn.data.session) {
        stop();
        throw new Error(`bot1's second client could not sign in: ${signedIn.error?.message ?? 'no session'}`);
      }
      // The same insert `sendMessage` (src/lib/channels.ts) performs, issued
      // from this second client so it carries bot1's session rather than
      // bot2's — RLS and the trigger it fires do not care which JS object
      // issued the HTTP request, only which JWT came with it.
      const inserted = await bot1Client
        .from('messages')
        .insert({ channel_id: dmId, body: REALTIME_PROBE_BODY })
        .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
        .single();
      if (inserted.error) {
        stop();
        throw new Error(`bot1 could not send the realtime probe message: ${inserted.error.message}`);
      }
      realtimeMessageId = (inserted.data as { id: string }).id;
      await bot1Client.auth.signOut();

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              'TIMED OUT after 5000ms: subscribeToChannel never delivered the message bot1 sent.\n' +
                '        THIS IS THE FAILURE THIS SCRIPT EXISTS TO CATCH — either the\n' +
                '        supabase_realtime publication no longer contains `messages`, or\n' +
                '        postgres_changes authorization is refusing bot2. Check with:\n' +
                "        docker exec supabase_db_paragon-iv psql -U postgres -tAc \"select tablename from pg_publication_tables where pubname='supabase_realtime'\"",
            ),
          );
        }, 5000);
      });

      let delivered: Message;
      try {
        delivered = await Promise.race([waitForIt, timeout]);
      } finally {
        stop();
      }
      assert(
        delivered.id === realtimeMessageId,
        `bot2 received message ${delivered.id}, which is not the one bot1 sent (${realtimeMessageId})`,
      );
      assert(delivered.authorId === bot1.id, `the delivered message's author is ${delivered.authorId}, expected bot1 (${bot1.id})`);
      assert(
        delivered.body === REALTIME_PROBE_BODY,
        `the delivered body is ${show(delivered.body)}, expected ${show(REALTIME_PROBE_BODY)}`,
      );
      return `bot1 sent message ${realtimeMessageId} on a second client; bot2's subscribeToChannel delivered it live, well under 5s (author ${delivered.authorId})`;
    },
  );

  // =========================================================================
  await check(
    '4. a match between bot1 and bot2 (service role) gets a match channel; both are members and both can listMessages on it',
    async () => {
      matchId = await makeMatch(versionId, rulesHash, `${stamp}-match`);

      const bot1Channels = await as(bot1, listChannels);
      const bot1View = bot1Channels.find((c) => c.matchId === matchId);
      assert(
        !!bot1View,
        `bot1's listChannels() has no channel for match ${matchId}: ${show(bot1Channels.map((c) => ({ id: c.id, kind: c.kind, matchId: c.matchId })))}`,
      );
      assert(bot1View!.kind === 'match', `the match channel's kind is ${show(bot1View!.kind)}, expected 'match'`);
      matchChannelId = bot1View!.id;

      const bot2Channels = await as(bot2, listChannels);
      const bot2Sees = bot2Channels.some((c) => c.id === matchChannelId);
      assert(bot2Sees, `bot2's listChannels() does not include match channel ${matchChannelId}`);

      const bot1Messages = await as(bot1, () => listMessages(matchChannelId));
      assert(Array.isArray(bot1Messages), "bot1's listMessages on the match channel did not return an array");
      const bot2Messages = await as(bot2, () => listMessages(matchChannelId));
      assert(Array.isArray(bot2Messages), "bot2's listMessages on the match channel did not return an array");

      return `match ${matchId} -> channel ${matchChannelId}; both bot1 and bot2 see it in listChannels() and both can listMessages() on it`;
    },
  );

  // =========================================================================
  await check(
    "5. bot2 reports bot1's realtime-probe message; bot1's own read of message_reports for it returns ZERO rows",
    async () => {
      const reportId = await as(bot2, () => reportMessage(realtimeMessageId, 'm3b roundtrip check 5'));
      assert(!!reportId, `reportMessage returned falsy: ${show(reportId)}`);

      const bot1Read = await as(bot1, async () =>
        supabase.from('message_reports').select('*').eq('message_id', realtimeMessageId),
      );
      if (bot1Read.error) {
        throw new Error(`bot1's read of message_reports errored rather than returning nothing: ${bot1Read.error.message}`);
      }
      assert(
        Array.isArray(bot1Read.data) && bot1Read.data.length === 0,
        `bot1 (the reported message's author) can see ${bot1Read.data?.length ?? 'null'} report row(s): ` +
          `${show(bot1Read.data)} — an author must never learn they were reported`,
      );
      return `reportMessage(bot2, msg ${realtimeMessageId}) -> report ${reportId}; bot1's own select on message_reports for it returns exactly 0 rows`;
    },
  );

  // =========================================================================
  await check(
    "6. forcing that message's expires_at into the past and running sweep_messages: it SURVIVES because its report is still open",
    async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const forced = await admin
        .from('messages')
        .update({ expires_at: past })
        .eq('id', realtimeMessageId)
        .select('id, expires_at');
      if (forced.error) throw new Error(`admin could not force expires_at into the past: ${forced.error.message}`);
      assert((forced.data ?? []).length === 1, `forcing expires_at touched ${show(forced.data)} row(s), expected 1`);

      const swept = await admin.rpc('sweep_messages');
      if (swept.error) throw new Error(`admin's sweep_messages() call failed: ${swept.error.message}`);

      const after = await admin.from('messages').select('id').eq('id', realtimeMessageId);
      if (after.error) throw new Error(`could not re-read the message after the sweep: ${after.error.message}`);
      assert(
        (after.data ?? []).length === 1,
        `message ${realtimeMessageId} is GONE after sweep_messages() despite an open report — retention must hold a reported message`,
      );
      return `expires_at forced to ${past}; sweep_messages() removed ${show(swept.data)} row(s) total; message ${realtimeMessageId} still exists — its open report held it`;
    },
  );

  // =========================================================================
  await check(
    '7. bot3, a throwaway friend of neither, sees none of the DM or match channels in its own listChannels()',
    async () => {
      const bot3Channels = await as(bot3, listChannels);
      const leaked = bot3Channels.filter((c) => c.id === dmId || c.id === matchChannelId);
      assert(leaked.length === 0, `bot3 can see ${show(leaked)} — a non-member must never see these channels`);
      return `bot3's listChannels() returns ${bot3Channels.length} channel(s), none of them the DM (${dmId}) or the match channel (${matchChannelId})`;
    },
  );

  // =========================================================================
  await check(
    '8. bot1 blocks bot2: a DM block is SYMMETRIC — neither bot2 nor bot1 (the blocker) can post into the shared DM',
    async () => {
      const blocked = await as(bot1, () => blockUser(bot2.id));
      assert(blocked === true, `blockUser(bot1 -> bot2) returned ${show(blocked)}, expected true`);

      // Ruling B5 (progress.md, 2026-09-06): a block being detectable by a
      // participant is accepted product behaviour. This asserts the refusal
      // itself, not that it is indistinguishable from any other refusal.
      let bot2Refusal = '';
      try {
        await as(bot2, () => sendMessage(dmId, 'bot2 trying to speak after being blocked'));
        throw new Error('bot2 sendMessage after the block did not raise at all');
      } catch (e) {
        bot2Refusal = e instanceof Error ? e.message : String(e);
      }
      assert(bot2Refusal.length > 0, 'bot2 was not refused with any message');

      // Product ruling (2026-09-06, see this file's header): in a DM the
      // block is symmetric, so bot1 — the blocker, who chose to stay in this
      // conversation — is now ALSO refused. This is a deliberate reversal of
      // this check's earlier assertion that bot1 "still succeeds
      // (one-directional)"; a DM has only two members, so the old directional
      // rule left bot2 muted while bot1 kept broadcasting into a channel bot2
      // could not answer in — the harassment primitive the product ruling
      // exists to close.
      let bot1Refusal = '';
      try {
        await as(bot1, () => sendMessage(dmId, 'bot1 trying to speak after blocking bot2'));
        throw new Error("bot1 sendMessage after blocking bot2 did not raise at all — a DM block must be symmetric");
      } catch (e) {
        bot1Refusal = e instanceof Error ? e.message : String(e);
      }
      assert(bot1Refusal.length > 0, 'bot1 (the blocker) was not refused with any message');

      return `blockUser(bot1 -> bot2) -> true; bot2's sendMessage raised "${bot2Refusal}"; bot1's own sendMessage (the blocker) also raised "${bot1Refusal}"`;
    },
  );
}

/**
 * Undo everything, in dependency order. `format_versions` is ON DELETE
 * RESTRICT from `matches`, so the match must go before the format or the
 * format delete is refused — that is the guarantee working, not a bug.
 * Deleting the `matches` row cascades its channel (`channels.match_id`
 * references `matches (id) on delete cascade`), which cascades that
 * channel's members and any messages in it. Deleting each `auth.users` row
 * is the only other admin step — GoTrue owns that table, deleting it
 * cascades the profile, and `channels.created_by` / `messages.author_id` /
 * `message_reports.reporter_id` / `friendships` / `blocks` all reference a
 * profile `on delete cascade`, which is what takes the DM channel (created by
 * bot1) and everything written into it with it.
 */
async function cleanup(): Promise<void> {
  if (matchId) {
    const d = await admin.from('matches').delete().eq('id', matchId);
    if (d.error) console.log(`      [cleanup] match ${matchId}: ${d.error.message}`);
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
  for (const b of [bot1, bot2, bot3]) {
    if (!b.id) continue;
    const { error } = await admin.auth.admin.deleteUser(b.id);
    if (error) console.log(`      [cleanup] account ${b.label}: ${error.message}`);
  }
}

/**
 * Cleanup is only worth trusting if it is measured, not assumed — a fixture
 * that always exits 0 is not a test, and neither is a cleanup step nobody
 * checked. This scopes the check to rows tied to THIS run's three account
 * ids specifically (rather than a raw global before/after count, which the
 * shared local stack could move for reasons that have nothing to do with
 * this run) and folds it into the same pass/fail ladder as the eight checks
 * above, so a leak here fails the run's exit code too.
 */
async function verifyCleanup(): Promise<void> {
  const ids = [bot1.id, bot2.id, bot3.id].filter((id): id is string => !!id);
  if (ids.length === 0) {
    console.log('CLEANUP  nothing to verify — no account ever got an id');
    return;
  }
  await check('cleanup. every row this run created is gone', async () => {
    const notes: string[] = [];
    let leftover = 0;

    const users = await admin.auth.admin.listUsers();
    if (users.error) throw new Error(`could not list auth.users to verify cleanup: ${users.error.message}`);
    const stillThere = users.data.users.filter((u) => ids.includes(u.id));
    leftover += stillThere.length;
    notes.push(`auth.users: ${stillThere.length} of ${ids.length} accounts remain`);

    const chans = await admin.from('channels').select('id', { count: 'exact', head: true }).in('created_by', ids);
    if (chans.error) throw new Error(`could not count leftover channels: ${chans.error.message}`);
    leftover += chans.count ?? 0;
    notes.push(`channels created_by these bots: ${chans.count ?? 0}`);

    const msgs = await admin.from('messages').select('id', { count: 'exact', head: true }).in('author_id', ids);
    if (msgs.error) throw new Error(`could not count leftover messages: ${msgs.error.message}`);
    leftover += msgs.count ?? 0;
    notes.push(`messages authored by these bots: ${msgs.count ?? 0}`);

    const reports = await admin.from('message_reports').select('id', { count: 'exact', head: true }).in('reporter_id', ids);
    if (reports.error) throw new Error(`could not count leftover message_reports: ${reports.error.message}`);
    leftover += reports.count ?? 0;
    notes.push(`message_reports filed by these bots: ${reports.count ?? 0}`);

    const matchesLeft = await admin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`player_a.in.(${ids.join(',')}),player_b.in.(${ids.join(',')})`);
    if (matchesLeft.error) throw new Error(`could not count leftover matches: ${matchesLeft.error.message}`);
    leftover += matchesLeft.count ?? 0;
    notes.push(`matches involving these bots: ${matchesLeft.count ?? 0}`);

    assert(leftover === 0, `cleanup left rows behind — ${notes.join('; ')}`);
    return notes.join('; ');
  });
}

main()
  .then(async () => {
    await cleanup();
    await verifyCleanup();
    console.log(`\nafter cleanup (shared local stack, informational only): ${show(await globalCounts())}`);
    console.log(`\n${passes} passed, ${failures} failed`);
    if (failures > 0) console.log(`failed: ${failed.join(', ')}`);
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.log(`\nABORTED: ${e instanceof Error ? e.stack : String(e)}`);
    try {
      await cleanup();
      await verifyCleanup();
      console.log('cleanup ran after the abort');
    } catch (c) {
      console.log(`cleanup after abort also failed: ${c instanceof Error ? c.message : String(c)}`);
    }
    console.log(`${passes} passed, ${failures} failed before the abort`);
    process.exit(1);
  });
