# Task 3 fix-round 1 re-review package — 74a174a..HEAD

## Commits
4e16ad5 test(db): falsify the friend-code policy's paired-state clause

## Files changed
 supabase/tests/queue.test.ts | 32 ++++++++++++++++++++++++++++++++
 1 file changed, 32 insertions(+)

## Full diff
diff --git a/supabase/tests/queue.test.ts b/supabase/tests/queue.test.ts
index 2da917b..df487ef 100644
--- a/supabase/tests/queue.test.ts
+++ b/supabase/tests/queue.test.ts
@@ -86,16 +86,48 @@ describe('queue and match policies', () => {
     ).rejects.toThrow(/row-level security/);
   });
 
   it('reveals an opponent\'s friend code, and only to an opponent', async () => {
     await sql(`insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')`);
     const stranger = randomUUID();
     await makeUser(stranger, `QT_${stranger.slice(0, 8)}`);
     // Before any match: invisible.
     expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
     await sql(
       `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
        values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-3','queue')`);
     expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
     expect(await asUser({ sub: stranger })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
   });
+
+  /**
+   * The `state = 'paired'` clause is the only thing keeping this policy from
+   * granting an opponent's friend code forever, past the point the match
+   * ended. Nothing else in this file ever inserts a non-'paired' match, so a
+   * policy with that clause dropped — or swapped for something looser like
+   * `state != 'abandoned'` — would pass every other test here undetected.
+   * Same pair, same friend-code row, same querier as the paired case: the
+   * only thing that changes is state, so this is what proves the clause is
+   * load-bearing rather than decorative.
+   */
+  it('stops showing a friend code once the match is abandoned', async () => {
+    // upsert: an earlier test in this file already gave userB a friend code
+    // and afterEach doesn't touch public.friend_codes, so a bare insert
+    // would collide on the profile_id primary key here.
+    await sql(
+      `insert into public.friend_codes (profile_id, code) values ('${userB}', '1234 5678 9012')
+       on conflict (profile_id) do update set code = excluded.code`,
+    );
+    // Ground truth: inserted with the superuser connection, which bypasses
+    // RLS, so its existence is proven independently of the policy under test.
+    await sql(
+      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source, state)
+       values ('${userA}','${userB}','${versionId}','aa','[]'::jsonb,'[]'::jsonb,'rev1','seed-4','queue','paired')`);
+    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(1);
+
+    await sql(`update public.matches set state = 'abandoned' where player_a = '${userA}' and player_b = '${userB}'`);
+    expect(await asUser({ sub: userA })(`select code from public.friend_codes where profile_id = '${userB}'`)).toHaveLength(0);
+    // afterEach deletes every match for userA/userB, but not friend_codes;
+    // clean up explicitly so this row doesn't linger in the partner's DB.
+    await sql(`delete from public.friend_codes where profile_id = '${userB}'`);
+  });
 });
