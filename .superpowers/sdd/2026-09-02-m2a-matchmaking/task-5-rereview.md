# Task 5 fix-round 1 re-review — 4ca27bc..HEAD

## Commits
52128a1 fix(db): confirm_offer refuses to convert an offer whose taker vanished

## Files changed
 .../2026-09-02-m2a-matchmaking/task-5-report.md    | 106 ++++++++++++++++++++-
 ...03011151_confirm_offer_guards_deleted_taker.sql |  48 ++++++++++
 supabase/tests/pairing.test.ts                     |  25 +++++
 3 files changed, 177 insertions(+), 2 deletions(-)

## Full diff
diff --git a/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql b/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql
new file mode 100644
index 0000000..4a96501
--- /dev/null
+++ b/supabase/migrations/20260903011151_confirm_offer_guards_deleted_taker.sql
@@ -0,0 +1,48 @@
+-- confirm_offer() previously trusted that state = 'accepted' implied
+-- accepted_by was a live player. It is not: accepted_by is
+-- `on delete set null`, and the constraint added in the previous migration
+-- is deliberately one-directional (accepted_by null implies nothing about
+-- accepted_team), so a taker who accepted a scheduled offer and then deleted
+-- their account leaves the offer sitting in 'accepted' with accepted_by
+-- null and accepted_team still populated. Nothing about account deletion
+-- touches state, and confirm_offer only checked state <> 'accepted' — so the
+-- proposer, still inside the window, could reach the INSERT below with
+-- accepted_by null, and matches.player_b is NOT NULL. The insert rolled
+-- back, but the failure a client saw was a raw Postgres constraint
+-- violation instead of a clean domain error.
+--
+-- Deliberately NOT also transitioning the offer to 'lapsed' here.
+-- sweep_expired() already reaches this exact row once expires_at passes
+-- (state in ('open', 'accepted')), so the terminal transition already has a
+-- single, already-tested owner; having confirm_offer additionally mutate
+-- state on this error path would duplicate that responsibility for no gain
+-- — the window is time-bounded regardless, and a proposer who retries before
+-- expiry just gets the same clean error again.
+create or replace function public.confirm_offer(p_offer uuid) returns uuid
+language plpgsql security definer set search_path = public as $$
+declare
+  o public.match_offers;
+  me uuid := (select auth.uid());
+  new_match uuid;
+begin
+  select * into o from public.match_offers where id = p_offer for update;
+  if not found then raise exception 'no such offer'; end if;
+  if o.proposer_id <> me then raise exception 'only the proposer confirms'; end if;
+  if o.state <> 'accepted' then raise exception 'this offer has not been accepted yet'; end if;
+  if o.expires_at <= now() then raise exception 'this offer has expired'; end if;
+  if o.accepted_by is null then raise exception 'the person who accepted this offer no longer exists'; end if;
+
+  -- team_b is the roster the taker accepted with, captured by accept_offer()
+  -- into accepted_team — the proposer confirming does not get to supply it.
+  insert into public.matches
+    (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
+  values
+    (o.proposer_id, o.accepted_by, o.format_version_id, o.verified_hash, o.team, o.accepted_team,
+     o.data_rev, gen_random_uuid()::text, 'offer')
+  returning id into new_match;
+  update public.match_offers
+     set state = 'converted', confirmed_at = now(), match_id = new_match
+   where id = p_offer;
+  return new_match;
+end;
+$$;
diff --git a/supabase/tests/pairing.test.ts b/supabase/tests/pairing.test.ts
index b6551c4..7765931 100644
--- a/supabase/tests/pairing.test.ts
+++ b/supabase/tests/pairing.test.ts
@@ -460,21 +460,46 @@ describe('pairing', () => {
 
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
     await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
     await expect(sql(`delete from auth.users where id = '${t}'`)).resolves.toBeDefined();
     expect(
       await sql<{ accepted_by: string | null; accepted_team: unknown }>(
         `select accepted_by, accepted_team from public.match_offers where id = '${o.id}'`,
       ),
     ).toEqual([{ accepted_by: null, accepted_team: ['T'] }]);
   });
+
+  /**
+   * The gap the constraint choice above opens: accepted_by can become null
+   * on an offer still sitting in 'accepted', because nothing about deleting
+   * the taker's account touches `state`. confirm_offer() must recognise that
+   * rather than reach the matches INSERT with a null player_b, which would
+   * surface as a raw NOT NULL violation instead of a clean domain error.
+   */
+  it('refuses to confirm an accepted offer whose taker no longer exists', async () => {
+    const t = randomUUID();
+    await makeUser(t, `PT_${t.slice(0, 8)}`);
+    const o = await offer(', scheduled_for', `, now() + interval '2 days'`);
+    await asUser({ sub: t })(`select public.accept_offer('${o.id}', '["T"]'::jsonb)`);
+    await sql(`delete from auth.users where id = '${t}'`);
+    expect(
+      await sql<{ state: string; accepted_by: string | null }>(
+        `select state, accepted_by from public.match_offers where id = '${o.id}'`,
+      ),
+    ).toEqual([{ state: 'accepted', accepted_by: null }]);
+
+    await expect(asUser({ sub: a })(`select public.confirm_offer('${o.id}')`)).rejects.toThrow(
+      /no longer exists/,
+    );
+    expect(await sql(`select id from public.matches where ${mine()}`)).toHaveLength(0);
+  });
 });
