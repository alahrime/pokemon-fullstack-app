# SDD ledger — plan: docs/superpowers/plans/2026-09-05-m3b-channels-dms-and-groups.md

Spec: docs/superpowers/specs/2026-08-31-paragon-platform-design.md (binding authority)
Branch: main. Baseline 80118e4 — M3a pushed and live. check 1233/1233, check:db 180/180, roundtrips 9/9 and 11/11.
Newest migration: 20260906002000. M3b's must start at 20260907000000 or later.

## Preflight scan

I scanned specifically for the defect class that produced SEVEN findings across M2b and M3a: a
passage that rewrites or calls an existing function, losing a guard or a grant the original had.
Four instances found BEFORE any code was written.

| # | Finding | Ruling |
|---|---|---|
| P1 | **CRITICAL.** The `messages` INSERT policy (plan line 776) calls `public.blocked_between(...)`. A policy expression is evaluated as the QUERYING role, and `blocked_between` is deliberately NOT granted to `authenticated`. Every authenticated INSERT into `messages` would raise `permission denied for function blocked_between(uuid,uuid)`. | Fix with a caller-scoped wrapper, NOT a grant — see Ruling B1. |
| P2 | `are_friends(a,b)` is granted to `authenticated` (line 531) but is only ever called from `open_dm`, `create_group` and `add_to_group`, all `security definer`. The grant is unnecessary AND leaky: it is `security definer`, bypasses RLS, and answers for ANY pair, so a signed-in user could probe whether two strangers are friends — exactly what the `friendships` SELECT policy exists to prevent. | Revoke, do not grant. |
| P3 | `share_a_live_match(a,b)` is granted to `authenticated` (line 532) with the same shape: only called from `open_dm` (definer), and the grant would let anyone probe whether two strangers share a match. | Revoke, do not grant. |
| P4 | `is_channel_member(p_channel, p_user)` MUST be executable by `authenticated` because seven policies call it — but as written it answers for any (channel, user) pair, so it is a membership probe for anyone who learns a channel id. All SEVEN policy call sites pass `(select auth.uid())`; none ever asks about another user. | Scope it to the caller — see Ruling B2. |

### Task pairs sharing a file or an interface

| Pair | Produced vs consumed | Finding |
|---|---|---|
| T1 → T2,T4,T5 | `is_channel_member` | Clean once B2 lands. |
| T2 → T3,T7 | `open_dm`/`create_group`/`add_to_group` | Clean. |
| T1 → T3 | `channels.match_id`, unique index | Clean. |
| T4 → T5,T6 | `messages` shape | Clean. |
| T4 → T6 | realtime publication | Clean; T6's subscription is worthless without it, and its absence is silent. |
| M3a → T2 | `are_friends`, `blocked_between`, `pair_lo`/`pair_hi` | P1/P2/P3 above. |
| M2b → T2 | `matches.state` values in `share_a_live_match` | Clean — M2b is deployed, all seven states exist. |

## Rulings

Ruling B1: fix P1 with a NEW caller-scoped helper rather than granting `blocked_between`. Granting it is the leak I refused in M3a and must stay refused. The helper takes ONE argument and derives the other from `auth.uid()`, so a caller can only ever ask about a pair they are part of, which makes it safe to grant:
    create or replace function public.blocked_with_me(p_other uuid) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.blocks
                      where (blocker_id = auth.uid() and blocked_id = p_other)
                         or (blocker_id = p_other and blocked_id = auth.uid()))
    $$;
Cost if wrong: one extra function that answers strictly less than the one it replaces at that call site.

Ruling B2: fix P4 by scoping `is_channel_member` to the caller — one argument, `auth.uid()` derived internally. Every one of the seven policy call sites already passes the caller, so nothing loses expressiveness, and the membership probe disappears. If a later task genuinely needs to ask about another user it can add a definer-only two-argument variant then, with a reason. Cost if wrong: a rename across seven call sites in one migration.

Ruling B3: M3b works directly on `main`, as M3a did. Additive migrations, and `main` is green and pushed.

## Progress
Task 1: complete (commit 2463116). check:db 185/185 (was 180), check 1233/1233. Ruling B2 applied — `is_channel_member` is one-argument, caller-scoped, `authenticated=X` with no bare PUBLIC and no anon.
Task 1: the implementer found DEFECT #8 in my plan text — a duplicate `const denied_privilege_denied` in the test snippet, which I introduced myself with the automated `refusal()` rewrite script: it generated the same variable name for two call sites in one test. Renamed, no assertion changed. A reminder that a mechanical fix to plan text needs the same scrutiny as hand-written text.
Task 2: complete (commit ff63dbf — the agent committed just before a rate limit cut it off; tree was clean). check:db 191/191 (was 185), check 1233/1233. Rulings B1's siblings verified live: `are_friends` and `share_a_live_match` carry NO authenticated grant and probe as `f`, so the stranger-probe leak is closed, while open_dm/create_group/add_to_group/leave_channel are correctly granted. No bare PUBLIC on any of the six.
Task 3: complete (commit d7e685b). check:db 192/192, check 1233/1233. create_match_channel prosecdef=t with no PUBLIC/anon/authenticated. pairing.test.ts 26/26 and offers.test.ts 21/21 both still green with the trigger now firing inside them; roundtrips m3a 9/9 and m2b 11/11.
Task 4: complete (commit 41a8bfd). check:db 196/196, check 1233/1233. `blocked_with_me` granted to authenticated (t), `blocked_between` still ungranted (f), `messages` now in the supabase_realtime publication — which held NO tables before this migration, and whose absence fails silently.

Ruling B4 (CORRECTS Ruling B1): my `blocked_with_me` body was WRONG and the implementer caught it. I wrote it symmetric — blocked in EITHER direction — which silences both parties: the blocker's own posts into the channel are refused too. They shipped it directional (`blocker_id = p_other and blocked_id = auth.uid()`, i.e. "did they block me"), which matches the brief's test and M3a's one-directional design, and they proved the diagnosis by running my literal SQL first and getting exactly one failure on the blocker's own insert. The security property I cared about is untouched: the function still only reads rows where `blocked_id = auth.uid()`, so a caller can still only ask about themselves.

OPEN FINDING for the whole-branch review — do NOT sign the invariant off until this is ruled on. A blocked user posting into an EXISTING DM gets `new row violates row-level security policy`. `block_user` tears down the friendship but nothing deletes the channel, so the blocked party still sees the conversation and can still try to post — and the refusal is observable, in one specific conversation, where it used to work. That is a block detector, and a clearer one than M3a's search-box narrowing because the blocked party knows exactly who the counterparty is. The spec is in tension with itself here: it says a blocked user "must not be able to detect the block" AND that enforcement lives as `NOT EXISTS` clauses in the policies on `messages` — which necessarily means a refused insert. The only non-detecting behaviour is accept-and-discard. That is a product decision, not a bug fix, and it belongs to a ruling rather than to whoever notices it last.

Ruling B5 (USER DECISION, 2026-09-06 — overrides my reading of the spec): blocks ARE allowed to be detectable. The user ruled that "the spec overstated the importance of concealing a user's blocked status relative to another user", and chose option 2: the messages policy keeps refusing a blocked user's insert, and that refusal being observable is accepted rather than a defect.
Consequences, so nobody re-litigates this:
- The OPEN FINDING above is CLOSED as accepted behaviour, not as fixed.
- M3a's "invariant narrowed, not achieved" finding (the Friends search box confirming a target exists before Send) is likewise accepted, not a defect. It must no longer be treated as a blocker.
- The uniform refusal sentences in `request_friendship` and `open_dm`, and the identical-string tests that pin them, STAY. They cost nothing, they are already shipped and green, and they remain good manners even where they are no longer load-bearing. Do not go loosening them.
- What does NOT change: the `blocks` table stays unreadable from the blocked side, and `blocked_between` / `are_friends` / `share_a_live_match` stay ungranted to `authenticated`. Those prevent a signed-in user PROBING arbitrary strangers' relationships, which is a different and still-live concern from a participant noticing their own block.
Cost if wrong: a user learns they were blocked, which the product owner has now said is acceptable.
Task 5: complete (commit 3d0eb05). check:db 203/203 (was 196), check 1233/1233. report_message granted to authenticated; sweep_messages to service_role only. 2 HANDOFF.md occurrences of the tick body updated.

Ruling B6: the implementer hit a FOURTH variant of the grant trap and my instruction was the thing that was wrong. I told them `revoke all ... from public, anon` — two roles. That left `sweep_messages` still executable by `authenticated`, because this stack's default-privilege bootstrap grants to `authenticated` as well as to PUBLIC. The correct incantation is `revoke all ... from public, anon, authenticated`, which is exactly what `sweep_matches`, `sweep_expired` and `pair_queue_entries` already do, and their own comments explain this failure mode. So the trap has now appeared as: a policy calling an ungranted function; a non-definer trigger calling one; a new function inheriting PUBLIC; and a two-role revoke that misses the default grant to authenticated. Every future service-role-only function in this repo uses the three-role revoke.
Task 5: the implementer also added 3 tests beyond the brief's 4, because the brief's set did not give `message_pins` both an allow and a deny test, which the global constraints require without exception. That needed `message_reports` added to the shared PRIVILEGE_DENIED regex in helpers.ts.
Task 6: complete (commit c2686f3). check 1247/1247 (+14). The idempotent-teardown requirement is covered; `markRead` is the only function deriving from `me` and already carried the no-session guard, now with a dedicated test — so this is NOT a third instance of the fabrication bug.

Ruling B7: the implementer raised an uncertainty they could not resolve (supabase/ was off-limits to them) and they were RIGHT to. I measured it: the `channel_members` SELECT policy is `is_channel_member(channel_id)`, i.e. every member's row is visible to every other member. So `listChannels`'s embedded `channel_members(last_read_at)` returns ALL members' rows and `channel_members[0]` is an arbitrary one — quite possibly the other person's, even in a two-person DM. `lastReadAt` is therefore wrong for essentially every channel, and any unread count built on it would be computed from someone else's read position. This is exactly the minor I flagged when writing the plan ("in a group this returns some member's row rather than reliably the viewer's") — it is worse than I recorded, because it is not only groups. Folding the fix into Task 7's dispatch, since Task 7 is what would consume it. Cost if wrong: a one-line selection change in a function nothing has shipped on yet.
Task 7: complete (commits e44cb03 fix, 2d5100c screen). check 1256/1256 (+9). Ruling B7's fix verified by experiment: with the viewer's row placed SECOND, the new test failed against the `[0]` version, reading back the other member's 2020 timestamp instead of the viewer's 2026 one. Hue `var(--type-bug)`.
Task 7: minor (deferred): no reusable generic chamfer class exists — every chamfered rule in components.css bakes in its own positioning — so the screen follows FriendsScreen's plain .panel/rail vocabulary rather than pasting a new polygon. Worth extracting a shared class the next time someone is in that stylesheet.
Task 7: minor (deferred): `markRead()` on channel-open, and the auto-select-by-activeMatch path, are both judgment calls with no pinning test.
Task 8: complete (commit 703efea). 13/13 checks, script exit 0, check 1256/1256.

Ruling B8: check 3 — the realtime delivery check, the one the script exists for — FAILED on the controller's first verification run and PASSED on a re-run minutes later. Diagnosis, stated with its evidence rather than as a certainty: `npm run db:reset` restarts the `supabase_realtime` container (it showed "Up 2 minutes" at the time of the failure), and a subscription opened shortly after a restart is not established in time. The publication was verified to contain `messages` at the moment of failure, and the container reported healthy, so the publication itself was not the cause. Run 1 (≈2 min after reset): FAIL. Run 2 (settled, no reset): PASS. n=1 each, so this is the most likely explanation rather than a proven one.
The REAL defect it exposes is in the check, and the implementer flagged it themselves: `subscribeToChannel` exposes no join-status hook, so the script sleeps a fixed 1500ms before sending instead of waiting for a deterministic SUBSCRIBED signal. That makes the single most important check in the milestone timing-dependent — it can report a false failure after a stack restart, and worse, it could in principle report a false PASS if it ever raced the other way. Deferred, but it should be the first thing fixed in this area: `subscribeToChannel` should surface the subscription status so the script can await it.
Operational note for anyone running this: after `npm run db:reset`, give the realtime container a minute before running m3b-roundtrip, or expect check 3 to fail spuriously.

## Final whole-branch review — 1 Critical, 8 Important, 10 Minor. NOT pushed.

Ruling B9: the CRITICAL is real and I REPRODUCED IT MYSELF against the live stack. The `messages` UPDATE policy checks only `author_id`, and there are no column grants anywhere in this repo, so `channel_id` and `expires_at` are freely writable by the author. Attack, run as a genuine `authenticated` role with `request.jwt.claims` set to the blocked user:
  1. direct insert into the blocked DM -> `ERROR: new row violates row-level security policy` (the block works)
  2. `create_group('solo','{}')` -> succeeds; the member loop is skipped on an empty array, so no accomplice is needed
  3. insert the message into that solo group -> `INSERT 0 1`
  4. `update messages set channel_id = <the DM>` -> `UPDATE 1`
  5. the message is in the DM: count = 1
So the one security property this milestone ships is bypassable in a single statement. The same hole lets an author set `expires_at` to 2099 (retention defeated upward) or into the past (hard-delete their own abusive message before anyone can report it — exactly the window the 7 days exists to preserve). The migration's own comment states the intent; the policy does not implement it. Nothing in the suite caught it because roundtrip check 6 forces `expires_at` AS THE SERVICE ROLE, so no test ever asked whether a signed-in author could.
The general shape, which is what the per-task reviews structurally could not see: every WITH CHECK in this milestone pins WHO but not WHERE or FOR HOW LONG.
Final fix wave: complete (commits 2444930, 7d5af17, d15cd0e). Controller re-ran the ORIGINAL attack script against the fix: step 4 now raises `channel_id, author_id, created_at and expires_at cannot be changed after insert`, and the message never reaches the DM. The Critical is closed, verified by the same script that proved it open. Implementer's revert experiment: reverting 20260907003000 made exactly the three new attack/expires_at tests fail, restored and green.

Ruling B10 (USER DECISION, 2026-09-06): a block is SYMMETRIC IN A DM, directional elsewhere. The whole-branch review found that after Ann blocks Bob, Ann could keep posting into their DM and Bob still received it live while being unable to reply — `block_user` deletes the friendship but not the channel, so the one-way line persists indefinitely, and roundtrip check 8 asserted this as correct. This is distinct from Ruling B5, which settled whether Bob may LEARN he is blocked; this is whether Ann may still REACH him. The user chose symmetry for `kind = 'dm'` only, keeping the directional check for groups where symmetric silencing would punish the blocker for blocking one member. Cost if wrong: a blocker who wanted to keep talking to someone they blocked cannot, in a DM.
