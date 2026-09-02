### Task 8: The Matchmaking screen

Three panels on one screen, because they are three answers to one question. Signed out, the screen says so and offers nothing — the same shape `TeamBuilderScreen` uses for its save panel.

**Files:**
- Create: `app/src/screens/MatchmakingScreen.tsx`
- Modify: `app/src/lib/screens.ts` (add the `SCREEN_DEFS` entry)
- Modify: `app/src/App.tsx` (add the `case 'matchmaking'`)
- Test: `app/src/screens/__tests__/matchmaking.test.tsx`

**Interfaces:**
- Consumes: everything Task 7 produces, `useSession()`, `LEAGUE_BY_ID`.

- [ ] **Step 1: Write the failing tests**

Mock `../../lib/matchmaking` at the module boundary exactly as `team-saves.test.tsx` mocks `../../lib/saves`, and reuse its `mount()` harness (`vi.resetModules()` then dynamic imports, so the Supabase client mock is in place before `lib/supabase` is imported). Cover:

```ts
it('offers nothing to sign in with when signed out', async () => {
  const { container } = await mount(null);
  expect(container.querySelector('.queue-join')).toBeFalsy();
  expect(container.textContent).toMatch(/sign in/i);
});

it('joins the queue with the roster and format on screen', async () => { /* click, assert joinQueue arg */ });

it('shows the opponent\'s friend code once a match exists', async () => { /* listed match → code rendered */ });

it('asks before leaving a queue it is already in', async () => { /* confirm idiom, as deleteSaved uses */ });

it('disables accept on an offer the signed-in person proposed', async () => {
  // The database refuses it too (match_offers_not_self), but a control that
  // can only fail is a control that should not be offered.
});

it('shows a scheduled offer awaiting confirmation as awaiting, not as a match', async () => {
  // accept_offer returns null for a scheduled offer. Rendering that as
  // "matched" would put a battle on the calendar nobody confirmed.
});
```

- [ ] **Step 2: Run and watch them fail** — `cd app && ./node_modules/.bin/vitest run src/screens/__tests__/matchmaking.test.tsx > /tmp/red.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 3: Build the screen**

Use the existing design language rather than new CSS: `.hud-label` for the micro-labels, `.chip-btn`/`.seg-btn` for the view controls, `.move-picker-panel` for the offer list, `btn btn-primary` for the primary action. **Overlay, do not expand** — the offer board must not shove the panels below it down the page as offers arrive. Never assert layout in jsdom; it applies no stylesheet.

- [ ] **Step 4: Register the screen**

In `app/src/lib/screens.ts`, add to `SCREEN_DEFS`:

```ts
  {
    id: 'matchmaking',
    label: 'Matches',
    kicker: 'Opponents',
    glyph: '⚔',
    hue: 'var(--type-fighting)',
    blurb: 'Queue for a blind match, browse an open offer, or schedule one for later.',
  },
```

In `app/src/App.tsx`, beside the other cases:

```tsx
    case 'matchmaking':
      return <LazyScreen key="matchmaking"><MatchmakingScreen /></LazyScreen>;
```

- [ ] **Step 5: Run the gate and commit**

```bash
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
git add app/src/screens/MatchmakingScreen.tsx app/src/screens/__tests__/matchmaking.test.tsx app/src/lib/screens.ts app/src/App.tsx
git commit -m "feat(matchmaking): queue, the open board, and scheduled proposals"
```

---

