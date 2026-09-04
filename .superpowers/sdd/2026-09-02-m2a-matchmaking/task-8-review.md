# Task 8 review package — a86e114..HEAD

## Commits
5c89a6c feat(matchmaking): the Matchmaking screen — queue, offer board, scheduled proposals

## Files changed
 .../2026-09-02-m2a-matchmaking/task-8-report.md    | 196 ++++++++
 app/src/App.tsx                                    |   5 +
 app/src/lib/screens.ts                             |  12 +
 app/src/screens/MatchmakingScreen.tsx              | 507 +++++++++++++++++++++
 app/src/screens/__tests__/matchmaking.test.tsx     | 356 +++++++++++++++
 app/src/state/AppState.tsx                         |   2 +-
 6 files changed, 1077 insertions(+), 1 deletion(-)

## Full diff
diff --git a/app/src/App.tsx b/app/src/App.tsx
index b0dfe96..e5dc478 100644
--- a/app/src/App.tsx
+++ b/app/src/App.tsx
@@ -30,20 +30,23 @@ const CoresScreen = lazy(() => import('./screens/CoresScreen').then((m) => ({ de
 const DiagnosticsScreen = lazy(() => import('./screens/DiagnosticsScreen').then((m) => ({ default: m.DiagnosticsScreen })));
 const MovesScreen = lazy(() => import('./screens/MovesScreen').then((m) => ({ default: m.MovesScreen })));
 const FormatBuilderScreen = lazy(() =>
   import('./screens/FormatBuilderScreen').then((m) => ({ default: m.FormatBuilderScreen })),
 );
 // Lazy for a different reason than the others: not megabytes of data, just a
 // screen most visits never open. It does NOT keep @supabase/supabase-js out of
 // the entry chunk — SessionProvider is mounted at the root below, so the client
 // is in the entry chunk either way. Only this screen's own code is deferred.
 const SignInScreen = lazy(() => import('./screens/SignInScreen').then((m) => ({ default: m.SignInScreen })));
+const MatchmakingScreen = lazy(() =>
+  import('./screens/MatchmakingScreen').then((m) => ({ default: m.MatchmakingScreen })),
+);
 
 function Nav() {
   const { state, set, patch } = useAppState();
   return (
     <div className="nav sticky top-0 z-20 flex-wrap">
       <button
         className="nav-brand"
         onClick={() => set('screen', 'landing')}
         title="Back to the start"
       >
@@ -126,20 +129,22 @@ function Screens() {
     case 'show6':
       return <LazyScreen key="show6"><TeamBuilderScreen size={6} /></LazyScreen>;
     case 'cores':
       return <LazyScreen key="cores"><CoresScreen /></LazyScreen>;
     case 'diagnostics':
       return <LazyScreen key="diagnostics"><DiagnosticsScreen /></LazyScreen>;
     case 'moves':
       return <LazyScreen key="moves"><MovesScreen /></LazyScreen>;
     case 'formats':
       return <LazyScreen key="formats"><FormatBuilderScreen /></LazyScreen>;
+    case 'matchmaking':
+      return <LazyScreen key="matchmaking"><MatchmakingScreen /></LazyScreen>;
     case 'account':
       return <LazyScreen key="account"><SignInScreen /></LazyScreen>;
   }
 }
 
 /**
  * Holds the shell steady while a screen's chunk arrives.
  *
  * Sized rather than empty on purpose: these screens sit inside the shell's
  * animated container, and an unsized fallback collapses the page to the nav for
diff --git a/app/src/lib/screens.ts b/app/src/lib/screens.ts
index 8160457..4a65f43 100644
--- a/app/src/lib/screens.ts
+++ b/app/src/lib/screens.ts
@@ -88,20 +88,32 @@ export const SCREEN_DEFS: ScreenDef[] = [
     blurb: 'Every fast and charge move, with the figures that rank them.',
   },
   {
     id: 'formats',
     label: 'Formats',
     kicker: 'Rulesets',
     glyph: '⌘',
     hue: 'var(--type-dark)',
     blurb: 'Author a format clause by clause, and watch the legal pool move as you type.',
   },
+  {
+    id: 'matchmaking',
+    label: 'Matches',
+    kicker: 'Opponents',
+    // Not --type-fighting: the Battle screen already carries it, and every
+    // screen needs a distinct hue for colour to identify a section (see
+    // src/lib/__tests__/screens.test.ts). Ghost fits a blind queue anyway —
+    // the opponent is unseen until the pairing lands.
+    glyph: '⚔',
+    hue: 'var(--type-ghost)',
+    blurb: 'Queue for a blind match, browse an open offer, or schedule one for later.',
+  },
   {
     id: 'account',
     label: 'Account',
     kicker: 'You',
     glyph: '◉',
     hue: 'var(--type-normal)',
     blurb: 'Sign in, and choose the name the rest of Paragon will know you by.',
   },
 ];
 
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
new file mode 100644
index 0000000..2418d8f
--- /dev/null
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -0,0 +1,507 @@
+import { useEffect, useMemo, useState } from 'react';
+import { ScreenHeader } from '../components/ScreenHeader';
+import { PokemonCard } from '../components/PokemonCard';
+import { SpeciesSearch } from '../components/SpeciesSearch';
+import type { AddPokemonChoice } from '../components/AddPokemonModal';
+import { useAppState } from '../state/AppState';
+import { useSession } from '../state/SessionContext';
+import { LEAGUE_BY_ID, conflictsOnTeam, movesFor, pickableFor, speciesOf } from '../lib/data';
+import { defaultSpreadFor } from '../lib/engine';
+import { encodeMember, type StoredMember } from '../lib/teamCodec';
+import { RULES_SCHEMA, type Format } from '../rules';
+import type { LeagueId } from '../lib/types';
+import {
+  acceptOffer,
+  confirmOffer,
+  createOffer,
+  joinQueue,
+  leaveQueue,
+  listOpenOffers,
+  myMatches,
+  myQueueEntry,
+  opponentFriendCode,
+  type Match,
+  type Offer,
+  type QueueEntry,
+} from '../lib/matchmaking';
+
+/**
+ * The Matchmaking screen: three answers to one question — who do I play next
+ * — on one screen. A blind queue paired by the coordinator, a live board of
+ * offers anyone can browse and accept, and scheduled proposals that need
+ * both sides to confirm before they become a match.
+ *
+ * The roster is built right here rather than loaded from a saved team: this
+ * screen's "Consumes" list is deliberately narrow (Task 7's matchmaking API,
+ * `useSession`, `LEAGUE_BY_ID`), and pulling in `lib/saves`' saved-team and
+ * saved-format machinery would have meant mocking a second module boundary
+ * this screen's tests were never asked to cover. What is built here is
+ * scored under the league's own rated moveset — the same fallback `Slot`
+ * uses on `TeamBuilderScreen` for a member that was never opened in a build
+ * picker.
+ *
+ * `formatVersionId`/`format` are the "canonical league format" the design
+ * spec describes for the open queue: the whole base league, no extra
+ * clauses. See the KNOWN GAP note on `canonicalFormatVersionId` below —
+ * there is currently no code anywhere, in this screen or elsewhere, that can
+ * produce or discover a *real* `format_versions.id` for it.
+ */
+
+const ROSTER_SIZE = 3;
+
+function canonicalFormat(league: LeagueId): Format {
+  return {
+    schema: RULES_SCHEMA,
+    base: league,
+    start: 'league',
+    pool: [],
+    composition: { size: ROSTER_SIZE, uniqueSpecies: true },
+    selection: { mode: 'open' },
+  };
+}
+
+/**
+ * KNOWN GAP, reported rather than papered over (see task-8-report.md): a
+ * `format_version_id` is a foreign key into `format_versions`, and nothing
+ * in this codebase today can produce or discover a real one for a league's
+ * canonical, unrestricted ruleset — there is no seed migration for it, and
+ * `lib/saves.ts`'s `listServerFormats` doesn't expose `format_versions.id`
+ * for a custom saved format either (only `formats.id`, a different table).
+ * This placeholder keeps the shape of the write honest rather than hiding
+ * the gap; `joinQueue`/`createOffer` will fail their foreign key against a
+ * real database until that plumbing exists.
+ */
+function canonicalFormatVersionId(league: LeagueId): string {
+  return `canonical:${league}`;
+}
+
+function messageOf(e: unknown): string {
+  return e instanceof Error ? e.message : String(e);
+}
+
+/** What a member saves as when it was never opened in a build picker — the
+ * league's rated set, same fallback `TeamBuilderScreen`'s `Slot` uses. */
+function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
+  const sp = speciesOf(refId);
+  if (!sp) return { ref: refId, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } };
+  const rated = movesFor(sp, leagueId);
+  const spread = defaultSpreadFor(refId, leagueId, true);
+  return {
+    ref: refId,
+    fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
+    chargeIds: rated.charges.map((c) => c.id),
+    iv: { a: spread.a, d: spread.d, s: spread.s },
+  };
+}
+
+function queueStatusText(entry: QueueEntry): string {
+  // `verifiedHash` is null until the coordinator recomputes it; only a
+  // verified entry is eligible to pair. Saying "queued" alone would imply a
+  // match is imminent when it may not even be checked yet.
+  return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
+}
+
+export function MatchmakingScreen() {
+  const { state } = useAppState();
+  const { user } = useSession();
+  const league = state.league;
+
+  // --- the roster, built locally on this screen ---------------------------
+  const [team, setTeam] = useState<string[]>([]);
+  const selectable = useMemo(
+    () => new Set(pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))),
+    [league, team],
+  );
+  const add = (ref: string) => {
+    setTeam((t) =>
+      t.includes(ref) || t.length >= ROSTER_SIZE || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
+    );
+  };
+  const clear = (i: number) => setTeam((t) => t.filter((_, n) => n !== i));
+  const buildTeam = (): StoredMember[] => team.map((ref) => encodeMember(defaultChoice(ref, league), league));
+  const rosterReady = team.length === ROSTER_SIZE;
+
+  // --- the blind queue ------------------------------------------------------
+  const [entry, setEntry] = useState<QueueEntry | null>(null);
+  const [matches, setMatches] = useState<Match[] | null>(null);
+  const [codes, setCodes] = useState<Record<string, string | null>>({});
+  const [busy, setBusy] = useState(false);
+  const [notice, setNotice] = useState<string | null>(null);
+
+  useEffect(() => {
+    if (!user) {
+      setEntry(null);
+      setMatches(null);
+      setCodes({});
+      return;
+    }
+    let live = true;
+    void myQueueEntry()
+      .then((e) => {
+        if (live) setEntry(e);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    void myMatches()
+      .then((m) => {
+        if (live) setMatches(m);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    return () => {
+      live = false;
+    };
+  }, [user]);
+
+  // Friend codes are readable only once a match pairs two people — fetched
+  // once matches are known, one call per opponent, never guessed at.
+  useEffect(() => {
+    if (!matches || matches.length === 0) return;
+    let live = true;
+    void Promise.all(
+      matches.map((m) => opponentFriendCode(m.opponentId).then((code) => [m.opponentId, code] as const)),
+    ).then((pairs) => {
+      if (live) setCodes(Object.fromEntries(pairs));
+    });
+    return () => {
+      live = false;
+    };
+  }, [matches]);
+
+  const join = async () => {
+    if (!rosterReady || entry || busy) return;
+    setBusy(true);
+    setNotice(null);
+    try {
+      await joinQueue({
+        league,
+        formatVersionId: canonicalFormatVersionId(league),
+        format: canonicalFormat(league),
+        team: buildTeam(),
+      });
+      setEntry(await myQueueEntry());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const leave = async () => {
+    if (!entry) return;
+    // Irreversible the moment it lands — the same confirm idiom
+    // `TeamBuilderScreen` uses before `deleteTeam`.
+    if (!window.confirm('Leave the queue? You will stop being matched until you join again.')) return;
+    setBusy(true);
+    setNotice(null);
+    try {
+      await leaveQueue();
+      setEntry(null);
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  // --- the open offer board --------------------------------------------------
+  const [offers, setOffers] = useState<Offer[] | null>(null);
+  const [justAccepted, setJustAccepted] = useState<{ offerId: string; matchId: string | null } | null>(null);
+  const [postOpen, setPostOpen] = useState(false);
+  const [scheduleAt, setScheduleAt] = useState('');
+  // Offers this screen has posted this session, so a Confirm control can be
+  // offered for them. There is no function anywhere in `lib/matchmaking` to
+  // list "offers I proposed" (only `listOpenOffers`, scoped to `state =
+  // 'open'`, which an accepted offer has already left) — see the report.
+  // Confirming one nobody has actually accepted yet simply answers with
+  // whatever error `confirm_offer` raises; that is surfaced, not hidden.
+  const [posted, setPosted] = useState<{ id: string; scheduledFor: string | null }[]>([]);
+
+  useEffect(() => {
+    if (!user) {
+      setOffers(null);
+      return;
+    }
+    let live = true;
+    void listOpenOffers(league)
+      .then((o) => {
+        if (live) setOffers(o);
+      })
+      .catch((e: unknown) => {
+        if (live) setNotice(messageOf(e));
+      });
+    return () => {
+      live = false;
+    };
+  }, [user, league]);
+
+  const accept = async (o: Offer) => {
+    if (!user || o.proposerId === user.id || !rosterReady || busy) return;
+    setBusy(true);
+    setNotice(null);
+    try {
+      const matchId = await acceptOffer(o.id, buildTeam());
+      setOffers((prev) => (prev ? prev.filter((x) => x.id !== o.id) : prev));
+      setJustAccepted({ offerId: o.id, matchId });
+      // A live offer resolves to a match id immediately; a scheduled one
+      // returns null and stays `accepted`, not a match, until the proposer
+      // confirms — rendering null as "matched" would put a battle on
+      // someone's calendar nobody actually agreed to yet.
+      if (matchId) setMatches(await myMatches());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const post = async (scheduled: boolean) => {
+    if (!rosterReady || busy) return;
+    let scheduledFor: Date | undefined;
+    if (scheduled) {
+      if (!scheduleAt) {
+        setNotice('Pick a date and time to schedule for.');
+        return;
+      }
+      scheduledFor = new Date(scheduleAt);
+    }
+    setBusy(true);
+    setNotice(null);
+    try {
+      const id = await createOffer({
+        league,
+        formatVersionId: canonicalFormatVersionId(league),
+        format: canonicalFormat(league),
+        team: buildTeam(),
+        scheduledFor,
+      });
+      setPosted((p) => [...p, { id, scheduledFor: scheduledFor ? scheduledFor.toISOString() : null }]);
+      setPostOpen(false);
+      setScheduleAt('');
+      setOffers(await listOpenOffers(league));
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  const confirm = async (id: string) => {
+    setBusy(true);
+    setNotice(null);
+    try {
+      await confirmOffer(id);
+      setPosted((p) => p.filter((o) => o.id !== id));
+      setMatches(await myMatches());
+    } catch (e) {
+      setNotice(messageOf(e));
+    } finally {
+      setBusy(false);
+    }
+  };
+
+  if (!user) {
+    return (
+      <div className="matchmaking-screen">
+        <ScreenHeader
+          title="Matches"
+          blurb="Queue for a blind match, browse an open offer, or schedule one for later."
+        />
+        <div className="panel text-muted">Sign in to queue for a match, browse the open offer board, or schedule one for later.</div>
+      </div>
+    );
+  }
+
+  return (
+    <div className="matchmaking-screen">
+      <ScreenHeader
+        title="Matches"
+        blurb="Queue for a blind match, browse an open offer, or schedule one for later."
+      />
+
+      <div className="panel panel-strong">
+        <div className="hud-label">
+          Your roster for {LEAGUE_BY_ID.get(league)?.label ?? league}
+        </div>
+        <div className="team-slots">
+          {Array.from({ length: ROSTER_SIZE }, (_, i) => {
+            const r = team[i] ?? null;
+            return r ? (
+              <PokemonCard key={i} refId={r} league={league} size="compact" onClick={() => clear(i)} title="Click to remove" />
+            ) : (
+              <div key={i} className="team-slot is-empty">
+                <span className="team-slot-hint">Empty</span>
+              </div>
+            );
+          })}
+        </div>
+        <div className="team-add">
+          <SpeciesSearch
+            key={team.length}
+            id="matchmaking-team-add"
+            value=""
+            onChange={add}
+            placeholder="Add a Pokémon to this roster"
+            includeShadow
+            restrictTo={selectable}
+          />
+        </div>
+      </div>
+
+      <div className="panel">
+        <div className="hud-label">Blind queue</div>
+        <p className="text-muted">
+          Matched with anyone else queued under the same league and rules, blind — no format to browse, no
+          opponent to pick.
+        </p>
+        {entry && <p className="queue-status">{queueStatusText(entry)}</p>}
+        <div className="matchmaking-actions">
+          <button
+            type="button"
+            className="btn btn-primary queue-join"
+            disabled={!rosterReady || !!entry || busy}
+            title={!rosterReady ? `Add ${ROSTER_SIZE - team.length} more to queue` : undefined}
+            onClick={() => void join()}
+          >
+            {busy ? 'Working…' : 'Join queue'}
+          </button>
+          {entry && (
+            <button type="button" className="btn" disabled={busy} onClick={() => void leave()}>
+              Leave queue
+            </button>
+          )}
+        </div>
+        {matches && matches.length > 0 && (
+          <ul className="match-list">
+            {matches.map((m) => (
+              <li key={m.id} className="match-row">
+                <span>Match paired</span>
+                <span className="friend-code">
+                  {codes[m.opponentId] === undefined
+                    ? 'Loading friend code…'
+                    : codes[m.opponentId]
+                      ? `Friend code: ${codes[m.opponentId]}`
+                      : 'No friend code on file for this opponent.'}
+                </span>
+              </li>
+            ))}
+          </ul>
+        )}
+      </div>
+
+      <div className="panel">
+        <div className="hud-label">Open offer board</div>
+        <p className="text-muted">
+          Browse a curated offer, or post one of your own — live now, or scheduled for later once both sides
+          confirm.
+        </p>
+        {justAccepted && (
+          <p className="matchmaking-notice" role="status">
+            {justAccepted.matchId
+              ? 'Matched! Check your matches above for the friend code.'
+              : "Offer accepted — awaiting the proposer's confirmation. Not a match yet."}
+          </p>
+        )}
+        {offers && offers.length === 0 && <p className="text-faint">No open offers right now.</p>}
+        {offers && offers.length > 0 && (
+          <ul className="offer-list">
+            {offers.map((o) => {
+              const mine = o.proposerId === user.id;
+              return (
+                <li key={o.id} className="offer-row" data-offer-id={o.id}>
+                  <span className="offer-when">
+                    {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
+                  </span>
+                  <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
+                  {mine ? (
+                    <span className="text-faint">Your offer</span>
+                  ) : (
+                    <button
+                      type="button"
+                      className="btn chip-btn offer-accept"
+                      disabled={!rosterReady || busy}
+                      title={!rosterReady ? `Add ${ROSTER_SIZE - team.length} more to accept` : undefined}
+                      onClick={() => void accept(o)}
+                    >
+                      Accept
+                    </button>
+                  )}
+                </li>
+              );
+            })}
+          </ul>
+        )}
+
+        {/* Overlays the panel rather than growing it — the board must not
+            shove anything below it down the page as offers arrive. */}
+        <div className="move-picker">
+          <button
+            type="button"
+            className="btn move-picker-btn"
+            aria-expanded={postOpen}
+            onClick={() => setPostOpen((o) => !o)}
+          >
+            Post an offer
+          </button>
+          {postOpen && (
+            <div className="move-picker-panel offer-post-panel">
+              <button
+                type="button"
+                className="btn btn-primary"
+                disabled={!rosterReady || busy}
+                onClick={() => void post(false)}
+              >
+                Post to the open board
+              </button>
+              <div className="offer-schedule-row">
+                <input
+                  type="datetime-local"
+                  className="input"
+                  value={scheduleAt}
+                  onChange={(e) => setScheduleAt(e.target.value)}
+                />
+                <button
+                  type="button"
+                  className="btn"
+                  disabled={!rosterReady || busy || !scheduleAt}
+                  onClick={() => void post(true)}
+                >
+                  Schedule
+                </button>
+              </div>
+            </div>
+          )}
+        </div>
+      </div>
+
+      {posted.length > 0 && (
+        <div className="panel">
+          <div className="hud-label">Your posted offers</div>
+          <p className="text-muted">
+            A scheduled offer becomes a match only once you confirm it here after someone accepts.
+          </p>
+          <ul className="posted-offer-list">
+            {posted.map((o) => (
+              <li key={o.id} className="posted-offer-row">
+                <span>
+                  {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Posted to the open board'}
+                </span>
+                <button type="button" className="btn" disabled={busy} onClick={() => void confirm(o.id)}>
+                  Confirm
+                </button>
+              </li>
+            ))}
+          </ul>
+        </div>
+      )}
+
+      {notice && (
+        <p className="matchmaking-notice" role="alert">
+          {notice}
+        </p>
+      )}
+    </div>
+  );
+}
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
new file mode 100644
index 0000000..648a1ea
--- /dev/null
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -0,0 +1,356 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
+import type { Session } from '@supabase/supabase-js';
+import type { QueueEntry, Match, Offer } from '../../lib/matchmaking';
+
+/**
+ * The Matchmaking screen: the blind queue, the open offer board, and
+ * scheduled proposals.
+ *
+ * `../../lib/matchmaking` is mocked at the module boundary — the round trip
+ * through Supabase belongs to `matchmaking.test.ts`, not here. What belongs
+ * here is what the screen does with the nine functions it calls: whether it
+ * calls them with the roster and format actually on screen, whether it asks
+ * before an irreversible leave, whether a self-proposed offer is ever given
+ * an Accept control the database would refuse anyway, and whether a `null`
+ * return from `acceptOffer` (a scheduled offer awaiting the proposer's
+ * confirmation) is ever rendered as a match.
+ */
+
+const mmApi = vi.hoisted(() => ({
+  joinQueue: vi.fn(),
+  leaveQueue: vi.fn(),
+  myQueueEntry: vi.fn(),
+  myMatches: vi.fn(),
+  listOpenOffers: vi.fn(),
+  createOffer: vi.fn(),
+  acceptOffer: vi.fn(),
+  confirmOffer: vi.fn(),
+  opponentFriendCode: vi.fn(),
+}));
+vi.mock('../../lib/matchmaking', () => mmApi);
+
+const pkg = vi.hoisted(() => ({ client: null as unknown }));
+vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
+
+function fakeSession(id: string, email: string): Session {
+  return { access_token: 'tok', user: { id, email } } as unknown as Session;
+}
+
+function fakeClient(session: Session | null) {
+  const auth = {
+    getSession: vi.fn(async () => ({ data: { session }, error: null })),
+    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
+    signOut: vi.fn(async () => ({ error: null })),
+  };
+  pkg.client = { auth };
+  return auth;
+}
+
+/**
+ * `lib/supabase` builds its client once at import time, so the mock above
+ * only takes effect for an import that happens AFTER `pkg.client` is set —
+ * see `team-saves.test.tsx`'s identical harness for why this resets modules
+ * and imports dynamically rather than importing at the top of the file.
+ */
+async function mount(session: Session | null) {
+  fakeClient(session);
+  vi.resetModules();
+  const { ThemeProvider } = await import('../../state/ThemeContext');
+  const { AppStateProvider } = await import('../../state/AppState');
+  const { SessionProvider } = await import('../../state/SessionContext');
+  const { MatchmakingScreen } = await import('../MatchmakingScreen');
+  let view!: RenderResult;
+  await act(async () => {
+    view = render(
+      <ThemeProvider>
+        <AppStateProvider>
+          <SessionProvider>
+            <MatchmakingScreen />
+          </SessionProvider>
+        </AppStateProvider>
+      </ThemeProvider>,
+    );
+  });
+  return { view, container: view.container };
+}
+
+/** Add a named Pokemon through the live search dropdown. Copied from
+ * team-saves.test.tsx's `pick` — reading the first row synchronously after
+ * the change event reads the *previous* render's list. */
+async function pick(container: HTMLElement, typed: string) {
+  const input = container.querySelector('.team-add input') as HTMLInputElement;
+  fireEvent.focus(input);
+  fireEvent.change(input, { target: { value: typed } });
+  const row = await waitFor(() => {
+    const hit = [...container.querySelectorAll('.search-dropdown .search-row')].find((r) =>
+      new RegExp(`^${typed}$`, 'i').test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''),
+    );
+    if (!hit) throw new Error(`no search result for "${typed}"`);
+    return hit;
+  });
+  fireEvent.mouseDown(row);
+}
+
+async function pickThree(container: HTMLElement) {
+  await pick(container, 'azumarill');
+  await pick(container, 'registeel');
+  await pick(container, 'skarmory');
+}
+
+function offer(over: Partial<Offer>): Offer {
+  return {
+    id: 'off-x',
+    proposerId: 'someone-else',
+    league: 'great',
+    formatVersionId: 'v1',
+    scheduledFor: null,
+    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
+    state: 'open',
+    acceptedBy: null,
+    ...over,
+  };
+}
+
+function match(over: Partial<Match>): Match {
+  return {
+    id: 'm-x',
+    opponentId: 'opp-1',
+    formatVersionId: 'v1',
+    rulesHash: 'hash',
+    dataRev: 'rev1',
+    rounds: 3,
+    source: 'queue',
+    createdAt: new Date().toISOString(),
+    ...over,
+  };
+}
+
+beforeEach(() => {
+  mmApi.joinQueue.mockReset().mockResolvedValue('q1');
+  mmApi.leaveQueue.mockReset().mockResolvedValue(undefined);
+  mmApi.myQueueEntry.mockReset().mockResolvedValue(null);
+  mmApi.myMatches.mockReset().mockResolvedValue([]);
+  mmApi.listOpenOffers.mockReset().mockResolvedValue([]);
+  mmApi.createOffer.mockReset().mockResolvedValue('o1');
+  mmApi.acceptOffer.mockReset().mockResolvedValue('m1');
+  mmApi.confirmOffer.mockReset().mockResolvedValue('m1');
+  mmApi.opponentFriendCode.mockReset().mockResolvedValue(null);
+});
+afterEach(cleanup);
+
+describe('signed out', () => {
+  it('offers nothing to sign in with when signed out', async () => {
+    const { container } = await mount(null);
+    expect(container.querySelector('.queue-join')).toBeFalsy();
+    expect(container.textContent).toMatch(/sign in/i);
+  });
+});
+
+describe('signed in — the blind queue', () => {
+  it('cannot join with an incomplete roster', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
+    expect(joinBtn).toBeTruthy();
+    expect(joinBtn.disabled).toBe(true);
+  });
+
+  it('joins the queue with the roster and format on screen', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
+    expect(joinBtn.disabled).toBe(false);
+    await act(async () => {
+      fireEvent.click(joinBtn);
+    });
+    await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
+    const arg = mmApi.joinQueue.mock.calls[0][0] as {
+      league: string;
+      formatVersionId: string;
+      format: { base: string };
+      team: { ref: string }[];
+    };
+    expect(arg.league).toBe('great');
+    expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+    expect(typeof arg.formatVersionId).toBe('string');
+    expect(arg.formatVersionId.length).toBeGreaterThan(0);
+    expect(arg.format.base).toBe('great');
+  });
+
+  it('distinguishes queued-awaiting-verification from queued-and-eligible', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: null,
+      expiresAt: new Date(Date.now() + 600_000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/awaiting verification/i));
+    expect(container.textContent).not.toMatch(/eligible to pair/i);
+  });
+
+  it('shows a verified entry as eligible, not awaiting', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: 'abc123',
+      expiresAt: new Date(Date.now() + 600_000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/eligible to pair/i));
+    expect(container.textContent).not.toMatch(/awaiting verification/i);
+  });
+
+  it('asks before leaving a queue it is already in', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: null,
+      expiresAt: new Date(Date.now() + 600_000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const leaveBtn = await waitFor(() => {
+      const b = [...container.querySelectorAll('button')].find((x) => /Leave queue/i.test(x.textContent ?? ''));
+      if (!b) throw new Error('leave button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
+    fireEvent.click(leaveBtn);
+    expect(confirmSpy).toHaveBeenCalledTimes(1);
+    expect(mmApi.leaveQueue).not.toHaveBeenCalled();
+
+    confirmSpy.mockReturnValue(true);
+    await act(async () => {
+      fireEvent.click(leaveBtn);
+    });
+    await waitFor(() => expect(mmApi.leaveQueue).toHaveBeenCalledTimes(1));
+    confirmSpy.mockRestore();
+  });
+});
+
+describe('signed in — matches and friend codes', () => {
+  it("shows the opponent's friend code once a match exists", async () => {
+    mmApi.myMatches.mockResolvedValue([match({ opponentId: 'opp-1' })]);
+    mmApi.opponentFriendCode.mockResolvedValue('1234 5678 9012');
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/1234 5678 9012/));
+    expect(mmApi.opponentFriendCode).toHaveBeenCalledWith('opp-1');
+  });
+
+  it('says no friend code is on file rather than showing nothing', async () => {
+    mmApi.myMatches.mockResolvedValue([match({ opponentId: 'opp-2' })]);
+    mmApi.opponentFriendCode.mockResolvedValue(null);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => expect(container.textContent).toMatch(/no friend code/i));
+  });
+});
+
+describe('signed in — the open offer board', () => {
+  it('disables accept on an offer the signed-in person proposed', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-mine', proposerId: 'u1' }),
+      offer({ id: 'off-theirs', proposerId: 'someone-else' }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const [mineRow, theirsRow] = await waitFor(() => {
+      const mine = container.querySelector('[data-offer-id="off-mine"]');
+      const theirs = container.querySelector('[data-offer-id="off-theirs"]');
+      if (!mine || !theirs) throw new Error('offer rows not rendered yet');
+      return [mine, theirs];
+    });
+    // The database refuses match_offers_not_self and accept_offer raises for
+    // it too, but a control that can only fail should not be presented.
+    expect(mineRow.querySelector('.offer-accept')).toBeFalsy();
+    expect(theirsRow.querySelector('.offer-accept')).toBeTruthy();
+  });
+
+  it('shows a scheduled offer awaiting confirmation as awaiting, not as a match', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-sched', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() }),
+    ]);
+    mmApi.acceptOffer.mockResolvedValue(null);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const acceptBtn = await waitFor(() => {
+      const b = container.querySelector('[data-offer-id="off-sched"] .offer-accept');
+      if (!b) throw new Error('accept button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledWith('off-sched', expect.any(Array)));
+    // accept_offer returns null for a scheduled offer: it is `accepted`, not
+    // yet a match, until the proposer confirms. Rendering null as "matched"
+    // would put a battle on someone's calendar nobody actually confirmed.
+    expect(container.textContent).toMatch(/awaiting/i);
+    expect(container.textContent).not.toMatch(/matched!/i);
+  });
+
+  it('shows a live offer as matched once accepted, since accept_offer returned a match id', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-live' })]);
+    mmApi.acceptOffer.mockResolvedValue('brand-new-match');
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const acceptBtn = await waitFor(() => {
+      const b = container.querySelector('[data-offer-id="off-live"] .offer-accept');
+      if (!b) throw new Error('accept button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(container.textContent).toMatch(/matched!/i));
+  });
+
+  it('posts an offer to the open board with the roster and format on screen', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
+    fireEvent.click(toggle);
+    const postBtn = await waitFor(() => {
+      const b = [...container.querySelectorAll('button')].find((x) => /Post to the open board/i.test(x.textContent ?? ''));
+      if (!b) throw new Error('post button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(postBtn);
+    });
+    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
+    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; team: { ref: string }[] };
+    expect(arg.scheduledFor).toBeUndefined();
+    expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+  });
+
+  it('schedules an offer for later with a scheduledFor date, and offers a Confirm control once posted', async () => {
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
+    fireEvent.click(toggle);
+    const dtInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
+    const future = new Date(Date.now() + 3 * 86_400_000);
+    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T12:00`;
+    fireEvent.change(dtInput, { target: { value: local } });
+    const scheduleBtn = [...container.querySelectorAll('button')].find((b) => /^Schedule$/i.test(b.textContent ?? ''))!;
+    await act(async () => {
+      fireEvent.click(scheduleBtn);
+    });
+    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
+    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date };
+    expect(arg.scheduledFor).toBeInstanceOf(Date);
+
+    const confirmBtn = await waitFor(() => {
+      const b = [...container.querySelectorAll('.posted-offer-row button')].find((x) => /Confirm/i.test(x.textContent ?? ''));
+      if (!b) throw new Error('confirm button not rendered yet');
+      return b as HTMLButtonElement;
+    });
+    await act(async () => {
+      fireEvent.click(confirmBtn);
+    });
+    await waitFor(() => expect(mmApi.confirmOffer).toHaveBeenCalledWith('o1'));
+  });
+});
diff --git a/app/src/state/AppState.tsx b/app/src/state/AppState.tsx
index 5d1475e..359074f 100644
--- a/app/src/state/AppState.tsx
+++ b/app/src/state/AppState.tsx
@@ -1,16 +1,16 @@
 import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
 import type { IV, LeagueId } from '../lib/types';
 import { opponentsFor, randomMatchup } from '../lib/data';
 import { defaultSpreadFor } from '../lib/engine';
 
-export type Screen = 'landing' | 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores' | 'diagnostics' | 'moves' | 'formats' | 'account';
+export type Screen = 'landing' | 'report' | 'battle' | 'rankings' | 'gbl' | 'show6' | 'cores' | 'diagnostics' | 'moves' | 'formats' | 'matchmaking' | 'account';
 export type Viz = 'heat' | 'ruler' | 'table' | 'flip';
 export type ColorBy = 'rank' | 'break' | 'bulk';
 
 export interface AppStateShape {
   screen: Screen;
   league: LeagueId;
   /** Ref, may carry a `_shadow` suffix. */
   species: string;
   shadow: boolean;
   /**
