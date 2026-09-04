# Final fix wave re-review — 63f2586..HEAD

## Commits
66787e5 fix(matchmaking): the handshake columns stop being the client's to write

## Files changed
 app/src/lib/__tests__/matchmaking.test.ts          |  26 +-
 app/src/lib/matchmaking.ts                         |  27 +-
 app/src/screens/MatchmakingScreen.tsx              |  94 ++++--
 app/src/screens/__tests__/matchmaking.test.tsx     |  98 ++++++
 app/tools/m2a-roundtrip.ts                         |  20 +-
 supabase/functions/coordinator/index.ts            |  35 ++-
 ...904071716_handshake_columns_are_server_only.sql | 140 +++++++++
 ...71717_accept_offer_agrees_on_the_data_build.sql |  98 ++++++
 supabase/tests/helpers.ts                          |  63 ++++
 supabase/tests/offers.test.ts                      | 333 +++++++++++++++++++--
 supabase/tests/pairing.test.ts                     |  78 ++++-
 supabase/tests/queue.test.ts                       |  88 +++++-
 12 files changed, 1029 insertions(+), 71 deletions(-)

## Full diff
diff --git a/app/src/lib/__tests__/matchmaking.test.ts b/app/src/lib/__tests__/matchmaking.test.ts
index ba45032..243903b 100644
--- a/app/src/lib/__tests__/matchmaking.test.ts
+++ b/app/src/lib/__tests__/matchmaking.test.ts
@@ -429,44 +429,68 @@ describe('offers', () => {
 
   /**
    * `acceptOffer` takes the taker's team: `accept_offer(p_offer, p_team)`
    * stores it as `accepted_team` and, for a live offer, as `matches.team_b`,
    * which is NOT NULL. The brief's version of this test called
    * `acceptOffer('o1')` with one argument — that signature cannot supply a
    * roster for a live match, so it is adapted here to pass one.
    */
   it('accepts an offer through the function, never by writing the row', async () => {
     const { calls } = harness({});
     const { acceptOffer } = await import('../matchmaking');
     await acceptOffer('o1', []);
     expect(calls.some((c) => c.table === 'match_offers' && c.op === 'update')).toBe(false);
     // accept_offer holds the row lock while it checks state; an UPDATE from here
     // would race a second taker and could edit the terms being agreed to.
   });
 
   it('calls accept_offer with the offer id and the taker team as separate args', async () => {
     const { calls } = harness({});
     const { acceptOffer } = await import('../matchmaking');
+    const { DATA_REV } = await import('../data');
     const team = [{ ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }];
     await acceptOffer('o1', team);
     const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'accept_offer')!;
-    expect(rpc.payload).toEqual({ p_offer: 'o1', p_team: team });
+    expect(rpc.payload).toEqual({ p_offer: 'o1', p_team: team, p_data_rev: DATA_REV });
+  });
+
+  /**
+   * Accepting is the THIRD way into a match, and until this branch it was the
+   * only one that never said which data build it was on. `joinQueue` and
+   * `createOffer` both write `DATA_REV` into their own row and
+   * `pair_queue_entries` refuses to pair across builds; `accept_offer` now
+   * refuses too, and the argument has to be this build's revision rather than
+   * anything read back off the offer — the whole point is that the two may
+   * disagree.
+   *
+   * Asserted against the real `DATA_REV` and not merely `expect.any(String)`,
+   * which would keep passing if the call sent a literal, the offer's own rev,
+   * or an empty string.
+   */
+  it('sends this build\'s own data revision when accepting, not the offer\'s', async () => {
+    const { calls } = harness({});
+    const { acceptOffer } = await import('../matchmaking');
+    const { DATA_REV } = await import('../data');
+    await acceptOffer('o1', []);
+    const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'accept_offer')!;
+    expect((rpc.payload as { p_data_rev: string }).p_data_rev).toBe(DATA_REV);
+    expect(DATA_REV.length).toBeGreaterThan(0);
   });
 
   it('confirms an offer through the function and returns the new match id', async () => {
     const { calls } = harness({});
     const { confirmOffer } = await import('../matchmaking');
     const id = await confirmOffer('o1');
     expect(id).toBe('m1');
     const rpc = calls.find((c) => c.table === 'rpc' && c.op === 'confirm_offer')!;
     expect(rpc.payload).toEqual({ p_offer: 'o1' });
   });
 });
 
 describe('friend codes', () => {
   it('reads the opponent friend code exposed once a match pairs the two of you', async () => {
     harness({ friend_codes: [{ code: '1234 5678 9012' }] });
     const { opponentFriendCode } = await import('../matchmaking');
     expect(await opponentFriendCode('them')).toBe('1234 5678 9012');
   });
 
   it('returns null rather than throwing when no code is on file yet', async () => {
diff --git a/app/src/lib/matchmaking.ts b/app/src/lib/matchmaking.ts
index f2e64bd..f8b1df5 100644
--- a/app/src/lib/matchmaking.ts
+++ b/app/src/lib/matchmaking.ts
@@ -327,52 +327,65 @@ export async function createOffer(a: {
   if (a.scheduledFor && a.scheduledFor <= new Date()) {
     throw new Error('a scheduled offer cannot be in the past');
   }
   const { data, error } = await supabase
     .from('match_offers')
     .insert({
       league: a.league,
       format_version_id: a.formatVersionId,
       claimed_hash: await rulesHash(a.format),
       team: a.team,
       data_rev: DATA_REV,
       scheduled_for: a.scheduledFor ? a.scheduledFor.toISOString() : null,
     })
     .select('id')
     .single();
   if (error) throw new Error(error.message);
   return (data as { id: string }).id;
 }
 
 /**
- * Goes through `accept_offer(p_offer, p_team)`, never a client UPDATE: the
- * function holds the row lock while it checks state, and a taker permitted to
- * write this row directly would be a taker permitted to edit the terms they
- * are agreeing to. `p_team` is the taker's own roster — `matches.team_b` is
- * NOT NULL for a live offer, and there is no column policy that would let a
- * taker stage it any other way.
+ * Goes through `accept_offer(p_offer, p_team, p_data_rev)`, never a client
+ * UPDATE: the function holds the row lock while it checks state, and a taker
+ * permitted to write this row directly would be a taker permitted to edit the
+ * terms they are agreeing to — and, as the branch review measured, to forge an
+ * acceptance in someone else's name. `p_team` is the taker's own roster —
+ * `matches.team_b` is NOT NULL for a live offer, and there is no column policy
+ * that would let a taker stage it any other way.
+ *
+ * `p_data_rev` is `DATA_REV`, this build's data revision, and it is not
+ * optional: the function refuses an offer posted on a different build.
+ * `joinQueue` and `createOffer` both write `DATA_REV` into their own row and
+ * `pair_queue_entries` refuses to pair across builds; accepting is the third
+ * way into a match and has to answer the same question. Sent as an argument
+ * rather than read from the offer, because the whole point is that the two
+ * might disagree.
  *
  * Returns the new match id for a live offer, or null for a scheduled one —
  * that offer is `accepted`, not yet a match, until the proposer confirms.
  */
 export async function acceptOffer(id: string, team: StoredMember[]): Promise<string | null> {
-  const { data, error } = await supabase.rpc('accept_offer', { p_offer: id, p_team: team });
+  const { data, error } = await supabase.rpc('accept_offer', {
+    p_offer: id,
+    p_team: team,
+    p_data_rev: DATA_REV,
+  });
   if (error) throw new Error(error.message);
   return data as string | null;
 }
 
 /** Goes through `confirm_offer(p_offer)`, the proposer's half of the same handshake. */
 export async function confirmOffer(id: string): Promise<string> {
   const { data, error } = await supabase.rpc('confirm_offer', { p_offer: id });
   if (error) throw new Error(error.message);
   return data as string;
 }
 
 /**
  * Readable only once a match pairs the two of you — see the "an opponent may
  * read your friend code while you have a match" policy on `friend_codes`. No
  * `.single()`: a profile with no code on file yet is zero rows, not an error.
  */
 export async function opponentFriendCode(profileId: string): Promise<string | null> {
   const { data, error } = await supabase.from('friend_codes').select('code').eq('profile_id', profileId);
   if (error) throw new Error(error.message);
   const rows = (data ?? []) as { code: string }[];
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
index 41aacdf..cd70d44 100644
--- a/app/src/screens/MatchmakingScreen.tsx
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -57,111 +57,164 @@ const DEFAULT_ROSTER_SIZE = 3;
 function messageOf(e: unknown): string {
   return e instanceof Error ? e.message : String(e);
 }
 
 /** What a member saves as when it was never opened in a build picker — the
  * league's rated set, same fallback `TeamBuilderScreen`'s `Slot` uses. */
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
+  // Expiry FIRST, and for the same reason the offer board checks it first: an
+  // entry lives ten minutes, `sweep_expired` deletes it on the next tick, and
+  // nothing re-reads this panel. Past `expiresAt` the row on screen is a
+  // memory, and "eligible to pair" is a claim about the future that has
+  // already been falsified — the person is not queued at all and is being
+  // told they are.
+  if (Date.parse(entry.expiresAt) <= Date.now()) {
+    return 'The queue window closed — join again to keep looking.';
+  }
   // `verifiedHash` is null until the coordinator recomputes it; only a
   // verified entry is eligible to pair. Saying "queued" alone would imply a
   // match is imminent when it may not even be checked yet.
   return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
 }
 
 /**
  * Why NOBODY can accept this offer right now — as distinct from why *you*
  * cannot yet, which is a disabled button with a hint saying what to fix. A
  * reason here means the control is not rendered at all.
  */
 function unacceptableReason(o: Offer): string | null {
   // FIRST, because it is first in `accept_offer` too — the reason shown is the
   // reason the database would actually give.
   //
   // Expiry is a coordinator SWEEP, not a trigger: an offer past `expires_at`
   // sits in `state = 'open'` until the next tick, and `listOpenOffers` filters
   // only on `league` and `state`, so an expired row is handed back looking
   // exactly like a live one. Nothing on this screen re-reads the board on its
   // own either, so a page left open past this timestamp would otherwise show
   // an enabled Accept — whose only possible outcome is `accept_offer` raising
   // 'this offer has expired' — for as long as the tab stays open.
   if (Date.parse(o.expiresAt) <= Date.now()) return 'Expired — nobody can accept it now.';
   // The coordinator ticks once a minute, so every offer spends its first
   // minute unverified and `accept_offer` raises for exactly this. Said as
   // something in progress, because it is: a minute from now it is gone.
   if (o.verifiedHash === null) return 'Being checked — acceptable once verified.';
   // Only reachable from a malformed write by some other client: this screen
   // never posts an empty roster. `accept_offer` would not catch it either —
   // it refuses a null `p_team`, not an empty one — so a match would be
   // created with an empty `team_b`.
   if (o.rosterSize < 1) return 'Posted without a roster; nobody can accept it.';
   return null;
 }
 
+/**
+ * Why the proposer of an offer somebody has ALREADY accepted still cannot
+ * confirm it. `unacceptableReason`'s job, for the other half of the handshake.
+ *
+ * `confirm_offer` has five ways to raise and this screen checked two of them:
+ * `proposed` covers 'only the proposer confirms' and `state === 'accepted'`
+ * covers 'this offer has not been accepted yet'. The other two are below, and
+ * both are reachable — one of them exists only because a migration was written
+ * to produce it.
+ */
+function unconfirmableReason(o: MyOffer): string | null {
+  // In `confirm_offer`'s own order, so the reason shown is the reason the
+  // database would actually give.
+  //
+  // Expiry is a coordinator SWEEP, not a trigger, and `myOffers()` never
+  // re-reads on its own — so an accepted offer past `expiresAt` sits here
+  // showing an enabled Confirm for as long as the tab stays open, not for the
+  // minute a verification lag would cost.
+  if (Date.parse(o.expiresAt) <= Date.now()) {
+    return 'The window closed before this was confirmed.';
+  }
+  // `accepted_by` is `on delete set null`: a taker who accepts and then
+  // deletes their account leaves the offer in state 'accepted' with nobody
+  // attached, and nothing about account deletion touches `state`. Migration
+  // 20260903011151 exists for exactly this and does nothing else — it turns a
+  // raw NOT NULL violation on `matches.player_b` into a sentence — and this
+  // screen selected `accepted_by` and ignored it, so the only way to reach
+  // that sentence was to press a button that could not work.
+  if (o.acceptedBy === null) {
+    return 'Whoever accepted it no longer has an account.';
+  }
+  return null;
+}
+
 /**
  * "Add 2 more to queue", "Remove 3 to post" — never "Add -3 more".
  *
  * `verb` is what the control the hint hangs off actually does. Every control
  * gated on `rosterReady` passes its own: Join, Post and Schedule are three
  * buttons that go dead together, and a hint naming the wrong one of them is
  * only marginally better than no hint at all.
  */
 function rosterHint(want: number, have: number, verb: 'queue' | 'post' | 'schedule'): string {
   const short = want - have;
   return short > 0 ? `Add ${short} more to ${verb}` : `Remove ${-short} to ${verb}`;
 }
 
 /** Why a control is dead for the duration of an in-flight call. */
 const BUSY_HINT = 'Working — wait for the last action to finish';
 
 /**
  * Where an offer has got to, said from the reader's own side of it. The two
  * sides are not symmetric: `accepted` is "your move" to the proposer and
  * "waiting on them" to the taker, and telling either one the other's sentence
  * is how someone sits waiting for a handshake that was waiting for them.
  */
 function offerStatusText(o: MyOffer, proposed: boolean): string {
   switch (o.state) {
     case 'open':
       if (!proposed) return 'Still open.';
       // The proposer's side of the same minute the board hides Accept for:
       // "nobody has accepted it" would read as indifference from other
       // people when in fact nobody has been allowed to yet.
       return o.verifiedHash === null
         ? 'Posted — being checked before anyone can accept it.'
         : 'Posted — nobody has accepted it yet.';
     case 'accepted':
-      return proposed
+      // Both of the next two sentences are instructions to WAIT for something
+      // that is no longer coming, and an instruction beside a control that is
+      // not there is worse than no sentence at all. `sweep_expired` will move
+      // this row to 'lapsed' on the next tick and say so itself; until then
+      // the screen has to.
+      if (Date.parse(o.expiresAt) <= Date.now()) {
+        return 'Accepted, but the window closed before it was confirmed.';
+      }
+      if (!proposed) return "You accepted — awaiting the proposer's confirmation.";
+      // "Confirm it" is only worth saying where a Confirm exists.
+      return unconfirmableReason(o) === null
         ? 'Someone accepted. Confirm it to make it a match.'
-        : "You accepted — awaiting the proposer's confirmation.";
+        : 'Someone accepted.';
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
   // someone whose formats simply have not arrived yet.
   const [savedFormats, setSavedFormats] = useState<SavedFormat[] | null>(null);
   const [chosenId, setChosenId] = useState<string | null>(null);
 
@@ -690,59 +743,66 @@ export function MatchmakingScreen() {
                   onClick={() => void post(true)}
                 >
                   Schedule
                 </button>
               </div>
             </div>
           )}
         </div>
       </div>
 
       {mine && mine.length > 0 && (
         <div className="panel">
           <div className="hud-label">Your offers</div>
           <p className="text-muted">
             Every offer you proposed or accepted, read back from the server — so a scheduled proposal is
             still here, and still confirmable, on your next visit.
           </p>
           <ul className="my-offer-list">
             {mine.map((o) => {
               const proposed = o.proposerId === user.id;
+              const confirmable = proposed && o.state === 'accepted';
+              const confirmBlocked = confirmable ? unconfirmableReason(o) : null;
               return (
                 <li key={o.id} className="my-offer-row" data-my-offer-id={o.id} data-offer-state={o.state}>
                   <span className="my-offer-when">
                     {o.scheduledFor
                       ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}`
                       : 'Posted to the open board'}
                   </span>
                   <span className="text-faint my-offer-status">{offerStatusText(o, proposed)}</span>
                   {/* Confirm ONLY for the proposer of an offer someone has
-                      actually accepted. confirm_offer raises "only the
-                      proposer confirms" for the taker and "this offer has not
-                      been accepted yet" for every other state, so a Confirm
-                      anywhere else is a button whose entire behaviour is to
-                      print raw Postgres text at someone. */}
-                  {proposed && o.state === 'accepted' && (
-                    <button
-                      type="button"
-                      className="btn chip-btn offer-confirm"
-                      disabled={busy}
-                      onClick={() => void confirm(o.id)}
-                    >
-                      Confirm
-                    </button>
-                  )}
+                      actually accepted, and only when confirm_offer's other
+                      two raises are also out of the way. A Confirm anywhere
+                      else is a button whose entire behaviour is to print raw
+                      Postgres text at someone — and the reason takes the
+                      control's place rather than sitting in a tooltip on a
+                      dead one, the same shape the board uses. */}
+                  {confirmable &&
+                    (confirmBlocked ? (
+                      <span className="text-faint offer-blocked">{confirmBlocked}</span>
+                    ) : (
+                      <button
+                        type="button"
+                        className="btn chip-btn offer-confirm"
+                        disabled={busy}
+                        title={busy ? BUSY_HINT : undefined}
+                        onClick={() => void confirm(o.id)}
+                      >
+                        Confirm
+                      </button>
+                    ))}
                 </li>
               );
             })}
           </ul>
         </div>
       )}
 
       {notice && (
         <p className="matchmaking-notice" role="alert">
           {notice}
         </p>
       )}
     </div>
   );
 }
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
index d9ab5c8..4e23929 100644
--- a/app/src/screens/__tests__/matchmaking.test.tsx
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -264,40 +264,70 @@ describe('signed in — the blind queue', () => {
     await act(async () => {
       fireEvent.click(container.querySelector('.queue-join') as HTMLButtonElement);
     });
     await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
     expect((mmApi.joinQueue.mock.calls[0][0] as { formatVersionId: string }).formatVersionId).toBe('fv-cup-7');
   });
 
   it('distinguishes queued-awaiting-verification from queued-and-eligible', async () => {
     mmApi.myQueueEntry.mockResolvedValue({
       id: 'q1',
       league: 'great',
       formatVersionId: 'v1',
       verifiedHash: null,
       expiresAt: new Date(Date.now() + 600_000).toISOString(),
     } satisfies QueueEntry);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => expect(container.textContent).toMatch(/awaiting verification/i));
     expect(container.textContent).not.toMatch(/eligible to pair/i);
   });
 
+  /**
+   * I4. A queue entry lives ten minutes and `sweep_expired` deletes it on the
+   * next coordinator tick; nothing re-reads this panel. Past `expiresAt` the
+   * row on screen is a memory, and "queued and eligible to pair" is a claim
+   * about the future that has already been falsified — the person is not
+   * queued at all and is being told they are.
+   *
+   * The fixture is a VERIFIED entry on purpose: an unverified one would show
+   * "awaiting verification" for the wrong reason, and the assertion would pass
+   * without the expiry branch existing. Verified plus expired is the only
+   * combination where the two branches disagree.
+   */
+  it('stops calling an expired queue entry eligible, though the row is still on screen', async () => {
+    mmApi.myQueueEntry.mockResolvedValue({
+      id: 'q1',
+      league: 'great',
+      formatVersionId: 'v1',
+      verifiedHash: 'abc123',
+      expiresAt: new Date(Date.now() - 1000).toISOString(),
+    } satisfies QueueEntry);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const status = await waitFor(() => {
+      const p = container.querySelector('.queue-status');
+      if (!p) throw new Error('queue status not rendered yet');
+      return p;
+    });
+    expect(status.textContent).toBe('The queue window closed — join again to keep looking.');
+    expect(container.textContent).not.toMatch(/eligible to pair/i);
+  });
+
   it('shows a verified entry as eligible, not awaiting', async () => {
     mmApi.myQueueEntry.mockResolvedValue({
       id: 'q1',
       league: 'great',
       formatVersionId: 'v1',
       verifiedHash: 'abc123',
       expiresAt: new Date(Date.now() + 600_000).toISOString(),
     } satisfies QueueEntry);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => expect(container.textContent).toMatch(/eligible to pair/i));
     expect(container.textContent).not.toMatch(/awaiting verification/i);
   });
 
   it('asks before leaving a queue it is already in', async () => {
     mmApi.myQueueEntry.mockResolvedValue({
       id: 'q1',
       league: 'great',
       formatVersionId: 'v1',
       verifiedHash: null,
       expiresAt: new Date(Date.now() + 600_000).toISOString(),
@@ -711,40 +741,108 @@ describe('signed in — the handshake survives a reload', () => {
     mmApi.myOffers.mockResolvedValue([
       myOffer({ id: 'off-open-live', proposerId: 'u1', state: 'open' }),
       myOffer({
         id: 'off-open-sched',
         proposerId: 'u1',
         state: 'open',
         scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
       }),
     ]);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     await waitFor(() => {
       if (!container.querySelector('[data-my-offer-id="off-open-live"]')) throw new Error('not rendered yet');
     });
     // A live offer goes open -> converted on acceptance and never reaches
     // `accepted`, so confirm_offer would raise "this offer has not been
     // accepted yet" every single time and print that sentence at the person.
     expect(container.querySelectorAll('.offer-confirm')).toHaveLength(0);
     expect(container.textContent).toMatch(/nobody has accepted it yet/i);
   });
 
+  /**
+   * I3, first half. `confirm_offer` raises 'this offer has expired' on an
+   * accepted offer past its window, and expiry is a coordinator SWEEP rather
+   * than a trigger — so the row sits in state 'accepted' until the next tick,
+   * and `myOffers()` never re-reads on its own. A tab left open shows an
+   * enabled Confirm indefinitely, and pressing it can only print raw Postgres
+   * text at the person.
+   *
+   * The fixture differs from the passing confirm test above in `expiresAt`
+   * alone: same proposer, same state, same acceptedBy. So the control
+   * disappearing here is the expiry branch and nothing else.
+   */
+  it('replaces Confirm with a reason once the window has closed on an accepted offer', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({
+        id: 'off-late',
+        proposerId: 'u1',
+        acceptedBy: 'someone-else',
+        state: 'accepted',
+        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
+        expiresAt: new Date(Date.now() - 1000).toISOString(),
+      }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-late"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
+    });
+    expect(row.querySelector('.offer-confirm')).toBeFalsy();
+    expect(row.querySelector('.offer-blocked')?.textContent).toBe('The window closed before this was confirmed.');
+    // And the status line stops instructing the person to do a thing there is
+    // no longer a control for.
+    expect(row.textContent).not.toMatch(/confirm it to make it a match/i);
+    expect(row.textContent).toMatch(/the window closed before it was confirmed/i);
+  });
+
+  /**
+   * I3, second half, and the one that exists only because a migration was
+   * written to produce it. `accepted_by` is `on delete set null`, so a taker
+   * who accepts and then deletes their account leaves the offer in state
+   * 'accepted' with nobody attached; nothing about account deletion touches
+   * `state`. Migration 20260903011151 exists for exactly this and does nothing
+   * else — it turns a raw NOT NULL violation on `matches.player_b` into a
+   * sentence — and until this branch the only way to reach that sentence was
+   * to press a button that could not work.
+   */
+  it('replaces Confirm with a reason when whoever accepted has deleted their account', async () => {
+    mmApi.myOffers.mockResolvedValue([
+      myOffer({
+        id: 'off-ghost',
+        proposerId: 'u1',
+        acceptedBy: null,
+        state: 'accepted',
+        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
+      }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-my-offer-id="off-ghost"]');
+      if (!r) throw new Error('offer row not rendered yet');
+      return r;
+    });
+    expect(row.querySelector('.offer-confirm')).toBeFalsy();
+    expect(row.querySelector('.offer-blocked')?.textContent).toBe('Whoever accepted it no longer has an account.');
+    expect(mmApi.confirmOffer).not.toHaveBeenCalled();
+  });
+
   it('shows a confirmed offer as a match rather than as something still to do', async () => {
     mmApi.myOffers.mockResolvedValue([
       myOffer({ id: 'off-done', proposerId: 'u1', acceptedBy: 'someone-else', state: 'converted', matchId: 'm9' }),
     ]);
     const { container } = await mount(fakeSession('u1', 'ash@example.com'));
     const row = await waitFor(() => {
       const r = container.querySelector('[data-my-offer-id="off-done"]');
       if (!r) throw new Error('offer row not rendered yet');
       return r;
     });
     expect(row.textContent).toMatch(/this is a match now/i);
     expect(row.querySelector('.offer-confirm')).toBeFalsy();
   });
 });
 
 /**
  * An offer past its own `expires_at`.
  *
  * `accept_offer` raises 'this offer has expired' before it checks anything
  * else, and expiry is a coordinator SWEEP rather than a trigger — the row sits
diff --git a/app/tools/m2a-roundtrip.ts b/app/tools/m2a-roundtrip.ts
index 1052484..0fd3d20 100644
--- a/app/tools/m2a-roundtrip.ts
+++ b/app/tools/m2a-roundtrip.ts
@@ -680,47 +680,55 @@ async function main(): Promise<void> {
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
-    // Backdate the window. `createOffer` cannot take expires_at, and the
-    // proposer's own "an offer belongs to the person who proposed it" policy is
-    // what permits this — it is a client-authorized write, not an admin one.
+    // Backdate the window, as ADMIN. It used to be alice's own write, on the
+    // grounds that "an offer belongs to the person who proposed it" permits
+    // it — and that was true, which is precisely the Critical this branch
+    // then had to fix: UPDATE is now revoked from `authenticated`, because a
+    // proposer able to edit their own offer's columns is a proposer able to
+    // set `accepted_by` to a stranger and confirm a match against them. The
+    // test harness needs the clock moved; it does not need a client to be
+    // able to move it, and pretending otherwise is what let the hole sit.
     const past = new Date(Date.now() - 60 * 1000).toISOString();
-    const moved = await as(alice, async () =>
-      supabase.from('match_offers').update({ expires_at: past }).eq('id', offerId).select('id, expires_at').single(),
-    );
+    const moved = await admin
+      .from('match_offers')
+      .update({ expires_at: past })
+      .eq('id', offerId)
+      .select('id, expires_at')
+      .single();
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
diff --git a/supabase/functions/coordinator/index.ts b/supabase/functions/coordinator/index.ts
index cd5e876..c765006 100644
--- a/supabase/functions/coordinator/index.ts
+++ b/supabase/functions/coordinator/index.ts
@@ -12,38 +12,71 @@ import { rulesHash } from './rules.bundle.js';
  * only thing here that needs to. It does exactly what SQL cannot: recompute a
  * format's hash with the client's own code. Everything else is a function call.
  */
 Deno.serve(async () => {
   const admin = createClient(
     Deno.env.get('SUPABASE_URL')!,
     Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
   );
 
   let verified = 0;
   for (const table of ['queue_entries', 'match_offers'] as const) {
     const { data, error } = await admin
       .from(table)
       .select('id, claimed_hash, format_versions!inner(rules)')
       .is('verified_hash', null)
       .limit(200);
     if (error) return new Response(error.message, { status: 500 });
 
     for (const row of data ?? []) {
       const r = row as unknown as { id: string; claimed_hash: string; format_versions: { rules: unknown } };
-      const actual = await rulesHash(r.format_versions.rules);
+      let actual: string;
+      try {
+        actual = await rulesHash(r.format_versions.rules);
+      } catch {
+        // `format_versions.rules` is `jsonb not null` with no shape
+        // constraint, and `canonicalize()` dereferences `f.pool.map(...)`,
+        // `f.composition` and `f.selection` unguarded. Anyone can save `{}`
+        // there. Unwrapped, the TypeError rejects this handler — which does
+        // not merely skip the row: the `pair_queue_entries` and
+        // `sweep_expired` calls sit AFTER this loop, so the whole tick dies,
+        // the row keeps `verified_hash null` and is re-read every minute
+        // forever, and one user permanently disables verification, pairing
+        // and expiry for everybody. The catch is the whole point; what to do
+        // inside it is the smaller question.
+        //
+        // DELETE, on the same branch as a wrong hash, rather than skip.
+        // `claimed_hash` asserts a value derived from these rules. If the
+        // rules cannot be canonicalized at all then no client running this
+        // same code could have derived ANY hash from them, so the claim is
+        // not merely wrong, it is unverifiable by construction — the same
+        // consequence as a lie, reached by a different route, and the row can
+        // never become eligible however many ticks it sees.
+        //
+        // Skipping is the tempting answer and it is the one that rots. A
+        // skipped queue entry does expire out within ten minutes, but a
+        // skipped OFFER does not: `sweep_expired` moves it to 'lapsed' and
+        // leaves the row, and this query filters on `verified_hash is null`
+        // with no state filter, so every unhashable offer ever posted stays
+        // in the candidate set permanently and eventually fills the 200-row
+        // window — starving every honest row behind it. That is the same
+        // denial this catch exists to prevent, arriving more slowly.
+        await admin.from(table).delete().eq('id', r.id);
+        continue;
+      }
       if (actual !== r.claimed_hash) {
         // The claim was wrong. Drop the entry rather than correcting it: a
         // client that computed a different hash disagrees with the server about
         // what its own format IS, and silently requeueing it under the real
         // hash would put someone into a match on terms they did not compute.
         await admin.from(table).delete().eq('id', r.id);
         continue;
       }
       await admin.from(table).update({ verified_hash: actual }).eq('id', r.id);
       verified++;
     }
   }
 
   const { data: paired } = await admin.rpc('pair_queue_entries');
   const { data: swept } = await admin.rpc('sweep_expired');
   return Response.json({ verified, paired, swept });
 });
diff --git a/supabase/migrations/20260904071716_handshake_columns_are_server_only.sql b/supabase/migrations/20260904071716_handshake_columns_are_server_only.sql
new file mode 100644
index 0000000..c079f59
--- /dev/null
+++ b/supabase/migrations/20260904071716_handshake_columns_are_server_only.sql
@@ -0,0 +1,140 @@
+-- The trust boundary was opt-in. Two Criticals, both measured against this
+-- database before this migration was written, both closed here.
+--
+-- ROOT CAUSE, shared by both. Supabase grants every table privilege to `anon`
+-- and `authenticated` at creation time, and RLS narrows those grants by ROW,
+-- never by COLUMN. Both owner policies read
+--
+--     for all ... using (auth.uid() = user_id) with check (auth.uid() = user_id)
+--
+-- which says "this row must be yours" and says NOTHING about which columns you
+-- may write in it. So every column of a row you own — including the ones the
+-- coordinator and the two SECURITY DEFINER functions are the sole intended
+-- authors of — was client-writable.
+--
+-- C1, measured: a plain authenticated user ran
+--
+--   insert into public.queue_entries
+--     (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
+--   values ('great', '<own version>', 'I-NEVER-COMPUTED-THIS',
+--           'forged-verified-hash', '[]'::jsonb, 'rev1');
+--
+-- and it returned INSERT 0 1. The coordinator reads only rows where
+-- `verified_hash is null`, so a self-verified row is never examined, never
+-- recomputed, and pairs on the next tick. That falsifies the comment this
+-- codebase wrote on the column ("A client that lies lands in no queue rather
+-- than in a stranger's") and the whole claim that recomputation is the one
+-- place a client's claim about its own format is checked by something the
+-- client does not control. Verification was, until now, something a client
+-- could decline.
+--
+-- C2, measured: a proposer forges a match against ANY user and harvests their
+-- friend code. Four steps, every one of which succeeded:
+--   1. create their own offer (legitimate);
+--   2. UPDATE that row setting accepted_by = <a victim who never saw it>,
+--      accepted_team = '[]'::jsonb, accepted_at = now(), state = 'accepted' —
+--      reported UPDATE 1, and both CHECK constraints pass, because
+--      match_offers_not_self only forbids accepting your OWN offer and
+--      match_offers_accepted_needs_team is satisfied by the empty roster;
+--   3. select public.confirm_offer(<offer>) — returns a real match id with
+--      player_b = <victim>, because confirm_offer trusts state = 'accepted'
+--      and accepted_by as things only accept_offer could have written;
+--   4. select the victim's friend code — returned, because "an opponent may
+--      read your friend code while you have a match" is now true.
+-- Victims are enumerable: `profiles` is readable by anyone signed in. And the
+-- victim cannot undo it: `matches` has no UPDATE and no DELETE policy for
+-- clients, and nothing in M2a sets state = 'abandoned'.
+--
+-- THE FIX, in three parts.
+
+-- 1. Clients need INSERT (join a queue, post an offer) and DELETE (leave,
+-- withdraw). They never need UPDATE. Every legitimate mutation of an existing
+-- row here is made by something that is not the client: the coordinator writes
+-- `verified_hash` as `service_role`, and accept_offer/confirm_offer/
+-- sweep_expired write the handshake columns as SECURITY DEFINER functions
+-- owned by `postgres`. Removing the privilege is what makes that sentence
+-- true, rather than merely intended.
+--
+-- This is the part that closes C2 outright: step 2 of the chain is an UPDATE,
+-- and it is now refused with `42501 permission denied for table match_offers`
+-- — a raised error, not a silently-filtered zero-row statement.
+revoke update on public.queue_entries from anon, authenticated;
+revoke update on public.match_offers from anon, authenticated;
+
+-- 1b. TRUNCATE, found while measuring the above and in the same family: the
+-- default grant included it, and TRUNCATE does not consult row-level security
+-- at all. `truncate public.queue_entries` as a plain authenticated user
+-- returned TRUNCATE TABLE — one client emptying every user's queue, every
+-- open offer, and (cascading through the match_offers FK) every match. There
+-- is no legitimate client truncate of anything, ever.
+--
+-- Scoped to the three M2a tables because they are what this milestone owns.
+-- The same default grant is on every other table in `public` and revoking it
+-- there is a separate migration and a separate decision, recorded rather than
+-- silently half-done.
+revoke truncate on public.queue_entries, public.match_offers, public.matches
+  from anon, authenticated;
+
+-- 2. Narrow what a client may INSERT. The revoke above stops a row being
+-- edited into a privileged state after the fact; this stops one being CREATED
+-- in it — which is exactly C1, an INSERT that arrives already verified.
+--
+-- WITH CHECK is the only tool that can say this, and it can only say it about
+-- the row as a whole, which is why every server-owned column has to be named
+-- as "must still be null" rather than "you may not write it". The effect is
+-- the same: the only value a client may supply for any of them is the value
+-- they would have had anyway.
+--
+-- The policies stay `for all` and keep their names. USING is unchanged, so
+-- SELECT and DELETE behave exactly as before and every existing test of them
+-- still describes the truth. WITH CHECK now also guards UPDATE — dead today
+-- because the privilege is gone, and deliberately kept as the second line: if
+-- some future migration re-grants UPDATE, forging an acceptance is refused by
+-- the policy rather than becoming possible again by omission.
+drop policy "a queue entry is its owner's" on public.queue_entries;
+create policy "a queue entry is its owner's"
+  on public.queue_entries for all
+  to authenticated
+  using ((select auth.uid()) = user_id)
+  with check (
+    (select auth.uid()) = user_id
+    -- The trust boundary, stated where it is enforceable. `verified_hash` is
+    -- the coordinator's answer to `claimed_hash`; a client supplying it is a
+    -- client marking its own homework.
+    and verified_hash is null
+  );
+
+drop policy "an offer belongs to the person who proposed it" on public.match_offers;
+create policy "an offer belongs to the person who proposed it"
+  on public.match_offers for all
+  to authenticated
+  using ((select auth.uid()) = proposer_id)
+  with check (
+    (select auth.uid()) = proposer_id
+    and verified_hash is null
+    -- The whole handshake, in the state a brand new offer has. accept_offer()
+    -- writes the first four; confirm_offer() writes the last two and moves
+    -- state; sweep_expired() moves state. A client posting an offer has
+    -- nothing to say about any of it.
+    and accepted_by is null
+    and accepted_team is null
+    and accepted_at is null
+    and confirmed_at is null
+    and match_id is null
+    and state = 'open'
+  );
+
+-- 3. What this does NOT touch, checked rather than assumed:
+--
+--   * `service_role` has rolbypassrls = t on this stack (verified: select
+--     rolname, rolbypassrls from pg_roles). It is not named in either revoke
+--     and keeps its own UPDATE grant, so the coordinator's
+--     `update({verified_hash}).eq('id', ...)` over PostgREST is unaffected by
+--     both halves of this migration — the grant and the policy.
+--   * accept_offer, confirm_offer, pair_queue_entries and sweep_expired are
+--     SECURITY DEFINER, owned by `postgres`, which owns these tables. They
+--     execute with the owner's privileges and bypass RLS on their own tables,
+--     so they too are unaffected — and they are now the ONLY writers of the
+--     columns above, which is what they were always documented to be.
+--   * `postgres` keeps everything; the test suite's fixture connection and
+--     every migration run as that role.
diff --git a/supabase/migrations/20260904071717_accept_offer_agrees_on_the_data_build.sql b/supabase/migrations/20260904071717_accept_offer_agrees_on_the_data_build.sql
new file mode 100644
index 0000000..c304bf3
--- /dev/null
+++ b/supabase/migrations/20260904071717_accept_offer_agrees_on_the_data_build.sql
@@ -0,0 +1,98 @@
+-- The offer path never compared `data_rev`; the queue path refuses to pair
+-- across builds and says why.
+--
+-- pair_queue_entries() will not pair two entries whose `data_rev` differs, and
+-- the comment there gives the reason: "a random draw both sides compute must
+-- deal from the same pool; two clients on different data would agree on the
+-- rules and disagree on what satisfies them". accept_offer() never received
+-- the taker's `data_rev` and never compared it, so `matches.data_rev` was the
+-- PROPOSER's build alone and the taker was silently entered into a match whose
+-- draw they cannot reproduce.
+--
+-- The offer path is where this matters MOST, not least. A queue entry lives
+-- ten minutes; a scheduled offer is explicitly for later. The spec's own
+-- example is this exact case — "a random-draw match agreed on Tuesday and
+-- played on Friday must deal the same six" — and Tuesday-to-Friday is
+-- precisely the interval a data release lands in.
+--
+-- Done now rather than in M2b because it is a signature change. Today it costs
+-- one argument and a call site; after the branch ships it is a migration under
+-- live data, against rows already written on the wrong premise.
+--
+-- The 2-argument form is DROPPED rather than left beside this one as an
+-- overload. Keeping it would leave the unchecked path reachable by any client
+-- that simply omits the new argument — the same shape of defect as the one
+-- being fixed.
+drop function public.accept_offer(uuid, jsonb);
+
+create function public.accept_offer(p_offer uuid, p_team jsonb, p_data_rev text) returns uuid
+language plpgsql security definer set search_path = public as $$
+declare
+  o public.match_offers;
+  taker uuid := (select auth.uid());
+  new_match uuid;
+begin
+  if taker is null then raise exception 'you must be signed in to accept an offer'; end if;
+  if p_team is null then raise exception 'you must supply the team you are accepting with'; end if;
+  if p_data_rev is null then raise exception 'you must supply the data build you are accepting on'; end if;
+  -- Plain FOR UPDATE, not SKIP LOCKED: a second accept must WAIT and then be
+  -- told the offer is taken. Skipping would tell them "no such offer", a
+  -- different and misleading answer.
+  select * into o from public.match_offers where id = p_offer for update;
+  if not found then raise exception 'no such offer'; end if;
+  if o.state <> 'open' then raise exception 'this offer is no longer open'; end if;
+  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
+  if o.proposer_id = taker then raise exception 'you cannot accept your own offer'; end if;
+  if o.verified_hash is null then raise exception 'this offer has not been verified yet'; end if;
+  if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;
+  -- Last among the checks, deliberately. Every check above is about the offer
+  -- and is the same answer for everyone; this is the only one that is about
+  -- the ACCEPTER, so someone on a stale build is told the offer was fine and
+  -- they are not, rather than being told the offer is unavailable.
+  --
+  -- `is distinct from`, not `<>`: a null on either side must REFUSE, and `<>`
+  -- against a null evaluates to null, which an `if` treats as false and falls
+  -- straight through into creating the match.
+  if p_data_rev is distinct from o.data_rev then
+    raise exception 'this offer was made on a different data build than yours';
+  end if;
+
+  if o.scheduled_for is null then
+    -- Live: agreeing is playing. One confirmation is the whole handshake, and
+    -- the taker's own team — not an empty roster — is what they play the
+    -- match on.
+    insert into public.matches
+      (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+    values
+      (o.proposer_id, taker, o.format_version_id, o.verified_hash, o.team, p_team,
+       o.data_rev, gen_random_uuid()::text, 'offer')
+    returning id into new_match;
+    update public.match_offers
+       set state = 'converted', accepted_by = taker, accepted_team = p_team, accepted_at = now(),
+           confirmed_at = now(), match_id = new_match
+     where id = p_offer;
+    return new_match;
+  end if;
+
+  -- Scheduled: one-sided acceptance is not a match. The proposer must confirm
+  -- inside the window or this lapses. The team is captured now, at acceptance
+  -- time, because it is the taker's own write and confirm_offer() runs as the
+  -- proposer, who has no roster of the taker's to supply.
+  --
+  -- Nothing stores the taker's `data_rev`, and nothing needs to: the check
+  -- above has established it EQUALS `o.data_rev`, which the column already
+  -- holds. So confirm_offer() needs no new check either — a taker cannot end
+  -- up confirmed on a build they did not accept on without accepting again.
+  update public.match_offers
+     set state = 'accepted', accepted_by = taker, accepted_team = p_team, accepted_at = now()
+   where id = p_offer;
+  return null;
+end;
+$$;
+
+-- The same grants the 2-argument form carried. `create function` grants
+-- EXECUTE to PUBLIC by default, so without the revoke an unauthenticated
+-- request would reach the "you must be signed in" check inside the body
+-- instead of being refused at the door.
+revoke all on function public.accept_offer(uuid, jsonb, text) from public, anon;
+grant execute on function public.accept_offer(uuid, jsonb, text) to authenticated;
diff --git a/supabase/tests/helpers.ts b/supabase/tests/helpers.ts
index 8e9035e..ca9bbd0 100644
--- a/supabase/tests/helpers.ts
+++ b/supabase/tests/helpers.ts
@@ -6,40 +6,103 @@ import postgres from 'postgres';
  * credentials are the fixed defaults every `supabase start` produces — not a
  * secret, and never a hosted key.
  */
 const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
 
 // A single connection, reused across the whole run. Every query below runs
 // inside its own transaction so `set local` never leaks between calls.
 const client = postgres(CONNECTION_STRING, { max: 1 });
 
 /**
  * Run a query as the `postgres` superuser — the same role migrations run as.
  * This role owns every table in `public` and therefore bypasses RLS
  * entirely, which is what makes it useful as the "ground truth" side of a
  * denied-vs-allowed comparison, and for fixture setup that must not be
  * blocked by the very policies under test.
  */
 export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
   return client.unsafe(query) as unknown as Promise<T[]>;
 }
 
+/**
+ * The two ways Postgres REFUSES a write in these suites, which have to be kept
+ * apart. They share SQLSTATE 42501 and are otherwise nothing alike:
+ *
+ *   PRIVILEGE_DENIED — `permission denied for table x`. The role holds no
+ *   grant for the verb, so the statement is rejected before any row is
+ *   considered. This is what `revoke update on ... from authenticated`
+ *   produces.
+ *
+ *   POLICY_DENIED — `new row violates row-level security policy for table
+ *   "x"`. The grant exists and a WITH CHECK clause rejected the row.
+ *
+ * And a third outcome that is not an error at all: an UPDATE or DELETE whose
+ * USING clause excludes the row reports 0 rows affected and raises NOTHING
+ * (Ruling 12). `rejects.toThrow()` on its own cannot tell any of these apart —
+ * and which one applies is precisely what the C1/C2 fix changed — so tests
+ * name the class they mean rather than asserting that something threw.
+ */
+export const PRIVILEGE_DENIED = /permission denied for table (match_offers|queue_entries|matches)/;
+export const POLICY_DENIED = /new row violates row-level security policy/;
+
+/**
+ * Runs `q` and returns the refusal's SQLSTATE and message. Throws if the
+ * statement SUCCEEDED, so a test that meant to observe a denial fails saying
+ * that rather than on a confusing property access afterwards — the failure
+ * mode this milestone hit when `getAttribute(...).toMatch` raised TypeError
+ * instead of asserting.
+ */
+export async function refusal(q: () => Promise<unknown>): Promise<{ code: string; message: string }> {
+  try {
+    await q();
+  } catch (e) {
+    const err = e as { code?: string; message: string };
+    return { code: err.code ?? '(none)', message: err.message };
+  }
+  throw new Error('expected this statement to be refused, and it SUCCEEDED');
+}
+
+/**
+ * Runs `body` in a transaction that ALWAYS rolls back, and always rejects.
+ *
+ * For probing a statement whose success would be destructive to rows this
+ * suite does not own — `truncate`, in practice, which ignores row-level
+ * security entirely and would empty every user's table. The privilege check
+ * runs when the statement executes, so a rolled-back attempt is the same
+ * evidence as a committed one.
+ *
+ * It rejects on BOTH paths on purpose, with different codes, because a plain
+ * rollback would otherwise be indistinguishable from a refusal: a real
+ * database error passes through with its own SQLSTATE, while a body that
+ * SUCCEEDED rejects with `SUCCEEDED_THEN_ROLLED_BACK`, so a test asserting
+ * '42501' fails and names what actually happened.
+ */
+export async function rollingBack(body: (tx: postgres.TransactionSql) => Promise<void>): Promise<never> {
+  await client.begin(async (tx) => {
+    await body(tx);
+    throw Object.assign(new Error('the statement SUCCEEDED; the transaction was rolled back'), {
+      code: 'SUCCEEDED_THEN_ROLLED_BACK',
+    });
+  });
+  throw new Error('unreachable: the transaction above always throws');
+}
+
 type JwtClaims = Record<string, unknown> & { sub: string };
 
 /**
  * Returns a query function whose requests carry the identity PostgREST would
  * attach for a signed-in user: `role = authenticated` plus
  * `request.jwt.claims` holding `claims`. `auth.uid()` and `auth.role()` read
  * exactly this GUC (confirmed against this stack's own `auth.uid()` — see
  * task-3-report.md), so a policy written against `auth.uid()` sees the same
  * thing here as it would from a real request.
  *
  * Each call runs in its own transaction: `set local role` and `set local
  * request.jwt.claims` are transaction-scoped, so impersonation from one call
  * can never leak into the next.
  */
 export function asUser(claims: JwtClaims) {
   return async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
     return client.begin(async (tx) => {
       await tx.unsafe('set local role authenticated');
       // Bound as a query parameter (not string-interpolated) so a claim value
       // containing a quote can't break out of the SQL literal it would
diff --git a/supabase/tests/offers.test.ts b/supabase/tests/offers.test.ts
index 4513958..be5cae1 100644
--- a/supabase/tests/offers.test.ts
+++ b/supabase/tests/offers.test.ts
@@ -1,109 +1,390 @@
 import { randomUUID } from 'node:crypto';
-import { describe, it, expect, beforeAll, afterEach } from 'vitest';
-import { sql, asUser, asAnon } from './helpers';
+import postgres from 'postgres';
+import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
+import { sql, asUser, asAnon, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';
+
+const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
 
 describe('match offer policies', () => {
   const proposer = randomUUID();
   const taker = randomUUID();
   let versionId = '';
 
+  // `set local role` is transaction-scoped and `sql()` gives no transaction,
+  // so role-scoped queries need their own connection. Same shape as
+  // pairing.test.ts's, which is the precedent this copies.
+  const alt = postgres(CONNECTION_STRING, { max: 1 });
+  const asRole =
+    (role: string) =>
+    async <T = Record<string, unknown>>(query: string): Promise<T[]> =>
+      alt.begin(async (tx) => {
+        await tx.unsafe(`set local role ${role}`);
+        return tx.unsafe(query) as unknown as Promise<T[]>;
+      }) as unknown as Promise<T[]>;
+
   async function makeUser(id: string, name: string) {
     await sql(
       `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
        values ('${id}', '${id}@example.com', now(),
          '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
     );
   }
 
   beforeAll(async () => {
     await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
     await makeUser(taker, `OT_${taker.slice(0, 8)}`);
     const [f] = await sql<{ id: string }>(
       `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
     const [v] = await sql<{ id: string }>(
       `insert into public.format_versions (format_id, version, rules, rules_hash)
        values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
     versionId = v.id;
   });
 
   afterEach(async () => {
     await sql(`delete from public.matches where player_a in ('${proposer}','${taker}') or player_b in ('${proposer}','${taker}')`);
     await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
     await sql(`delete from public.friend_codes where profile_id in ('${proposer}','${taker}')`);
   });
 
+  afterAll(async () => {
+    await alt.end();
+  });
+
   const offer = (visibility: string, scheduled = 'null') =>
     asUser({ sub: proposer })<{ id: string }>(
       `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
        values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`,
     );
 
   it('shows a public offer to any signed-in stranger', async () => {
     const [o] = await offer('public');
     expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
   });
 
   it('hides a public offer from someone not signed in, though the row exists and is visible to its proposer', async () => {
     const [o] = await offer('public');
     expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
     // Prove the emptiness above is the anon policy at work, not an absent row:
     // the superuser connection (bypasses RLS) and the proposer (via their own
     // policy) both still see it.
     expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
     expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
   });
 
   it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
     const [o] = await offer('unlisted');
     expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
     expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
   });
 
   it('refuses an offer proposed on someone else\'s behalf', async () => {
     await expect(
       asUser({ sub: taker })(
         `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
          values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
     ).rejects.toThrow(/row-level security/);
   });
 
   /**
-   * A taker may accept. A taker may NOT rewrite the terms they are accepting.
+   * Nobody signed in may rewrite an offer's terms — not the taker, and (this
+   * is what changed) not the proposer either.
+   *
+   * THIS TEST USED TO ASSERT THE HOLE. Its third leg read "Same row, same
+   * column, different actor: the proposer can", and a proposer's successful
+   * UPDATE was offered as proof that the taker's 0 rows meant denial rather
+   * than a table nobody could write. The capability it certified as healthy
+   * was step 2 of the measured C2 chain: the proposer used exactly it to set
+   * `accepted_by` to a victim who had never seen the offer, called
+   * confirm_offer(), and read the victim's friend code out of the match that
+   * produced. The leg was sound as an argument and the thing it proved
+   * present was the exploit.
    *
-   * There is no update policy that admits the taker at all (see the migration
-   * comment), so the row fails the USING clause before WITH CHECK is ever
-   * consulted. Postgres does not raise an error for that case — an UPDATE
-   * whose WHERE/USING excludes every row simply reports 0 rows affected, the
-   * same as `UPDATE ... WHERE id = <nothing>`. So the proof here isn't a
-   * thrown exception; it's that the write touched nothing (0 rows, RETURNING
-   * empty) while the superuser connection shows the row still holds its
-   * original terms.
+   * The class of refusal has changed with it, and that is the point of the
+   * assertions below. Before: no UPDATE policy admitted the taker, so the row
+   * failed the USING clause, and an UPDATE whose USING excludes every row
+   * reports 0 rows and raises nothing. Now `authenticated` holds no UPDATE
+   * grant on this table at all, so the statement is refused before a row is
+   * looked at — a RAISED `42501 permission denied for table match_offers`.
    *
-   * That alone can't tell "the taker was denied" apart from "nobody can
-   * update this table" — a typo in the proposer's own policy would leave the
-   * taker's update at 0 rows too, for the wrong reason. The third leg closes
-   * that gap: the proposer, on the very same row and column, succeeds.
+   * Three legs still, re-aimed at what is now true:
+   *  (a) the taker is refused, and by PRIVILEGE — not silently filtered;
+   *  (b) the proposer, same row and same column, is refused identically —
+   *      the leg that used to succeed;
+   *  (c) the row is provably unchanged, read past RLS by the superuser.
+   * Leg (d) below then proves the suite can still SEE the silent kind, so
+   * (a) and (b) are not "any refusal at all".
    */
-  it('refuses a taker editing the offer\'s terms', async () => {
+  it('refuses a taker editing the offer\'s terms — and the proposer too, by privilege', async () => {
     const [o] = await offer('public');
-    const written = await asUser({ sub: taker })<{ id: string }>(
-      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
+
+    const takerRefusal = await refusal(() =>
+      asUser({ sub: taker })(`update public.match_offers set league = 'master' where id = '${o.id}' returning id`),
+    );
+    expect(takerRefusal.code).toBe('42501');
+    expect(takerRefusal.message).toMatch(PRIVILEGE_DENIED);
+    // Not the silent kind, and not the WITH CHECK kind. Named explicitly so a
+    // future migration that re-grants UPDATE and leans on the policy instead
+    // fails here rather than passing under a looser regex.
+    expect(takerRefusal.message).not.toMatch(POLICY_DENIED);
+
+    const proposerRefusal = await refusal(() =>
+      asUser({ sub: proposer })(`update public.match_offers set league = 'master' where id = '${o.id}' returning id`),
     );
-    expect(written).toHaveLength(0);
+    expect(proposerRefusal.code).toBe('42501');
+    expect(proposerRefusal.message).toMatch(PRIVILEGE_DENIED);
+
     expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
       { league: 'great' },
     ]);
-    // Same row, same column, different actor: the proposer can.
-    const proposerWrite = await asUser({ sub: proposer })<{ id: string }>(
-      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
+  });
+
+  /**
+   * Leg (d) of the test above, kept separate because it is a claim about the
+   * HARNESS rather than about offers: this suite can still observe the silent
+   * refusal, so the raised errors above are a specific finding and not the
+   * only thing it is capable of noticing.
+   *
+   * DELETE is the verb clients still hold on this table (withdrawing your own
+   * offer), so its USING clause is live. A stranger's DELETE is filtered to 0
+   * rows with no error; the proposer's, on the very same row, removes it.
+   * That is the old test's three-leg shape intact — moved to the verb where
+   * "a different actor can" is still a property worth having.
+   */
+  it('filters a stranger\'s DELETE to nothing without raising, while the proposer\'s removes the row', async () => {
+    const [o] = await offer('public');
+    const strangerDelete = await asUser({ sub: taker })<{ id: string }>(
+      `delete from public.match_offers where id = '${o.id}' returning id`,
     );
-    expect(proposerWrite).toHaveLength(1);
-    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
-      { league: 'master' },
-    ]);
+    expect(strangerDelete).toHaveLength(0);
+    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+
+    const proposerDelete = await asUser({ sub: proposer })<{ id: string }>(
+      `delete from public.match_offers where id = '${o.id}' returning id`,
+    );
+    expect(proposerDelete).toHaveLength(1);
+    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
   });
 
   it('refuses a scheduled offer in the past', async () => {
     await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
   });
+
+  /**
+   * The insert half of C1/C2, which no test in this suite ever had.
+   *
+   * Revoking UPDATE stops a row being EDITED into a privileged state. It does
+   * nothing about one that ARRIVES in it, and the measured C1 was exactly
+   * that: an INSERT carrying its own `verified_hash`. The old owner policy's
+   * WITH CHECK said only `auth.uid() = proposer_id` — "this row must be
+   * yours" — and said nothing at all about which columns you might fill in
+   * while making it yours.
+   *
+   * One case per server-owned column, rather than one insert setting them all,
+   * because a single combined row would still be refused if the policy named
+   * only one of them and dropped the rest. Each row below is otherwise
+   * completely valid: it differs from the offer the good path creates in that
+   * one column and nothing else, so the refusal has one available cause.
+   */
+  const proposerInsert = (extraCols: string, extraVals: string) =>
+    asUser({ sub: proposer })<{ id: string }>(
+      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility${extraCols})
+       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public'${extraVals}) returning id`,
+    );
+
+  it('accepts the honest offer the cases below are each one column away from', async () => {
+    // The control. Without it, every refusal below could be the shared part of
+    // the statement failing for a reason that has nothing to do with the
+    // column under test.
+    expect(await proposerInsert('', '')).toHaveLength(1);
+  });
+
+  const forgedAtInsert: Array<[string, string, string]> = [
+    // The coordinator's answer to claimed_hash. C1 itself.
+    ['verified_hash', ', verified_hash', `, 'forged-verified-hash'`],
+    // accept_offer()'s three writes. `accepted_by` is the forge at the heart
+    // of C2 — see the test after this one for the second line behind it.
+    ['accepted_by', ', accepted_by', `, '${taker}'`],
+    ['accepted_team', ', accepted_team', `, '[]'::jsonb`],
+    ['accepted_at', ', accepted_at', ', now()'],
+    // confirm_offer()'s two.
+    ['confirmed_at', ', confirmed_at', ', now()'],
+    // Every state but 'open' is somewhere only a function may move a row to.
+    ['state', ', state', `, 'accepted'`],
+    ['state', ', state', `, 'converted'`],
+    ['state', ', state', `, 'confirmed'`],
+    ['state', ', state', `, 'lapsed'`],
+  ];
+
+  it.each(forgedAtInsert)('refuses an offer that arrives with %s already set', async (_col, cols, vals) => {
+    const denied = await refusal(() => proposerInsert(cols, vals));
+    // The POLICY class specifically. A CHECK constraint (23514) or an FK
+    // (23503) refusing first would look like a pass and prove nothing about
+    // the policy, which is what this test is for.
+    expect(denied.code).toBe('42501');
+    expect(denied.message).toMatch(POLICY_DENIED);
+  });
+
+  /**
+   * `accepted_by` twice over, because it is the column C2 forged and the one
+   * case above whose refusal could be the right answer for the wrong reason.
+   *
+   * `match_offers_accepted_needs_team` is `accepted_by is null or
+   * accepted_team is not null`, so a row setting `accepted_by` alone is
+   * ALSO refusable by that CHECK — and a test that only asserted "it threw"
+   * would pass identically if the policy said nothing about the column.
+   *
+   * Measured ordering, not assumed: RLS's WITH CHECK is evaluated BEFORE the
+   * table's CHECK constraints, so the policy answers first with 42501 and the
+   * constraint is never reached. Both are asserted, on the same row, from the
+   * two sides of RLS:
+   *   - as the proposer, the POLICY refuses (42501);
+   *   - as the superuser, past RLS entirely, the CONSTRAINT refuses (23514).
+   * That second assertion is what makes the first one discriminating: drop
+   * the `accepted_by is null` conjunct from the policy and this row stops
+   * being refused at 42501 and starts being refused at 23514, so the code
+   * assertion fails rather than the test staying green on a different denial.
+   *
+   * The pair together is C2's own shape — the forged acceptance carried an
+   * empty roster precisely to satisfy that constraint — and is refused by the
+   * policy with the constraint satisfied, so nothing here rests on it.
+   */
+  it('refuses an offer that arrives already accepted, and the constraint stands behind the policy', async () => {
+    const byPolicy = await refusal(() => proposerInsert(', accepted_by', `, '${taker}'`));
+    expect(byPolicy.code).toBe('42501');
+    expect(byPolicy.message).toMatch(POLICY_DENIED);
+
+    const byConstraint = await refusal(() =>
+      sql(`insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility, accepted_by)
+           values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public', '${taker}')`),
+    );
+    expect(byConstraint.code).toBe('23514');
+    expect(byConstraint.message).toMatch(/match_offers_accepted_needs_team/);
+
+    // The constraint satisfied, so only the policy can be refusing this one.
+    const paired = await refusal(() =>
+      proposerInsert(', accepted_by, accepted_team', `, '${taker}', '[]'::jsonb`),
+    );
+    expect(paired.code).toBe('42501');
+    expect(paired.message).toMatch(POLICY_DENIED);
+  });
+
+  /**
+   * `match_id` needs a real match to point at, or the FK refuses before the
+   * policy does and the test proves nothing — the same trap as `accepted_by`
+   * above, avoidable here because a match can simply be created.
+   */
+  it('refuses an offer that arrives already pointing at a match', async () => {
+    const [m] = await sql<{ id: string }>(
+      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+       values ('${proposer}','${taker}','${versionId}','bb','[]'::jsonb,'[]'::jsonb,'rev1','seed-forge','offer') returning id`,
+    );
+    const denied = await refusal(() => proposerInsert(', match_id', `, '${m.id}'`));
+    expect(denied.code).toBe('42501');
+    expect(denied.message).toMatch(POLICY_DENIED);
+  });
+
+  /**
+   * C2, END TO END, as the attacker actually ran it against this database.
+   *
+   * The individual refusals above each say a step is closed. This says the
+   * CHAIN is, which is a different claim and the one that matters: the report
+   * that opened this fix measured four steps, and a fix that closed three of
+   * them would still hand over the friend code.
+   *
+   * Every step is asserted at its own outcome, and the last two are asserted
+   * on the ATTACKER'S OWN READS rather than on the superuser's — what the
+   * victim's privacy means is what the attacker can see, not what is true
+   * behind RLS.
+   */
+  it('breaks the whole C2 chain: no forged acceptance, no match, no friend code', async () => {
+    await sql(`insert into public.friend_codes (profile_id, code) values ('${taker}', '1111 2222 3333')
+               on conflict (profile_id) do update set code = excluded.code`);
+
+    // Step 1 as the attacker ran it — an offer arriving already verified — is
+    // refused outright. `confirm_offer` copies verified_hash into
+    // matches.rules_hash, which is NOT NULL, so C1 was not merely alongside
+    // C2: it was the step that made the forged match insertable at all.
+    const selfVerified = await refusal(() =>
+      proposerInsert(', verified_hash', `, 'forged-verified-hash'`),
+    );
+    expect(selfVerified.message).toMatch(POLICY_DENIED);
+
+    // Give the attacker the strongest position the fix still permits: an
+    // honest offer, verified by the coordinator rather than by themselves.
+    // Planting it with the superuser concedes step 1 entirely, so the rest of
+    // the chain is tested on its own merits rather than passing because the
+    // first step happened to fail.
+    const [o] = await sql<{ id: string }>(
+      `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility, scheduled_for)
+       values ('${proposer}', '${versionId}', 'bb', 'bb', 'great', '[]'::jsonb, 'rev1', 'public', now() + interval '2 days') returning id`,
+    );
+
+    // Step 2: the forge. This is the UPDATE the old third leg certified.
+    const forge = await refusal(() =>
+      asUser({ sub: proposer })(
+        `update public.match_offers
+            set accepted_by = '${taker}', accepted_team = '[]'::jsonb, accepted_at = now(), state = 'accepted'
+          where id = '${o.id}' returning id`,
+      ),
+    );
+    expect(forge.code).toBe('42501');
+    expect(forge.message).toMatch(PRIVILEGE_DENIED);
+
+    // The row did not move, read past RLS.
+    expect(
+      await sql<{ state: string; accepted_by: string | null }>(
+        `select state, accepted_by from public.match_offers where id = '${o.id}'`,
+      ),
+    ).toEqual([{ state: 'open', accepted_by: null }]);
+
+    // Step 3: confirm_offer cannot produce a match, and says why in its own
+    // words rather than raising something raw.
+    const confirmed = await refusal(() => asUser({ sub: proposer })(`select public.confirm_offer('${o.id}')`));
+    expect(confirmed.message).toMatch(/this offer has not been accepted yet/);
+    expect(await sql(`select id from public.matches where player_b = '${taker}'`)).toHaveLength(0);
+
+    // Step 4: the payload. Asserted as the attacker sees it.
+    expect(
+      await asUser({ sub: proposer })(`select code from public.friend_codes where profile_id = '${taker}'`),
+    ).toHaveLength(0);
+
+    // And the friend code is genuinely there to be leaked — otherwise the
+    // zero above is a missing row, not a working policy.
+    expect(await sql(`select code from public.friend_codes where profile_id = '${taker}'`)).toHaveLength(1);
+  });
+
+  /**
+   * The other half of the revoke, and the one that would break the product
+   * rather than a test: the coordinator writes `verified_hash` over PostgREST
+   * as `service_role`, and if that grant had gone with the others then
+   * nothing would ever be verified, nothing would ever pair, and both gates
+   * would stay green while the feature shipped dead.
+   *
+   * Exercised for real through `set local role service_role` on this file's
+   * own connection — the same mechanism pairing.test.ts uses to prove the
+   * coordinator functions are callable. Not a claim inferred from the
+   * migration text.
+   */
+  it('still lets service_role write verified_hash, which is the coordinator\'s whole job', async () => {
+    const [o] = await offer('public');
+    expect(
+      await asRole('service_role')<{ verified_hash: string }>(
+        `update public.match_offers set verified_hash = 'bb' where id = '${o.id}' returning verified_hash`,
+      ),
+    ).toEqual([{ verified_hash: 'bb' }]);
+
+    // And the same statement from the client roles the revoke named.
+    for (const role of ['authenticated', 'anon']) {
+      const denied = await refusal(() =>
+        asRole(role)(`update public.match_offers set verified_hash = 'zz' where id = '${o.id}'`),
+      );
+      expect(denied.code).toBe('42501');
+      expect(denied.message).toMatch(PRIVILEGE_DENIED);
+    }
+    // Unchanged by the two refusals, not merely unreported.
+    expect(
+      await sql<{ verified_hash: string }>(`select verified_hash from public.match_offers where id = '${o.id}'`),
+    ).toEqual([{ verified_hash: 'bb' }]);
+  });
 });
diff --git a/supabase/tests/pairing.test.ts b/supabase/tests/pairing.test.ts
index 7765931..0292b81 100644
--- a/supabase/tests/pairing.test.ts
+++ b/supabase/tests/pairing.test.ts
@@ -239,267 +239,321 @@ describe('pairing', () => {
       Number((r1[0] as { pair_queue_entries: number }).pair_queue_entries) +
       Number((r2[0] as { pair_queue_entries: number }).pair_queue_entries);
 
     const matches = await sql(`select id from public.matches where ${mine()}`);
     const left = await sql(`select id from public.queue_entries where ${myEntries()}`);
     // What was reported is what was written — a tick that returns 1 while
     // another already consumed the rows is the duplicate bug reporting itself.
     expect(matches).toHaveLength(reported);
     expect(matches.length).toBeLessThanOrEqual(1);
     if (matches.length === 1) {
       expect(left).toHaveLength(0);
     } else {
       // Nothing was consumed, and the next tick still pairs them.
       expect(left).toHaveLength(2);
       expect(await pair()).toBe(1);
     }
   });
 
   it('records the taker\'s own team as team_b, not an empty roster', async () => {
     const o = await offer();
-    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`);
     expect(
       await sql<{ team_a: unknown; team_b: unknown; source: string }>(
         `select team_a, team_b, source from public.matches where ${mine()}`,
       ),
     ).toEqual([{ team_a: ['A'], team_b: ['B'], source: 'offer' }]);
     expect(
       await sql<{ state: string; accepted_team: unknown }>(
         `select state, accepted_team from public.match_offers where id = '${o.id}'`,
       ),
     ).toEqual([{ state: 'converted', accepted_team: ['B'] }]);
   });
 
+  /**
+   * The offer path's `data_rev` check (I1). `pair_queue_entries` has refused
+   * to pair across data builds since Task 5 and says why — a random draw both
+   * sides compute must deal from the same pool — but `accept_offer` never
+   * received the taker's build and never compared it, so `matches.data_rev`
+   * was the PROPOSER's alone and the taker was entered into a match whose draw
+   * they cannot reproduce.
+   *
+   * Nothing else in this file can fail this way: every other test here uses
+   * one build, so dropping the check would leave them all green — the same
+   * argument the queue-side version of this test makes.
+   */
+  it('refuses an accept from a client on a different data build', async () => {
+    const o = await offer();
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev2')`)).rejects.toThrow(
+      /different data build/,
+    );
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+    // The offer is untouched and still acceptable by someone on the right
+    // build — a refusal, not a consumption.
+    expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([
+      { state: 'open' },
+    ]);
+  });
+
+  /**
+   * `is distinct from`, not `<>`. A null build on either side must REFUSE, and
+   * `<>` against a null evaluates to null, which `if` treats as false and
+   * falls straight through into creating the match. The explicit null guard at
+   * the top of the function is what this actually reaches, and both are
+   * asserted so swapping the operator cannot pass on the guard alone.
+   */
+  it('refuses an accept that names no data build at all', async () => {
+    const o = await offer();
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, null)`)).rejects.toThrow(
+      /data build you are accepting on/,
+    );
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
+
+  /**
+   * The 2-argument form is DROPPED, not left beside the new one as an
+   * overload — otherwise the unchecked path stays reachable by any client that
+   * simply omits the argument, which is the same shape of defect as the one
+   * being fixed. Postgres resolves overloads by arity, so this is the only way
+   * to observe that decision holding.
+   */
+  it('no longer offers a 2-argument accept_offer that would skip the check', async () => {
+    const o = await offer();
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+      /function public\.accept_offer\(unknown, jsonb\) does not exist/,
+    );
+  });
+
   /**
    * The race. Two independent connections accept the same offer at the same
    * moment. One must win and one must be told no — and crucially there must be
    * exactly ONE match, not two. Counting rejections is not enough: a rejection
    * for the wrong reason counts the same, which is how a false pass gets
    * recorded, so the refusal's message is asserted too.
    */
   it('lets only one of two simultaneous accepts through', { timeout: 20000 }, async () => {
     const o = await offer();
     const [c1, c2] = [conn(), conn()];
     const accept = (client: ReturnType<typeof conn>, who: string, team: string) =>
       client.begin(async (tx) => {
         await tx.unsafe('set local role authenticated');
         await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
-        return tx.unsafe(`select public.accept_offer('${o.id}', '${team}'::jsonb)`);
+        return tx.unsafe(`select public.accept_offer('${o.id}', '${team}'::jsonb, 'rev1')`);
       });
     const results = await Promise.allSettled([accept(c1, b, '["B"]'), accept(c2, c, '["C"]')]);
     await Promise.all([c1.end(), c2.end()]);
 
     expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
     const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
     expect(String(refused.reason?.message)).toMatch(/no longer open/);
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
   });
 
   /**
    * `accept_offer` uses plain `for update`, NOT skip locked, deliberately: a
    * second accept must WAIT and then be told the offer is taken. Skipping
    * would find no row and answer "no such offer" — a different and misleading
    * thing to tell someone whose opponent beat them by a tenth of a second.
    *
    * The race above cannot tell those apart on its own, because a run where the
    * two transactions happen not to overlap produces the same tally. Here the
    * overlap is forced: a third connection holds the offer row, and the accept
    * must still be unfinished half a second later.
    */
   it('makes a second accept wait for the row rather than declaring it missing', { timeout: 20000 }, async () => {
     const o = await offer();
     const lock = await hold(`select id from public.match_offers where id = '${o.id}' for update`);
     const runner = conn();
     // Declared outside the try so the `finally` below can release the lock
     // and then wait for this to unblock, rather than leaving it dangling —
     // otherwise a failed assertion here leaves the row locked forever and
     // `afterEach`'s delete on it wedges every later test in this file, which
     // is exactly the failure mode the previous attempt on this task flagged.
     let accepting!: Promise<unknown>;
     try {
       accepting = runner.begin(async (tx) => {
         await tx.unsafe('set local role authenticated');
         await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: b })]);
-        return tx.unsafe(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+        return tx.unsafe(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`);
       });
       const early = await Promise.race([
         accepting.then(() => 'settled').catch((e: Error) => `failed: ${e.message}`),
         new Promise<string>((r) => setTimeout(() => r('still waiting'), 600)),
       ]);
       expect(early).toBe('still waiting');
     } finally {
       await lock.release();
       await accepting.catch(() => {});
       await runner.end();
     }
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(1);
   });
 
   it('holds a scheduled offer until the proposer confirms it too', async () => {
     const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
-    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`);
     // One-sided acceptance is not a match.
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
     expect(
       await sql<{ state: string; accepted_team: unknown }>(
         `select state, accepted_team from public.match_offers where id = '${o.id}'`,
       ),
     ).toEqual([{ state: 'accepted', accepted_team: ['B'] }]);
 
     await asUser({ sub: a })(`select public.confirm_offer('${o.id}')`);
     // The roster the taker accepted with is what the match is played on — the
     // proposer's confirmation does not get to supply it for them.
     expect(
       await sql<{ team_a: unknown; team_b: unknown }>(`select team_a, team_b from public.matches where ${mine()}`),
     ).toEqual([{ team_a: ['A'], team_b: ['B'] }]);
   });
 
   it('lets nobody but the proposer confirm a scheduled offer', async () => {
     const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
-    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`);
+    await asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`);
     await expect(asUser({ sub: c })(`select public.confirm_offer('${o.id}')`)).rejects.toThrow(/only the proposer/);
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
   });
 
   it('refuses to let someone accept their own offer', async () => {
     const o = await offer();
-    await expect(asUser({ sub: a })(`select public.accept_offer('${o.id}', '["A"]'::jsonb)`)).rejects.toThrow(
+    await expect(asUser({ sub: a })(`select public.accept_offer('${o.id}', '["A"]'::jsonb, 'rev1')`)).rejects.toThrow(
       /cannot accept your own offer/,
     );
   });
 
   it('refuses an accept on an offer the coordinator has not verified', async () => {
     const [o] = await sql<{ id: string }>(
       `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
        values ('${a}', '${versionId}', 'cc', 'great', '["A"]'::jsonb, 'rev1', 'public') returning id`,
     );
-    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`)).rejects.toThrow(
       /not been verified/,
     );
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
   });
 
   it('refuses an accept with no team at all', async () => {
     const o = await offer();
-    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', null)`)).rejects.toThrow(
+    await expect(asUser({ sub: b })(`select public.accept_offer('${o.id}', null, 'rev1')`)).rejects.toThrow(
       /team you are accepting with/,
     );
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
   });
 
   it('refuses an accept from a request carrying no identity', async () => {
     const o = await offer();
-    await expect(asRole('authenticated')(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+    await expect(asRole('authenticated')(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`)).rejects.toThrow(
       /signed in/,
     );
   });
 
   it('lapses an unconfirmed offer rather than converting it', async () => {
     const o = await offer(', expires_at', `, now() - interval '1 minute'`);
     await sql(`select public.sweep_expired()`);
     expect(await sql<{ state: string }>(`select state from public.match_offers where id = '${o.id}'`)).toEqual([
       { state: 'lapsed' },
     ]);
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
   });
 
   it('drops a queue entry that waited too long, and leaves a fresh one', async () => {
     await enqueue(a);
     await sql(`update public.queue_entries set expires_at = now() - interval '1 minute' where user_id = '${a}'`);
     await enqueue(b);
     await sql(`select public.sweep_expired()`);
     expect(await sql<{ user_id: string }>(`select user_id from public.queue_entries where ${myEntries()}`)).toEqual([
       { user_id: b },
     ]);
   });
 
   /**
    * The coordinator in Task 6 calls these two over PostgREST as `service_role`.
    * Nothing else in this repo grants that role anything, so if this migration
    * does not, the first tick fails with permission denied.
    */
   it('runs the coordinator functions as service_role and refuses everyone else', async () => {
     await expect(asRole('anon')(`select public.pair_queue_entries()`)).rejects.toThrow(/permission denied/);
     await expect(asRole('authenticated')(`select public.pair_queue_entries()`)).rejects.toThrow(/permission denied/);
     await expect(asRole('anon')(`select public.sweep_expired()`)).rejects.toThrow(/permission denied/);
     await expect(asRole('authenticated')(`select public.sweep_expired()`)).rejects.toThrow(/permission denied/);
     expect(await asRole('service_role')(`select public.pair_queue_entries()`)).toHaveLength(1);
     expect(await asRole('service_role')(`select public.sweep_expired()`)).toHaveLength(1);
   });
 
   it('refuses an accept from a request with no session at all', async () => {
     const o = await offer();
-    await expect(asRole('anon')(`select public.accept_offer('${o.id}', '["B"]'::jsonb)`)).rejects.toThrow(
+    await expect(asRole('anon')(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`)).rejects.toThrow(
       /permission denied/,
     );
   });
 
   /**
    * The invariant Task 4 deferred: `accepted_team` was added with no
    * constraint tying it to `accepted_by`. An `accepted_by` without a team is
    * an acceptance whose roster was lost, and `confirm_offer` would then try to
    * write a null into `matches.team_b`, which is NOT NULL — a failure at
    * confirmation time for a mistake made at acceptance time.
    */
   it('refuses an acceptance recorded without the taker\'s team', async () => {
     const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
     await expect(
       sql(`update public.match_offers set accepted_by = '${b}', accepted_at = now() where id = '${o.id}'`),
     ).rejects.toThrow(/match_offers_accepted_needs_team/);
     // The row is untouched...
     expect(
       await sql<{ accepted_by: string | null }>(`select accepted_by from public.match_offers where id = '${o.id}'`),
     ).toEqual([{ accepted_by: null }]);
     // ...and the same write, with the team it was missing, goes through.
     expect(
       await sql(
         `update public.match_offers set accepted_by = '${b}', accepted_team = '["B"]'::jsonb, accepted_at = now()
          where id = '${o.id}' returning id`,
       ),
     ).toHaveLength(1);
   });
 
   /**
    * The constraint is deliberately one-directional. `accepted_by` is
    * `on delete set null`, so deleting the taker's account nulls it while
    * `accepted_team` stays — a snapshot of a roster with nobody attached. A
    * symmetric "both null or both set" constraint would turn that cascade into
    * an error and make the account undeletable.
    */
   it('still lets the taker delete their account after accepting', async () => {
     const t = randomUUID();
     await makeUser(t, `PT_${t.slice(0, 8)}`);
     const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
-    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
+    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb, 'rev1')`);
     await expect(sql(`delete from auth.users where id = '${t}'`)).resolves.toBeDefined();
     expect(
       await sql<{ accepted_by: string | null; accepted_team: unknown }>(
         `select accepted_by, accepted_team from public.match_offers where id = '${o.id}'`,
       ),
     ).toEqual([{ accepted_by: null, accepted_team: ['T'] }]);
   });
 
   /**
    * The gap the constraint choice above opens: accepted_by can become null
    * on an offer still sitting in 'accepted', because nothing about deleting
    * the taker's account touches `state`. confirm_offer() must recognise that
    * rather than reach the matches INSERT with a null player_b, which would
    * surface as a raw NOT NULL violation instead of a clean domain error.
    */
   it('refuses to confirm an accepted offer whose taker no longer exists', async () => {
     const t = randomUUID();
     await makeUser(t, `PT_${t.slice(0, 8)}`);
     const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
-    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
+    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb, 'rev1')`);
     await sql(`delete from auth.users where id = '${t}'`);
     expect(
       await sql<{ state: string; accepted_by: string | null }>(
         `select state, accepted_by from public.match_offers where id = '${o.id}'`,
       ),
     ).toEqual([{ state: 'accepted', accepted_by: null }]);
 
     await expect(asUser({ sub: a })(`select public.confirm_offer('${o.id}')`)).rejects.toThrow(
       /no longer exists/,
     );
     expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
   });
 });
diff --git a/supabase/tests/queue.test.ts b/supabase/tests/queue.test.ts
index df487ef..1a142c4 100644
--- a/supabase/tests/queue.test.ts
+++ b/supabase/tests/queue.test.ts
@@ -1,23 +1,23 @@
 import { randomUUID } from 'node:crypto';
 import { describe, it, expect, beforeAll, afterEach } from 'vitest';
-import { sql, asUser, asAnon } from './helpers';
+import { sql, asUser, asAnon, refusal, rollingBack, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';
 
 describe('queue and match policies', () => {
   const userA = randomUUID();
   const userB = randomUUID();
   let versionId = '';
 
   async function makeUser(id: string, name: string) {
     await sql(
       `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
        values ('${id}', '${id}@example.com', now(),
          '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
     );
   }
 
   beforeAll(async () => {
     await makeUser(userA, `QA_${userA.slice(0, 8)}`);
     await makeUser(userB, `QB_${userB.slice(0, 8)}`);
     const [f] = await sql<{ id: string }>(
       `insert into public.formats (owner_id, name) values ('${userA}', 'Queue Cup') returning id`,
     );
@@ -38,40 +38,126 @@ describe('queue and match policies', () => {
       `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
        values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning id`,
     );
 
   it('lets someone join the queue without naming themselves', async () => {
     const rows = await asUser({ sub: userA })<{ user_id: string }>(
       `insert into public.queue_entries (league, format_version_id, claimed_hash, team, data_rev)
        values ('great', '${versionId}', 'aa', '[]'::jsonb, 'rev1') returning user_id`,
     );
     expect(rows[0].user_id).toBe(userA);
   });
 
   it('refuses a queue entry made on someone else\'s behalf', async () => {
     await expect(
       asUser({ sub: userB })(
         `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, team, data_rev)
          values ('${userA}', 'great', '${versionId}', 'aa', '[]'::jsonb, 'rev1')`),
     ).rejects.toThrow(/row-level security/);
   });
 
+  /**
+   * C1, measured against this database before the fix: a plain authenticated
+   * user inserted a queue entry that already carried its own `verified_hash`
+   * and it returned INSERT 0 1.
+   *
+   * That is the whole trust boundary. `pair_queue_entries` only ever pairs
+   * rows where `verified_hash is not null`, and the coordinator only ever
+   * READS rows where it `is null` — so a self-verified row is never
+   * recomputed, never examined, and pairs on the next tick with whatever
+   * `claimed_hash` its author felt like typing. Verification was, until the
+   * fix, something a client could simply decline.
+   *
+   * The refusal is the POLICY class, named explicitly: the WITH CHECK clause
+   * rejects the row. The insert immediately above this test is the control —
+   * identical in every respect but this column, and it succeeds.
+   */
+  it('refuses a queue entry that arrives already verified', async () => {
+    const denied = await refusal(() =>
+      asUser({ sub: userA })(
+        `insert into public.queue_entries (league, format_version_id, claimed_hash, verified_hash, team, data_rev)
+         values ('great', '${versionId}', 'I-NEVER-COMPUTED-THIS', 'forged-verified-hash', '[]'::jsonb, 'rev1')`),
+    );
+    expect(denied.code).toBe('42501');
+    expect(denied.message).toMatch(POLICY_DENIED);
+    expect(await sql(`select id from public.queue_entries where user_id = '${userA}'`)).toHaveLength(0);
+  });
+
+  /**
+   * The other route to the same column: join honestly, then edit. Both have to
+   * be shut or neither is.
+   *
+   * A DIFFERENT class of refusal from the one above, and the distinction is
+   * the point — `authenticated` holds no UPDATE grant on this table at all, so
+   * this is raised as `permission denied for table queue_entries` before any
+   * row is considered, rather than being silently filtered to 0 rows the way
+   * an excluded USING clause would be.
+   */
+  it('refuses its owner editing verified_hash onto an entry after the fact', async () => {
+    await enqueue(userA);
+    const denied = await refusal(() =>
+      asUser({ sub: userA })(
+        `update public.queue_entries set verified_hash = 'forged-verified-hash' where user_id = '${userA}'`),
+    );
+    expect(denied.code).toBe('42501');
+    expect(denied.message).toMatch(PRIVILEGE_DENIED);
+    expect(denied.message).not.toMatch(POLICY_DENIED);
+    expect(
+      await sql<{ verified_hash: string | null }>(
+        `select verified_hash from public.queue_entries where user_id = '${userA}'`,
+      ),
+    ).toEqual([{ verified_hash: null }]);
+  });
+
+  /**
+   * TRUNCATE, found while measuring the two Criticals and in the same family.
+   * The default grant included it, and TRUNCATE does not consult row-level
+   * security at all — so one signed-in client could empty every user's queue
+   * with a single statement, and RLS would not have been asked.
+   *
+   * Rolled back regardless of outcome: this suite runs against the partner's
+   * real local database, and a test that emptied their queue to prove it
+   * could would be the defect rather than the check for it.
+   */
+  it('refuses a client truncating the whole queue, which RLS would never have seen', async () => {
+    await enqueue(userA);
+    const denied = await refusal(() =>
+      // Wrapped in a transaction that ALWAYS rolls back, so a regression here
+      // reports itself instead of emptying the partner's queue to prove it
+      // could. TRUNCATE is transactional, and the privilege check runs when
+      // the statement executes, so the evidence is identical either way. The
+      // sentinel is what keeps the two apart: without it, "the truncate ran
+      // and we undid it" and "the truncate was refused" both look like a
+      // rejected promise.
+      rollingBack(async (tx) => {
+        await tx.unsafe('set local role authenticated');
+        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userA })]);
+        await tx.unsafe(`truncate public.queue_entries`);
+      }),
+    );
+    expect(denied.code).toBe('42501');
+    expect(denied.message).toMatch(PRIVILEGE_DENIED);
+    // Still there — and since the block above can only have rolled back, this
+    // is the refusal's doing rather than the rollback's.
+    expect(await sql(`select id from public.queue_entries where user_id = '${userA}'`)).toHaveLength(1);
+  });
+
   it('hides a queue entry from everyone but its owner', async () => {
     await enqueue(userA);
     expect(await asUser({ sub: userB })(`select id from public.queue_entries`)).toHaveLength(0);
     expect(await asAnon()(`select id from public.queue_entries`)).toHaveLength(0);
   });
 
   it('allows only one queue entry per person', async () => {
     await enqueue(userA);
     await expect(enqueue(userA)).rejects.toThrow(/queue_entries_one_per_user/);
   });
 
   it('lets a player see a match they are in, and nobody else see it', async () => {
     const [m] = await sql<{ id: string }>(
       `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
        values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-1','queue') returning id`,
     );
     expect(await asUser({ sub: userA })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(1);
     const stranger = randomUUID();
     await makeUser(stranger, `QS_${stranger.slice(0, 8)}`);
     expect(await asUser({ sub: stranger })(`select id from public.matches where id = '${m.id}'`)).toHaveLength(0);
