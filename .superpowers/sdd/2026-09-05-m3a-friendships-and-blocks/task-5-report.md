# Task 5 report: The Friends screen

## Status

Done. `npm run check` exits 0. Committed as `f03e9e5` on `main`. Not pushed.

## Files changed

- **New** `app/src/screens/FriendsScreen.tsx` — the screen.
- **New** `app/src/screens/__tests__/friends-screen.test.tsx` — 9 tests.
- **Modified** `app/src/lib/screens.ts` — registered the `friends` screen def.
- **Modified** `app/src/state/AppState.tsx` — added `'friends'` to the `Screen` union.
- **Modified** `app/src/App.tsx` — lazy import + `case 'friends'` in the `Screens()` switch.
- **Modified** `app/src/styles/components.css` — new `.friend-row`, `.friend-search-row`, `.friend-notice` rules, appended after the existing `— account —` / matchmaking blocks.

## TDD sequence (real output)

1. Wrote `friends-screen.test.tsx` against a not-yet-existing `FriendsScreen`.
2. Ran it:
   ```
   cd app && npx vitest run src/screens/__tests__/friends-screen.test.tsx > /tmp/t0.log 2>&1; echo "EXIT=$?"
   EXIT=1
   Error: Failed to resolve import "../FriendsScreen" from ".../friends-screen.test.tsx". Does the file exist?
   ```
   Failed for the right reason.
3. Wrote `FriendsScreen.tsx`. First re-run failed differently — my `../../lib/supabase` mock replaced the whole module and dropped `auth`, which `SessionProvider` (mounted by `renderApp`) needs:
   ```
   TypeError: Cannot read properties of undefined (reading 'onAuthStateChange')
     at src/state/SessionContext.tsx:49:23
   ```
   Fixed by adding an `auth` stub to that mock (same shape `src/test/setup.ts` uses globally — this file-level mock replaces the global one for this file only). Re-ran:
   ```
   EXIT=0
    ✓ src/screens/__tests__/friends-screen.test.tsx (9 tests) 212ms
   ```
4. Registered the screen (`screens.ts`, `AppState.tsx`, `App.tsx`). Ran `npm run check`:
   ```
   src/screens/__tests__/friends-screen.test.tsx(43,7): error TS2322: Type '(resolve: ...) => Promise<unknown>' is not assignable to type '<TResult1, TResult2>(onfulfilled?...) => PromiseLike<...>'
   ```
   `tsc` correctly rejected my mock's over-narrow `.then` signature against the real `PromiseLike` interface. Fixed by typing the mock chain object as `Record<string, unknown>` instead of `PromiseLike<...> & Record<string, unknown>` — it only needs to be awaitable at the call site, not structurally match the real query builder's overloaded `.then`.
5. Full gate:
   ```
   cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
   EXIT=0
   ...
   Test Files  87 passed (87)
        Tests  1230 passed (1230)
   ```
   1230/1230 (was 1221/1221 before this task — +9 new tests, 0 regressions, 0 skipped).

## The screen

`FriendsScreen.tsx` calls exactly `listFriends()` and `listBlocks()` once on mount (via a `load()` function), partitions the `Friend[]` in the component into three groups by `status`/`theyAsked`, and renders four `<section className="panel">` blocks plus one search `<form className="panel">` above them:

- **Requests waiting on you** (`pending && theyAsked`) — `Accept {otherId}` / `Decline {otherId}` buttons, calling `respondToFriendship(otherId, true|false)`.
- **Requests you sent** (`pending && !theyAsked`) — no Accept button, text "Waiting on them", a `Withdraw` button calling `removeFriendship`.
- **Friends** (`accepted`) — `Remove` and `Block` buttons (`removeFriendship` / `blockUser`), plus the friend's code (`.friend-code` span) when one is on file.
- **Blocked** (from `listBlocks()`) — `Unblock` button calling `unblockUser`.

Every mutation runs through one `act(id, fn)` helper that calls the mutator, then re-runs `load()` on success (mirrors `MatchmakingScreen`'s own queue/offer pattern) — so e.g. accepting a request also makes it disappear correctly rather than requiring hand-patched local state.

**Friend codes**: reused `opponentFriendCode` from `app/src/lib/matchmaking.ts` (already exported, already reads `friend_codes` filtered by `profile_id`) rather than writing a duplicate query — it's generic enough despite the name, and the RLS policy it depends on (Task 3's "an accepted friend may read your friend code" branch) is exactly the one the brief calls out. Fetched once per accepted friend inside `load()`, in parallel via `Promise.all`, with per-id try/catch so one unreadable code doesn't fail the whole screen.

**Search**: a small local `searchProfilesByName()` queries `profiles` directly (`select('id, display_name').ilike('display_name', ...).limit(8)`) — deliberately NOT routed through `lib/social.ts`, since that module is the friendship graph and this is "find a stranger," a different read. `profiles` is "readable by anyone signed in" per `20260901155633_profiles_policies.sql`, which is what makes this succeed for someone who isn't yet a friend/pending/block. Each hit gets a `Send friend request` button calling `requestFriendship(id)`.

**Error handling**: `err.message` is rendered verbatim in every failure path (`loadError`, `searchError`, `actionError`), each as a `role="alert"` paragraph with the new `.friend-notice` class. Nothing maps or interprets `request_friendship`'s deliberately uninformative refusal — the test `renders a friend-request failure verbatim, without reinterpreting it` rejects with the exact sentence from Task 2 (`'that person cannot be sent a friend request'`) and asserts it appears character-for-character.

## Design language — CSS reused vs. added

Reused as-is, no new variants needed:
- `.panel` for all five top-level blocks.
- `.hud-label` for every section's micro-label.
- `.btn`, `.btn-primary`, `.input` for controls — same sizes as everywhere else in the app (no smaller hit targets invented).
- `.match-list` (already generic: list-style none, flex column, `--space-1` gap) reused verbatim for all four sections' `<ul>`s and the search results list.
- `.friend-code` (already defined, used by `opponentFriendCode`'s existing caller) reused verbatim for showing a friend's code.
- `.text-muted` / `.text-faint` for empty-state copy and "Waiting on them".

Added (components.css, appended after the existing matchmaking block, ~40 lines):
- `.friend-search-row` — flex row for the search input + button, mirroring `.offer-schedule-row`'s shape.
- `.friend-row` — the base row shape for all four sections (flex, wrap, `--text-sm`, `--space-2` gap — the same numbers `.match-row`/`.offer-row` already use, just not reusing those selectors directly since they're shared with the Matchmaking screen and I didn't want to add a rail to rows outside this screen's scope).
- `.friend-row[data-kind='incoming'|'outgoing'|'accepted'|'blocked']` — the coloured 3px `border-left` rail the design brief calls for, one selector per state:
  - `incoming` → `var(--color-accent)` (orange) — needs your answer.
  - `outgoing` → `var(--rule-strong)` (the divider colour) — nothing to do until they act.
  - `accepted` → `var(--color-accent-2)` (cyan) — an established friendship.
  - `blocked` → `var(--text-faint)` — put out of sight on purpose, deliberately the most muted of the four.
  - Search-result rows carry no `data-kind` and so no rail colour (they aren't one of the four states a rail exists to tell apart).
- `.friend-notice` — copies `.matchmaking-notice`/`.team-load-notice`/`.account-alert` verbatim (no `--danger` token exists in this design system, confirmed by their own comments; `--color-accent-2-700` is the established "secondary signal" colour for this).

Literal `3px` for the rail (not `--border-strong`, which is 2px) matches both the brief's explicit language ("a coloured 3px border-left rail") and existing precedent — `.move-tile`, and the rails at components.css:3696/3864/5007, all already use literal `3px solid ...` rather than a token.

## Hue chosen: `var(--type-flying)`

Free hues remaining after auditing every entry in `SCREEN_DEFS` (`app/src/lib/screens.ts`) against the full palette in `app/src/styles/types.css`: `fire`, `ice`, `poison`, `flying`, `bug`, `rock`. Everything else (`normal`, `water`, `electric`, `grass`, `fighting`, `poison`→ used? — no, `psychic`, `bug`→no, `rock`→no, `ghost`, `dragon`, `dark`, `steel`, `fairy`, `ground`) — the actually-used set is: `dragon, fighting, psychic, water, grass, fairy, steel, electric, dark, ghost, ground, normal`.

Picked `flying`. Comment left in `screens.ts` follows the `matchmaking`/`match` entries' own convention (explaining both why NOT some other obvious color and why THIS one, referencing the uniqueness test): every other screen is about a species, a team, or one specific opponent; Friends is the one screen where people appear as a group rather than paired off, which "flying" (a flock) fits, and nothing else had claimed it. Verified free by grepping `types.css` for every `--type-*` token and cross-checking against `HUE_OF` — `fire`, `ice`, `poison`, `bug`, `rock` remain unclaimed after this change.

## Deviations from the brief, with reasoning

1. **Test file uses `renderApp` + `fireEvent`, not `render` + `userEvent`** — per your two corrections in the prompt. Confirmed `userEvent` is genuinely absent as a dependency (didn't hunt further, took the correction as given and it worked).
2. **Extra tests beyond the brief's two given ones** (7 more: decline, withdraw, remove+block, friend code display, unblock, search+send, verbatim error). The brief's own test only exercises the Accept/theyAsked distinction; I judged that Withdraw/Remove/Block/Unblock/search/error-verbatim are all named, load-bearing requirements in "THE SCREEN" section that deserved their own coverage, especially the verbatim-error one given how much emphasis the brief and system prompt both put on never "improving" that sentence.
3. **Button label exactness**: the brief gives `Accept {otherId}` / `Decline {otherId}` with an explicit placeholder syntax, but writes `Withdraw`, `Remove`, `Block`, `Unblock` in backticks with no placeholder. I took that distinction literally — Accept/Decline carry the id in their visible text, the other four do not. If that reading is wrong and per-row uniqueness was actually wanted for all six, it's a small, mechanical change (append `` `${f.otherId}` `` / `` `${id}` `` to four button labels and four test assertions).
4. **Friend code reuse**: rather than writing a new "read a friend's code" query in `FriendsScreen.tsx`, I imported and reused `opponentFriendCode` from `matchmaking.ts` unchanged. It's a generic `friend_codes` read by `profile_id` despite its match-specific name; duplicating the same three-line query felt worse than the mildly awkward import.
5. **No sign-in gate.** `MatchmakingScreen` gates its whole body on `useSession().user`. I deliberately did NOT do this for `FriendsScreen` — the brief's own given test renders it via `renderApp`, whose `SessionProvider` "settles signed-out" per that helper's doc comment, and still expects `listFriends()`/`listBlocks()` to run and the Accept button to appear. Gating on `user` would have made the required test fail. `lib/social.ts`'s functions already read the session internally where they need to (`myId()` in `listFriends`); the screen doesn't need to duplicate that check.
6. **`app/.env.local.bak` and unrelated `.superpowers/sdd/...` files** shown as untracked in `git status` were left alone — not mine, not committed.

## Things I'm not fully sure about

- Whether the "no sign-in gate" choice (point 5) is actually right for how this screen ships in a signed-out state in the real app — currently a signed-out visitor would see `listFriends()`/`listBlocks()` fail (or return empty, depending on what an unauthenticated PostgREST call actually does against these RLS-protected tables) with no dedicated "sign in first" messaging, just whatever `err.message` comes back rendered in `.friend-notice`. The brief doesn't ask for this state explicitly and the given test forbids gating on it, so I left it as-is, but it's worth a second look against whatever `matches`/`matchmaking` screens do for the analogous case.
- I did not add a display name to friend/request rows (they show the raw `otherId` UUID) — `Friend` (Task 4's interface) only carries `otherId`, no name, and the brief doesn't ask for a name lookup for existing friends/requests (only for search). This mirrors how `MatchScreen`/`MatchmakingScreen` also show raw ids/no opponent name in places, so it seemed consistent with the milestone's current scope rather than a gap I introduced — but it's worth confirming that's intentional and not something a later task fills in.

---

## Post-review fix pass (three Important findings)

Three Important review findings against Task 5's `FriendsScreen`/`lib/social.ts` were fixed in one pass. `npm run check` before: EXIT=0, 1230/1230. After: EXIT=0, 1233/1233 (+3 new tests, 0 regressions, 0 skipped), run twice for stability — both runs identical (87 files, 1233 tests, ~33s).

### FIX 1 — `listFriends()` fabricated every request as incoming with no session

**What changed.** `app/src/lib/social.ts`, `listFriends()`: added `if (!me) return [];` right after `const me = await myId();`, with a comment explaining both halves — that the `friendships` SELECT policy (`to authenticated`, no `anon` grant) is what actually keeps an unauthenticated caller from reaching the map today, and that the guard exists anyway because with `me` undefined, `r.user_lo === me` is false for every row (collapsing `otherId` to always `r.user_lo`) and `theyAsked` (`r.requested_by !== me`) is always true — every request, including the caller's own outgoing ones, would render as incoming with an Accept button. The comment cross-references `myMatches()` in `app/src/lib/matches.ts`, which carries the identical guard for the identical reason.

**Covering test.** `app/src/lib/__tests__/social.test.ts`, new test `listFriends > returns no friends rather than fabricating a direction, when there is no session` — mirrors `matches.test.ts`'s `myMatches with no session` test: `getSession` mocked to resolve `{ session: null }`, a real pending row pushed into the mocked `friendships` table (so the test does not rely on RLS ever entering the picture), and asserts `listFriends()` resolves to `[]`.

**Remove-the-guard experiment (exact commands and output):**

Removed `if (!me) return [];` from `listFriends()`, then:
```
cd app && npx vitest run src/lib/__tests__/social.test.ts > /tmp/fix1_removed.log 2>&1; echo "EXIT=$?"
EXIT=1
 ❯ src/lib/__tests__/social.test.ts (2 tests | 1 failed) 5ms
   ✓ listFriends > reports the other side of the pair from either seat 1ms
   × listFriends > returns no friends rather than fabricating a direction, when there is no session 3ms
     → expected [ { otherId: 'abe', …(3) } ] to deeply equal []
```
The new test FAILS without the guard, exactly as expected — it caught the fabricated-incoming-request row (`theyAsked: true` on someone else's request).

Restored the guard, re-ran:
```
cd app && npx vitest run src/lib/__tests__/social.test.ts > /tmp/fix1_restored.log 2>&1; echo "EXIT=$?"
EXIT=0
 ✓ src/lib/__tests__/social.test.ts (2 tests) 1ms
```
Both tests pass with the guard restored. The new test pins the finding — it distinguishes guarded from unguarded code, not merely "passes either way."

### FIX 2 — four buttons sharing one accessible name

**What changed.** `app/src/screens/FriendsScreen.tsx`: `Remove`, `Block`, `Withdraw` and `Unblock` each now carry their row's id in the visible button text — `Remove {f.otherId}`, `Block {f.otherId}`, `Withdraw {f.otherId}`, `Unblock {id}` — the same convention the screen already used for `Accept {otherId}` / `Decline {otherId}`. Chose visible-text-with-id over `aria-label`/`aria-labelledby` for consistency within the component: half the buttons already did it this way, and duplicating the id via `aria-label` on only the other half would leave two different naming strategies in one screen for no reason. Added a paragraph to the component's top doc comment stating this plainly (true of the code as of this change).

**Covering test.** `app/src/screens/__tests__/friends-screen.test.tsx`, new test `gives each Remove button in a multi-friend list its own accessible name`: renders with two accepted friends (`alpha`, `beta`), asserts `findByRole('button', { name: /^remove alpha$/i })` and `.../^remove beta$/i` each resolve to a distinct element, then clicks one and asserts `removeFriendship` was called with the right id. The original 9 tests all used exactly one row per section, which is why none of them could have seen this — the new test uses two, which is the minimum that can distinguish "each button individually addressable" from "one shared name that happens to match once."

The existing single-row assertions for `Withdraw`/`Remove`/`Block`/`Unblock` were updated to match the new per-row text (e.g. `/^remove$/i` → `/^remove mate$/i`) — this is a mechanical adjustment to an assertion tracking a label that intentionally changed shape, not a weakening: each still asserts an exact button name and an exact mutator call.

### FIX 3 — no sign-in gate

**What changed.** `app/src/screens/FriendsScreen.tsx`: added `const { user } = useSession();` and, following `MatchmakingScreen`'s house pattern, an `if (!user) return (...)` gate before the main render that shows a `ScreenHeader` plus a `<div className="panel text-muted">Sign in to send and accept friend requests, see friend codes, and block people.</div>` instead of the four sections and search box. Also guarded the mount effect (`if (!user) return; void load();`, deps `[user]`), matching how `MatchmakingScreen`'s own effects each guard on `user` rather than firing unconditionally — this avoids calling `listFriends()`/`listBlocks()` at all pre-session-resolution, not just discarding their result.

**This is a deliberate deviation from the brief's own test**, per the controller ruling: the brief's `friends-screen.test.tsx` (Step 1) rendered via a plain `render()` with no session-bearing harness and its two tests were written against a screen with no gate, expecting the Accept button to appear despite no signed-in user — that is the exact defect this fix removes. Rewriting the assertions to accept the sign-in panel instead would have weakened the suite (it would then only prove the gate exists, not that the four sections behave correctly once past it); instead, per test:

- **All 9 pre-existing tests** (`offers Accept only...`, `accepts a request`, `declines a request`, `withdraws a request...`, `offers Remove and Block...`, `shows a friend code...`, `lists a blocked account...`, `finds a profile...`, `renders a friend-request failure verbatim...`): **harness changed, assertions unchanged in substance.** Added a module-level `sessionId` variable (default `'me'`) read by a new `../../lib/supabase` mock's `auth.getSession`/`onAuthStateChange` — the same file already had to mock this module for the search box's Supabase calls, so the session was added to that existing mock rather than a second one. `beforeEach` resets `sessionId = 'me'` so every pre-existing test now renders signed-in, same as before the fix broke them, and none of their assertions about button names or mutator calls changed (beyond the FIX-2 label updates described above, which are unrelated to the gate). This is a harness change: the test doubles now supply a session, nothing about what a passing test proves was loosened.
- **New test, `signed out > shows a sign-in panel instead of the four sections`:** sets `sessionId = null` for that test only, renders, and asserts the sign-in panel text appears while `/requests waiting on you/i`, `/no friends yet/i`, `/you have not blocked anyone/i`, and the search label are all absent. This is the one test the brief asked for that did not exist before.

No test's assertion was weakened, skipped, or deleted — the fix only added a session to the harness the existing tests already needed and added one new test for the previously-untested signed-out case.

### Final verification

```
cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```
Re-run once more for stability (constraint: this machine can starve the suite under load):
```
cd app && npm run check > /tmp/app2.log 2>&1; echo "EXIT=$?"
EXIT=0
 Test Files  87 passed (87)
      Tests  1233 passed (1233)
```
Identical both times — no timeouts, no `no Azumarill`/search-not-found flakes. 1230 → 1233 is exactly the three new tests (one per fix): the `listFriends` no-session test, the two-friend Remove-button-naming test, and the signed-out sign-in-panel test.

Files touched: `app/src/lib/social.ts`, `app/src/lib/__tests__/social.test.ts`, `app/src/screens/FriendsScreen.tsx`, `app/src/screens/__tests__/friends-screen.test.tsx`. Nothing under `supabase/` or `app/tools/` touched.
