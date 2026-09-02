### Task 5: Formats move to the server, without breaking offline

**Files:**
- Create: `app/src/state/useFormats.ts`, `app/src/state/__tests__/use-formats.test.tsx`
- Modify: `app/src/screens/FormatBuilderScreen.tsx`

**Interfaces:**
- Consumes: `listServerFormats`, `saveServerFormat`, `deleteServerFormat`; `listFormats`,
  `saveFormat`, `deleteFormat` from `formatStore`; `useSession`.
- Produces:

```ts
export const MIGRATED_KEY = 'paragon.formats.migrated.v1';
export interface FormatsApi {
  formats: { id: string; name: string; format: Format }[];
  source: 'local' | 'server';
  loading: boolean;
  migrating: boolean;
  error: string | null;
  save: (name: string, format: Format, id?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}
export function useFormats(): FormatsApi
```

- [ ] **Step 1: Write the failing tests**

Create `app/src/state/__tests__/use-formats.test.tsx`:

```ts
// - Signed out: source is 'local', formats come from formatStore, and saving
//   writes to localStorage and never touches the client.
// - Signed in with nothing local: source is 'server', and listServerFormats
//   is what is read.
// - Signed in with two local formats and nothing migrated yet: both are
//   uploaded exactly once, and MIGRATED_KEY records their local ids.
// - The local copy still EXISTS after a successful migration. A migration that
//   deletes is a migration that loses work when the second upload fails.
// - A second sign-in does not upload them again.
// - A failed upload leaves MIGRATED_KEY untouched, so it retries next time,
//   and surfaces `error` rather than throwing into the screen.
// - Migration is skipped entirely when there is nothing local.
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement the hook**

The shape, in prose so the implementer writes it rather than transcribes it: read `useSession()`;
with no `user`, wrap `formatStore` synchronously and report `source: 'local'`. With a `user`, on
mount, read `MIGRATED_KEY` (a JSON array of local ids), diff it against `listFormats()`, upload each
missing one with `saveServerFormat`, and append its local id to `MIGRATED_KEY` **only after that
upload resolves**. Then `listServerFormats()`. Every `catch` sets `error` and leaves `MIGRATED_KEY`
alone.

- [ ] **Step 4: Point the builder at the hook**

Replace the direct `formatStore` calls in `FormatBuilderScreen.tsx` with `useFormats()`. The screen
becomes async where it was synchronous — disable Save while `migrating` or `loading`, and render
`error` in an `.account-alert`-style block.

- [ ] **Step 5: Run both gates**

```bash
cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 6: Verify the migration against a real database**

With the stack running and a real signed-in user: seed two formats into `localStorage`, sign in,
and confirm with SQL (`select name from public.formats`) that exactly two arrived, that
`localStorage` still holds them, and that signing out and in again adds nothing. A migration is
exactly the kind of code whose tests can all pass while the real thing double-writes.

- [ ] **Step 7: Commit**

```bash
git add app/src/state app/src/screens/FormatBuilderScreen.tsx
git commit -m "feat(formats): yours on the server, still yours offline"
```

---

## Before merging

1. `npm run check` green, `npm run check:db` green, exit codes captured directly.
2. `npm run db:stop`, and stop any dev server you started.
3. Update `docs/superpowers/HANDOFF.md` and the ledger at
   `.superpowers/sdd/2026-09-01-m1b-user-owned-saves/progress.md` (now tracked in git).
4. **Merging to `main` deploys these migrations to production.** Confirm the two new table pairs
   behave on production the way M1a's did: after the deploy, an anonymous `POST` to
   `/rest/v1/teams` must be refused `42501`. An empty table returns `[]` whether RLS is on or off,
   so only a refused write proves the policy is live.

---

## Self-Review

**Spec coverage.** Section 2's *Saves* → `teams` and `team_members` in Task 1, keyed on `ref` with
Shadow in the ref as the spec requires. Section 2's *Formats* → `formats` and `format_versions` in
Task 2, with `rules` + `rules_hash` and immutability. The M1 milestone's "formats migrate from
`localStorage` to the server" → Task 5. Section 3's child-table performance trap — `(select
auth.uid())` and an index on every joined column — is a global constraint and is applied in both
migrations. `saved_searches` is the one *Saves* row not covered, deferred deliberately and argued
above.

**Placeholder scan.** Tasks 1–3 carry complete SQL and TypeScript. Tasks 4 and 5 describe their
tests as an enumerated list of behaviours plus the harness to copy, rather than full source: both
modify screens whose current shape the implementer must read first, and transcribing a stale copy of
`TeamBuilderScreen` into this plan would age worse than naming what to assert. Every behaviour is
named specifically enough to write directly.

**Type consistency.** `StoredMember` is defined once in `teamCodec.ts` and consumed by `saves.ts`
and Task 4 under that name. Its fields match the `team_members` columns exactly (`fast_move`,
`charge_moves`, `iv_attack`, `iv_defense`, `iv_stamina`, `level`) so no mapping layer hides a typo.
`SavedTeam.members` is `StoredMember[]`, and `slot` is added by `saveTeam` at write time rather than
carried on the type — which is why `listTeams` sorts by it before dropping it.

**Known risk.** Task 5's dual store is the piece most able to be subtly wrong, because its failure
mode is silent duplication rather than an error. The `MIGRATED_KEY`-after-success ordering is what
makes a retry safe; if that ordering is reversed, every failed upload becomes permanent data loss
and no test in the list above would catch it unless it asserts the *ordering* rather than the
outcome. Write that test first.
