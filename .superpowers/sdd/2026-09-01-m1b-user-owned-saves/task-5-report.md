# Task 5 report — formats move to the server, without breaking offline

## Summary

Added `app/src/state/useFormats.ts`, the dual-store hook: `localStorage` via
`formatStore` for a signed-out visitor (unchanged behaviour), the server via
`app/src/lib/saves.ts` for a signed-in one, with a one-time migration the
first time a local-format author signs in. Wrote
`app/src/state/__tests__/use-formats.test.tsx` with one `it(...)` per
behaviour enumerated in the brief, plus a dedicated ordering test written and
positioned first, TDD'd red-to-green (8 tests total). Pointed
`FormatBuilderScreen.tsx` at the hook, replacing its direct `formatStore`
calls; Save is now disabled while `loading`/`migrating`, and `error` renders
in an `.account-alert` block instead of being swallowed.

Note on continuity: this task was interrupted mid-implementation by an API
rate limit after the test file and hook were written and green in isolation
(8/8), but before `FormatBuilderScreen.tsx` was touched. Resumed from that
state — verified it matched what the coordinator described, then did Steps
3–7 (screen rewiring, gate, commit, this report).

## Which test covers the marking-after-success ordering

`use-formats.test.tsx`, describe block `'migration ordering — the safety
property'`, the single test:

> `"appends a format's local id to MIGRATED_KEY only after its own upload
> resolves"`

It is the **first** test in the file, per the task's instruction to write the
ordering assertion before any outcome-only one. It does not just check the
end state (which passes under either ordering — mark-first or upload-first).
It spies on `Storage.prototype.setItem` with `vi.spyOn` and instruments the
`saveServerFormat` mock, then uses Vitest's shared `mock.invocationCallOrder`
counter — a single monotonically increasing counter shared across *every*
mock function in the test, not just each mock's own calls — to compare, per
format:

- the call-order index of `saveServerFormat`'s invocation for that format's
  name, against
- the call-order index of the first `localStorage.setItem(MIGRATED_KEY, …)`
  call whose parsed JSON array contains that format's local id,

and asserts the `setItem` order is strictly greater. I confirmed this is
load-bearing by temporarily reordering the hook's loop body (write
`MIGRATED_KEY` before `await saveServerFormat(...)` instead of after) and
re-running just this test — it failed as expected
(`expected 2 to be greater than 3`-shape failure, invocationCallOrder
reversed), then reverted the reorder before moving on. The other listed
outcome-only test (`'uploads both exactly once, and MIGRATED_KEY records
their local ids'`) exists separately and would NOT have caught that
reordering — both checks passed under the deliberately-broken version too — which is exactly the gap the brief warned about.

## RED

First real run, after the hook and test file both existed (before the
`useFormats.ts` module existed at all, `vitest` fails at import resolution —
that transcript is saved at
`.superpowers/sdd/2026-09-01-m1b-user-owned-saves/task-5-red.log`). After
writing `useFormats.ts`, the first substantive RED (behaviour missing, not
module missing) was:

```
 ❯ src/state/__tests__/use-formats.test.tsx (8 tests | 1 failed) 156ms
   ✓ migration ordering — the safety property > appends a format's local id to MIGRATED_KEY only after its own upload resolves 55ms
   ✓ signed out > source is local, formats come from formatStore, and saving writes to localStorage and never touches the client 18ms
   ✓ signed in with nothing local > source is server, and listServerFormats is what is read 14ms
   ✓ signed in with two local formats and nothing migrated yet > uploads both exactly once, and MIGRATED_KEY records their local ids 16ms
   ✓ after a successful migration > the local copy still exists — a migration that deletes loses work when the second upload fails 12ms
   ✓ a second sign-in > does not upload already-migrated formats again 15ms
   × a failed upload > leaves MIGRATED_KEY untouched so it retries next time, and surfaces error rather than throwing into the screen 13ms
     → expected null to be truthy
   ✓ migration with nothing local > is skipped entirely — no upload call is made at all 11ms

 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

Root cause: the mount helper called `renderHook(...)` synchronously.
`SessionProvider` resolves who is signed in asynchronously
(`supabase.auth.getSession()`), so the hook's effect runs once for "nobody
yet" (loading flips false transiently) and again once the real session lands.
`waitFor(() => loading === false)` was sampling the first, transient false in
some interleavings rather than the real terminal one — exactly the class of
race the "an update … was not wrapped in act(...)" warnings elsewhere in this
codebase point at. Fixed by wrapping the mount in `await act(async () => {
renderHook(...) })`, the same pattern `sign-in.test.tsx` and
`team-saves.test.tsx` use for `render(...)`, which drains that whole
signed-out→signed-in transition before the mount call returns.

## GREEN

```
 ✓ src/state/__tests__/use-formats.test.tsx (8 tests) 121ms
   (migration ordering, signed out, signed in/nothing local, signed in/two
   local formats, after-migration local copy exists, second sign-in,
   failed upload, migration skipped — all 8 passing)

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Screen rewiring (Step 3/4)

`FormatBuilderScreen.tsx`:
- Reads `formats`, `loading`, `migrating`, `error`, `save`, `remove` from
  `useFormats()` instead of calling `formatStore` directly.
- `blocked` (which disables Save) now additionally includes `loading` and
  `migrating`.
- `onSave`/delete become `void save(...)` / `void remove(...)` — fire-and-
  forget from the click handler's point of view, with the hook itself setting
  `error` on failure rather than letting a rejection go unhandled.
- A new `{error && <p className="account-alert format-builder-alert" ...>}`
  block renders under `ScreenHeader`, following the account screen's
  established error pattern (`--color-accent-2-700`, no new tokens). No CSS
  was added — `.account-alert` already exists in `components.css`; the extra
  class name `format-builder-alert` is present only in case a follow-up wants
  to target it specifically, and adds no rules of its own.

One behaviour was deliberately not preserved: previously, saving a *new*
format set `editing` to the freshly-created id (via `saveFormat`'s return
value), so a second click of Save without reloading would update that same
entry instead of creating a duplicate. `FormatsApi.save` returns `Promise
<void>` per the brief's specified interface, so that id is not available to
the caller. I did not work around this (e.g. by inferring the newest entry
from the refreshed list by ordering) because it adds real complexity for a
behaviour no test — old or new — exercises, and the interface as specified
implies it deliberately. Flagging it here rather than silently dropping it.

### `format-builder.test.tsx` — required companion fix

This file rendered `<FormatBuilderScreen />` bare, with no `SessionProvider`.
Once the screen calls `useFormats()` → `useSession()`, that throws
"useSession must be used within SessionProvider". Added a local
`renderScreen()` helper wrapping in `<SessionProvider>`, the same fix Task 4
made in the shared `test/render.tsx` for `TeamBuilderScreen` — not done there
this time because this file uses bare `render`, not `renderApp`, and none of
`FormatBuilderScreen`'s children need `AppStateProvider`/`ThemeProvider`
(checked: none of `ClauseEditor`, `FormatSet`, `PoolPreview`, `TypeFilterRow`,
`ScreenHeader` reference those contexts), so wrapping only in `SessionProvider`
keeps the fix minimal rather than pulling in unrelated providers.

`setup.ts`'s suite-wide `@supabase/supabase-js` stub resolves signed-out, and
critically resolves with **no `await` boundary reached in the hook's
signed-out branch** — so `loading` settles to `false` synchronously within
the test's own `render()`/`act()` call, and none of the five existing tests
needed `waitFor`/`act(async …)` added. All five pass unmodified in structure
(only the render call itself changed from `render(<FormatBuilderScreen />)`
to `renderScreen()`).

## App gate

```
cd app && npm run check > /tmp/check7.log 2>&1; echo "EXIT=$?"
EXIT=0
```

```
 Test Files  78 passed (78)
      Tests  1054 passed (1054)
```

1046 pre-existing + 8 new = 1054, exactly as predicted. tsc, oxlint, themes,
token-parity, verify-data, audit:spreads, and rules:node all ran as part of
`check` and passed.

One benign `stderr` line appears in both `format-builder.test.tsx` (all 5
tests) and pre-existing `team-builder.test.tsx`: "An update to SessionProvider
inside a test was not wrapped in act(...)". This is the same pre-existing
async-timing shape Task 4's report already documented for
`team-builder.test.tsx` (SessionContext's own comment calls the analogous
post-unmount case "deliberately untested" for the same reason) — newly
visible in `format-builder.test.tsx` because `SessionProvider` is now in that
file's render tree for the first time. It does not fail any test or the gate.
Left as-is per Task 4's own triage note that this class of warning is
pre-existing and out of scope to silence here.

## Self-review: are the mock/spy assertions load-bearing?

- **Ordering test** — addressed in detail above; confirmed load-bearing by
  breaking the implementation and watching the specific assertion (not a
  different one) fail.
- **"signed out never touches the client"** — `../../lib/saves` is fully
  mocked (`listServerFormats`/`saveServerFormat`/`deleteServerFormat` are all
  bare `vi.fn()`s), and the assertion is `not.toHaveBeenCalled()` on all
  three. If the hook's signed-out branch called any of them, the assertion
  fails — nothing about the mock's behavior makes this true regardless of
  what the hook does.
- **"uploads both exactly once, MIGRATED_KEY records their ids"** — reads
  real `localStorage` (not mocked) via `JSON.parse(localStorage.getItem(...))`
  and compares against the real ids `formatStore.saveFormat` actually
  returned, not a value the mock invented.
- **"second sign-in does not upload again"** — two full mount/unmount cycles
  against the same real `localStorage`, asserting `saveServerFormat`'s total
  call count stays at 2. If the hook re-uploaded on remount, this fails.
- **"failed upload leaves MIGRATED_KEY untouched"** — `saveServerFormat`
  rejects for real (`mockRejectedValue`), and the assertion checks
  `localStorage.getItem(MIGRATED_KEY)` is `null` (real storage, not a mock
  return value) plus `error` contains the real rejection message text.

No assertion in this file depends on a mock recording something the
production code doesn't actually control.

## Not done (explicitly out of scope per the task prompt)

Brief Step 6 (verifying the migration against a real database with a real
signed-in session) — reserved for the controller, per the task prompt. No dev
server was started by this session.

## Commit

```
290bcb2 feat(formats): yours on the server, still yours offline
```

Files: `app/src/state/useFormats.ts`,
`app/src/state/__tests__/use-formats.test.tsx`,
`app/src/screens/FormatBuilderScreen.tsx`,
`app/src/screens/__tests__/format-builder.test.tsx`,
`.superpowers/sdd/2026-09-01-m1b-user-owned-saves/task-5-red.log`.

`progress.md` was left unstaged — it already carried the coordinator's own
running notes on this task at the time I started, and updating it is the
coordinator's bookkeeping, not mine to commit alongside the source change.
