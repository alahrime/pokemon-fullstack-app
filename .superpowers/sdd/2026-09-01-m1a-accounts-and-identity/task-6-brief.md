### Task 6: Sign in, and the age gate

**Files:**
- Create: `app/src/screens/SignInScreen.tsx`
- Test: `app/src/screens/__tests__/sign-in.test.tsx`
- Modify: `app/src/App.tsx`, `app/src/lib/screens.ts`, `app/src/styles/components.css`

**Interfaces:**
- Consumes: `useSession`, `supabase`.

**The age gate is a legal constraint, not a nicety.** Public signup plus a Pokémon audience means under-13s will try. We refuse them: verifiable parental consent under COPPA is a compliance apparatus, and once messaging exists a restricted-minor tier means a permission system across every social surface. A neutral age screen is hours; the other path is its own sub-project.

**Registration collects four things** beyond the auth method itself: the Pokémon GO
username, the email (from the provider for Google, typed for email signup), the date of
birth, and an explicit terms acceptance. The terms document is a placeholder; the
acceptance timestamp is not — consent nobody recorded cannot be backfilled.

- [ ] **Step 1: Write the failing tests**

- A neutral date-of-birth field is shown **before** either sign-in method is offered.
- Registration requires a GO username, and refuses to submit without one.
- Registration requires the terms checkbox, and refuses to submit unticked.
- The terms link points at the placeholder document and is reachable.
- A profile row is created carrying `go_username` and `tos_accepted_at`; email is read
  from the session rather than written to `profiles`.
- A date under 13 shows a refusal and **no** sign-in control appears.
- A date of 13 or over reveals both Google and email sign-in.
- The Google button calls `signInWithOAuth` with the `google` provider.
- Email sign-in calls the email method with what was typed.
- The boundary: exactly 13 today passes; one day short fails. Compute from a fixed clock, not `Date.now()`, or the test rots.

- [ ] **Step 2: Implement**

Neutral age screen first — no "are you 13?" prompt, which invites the obvious answer. Reuse `.btn`, `.chip-btn`, `.hud-label`, and the existing form classes. Verify each token used exists in `tokens.css`.

- [ ] **Step 3: Register the screen**

Read `app/src/lib/screens.ts` and `app/src/App.tsx` first — a new screen needs a `Screen` union member, a `lazy()` import, a case in the `Screens()` switch, and a `screens.ts` entry. `screens.ts` alone only feeds nav metadata; it does not mount anything.

- [ ] **Step 4: Gate, then commit**

```bash
git commit -m "feat(auth): sign in, and a door that is closed to under-13s"
```

---

## Self-Review

**Spec coverage.** Section 2's `profiles` and `friend_codes` land in Task 2 with the separate-table reasoning intact. Section 3's default-deny, the `(select auth.uid())` planner note, the crown-jewel friend-code policy, and both-direction policy tests land in Tasks 3 and 4. The under-13 refusal from "Decisions already taken" lands in Task 6.

**Deliberately deferred to M1b or later.** `teams`/`team_members` and the formats migration are M1b. The friendship and shared-match branches of the friend-code policy need tables that do not exist until M3 and M5; the policy is shaped to receive them. The first deployment is deferred until there is something worth deploying — it needs hosting credentials, and M1b completes the milestone's user-visible value.

**Known risk.** Task 3's impersonation depends on how `auth.uid()` reads `request.jwt.claims`. The plan describes it, but the implementer is told to read `\sf auth.uid` against the running stack before trusting the description — if that is wrong, every policy test is wrong in the same direction and would pass while proving nothing.
