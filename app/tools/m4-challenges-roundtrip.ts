/**
 * M4 challenges round trip: three real confirmed accounts driving challenges
 * (aimed match offers) through the SHIPPING `src/lib/challenges.ts`,
 * `src/lib/matchmaking.ts`, `src/lib/channels.ts`, `src/lib/saves.ts` and
 * `src/lib/social.ts` modules against the real local Postgres, PostgREST and
 * coordinator Edge Function. Structure, signup-through-Mailpit and the
 * PASS/FAIL harness are m3b-roundtrip.ts's; the coordinator tick is
 * m2a-roundtrip.ts's.
 *
 * FORMATS: a challenge is played on the proposer's OWN format, private, saved
 * through `saveServerFormat` — no admin write stands in for a client here.
 * `20260929000100_challenge_formats.sql` lets the target read that one format
 * while the owner's offer on it exists; check 2b proves the target reads it
 * and nothing else of the proposer's, and check 2c that someone else's
 * private format is refused.
 *
 * THE COORDINATOR: the pg_cron job `coordinator-tick` runs every minute, but
 * locally `coordinator_tick()` is a no-op unless the vault secrets
 * `coordinator_url` / `coordinator_service_role_key` are set (they were not
 * when this was written). If they are, cron could verify a challenge between
 * two lines of this script, so check 3 reads `verifiedHash` through
 * `fetchChallenges` right before the refused accept and FAILS loudly (rerun)
 * rather than skipping, and after forcing a tick asserts on the offer's own
 * state, not on the tick's global `verified` count. The forced tick POSTs the function
 * URL with the service-role key, exactly as m2a does; before it, a guard
 * refuses to tick if any row the tick could CHANGE belongs to someone else
 * (a foreign queue entry, a foreign unverified or still-open offer, or a
 * foreign match). Foreign lapsed, verified offers are left alone by the tick
 * and do not stop it.
 *
 * ---------------------------------------------------------------------------
 * RUN IT (from `app/`, LOCAL stack only, edge runtime up — `npm run db:start`
 * brings `supabase_edge_runtime_*` up, which serves the coordinator):
 *
 *   KEY=$(npx supabase status --workdir .. -o json 2>/dev/null | python3 -c \
 *     "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
 *   ANON=$(npx supabase status --workdir .. -o json 2>/dev/null | python3 -c \
 *     "import json,sys; print(json.load(sys.stdin)['PUBLISHABLE_KEY'])")
 *   ./node_modules/.bin/esbuild tools/m4-challenges-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/m4.mjs --log-level=warning \
 *     --define:import.meta.env="{\"VITE_SUPABASE_URL\":\"http://127.0.0.1:54321\",\"VITE_SUPABASE_ANON_KEY\":\"$ANON\"}"
 *   SUPABASE_SERVICE_ROLE_KEY="$KEY" node node_modules/.cache/m4.mjs
 *
 * The service-role key comes from the environment and is never written into
 * this file. It is used for: the coordinator tick and its pre-tick scan, confirming a withdrawn offer's row
 * is really gone, and cleanup (matches — no client DELETE policy — and the
 * three accounts).
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import type { StoredMember } from '../src/lib/teamCodec';
import type { Format } from '../src/rules';
import { saveServerFormat, deleteServerFormat, listServerFormats } from '../src/lib/saves';
import { listMessages, openDm } from '../src/lib/channels';
import { requestFriendship, respondToFriendship, blockUser } from '../src/lib/social';
import { acceptOffer, listOpenOffers } from '../src/lib/matchmaking';
import { createChallenge, declineChallenge, withdrawChallenge, fetchChallenges } from '../src/lib/challenges';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const COORDINATOR_URL = process.env.COORDINATOR_URL ?? `${SUPABASE_URL}/functions/v1/coordinator`;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Take it from `supabase status --workdir ..`; never commit it.');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  console.error(`REFUSING TO RUN: SUPABASE_URL is ${SUPABASE_URL}, which is not the local stack.`);
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- harness (m3b's) --------------------------------------------------------
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
    console.log(`FAIL  ${name}\n        ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const show = (v: unknown) => JSON.stringify(v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refusal(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected a refusal, but the call succeeded');
}

// --- fixtures ---------------------------------------------------------------
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const RULES: Format = {
  schema: 1,
  base: 'great',
  start: 'empty',
  pool: [{ effect: 'allow', select: 'type:steel', note: 'm4 fixture' }],
  composition: { size: 3 },
  selection: { mode: 'open' },
};
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

interface Bot { label: string; email: string; password: string; displayName: string; id: string }
function makeBot(n: 1 | 2 | 3): Bot {
  return {
    label: `bot${n}`,
    email: `m4-${stamp}-bot${n}@example.test`,
    password: `M4-Roundtrip-${stamp}-${n}`,
    displayName: `m4 ${stamp} bot${n}`,
    id: '',
  };
}
const bot1 = makeBot(1); // proposer
const bot2 = makeBot(2); // target
const bot3 = makeBot(3); // friend of neither
const bots = [bot1, bot2, bot3];

let formatId = '';
let versionId = '';
/** bot1's second private format, never challenged on: the target must not see it. */
let secretFormatId = '';
let secretVersionId = '';
/** bot3's private format: bot1 must not be able to challenge on it. */
let bot3FormatId = '';
let bot3VersionId = '';
let dmId = '';

// --- signup through Mailpit (m3b's) ------------------------------------------
async function confirmationLink(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  let last = 'no message ever arrived';
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: { ID: string; To?: { Address: string }[] }[] };
      const hit = (body.messages ?? []).find((m) => (m.To ?? []).some((t) => t.Address?.toLowerCase() === email.toLowerCase()));
      if (hit) {
        const parsed = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text?: string; HTML?: string };
        const text = `${parsed.Text ?? ''}\n${parsed.HTML ?? ''}`.replace(/&amp;/g, '&');
        const link = /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/.exec(text);
        if (link) return link[0];
        last = `a message for ${email} had no /auth/v1/verify link in it`;
      }
    } else last = `Mailpit answered ${res.status}`;
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

async function waitForTokenAccepted(b: Bot): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = 'never attempted';
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('profiles').select('id').eq('id', b.id);
    if (error) last = `PostgREST refused the token: ${error.message}`;
    else if ((data ?? []).length === 1) return;
    else last = `no profile row for ${b.id} yet`;
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
        go_username: `M4${stamp.replace(/[^a-z0-9]/gi, '').toUpperCase()}${b.label.toUpperCase()}`,
        birth_date: '1990-01-01',
        tos_accepted_at: new Date().toISOString(),
      },
    },
  });
  if (error) throw new Error(`${b.label} could not sign up: ${error.message}`);
  const confirmed = await fetch(await confirmationLink(b.email), { redirect: 'manual' });
  if (confirmed.status >= 400) throw new Error(`${b.label}: confirmation link answered ${confirmed.status}`);
  await signIn(b);
  await waitForTokenAccepted(b);
}

async function as<T>(b: Bot, body: () => Promise<T>): Promise<T> {
  await signIn(b);
  return body();
}

// --- the coordinator tick (m2a's, with a narrower guard; see header) ---------
async function assertTickTouchesOnlyOurs(label: string): Promise<void> {
  const ours = new Set(bots.map((b) => b.id));
  const q = await admin.from('queue_entries').select('id, user_id');
  const o = await admin.from('match_offers').select('id, proposer_id, state, verified_hash');
  const m = await admin.from('matches').select('id, player_a, player_b, state');
  if (q.error || o.error || m.error) throw new Error(`pre-tick scan failed: ${q.error?.message ?? o.error?.message ?? m.error?.message}`);
  const fq = (q.data ?? []).filter((r) => !ours.has(r.user_id));
  const fo = (o.data ?? []).filter(
    (r) => !ours.has(r.proposer_id) && (r.verified_hash === null || r.state === 'open' || r.state === 'accepted'),
  );
  const fm = (m.data ?? []).filter((r) => !ours.has(r.player_a) || !ours.has(r.player_b));
  if (fq.length || fo.length || fm.length) {
    throw new Error(`REFUSING TO TICK before "${label}": foreign rows the tick could change — queue ${show(fq)}, offers ${show(fo)}, matches ${show(fm)}`);
  }
}

async function tick(label: string): Promise<string> {
  await assertTickTouchesOnlyOurs(label);
  const res = await fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`coordinator answered ${res.status}: ${text}`);
  console.log(`      [tick "${label}"] ${text}`);
  return text;
}

const challenge = (targetId: string) =>
  createChallenge({ targetId, league: 'great', formatVersionId: versionId, format: RULES, team: TEAM_A });

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`M4 challenges round trip — run ${stamp}\ncoordinator ${COORDINATOR_URL}\n`);
  census0 = await census();
  console.log(`census before: ${show(census0)}\n`);

  for (const b of bots) {
    await check(`0. ${b.label} registers, confirms through Mailpit, and gets a profile`, async () => {
      await register(b);
      return `${b.label} ${b.id}`;
    });
  }
  if (failures > 0) throw new Error('registration gate failed');

  await check('0b. bot1 and bot2 befriend; bot1 saves two PRIVATE formats, bot3 one', async () => {
    assert((await as(bot1, () => requestFriendship(bot2.id))) === 'pending', 'request not pending');
    assert((await as(bot2, () => respondToFriendship(bot1.id, true))) === 'accepted', 'respond not accepted');
    await as(bot1, async () => {
      formatId = await saveServerFormat({ name: `m4 ${stamp}`, format: RULES });
      secretFormatId = await saveServerFormat({ name: `m4 ${stamp} secret`, format: RULES });
      const mine = await listServerFormats();
      const saved = mine.find((f) => f.id === formatId);
      const secret = mine.find((f) => f.id === secretFormatId);
      if (!saved || !secret) throw new Error('saved a format it cannot list');
      versionId = saved.versionId;
      secretVersionId = secret.versionId;
    });
    await as(bot3, async () => {
      bot3FormatId = await saveServerFormat({ name: `m4 ${stamp} bot3`, format: RULES });
      bot3VersionId = (await listServerFormats()).find((f) => f.id === bot3FormatId)!.versionId;
    });
    const vis = await admin.from('formats').select('visibility').in('id', [formatId, secretFormatId, bot3FormatId]);
    assert((vis.data ?? []).length === 3 && vis.data!.every((r) => r.visibility === 'private'), `visibility ${show(vis.data)}`);
    dmId = await as(bot2, () => openDm(bot1.id));
    return `friends; bot1 formats ${formatId} + ${secretFormatId}, bot3 ${bot3FormatId}, all private (read back by admin); DM ${dmId}`;
  });
  if (failures > 0) throw new Error('setup failed');

  // 1 ------------------------------------------------------------------------
  let c1 = '';
  await check("1. createChallenge returns an offer id; bot2's listMessages shows one kind 'challenge' message with it", async () => {
    c1 = await as(bot1, () => challenge(bot2.id));
    assert(typeof c1 === 'string' && c1.length > 0, `createChallenge returned ${show(c1)}`);
    const msgs = await as(bot2, () => listMessages(dmId));
    const cards = msgs.filter((m) => m.kind === 'challenge' && m.offerId === c1);
    assert(cards.length === 1, `bot2 sees ${cards.length} challenge message(s) for ${c1}: ${show(msgs)}`);
    assert(cards[0]!.authorId === bot1.id, `card authored by ${cards[0]!.authorId}`);
    return `offer ${c1}; bot2 sees card message ${cards[0]!.id} (author bot1)`;
  });

  // 2 ------------------------------------------------------------------------
  await check('2. fetchChallenges: bot2 sees it open, bot3 sees nothing; listOpenOffers never shows it', async () => {
    const seen = await as(bot2, () => fetchChallenges([c1]));
    assert(seen.get(c1)?.state === 'open', `bot2 reads ${show(seen.get(c1))}`);
    assert(seen.get(c1)?.targetId === bot2.id, `targetId ${seen.get(c1)?.targetId}`);
    const stranger = await as(bot3, () => fetchChallenges([c1]));
    assert(stranger.size === 0, `bot3 reads ${show([...stranger.values()])}`);
    for (const b of bots) {
      const board = await as(b, () => listOpenOffers('great'));
      assert(!board.some((o) => o.id === c1), `${b.label}'s listOpenOffers shows the challenge`);
    }
    return `bot2: open (formatName ${show(seen.get(c1)?.formatName)}); bot3: 0 rows; absent from all three boards`;
  });

  await check("2b. the target reads the challenge's private format name, and nothing else of the proposer's", async () => {
    const seen = (await as(bot2, () => fetchChallenges([c1]))).get(c1);
    assert(seen?.formatName === `m4 ${stamp}`, `bot2's formatName is ${show(seen?.formatName)}`);
    const bot2List = await as(bot2, listServerFormats);
    const leaked = bot2List.filter((f) => [formatId, secretFormatId].includes(f.id));
    assert(leaked.length === 0, `bot2's listServerFormats lists bot1's formats: ${show(leaked)}`);
    const direct = await as(bot2, async () =>
      supabase.from('format_versions').select('id').eq('id', secretVersionId),
    );
    if (direct.error) throw new Error(`direct select errored rather than returning nothing: ${direct.error.message}`);
    assert((direct.data ?? []).length === 0, `bot2 reads bot1's unchallenged private version: ${show(direct.data)}`);
    const played = await as(bot2, async () => supabase.from('format_versions').select('id').eq('id', versionId));
    assert((played.data ?? []).length === 1, `bot2 cannot read the challenged version by id: ${show(played)}`);
    const third = (await as(bot3, () => fetchChallenges([c1]))).size;
    const thirdRead = await as(bot3, async () => supabase.from('format_versions').select('id').eq('id', versionId));
    assert(third === 0 && (thirdRead.data ?? []).length === 0, `bot3 reads ${show(thirdRead.data)}`);
    return `bot2 formatName "${seen!.formatName}"; bot2's listServerFormats has ${bot2List.length} row(s), none bot1's; secret version by id: 0 rows; challenged version by id: 1 row; bot3 reads 0`;
  });

  await check("2c. someone else's PRIVATE format is refused with the one sentence", async () => {
    const r = await refusal(() =>
      as(bot1, () =>
        createChallenge({ targetId: bot2.id, league: 'great', formatVersionId: bot3VersionId, format: RULES, team: TEAM_A }),
      ),
    );
    assert(r === 'a challenge needs a format you own or a public one', `refused with ${show(r)}`);
    return `bot1 on bot3's private version: "${r}"`;
  });

  // 3 ------------------------------------------------------------------------
  await check('3. accept before verification is refused; after a coordinator tick it converts to a match', async () => {
    const pre = (await as(bot2, () => fetchChallenges([c1]))).get(c1);
    let preNote: string;
    if (pre?.verifiedHash === null) {
      const r = await refusal(() => acceptOffer(c1, TEAM_B));
      assert(r.includes('not been verified yet'), `pre-verification accept refused with ${show(r)}`);
      preNote = `pre-tick accept refused "${r}"`;
    } else {
      // pg_cron's own minute tick got there first — the refusal cannot be observed on this offer.
      throw new Error(`cron verified ${c1} before the refused accept could run; rerun the script`);
    }
    await tick('verify challenge');
    const verified = (await as(bot2, () => fetchChallenges([c1]))).get(c1);
    assert(!!verified?.verifiedHash, `after the tick verifiedHash is ${show(verified?.verifiedHash)}`);
    const matchId = await as(bot2, () => acceptOffer(c1, TEAM_B));
    assert(typeof matchId === 'string' && matchId.length > 0, `acceptOffer returned ${show(matchId)}`);
    const after = (await as(bot1, () => fetchChallenges([c1]))).get(c1);
    assert(after?.state === 'converted', `proposer reads state ${show(after?.state)}`);
    assert(after?.matchId === matchId, `matchId ${show(after?.matchId)} vs ${matchId}`);
    return `${preNote}; after tick verified ${verified!.verifiedHash!.slice(0, 12)}…; accept -> match ${matchId}; state converted`;
  });

  // 4 ------------------------------------------------------------------------
  await check('4. declineChallenge as bot2 -> true, state declined; a second decline -> false', async () => {
    const c2 = await as(bot1, () => challenge(bot2.id));
    const ok = await as(bot2, () => declineChallenge(c2));
    assert(ok === true, `declineChallenge returned ${show(ok)}`);
    const st = (await as(bot1, () => fetchChallenges([c2]))).get(c2);
    assert(st?.state === 'declined', `state ${show(st?.state)}`);
    const again = await as(bot2, () => declineChallenge(c2));
    assert(again === false, `second decline returned ${show(again)}`);
    const byStranger = await as(bot3, () => declineChallenge(c2));
    assert(byStranger === false, `bot3's decline returned ${show(byStranger)}`);
    return `offer ${c2}: decline -> true, state declined; again -> false; bot3 -> false`;
  });

  // 4b / review (a) -----------------------------------------------------------
  await check('4b. withdrawChallenge deletes an open one; its card survives with offerId null; fetchChallenges drops it', async () => {
    const c3 = await as(bot1, () => challenge(bot2.id));
    const card = (await as(bot2, () => listMessages(dmId))).find((m) => m.offerId === c3);
    assert(!!card, `no card for ${c3} before withdrawing`);
    await as(bot1, () => withdrawChallenge(c3));
    const row = await admin.from('match_offers').select('id').eq('id', c3);
    assert((row.data ?? []).length === 0, `offer row still exists: ${show(row.data)}`);
    const survived = (await as(bot2, () => listMessages(dmId))).find((m) => m.id === card!.id);
    assert(!!survived, `card message ${card!.id} is gone after the withdraw`);
    assert(survived!.offerId === null, `card offerId is ${show(survived!.offerId)}, expected null`);
    assert(survived!.kind === 'challenge', `card kind is ${survived!.kind}`);
    for (const b of [bot1, bot2]) {
      const m = await as(b, () => fetchChallenges([c3]));
      assert(m.size === 0, `${b.label}'s fetchChallenges still returns ${show([...m.values()])}`);
    }
    return `offer ${c3} deleted (ON DELETE SET NULL passed messages_protect_columns); card ${card!.id} kept, kind challenge, offerId null; both fetchChallenges empty`;
  });

  // review (b) ----------------------------------------------------------------
  await check('4c. live ACLs: an anonymous client is refused create_challenge and decline_challenge', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const cr = await anon.rpc('create_challenge', {
      p_target: bot2.id, p_format_version: versionId, p_claimed_hash: 'x', p_league: 'great',
      p_team: TEAM_A, p_data_rev: 'x', p_scheduled_for: null,
    });
    const de = await anon.rpc('decline_challenge', { p_offer: c1 });
    assert(!!cr.error && /permission denied/i.test(cr.error.message), `create_challenge as anon: ${show(cr.error ?? cr.data)}`);
    assert(!!de.error && /permission denied/i.test(de.error.message), `decline_challenge as anon: ${show(de.error ?? de.data)}`);
    return `create: "${cr.error!.message}"; decline: "${de.error!.message}"`;
  });

  // 5 ------------------------------------------------------------------------
  await check('5. a blocked pair: createChallenge refuses with the one sentence', async () => {
    const blocked = await as(bot2, () => blockUser(bot1.id));
    assert(blocked === true, `blockUser returned ${show(blocked)}`);
    const r = await refusal(() => as(bot1, () => challenge(bot2.id)));
    assert(r === 'that person cannot be challenged', `refused with ${show(r)}`);
    const stranger = await refusal(() => as(bot1, () => challenge(bot3.id)));
    assert(stranger === r, `a non-friend was refused with a different sentence: ${show(stranger)}`);
    return `blocked: "${r}"; non-friend: identical sentence`;
  });
}

// --- cleanup (m2a's order: offers, matches, formats, accounts) ---------------
async function cleanup(): Promise<void> {
  const ids = bots.map((b) => b.id).filter(Boolean);
  if (ids.length === 0) return;
  const offers = await admin.from('match_offers').delete().in('proposer_id', ids);
  if (offers.error) console.log(`      [cleanup] offers: ${offers.error.message}`);
  const list = `(${ids.join(',')})`;
  const m = await admin.from('matches').delete().or(`player_a.in.${list},player_b.in.${list}`);
  if (m.error) console.log(`      [cleanup] matches: ${m.error.message}`);
  for (const [b, ids] of [[bot1, [formatId, secretFormatId]], [bot3, [bot3FormatId]]] as const) {
    for (const id of ids.filter(Boolean)) {
      try {
        await as(b, () => deleteServerFormat(id));
      } catch (e) {
        console.log(`      [cleanup] format ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  await supabase.auth.signOut();
  for (const b of bots) {
    if (!b.id) continue;
    const { error } = await admin.auth.admin.deleteUser(b.id);
    if (error) console.log(`      [cleanup] account ${b.label}: ${error.message}`);
  }
}

let census0: Record<string, number | null> | null = null;
async function census(): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const t of ['profiles', 'formats', 'format_versions', 'friendships', 'match_offers', 'matches', 'channels', 'messages']) {
    out[t] = (await admin.from(t).select('*', { count: 'exact', head: true })).count ?? null;
  }
  return out;
}

async function verifyCleanup(): Promise<void> {
  const ids = bots.map((b) => b.id).filter(Boolean);
  if (ids.length === 0) return;
  await check('cleanup. every row this run created is gone', async () => {
    const list = `(${ids.join(',')})`;
    const [p, o, m, c] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', ids),
      admin.from('match_offers').select('id', { count: 'exact', head: true }).or(`proposer_id.in.${list},target_id.in.${list}`),
      admin.from('matches').select('id', { count: 'exact', head: true }).or(`player_a.in.${list},player_b.in.${list}`),
      admin.from('channels').select('id', { count: 'exact', head: true }).in('created_by', ids),
    ]);
    const counts = { profiles: p.count, offers: o.count, matches: m.count, channels: c.count };
    assert(Object.values(counts).every((n) => n === 0), `left behind: ${show(counts)}`);
    const after = await census();
    assert(show(after) === show(census0), `table sizes moved: before ${show(census0)}, after ${show(after)}`);
    return `${show(counts)}; census unchanged ${show(after)}`;
  });
}

main()
  .then(async () => {
    await cleanup();
    await verifyCleanup();
    console.log(`\n${passes} passed, ${failures} failed`);
    if (failures > 0) console.log(`failed: ${failed.join(', ')}`);
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.log(`\nABORTED: ${e instanceof Error ? e.stack : String(e)}`);
    try {
      await cleanup();
      await verifyCleanup();
    } catch (c) {
      console.log(`cleanup after abort also failed: ${c instanceof Error ? c.message : String(c)}`);
    }
    console.log(`${passes} passed, ${failures} failed before the abort`);
    process.exit(1);
  });
