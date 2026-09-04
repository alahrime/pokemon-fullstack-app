/**
 * Two disposable opponents for the matchmaking screen.
 *
 * A fixture, not a test. `m2a-roundtrip.ts` asserts things about the system;
 * this one only puts rows in front of a person so the Matchmaking screen has
 * somebody on it. It is throwaway-grade on purpose — the team-creation debt it
 * sits on top of is deferred, not fixed here — but it is committed because a
 * fixture nobody can find is a fixture nobody re-runs.
 *
 * It imports the SHIPPING modules (`src/lib/matchmaking.ts`, `src/lib/saves.ts`,
 * `src/lib/rankings.ts`, `src/lib/teamCodec.ts`) for the same reason
 * `m2a-roundtrip.ts` does: rows written by a reimplementation of the client are
 * rows the client never has to be able to read.
 *
 * ---------------------------------------------------------------------------
 * RUN IT (from `app/`, against the LOCAL stack only)
 *
 *   ./node_modules/.bin/esbuild tools/opponents.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/opponents.mjs --log-level=warning \
 *     --define:import.meta.env='{"VITE_SUPABASE_URL":"http://127.0.0.1:54321","VITE_SUPABASE_ANON_KEY":"sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"}'
 *
 *   SUPABASE_SERVICE_ROLE_KEY='<SERVICE_ROLE_KEY from `npm run db:start`>' \
 *     node node_modules/.cache/opponents.mjs            # seed the six offers
 *   SUPABASE_SERVICE_ROLE_KEY=… node node_modules/.cache/opponents.mjs --tend
 *   SUPABASE_SERVICE_ROLE_KEY=… node node_modules/.cache/opponents.mjs --clean
 *
 * The service-role key comes from the environment and is never written into
 * this file — it bypasses every policy in `supabase/migrations`. It is used for
 * exactly four things, each named at its call site: lengthening `expires_at`
 * (clients have no UPDATE on `match_offers` at all, by design — see
 * `20260904071716_handshake_columns_are_server_only.sql`), reading the six
 * offers back to prove they verified, deleting `matches` rows (there is
 * deliberately no client DELETE policy), and deleting the two accounts.
 *
 * The stack must be fully up, INCLUDING `edge_runtime` — the coordinator is an
 * Edge Function and an offer it has not verified cannot be accepted by anyone.
 * `supabase status --workdir ..` prints `FUNCTIONS_URL` only when it is running.
 * ---------------------------------------------------------------------------
 */
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { DATA_REV, conflictsOnTeam, movesFor, opponentCandidatesFor, pickableFor, speciesOf } from '../src/lib/data';
import { defaultSpreadFor } from '../src/lib/engine';
import { DEFAULT_TIER, rankingsFor } from '../src/lib/rankings';
import { encodeMember, type StoredMember } from '../src/lib/teamCodec';
import type { AddPokemonChoice } from '../src/components/AddPokemonModal';
import type { LeagueId } from '../src/lib/types';
import type { Format } from '../src/rules';
import {
  deleteServerFormat,
  deleteTeam,
  listServerFormats,
  listTeams,
  saveServerFormat,
  saveTeam,
} from '../src/lib/saves';
import { confirmOffer, createOffer, myOffers } from '../src/lib/matchmaking';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const COORDINATOR_URL =
  process.env.COORDINATOR_URL ?? 'http://127.0.0.1:54321/functions/v1/coordinator';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. Take it from `npm run db:start` (or\n' +
      '`supabase status --workdir ..`) and never commit it. See the header of this file for\n' +
      'the four things it is used for.',
  );
  process.exit(2);
}

/** Refuses to point anywhere but the local stack. This tool creates accounts. */
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  console.error(`REFUSING TO RUN: SUPABASE_URL is ${SUPABASE_URL}, which is not the local stack.`);
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LEAGUES: LeagueId[] = ['great', 'ultra', 'master'];
const ROSTER_SIZE = 3;
/** Scheduled offers land two days out… */
const SCHEDULE_DAYS = 2;
/** …and the whole fixture stays acceptable for five, rather than the one hour
 *  `match_offers.expires_at` defaults to. A fixture that expires while the
 *  partner is still looking at it reads as a broken screen. */
const EXPIRY_DAYS = 5;
const TEND_POLL_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const show = (v: unknown): string => JSON.stringify(v);

// ---------------------------------------------------------------------------
// The two accounts. Fixed credentials rather than a timestamped run id, so
// `--tend` and `--clean` can find them in a later process with no state file
// to go stale. Obvious and disposable by name, both in the mailbox and in the
// `display_name` the partner sees on the board.
// ---------------------------------------------------------------------------
interface Bot {
  label: string;
  email: string;
  password: string;
  displayName: string;
  goUsername: string;
  id: string;
  /** `formats.id` per league, filled in by seeding or re-read on clean. */
  formatId: Partial<Record<LeagueId, string>>;
}

function bot(n: 1 | 2): Bot {
  return {
    label: `opponent-${n}`,
    email: `test-opponent-${n}@example.test`,
    password: `Test-Opponent-${n}-fixture`,
    displayName: `TEST OPPONENT ${n}`,
    goUsername: `TESTOPPONENT${n}`,
    id: '',
    formatId: {},
  };
}

const BOTS: Bot[] = [bot(1), bot(2)];

// ---------------------------------------------------------------------------
// Signup through the real mailbox, exactly as `m2a-roundtrip.ts` does it: the
// profile trigger reads signup metadata, so an admin-created user would have no
// profile and every foreign key here points at one.
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
  const { data, error } = await supabase.auth.signInWithPassword({
    email: b.email,
    password: b.password,
  });
  if (error) throw new Error(`${b.label} could not sign in: ${error.message}`);
  const id = data.session?.user.id;
  if (!id) throw new Error(`${b.label} signed in with no session`);
  b.id = id;
}

/**
 * PostgREST's container can hold a clock a second or two behind GoTrue's, which
 * makes a freshly issued JWT "issued at future" and gets every request refused
 * — indistinguishable from a policy denying the write. Poll a trivial
 * authenticated select until it comes back clean AND returns this account's own
 * profile row, which also confirms `handle_confirmed_user()` built the profile
 * every foreign key below needs.
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

/** True if the account already existed and we simply signed in. */
async function register(b: Bot): Promise<boolean> {
  const existing = await supabase.auth.signInWithPassword({ email: b.email, password: b.password });
  if (!existing.error && existing.data.session) {
    b.id = existing.data.session.user.id;
    await waitForTokenAccepted(b);
    return true;
  }
  const { error } = await supabase.auth.signUp({
    email: b.email,
    password: b.password,
    options: {
      emailRedirectTo: 'http://localhost:5173',
      data: {
        display_name: b.displayName,
        go_username: b.goUsername,
        birth_date: '1990-01-01',
        tos_accepted_at: new Date().toISOString(),
      },
    },
  });
  if (error) throw new Error(`${b.label} could not sign up: ${error.message}`);
  const link = await confirmationLink(b.email);
  const confirmed = await fetch(link, { redirect: 'manual' });
  if (confirmed.status >= 400) {
    throw new Error(`${b.label}: confirmation link answered ${confirmed.status}`);
  }
  await signIn(b);
  await waitForTokenAccepted(b);
  return false;
}

async function as<T>(b: Bot, body: () => Promise<T>): Promise<T> {
  await signIn(b);
  return body();
}

// ---------------------------------------------------------------------------
// The roster, picked from the league's own ranking.
//
// `defaultChoice` is `MatchmakingScreen.tsx`'s private helper of the same name,
// restated here rather than imported: importing it would drag React and JSX
// into a Node bundle. Everything it is built from — `movesFor`,
// `defaultSpreadFor`, `encodeMember` — is the real module the screen calls, so
// a member this writes is byte-for-byte a member that screen would have written.
// ---------------------------------------------------------------------------
function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
  const sp = speciesOf(refId);
  if (!sp) return { ref: refId, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } };
  const rated = movesFor(sp, leagueId);
  const spread = defaultSpreadFor(refId, leagueId, true);
  return {
    ref: refId,
    fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
    chargeIds: rated.charges.map((c) => c.id),
    iv: { a: spread.a, d: spread.d, s: spread.s },
  };
}

/**
 * The top `size` refs by Overall at the league's default tier.
 *
 * `rankingsFor` is the same call the Rankings screen makes, and `d1` /
 * `'overall'` / `DEFAULT_TIER(lg)` are its own defaults — this is the ordering
 * a person sees when they open that screen, not a private one.
 *
 * Narrowed by two of the app's own predicates before taking the head, because
 * the ranking is a ranking of the whole rated field and not of what may be put
 * on a team: `pickableFor` is what the picker offers (it drops Megas, Primals
 * and the species the engine cannot model), `opponentCandidatesFor` is
 * league-eligibility, and `conflictsOnTeam` is the duplicate-species rule the
 * builder enforces. Skipping any of them produces a roster the screen itself
 * would refuse to build.
 */
function topTeam(league: LeagueId, size: number): string[] {
  const pickable = new Set(pickableFor(league));
  const eligible = new Set(opponentCandidatesFor(league));
  const out: string[] = [];
  for (const row of rankingsFor(league, DEFAULT_TIER(league), 'overall', 'd1')) {
    if (!pickable.has(row.ref) || !eligible.has(row.ref)) continue;
    if (out.some((m) => conflictsOnTeam(m, row.ref))) continue;
    out.push(row.ref);
    if (out.length === size) break;
  }
  if (out.length < size) {
    throw new Error(`only ${out.length} pickable refs in ${league}'s ranking, needed ${size}`);
  }
  return out;
}

function rosterFor(league: LeagueId): StoredMember[] {
  return topTeam(league, ROSTER_SIZE).map((ref) => encodeMember(defaultChoice(ref, league), league));
}

/** The one ruleset each bot saves per league: the plain league, three up. */
function formatFor(league: LeagueId): Format {
  return {
    schema: 1,
    base: league,
    start: 'league',
    pool: [],
    composition: { size: ROSTER_SIZE },
    selection: { mode: 'open' },
  };
}

function formatName(b: Bot, league: LeagueId): string {
  return `${b.displayName} ${league}`;
}

// ---------------------------------------------------------------------------
async function tick(): Promise<{ verified: number; paired: number; swept: number }> {
  const res = await fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `the coordinator at ${COORDINATOR_URL} answered ${res.status}: ${text}\n` +
        `Without a tick every offer stays verified_hash null and accept_offer refuses it.\n` +
        `Bring edge_runtime up with \`supabase start --workdir ..\` and re-run.`,
    );
  }
  return JSON.parse(text) as { verified: number; paired: number; swept: number };
}

interface OfferRow {
  id: string;
  league: LeagueId;
  proposer_id: string;
  scheduled_for: string | null;
  expires_at: string;
  state: string;
  verified_hash: string | null;
  team: StoredMember[];
}

/** Read past RLS, so "verified" is the column and not a hopeful client view. */
async function readOffers(ids: string[]): Promise<OfferRow[]> {
  const { data, error } = await admin
    .from('match_offers')
    .select('id, league, proposer_id, scheduled_for, expires_at, state, verified_hash, team')
    .in('id', ids);
  if (error) throw new Error(`could not read the offers back: ${error.message}`);
  return (data ?? []) as OfferRow[];
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------
async function seed(): Promise<void> {
  console.log(`seeding two opponents against ${SUPABASE_URL} (DATA_REV ${DATA_REV})\n`);

  for (const b of BOTS) {
    const reused = await register(b);
    console.log(`${b.label}  ${b.displayName}  <${b.email}>  ${b.id}  ${reused ? '(existing account)' : '(new account)'}`);
  }
  console.log('');

  // The picks, printed before anything is written: if the ranking data moved,
  // this is the line that says so.
  const rosters = {} as Record<LeagueId, StoredMember[]>;
  for (const lg of LEAGUES) {
    rosters[lg] = rosterFor(lg);
    console.log(
      `${lg.padEnd(6)} tier ${DEFAULT_TIER(lg)} overall top ${ROSTER_SIZE}: ` +
        rosters[lg].map((m) => m.ref).join(', '),
    );
  }
  console.log('');

  // Withdraw anything a previous seed left, so re-running does not stack up
  // six more offers on the board. A client DELETE, under the proposer's own
  // policy — the shipping path, not an admin shortcut.
  for (const b of BOTS) {
    await as(b, async () => {
      const { error } = await supabase.from('match_offers').delete().eq('proposer_id', b.id);
      if (error) console.log(`  [seed] ${b.label} could not withdraw old offers: ${error.message}`);
    });
  }

  const posted: { id: string; league: LeagueId; kind: 'live' | 'scheduled'; bot: string }[] = [];

  for (const [i, lg] of LEAGUES.entries()) {
    for (const [j, b] of BOTS.entries()) {
      // Alternating, so each league has one of each AND each bot proposes at
      // least one scheduled offer — `--tend` is only exercised for a bot that
      // has one.
      const kind: 'live' | 'scheduled' = (i + j) % 2 === 0 ? 'live' : 'scheduled';
      await as(b, async () => {
        // Idempotent by name: `saveServerFormat` with an existing id appends a
        // version rather than making a second format with the same name.
        const existing = (await listServerFormats()).find((f) => f.name === formatName(b, lg));
        const formatId = await saveServerFormat({
          id: existing?.id,
          name: formatName(b, lg),
          format: formatFor(lg),
        });
        b.formatId[lg] = formatId;
        const saved = (await listServerFormats()).find((f) => f.id === formatId);
        if (!saved) throw new Error(`${b.label} saved a ${lg} format it cannot then list`);

        // A saved roster too, so the account looks like a person's rather than
        // a bare offer with nothing behind it. The offer carries its own copy;
        // this is not what it reads.
        const teamName = `${b.displayName} ${lg}`;
        const already = (await listTeams(ROSTER_SIZE)).find((t) => t.name === teamName);
        await saveTeam({
          id: already?.id,
          name: teamName,
          league: lg,
          size: ROSTER_SIZE,
          members: rosters[lg],
        });

        const id = await createOffer({
          league: lg,
          formatVersionId: saved.versionId,
          format: formatFor(lg),
          team: rosters[lg],
          scheduledFor:
            kind === 'scheduled'
              ? new Date(Date.now() + SCHEDULE_DAYS * 24 * 60 * 60 * 1000)
              : undefined,
        });
        posted.push({ id, league: lg, kind, bot: b.label });
      });
    }
  }

  // ADMIN, first of four. `expires_at` defaults to one hour and clients have no
  // UPDATE on this table at all — the privilege is revoked in
  // `20260904071716_handshake_columns_are_server_only.sql`, deliberately, so
  // that a proposer cannot edit the terms of their own offer. A fixture needs a
  // longer window than an hour; it does not need a client to be able to set one.
  const until = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const widened = await admin
    .from('match_offers')
    .update({ expires_at: until })
    .in('id', posted.map((p) => p.id))
    .select('id');
  if (widened.error) throw new Error(`could not lengthen the offer windows: ${widened.error.message}`);
  console.log(`\nposted ${posted.length} offers, all acceptable until ${until}`);

  // -------------------------------------------------------------------------
  // THE STEP THAT DECIDES WHETHER ANY OF THIS IS USABLE.
  //
  // `accept_offer` raises 'this offer has not been verified yet' for an offer
  // whose `verified_hash` is null, and only the coordinator writes that column.
  // On the hosted project it runs on a pg_cron schedule; locally nothing calls
  // it unless something does. So call it, then READ THE COLUMN — a 200 from the
  // function is not evidence about six particular rows.
  // -------------------------------------------------------------------------
  const t = await tick();
  console.log(`coordinator tick: ${show(t)}`);

  const rows = await readOffers(posted.map((p) => p.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  console.log('');
  let unverified = 0;
  for (const p of posted) {
    const row = byId.get(p.id);
    if (!row) {
      unverified++;
      console.log(`MISSING   ${p.league.padEnd(6)} ${p.kind.padEnd(9)} ${p.bot}  offer ${p.id} is not in the table at all`);
      continue;
    }
    const ok = row.verified_hash !== null;
    if (!ok) unverified++;
    console.log(
      `${ok ? 'VERIFIED' : 'UNVERIFIED'.padEnd(8)}  ${p.league.padEnd(6)} ${p.kind.padEnd(9)} ${p.bot}  ` +
        `${row.team.map((m) => m.ref).join('/')}  ` +
        `${row.scheduled_for ? `for ${row.scheduled_for}` : 'playable now'}  ${p.id}`,
    );
  }

  await supabase.auth.signOut();

  if (unverified > 0) {
    console.log(
      `\n${unverified} of ${posted.length} offers are NOT verified. Nobody can accept those:\n` +
        `  accept_offer raises 'this offer has not been verified yet'.\n` +
        `Run the coordinator again and re-check:\n` +
        `  curl -s -X POST ${COORDINATOR_URL} -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"\n` +
        `then re-run this tool.`,
    );
    process.exit(1);
  }

  console.log(
    `\nAll ${posted.length} offers verified — they are acceptable now.\n` +
      `Open the Matchmaking screen, switch leagues, and accept one.\n\n` +
      `A SCHEDULED offer you accept only reaches state 'accepted'; the match is created when\n` +
      `the PROPOSER confirms, and the proposer here is a bot. Leave this running in another\n` +
      `terminal for that half of the handshake:\n\n` +
      `  SUPABASE_SERVICE_ROLE_KEY=… node node_modules/.cache/opponents.mjs --tend\n`,
  );
}

// ---------------------------------------------------------------------------
// tend — the bot half of the scheduled handshake
// ---------------------------------------------------------------------------
async function tend(): Promise<void> {
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\nSIGINT — finishing this pass and stopping.');
  });

  for (const b of BOTS) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: b.email,
      password: b.password,
    });
    if (error || !data.session) {
      console.error(
        `${b.label} could not sign in (${error?.message ?? 'no session'}). Seed first:\n` +
          `  node node_modules/.cache/opponents.mjs`,
      );
      process.exit(2);
    }
    b.id = data.session.user.id;
  }
  console.log(
    `tending ${BOTS.length} opponents every ${TEND_POLL_MS / 1000}s — any offer of theirs in state\n` +
      `'accepted' gets confirmed, which is what turns it into a match. Ctrl-C to stop.\n`,
  );

  let confirmations = 0;
  while (!stopping) {
    for (const b of BOTS) {
      if (stopping) break;
      try {
        const mine = await as(b, myOffers);
        for (const o of mine) {
          if (o.proposerId !== b.id || o.state !== 'accepted') continue;
          try {
            const matchId = await confirmOffer(o.id);
            confirmations++;
            console.log(
              `${new Date().toISOString()}  ${b.displayName} confirmed ${o.league} ` +
                `${o.scheduledFor ? `scheduled ${o.scheduledFor}` : 'live'} offer ${o.id} ` +
                `accepted by ${o.acceptedBy} -> match ${matchId}`,
            );
          } catch (e) {
            // An offer that expired between the accept and this pass raises
            // 'this offer has expired'. Say so and carry on; one dead offer
            // must not stop the loop tending the other five.
            console.log(
              `${new Date().toISOString()}  ${b.displayName} could NOT confirm ${o.id}: ` +
                `${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      } catch (e) {
        console.log(
          `${new Date().toISOString()}  ${b.label} poll failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    // Slept in slices so Ctrl-C is answered promptly rather than up to a whole
    // interval later.
    for (let waited = 0; waited < TEND_POLL_MS && !stopping; waited += 250) await sleep(250);
  }

  await supabase.auth.signOut();
  console.log(`stopped after ${confirmations} confirmation${confirmations === 1 ? '' : 's'}.`);
}

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------
async function clean(): Promise<void> {
  const removed = { offers: 0, matches: 0, teams: 0, formats: 0, accounts: 0 };
  const ids: string[] = [];

  for (const b of BOTS) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: b.email,
      password: b.password,
    });
    if (error || !data.session) {
      console.log(`${b.label}: no such account (${error?.message ?? 'no session'}) — nothing to remove`);
      continue;
    }
    b.id = data.session.user.id;
    ids.push(b.id);

    // Offers first: `format_versions` is ON DELETE RESTRICT from both
    // `match_offers` and `matches`, so a format delete is refused while either
    // still points at it. That is the guarantee working, not a bug.
    const offers = await supabase.from('match_offers').delete().eq('proposer_id', b.id).select('id');
    if (offers.error) console.log(`  [clean] ${b.label} offers: ${offers.error.message}`);
    else removed.offers += (offers.data ?? []).length;
  }

  // ADMIN, second of four: `matches` has SELECT-only policies by design, so no
  // client may delete one.
  if (ids.length > 0) {
    const all = await admin.from('matches').select('id, player_a, player_b');
    if (all.error) console.log(`  [clean] matches read: ${all.error.message}`);
    for (const r of (all.data ?? []) as { id: string; player_a: string; player_b: string }[]) {
      if (!ids.includes(r.player_a) && !ids.includes(r.player_b)) continue;
      const d = await admin.from('matches').delete().eq('id', r.id);
      if (d.error) console.log(`  [clean] match ${r.id}: ${d.error.message}`);
      else removed.matches++;
    }
  }

  for (const b of BOTS) {
    if (!b.id) continue;
    try {
      await as(b, async () => {
        for (const t of await listTeams(ROSTER_SIZE)) {
          await deleteTeam(t.id);
          removed.teams++;
        }
        for (const f of await listServerFormats()) {
          await deleteServerFormat(f.id);
          removed.formats++;
        }
      });
    } catch (e) {
      console.log(`  [clean] ${b.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await supabase.auth.signOut();

  // ADMIN, third and fourth: GoTrue owns auth.users and no client may delete an
  // account. Deleting it cascades the profile every foreign key above points at.
  for (const b of BOTS) {
    if (!b.id) continue;
    const { error } = await admin.auth.admin.deleteUser(b.id);
    if (error) console.log(`  [clean] account ${b.label}: ${error.message}`);
    else removed.accounts++;
  }

  console.log(
    `removed ${removed.offers} offers, ${removed.matches} matches, ${removed.teams} teams, ` +
      `${removed.formats} formats, ${removed.accounts} accounts`,
  );

  // Say what is left rather than claiming it is all gone.
  const left = await admin.from('match_offers').select('id', { count: 'exact', head: true });
  const leftMatches = await admin.from('matches').select('id', { count: 'exact', head: true });
  console.log(
    `still in the database (everyone's, not just this tool's): ` +
      `${left.count ?? '?'} offers, ${leftMatches.count ?? '?'} matches`,
  );
}

// ---------------------------------------------------------------------------
const mode = process.argv.includes('--clean')
  ? 'clean'
  : process.argv.includes('--tend')
    ? 'tend'
    : 'seed';

const run = mode === 'clean' ? clean : mode === 'tend' ? tend : seed;

run()
  .then(() => {
    if (mode !== 'tend') process.exit(0);
  })
  .catch((e: unknown) => {
    console.error(`\nFAILED (${mode}): ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
