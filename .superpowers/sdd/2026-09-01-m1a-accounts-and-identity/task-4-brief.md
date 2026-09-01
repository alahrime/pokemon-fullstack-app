### Task 4: Policies, with the deny half tested

**Files:**
- Create: `supabase/migrations/<timestamp>_profiles_policies.sql`
- Modify: `supabase/tests/rls.test.ts`

**Interfaces:**
- Produces: policies on `profiles` and `friend_codes`.

**The friend-code policy is the crown jewel.** Readable only if it is yours. Friendship and shared-match conditions arrive in M3 and M5 — write the policy so those are added as `or` branches later, and say so in a comment. Do not stub tables that do not exist yet.

- [ ] **Step 1: Write the failing tests**

Replace the temporary zero-policies test with the real ones. Each needs **both directions**:

- A signed-in user can read their own profile row; a different user can read it too (handles are public), but **cannot update it**.
- A signed-in user can read their **own** friend code.
- A different signed-in user **cannot** read that friend code.
- An **anonymous** request cannot read any friend code.
- A user cannot insert a profile whose `id` is not their own `auth.uid()`.
- **A user cannot change their own `display_name`** — the trigger rejects it. Assert the
  update raises, not merely that the value is unchanged; a silent no-op and a refusal are
  different guarantees.
- A user **can** change their own `go_username`, and **can** change their own friend code —
  both are mutable by design.
- Two profiles may hold the same `go_username`; that insert must succeed.

- [ ] **Step 2: Watch them fail**

They fail because no policy grants anything yet — everything is denied. That is the right RED.

- [ ] **Step 3: Write the policies**

```sql
create policy "profiles are readable by anyone signed in"
  on public.profiles for select
  to authenticated
  using (true);

create policy "a profile is editable only by its owner"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "a profile is created only by its owner"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Readable only by its owner today. M3 adds an accepted-friendship branch and
-- M5 a shared-active-match branch as further `or` conditions; this policy IS
-- the reveal-on-mutual-accept behaviour, not a feature to be written later.
create policy "a friend code is readable by its owner"
  on public.friend_codes for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create policy "a friend code is written only by its owner"
  on public.friend_codes for all
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);
```

`(select auth.uid())` rather than a bare `auth.uid()` is deliberate: RLS predicates evaluate **per row**, and the subquery form lets the planner hoist it once. Retrofitting this once a table is large is a bad afternoon.

- [ ] **Step 4: Require email confirmation locally, so the flow is built against real behaviour**

In `supabase/config.toml`, under `[auth.email]`, set `enable_confirmations = true`.

This matters more than it looks. Left at the default, the local stack auto-confirms and Task 6
would be built and tested against a flow that never asks anyone to check their email — then
behave differently the first time it meets the hosted project. Set it to match.

Confirm the local stack picks it up: `npm run db:stop && npm run db:start`, then check the
setting is live rather than assuming the file was read.

- [ ] **Step 5: The profile-creation trigger, without which the insert policy is unusable**

With confirmations on, `signUp` returns **no session** — so a client has no `auth.uid()` and
cannot satisfy `with check ((select auth.uid()) = id)`. The insert policy from Step 3 is
therefore unusable on its own: nothing can ever create a profile. The trigger is what makes it
work, which is why it lands here rather than in a later task.

Add a second migration (`npx supabase migration new profile_on_confirm`):

```sql
-- Create the profile when an account becomes usable, reading what registration
-- collected out of the signup metadata.
--
-- Fires on confirmation rather than on insert. An insert-time trigger would
-- mint a profile for an account that may never be confirmed, and since
-- display_name is UNIQUE that abandoned row would squat a name nobody can
-- claim. Google arrives already confirmed and is handled by the same path.
--
-- SECURITY DEFINER because the row is created before any session exists, so
-- there is no auth.uid() for a policy to check. search_path is pinned empty,
-- which is Supabase's own hardening guidance for definer functions.
create function public.handle_confirmed_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;
  insert into public.profiles (id, display_name, go_username, birth_date, tos_accepted_at)
  values (
    new.id,
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'go_username',
    (new.raw_user_meta_data ->> 'birth_date')::date,
    coalesce((new.raw_user_meta_data ->> 'tos_accepted_at')::timestamptz, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.handle_confirmed_user();
```

`on conflict (id) do nothing` because the trigger fires on both insert and update, and a Google
signup arrives already confirmed — without it the second firing would raise.

- [ ] **Step 6: Test the trigger against real auth flows**

These need the local stack and the service role key **from the local stack only** — never a
hosted one. Use the CLI's admin API or direct SQL against `auth.users`:

- A user created **unconfirmed** has **no** profile row. This is the squatting case: assert the
  absence, not just that nothing errored.
- Confirming that user creates exactly one profile row carrying the `display_name`,
  `go_username` and `birth_date` from the signup metadata.
- A user created **already confirmed** (the Google path) gets a profile on insert.
- Confirming twice does not raise and does not create a second row.
- A second signup requesting an already-taken `display_name` fails on the unique constraint
  rather than silently producing no profile.

- [ ] **Step 7: Green, then commit**

```bash
git add supabase/migrations supabase/tests supabase/config.toml
git commit -m "feat(db): a friend code only its owner can read, and a profile once confirmed"
```

---

