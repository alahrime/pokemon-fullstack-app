# Task 4 fix-round 1 re-review — 5c89f6f..HEAD

## Commits
dfd6dbe test(offers): third leg for the taker-update denial proof

## Files changed
 supabase/tests/offers.test.ts | 13 +++++++++++++
 1 file changed, 13 insertions(+)

## Full diff
diff --git a/supabase/tests/offers.test.ts b/supabase/tests/offers.test.ts
index 34cbdcc..4513958 100644
--- a/supabase/tests/offers.test.ts
+++ b/supabase/tests/offers.test.ts
@@ -61,36 +61,49 @@ describe('match offer policies', () => {
 
   it('refuses an offer proposed on someone else\'s behalf', async () => {
     await expect(
       asUser({ sub: taker })(
         `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
          values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
     ).rejects.toThrow(/row-level security/);
   });
 
   /**
    * A taker may accept. A taker may NOT rewrite the terms they are accepting.
    *
    * There is no update policy that admits the taker at all (see the migration
    * comment), so the row fails the USING clause before WITH CHECK is ever
    * consulted. Postgres does not raise an error for that case — an UPDATE
    * whose WHERE/USING excludes every row simply reports 0 rows affected, the
    * same as `UPDATE ... WHERE id = <nothing>`. So the proof here isn't a
    * thrown exception; it's that the write touched nothing (0 rows, RETURNING
    * empty) while the superuser connection shows the row still holds its
    * original terms.
+   *
+   * That alone can't tell "the taker was denied" apart from "nobody can
+   * update this table" — a typo in the proposer's own policy would leave the
+   * taker's update at 0 rows too, for the wrong reason. The third leg closes
+   * that gap: the proposer, on the very same row and column, succeeds.
    */
   it('refuses a taker editing the offer\'s terms', async () => {
     const [o] = await offer('public');
     const written = await asUser({ sub: taker })<{ id: string }>(
       `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
     );
     expect(written).toHaveLength(0);
     expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
       { league: 'great' },
     ]);
+    // Same row, same column, different actor: the proposer can.
+    const proposerWrite = await asUser({ sub: proposer })<{ id: string }>(
+      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
+    );
+    expect(proposerWrite).toHaveLength(1);
+    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
+      { league: 'master' },
+    ]);
   });
 
   it('refuses a scheduled offer in the past', async () => {
     await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
   });
 });
