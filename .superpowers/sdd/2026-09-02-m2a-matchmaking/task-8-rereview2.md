# Task 8 fix-round 2 re-review — 7dde301..HEAD

## Commits
19ecf14 fix(matchmaking): accepting is the offer's business, not the accepter's

## Files changed
 .../2026-09-02-m2a-matchmaking/task-8-report.md    | 157 +++++++++++++++++++++
 app/src/lib/__tests__/matchmaking.test.ts          |  61 +++++++-
 app/src/lib/matchmaking.ts                         |  28 +++-
 app/src/screens/MatchmakingScreen.tsx              |  58 ++++++--
 app/src/screens/__tests__/matchmaking.test.tsx     | 146 +++++++++++++++++++
 5 files changed, 435 insertions(+), 15 deletions(-)

## Full diff
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
index 83a2739..6e4951e 100644
--- a/app/src/lib/__tests__/matchmaking.test.ts
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -193,99 +193,156 @@ describe('matches', () => {
           data_rev: 'r1', rounds: 3, source: 'queue', created_at: '2026-09-02T12:00:00Z',
         },
       ],
     });
     const { myMatches } = await import('../matchmaking');
     const [m] = await myMatches();
     expect(m).toEqual({
       id: 'm1', opponentId: 'them', formatVersionId: 'v1', rulesHash: 'h1',
       dataRev: 'r1', rounds: 3, source: 'queue', createdAt: '2026-09-02T12:00:00Z',
     });
   });
 });
 
 describe('offers', () => {
   it('lists open offers for a league, mapped to camelCase fields', async () => {
     const { calls } = harness({
       match_offers: [
         {
           id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
           scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          team: [{ ref: 'azumarill' }, { ref: 'registeel' }, { ref: 'skarmory' }],
         },
       ],
     });
     const { listOpenOffers } = await import('../matchmaking');
     const offers = await listOpenOffers('great');
     expect(offers).toEqual([
       {
         id: 'o1', proposerId: 'p1', league: 'great', formatVersionId: 'v1',
         scheduledFor: null, expiresAt: '2026-09-02T13:00:00Z', state: 'open', acceptedBy: null,
+        rosterSize: 3,
       },
     ]);
     const leagueFilter = calls.find((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[0] === 'league');
     expect(leagueFilter?.payload).toEqual(['league', 'great']);
   });
 
+  /**
+   * `accept_offer(p_offer, p_team)` takes no format: the OFFER's
+   * `format_version_id` is what the match is played under, so how big a
+   * roster an accepter needs is the offer's business and not theirs. Nothing
+   * downstream would catch the mismatch either — the coordinator recomputes
+   * `rules_hash` and never looks at `team`.
+   *
+   * The size comes from the posted roster's length rather than from the
+   * format's `composition.size`, because `format_versions` is readable only
+   * for a format whose `visibility = 'public'` and a saved format defaults to
+   * `private` — embedding the rules would return null for exactly the
+   * strangers' offers this number is for.
+   */
+  it('reports how big a roster each offer wants, from the roster it was posted with', async () => {
+    harness({
+      match_offers: [
+        {
+          id: 'o-three', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
+        },
+        {
+          id: 'o-six', proposer_id: 'p2', league: 'great', format_version_id: 'v2',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    expect((await listOpenOffers('great')).map((o) => o.rosterSize)).toEqual([3, 6]);
+  });
+
+  it('asks for the team it sizes that from, and reports zero rather than NaN without one', async () => {
+    const { calls } = harness({
+      match_offers: [
+        {
+          id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    const [o] = await listOpenOffers('great');
+    // A zero disables the accept control; an undefined length would sail
+    // through `team.length === o.rosterSize` as NaN and disable it too, but
+    // silently and for the wrong reason.
+    expect(o.rosterSize).toBe(0);
+    const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
+    expect(select?.payload).toMatch(/\bteam\b/);
+  });
+
   /**
    * The proposer's half of the handshake has no other way home. An offer
    * leaves `state = 'open'` the moment it is accepted, so `listOpenOffers`
    * stops returning it exactly when the proposer needs to confirm it — and a
    * screen that only remembered what it posted this session forgets on
    * reload. These four tests hold the shape that lets both sides rediscover
    * it from the database instead.
    */
   it('lists offers I proposed and offers I accepted, not just open ones', async () => {
     const { calls } = harness({ match_offers: [] });
     const { myOffers } = await import('../matchmaking');
     await myOffers();
     const or = calls.find((c) => c.table === 'match_offers' && c.op === 'or');
     expect(or?.payload).toBe('proposer_id.eq.me,accepted_by.eq.me');
     // Scoping this to `open` would reintroduce the dead end it exists to fix.
     expect(calls.some((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[1] === 'open')).toBe(false);
   });
 
   it('carries state, scheduledFor, acceptedBy and matchId through for both sides', async () => {
     harness({
       match_offers: [
         {
           id: 'o1', proposer_id: 'me', league: 'great', format_version_id: 'fv1',
           scheduled_for: '2026-09-05T18:00:00Z', expires_at: '2026-09-05T19:00:00Z',
           state: 'accepted', accepted_by: 'them', match_id: null,
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
         },
         {
           id: 'o2', proposer_id: 'them', league: 'great', format_version_id: 'fv1',
           scheduled_for: null, expires_at: '2026-09-05T19:00:00Z',
           state: 'converted', accepted_by: 'me', match_id: 'm9',
+          // Six, deliberately differing from the three above: two rows mapped
+          // from one function, and a constant would satisfy only one of them.
+          team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
         },
       ],
     });
     const { myOffers } = await import('../matchmaking');
     expect(await myOffers()).toEqual([
       {
         id: 'o1', proposerId: 'me', league: 'great', formatVersionId: 'fv1',
         scheduledFor: '2026-09-05T18:00:00Z', expiresAt: '2026-09-05T19:00:00Z',
-        state: 'accepted', acceptedBy: 'them', matchId: null,
+        state: 'accepted', acceptedBy: 'them', matchId: null, rosterSize: 3,
       },
       {
         id: 'o2', proposerId: 'them', league: 'great', formatVersionId: 'fv1',
         scheduledFor: null, expiresAt: '2026-09-05T19:00:00Z',
-        state: 'converted', acceptedBy: 'me', matchId: 'm9',
+        state: 'converted', acceptedBy: 'me', matchId: 'm9', rosterSize: 6,
       },
     ]);
   });
 
   it('asks the database for match_id, so a confirmed offer can name the match it became', async () => {
     // A state string alone cannot say WHICH match a confirmed offer became.
     const { calls } = harness({ match_offers: [] });
     const { myOffers } = await import('../matchmaking');
     await myOffers();
     const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
     expect(select?.payload).toMatch(/\bmatch_id\b/);
     expect(select?.payload).toMatch(/\bscheduled_for\b/);
     expect(select?.payload).toMatch(/\baccepted_by\b/);
     expect(select?.payload).toMatch(/\bstate\b/);
   });
 
   it('refuses to list the offers of nobody in particular', async () => {
     harness({}, {}, null);
     const { myOffers } = await import('../matchmaking');
     await expect(myOffers()).rejects.toThrow(/must be signed in/);
diff --git a/app/src/lib/matchmaking.ts b/app/src/lib/matchmaking.ts
index 97779cd..09c7eb2 100644
--- a/app/src/lib/matchmaking.ts
+++ b/app/src/lib/matchmaking.ts
@@ -19,40 +19,56 @@ export interface Match {
   formatVersionId: string;
   rulesHash: string;
   dataRev: string;
   rounds: number;
   source: 'queue' | 'offer';
   createdAt: string;
 }
 
 export type OfferState = 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
 
 export interface Offer {
   id: string;
   proposerId: string;
   league: LeagueId;
   formatVersionId: string;
   /** Null for the live board; a timestamp for a scheduled proposal. */
   scheduledFor: string | null;
   expiresAt: string;
   state: OfferState;
   acceptedBy: string | null;
+  /**
+   * How many members a roster accepting THIS offer needs — the length of the
+   * roster the proposer posted, which they built under this offer's own
+   * format. The accepter's own saved format has no say: `accept_offer` takes
+   * no format argument, and the offer's `format_version_id` is what the match
+   * is played under.
+   *
+   * Derived from `team` rather than from `format_versions.rules`, and that is
+   * a real constraint rather than laziness: versions are readable only for a
+   * format whose `visibility = 'public'` ("versions of a public format are
+   * readable by anyone signed in"), and a saved format defaults to `private`.
+   * Embedding the rules would hand back null for most offers on the board —
+   * precisely for the strangers whose offers this number exists to size. The
+   * team is readable under the same row policy that shows the offer at all.
+   */
+  rosterSize: number;
 }
 
 /**
  * An offer the signed-in person is party to. The extra field over `Offer` is
  * the match it became: an offer only carries one once it has been confirmed
  * (or, for a live offer, converted on acceptance), so a null `matchId` beside
  * `state = 'accepted'` is precisely the handshake still waiting on someone.
  */
 export interface MyOffer extends Offer {
   matchId: string | null;
 }
 
 /**
  * `user_id` is never sent from here, same rule as `saves.ts`: it defaults to
  * `auth.uid()` in the database, so a client-supplied owner is never a second
  * source of truth the policy has to agree with.
  *
  * `claimed_hash` is computed here with `rulesHash`, never accepted as a
  * caller-supplied value — the coordinator recomputes it independently and
  * writes `verified_hash`, and only a verified entry is eligible to pair. A
@@ -160,130 +176,138 @@ export async function myMatches(): Promise<Match[]> {
       rounds: number;
       source: 'queue' | 'offer';
       created_at: string;
     };
     return {
       id: r.id,
       opponentId: r.player_a === me ? r.player_b : r.player_a,
       formatVersionId: r.format_version_id,
       rulesHash: r.rules_hash,
       dataRev: r.data_rev,
       rounds: r.rounds,
       source: r.source,
       createdAt: r.created_at,
     };
   });
 }
 
 export async function listOpenOffers(league: LeagueId): Promise<Offer[]> {
   const { data, error } = await supabase
     .from('match_offers')
-    .select('id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by')
+    .select('id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, team')
     .eq('league', league)
     .eq('state', 'open')
     .order('created_at', { ascending: false });
   if (error) throw new Error(error.message);
   return (data ?? []).map((row) => {
     const r = row as {
       id: string;
       proposer_id: string;
       league: LeagueId;
       format_version_id: string;
       scheduled_for: string | null;
       expires_at: string;
       state: OfferState;
       accepted_by: string | null;
+      team: StoredMember[] | null;
     };
     return {
       id: r.id,
       proposerId: r.proposer_id,
       league: r.league,
       formatVersionId: r.format_version_id,
       scheduledFor: r.scheduled_for,
       expiresAt: r.expires_at,
       state: r.state,
       acceptedBy: r.accepted_by,
+      // The count, not the members. `match_offers`' select policy is
+      // whole-row, so the proposer's roster is legible to anyone who can see
+      // the offer — but this screen has no business rendering it, and what
+      // never leaves this function cannot be rendered by accident.
+      rosterSize: (r.team ?? []).length,
     };
   });
 }
 
 /**
  * Every offer the signed-in person is party to — the ones they proposed AND
  * the ones they accepted — in every state, not just `open`.
  *
  * `listOpenOffers` cannot do this job and must not be widened to try. An
  * offer leaves `state = 'open'` the instant someone accepts it, so a proposer
  * whose only view of their own proposal was the open board loses sight of it
  * at exactly the moment it needs their confirmation — the offer then lapses
  * on its own expiry and the match is never created. The taker is stranded the
  * same way: their acceptance is a row they can no longer see. Both sides need
  * to rediscover the handshake on a fresh page load, from the database, which
  * is what this reads.
  *
  * `match_id` is selected here and nowhere else: it is the only thing that
  * distinguishes "confirmed, and here is the match it became" from a state
  * string alone.
  *
  * Both halves of the OR are already readable under the existing policies —
  * "an offer belongs to the person who proposed it" covers the proposer's own
  * rows in any state, and "a public offer is readable by anyone signed in"
  * covers the taker's. The filter is not what makes this safe; it is what
  * keeps the answer to "mine" from being "everyone's".
  *
  * `getSession()`, not `getUser()`: a local read of the already-verified
  * session, the same choice `leaveQueue` and `myMatches` make above.
  */
 export async function myOffers(): Promise<MyOffer[]> {
   const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
   if (sessionError) throw new Error(sessionError.message);
   const me = sessionData.session?.user.id;
   if (!me) throw new Error('you must be signed in to list your offers');
   const { data, error } = await supabase
     .from('match_offers')
     .select(
-      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, match_id',
+      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, match_id, team',
     )
     .or(`proposer_id.eq.${me},accepted_by.eq.${me}`)
     .order('created_at', { ascending: false });
   if (error) throw new Error(error.message);
   return (data ?? []).map((row) => {
     const r = row as {
       id: string;
       proposer_id: string;
       league: LeagueId;
       format_version_id: string;
       scheduled_for: string | null;
       expires_at: string;
       state: OfferState;
       accepted_by: string | null;
       match_id: string | null;
+      team: StoredMember[] | null;
     };
     return {
       id: r.id,
       proposerId: r.proposer_id,
       league: r.league,
       formatVersionId: r.format_version_id,
       scheduledFor: r.scheduled_for,
       expiresAt: r.expires_at,
       state: r.state,
       acceptedBy: r.accepted_by,
       matchId: r.match_id,
+      rosterSize: (r.team ?? []).length,
     };
   });
 }
 
 /**
  * `proposer_id` is never sent, same rule as `user_id` above. Checked BEFORE
  * any network call: a scheduled offer in the past is refused here so the
  * caller learns why without a round trip, and before the database's own
  * `match_offers_scheduled_future` constraint would say the same thing less
  * legibly.
  */
 export async function createOffer(a: {
   league: LeagueId;
   formatVersionId: string;
   format: Format;
   team: StoredMember[];
   scheduledFor?: Date;
 }): Promise<string> {
   if (a.scheduledFor && a.scheduledFor <= new Date()) {
     throw new Error('a scheduled offer cannot be in the past');
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
index 47c041c..d9f53be 100644
--- a/app/src/screens/MatchmakingScreen.tsx
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -107,61 +107,78 @@ export function MatchmakingScreen() {
   const { user } = useSession();
   const league = state.league;
 
   // --- the format being queued under --------------------------------------
   // Null while loading, [] once loaded and empty — a distinction the screen
   // renders, since "you have no saved formats" is a wrong thing to say to
   // someone whose formats simply have not arrived yet.
   const [savedFormats, setSavedFormats] = useState<SavedFormat[] | null>(null);
   const [chosenId, setChosenId] = useState<string | null>(null);
 
   const leagueFormats = useMemo(
     () => (savedFormats ?? []).filter((f) => f.format.base === league),
     [savedFormats, league],
   );
   // Filtered to this league's own formats: `league` is what the queue and the
   // board are partitioned on, and offering a Master format while the screen
   // says Great would queue someone under rules they are not looking at.
   const chosen = leagueFormats.find((f) => f.id === chosenId) ?? leagueFormats[0] ?? null;
   const rosterSize = chosen ? chosen.format.composition.size : DEFAULT_ROSTER_SIZE;
 
+  // Declared here rather than with the board below because the roster's own
+  // capacity depends on it — see `rosterCapacity`.
+  const [offers, setOffers] = useState<Offer[] | null>(null);
+
   // --- the roster, built locally on this screen ---------------------------
   const [team, setTeam] = useState<string[]>([]);
+  /**
+   * The most members this roster could need: your own format's size, or the
+   * largest offer on the board. Capping at your own size would make a bigger
+   * offer permanently unacceptable — no amount of picking would reach its
+   * length — which is the "control that cannot succeed" rule again, wearing
+   * the roster's clothes instead of the button's.
+   */
+  const rosterCapacity = Math.max(rosterSize, ...(offers ?? []).map((o) => o.rosterSize));
   const selectable = useMemo(
     () => new Set(pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))),
     [league, team],
   );
   const add = (ref: string) => {
     setTeam((t) =>
-      t.includes(ref) || t.length >= rosterSize || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
+      t.includes(ref) || t.length >= rosterCapacity || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
     );
   };
   const clear = (i: number) => setTeam((t) => t.filter((_, n) => n !== i));
   const buildTeam = (): StoredMember[] => team.map((ref) => encodeMember(defaultChoice(ref, league), league));
+  /**
+   * Ready to JOIN or POST — both of which are queued under your own chosen
+   * format, so both need one. Accepting is deliberately not this: see
+   * `canAccept`.
+   */
   const rosterReady = !!chosen && team.length === rosterSize;
 
-  // A format with a smaller roster leaves members past its size unreachable —
-  // invisible in the slots, but still counted, so the roster could never be
-  // "ready" again without a member nobody can see being removed.
+  // Nothing may sit past the capacity: a member the slots do not render is a
+  // member nobody can remove, and it still counts towards every length check
+  // on this screen.
   useEffect(() => {
-    setTeam((t) => (t.length > rosterSize ? t.slice(0, rosterSize) : t));
-  }, [rosterSize]);
+    setTeam((t) => (t.length > rosterCapacity ? t.slice(0, rosterCapacity) : t));
+  }, [rosterCapacity]);
 
   // --- the blind queue ------------------------------------------------------
   const [entry, setEntry] = useState<QueueEntry | null>(null);
   const [matches, setMatches] = useState<Match[] | null>(null);
   const [codes, setCodes] = useState<Record<string, string | null>>({});
   const [busy, setBusy] = useState(false);
   const [notice, setNotice] = useState<string | null>(null);
 
   useEffect(() => {
     if (!user) {
       setEntry(null);
       setMatches(null);
       setCodes({});
       setSavedFormats(null);
       return;
     }
     let live = true;
     void listServerFormats()
       .then((f) => {
         if (live) setSavedFormats(f);
@@ -229,41 +246,40 @@ export function MatchmakingScreen() {
   };
 
   const leave = async () => {
     if (!entry) return;
     // Irreversible the moment it lands — the same confirm idiom
     // `TeamBuilderScreen` uses before `deleteTeam`.
     if (!window.confirm('Leave the queue? You will stop being matched until you join again.')) return;
     setBusy(true);
     setNotice(null);
     try {
       await leaveQueue();
       setEntry(null);
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
 
   // --- the open offer board --------------------------------------------------
-  const [offers, setOffers] = useState<Offer[] | null>(null);
   const [justAccepted, setJustAccepted] = useState<{ offerId: string; matchId: string | null } | null>(null);
   const [postOpen, setPostOpen] = useState(false);
   const [scheduleAt, setScheduleAt] = useState('');
   // Every offer this person is party to, READ FROM THE DATABASE — proposed or
   // accepted, in whatever state. Not session state: an offer leaves
   // `state = 'open'` the moment someone accepts it, so a panel driven by what
   // this tab happened to post would forget the handshake on reload, and
   // `listOpenOffers` would never hand it back. That is the offer lapsing and
   // the match never being created.
   const [mine, setMine] = useState<MyOffer[] | null>(null);
 
   useEffect(() => {
     if (!user) {
       setOffers(null);
       setMine(null);
       return;
     }
     let live = true;
     void listOpenOffers(league)
       .then((o) => {
@@ -275,42 +291,54 @@ export function MatchmakingScreen() {
     return () => {
       live = false;
     };
   }, [user, league]);
 
   useEffect(() => {
     if (!user) return;
     let live = true;
     void myOffers()
       .then((o) => {
         if (live) setMine(o);
       })
       .catch((e: unknown) => {
         if (live) setNotice(messageOf(e));
       });
     return () => {
       live = false;
     };
   }, [user]);
 
+  /**
+   * Accepting is governed by the OFFER, not by you. `accept_offer(p_offer,
+   * p_team)` takes no format: the offer's own `format_version_id` is what the
+   * match is played under, so a saved format of your own is not needed to
+   * accept one, and requiring it locked out everyone who has none — the
+   * database would have taken them. The roster has to be the size the OFFER
+   * wants for the same reason; sizing it by your own format would let a
+   * 6-strong roster into a 3-member offer, which nothing downstream rejects
+   * (the coordinator recomputes `rules_hash` and never inspects `team`).
+   */
+  const canAccept = (o: Offer) => !!user && o.proposerId !== user.id && team.length === o.rosterSize;
+
   const accept = async (o: Offer) => {
-    if (!user || o.proposerId === user.id || !rosterReady || busy) return;
+    if (!canAccept(o) || busy) return;
     setBusy(true);
     setNotice(null);
     try {
       const matchId = await acceptOffer(o.id, buildTeam());
       setOffers((prev) => (prev ? prev.filter((x) => x.id !== o.id) : prev));
       setJustAccepted({ offerId: o.id, matchId });
       // Re-read what this person is party to: the offer just accepted is now
       // one of them, and this is the read that will still find it tomorrow.
       setMine(await myOffers());
       // A live offer resolves to a match id immediately; a scheduled one
       // returns null and stays `accepted`, not a match, until the proposer
       // confirms — rendering null as "matched" would put a battle on
       // someone's calendar nobody actually agreed to yet.
       if (matchId) setMatches(await myMatches());
     } catch (e) {
       setNotice(messageOf(e));
     } finally {
       setBusy(false);
     }
   };
@@ -395,42 +423,45 @@ export function MatchmakingScreen() {
             {leagueFormats.map((f) => (
               <button
                 key={f.id}
                 type="button"
                 className="btn seg-btn format-choice"
                 data-format-id={f.id}
                 aria-pressed={chosen?.id === f.id}
                 onClick={() => setChosenId(f.id)}
               >
                 {f.name}
               </button>
             ))}
           </div>
         )}
       </div>
 
       <div className="panel panel-strong">
         <div className="hud-label">
           Your roster for {LEAGUE_BY_ID.get(league)?.label ?? league}
         </div>
+        {/* Your own format's size, but never fewer slots than the roster
+            actually holds — someone building up to a larger offer must be
+            able to see, and remove, every member they picked. */}
         <div className="team-slots">
-          {Array.from({ length: rosterSize }, (_, i) => {
+          {Array.from({ length: Math.max(rosterSize, team.length) }, (_, i) => {
             const r = team[i] ?? null;
             return r ? (
               <PokemonCard key={i} refId={r} league={league} size="compact" onClick={() => clear(i)} title="Click to remove" />
             ) : (
               <div key={i} className="team-slot is-empty">
                 <span className="team-slot-hint">Empty</span>
               </div>
             );
           })}
         </div>
         <div className="team-add">
           <SpeciesSearch
             key={team.length}
             id="matchmaking-team-add"
             value=""
             onChange={add}
             placeholder="Add a Pokémon to this roster"
             includeShadow
             restrictTo={selectable}
           />
@@ -496,42 +527,47 @@ export function MatchmakingScreen() {
               : "Offer accepted — awaiting the proposer's confirmation. Not a match yet."}
           </p>
         )}
         {offers && offers.length === 0 && <p className="text-faint">No open offers right now.</p>}
         {offers && offers.length > 0 && (
           <ul className="offer-list">
             {offers.map((o) => {
               const mine = o.proposerId === user.id;
               return (
                 <li key={o.id} className="offer-row" data-offer-id={o.id}>
                   <span className="offer-when">
                     {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
                   </span>
                   <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
                   {mine ? (
                     <span className="text-faint">Your offer</span>
                   ) : (
                     <button
                       type="button"
                       className="btn chip-btn offer-accept"
-                      disabled={!rosterReady || busy}
-                      title={!rosterReady ? `Add ${rosterSize - team.length} more to accept` : undefined}
+                      // Not `rosterReady`: that asks whether YOU could post,
+                      // and accepting is the offer's business, not your
+                      // format's.
+                      disabled={!canAccept(o) || busy}
+                      title={
+                        canAccept(o) ? undefined : `This offer is played with a roster of ${o.rosterSize}`
+                      }
                       onClick={() => void accept(o)}
                     >
                       Accept
                     </button>
                   )}
                 </li>
               );
             })}
           </ul>
         )}
 
         {/* Overlays the panel rather than growing it — the board must not
             shove anything below it down the page as offers arrive. The list
             above is bounded and scrolls for the same reason. */}
         <div className="move-picker">
           {chosen && (
           <button
             type="button"
             className="btn move-picker-btn"
             aria-expanded={postOpen}
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
index 1da0d72..acc5c49 100644
--- a/app/src/screens/__tests__/matchmaking.test.tsx
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -104,73 +104,75 @@ async function pick(container: HTMLElement, typed: string) {
   });
   fireEvent.mouseDown(row);
 }
 
 async function pickThree(container: HTMLElement) {
   await pick(container, 'azumarill');
   await pick(container, 'registeel');
   await pick(container, 'skarmory');
 }
 
 function offer(over: Partial<Offer>): Offer {
   return {
     id: 'off-x',
     proposerId: 'someone-else',
     league: 'great',
     formatVersionId: 'v1',
     scheduledFor: null,
     expiresAt: new Date(Date.now() + 3600_000).toISOString(),
     state: 'open',
     acceptedBy: null,
+    rosterSize: 3,
     ...over,
   };
 }
 
 function savedFormat(over: Partial<SavedFormat> = {}): SavedFormat {
   return {
     id: 'f-great',
     name: 'Great League Open',
     version: 2,
     versionId: 'fv-great-2',
     rulesHash: 'h2',
     format: {
       schema: RULES_SCHEMA,
       base: 'great',
       pool: [],
       composition: { size: 3, uniqueSpecies: true },
       selection: { mode: 'open' },
     },
     ...over,
   };
 }
 
 function myOffer(over: Partial<MyOffer>): MyOffer {
   return {
     id: 'mine-x',
     proposerId: 'u1',
     league: 'great',
     formatVersionId: 'fv-great-2',
     scheduledFor: null,
     expiresAt: new Date(Date.now() + 3600_000).toISOString(),
     state: 'open',
     acceptedBy: null,
     matchId: null,
+    rosterSize: 3,
     ...over,
   };
 }
 
 function match(over: Partial<Match>): Match {
   return {
     id: 'm-x',
     opponentId: 'opp-1',
     formatVersionId: 'v1',
     rulesHash: 'hash',
     dataRev: 'rev1',
     rounds: 3,
     source: 'queue',
     createdAt: new Date().toISOString(),
     ...over,
   };
 }
 
 beforeEach(() => {
   mmApi.joinQueue.mockReset().mockResolvedValue('q1');
@@ -417,40 +419,184 @@ describe('signed in — the open offer board', () => {
     fireEvent.click(toggle);
     const dtInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
     const future = new Date(Date.now() + 3 * 86_400_000);
     const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T12:00`;
     fireEvent.change(dtInput, { target: { value: local } });
     const before = mmApi.myOffers.mock.calls.length;
     const scheduleBtn = [...container.querySelectorAll('button')].find((b) => /^Schedule$/i.test(b.textContent ?? ''))!;
     await act(async () => {
       fireEvent.click(scheduleBtn);
     });
     await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
     const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; formatVersionId: string };
     expect(arg.scheduledFor).toBeInstanceOf(Date);
     expect(arg.formatVersionId).toBe('fv-great-2');
     // Read back, not remembered: what this panel shows has to survive the
     // reload that throws every piece of session state away.
     await waitFor(() => expect(mmApi.myOffers.mock.calls.length).toBeGreaterThan(before));
   });
 });
 
+/**
+ * Accepting is the OFFER's business, not yours.
+ *
+ * `accept_offer(p_offer, p_team)` takes no format argument: the offer's own
+ * `format_version_id` governs the match. So neither a saved format of your
+ * own nor its `composition.size` may have any say in whether, or with what,
+ * you accept — the first locks out everyone who has none, and the second
+ * quietly sends a roster of the wrong length into someone else's offer.
+ */
+describe('signed in — accepting an offer', () => {
+  it('lets someone with no saved format of their own accept an open offer', async () => {
+    savesApi.listServerFormats.mockResolvedValue([]);
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-open', rosterSize: 3 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-open"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+
+    const acceptBtn = container.querySelector('[data-offer-id="off-open"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn).toBeTruthy();
+    // The database would take this person: they need no format to accept one.
+    expect(acceptBtn.disabled).toBe(false);
+    // And never the tooltip that used to sit on a permanently dead control.
+    expect(acceptBtn.getAttribute('title') ?? '').not.toMatch(/add 0 more/i);
+
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
+    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(3);
+    // Their own Join is still, correctly, not on offer — that one does need a
+    // format. The two gates are separate, which is the whole point.
+    expect(container.querySelector('.queue-join')).toBeFalsy();
+  });
+
+  it('sizes the roster it accepts with by the offer, not by your own format', async () => {
+    // Your format wants six; this offer is played with three.
+    savesApi.listServerFormats.mockResolvedValue([
+      savedFormat({
+        format: {
+          schema: RULES_SCHEMA,
+          base: 'great',
+          pool: [],
+          composition: { size: 6, uniqueSpecies: true },
+          selection: { mode: 'open' },
+        },
+      }),
+    ]);
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+
+    const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(false);
+    // Sized by your own six-member format, Join is not ready at three — the
+    // contrast is the assertion: one control says yes and the other says no,
+    // on the same roster, because they answer to different formats.
+    expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(true);
+
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
+    // Three, because the offer is played with three. Nothing downstream would
+    // have rejected six: the coordinator recomputes rules_hash and never
+    // inspects the roster.
+    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(3);
+  });
+
+  it('refuses to send a six-strong roster into a three-member offer', async () => {
+    // The exact mismatch nothing downstream would catch: `accept_offer` stores
+    // whatever roster it is handed as `matches.team_b`, and the coordinator
+    // recomputes `rules_hash` without ever inspecting `team`. A gate written
+    // as "at least as many as the offer wants" would let this through.
+    savesApi.listServerFormats.mockResolvedValue([
+      savedFormat({
+        format: {
+          schema: RULES_SCHEMA,
+          base: 'great',
+          pool: [],
+          composition: { size: 6, uniqueSpecies: true },
+          selection: { mode: 'open' },
+        },
+      }),
+    ]);
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    await pick(container, 'medicham');
+    await pick(container, 'swampert');
+    await pick(container, 'bastiodon');
+    // Six picked, under your own six-member format, which is legitimate — and
+    // Join is ready. It is Accept that must not be.
+    expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(false);
+    const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(true);
+    expect(acceptBtn.getAttribute('title')).toMatch(/roster of 3/i);
+  });
+
+  it('refuses to accept with a roster of the wrong length, and says what the offer wants', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(true);
+    expect(acceptBtn.getAttribute('title')).toMatch(/roster of 6/i);
+  });
+
+  it('lets the roster grow past your own format to reach a bigger offer', async () => {
+    // Otherwise a six-member offer is unacceptable no matter what you pick,
+    // which is the "control that cannot succeed" rule wearing the roster's
+    // clothes: your own three-member format would cap the picker at three.
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    await pick(container, 'medicham');
+    await pick(container, 'swampert');
+    await pick(container, 'bastiodon');
+    // Every member picked is rendered in a slot — a member with no slot is a
+    // member nobody can remove.
+    expect(container.querySelectorAll('.team-slots > *').length).toBeGreaterThanOrEqual(6);
+    const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
+    expect(acceptBtn.disabled).toBe(false);
+    await act(async () => {
+      fireEvent.click(acceptBtn);
+    });
+    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
+    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(6);
+  });
+});
+
 /**
  * The handshake, after a reload.
  *
  * A scheduled offer needs two acts by two people, minutes or days apart, and
  * neither of them is likely to still have this tab open. `listOpenOffers`
  * cannot carry it: the offer leaves `state = 'open'` the moment it is
  * accepted, which is exactly when the proposer needs to see it. Everything
  * these tests mount is a FRESH screen that posted nothing this session — the
  * panel is driven by what `myOffers` reports, or it is driven by nothing.
  */
 describe('signed in — the handshake survives a reload', () => {
   it('rediscovers an offer awaiting your confirmation, and confirms it', async () => {
     mmApi.myOffers.mockResolvedValue([
       myOffer({
         id: 'off-accepted',
         proposerId: 'u1',
         acceptedBy: 'someone-else',
         state: 'accepted',
         scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
       }),
