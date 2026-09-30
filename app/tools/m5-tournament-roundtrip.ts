/**
 * M5 tournament round trip: seven real confirmed accounts running a Swiss
 * tournament end to end through the SHIPPING `src/lib/tournaments.ts`,
 * `src/tournament/swiss.ts`, `src/tournament/roster.ts`, `src/lib/channels.ts`,
 * `src/lib/matchmaking.ts` (opponentFriendCode), `src/lib/saves.ts` and
 * `src/lib/social.ts` modules against the real local Postgres and PostgREST.
 * Structure, signup-through-Mailpit and the PASS/FAIL harness are
 * m4-challenges-roundtrip.ts's. Nothing here re-implements client logic: the
 * pairings are `pairSwiss` over `toGames(listPairings)` exactly as the host
 * panel calls it (HostPanel.tsx `propose`), every write is a shipping wrapper.
 *
 * BOTS: host (organiser), p1..p5 (entrants), stranger (a non-entrant who later
 * becomes the host's judge, and organises the three check-(a) tournaments).
 * Every email is run-stamped `@example.test`; all seven are deleted at the end.
 * Sign-ins are cached (one password sign-in per bot, then `setSession`) to stay
 * well inside GoTrue's 30-per-5-minutes sign-in limit.
 *
 * ---------------------------------------------------------------------------
 * RUN IT (from `app/`, LOCAL stack only; never `db:reset`):
 *
 *   KEY=$(npx supabase status --workdir .. -o json 2>/dev/null | python3 -c \
 *     "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
 *   ANON=$(npx supabase status --workdir .. -o json 2>/dev/null | python3 -c \
 *     "import json,sys; print(json.load(sys.stdin)['PUBLISHABLE_KEY'])")
 *   ./node_modules/.bin/esbuild tools/m5-tournament-roundtrip.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.cache/m5.mjs --log-level=warning \
 *     --define:import.meta.env="{\"VITE_SUPABASE_URL\":\"http://127.0.0.1:54321\",\"VITE_SUPABASE_ANON_KEY\":\"$ANON\"}"
 *   SUPABASE_SERVICE_ROLE_KEY="$KEY" node node_modules/.cache/m5.mjs
 *
 * The service-role key comes from the environment and is never written into
 * this file. It is used for exactly three things: TIME TRAVEL (one pairing's
 * `final_at` moved into the past, check 5b — the only admin WRITE besides
 * cleanup), VERIFICATION (the census and the leftover counts), and CLEANUP
 * (deleting this run's tournaments, which cascades their entrants, rosters,
 * roles, pairings and audit — there is deliberately no client DELETE — and the
 * seven accounts). Every admin write is scoped by an id this run created, so
 * there is no global action here that another user's rows could be caught in
 * (the m4 tick guard has nothing to guard).
 *
 * max_rows: local `supabase/config.toml` has `max_rows = 1000`; `listPairings`
 * pages 500 rows at a time, so the HOSTED project's API max rows must be >= 500
 * (it cannot be read from here: a deploy check).
 */
import { createClient, type Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import type { Format } from '../src/rules';
import { RULES_SCHEMA } from '../src/rules';
import { movesFor, SPECIES_BY_ID } from '../src/lib/data';
import { saveServerFormat, deleteServerFormat, listServerFormats } from '../src/lib/saves';
import { openDm } from '../src/lib/channels';
import { blockUser } from '../src/lib/social';
import { opponentFriendCode } from '../src/lib/matchmaking';
import { ROSTER_SIZE, checkRoster, type RosterMember } from '../src/tournament/roster';
import { pairSwiss, standings, type Pairing as SwissPairing } from '../src/tournament/swiss';
import {
  createTournament, openRegistration, closeRegistration, registerRoster, grantJudge, startRound,
  reportScore, confirmScore, disputeScore, settlePairing, dropOut, finishTournament,
  listTournaments, getTournament, listEntrants, listPairings, listRosters, listAudit, myTournamentActivity,
  toGames, isCounted, type Pairing,
} from '../src/lib/tournaments';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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

/** roster.test.ts's six-format: Great League, open pool, unique species. */
const FORMAT: Format = {
  schema: RULES_SCHEMA, base: 'great', pool: [],
  composition: { size: ROSTER_SIZE, uniqueSpecies: true }, selection: { mode: 'open' },
};
const SIX = ['azumarill', 'registeel', 'altaria', 'medicham', 'skarmory', 'stunfisk_galarian'];
function roster(cp: number): RosterMember[] {
  return SIX.map((ref) => {
    const m = movesFor(SPECIES_BY_ID.get(ref)!, 'great');
    return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id), cp, bestBuddy: false };
  });
}

interface Bot { label: string; email: string; password: string; displayName: string; id: string; session: Session | null }
function makeBot(label: string): Bot {
  return {
    label, email: `m5-${stamp}-${label}@example.test`, password: `M5-Roundtrip-${stamp}-${label}`,
    displayName: `m5 ${stamp} ${label}`, id: '', session: null,
  };
}
const host = makeBot('host');
const p = [1, 2, 3, 4, 5].map((n) => makeBot(`p${n}`));
const [p1, p2, p3, p4, p5] = p as [Bot, Bot, Bot, Bot, Bot];
const stranger = makeBot('stranger');
const bots = [host, ...p, stranger];
const byId = (id: string | null): Bot => {
  const b = bots.find((x) => x.id === id);
  if (!b) throw new Error(`no bot has id ${id}`);
  return b;
};
const name = (id: string | null) => (id === null ? 'BYE' : byId(id).label);

const tournamentIds: string[] = [];
const formatIds = new Map<Bot, string>();
let tid = '';

// --- signup through Mailpit (m3b's), sessions cached --------------------------
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
  if (b.session) {
    const { data, error } = await supabase.auth.setSession({
      access_token: b.session.access_token, refresh_token: b.session.refresh_token,
    });
    if (error || data.session?.user.id !== b.id) throw new Error(`${b.label} could not resume its session: ${error?.message}`);
    b.session = data.session;
    return;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: b.email, password: b.password });
  if (error) throw new Error(`${b.label} could not sign in: ${error.message}`);
  const id = data.session?.user.id;
  if (!id) throw new Error(`${b.label} signed in with no session`);
  b.id = id;
  b.session = data.session;
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

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
async function register(b: Bot): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: b.email,
    password: b.password,
    options: {
      emailRedirectTo: 'http://localhost:5173',
      data: {
        display_name: b.displayName,
        go_username: `M5${stamp.replace(/[^a-z0-9]/gi, '').toUpperCase()}${b.label.toUpperCase()}`,
        birth_date: '1990-01-01',
        friend_code: `${digits(4)} ${digits(4)} ${digits(4)}`,
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

// --- helpers over the shipping readers ------------------------------------------
/** Scores oriented to the pairing's player_a/player_b for a given winner. */
function scoresFor(pr: Pairing, winner: string, loserGames: 0 | 1): [number, number] {
  return winner === pr.playerA ? [2, loserGames] : [loserGames, 2];
}
/** Every final result this script meant, by pairing id (oriented a/b). */
const intended = new Map<string, [number, number]>();
const pairingsOf = (round: number) => as(host, async () => (await listPairings(tid)).filter((x) => x.round === round));
const live = (rows: Pairing[]) => rows.filter((x) => x.playerB !== null);

/** HostPanel.tsx `propose`, verbatim in its calls: pairSwiss over the counted games, every pairing blocks a rematch. */
async function propose(): Promise<{ pairs: SwissPairing[]; rematches: number; repeatBye: boolean }> {
  return as(host, async () => {
    const at = new Date();
    const [entrants, pairings] = await Promise.all([listEntrants(tid), listPairings(tid)]);
    const active = entrants.filter((e) => !e.dropped).map((e) => e.playerId);
    return pairSwiss(active, toGames(pairings, at), tid, undefined, pairings.map((x) => ({ a: x.playerA, b: x.playerB })));
  });
}
const describePairs = (pairs: SwissPairing[]) => pairs.map((x) => `${name(x.a)}-${name(x.b)}`).join(', ');

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`M5 tournament round trip — run ${stamp}\n`);
  census0 = await census();
  console.log(`census before: ${show(census0)}\n`);

  for (const b of bots) {
    await check(`0. ${b.label} registers, confirms through Mailpit, and gets a profile`, async () => {
      await register(b);
      return `${b.label} ${b.id}`;
    });
  }
  if (failures > 0) throw new Error('registration gate failed');

  // 1 ------------------------------------------------------------------------
  await check('1. host saves a private six-format, creates + opens; the stranger sees it only once open; five checkRoster-valid rosters register', async () => {
    const formatId = await as(host, () => saveServerFormat({ name: `m5 ${stamp}`, format: FORMAT }));
    formatIds.set(host, formatId);
    const saved = (await as(host, listServerFormats)).find((f) => f.id === formatId);
    assert(!!saved, 'host cannot list its own format');
    const vis = await admin.from('formats').select('visibility').eq('id', formatId).single();
    assert(vis.data?.visibility === 'private', `format visibility ${show(vis.data)}`);
    tid = await as(host, () => createTournament({
      title: `m5 ${stamp}`, description: 'm5 roundtrip', formatVersionId: saved!.versionId,
      rounds: 4, roundMinutes: 30, maxPlayers: 8, closesAt: null,
    }));
    tournamentIds.push(tid);
    const draftSeen = await as(stranger, () => getTournament(tid));
    assert(draftSeen === null, `stranger reads the draft: ${show(draftSeen)}`);
    assert((await as(host, () => openRegistration(tid))) === true, 'openRegistration did not return true');
    const seen = await as(stranger, () => getTournament(tid));
    assert(seen?.state === 'registration' && seen.league === 'great' && seen.rounds === 4, `stranger reads ${show(seen)}`);
    assert((await as(stranger, listTournaments)).some((t) => t.id === tid), 'absent from the stranger\'s listTournaments');
    const seeds: number[] = [];
    for (const [i, b] of p.entries()) {
      const r = roster(1400 + i);
      const verdict = checkRoster(r, FORMAT, 'great');
      assert(verdict.ok, `${b.label}'s roster fails checkRoster: ${show(verdict.problems)}`);
      seeds.push(await as(b, () => registerRoster(tid, r)));
    }
    const own = await as(p1, () => listRosters(tid));
    const keys = Object.keys(own.get(p1.id)![0]!).sort();
    assert(show(keys) === show(['bestBuddy', 'charges', 'cp', 'fast', 'ref']), `stored member keys ${show(keys)}`);
    const t = await as(stranger, () => getTournament(tid));
    assert(t?.entrants === 5, `entrant count ${t?.entrants}`);
    return `format ${formatId} private; tournament ${tid}; draft invisible to stranger, visible once open; seeds ${show(seeds)}; stored member keys ${show(keys)}; count 5`;
  });
  if (failures > 0) throw new Error('setup failed');

  // 2 ------------------------------------------------------------------------
  await check('2. secrecy: before close p1 reads only its own roster, the host none; after close every member reads five, a non-entrant none', async () => {
    const mine = await as(p1, () => listRosters(tid));
    assert(mine.size === 1 && mine.has(p1.id), `p1 before close reads ${show([...mine.keys()].map(name))}`);
    const hostBefore = await as(host, () => listRosters(tid));
    assert(hostBefore.size === 0, `host before close reads ${hostBefore.size}`);
    assert((await as(host, () => closeRegistration(tid))) === true, 'closeRegistration did not return true');
    const sizes: string[] = [];
    for (const b of [host, ...p]) {
      const n = (await as(b, () => listRosters(tid))).size;
      assert(n === 5, `${b.label} after close reads ${n}`);
      sizes.push(`${b.label}:${n}`);
    }
    const s = (await as(stranger, () => listRosters(tid))).size;
    assert(s === 0, `stranger after close reads ${s}`);
    return `before: p1 reads [p1], host 0; after close: ${sizes.join(' ')}; stranger ${s}`;
  });

  // 3 ------------------------------------------------------------------------
  let r1: Pairing[] = [];
  await check('3a. round 1 via pairSwiss + startRound; the odd field\'s bye is settled 2-0', async () => {
    const plan = await propose();
    assert(plan.rematches === 0 && !plan.repeatBye, `round 1 plan ${show(plan)}`);
    assert((await as(host, () => startRound(tid, plan.pairs))) === 1, 'startRound did not return 1');
    r1 = await pairingsOf(1);
    const bye = r1.filter((x) => x.playerB === null);
    assert(r1.length === 3 && bye.length === 1, `round 1 rows ${show(r1)}`);
    assert(bye[0]!.state === 'settled' && bye[0]!.scoreA === 2 && bye[0]!.scoreB === 0, `bye ${show(bye[0])}`);
    assert(live(r1).every((x) => x.state === 'pending'), 'a live pairing is not pending');
    return `round 1: ${describePairs(plan.pairs)}; bye ${name(bye[0]!.playerA)} settled 2-0`;
  });

  // 4 ------------------------------------------------------------------------
  await check('4. live opponents open a DM and read each other\'s friend code with no friendship; a non-opponent cannot; a blocked pair cannot DM', async () => {
    const [t1, t2] = live(r1) as [Pairing, Pairing];
    const a1 = byId(t1.playerA), b1 = byId(t1.playerB), a2 = byId(t2.playerA), b2 = byId(t2.playerB);
    const dm = await as(a1, () => openDm(b1.id));
    const dmBack = await as(b1, () => openDm(a1.id));
    assert(!!dm && dm === dmBack, `DM ids ${dm} / ${dmBack}`);
    const code = await as(a1, () => opponentFriendCode(b1.id));
    assert(!!code && /^[0-9]{4} [0-9]{4} [0-9]{4}$/.test(code), `a1 reads b1's code ${show(code)}`);
    const codeBack = await as(b1, () => opponentFriendCode(a1.id));
    assert(!!codeBack, 'b1 cannot read a1\'s code');
    const nonOpp = await refusal(() => as(a1, () => openDm(a2.id)));
    assert(nonOpp === 'that person cannot be messaged', `non-opponent DM refused with ${show(nonOpp)}`);
    const nonOppCode = await as(a1, () => opponentFriendCode(a2.id));
    assert(nonOppCode === null, `a1 reads non-opponent a2's code ${show(nonOppCode)}`);
    assert((await as(b2, () => blockUser(a2.id))) === true, 'blockUser did not return true');
    const blocked = await refusal(() => as(a2, () => openDm(b2.id)));
    assert(blocked === 'that person cannot be messaged', `blocked DM refused with ${show(blocked)}`);
    const blockedBack = await refusal(() => as(b2, () => openDm(a2.id)));
    const blockedCode = await as(a2, () => opponentFriendCode(b2.id));
    return `${a1.label}<->${b1.label} DM ${dm}, both codes readable; ${a1.label}->${a2.label} (not opponents): "${nonOpp}", code null; ${b2.label} blocks ${a2.label}: both directions "${blocked}"/"${blockedBack}" (info: the blocked opponent's friend-code read returns ${blockedCode === null ? 'null' : 'the code — the friend-code policy has no block clause'})`;
  });

  // 5 ------------------------------------------------------------------------
  await check('5a. viewer_b reports a win for player_b, player_a confirms: settled, stored scores oriented a/b', async () => {
    const t1 = live(r1)[0]!;
    const [sa, sb] = scoresFor(t1, t1.playerB!, 1);
    assert((await as(byId(t1.playerB), () => reportScore(t1.id, sa, sb))) === 'reported', 'report did not return reported');
    const own = await refusal(() => as(byId(t1.playerB), () => confirmScore(t1.id)));
    assert(own === 'the other player confirms your report', `self-confirm refused with ${show(own)}`);
    assert((await as(byId(t1.playerA), () => confirmScore(t1.id))) === 'settled', 'confirm did not return settled');
    const row = (await pairingsOf(1)).find((x) => x.id === t1.id)!;
    assert(row.state === 'settled' && row.scoreA === sa && row.scoreB === sb, `stored ${show(row)}`);
    intended.set(t1.id, [sa, sb]);
    return `${name(t1.playerB)} (player_b) reported ${sa}-${sb} (a-b), ${name(t1.playerA)} confirmed; stored ${row.scoreA}-${row.scoreB} settled; self-confirm "${own}"`;
  });

  await check('5b. a reported result with final_at time-travelled into the past (ADMIN) counts', async () => {
    const t2 = live(r1)[1]!;
    const [sa, sb] = scoresFor(t2, t2.playerA, 0);
    assert((await as(byId(t2.playerA), () => reportScore(t2.id, sa, sb))) === 'reported', 'report did not return reported');
    const before = (await pairingsOf(1)).find((x) => x.id === t2.id)!;
    assert(!isCounted(before, new Date()), `counted before the deadline: ${show(before)}`);
    const early = await refusal(() => as(host, () => startRound(tid, [])));
    assert(early === '1 pairings are unsettled', `startRound while reported refused with ${show(early)}`);
    // THE ONE ADMIN TIME-TRAVEL: no client may move final_at.
    const past = new Date(Date.now() - 60_000).toISOString();
    const tt = await admin.from('tournament_pairings').update({ final_at: past }).eq('id', t2.id).eq('state', 'reported').select('id');
    assert(!tt.error && (tt.data ?? []).length === 1, `time travel ${show(tt)}`);
    const after = (await pairingsOf(1)).find((x) => x.id === t2.id)!;
    assert(after.state === 'reported' && isCounted(after, new Date()), `after ${show(after)}`);
    assert(toGames(await pairingsOf(1), new Date()).length === 3, 'toGames does not count all three round-1 games');
    const late = await refusal(() => as(byId(t2.playerB), () => disputeScore(t2.id)));
    assert(late === 'that result is final', `dispute after final_at refused with ${show(late)}`);
    intended.set(t2.id, [sa, sb]);
    return `${name(t2.playerA)} reported ${sa}-${sb}; before: not counted, startRound "${early}"; final_at -> ${past} (admin); counted as 'reported'; late dispute "${late}"`;
  });

  await check('3b. a rematch and a repeated bye are refused by startRound', async () => {
    const [t1, t2] = live(r1) as [Pairing, Pairing];
    const bye = r1.find((x) => x.playerB === null)!.playerA;
    const rematch = await refusal(() => as(host, () => startRound(tid, [
      { a: t1.playerA, b: t1.playerB }, { a: t2.playerA, b: t2.playerB }, { a: bye, b: null }])));
    assert(rematch === 'those two have already played', `rematch refused with ${show(rematch)}`);
    const repeatBye = await refusal(() => as(host, () => startRound(tid, [
      { a: bye, b: null }, { a: t1.playerA, b: t2.playerA }, { a: t1.playerB!, b: t2.playerB }])));
    assert(repeatBye === 'that player has already had a bye', `repeat bye refused with ${show(repeatBye)}`);
    const t = await as(host, () => getTournament(tid));
    assert(t?.currentRound === 1, `current round moved to ${t?.currentRound}`);
    return `rematch: "${rematch}"; repeat bye for ${name(bye)}: "${repeatBye}"; still round 1`;
  });

  let r2: Pairing[] = [];
  await check('3c. round 2 via pairSwiss over the counted games: no rematch, a fresh bye', async () => {
    const plan = await propose();
    assert(plan.rematches === 0 && !plan.repeatBye, `round 2 plan ${show(plan)}`);
    assert((await as(host, () => startRound(tid, plan.pairs))) === 2, 'startRound did not return 2');
    r2 = await pairingsOf(2);
    assert(r2.length === 3, `round 2 rows ${r2.length}`);
    return `round 2: ${describePairs(plan.pairs)}`;
  });

  // Extra (c), mid-tournament ------------------------------------------------
  await check('(c1) myTournamentActivity mid-run: a player gets only its own current-round pairing, the host every current-round pairing, a stranger nothing', async () => {
    const mine = await as(p1, myTournamentActivity);
    assert(mine.tournaments.length === 1 && mine.tournaments[0]!.id === tid, `p1 tournaments ${show(mine.tournaments.map((t) => t.id))}`);
    assert(mine.pairings.length === 1 && mine.pairings[0]!.round === 2 && [mine.pairings[0]!.playerA, mine.pairings[0]!.playerB].includes(p1.id),
      `p1 pairings ${show(mine.pairings)}`);
    const h = await as(host, myTournamentActivity);
    assert(h.pairings.length === 3 && h.pairings.every((x) => x.round === 2 && x.tournamentId === tid), `host pairings ${show(h.pairings)}`);
    const s = await as(stranger, myTournamentActivity);
    assert(s.tournaments.length === 0 && s.pairings.length === 0, `stranger ${show(s)}`);
    return `p1: 1 tournament, 1 pairing (round 2, its own); host: 3 pairings, all round 2; stranger: nothing`;
  });

  await check('5c. a dispute is settled by the host; the audit row holds the previous score', async () => {
    const d = live(r2)[0]!;
    const [ra, rb] = scoresFor(d, d.playerA, 1);
    await as(byId(d.playerA), () => reportScore(d.id, ra, rb));
    assert((await as(byId(d.playerB), () => disputeScore(d.id))) === 'disputed', 'dispute did not return disputed');
    const [sa, sb] = scoresFor(d, d.playerB!, 0);
    assert((await as(host, () => settlePairing(d.id, sa, sb, 'm5: host ruling'))) === 'settled', 'settle did not return settled');
    const audit = await as(host, () => listAudit(tid));
    const row = audit.find((x) => x.action === 'settle_pairing' && (x.detail as { pairing?: string }).pairing === d.id);
    const det = row?.detail as Record<string, unknown> | undefined;
    assert(!!det && det.was_state === 'disputed' && det.was_score_a === ra && det.was_score_b === rb && det.score_a === sa && det.score_b === sb,
      `audit ${show(row)}`);
    const stored = (await pairingsOf(2)).find((x) => x.id === d.id)!;
    assert(stored.scoreA === sa && stored.scoreB === sb && stored.note === 'm5: host ruling', `stored ${show(stored)}`);
    intended.set(d.id, [sa, sb]);
    return `${name(d.playerA)} reported ${ra}-${rb}, ${name(d.playerB)} disputed, host settled ${sa}-${sb}; audit ${show({ was_state: det!.was_state, was: [det!.was_score_a, det!.was_score_b], now: [det!.score_a, det!.score_b] })}`;
  });

  await check('5d. judges: the host grants the stranger; the judge cannot grant; an entrant made judge cannot settle their own game', async () => {
    assert((await as(host, () => grantJudge(tid, stranger.id))) === true, 'grantJudge returned false');
    const cant = await refusal(() => as(stranger, () => grantJudge(tid, p5.id)));
    assert(cant === 'not allowed', `judge grant refused with ${show(cant)}`);
    const own = live(r2)[1]!;
    const player = byId(own.playerA);
    await as(host, () => grantJudge(tid, player.id));
    const self = await refusal(() => as(player, () => settlePairing(own.id, 2, 0)));
    assert(self === 'you cannot settle your own game', `own-game settle refused with ${show(self)}`);
    const { error } = await as(host, async () => supabase.rpc('revoke_judge', { p_id: tid, p_user: player.id }));
    assert(!error, `revoke_judge ${error?.message}`);
    return `stranger is judge; stranger grant: "${cant}"; ${player.label} as judge on its own game: "${self}" (then revoked)`;
  });

  // 6 ------------------------------------------------------------------------
  let r3: Pairing[] = [];
  await check('6a. startRound is refused with an unsettled pairing, accepted with p_force, and the force is audited', async () => {
    const plan = await propose();
    const refused = await refusal(() => as(host, () => startRound(tid, plan.pairs)));
    assert(refused === '1 pairings are unsettled', `refused with ${show(refused)}`);
    const override = plan.rematches > 0 || plan.repeatBye;
    assert((await as(host, () => startRound(tid, plan.pairs, true, override))) === 3, 'forced startRound did not return 3');
    const audit = await as(host, () => listAudit(tid));
    const row = audit.find((x) => x.action === 'start_round' && (x.detail as { round?: number }).round === 3);
    const det = row?.detail as Record<string, unknown> | undefined;
    assert(det?.forced === true && det.unsettled === 1, `audit ${show(row)}`);
    r3 = await pairingsOf(3);
    return `refused "${refused}"; forced -> round 3 (${describePairs(plan.pairs)}; rematches ${plan.rematches}, override ${override}); audit ${show(det)}`;
  });

  await check('5e. the judge settles the leftover round-2 pairing while round 3 runs', async () => {
    const left = live(r2)[1]!;
    const [sa, sb] = scoresFor(left, [left.playerA, left.playerB!].sort((x, y) => p.indexOf(byId(x)) - p.indexOf(byId(y)))[0]!, 1);
    assert((await as(stranger, () => settlePairing(left.id, sa, sb, 'm5: judge'))) === 'settled', 'judge settle did not return settled');
    const row = (await pairingsOf(2)).find((x) => x.id === left.id)!;
    assert(row.state === 'settled' && row.scoreA === sa && row.scoreB === sb, `stored ${show(row)}`);
    intended.set(left.id, [sa, sb]);
    return `judge settled ${name(left.playerA)}-${name(left.playerB)} ${sa}-${sb}`;
  });

  // 7 ------------------------------------------------------------------------
  let dropper: Bot | null = null;
  await check('7. dropOut forfeits the pending pairing (0-2 against the dropper) and excludes the player from the next pairSwiss/startRound', async () => {
    const t1 = live(r3)[0]!;
    dropper = byId(t1.playerA);
    const other = t1.playerB!;
    assert((await as(dropper, () => dropOut(tid))) === true, 'dropOut did not return true');
    const row = (await pairingsOf(3)).find((x) => x.id === t1.id)!;
    assert(row.state === 'settled' && row.scoreA === 0 && row.scoreB === 2 && row.note === 'dropped out', `forfeit ${show(row)}`);
    intended.set(t1.id, [0, 2]);
    const t2 = live(r3)[1]!;
    const [sa, sb] = scoresFor(t2, t2.playerA, 1);
    await as(byId(t2.playerA), () => reportScore(t2.id, sa, sb));
    await as(byId(t2.playerB), () => confirmScore(t2.id));
    intended.set(t2.id, [sa, sb]);
    const ent = await as(host, () => listEntrants(tid));
    assert(ent.find((e) => e.playerId === dropper!.id)?.dropped === true, 'entrant not marked dropped');
    const plan = await propose();
    assert(!plan.pairs.some((x) => x.a === dropper!.id || x.b === dropper!.id), `plan pairs the dropper: ${describePairs(plan.pairs)}`);
    assert(plan.pairs.length === 2 && plan.pairs.every((x) => x.b !== null), `4-player plan ${describePairs(plan.pairs)}`);
    const withDropped = await refusal(() => as(host, () => startRound(tid, [
      { a: dropper!.id, b: plan.pairs[0]!.a }, { a: plan.pairs[0]!.b!, b: plan.pairs[1]!.a }, { a: plan.pairs[1]!.b!, b: null }], false, true)));
    assert(withDropped === 'pairings may only name active entrants', `dropper pairing refused with ${show(withDropped)}`);
    const override = plan.rematches > 0 || plan.repeatBye;
    assert((await as(host, () => startRound(tid, plan.pairs, false, override))) === 4, 'round 4 did not start');
    const count = (await as(stranger, () => getTournament(tid)))?.entrants;
    assert(count === 4, `entrant count after the drop ${count}`);
    return `${dropper.label} dropped vs ${name(other)}: settled 0-2 'dropped out'; round 4 (${describePairs(plan.pairs)}; rematches ${plan.rematches}, override ${override}) excludes it; naming it: "${withDropped}"; entrant count 4`;
  });

  await check('6b. finishTournament is refused while unsettled, accepted after; standings match the hand tally', async () => {
    const r4 = await pairingsOf(4);
    const [q1, q2] = r4 as [Pairing, Pairing];
    const [a1, b1] = scoresFor(q1, q1.playerB!, 0);
    await as(byId(q1.playerB), () => reportScore(q1.id, a1, b1));
    const early = await refusal(() => as(host, () => finishTournament(tid)));
    assert(early === 'unsettled pairings remain', `finish refused with ${show(early)}`);
    await as(byId(q1.playerA), () => confirmScore(q1.id));
    const [a2, b2] = scoresFor(q2, q2.playerA, 1);
    await as(byId(q2.playerA), () => reportScore(q2.id, a2, b2));
    await as(byId(q2.playerB), () => confirmScore(q2.id));
    intended.set(q1.id, [a1, b1]);
    intended.set(q2.id, [a2, b2]);
    assert((await as(host, () => finishTournament(tid))) === true, 'finish did not return true');
    const over = await refusal(() => as(host, () => settlePairing(q1.id, 2, 0)));
    assert(over === 'this tournament is over', `settle after finish refused with ${show(over)}`);

    const all = await as(p2, () => listPairings(tid));
    const ent = await as(p2, () => listEntrants(tid));
    const now = new Date();
    for (const x of all.filter((y) => y.playerB !== null)) {
      const want = intended.get(x.id);
      assert(!!want && x.scoreA === want[0] && x.scoreB === want[1], `pairing ${x.id} stored ${x.scoreA}-${x.scoreB}, meant ${show(want)}`);
    }
    // The hand tally: a bye is 2-0 and a match win; otherwise the higher score wins.
    const tally = new Map(ent.map((e) => [e.playerId, { matches: 0, matchWins: 0, gameWins: 0, gameLosses: 0 }]));
    for (const x of all) {
      const A = tally.get(x.playerA)!;
      A.matches++;
      if (x.playerB === null) { A.matchWins++; A.gameWins += 2; continue; }
      const [sa, sb] = intended.get(x.id)!;
      const B = tally.get(x.playerB)!;
      B.matches++;
      A.gameWins += sa; A.gameLosses += sb; B.gameWins += sb; B.gameLosses += sa;
      if (sa > sb) A.matchWins++; else if (sb > sa) B.matchWins++;
    }
    const st = standings(ent.map((e) => e.playerId), toGames(all, now));
    for (const s of st) {
      const want = tally.get(s.id)!;
      assert(s.matches === want.matches && s.matchWins === want.matchWins && s.gameWins === want.gameWins && s.gameLosses === want.gameLosses,
        `${name(s.id)} standings ${show(s)} vs tally ${show(want)}`);
    }
    for (let i = 1; i < st.length; i++) assert(st[i - 1]!.matchWins >= st[i]!.matchWins, `order ${st.map((s) => `${name(s.id)}:${s.matchWins}`).join(' ')}`);
    const t = await as(p2, () => getTournament(tid));
    assert(t?.state === 'complete', `state ${t?.state}`);
    return `finish while reported: "${early}"; after: complete; settle after: "${over}"; ${all.length} pairings all stored as meant; standings ${st.map((s) => `${name(s.id)} ${s.matchWins}-${s.matches - s.matchWins} (${s.gameWins}:${s.gameLosses})`).join(', ')}`;
  });

  // 8 ------------------------------------------------------------------------
  await check('8. an anonymous client is refused create_tournament, register_roster, start_round, report_score', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const any = (await as(host, () => listPairings(tid)))[0]!.id;
    const calls = {
      create_tournament: await anon.rpc('create_tournament', {
        p_title: 'x', p_description: '', p_format_version: tid, p_rounds: 1, p_round_minutes: 25, p_max_players: 8, p_closes_at: null }),
      register_roster: await anon.rpc('register_roster', { p_id: tid, p_roster: roster(1400) }),
      start_round: await anon.rpc('start_round', { p_tournament: tid, p_pairings: [], p_force: false, p_override: false }),
      report_score: await anon.rpc('report_score', { p_pairing: any, p_score_a: 2, p_score_b: 0 }),
    };
    const out: string[] = [];
    for (const [fn, r] of Object.entries(calls)) {
      assert(!!r.error && /permission denied/i.test(r.error.message), `${fn} as anon: ${show(r.error ?? r.data)}`);
      out.push(`${fn}: "${r.error!.message}"`);
    }
    return out.join('; ');
  });

  // Extra (b) ------------------------------------------------------------------
  await check('(b) paging mechanics against the real PostgREST: .range is inclusive, pages concatenate to listPairings, a page at the end is empty', async () => {
    // listPairings' page size (500) is a module constant, not exposed: this drives the same query shape with pages of 2.
    return as(p3, async () => {
      const all = await listPairings(tid);
      const q = (from: number, to: number) => supabase.from('tournament_pairings').select('id')
        .eq('tournament_id', tid).order('round', { ascending: true }).order('table_no', { ascending: true }).range(from, to);
      const ids: string[] = [];
      let pages = 0;
      for (let i = 0; ; i++) {
        const { data, error } = await q(i * 2, i * 2 + 1);
        if (error) throw new Error(`page ${i}: ${error.message}`);
        pages++;
        assert((data ?? []).length <= 2, `page ${i} returned ${(data ?? []).length} rows for range(${i * 2}, ${i * 2 + 1})`);
        ids.push(...(data ?? []).map((r) => r.id as string));
        if ((data ?? []).length < 2) break;
      }
      assert(show(ids) === show(all.map((x) => x.id)), `paged ids differ from listPairings (${ids.length} vs ${all.length})`);
      const end = await q(all.length, all.length + 1);
      assert(!end.error && (end.data ?? []).length === 0, `range at the exact end: ${show(end.error ?? end.data)}`);
      const past = await q(all.length + 4, all.length + 5);
      return `${all.length} rows; pages of 2 via range(i*2, i*2+1): ${pages} pages, same ids and order as listPairings; range(${all.length}, ${all.length + 1}) -> [] with no error (a full last page is safe); range past the end -> ${past.error ? `error "${past.error.message}"` : `${(past.data ?? []).length} rows`}`;
    });
  });

  // Extra (a) + (c) ------------------------------------------------------------
  await check('(a)+(c2) three tournaments with 0 / 1-dropped+1-active / 0-active entrants list with counts 0, 1, 0; notices stay in their own tournament; a draft reaches nobody else', async () => {
    const fid = await as(stranger, () => saveServerFormat({ name: `m5 ${stamp} s`, format: FORMAT }));
    formatIds.set(stranger, fid);
    const vid = (await as(stranger, listServerFormats)).find((f) => f.id === fid)!.versionId;
    const make = async (title: string, open: boolean) => {
      const id = await as(stranger, () => createTournament({
        title: `m5 ${stamp} ${title}`, description: '', formatVersionId: vid, rounds: 1, roundMinutes: 30, maxPlayers: 8, closesAt: null }));
      tournamentIds.push(id);
      if (open) await as(stranger, () => openRegistration(id));
      return id;
    };
    const ta = await make('zero', true);
    const tb = await make('one-dropped', true);
    const tc = await make('all-dropped', true);
    const td = await make('draft', false);
    for (const [t, pair] of [[tb, [p1, p2]], [tc, [p3, p4]]] as const) {
      for (const b of pair) await as(b, () => registerRoster(t, roster(1450)));
      await as(stranger, () => closeRegistration(t));
      await as(stranger, () => startRound(t, [{ a: pair[0].id, b: pair[1].id }]));
    }
    // (c2) before anyone drops: each player sees only its own tournament's pairing.
    const a1 = await as(p1, myTournamentActivity);
    assert(show(a1.tournaments.map((t) => t.id)) === show([tb]) && a1.pairings.length === 1 && a1.pairings[0]!.tournamentId === tb,
      `p1 activity ${show({ t: a1.tournaments.map((t) => t.id), p: a1.pairings.map((x) => x.tournamentId) })}`);
    const a3 = await as(p3, myTournamentActivity);
    assert(show(a3.tournaments.map((t) => t.id)) === show([tc]) && a3.pairings.length === 1 && a3.pairings[0]!.tournamentId === tc,
      `p3 activity ${show({ t: a3.tournaments.map((t) => t.id), p: a3.pairings.map((x) => x.tournamentId) })}`);
    const org = await as(stranger, myTournamentActivity);
    const orgT = new Set(org.pairings.map((x) => x.tournamentId));
    assert(orgT.size === 2 && orgT.has(tb) && orgT.has(tc) && !org.tournaments.some((t) => t.id === td || t.id === tid),
      `organiser activity ${show({ t: org.tournaments.map((t) => t.id), p: [...orgT] })}`);
    const p5a = await as(p5, myTournamentActivity);
    assert(p5a.tournaments.length === 0 && p5a.pairings.length === 0, `p5 activity ${show(p5a)}`);
    const hostA = await as(host, myTournamentActivity);
    assert(hostA.tournaments.length === 0 && hostA.pairings.length === 0, `host (complete tournament) activity ${show(hostA)}`);
    assert((await as(p5, () => getTournament(td))) === null, 'p5 reads the draft');

    await as(p2, () => dropOut(tb));
    await as(p3, () => dropOut(tc));
    await as(p4, () => dropOut(tc));
    const listed = await as(p5, listTournaments);
    const counts = [ta, tb, tc].map((id) => listed.find((t) => t.id === id)?.entrants ?? 'MISSING');
    assert(show(counts) === show([0, 1, 0]), `counts ${show(counts)}`);
    assert(!listed.some((t) => t.id === td), 'the draft is listed for p5');
    const single = await as(p5, () => getTournament(tc));
    assert(single?.entrants === 0, `getTournament(all-dropped).entrants ${single?.entrants}`);
    return `listTournaments as p5: zero=${counts[0]}, one-dropped=${counts[1]}, all-dropped=${counts[2]} (parent rows all present), draft absent; getTournament(all-dropped)=0; activity: p1 -> [one-dropped] only, p3 -> [all-dropped] only, organiser -> both pairings (not the draft), p5 and host (complete) -> nothing`;
  });
}

// --- cleanup ------------------------------------------------------------------
async function cleanup(): Promise<void> {
  if (tournamentIds.length) {
    const d = await admin.from('tournaments').delete().in('id', tournamentIds);
    if (d.error) console.log(`      [cleanup] tournaments: ${d.error.message}`);
  }
  for (const [b, id] of formatIds) {
    try {
      await as(b, () => deleteServerFormat(id));
    } catch (e) {
      console.log(`      [cleanup] format ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await supabase.auth.signOut();
  for (const b of bots) {
    if (!b.id) continue;
    const { error } = await admin.auth.admin.deleteUser(b.id);
    if (error) console.log(`      [cleanup] account ${b.label}: ${error.message}`);
  }
}

const CENSUS = [
  'profiles', 'friend_codes', 'formats', 'format_versions', 'friendships', 'blocks', 'channels', 'channel_members', 'messages',
  'tournaments', 'tournament_entrants', 'tournament_rosters', 'tournament_roles', 'tournament_pairings', 'tournament_audit',
];
let census0: Record<string, number | null> | null = null;
async function census(): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const t of CENSUS) out[t] = (await admin.from(t).select('*', { count: 'exact', head: true })).count ?? null;
  return out;
}

async function verifyCleanup(): Promise<void> {
  const ids = bots.map((b) => b.id).filter(Boolean);
  if (ids.length === 0) return;
  await check('9. census: every row this run created is gone and every table is the size it was', async () => {
    const [pr, t, ch] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', ids),
      tournamentIds.length ? admin.from('tournaments').select('id', { count: 'exact', head: true }).in('id', tournamentIds) : Promise.resolve({ count: 0 }),
      admin.from('channels').select('id', { count: 'exact', head: true }).in('created_by', ids),
    ]);
    const counts = { profiles: pr.count, tournaments: t.count, channels: ch.count };
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
