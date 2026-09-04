# Task 8 fix-round 4 re-review — c7bf63a..HEAD

## Commits
7ee20b7 fix(matchmaking): an expired offer is not acceptable, and dead controls say why

## Files changed
 .../sdd/2026-09-02-m2a-matchmaking/mutate.mjs      | 104 +++++++++
 .../2026-09-02-m2a-matchmaking/task-8-report.md    | 239 +++++++++++++++++++++
 app/src/screens/MatchmakingScreen.tsx              |  59 ++++-
 app/src/screens/__tests__/matchmaking.test.tsx     | 160 ++++++++++++++
 app/src/styles/components.css                      |  25 ++-
 5 files changed, 580 insertions(+), 7 deletions(-)

## Full diff
diff --git a/.superpowers/sdd/2026-09-02-m2a-matchmaking/mutate.mjs b/.superpowers/sdd/2026-09-02-m2a-matchmaking/mutate.mjs
new file mode 100644
index 0000000..5cce03a
--- /dev/null
+++ b/.superpowers/sdd/2026-09-02-m2a-matchmaking/mutate.mjs
@@ -0,0 +1,104 @@
+#!/usr/bin/env node
+/**
+ * Mutation harness for the Task 8 fix rounds.
+ *
+ * Round 2 recorded a mutation that silently landed in a function its test does
+ * not call, and briefly read as "the mutation survived". Round 3's report
+ * claimed a script asserted its anchors; no such script was on disk, so the
+ * claim could not be checked. This is that script, committed.
+ *
+ * It ASSERTS rather than reports:
+ *   - the anchor occurs in the file exactly `count` times (default 1), so a
+ *     mutation cannot land somewhere else and look applied;
+ *   - the line the mutation lands on sits inside `region` — the nearest
+ *     preceding line matching that pattern must be it, which is how "landed in
+ *     `myOffers` instead of `listOpenOffers`" gets caught;
+ *   - the replacement is actually present afterwards.
+ * Then it PRINTS the mutated region back, so the evidence in the report is a
+ * transcript of the file as it stood when the test ran.
+ *
+ *   node mutate.mjs apply <spec.json>     # back up, mutate, verify, print
+ *   node mutate.mjs restore <spec.json>   # restore from the backup, verify
+ *
+ * spec.json: { "file", "find", "replace", "region", "count"? }
+ *   region: a regex matched against whole lines; the nearest such line ABOVE
+ *           the mutation point is asserted to be the enclosing one.
+ */
+import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
+import { resolve } from 'node:path';
+
+const [, , cmd, specPath] = process.argv;
+if (!cmd || !specPath) {
+  console.error('usage: mutate.mjs apply|restore <spec.json>');
+  process.exit(2);
+}
+const spec = JSON.parse(readFileSync(specPath, 'utf8'));
+const file = resolve(spec.file);
+const backup = `${file}.premutation`;
+
+function die(msg) {
+  console.error(`ASSERTION FAILED: ${msg}`);
+  process.exit(1);
+}
+
+function show(src, index, label) {
+  const lines = src.split('\n');
+  let off = 0;
+  let hit = 0;
+  for (let i = 0; i < lines.length; i++) {
+    if (off + lines[i].length >= index) {
+      hit = i;
+      break;
+    }
+    off += lines[i].length + 1;
+  }
+  const from = Math.max(0, hit - 6);
+  const to = Math.min(lines.length, hit + 7);
+  console.log(`--- ${label}: ${spec.file} lines ${from + 1}-${to} ---`);
+  for (let i = from; i < to; i++) {
+    console.log(`${String(i + 1).padStart(4)}${i === hit ? ' >' : '  '}| ${lines[i]}`);
+  }
+  return { lines, hit };
+}
+
+if (cmd === 'apply') {
+  const src = readFileSync(file, 'utf8');
+  const want = spec.count ?? 1;
+  const found = src.split(spec.find).length - 1;
+  if (found !== want) die(`anchor occurs ${found} time(s), expected ${want}\n  anchor: ${spec.find}`);
+  const index = src.indexOf(spec.find);
+
+  // Which region did it land in? The nearest preceding line matching `region`.
+  const before = src.slice(0, index).split('\n');
+  const re = new RegExp(spec.region);
+  let enclosing = null;
+  for (let i = before.length - 1; i >= 0; i--) {
+    if (re.test(before[i])) {
+      enclosing = before[i].trim();
+      break;
+    }
+  }
+  if (enclosing === null) die(`no line matching /${spec.region}/ above the mutation point`);
+  console.log(`anchor found ${found}x; enclosing region: ${enclosing}`);
+
+  copyFileSync(file, backup);
+  const out = src.replace(spec.find, spec.replace);
+  if (out === src) die('replacement produced an identical file');
+  writeFileSync(file, out);
+  const check = readFileSync(file, 'utf8');
+  if (!check.includes(spec.replace)) die('replacement text is not present after writing');
+  show(check, check.indexOf(spec.replace), 'MUTATED');
+  console.log('MUTATION APPLIED');
+} else if (cmd === 'restore') {
+  if (!existsSync(backup)) die(`no backup at ${backup}`);
+  copyFileSync(backup, file);
+  unlinkSync(backup);
+  const src = readFileSync(file, 'utf8');
+  if (!src.includes(spec.find)) die('the original anchor is not back after restore');
+  if (spec.replace && src.includes(spec.replace) && spec.replace !== spec.find) {
+    die('the mutated text is still present after restore');
+  }
+  console.log('RESTORED (anchor present, mutation absent)');
+} else {
+  die(`unknown command ${cmd}`);
+}
diff --git a/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-8-report.md b/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-8-report.md
index fbe70a3..d3a8137 100644
--- a/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-8-report.md
+++ b/.superpowers/sdd/2026-09-02-m2a-matchmaking/task-8-report.md
@@ -660,20 +660,259 @@ All six restored (`diff -q` against the pre-mutation copy) and re-run green.
 ## Also
 
 `.offer-blocked` added to `components.css` (`--text-xs`, italic; no new colour literals), sized
 like the control it replaces so the row does not reflow when the offer verifies a moment later.
 
 ## Concerns
 
 1. **Nothing re-reads the board, so "Being checked" does not clear itself.** A minute later the
    offer is acceptable, but this screen will not know until something else triggers a fetch. The
    copy is written as in-progress rather than as an error, which keeps it honest, but the real
    answer is the polling or realtime subscription noted in round 2's concerns. I did not add one:
    an interval is a behaviour change nobody has asked for, and it belongs with the realtime
    decision rather than in front of it.
 2. **`verifiedHash` is a hash, and the screen only ever tests it for null.** That is the whole of
    what the client may conclude from it — the coordinator is the only party that may compare it to
    anything — but it does mean a non-null hash is trusted as "verified" without the client being
    able to check what it verified. That is the intended trust boundary, not a gap.
 3. The empty-roster guard is unreachable from this client, as its test says. It is defence against
    another client's malformed write, and it will silently do nothing for as long as no such client
    exists.
+
+---
+
+# Task 8 — fix round 4 (the expired offer, and three controls that said nothing)
+
+## Status
+
+Done. `cd app && npm run check > /tmp/task-8-fix4-gate.log 2>&1` → **EXIT=0**, 81 files,
+**1158 passed** (was 1152). Screen suite 36 (was 30). No library change was needed this round.
+
+## Important — an expired offer no longer shows an Accept button
+
+The fourth instance of one defect: a control whose only possible outcome is raw Postgres text.
+
+`accept_offer` raises `'this offer has expired'`
+(`supabase/migrations/20260903005933_pairing_functions.sql:67`) — and raises it *first*, before the
+self-check and before `verified_hash`. `listOpenOffers` filters on `league` and `state = 'open'`
+only. Expiry is a coordinator **sweep**, not a trigger, so the row sits in `state = 'open'` until
+the next tick and is handed back looking exactly like a live one.
+
+This is strictly worse than the `verified_hash` case round 3 fixed, and for the reason round 3's
+own first concern names: nothing on this screen re-reads the board. The unverified window closes
+by itself within a minute whether or not the screen notices. An expired offer never closes — a
+page left open past `expires_at` shows an enabled Accept for as long as the tab stays open.
+
+`Offer.expiresAt` was **already** on the interface and already selected by both `listOpenOffers`
+and `myOffers` (the row is even rendered — "expires …" beside every offer), and
+`lib/__tests__/matchmaking.test.ts` already asserts it through the field-mapping `toEqual`. So
+`matchmaking.ts` is untouched: the whole fix is one line in `unacceptableReason`, the abstraction
+round 3 built for it.
+
+```ts
+if (Date.parse(o.expiresAt) <= Date.now()) return 'Expired — nobody can accept it now.';
+```
+
+**Placed first, matching `accept_offer`'s own order**, so the reason shown is the reason the
+database would give. An offer that is both expired and unverified must not say "acceptable once
+verified" — that is a promise the row cannot keep. Its own test covers exactly that.
+
+Unfixable, so it takes the control's place as a `.offer-blocked` span rather than sitting in a
+tooltip on a dead button — the split the screen keeps.
+
+## Bundled fix 1 — the comment that claimed a property the code lacked
+
+`components.css` said `.offer-blocked` was "sized like the control it replaces so the row does not
+reflow when the coordinator verifies the offer a moment later." Two false claims: the rule was
+11px italic with no box against `.chip-btn`'s `min-height: 32px` / `padding: 0 10px` / border, and
+the event described cannot happen at all without a reload.
+
+**I fixed both, rather than writing one around the other**, and here is why neither half was the
+whole answer:
+
+- *Comment → CSS* alone would have deleted a property worth having. Rows on one board differ:
+  some carry a button, some "Your offer", some a reason. Matching the box keeps the board from
+  going ragged, and it does matter on the re-read — the board **is** re-fetched after a post or an
+  accept, and an offer verified since the last read swaps its span for a button in place.
+- *CSS → comment* alone would have left the sentence asserting a spontaneous verification event.
+  Nothing polls. That is round 3's concern 1, still open and still deferred.
+
+So `.offer-blocked` now carries `.chip-btn`'s box (`display: inline-flex`, `min-height: 32px`,
+`padding: 0 10px`, a hairline border made transparent — universal `box-sizing: border-box` makes
+those add up to the same outer box), `--text-xs` and italic stay (the box is the control's, the
+voice is not), and the comment now names the re-read as the only thing that swaps it, and says the
+old version was wrong on both counts.
+
+The test asserts `.offer-blocked`'s `min-height` and `padding` **against `.chip-btn`'s own
+declarations read out of the file**, not against the literal `32px`, so the two cannot drift apart
+silently — which was the failure mode the claim had in the first place.
+
+## Bundled fix 2 — `rosterHint`'s `verb` is wired through
+
+It had one call site and was always `'queue'`. "Post to the open board" and "Schedule" are gated by
+the same `rosterReady` and carried **no `title` at all**, so in the state round 3 named — own
+format of three, a six-member offer on the board, six picked to reach it — Join explained itself
+and the two buttons beside it went dead and silent.
+
+Both now pass their own verb ("Remove 3 to post", "Remove 3 to schedule"), and `verb` is typed
+`'queue' | 'post' | 'schedule'` rather than `string`, so a fourth call site cannot invent a fourth
+word by accident.
+
+Schedule has a third gate the other two do not — `!scheduleAt` — and a ready roster with no date is
+the **only** state in which Schedule is dead while Post beside it is live. A roster hint there would
+be actively wrong, so the title is ordered `busy → roster → date` and says "Pick a date and time to
+schedule for". `.offer-post` and `.offer-schedule` classes were added to address the two buttons
+from tests; the existing tests still find them by text and are unaffected.
+
+## Bundled fix 3 — Accept says why it is dead during an in-flight call
+
+`disabled={!canAccept(o) || busy}` with a title that was `undefined` whenever `canAccept(o)` was
+true. `busy` is the one gate that can shut while `canAccept` is true, so this was a dead control
+with no stated reason for the duration of every accept, post and confirm. `busy` is now checked
+first, and the same `BUSY_HINT` constant is used on Post and Schedule.
+
+Join was already self-explanatory (its *label* becomes "Working…"), so it is unchanged.
+
+## Mutation evidence
+
+The harness is committed this round, at
+`.superpowers/sdd/2026-09-02-m2a-matchmaking/mutate.mjs` — round 3's report claimed a script
+asserted its anchors and no such script was on disk. It **asserts** rather than reports: the anchor
+occurs in the file exactly once; the nearest enclosing declaration above the mutation point matches
+a stated pattern (this is what catches round 2's "landed in `myOffers` instead of
+`listOpenOffers`"); the replacement is present after writing; and on restore, the anchor is back
+and the mutation text is gone. It prints the mutated region with line numbers before any test runs.
+Specs are JSON; each run below quotes the harness's own "enclosing region" line.
+
+Every failure below is an `AssertionError`, not a `waitFor` timeout and not a `TypeError`. Two
+assertions were tightened mid-round for exactly that reason: `expect(el.getAttribute('title'))
+.toMatch(...)` raises `TypeError: .toMatch() expects to receive a string, but got object` when the
+attribute is absent, which is noise rather than evidence, so both title assertions are now exact
+`.toBe(...)` comparisons that report `expected null to be '…'`.
+
+### M1 — the expiry gate deleted from `unacceptableReason`
+
+`enclosing region: function unacceptableReason(o: Offer): string | null {`
+
+```
+… -t "expired"                                                          EXIT=1
+ FAIL  … > offers no Accept on an offer past its expiry, and says so
+AssertionError: expected <button type="button" …(1)></button> to be falsy
++ Received:
+<button class="btn chip-btn offer-accept" type="button">Accept</button>
+
+ FAIL  … > is the reason given even when the offer is also unverified, as the database would
+AssertionError: expected 'Open nowexpires 9/4/2026, 2:27:03 AMB…' to match /expired/i
+```
+
+The received markup carries **no `disabled` attribute**: an enabled Accept on an expired offer,
+with a roster of exactly the size the offer wants — the defect, reproduced. Restored → `EXIT=0`,
+`Tests  2 passed | 34 skipped (36)`.
+
+### M2 — the expiry check moved BELOW the `verified_hash` check
+
+Order, not presence. `enclosing region: function unacceptableReason(o: Offer): string | null {`
+
+```
+… -t "also unverified"                                                  EXIT=1
+AssertionError: expected 'Open nowexpires 9/4/2026, 2:27:47 AMB…' to match /expired/i
++ Received:
+"Open nowexpires 9/4/2026, 2:27:47 AMBeing checked — acceptable once verified."
+```
+
+Restored → `EXIT=0`, `Tests  1 passed | 35 skipped (36)`.
+
+### M3 — the `title` removed from Post entirely (the state before this round)
+
+`enclosing region: className="btn btn-primary offer-post"`
+
+```
+… -t "names its own action"                                             EXIT=1
+AssertionError: expected null to be 'Remove 3 to post' // Object.is equality
+```
+
+### M4 — Schedule's verb reverted to the hardcoded `'queue'`
+
+`enclosing region: className="btn offer-schedule"`
+
+```
+… -t "names its own action"                                             EXIT=1
+AssertionError: expected 'Remove 3 to queue' to be 'Remove 3 to schedule'
+```
+
+M3 proves a title exists; M4 proves the `verb` argument is what produces it. Restored → `EXIT=0`.
+
+### M5 — the missing-date reason deleted from Schedule
+
+`enclosing region: className="btn offer-schedule"`
+
+```
+… -t "only the date is missing"                                         EXIT=1
+AssertionError: expected null to be 'Pick a date and time to schedule for'
+```
+
+Restored → `EXIT=0`.
+
+### M6 — Accept's title back to `undefined` while busy
+
+`enclosing region: className="btn chip-btn offer-accept"`
+
+```
+… -t "in-flight call"                                                   EXIT=1
+AssertionError: expected null to be 'Working — wait for the last action to…'
+```
+
+The same test's `expect(b.disabled).toBe(true)` passed against the mutation — so the control really
+was dead, and the title really was the missing half. Restored → `EXIT=0`.
+
+### M7 — `.offer-blocked` back to a bare span
+
+`enclosing region: .my-offer-row {` (the nearest preceding top-level rule; the printed region
+confirms the edit landed inside `.offer-blocked`)
+
+```
+… -t "same box as the Accept control"                                   EXIT=1
+AssertionError: expected null to be '32px' // Object.is equality
+```
+
+`'32px'` there is read out of `.chip-btn`'s own block, which is the point of the test.
+
+All seven restored through the harness (`RESTORED (anchor present, mutation absent)`), and
+`grep -rn MUTATED app/src` returns nothing.
+
+## Gate
+
+```
+cd app && npm run check > /tmp/task-8-fix4-gate.log 2>&1; echo "EXIT=$?"
+EXIT=0
+ Test Files  81 passed (81)
+      Tests  1158 passed (1158)
+```
+
+No `supabase db reset`, no `db:start`/`db:stop`, no `check:db`, no dev server, no migration.
+
+## Not touched, as instructed
+
+`rosterCapacity` counting unverified offers; `.chip-btn` appearing in a second grouped rule at
+`components.css:1699` (a `clip-path` add-on, not a duplicate declaration of the same block); the
+board not re-reading itself; pool validation (deferred to coordinator-side `validateTeam` in M2b);
+the missing confirm acknowledgement; `justAccepted` never being cleared.
+
+## Concerns
+
+1. **`unacceptableReason` reads `Date.now()`, and React does not re-render on the clock.** An
+   offer that expires while the tab sits open keeps its Accept until something else causes a
+   render. That is a strictly smaller window than before — the reason now appears on load and on
+   every re-read and on every keystroke in the roster picker, rather than never — but the honest
+   fix is the same timer/subscription that rounds 2 and 3 both deferred. I did not add one, for
+   round 3's reason: it is a behaviour change nobody has asked for, and it belongs with the
+   realtime decision rather than in front of it. This is now the third round to log it, which I
+   read as the signal that it should be scheduled rather than deferred again.
+2. **The clock is the client's.** `expires_at` is a server timestamp compared against the
+   browser's `Date.now()`, so a badly skewed clock will hide an acceptable offer (harmless — the
+   reason is honest and the offer reappears) or show one it should not (which then fails at
+   `accept_offer`, exactly as it does today). The server remains the authority; this check only
+   stops the screen from *offering* a call that cannot succeed.
+3. **The CSS assertion compares two rules' text, not two rendered boxes.** jsdom applies no
+   stylesheet, so nothing here proves the boxes actually match at paint time — only that the two
+   rules declare the same `min-height` and `padding`, which is what a comment claiming "sized like
+   the control it replaces" can be held to in this test environment.
diff --git a/app/src/screens/MatchmakingScreen.tsx b/app/src/screens/MatchmakingScreen.tsx
index 5b90b6f..41aacdf 100644
--- a/app/src/screens/MatchmakingScreen.tsx
+++ b/app/src/screens/MatchmakingScreen.tsx
@@ -69,58 +69,79 @@ function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
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
 
 /**
  * Why NOBODY can accept this offer right now — as distinct from why *you*
  * cannot yet, which is a disabled button with a hint saying what to fix. A
  * reason here means the control is not rendered at all.
  */
 function unacceptableReason(o: Offer): string | null {
+  // FIRST, because it is first in `accept_offer` too — the reason shown is the
+  // reason the database would actually give.
+  //
+  // Expiry is a coordinator SWEEP, not a trigger: an offer past `expires_at`
+  // sits in `state = 'open'` until the next tick, and `listOpenOffers` filters
+  // only on `league` and `state`, so an expired row is handed back looking
+  // exactly like a live one. Nothing on this screen re-reads the board on its
+  // own either, so a page left open past this timestamp would otherwise show
+  // an enabled Accept — whose only possible outcome is `accept_offer` raising
+  // 'this offer has expired' — for as long as the tab stays open.
+  if (Date.parse(o.expiresAt) <= Date.now()) return 'Expired — nobody can accept it now.';
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
 
-/** "Add 2 more", "Remove 3" — never "Add -3 more". */
-function rosterHint(want: number, have: number, verb: string): string {
+/**
+ * "Add 2 more to queue", "Remove 3 to post" — never "Add -3 more".
+ *
+ * `verb` is what the control the hint hangs off actually does. Every control
+ * gated on `rosterReady` passes its own: Join, Post and Schedule are three
+ * buttons that go dead together, and a hint naming the wrong one of them is
+ * only marginally better than no hint at all.
+ */
+function rosterHint(want: number, have: number, verb: 'queue' | 'post' | 'schedule'): string {
   const short = want - have;
   return short > 0 ? `Add ${short} more to ${verb}` : `Remove ${-short} to ${verb}`;
 }
 
+/** Why a control is dead for the duration of an in-flight call. */
+const BUSY_HINT = 'Working — wait for the last action to finish';
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
       if (!proposed) return 'Still open.';
       // The proposer's side of the same minute the board hides Accept for:
       // "nobody has accepted it" would read as indifference from other
       // people when in fact nobody has been allowed to yet.
       return o.verifiedHash === null
         ? 'Posted — being checked before anyone can accept it.'
         : 'Posted — nobody has accepted it yet.';
     case 'accepted':
       return proposed
         ? 'Someone accepted. Confirm it to make it a match.'
         : "You accepted — awaiting the proposer's confirmation.";
@@ -572,89 +593,117 @@ export function MatchmakingScreen() {
                 <li key={o.id} className="offer-row" data-offer-id={o.id}>
                   <span className="offer-when">
                     {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
                   </span>
                   <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
                   {mine ? (
                     <span className="text-faint">Your offer</span>
                   ) : blocked ? (
                     // Not a disabled button: nothing this person does would
                     // make it work, so the reason takes the control's place
                     // rather than sitting in a tooltip on a dead one.
                     <span className="text-faint offer-blocked">{blocked}</span>
                   ) : (
                     <button
                       type="button"
                       className="btn chip-btn offer-accept"
                       // Not `rosterReady`: that asks whether YOU could post,
                       // and accepting is the offer's business, not your
                       // format's.
                       disabled={!canAccept(o) || busy}
+                      // `busy` FIRST: it is the one gate that can be shut
+                      // while `canAccept` is true, and a control disabled for
+                      // a reason nobody states is the same defect as a
+                      // control that can only fail.
                       title={
-                        canAccept(o) ? undefined : `This offer is played with a roster of ${o.rosterSize}`
+                        busy
+                          ? BUSY_HINT
+                          : canAccept(o)
+                            ? undefined
+                            : `This offer is played with a roster of ${o.rosterSize}`
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
             onClick={() => setPostOpen((o) => !o)}
           >
             Post an offer
           </button>
           )}
           {chosen && postOpen && (
             <div className="move-picker-panel offer-post-panel">
               <button
                 type="button"
-                className="btn btn-primary"
+                className="btn btn-primary offer-post"
                 disabled={!rosterReady || busy}
+                // The same gate as Join, so the same hint — with this
+                // control's own verb. Without one, the state round 3 named
+                // (six picked to reach a bigger offer, own format of three)
+                // left these two buttons dead and silent while Join beside
+                // them explained itself.
+                title={busy ? BUSY_HINT : rosterReady ? undefined : rosterHint(rosterSize, team.length, 'post')}
                 onClick={() => void post(false)}
               >
                 Post to the open board
               </button>
               <div className="offer-schedule-row">
                 <input
                   type="datetime-local"
                   className="input"
                   value={scheduleAt}
                   onChange={(e) => setScheduleAt(e.target.value)}
                 />
                 <button
                   type="button"
-                  className="btn"
+                  className="btn offer-schedule"
                   disabled={!rosterReady || busy || !scheduleAt}
+                  // Three gates, so three reasons, in the order they are
+                  // checked. The date one matters most: a ready roster and no
+                  // date is the ONLY way this button is dead while Join beside
+                  // it is live, so "add/remove members" would be actively
+                  // misleading there.
+                  title={
+                    busy
+                      ? BUSY_HINT
+                      : !rosterReady
+                        ? rosterHint(rosterSize, team.length, 'schedule')
+                        : !scheduleAt
+                          ? 'Pick a date and time to schedule for'
+                          : undefined
+                  }
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
diff --git a/app/src/screens/__tests__/matchmaking.test.tsx b/app/src/screens/__tests__/matchmaking.test.tsx
index 57dda88..d9ab5c8 100644
--- a/app/src/screens/__tests__/matchmaking.test.tsx
+++ b/app/src/screens/__tests__/matchmaking.test.tsx
@@ -726,57 +726,217 @@ describe('signed in — the handshake survives a reload', () => {
     // accepted yet" every single time and print that sentence at the person.
     expect(container.querySelectorAll('.offer-confirm')).toHaveLength(0);
     expect(container.textContent).toMatch(/nobody has accepted it yet/i);
   });
 
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
 
+/**
+ * An offer past its own `expires_at`.
+ *
+ * `accept_offer` raises 'this offer has expired' before it checks anything
+ * else, and expiry is a coordinator SWEEP rather than a trigger — the row sits
+ * in `state = 'open'` until the next tick. `listOpenOffers` filters on
+ * `league` and `state` only, so it hands the expired row back looking exactly
+ * like a live one, and nothing on this screen re-reads the board on its own.
+ * A page left open past the timestamp therefore shows an enabled Accept whose
+ * only possible outcome is raw Postgres text, indefinitely.
+ */
+describe('signed in — an offer that has expired', () => {
+  it('offers no Accept on an offer past its expiry, and says so', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-gone', expiresAt: new Date(Date.now() - 60_000).toISOString() }),
+      offer({ id: 'off-live', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const [gone, live] = await waitFor(() => {
+      const a = container.querySelector('[data-offer-id="off-gone"]');
+      const b = container.querySelector('[data-offer-id="off-live"]');
+      if (!a || !b) throw new Error('board not rendered yet');
+      return [a, b];
+    });
+    // A roster of exactly the size the offer wants: the ONLY remaining gate is
+    // the expiry itself, so without it this Accept renders enabled.
+    await pickThree(container);
+    expect(gone.querySelector('.offer-accept')).toBeFalsy();
+    // Unfixable, so the reason takes the control's place rather than sitting
+    // in a tooltip on a dead button — the split the screen keeps.
+    expect(gone.querySelector('.offer-blocked')?.textContent).toMatch(/expired/i);
+    // And the live offer beside it is untouched, or this test would pass
+    // against a board that offered nothing to anybody.
+    expect((live.querySelector('.offer-accept') as HTMLButtonElement).disabled).toBe(false);
+  });
+
+  it('is the reason given even when the offer is also unverified, as the database would', async () => {
+    // `accept_offer` checks expiry BEFORE verified_hash, so "being checked"
+    // here would be a sentence the database disagrees with — and a hopeful
+    // one, since "acceptable once verified" is a promise this row cannot keep.
+    mmApi.listOpenOffers.mockResolvedValue([
+      offer({ id: 'off-both', verifiedHash: null, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
+    ]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    const row = await waitFor(() => {
+      const r = container.querySelector('[data-offer-id="off-both"]');
+      if (!r) throw new Error('board not rendered yet');
+      return r;
+    });
+    expect(row.textContent).toMatch(/expired/i);
+    expect(row.textContent).not.toMatch(/being checked/i);
+  });
+});
+
+/**
+ * Every disabled control says why it is disabled.
+ *
+ * Three buttons share the `rosterReady` gate — Join, Post and Schedule — and
+ * until now only Join carried a hint; the other two went dead and silent in
+ * exactly the state round 3 named. And any of them, plus Accept, can be dead
+ * for the length of an in-flight call with nothing said at all.
+ */
+describe('signed in — a disabled control says why', () => {
+  async function openPostPanel(container: HTMLElement) {
+    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
+    fireEvent.click(toggle);
+    return waitFor(() => {
+      const b = container.querySelector('.offer-post') as HTMLButtonElement | null;
+      if (!b) throw new Error('post panel not open yet');
+      return b;
+    });
+  }
+
+  it('names its own action in the roster hint, rather than telling Post to queue', async () => {
+    // The state round 3 named: own format of three, a six-member offer on the
+    // board, six picked to reach it. Join says "Remove 3 to queue"; Post and
+    // Schedule are dead under the same gate.
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    await pick(container, 'medicham');
+    await pick(container, 'swampert');
+    await pick(container, 'bastiodon');
+
+    const postBtn = await openPostPanel(container);
+    const schedBtn = container.querySelector('.offer-schedule') as HTMLButtonElement;
+    expect(postBtn.disabled).toBe(true);
+    expect(schedBtn.disabled).toBe(true);
+    expect(postBtn.getAttribute('title')).toBe('Remove 3 to post');
+    expect(schedBtn.getAttribute('title')).toBe('Remove 3 to schedule');
+    // Not the one verb the parameter used to be hardcoded to.
+    expect(postBtn.getAttribute('title')).not.toMatch(/queue/);
+    expect(schedBtn.getAttribute('title')).not.toMatch(/queue/);
+  });
+
+  it('tells Schedule apart from Post when the roster is fine and only the date is missing', async () => {
+    // The one state where Schedule is dead and Post beside it is live. A
+    // roster hint here would be actively wrong.
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await pickThree(container);
+    const postBtn = await openPostPanel(container);
+    const schedBtn = container.querySelector('.offer-schedule') as HTMLButtonElement;
+    expect(postBtn.disabled).toBe(false);
+    expect(postBtn.getAttribute('title')).toBeNull();
+    expect(schedBtn.disabled).toBe(true);
+    // The exact string, not a pattern: `getAttribute` returns null for a
+    // missing title, and `toMatch(null)` is a TypeError rather than a
+    // failed assertion — which is the difference between evidence and noise.
+    expect(schedBtn.getAttribute('title')).toBe('Pick a date and time to schedule for');
+    expect(schedBtn.getAttribute('title') ?? '').not.toMatch(/add|remove/i);
+  });
+
+  it('says why Accept is dead for the length of an in-flight call', async () => {
+    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-a' }), offer({ id: 'off-b' })]);
+    let release!: (id: string | null) => void;
+    mmApi.acceptOffer.mockReturnValue(new Promise<string | null>((res) => (release = res)));
+    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
+    await waitFor(() => {
+      if (!container.querySelector('[data-offer-id="off-b"]')) throw new Error('board not rendered yet');
+    });
+    await pickThree(container);
+    const a = container.querySelector('[data-offer-id="off-a"] .offer-accept') as HTMLButtonElement;
+    const b = container.querySelector('[data-offer-id="off-b"] .offer-accept') as HTMLButtonElement;
+    expect(b.getAttribute('title')).toBeNull();
+    await act(async () => {
+      fireEvent.click(a);
+    });
+    // `canAccept(off-b)` is still true — `busy` is the only gate that shut,
+    // and it is the one an undefined title left unexplained.
+    expect(b.disabled).toBe(true);
+    expect(b.getAttribute('title')).toBe('Working — wait for the last action to finish');
+    await act(async () => {
+      release('m1');
+    });
+  });
+});
+
 /**
  * jsdom applies no stylesheet, so nothing here asserts a rendered box. What a
  * test CAN hold is the rule itself, read as text — the established pattern in
  * this repo (see `add-modal-size.test.tsx`). The board grows on its own as
  * other people post to it; without a bound and its own scroll it pushes the
  * Post control and every panel below it down the page while someone is
  * reaching for them.
  */
 describe('the offer board is bounded, not expanding', () => {
   const css = readFileSync('src/styles/components.css', 'utf8');
 
   function block(selector: string): string {
     const i = css.search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
     expect(i, `${selector} not found at the top level`).toBeGreaterThan(-1);
     return css.slice(i, css.indexOf('}', i) + 1);
   }
 
   it('caps the open board and scrolls inside that cap', () => {
     const rule = block('.offer-list');
     expect(rule).toMatch(/max-height:\s*\d/);
     expect(rule).toMatch(/overflow-y:\s*auto/);
   });
 
   it('caps your own offer list the same way', () => {
     const rule = block('.my-offer-list');
     expect(rule).toMatch(/max-height:\s*\d/);
     expect(rule).toMatch(/overflow-y:\s*auto/);
   });
 
   it('declares each of those selectors once at the top level', () => {
     // The .team-slots lesson: two rules for one selector, and the edit lands
     // on whichever you read rather than whichever wins.
     for (const sel of ['.offer-list', '.my-offer-list']) {
       expect(css.match(new RegExp(`^\\${sel}\\s*\\{`, 'gm')) ?? [], sel).toHaveLength(1);
     }
   });
+
+  /**
+   * The rule's own comment claims .offer-blocked is sized like the control it
+   * stands in for. Asserted against .chip-btn's ACTUAL declarations rather
+   * than against the literal 32px, so the two cannot drift apart silently —
+   * which is the whole failure mode the claim had before this round: a
+   * sentence describing a box the rule never had.
+   */
+  it('gives the blocked reason the same box as the Accept control it replaces', () => {
+    const chip = block('.chip-btn');
+    const blocked = block('.offer-blocked');
+    const decl = (rule: string, prop: string) =>
+      rule.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1].trim() ?? null;
+
+    expect(decl(chip, 'min-height'), '.chip-btn declares no min-height').not.toBeNull();
+    expect(decl(blocked, 'min-height')).toBe(decl(chip, 'min-height'));
+    expect(decl(blocked, 'padding')).toBe(decl(chip, 'padding'));
+    // Height only bites on a box that can have one.
+    expect(blocked).toMatch(/display:\s*inline-flex/);
+  });
 });
diff --git a/app/src/styles/components.css b/app/src/styles/components.css
index d0e21b9..eb14052 100644
--- a/app/src/styles/components.css
+++ b/app/src/styles/components.css
@@ -5994,43 +5994,64 @@ th.bt-matrix-head { text-align: center; }
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
 /* The reason an offer cannot be accepted, standing where its Accept control
-   would be — sized like the control it replaces so the row does not reflow
-   when the coordinator verifies the offer a moment later. */
+   would be.
+
+   It carries .chip-btn's own box — min-height, padding, and a hairline border
+   made transparent — so a row showing a reason is exactly as tall as a row
+   showing a button, and the board does not go ragged when some offers are
+   acceptable and others are not. That matters on the re-read too: the board is
+   re-fetched after a post or an accept, and an offer that has verified since
+   the last read swaps this span for a button in place, without the rows under
+   it stepping.
+
+   The re-read is the ONLY thing that swaps it. Nothing on this screen polls,
+   so an offer does not become acceptable on its own while the tab sits open —
+   an earlier version of this comment claimed it did, and claimed a size this
+   rule did not have. Both are fixed here rather than one being written around
+   the other: the sizing is worth having, and the polling is a separate
+   decision nobody has taken.
+
+   --text-xs and italic stay: the box is the control's, the voice is not. */
 .offer-blocked {
+  display: inline-flex;
+  align-items: center;
+  min-height: 32px;
+  padding: 0 10px;
+  border: var(--border-hairline) solid transparent;
   font-size: var(--text-xs);
   font-style: italic;
 }
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
