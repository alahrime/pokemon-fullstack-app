# Task 8 fix-round 3 re-review — 19ecf14..HEAD

## Commits
c7bf63a fix(matchmaking): don't offer Accept on an offer nobody has verified yet

## Files changed
 app/src/lib/__tests__/matchmaking.test.ts      | 61 ++++++++++++++++++----
 app/src/lib/matchmaking.ts                     | 19 ++++++-
 app/src/screens/MatchmakingScreen.tsx          | 47 +++++++++++++++--
 app/src/screens/__tests__/matchmaking.test.tsx | 70 ++++++++++++++++++++++++++
 app/src/styles/components.css                  |  7 +++
 5 files changed, 190 insertions(+), 14 deletions(-)

## Full diff
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
index 6e4951e..ba45032 100644
--- a/app/src/lib/__tests__/matchmaking.test.ts
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -193,156 +193,199 @@ describe('matches', () => {
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
-          team: [{ ref: 'azumarill' }, { ref: 'registeel' }, { ref: 'skarmory' }],
+          verified_hash: 'vh1', team: [{ ref: 'azumarill' }, { ref: 'registeel' }, { ref: 'skarmory' }],
         },
       ],
     });
     const { listOpenOffers } = await import('../matchmaking');
     const offers = await listOpenOffers('great');
     expect(offers).toEqual([
       {
         id: 'o1', proposerId: 'p1', league: 'great', formatVersionId: 'v1',
         scheduledFor: null, expiresAt: '2026-09-02T13:00:00Z', state: 'open', acceptedBy: null,
-        rosterSize: 3,
+        verifiedHash: 'vh1', rosterSize: 3,
       },
     ]);
     const leagueFilter = calls.find((c) => c.table === 'match_offers' && c.op === 'eq' && (c.payload as unknown[])[0] === 'league');
     expect(leagueFilter?.payload).toEqual(['league', 'great']);
   });
 
   /**
    * `accept_offer(p_offer, p_team)` takes no format: the OFFER's
    * `format_version_id` is what the match is played under, so how big a
    * roster an accepter needs is the offer's business and not theirs. Nothing
    * downstream would catch the mismatch either — the coordinator recomputes
    * `rules_hash` and never looks at `team`.
    *
    * The size comes from the posted roster's length rather than from the
    * format's `composition.size`, because `format_versions` is readable only
    * for a format whose `visibility = 'public'` and a saved format defaults to
    * `private` — embedding the rules would return null for exactly the
    * strangers' offers this number is for.
    */
   it('reports how big a roster each offer wants, from the roster it was posted with', async () => {
     harness({
       match_offers: [
         {
           id: 'o-three', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
           scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
           team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
         },
         {
           id: 'o-six', proposer_id: 'p2', league: 'great', format_version_id: 'v2',
           scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
           team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
         },
       ],
     });
     const { listOpenOffers } = await import('../matchmaking');
     expect((await listOpenOffers('great')).map((o) => o.rosterSize)).toEqual([3, 6]);
   });
 
+  /**
+   * `accept_offer` raises 'this offer has not been verified yet' while this
+   * column is null, and the coordinator ticks once a minute — so a board that
+   * does not read it shows an Accept button that can only fail for the first
+   * minute of every offer's life.
+   */
+  it('carries the verification state of each offer, null and set alike', async () => {
+    harness({
+      match_offers: [
+        {
+          id: 'o-fresh', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          verified_hash: null, team: [{ ref: 'a' }],
+        },
+        {
+          id: 'o-ready', proposer_id: 'p2', league: 'great', format_version_id: 'v1',
+          scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
+          verified_hash: 'vh9', team: [{ ref: 'a' }],
+        },
+      ],
+    });
+    const { listOpenOffers } = await import('../matchmaking');
+    expect((await listOpenOffers('great')).map((o) => o.verifiedHash)).toEqual([null, 'vh9']);
+  });
+
+  it('asks the database for verified_hash on both listings', async () => {
+    const { calls } = harness({ match_offers: [] });
+    const mm = await import('../matchmaking');
+    await mm.listOpenOffers('great');
+    await mm.myOffers();
+    const selects = calls.filter((c) => c.table === 'match_offers' && c.op === 'select');
+    expect(selects).toHaveLength(2);
+    for (const s of selects) expect(s.payload).toMatch(/\bverified_hash\b/);
+  });
+
   it('asks for the team it sizes that from, and reports zero rather than NaN without one', async () => {
     const { calls } = harness({
       match_offers: [
         {
           id: 'o1', proposer_id: 'p1', league: 'great', format_version_id: 'v1',
           scheduled_for: null, expires_at: '2026-09-02T13:00:00Z', state: 'open', accepted_by: null,
         },
       ],
     });
     const { listOpenOffers } = await import('../matchmaking');
     const [o] = await listOpenOffers('great');
-    // A zero disables the accept control; an undefined length would sail
-    // through `team.length === o.rosterSize` as NaN and disable it too, but
-    // silently and for the wrong reason.
+    // A zero is a number the screen can reason about, and it now refuses the
+    // offer outright on it — `unacceptableReason` in MatchmakingScreen, which
+    // is where that decision belongs. Length alone would NOT have caught it:
+    // a fresh screen holds an empty roster, so `team.length === o.rosterSize`
+    // is 0 === 0 and would have rendered an ENABLED Accept. An earlier
+    // comment here claimed the zero did that work by itself; it did not, and
+    // the code was changed rather than the claim softened.
+    //
+    // What this function must not do is hand back `undefined` for a missing
+    // `team`: every comparison against it is false, so the control would be
+    // dead for a reason nothing could name.
     expect(o.rosterSize).toBe(0);
     const select = calls.find((c) => c.table === 'match_offers' && c.op === 'select');
     expect(select?.payload).toMatch(/\bteam\b/);
   });
 
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
-          state: 'accepted', accepted_by: 'them', match_id: null,
+          state: 'accepted', accepted_by: 'them', match_id: null, verified_hash: 'vh1',
           team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
         },
         {
           id: 'o2', proposer_id: 'them', league: 'great', format_version_id: 'fv1',
           scheduled_for: null, expires_at: '2026-09-05T19:00:00Z',
-          state: 'converted', accepted_by: 'me', match_id: 'm9',
+          state: 'converted', accepted_by: 'me', match_id: 'm9', verified_hash: 'vh1',
           // Six, deliberately differing from the three above: two rows mapped
           // from one function, and a constant would satisfy only one of them.
           team: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }, { ref: 'e' }, { ref: 'f' }],
         },
       ],
     });
     const { myOffers } = await import('../matchmaking');
     expect(await myOffers()).toEqual([
       {
         id: 'o1', proposerId: 'me', league: 'great', formatVersionId: 'fv1',
         scheduledFor: '2026-09-05T18:00:00Z', expiresAt: '2026-09-05T19:00:00Z',
-        state: 'accepted', acceptedBy: 'them', matchId: null, rosterSize: 3,
+        state: 'accepted', acceptedBy: 'them', matchId: null, verifiedHash: 'vh1', rosterSize: 3,
       },
       {
         id: 'o2', proposerId: 'them', league: 'great', formatVersionId: 'fv1',
         scheduledFor: null, expiresAt: '2026-09-05T19:00:00Z',
-        state: 'converted', acceptedBy: 'me', matchId: 'm9', rosterSize: 6,
+        state: 'converted', acceptedBy: 'me', matchId: 'm9', verifiedHash: 'vh1', rosterSize: 6,
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
index 09c7eb2..f2e64bd 100644
--- a/app/src/lib/matchmaking.ts
+++ b/app/src/lib/matchmaking.ts
@@ -19,40 +19,49 @@ export interface Match {
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
+   * Null until the coordinator has recomputed the hash — and `accept_offer`
+   * raises `'this offer has not been verified yet'` for exactly that. The
+   * coordinator ticks once a minute, so every offer spends its first minute
+   * here: this is the normal beginning of an offer's life, not an edge case,
+   * and a board that does not read this column offers an Accept button that
+   * can only fail for a minute after every post.
+   */
+  verifiedHash: string | null;
   /**
    * How many members a roster accepting THIS offer needs — the length of the
    * roster the proposer posted, which they built under this offer's own
    * format. The accepter's own saved format has no say: `accept_offer` takes
    * no format argument, and the offer's `format_version_id` is what the match
    * is played under.
    *
    * Derived from `team` rather than from `format_versions.rules`, and that is
    * a real constraint rather than laziness: versions are readable only for a
    * format whose `visibility = 'public'` ("versions of a public format are
    * readable by anyone signed in"), and a saved format defaults to `private`.
    * Embedding the rules would hand back null for most offers on the board —
    * precisely for the strangers whose offers this number exists to size. The
    * team is readable under the same row policy that shows the offer at all.
    */
   rosterSize: number;
 }
 
 /**
  * An offer the signed-in person is party to. The extra field over `Offer` is
@@ -176,66 +185,70 @@ export async function myMatches(): Promise<Match[]> {
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
-    .select('id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, team')
+    .select(
+      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, team',
+    )
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
+      verified_hash: string | null;
       team: StoredMember[] | null;
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
+      verifiedHash: r.verified_hash,
       // The count, not the members. `match_offers`' select policy is
       // whole-row, so the proposer's roster is legible to anyone who can see
       // the offer — but this screen has no business rendering it, and what
       // never leaves this function cannot be rendered by accident.
       rosterSize: (r.team ?? []).length,
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
@@ -245,67 +258,69 @@ export async function listOpenOffers(league: LeagueId): Promise<Offer[]> {
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
-      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, match_id, team',
+      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, match_id, team',
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
+      verified_hash: string | null;
       match_id: string | null;
       team: StoredMember[] | null;
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
+      verifiedHash: r.verified_hash,
       matchId: r.match_id,
       rosterSize: (r.team ?? []).length,
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
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
index d9f53be..5b90b6f 100644
--- a/app/src/screens/MatchmakingScreen.tsx
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -63,50 +63,80 @@ function messageOf(e: unknown): string {
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
 
 function queueStatusText(entry: QueueEntry): string {
   // `verifiedHash` is null until the coordinator recomputes it; only a
   // verified entry is eligible to pair. Saying "queued" alone would imply a
   // match is imminent when it may not even be checked yet.
   return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
 }
 
+/**
+ * Why NOBODY can accept this offer right now — as distinct from why *you*
+ * cannot yet, which is a disabled button with a hint saying what to fix. A
+ * reason here means the control is not rendered at all.
+ */
+function unacceptableReason(o: Offer): string | null {
+  // The coordinator ticks once a minute, so every offer spends its first
+  // minute unverified and `accept_offer` raises for exactly this. Said as
+  // something in progress, because it is: a minute from now it is gone.
+  if (o.verifiedHash === null) return 'Being checked — acceptable once verified.';
+  // Only reachable from a malformed write by some other client: this screen
+  // never posts an empty roster. `accept_offer` would not catch it either —
+  // it refuses a null `p_team`, not an empty one — so a match would be
+  // created with an empty `team_b`.
+  if (o.rosterSize < 1) return 'Posted without a roster; nobody can accept it.';
+  return null;
+}
+
+/** "Add 2 more", "Remove 3" — never "Add -3 more". */
+function rosterHint(want: number, have: number, verb: string): string {
+  const short = want - have;
+  return short > 0 ? `Add ${short} more to ${verb}` : `Remove ${-short} to ${verb}`;
+}
+
 /**
  * Where an offer has got to, said from the reader's own side of it. The two
  * sides are not symmetric: `accepted` is "your move" to the proposer and
  * "waiting on them" to the taker, and telling either one the other's sentence
  * is how someone sits waiting for a handshake that was waiting for them.
  */
 function offerStatusText(o: MyOffer, proposed: boolean): string {
   switch (o.state) {
     case 'open':
-      return proposed ? 'Posted — nobody has accepted it yet.' : 'Still open.';
+      if (!proposed) return 'Still open.';
+      // The proposer's side of the same minute the board hides Accept for:
+      // "nobody has accepted it" would read as indifference from other
+      // people when in fact nobody has been allowed to yet.
+      return o.verifiedHash === null
+        ? 'Posted — being checked before anyone can accept it.'
+        : 'Posted — nobody has accepted it yet.';
     case 'accepted':
       return proposed
         ? 'Someone accepted. Confirm it to make it a match.'
         : "You accepted — awaiting the proposer's confirmation.";
     case 'confirmed':
     case 'converted':
       return 'Confirmed — this is a match now.';
     case 'lapsed':
       return 'Lapsed — the window closed before it was confirmed.';
   }
 }
 
 export function MatchmakingScreen() {
   const { state } = useAppState();
   const { user } = useSession();
   const league = state.league;
 
   // --- the format being queued under --------------------------------------
   // Null while loading, [] once loaded and empty — a distinction the screen
   // renders, since "you have no saved formats" is a wrong thing to say to
@@ -301,41 +331,42 @@ export function MatchmakingScreen() {
         if (live) setMine(o);
       })
       .catch((e: unknown) => {
         if (live) setNotice(messageOf(e));
       });
     return () => {
       live = false;
     };
   }, [user]);
 
   /**
    * Accepting is governed by the OFFER, not by you. `accept_offer(p_offer,
    * p_team)` takes no format: the offer's own `format_version_id` is what the
    * match is played under, so a saved format of your own is not needed to
    * accept one, and requiring it locked out everyone who has none — the
    * database would have taken them. The roster has to be the size the OFFER
    * wants for the same reason; sizing it by your own format would let a
    * 6-strong roster into a 3-member offer, which nothing downstream rejects
    * (the coordinator recomputes `rules_hash` and never inspects `team`).
    */
-  const canAccept = (o: Offer) => !!user && o.proposerId !== user.id && team.length === o.rosterSize;
+  const canAccept = (o: Offer) =>
+    !!user && o.proposerId !== user.id && unacceptableReason(o) === null && team.length === o.rosterSize;
 
   const accept = async (o: Offer) => {
     if (!canAccept(o) || busy) return;
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
@@ -467,41 +498,45 @@ export function MatchmakingScreen() {
           />
         </div>
       </div>
 
       <div className="panel">
         <div className="hud-label">Blind queue</div>
         <p className="text-muted">
           Matched with anyone else queued under the same league and rules, blind — no format to browse, no
           opponent to pick.
         </p>
         {entry && <p className="queue-status">{queueStatusText(entry)}</p>}
         <div className="matchmaking-actions">
           {/* No Join at all without a format to join under: `format_version_id`
               is NOT NULL and a foreign key, so the call could only fail. Same
               rule as the Accept control on one's own offer. */}
           {chosen && (
             <button
               type="button"
               className="btn btn-primary queue-join"
               disabled={!rosterReady || !!entry || busy}
-              title={!rosterReady ? `Add ${rosterSize - team.length} more to queue` : undefined}
+              // Never "Add -3 more": the picker's cap is the largest thing on
+              // the board, so a roster built to accept a six-member offer is
+              // longer than a three-member format wants, and the shortfall is
+              // negative. Say which way to move it.
+              title={rosterReady ? undefined : rosterHint(rosterSize, team.length, 'queue')}
               onClick={() => void join()}
             >
               {busy ? 'Working…' : 'Join queue'}
             </button>
           )}
           {entry && (
             <button type="button" className="btn" disabled={busy} onClick={() => void leave()}>
               Leave queue
             </button>
           )}
         </div>
         {matches && matches.length > 0 && (
           <ul className="match-list">
             {matches.map((m) => (
               <li key={m.id} className="match-row">
                 <span>Match paired</span>
                 <span className="friend-code">
                   {codes[m.opponentId] === undefined
                     ? 'Loading friend code…'
                     : codes[m.opponentId]
@@ -515,48 +550,54 @@ export function MatchmakingScreen() {
       </div>
 
       <div className="panel">
         <div className="hud-label">Open offer board</div>
         <p className="text-muted">
           Browse a curated offer, or post one of your own — live now, or scheduled for later once both sides
           confirm.
         </p>
         {justAccepted && (
           <p className="matchmaking-notice" role="status">
             {justAccepted.matchId
               ? 'Matched! Check your matches above for the friend code.'
               : "Offer accepted — awaiting the proposer's confirmation. Not a match yet."}
           </p>
         )}
         {offers && offers.length === 0 && <p className="text-faint">No open offers right now.</p>}
         {offers && offers.length > 0 && (
           <ul className="offer-list">
             {offers.map((o) => {
               const mine = o.proposerId === user.id;
+              const blocked = unacceptableReason(o);
               return (
                 <li key={o.id} className="offer-row" data-offer-id={o.id}>
                   <span className="offer-when">
                     {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
                   </span>
                   <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
                   {mine ? (
                     <span className="text-faint">Your offer</span>
+                  ) : blocked ? (
+                    // Not a disabled button: nothing this person does would
+                    // make it work, so the reason takes the control's place
+                    // rather than sitting in a tooltip on a dead one.
+                    <span className="text-faint offer-blocked">{blocked}</span>
                   ) : (
                     <button
                       type="button"
                       className="btn chip-btn offer-accept"
                       // Not `rosterReady`: that asks whether YOU could post,
                       // and accepting is the offer's business, not your
                       // format's.
                       disabled={!canAccept(o) || busy}
                       title={
                         canAccept(o) ? undefined : `This offer is played with a roster of ${o.rosterSize}`
                       }
                       onClick={() => void accept(o)}
                     >
                       Accept
                     </button>
                   )}
                 </li>
               );
             })}
           </ul>
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
index acc5c49..57dda88 100644
--- a/app/src/screens/__tests__/matchmaking.test.tsx
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -104,73 +104,78 @@ async function pick(container: HTMLElement, typed: string) {
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
+    // Verified by default: the unverified case is its own set of tests below,
+    // and leaving every fixture in it would silently remove the Accept control
+    // from tests that are about something else entirely.
+    verifiedHash: 'h1',
     rosterSize: 3,
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
+    verifiedHash: 'h1',
     matchId: null,
     rosterSize: 3,
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
 
@@ -525,68 +530,133 @@ describe('signed in — accepting an offer', () => {
         },
       }),
     ]);
     mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => {
       if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
     });
     await pickThree(container);
     await pick(container, 'medicham');
     await pick(container, 'swampert');
     await pick(container, 'bastiodon');
     // Six picked, under your own six-member format, which is legitimate — and
     // Join is ready. It is Accept that must not be.
     expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(false);
     const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
     expect(acceptBtn.disabled).toBe(true);
     expect(acceptBtn.getAttribute('title')).toMatch(/roster of 3/i);
   });
 
+  it('offers no Accept on an offer the coordinator has not verified yet, and says why', async () => {
+    // The coordinator ticks once a minute, so this is the normal first minute
+    // of every offer's life, not a rare edge — and `accept_offer` raises
+    // 'this offer has not been verified yet' for the whole of it.
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-fresh', verifiedHash: null }),
+      offer({ id: 'off-ready', verifiedHash: 'h1' }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const [fresh, ready] = await waitFor(() => {
+      const a = container.querySelector('[data-offer-id="off-fresh"]');
+      const b = container.querySelector('[data-offer-id="off-ready"]');
+      if (!a || !b) throw new Error('board not rendered yet');
+      return [a, b];
+    });
+    await pickThree(container);
+    expect(fresh.querySelector('.offer-accept')).toBeFalsy();
+    // A reason in the person's own register, so the board reads as busy
+    // rather than broken.
+    expect(fresh.textContent).toMatch(/being checked/i);
+    // And the verified one beside it is unaffected — otherwise this test
+    // would pass against a board that offered nothing to anybody.
+    expect((ready.querySelector('.offer-accept') as HTMLButtonElement).disabled).toBe(false);
+  });
+
+  it('tells the proposer their own offer is being checked, not that nobody wants it', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({ id: 'off-fresh', proposerId: 'u1', state: 'open', verifiedHash: null }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-fresh"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
+    });
+    expect(row.textContent).toMatch(/being checked/i);
+    expect(row.textContent).not.toMatch(/nobody has accepted/i);
+  });
+
+  it('offers no Accept on an offer posted with no roster at all', async () => {
+    // Not reachable from this screen, which never posts an empty roster — but
+    // `accept_offer` refuses only a NULL p_team, not an empty one, so a
+    // malformed offer from another client would otherwise convert into a
+    // match with an empty team_b.
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-empty', rosterSize: 0 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-offer-id="off-empty"]');
+      if (!r) throw new Error('board not rendered yet');
+      return r;
+    });
+    // A fresh screen holds an empty roster, so `team.length === o.rosterSize`
+    // is 0 === 0 — true. Length alone would have offered an enabled Accept.
+    expect(row.querySelector('.offer-accept')).toBeFalsy();
+    expect(row.textContent).toMatch(/without a roster/i);
+  });
+
   it('refuses to accept with a roster of the wrong length, and says what the offer wants', async () => {
     mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => {
       if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
     });
     await pickThree(container);
     const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
     expect(acceptBtn.disabled).toBe(true);
     expect(acceptBtn.getAttribute('title')).toMatch(/roster of 6/i);
   });
 
   it('lets the roster grow past your own format to reach a bigger offer', async () => {
     // Otherwise a six-member offer is unacceptable no matter what you pick,
     // which is the "control that cannot succeed" rule wearing the roster's
     // clothes: your own three-member format would cap the picker at three.
     mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => {
       if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
     });
     await pickThree(container);
     await pick(container, 'medicham');
     await pick(container, 'swampert');
     await pick(container, 'bastiodon');
     // Every member picked is rendered in a slot — a member with no slot is a
     // member nobody can remove.
     expect(container.querySelectorAll('.team-slots > *').length).toBeGreaterThanOrEqual(6);
+
+    // Your own three-member format now wants three FEWER than you hold, and
+    // the shortfall arithmetic runs negative here: "Add -3 more to queue".
+    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
+    expect(joinBtn.disabled).toBe(true);
+    expect(joinBtn.getAttribute('title')).toMatch(/^Remove 3 to queue$/);
+    expect(joinBtn.getAttribute('title')).not.toMatch(/-\d/);
+
     const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
     expect(acceptBtn.disabled).toBe(false);
     await act(async () => {
       fireEvent.click(acceptBtn);
     });
     await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
     expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(6);
   });
 });
 
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
diff --git a/app/src/styles/components.css b/app/src/styles/components.css
index 26ca446..d0e21b9 100644
--- a/app/src/styles/components.css
+++ b/app/src/styles/components.css
@@ -5993,40 +5993,47 @@ th.bt-matrix-head { text-align: center; }
 /* Bounded for the same reason: your own offers accumulate as you post them. */
 .my-offer-list {
   list-style: none;
   margin: var(--space-2) 0 0;
   padding: 0;
   display: flex;
   flex-direction: column;
   gap: var(--space-1);
   max-height: 240px;
   overflow-y: auto;
 }
 .match-row,
 .offer-row,
 .my-offer-row {
   display: flex;
   align-items: center;
   gap: var(--space-2);
   flex-wrap: wrap;
   font-size: var(--text-sm);
 }
+/* The reason an offer cannot be accepted, standing where its Accept control
+   would be — sized like the control it replaces so the row does not reflow
+   when the coordinator verifies the offer a moment later. */
+.offer-blocked {
+  font-size: var(--text-xs);
+  font-style: italic;
+}
 .offer-when,
 .my-offer-when {
   flex: 1 1 12rem;
   min-width: 8rem;
 }
 .friend-code {
   font-family: var(--font-mono);
   color: var(--color-accent);
 }
 .offer-schedule-row {
   display: flex;
   align-items: center;
   gap: var(--space-2);
   margin-top: var(--space-2);
 }
 /* No --danger token in this design system — the secondary signal colour every
    theme defines is what a message like this uses instead (see
    .team-load-notice above, the precedent this copies). */
 .matchmaking-notice {
   margin-top: var(--space-2);
