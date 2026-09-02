### Task 4: Saving and loading a roster

**Files:**
- Modify: `app/src/screens/TeamBuilderScreen.tsx`, `app/src/styles/components.css`
- Test: `app/src/screens/__tests__/team-saves.test.tsx`

**Interfaces:**
- Consumes: `listTeams`, `saveTeam`, `deleteTeam` from `app/src/lib/saves.ts`; `encodeMember`,
  `decodeMember` from `app/src/lib/teamCodec.ts`; `useSession` from `app/src/state/SessionContext.tsx`.

**Read `TeamBuilderScreen.tsx` before touching it.** The roster is `team: string[]` (refs) with a
parallel `builds: Record<string, AddPokemonChoice>`. Loading a saved team must set **both**, and the
existing `useEffect` that recomputes the analysis keys off `team`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/screens/__tests__/team-saves.test.tsx`:

```ts
// Assertions, written before the UI exists:
// - Signed out: no save control is rendered, and the builder still works.
// - Signed in with an empty roster: the save control is disabled.
// - Signed in with two members: saving calls saveTeam with both, in slot order.
// - The saved name is what was typed.
// - Loading a saved team replaces the roster outright rather than appending —
//   the screen already has this bug class; see the comment at
//   TeamBuilderScreen.tsx:225 about members silently dropping.
// - Loading a team whose fast move no longer exists shows a notice naming the
//   move, rather than loading a different move silently.
// - Deleting asks for confirmation, and calls deleteTeam only after it.
```

Write each of those as a real `it(...)` using the mock-harness shape from
`src/screens/__tests__/sign-in.test.tsx` (`vi.hoisted` holder + `vi.mock('@supabase/supabase-js')`),
rendering inside `SessionProvider`.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd app && ./node_modules/.bin/vitest run src/screens/__tests__/team-saves.test.tsx
```

- [ ] **Step 3: Implement the controls**

A `.hud-label`ed name field, a `.btn.btn-primary` Save, and a list of saved teams as `.chip-btn`
rows with a delete affordance. Reuse `.account-form`-style stacking; append any new rules to
`components.css` rather than reflowing existing blocks. **Overlay, don't expand** — the saved-team
list must not shove the roster down the page when it grows.

- [ ] **Step 4: Run the app gate**

```bash
cd app && npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 5: Verify in the browser, by measuring**

Start the dev server, sign in, save a roster of three, reload the page, load it back. Confirm with
`getBoundingClientRect()` that the saved-team list does not push the roster below the fold, and
confirm the loaded roster has exactly three members — **not** by screenshot. jsdom applies no
stylesheet and a screenshot hides a 5px shove; this repo has been caught by both.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens app/src/styles/components.css
git commit -m "feat(teams): a roster that survives the tab closing"
```

---

