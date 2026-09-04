# Task 5b review package — 52128a1..HEAD

## Commits
334aeda docs(task-5b): saved-rosters size-scoping implementation report
f8ad45d fix(saves): scope saved rosters to team size, closing the cross-size overwrite hole

## Files changed
 .../2026-09-02-m2a-matchmaking/task-5b-report.md   | 187 +++++++++++++++++++++
 app/src/lib/__tests__/saves.test.ts                |  59 +++++--
 app/src/lib/saves.ts                               |  22 ++-
 app/src/screens/TeamBuilderScreen.tsx              |  50 ++++--
 app/src/screens/__tests__/team-saves.test.tsx      | 147 +++++++++++++++-
 supabase/migrations/20260903020000_teams_size.sql  |  50 ++++++
 supabase/tests/teams.test.ts                       |  83 +++++++--
 7 files changed, 551 insertions(+), 47 deletions(-)

## Full diff
diff --git a/app/src/lib/__tests__/saves.test.ts b/app/src/lib/__tests__/saves.test.ts
index a191dfd..a9acf14 100644
--- a/app/src/lib/__tests__/saves.test.ts
+++ b/app/src/lib/__tests__/saves.test.ts
@@ -44,75 +44,114 @@ function harness(rows: Record<string, unknown[]>, errors: Record<string, { code:
   }
   pkg.client = { from: vi.fn((n: string) => table(n)) };
   return { calls };
 }
 
 beforeEach(() => vi.resetModules());
 
 describe('saved teams', () => {
   it('reads a team and its members into one object', async () => {
     harness({
-      teams: [{ id: 't1', name: 'Mine', league: 'great',
+      teams: [{ id: 't1', name: 'Mine', league: 'great', size: 3,
         team_members: [{ slot: 1, ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM'],
           iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }] }],
     });
     const { listTeams } = await import('../saves');
-    const teams = await listTeams();
+    const teams = await listTeams(3);
     expect(teams).toHaveLength(1);
     expect(teams[0].name).toBe('Mine');
+    expect(teams[0].size).toBe(3);
     expect(teams[0].members[0].ref).toBe('azumarill');
   });
 
+  /**
+   * The scoping that makes the overwrite prompt safe again (task 5b — ledger
+   * Ruling 13). Both builders share one screen and one unfiltered `listTeams`
+   * used to let a 3-roster save offer to replace a same-named 6-roster, and
+   * `saveTeam`'s update path deletes every slot past the new length — three
+   * members gone for a screen the person was not even looking at. Filtering
+   * server-side means a GBL mount never sees a Show 6 roster in the first
+   * place, so the name-only match in the screen can never cross sizes.
+   */
+  it('filters by size server-side rather than trusting the caller to ignore the rest', async () => {
+    const { calls } = harness({ teams: [] });
+    const { listTeams } = await import('../saves');
+    await listTeams(3);
+    const eq = calls.find((c) => c.table === 'teams' && c.op === 'eq');
+    expect(eq?.payload).toEqual(['size', 3]);
+  });
+
   /**
    * The duplicate the builder's prompt cannot catch: a second tab inserted the
    * name after this one read its list. `teams_owner_name_uniq` refuses it, and
    * what comes back is `duplicate key value violates unique constraint …`,
    * which is not a sentence to put in front of someone who named a roster.
    */
   it('names the roster when the database refuses a duplicate name', async () => {
     harness({ teams: [] }, {
       teams: { code: '23505', message: 'duplicate key value violates unique constraint "teams_owner_name_uniq"' },
     });
     const { saveTeam } = await import('../saves');
-    await expect(saveTeam({ name: 'GL Squad', league: 'great', members: [] })).rejects.toThrow(
+    await expect(saveTeam({ name: 'GL Squad', league: 'great', size: 3, members: [] })).rejects.toThrow(
       /A roster called "GL Squad" already exists/,
     );
   });
 
   it('passes an unrelated write failure through untouched', async () => {
     // The guard on the other side: swallowing every write error into one
     // friendly sentence would hide a connection failure behind a name clash.
     harness({ teams: [] }, { teams: { code: '08006', message: 'could not connect to server' } });
     const { saveTeam } = await import('../saves');
-    await expect(saveTeam({ name: 'GL Squad', league: 'great', members: [] })).rejects.toThrow(
+    await expect(saveTeam({ name: 'GL Squad', league: 'great', size: 3, members: [] })).rejects.toThrow(
       /could not connect to server/,
     );
   });
 
   it('writes members in slot order, one row each', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      name: 'Mine', league: 'great',
+      name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
         { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: [], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 41 },
       ],
     });
     const members = calls.find((c) => c.table === 'team_members' && c.op === 'insert');
     expect((members?.payload as { slot: number }[]).map((m) => m.slot)).toEqual([1, 2]);
   });
 
+  /**
+   * Task 5b: `size` is what the database now filters `listTeams` by and
+   * checks against (3 or 6). It has to actually leave the client on both
+   * write paths, or every saved roster lands with no size to be scoped by.
+   */
+  it('sends size on the insert path', async () => {
+    const { calls } = harness({ teams: [{ id: 't1' }] });
+    const { saveTeam } = await import('../saves');
+    await saveTeam({ name: 'Mine', league: 'great', size: 6, members: [] });
+    const insert = calls.find((c) => c.table === 'teams' && c.op === 'insert');
+    expect((insert?.payload as { size: number }).size).toBe(6);
+  });
+
+  it('sends size on the update path', async () => {
+    const { calls } = harness({ teams: [{ id: 't1' }] });
+    const { saveTeam } = await import('../saves');
+    await saveTeam({ id: 't1', name: 'Mine', league: 'great', size: 6, members: [] });
+    const update = calls.find((c) => c.table === 'teams' && c.op === 'update');
+    expect((update?.payload as { size: number }).size).toBe(6);
+  });
+
   it('never writes an owner_id from the client', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
-    await saveTeam({ name: 'Mine', league: 'great', members: [] });
+    await saveTeam({ name: 'Mine', league: 'great', size: 3, members: [] });
     const insert = calls.find((c) => c.table === 'teams' && c.op === 'insert');
     // owner_id comes from a column default of auth.uid(); a client-supplied one
     // is a value the policy then has to agree with, which is a second source of
     // truth for who owns a row.
     expect(Object.keys(insert?.payload as object)).not.toContain('owner_id');
   });
 
   /**
    * The whole point: a roster that shrinks from three to two must not leave a
    * stale slot 3 behind. Both writes are asserted — a suite that only checked
@@ -120,21 +159,21 @@ describe('saved teams', () => {
    * scoping is asserted explicitly, by value, not merely that `eq`/`gt` were
    * called: a delete scoped only by team_id would wipe the whole roster (the
    * data-loss bug this design exists to avoid), and a wrong bound would
    * strand or over-delete rows — either failure leaves the delete COUNT at 1,
    * so the count alone cannot tell the two apart from a correct delete.
    */
   it('editing a team upserts the surviving slots and deletes only what is beyond them', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      id: 't1', name: 'Mine', league: 'great',
+      id: 't1', name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
         { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: [], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 41 },
       ],
     });
     const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
     expect((upsert?.payload as { slot: number }[]).map((m) => m.slot)).toEqual([1, 2]);
     const deletes = calls.filter((c) => c.table === 'team_members' && c.op === 'delete');
     expect(deletes).toHaveLength(1);
     const scopedByTeam = calls.find((c) => c.table === 'team_members' && c.op === 'eq');
@@ -145,21 +184,21 @@ describe('saved teams', () => {
 
   /**
    * Editing a team down to nothing is the shrink case taken to its limit:
    * every member must go, the upsert is skipped (nothing to write), and the
    * delete's bound becomes `gt('slot', 0)` — every slot is greater than 0, so
    * every row qualifies. Nothing exercised this path before.
    */
   it('editing a team to an empty roster removes every member', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
-    await saveTeam({ id: 't1', name: 'Mine', league: 'great', members: [] });
+    await saveTeam({ id: 't1', name: 'Mine', league: 'great', size: 3, members: [] });
     const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
     expect(upsert).toBeUndefined();
     const deletes = calls.filter((c) => c.table === 'team_members' && c.op === 'delete');
     expect(deletes).toHaveLength(1);
     const scopedByTeam = calls.find((c) => c.table === 'team_members' && c.op === 'eq');
     expect(scopedByTeam?.payload).toEqual(['team_id', 't1']);
     const boundedBySlot = calls.find((c) => c.table === 'team_members' && c.op === 'gt');
     expect(boundedBySlot?.payload).toEqual(['slot', 0]);
   });
 
@@ -167,37 +206,37 @@ describe('saved teams', () => {
    * The ordering IS the fix for the data-loss window: upsert first means a
    * failed upsert leaves the old roster untouched, and a failed delete after
    * it leaves stale extra slots rather than an empty team. A refactor that
    * swapped this back to delete-then-insert would pass every other test here
    * while reopening the window, so the order itself has to be asserted.
    */
   it('upserts the new roster before deleting the slots it no longer needs', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      id: 't1', name: 'Mine', league: 'great',
+      id: 't1', name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
       ],
     });
     const upsertIdx = calls.findIndex((c) => c.table === 'team_members' && c.op === 'upsert');
     const deleteIdx = calls.findIndex((c) => c.table === 'team_members' && c.op === 'delete');
     expect(upsertIdx).toBeGreaterThanOrEqual(0);
     expect(deleteIdx).toBeGreaterThanOrEqual(0);
     expect(upsertIdx).toBeLessThan(deleteIdx);
   });
 
   it('never writes an owner_id from the client when editing, either', async () => {
     const { calls } = harness({ teams: [{ id: 't1' }] });
     const { saveTeam } = await import('../saves');
     await saveTeam({
-      id: 't1', name: 'Mine', league: 'great',
+      id: 't1', name: 'Mine', league: 'great', size: 3,
       members: [
         { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
       ],
     });
     const update = calls.find((c) => c.table === 'teams' && c.op === 'update');
     expect(Object.keys(update?.payload as object)).not.toContain('owner_id');
     const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
     expect(Object.keys((upsert?.payload as { team_id: string }[])[0])).not.toContain('owner_id');
   });
 });
diff --git a/app/src/lib/saves.ts b/app/src/lib/saves.ts
index 2ba04d1..5264761 100644
--- a/app/src/lib/saves.ts
+++ b/app/src/lib/saves.ts
@@ -1,39 +1,50 @@
 import { supabase } from './supabase';
 import { rulesHash, type Format } from '../rules';
 import type { LeagueId } from './types';
 import type { StoredMember } from './teamCodec';
 
 export interface SavedTeam {
   id: string;
   name: string;
   league: LeagueId;
+  size: 3 | 6;
   members: StoredMember[];
 }
 
 /**
  * `owner_id` is never sent from here. It defaults to `auth.uid()` in the
  * database, so who owns a row is decided in one place; a client-supplied owner
  * is a second source of truth the policy then has to agree with.
+ *
+ * `size` is required, not optional: GBL and Show 6 render the same
+ * TeamBuilderScreen and used to share one unfiltered list, which is how a
+ * same-named 6-roster ended up in the GBL picker's overwrite prompt and lost
+ * three members to a 3-roster save (task 5b, ledger Ruling 13). Filtering
+ * server-side with `.eq('size', size)` means a screen never even RECEIVES a
+ * roster of the other size — the scoping the overwrite prompt now depends on
+ * for its safety happens here, not as a client-side afterthought.
  */
-export async function listTeams(): Promise<SavedTeam[]> {
+export async function listTeams(size: 3 | 6): Promise<SavedTeam[]> {
   const { data, error } = await supabase
     .from('teams')
-    .select('id, name, league, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
+    .select('id, name, league, size, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
+    .eq('size', size)
     .order('updated_at', { ascending: false });
   if (error) throw new Error(error.message);
   return (data ?? []).map((row) => {
-    const r = row as { id: string; name: string; league: LeagueId; team_members: (StoredMember & { slot: number })[] };
+    const r = row as { id: string; name: string; league: LeagueId; size: 3 | 6; team_members: (StoredMember & { slot: number })[] };
     return {
       id: r.id,
       name: r.name,
       league: r.league,
+      size: r.size,
       members: [...r.team_members].sort((a, b) => a.slot - b.slot),
     };
   });
 }
 
 /**
  * A write failure, made sayable.
  *
  * A duplicate name reaching Postgres means the builder's own check missed it —
  * a second tab, or a list this tab read before that tab wrote. The index that
@@ -53,27 +64,28 @@ function writeError(error: { code?: string; message: string }, name: string): Er
       `A roster called "${name}" already exists. Open the saved list to refresh it, then save again to replace that roster.`,
     );
   }
   return new Error(error.message);
 }
 
 export async function saveTeam(t: {
   id?: string;
   name: string;
   league: LeagueId;
+  size: 3 | 6;
   members: StoredMember[];
 }): Promise<string> {
   let id = t.id;
   if (id) {
     const { error } = await supabase
       .from('teams')
-      .update({ name: t.name, league: t.league, updated_at: new Date().toISOString() })
+      .update({ name: t.name, league: t.league, size: t.size, updated_at: new Date().toISOString() })
       .eq('id', id);
     if (error) throw writeError(error, t.name);
     // UPSERT the new slots BEFORE deleting anything beyond the new length —
     // never delete-then-insert. The two writes are not one transaction, so
     // their order decides which failure direction is recoverable. Upsert
     // first: if the upsert fails, the OLD roster is untouched — nothing is
     // lost. Delete second, scoped to slots past the new length: if that
     // delete fails, the team is left with stale extra slots, which is
     // visible and easy to clean up by saving again. Reversing this order —
     // delete all, then insert — has a window where an insert failing after
@@ -91,21 +103,21 @@ export async function saveTeam(t: {
     }
     const { error: clearError } = await supabase
       .from('team_members')
       .delete()
       .eq('team_id', id)
       .gt('slot', t.members.length);
     if (clearError) throw new Error(clearError.message);
   } else {
     const { data, error } = await supabase
       .from('teams')
-      .insert({ name: t.name, league: t.league })
+      .insert({ name: t.name, league: t.league, size: t.size })
       .select('id')
       .single();
     if (error) throw writeError(error, t.name);
     id = (data as { id: string }).id;
     if (t.members.length > 0) {
       const { error: insertError } = await supabase
         .from('team_members')
         .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
       if (insertError) throw new Error(insertError.message);
     }
diff --git a/app/src/screens/TeamBuilderScreen.tsx b/app/src/screens/TeamBuilderScreen.tsx
index a9d1e9d..bfa8281 100644
--- a/app/src/screens/TeamBuilderScreen.tsx
+++ b/app/src/screens/TeamBuilderScreen.tsx
@@ -209,24 +209,35 @@ function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
  *
  * Compared case-insensitively and trimmed, because "GL Squad" and "gl squad"
  * are one roster to the person typing them and two rows to Postgres — nothing
  * in the database forbids the duplicate, so the only thing standing between a
  * name and a second identical entry in the load list is this comparison.
  *
  * `listTeams` orders by `updated_at` descending, so index 0 is the most
  * recently touched. Ties are possible: anything saved before this screen could
  * overwrite may already have left duplicates behind.
  */
-function rostersNamed(saved: SavedTeam[] | null, name: string): SavedTeam[] {
+/**
+ * `size` is checked here too, not only trusted from the server-side
+ * `.eq('size', size)` in `listTeams` — belt and suspenders. `listTeams` being
+ * scoped is what stops a roster of the other size from ever reaching
+ * `savedTeams` in the first place, but this is the line that actually decides
+ * whether to offer a replace, and a stale fetch or a future regression in
+ * that scoping should not be able to resurrect the bug this whole screen
+ * exists to close (task 5b, ledger Ruling 13): a same-named roster from the
+ * OTHER size matching here is exactly what let a 3-roster save delete three
+ * members of a 6-roster nobody was looking at.
+ */
+function rostersNamed(saved: SavedTeam[] | null, name: string, size: 3 | 6): SavedTeam[] {
   const key = name.trim().toLowerCase();
   if (key === '') return [];
-  return (saved ?? []).filter((t) => t.name.trim().toLowerCase() === key);
+  return (saved ?? []).filter((t) => t.size === size && t.name.trim().toLowerCase() === key);
 }
 
 /**
  * What to ask before replacing one. Says which roster, and names anything about
  * the replacement that is not obvious from the slots on screen.
  */
 function replacePrompt(target: SavedTeam, matchCount: number, league: LeagueId): string {
   const parts = [`Replace "${target.name}" with the roster in the slots above?`];
   // saveTeam's update path rewrites `league` along with the members, so this
   // can change the cap the roster is judged under without touching a control
@@ -273,20 +284,29 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
   // the game is.
   const pool = useMemo(() => new Set(teamPool(league)), [league]);
   const selectable = useMemo(
     () =>
       new Set(
         pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r))),
       ),
     [league, team],
   );
   const full = team.length === size;
+  /**
+   * Why the save control is disabled when the roster is non-empty but not
+   * exactly `size` yet — shown the same way a blank name gets a reason (see
+   * `team-save-hint` below). Silent before this: the only gate was
+   * `team.length === 0`, so a 1-of-6 saved without anything on screen saying
+   * it was incomplete (task 5b).
+   */
+  const saveIncompleteReason =
+    team.length > 0 && team.length < size ? `Add ${size - team.length} more to save this roster.` : null;
 
   const invalidate = () => {
     setReport(null);
     setSix(null);
     setPicks(null);
   };
   // Functional updates, not `setTeam([...team, ref])`. Two picks landing in the
   // same tick both read the `team` their own render closed over, so the second
   // overwrites the first instead of appending — which silently dropped members
   // and left the roster looking like it had chosen at random.
@@ -356,62 +376,66 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
 
   useEffect(() => {
     if (!user) {
       setSavedTeams(null);
       return;
     }
     // Guards a fetch that outlives its own sign-in: signing out while the
     // request is in flight must not resurrect `savedTeams` for a session that
     // no longer exists.
     let live = true;
-    listTeams()
+    listTeams(size)
       .then((teams) => {
         if (live) setSavedTeams(teams);
       })
       .catch((e: unknown) => {
         if (live) setSavesError(e instanceof Error ? e.message : String(e));
       });
     return () => {
       live = false;
     };
-  }, [user]);
+  }, [user, size]);
 
   const saveRoster = async () => {
-    if (team.length === 0 || saving) return;
+    // A complete roster, not merely a non-empty one — see the button's own
+    // `disabled` condition below, which this mirrors. `team.length === 0`
+    // alone (the old check) let a 1-of-6 be saved with nothing to say it was
+    // incomplete (task 5b).
+    if (team.length !== size || saving) return;
     const name = saveName.trim();
     // Saving under a name already in the list updates that roster instead of
     // writing a second row with the same label — but only when asked for. The
     // update path replaces every member, so an unprompted overwrite would be
     // indistinguishable from losing a roster.
     //
     // This reads the list already in state rather than re-fetching: it is
     // refreshed on sign-in and after every save and delete, which covers one
     // browser. It does NOT close the window where a second tab inserts the
     // same name between this check and the write — nothing but a unique index
     // on (owner_id, name) can, and there is none.
-    const clashes = rostersNamed(savedTeams, name);
+    const clashes = rostersNamed(savedTeams, name, size);
     const target = clashes[0];
     // Declining writes nothing at all. Falling back to an insert here would
     // answer "don't replace it" with a duplicate, which is what this whole
     // affordance exists to stop.
     if (target && !window.confirm(replacePrompt(target, clashes.length, league))) return;
     setSaving(true);
     setSavesError(null);
     try {
       // Every member is encoded, whether it went through the build modal or
       // not — `builds` has no entry for a ref added through the quick search,
       // and `defaultChoice` is what that ref is actually carrying (the rated
       // set `Slot` falls back to), not nothing.
       const members = team.map((ref) => encodeMember(builds[ref] ?? defaultChoice(ref, league), league));
-      await saveTeam({ id: target?.id, name, league, members });
+      await saveTeam({ id: target?.id, name, league, size, members });
       setSaveName('');
-      setSavedTeams(await listTeams());
+      setSavedTeams(await listTeams(size));
     } catch (e) {
       setSavesError(e instanceof Error ? e.message : String(e));
     } finally {
       setSaving(false);
     }
   };
 
   // Sets both `team` and `builds` — and REPLACES rather than merges into
   // either. See the comment on `add`/`t.includes` above: this screen has a
   // history of a second write landing on top of the render the first one
@@ -446,21 +470,21 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
     setBuilds(nextBuilds);
     invalidate();
     setSavedOpen(false);
     setLoadNotice(notices.length > 0 ? notices.join(' ') : null);
   };
 
   const deleteSaved = async (t: SavedTeam) => {
     if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
     try {
       await deleteTeam(t.id);
-      setSavedTeams(await listTeams());
+      setSavedTeams(await listTeams(size));
     } catch (e) {
       setSavesError(e instanceof Error ? e.message : String(e));
     }
   };
 
   const run = () => {
     setBusy(true);
     // Yield once so the button paints its busy state before the sim blocks.
     setTimeout(() => {
       const t0 = performance.now();
@@ -580,21 +604,26 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
           <div className="team-saves">
             <div className="team-saves-row">
               <label className="hud-label" htmlFor="team-save-name">Save this roster</label>
               <input
                 id="team-save-name"
                 className="input team-save-name"
                 placeholder="Name this roster"
                 value={saveName}
                 onChange={(e) => setSaveName(e.target.value)}
               />
-              <button className="btn btn-primary" disabled={team.length === 0 || saveName.trim() === '' || saving} onClick={saveRoster}>
+              <button
+                className="btn btn-primary"
+                disabled={team.length !== size || saveName.trim() === '' || saving}
+                title={saveIncompleteReason ?? undefined}
+                onClick={saveRoster}
+              >
                 {saving ? 'Saving…' : 'Save roster'}
               </button>
               {/* Overlays the panel rather than growing it — a roster list that
                   gets longer with use must not shove the slots above it down
                   the page every time something new is saved. */}
               <div className="team-load-picker">
                 <button
                   type="button"
                   className="btn move-picker-btn"
                   aria-expanded={savedOpen}
@@ -632,20 +661,21 @@ export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
                               Delete
                             </button>
                           </li>
                         ))}
                       </ul>
                     )}
                   </div>
                 )}
               </div>
             </div>
+            {saveIncompleteReason && <p className="team-save-hint text-faint">{saveIncompleteReason}</p>}
             {loadNotice && <p className="team-load-notice">{loadNotice}</p>}
             {savesError && <p className="team-load-notice" role="alert">{savesError}</p>}
           </div>
         )}
         <div className="team-actions">
           {/* Two members, not a full roster. What beats a partial team and
               which swap answers it are per-member measurements — they do not
               need the empty slots filled, and the questions are at their most
               useful while there are still slots to fill. Only the chain result
               and the matrix game need a fieldable line; those say so
diff --git a/app/src/screens/__tests__/team-saves.test.tsx b/app/src/screens/__tests__/team-saves.test.tsx
index 2f925e4..2cc7ee2 100644
--- a/app/src/screens/__tests__/team-saves.test.tsx
+++ b/app/src/screens/__tests__/team-saves.test.tsx
@@ -72,25 +72,32 @@ function choiceFor(ref: string): AddPokemonChoice {
   const sp = speciesOf(ref)!;
   const rated = movesFor(sp, 'great');
   return {
     ref,
     fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
     chargeIds: rated.charges.map((c) => c.id),
     iv: { a: 0, d: 15, s: 15 },
   };
 }
 
-function savedTeam(id: string, name: string, refs: string[], league: SavedTeam['league'] = 'great'): SavedTeam {
+function savedTeam(
+  id: string,
+  name: string,
+  refs: string[],
+  league: SavedTeam['league'] = 'great',
+  size: SavedTeam['size'] = 3,
+): SavedTeam {
   return {
     id,
     name,
     league,
+    size,
     members: refs.map((r) => encodeMember(choiceFor(r), league)),
   };
 }
 
 /** Add a named Pokemon through the live search dropdown. Copied from
  * team-builder.test.tsx's `pick` — reading the first row synchronously after
  * the change event reads the *previous* render's list. */
 async function pick(container: HTMLElement, typed: string) {
   const input = container.querySelector('.team-add input') as HTMLInputElement;
   fireEvent.focus(input);
@@ -150,49 +157,146 @@ describe('signed in', () => {
 
   it('enables saving once there are members AND a name, and saves both in slot order', async () => {
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
     await pick(container, 'registeel');
     // Members alone are not enough — a blank name would write a row whose
     // Load button has no text (Finding 2).
     expect(saveButton(container)!.disabled).toBe(true);
 
     fireEvent.change(nameInput(container), { target: { value: 'My Team' } });
+    // A name alone is not enough either now: two of three, named, still is
+    // not a saveable roster (task 5b) — today's only check was
+    // `team.length === 0`, which let a 1-of-6 be saved.
+    expect(saveButton(container)!.disabled).toBe(true);
+
+    await pick(container, 'skarmory');
     expect(saveButton(container)!.disabled).toBe(false);
     await act(async () => {
       fireEvent.click(saveButton(container)!);
     });
 
     await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
-    const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string; league: string; members: { ref: string }[] };
-    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel']);
+    const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string; league: string; size: number; members: { ref: string }[] };
+    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+    expect(arg.size).toBe(3);
   });
 
-  it('keeps save disabled for a whitespace-only name, even with members added', async () => {
+  it('keeps save disabled for a whitespace-only name, even with a complete roster', async () => {
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
+    await pick(container, 'registeel');
+    await pick(container, 'skarmory');
     fireEvent.change(nameInput(container), { target: { value: '   ' } });
     expect(saveButton(container)!.disabled).toBe(true);
   });
 
   it('saves the name exactly as typed', async () => {
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
+    await pick(container, 'registeel');
+    await pick(container, 'skarmory');
     fireEvent.change(nameInput(container), { target: { value: 'Rain Squad' } });
     await act(async () => {
       fireEvent.click(saveButton(container)!);
     });
     await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
     const arg = savesApi.saveTeam.mock.calls[0][0] as { name: string };
     expect(arg.name).toBe('Rain Squad');
   });
 
+  /**
+   * Task 5b's save gate: `team.length === size`, not merely `> 0`. This is
+   * what closes the 1-of-6-save hole — the old check let a wildly partial
+   * roster be written, silently, as long as it had at least one member and a
+   * name.
+   */
+  describe('the save control requires a complete roster', () => {
+    it('stays disabled for a partial GBL team of three, even named, and says why', async () => {
+      const { container } = await mount(3, fakeSession('ash@example.com'));
+      await pick(container, 'azumarill');
+      fireEvent.change(nameInput(container), { target: { value: 'Partial' } });
+      const btn = saveButton(container)!;
+      expect(btn.disabled).toBe(true);
+      // Says why, the way the blank-name case does — a disabled control with
+      // no visible reason is indistinguishable from a broken one.
+      expect(container.textContent).toMatch(/add 2 more to save/i);
+    });
+
+    it('enables at exactly three for GBL, not before and not by allowing a fourth', async () => {
+      const { container } = await mount(3, fakeSession('ash@example.com'));
+      await pick(container, 'azumarill');
+      await pick(container, 'registeel');
+      fireEvent.change(nameInput(container), { target: { value: 'Full Three' } });
+      expect(saveButton(container)!.disabled).toBe(true);
+      await pick(container, 'skarmory');
+      expect(saveButton(container)!.disabled).toBe(false);
+    });
+
+    it('stays disabled for a partial Show 6 roster, even named, and says why', async () => {
+      const { container } = await mount(6, fakeSession('ash@example.com'));
+      await pick(container, 'azumarill');
+      await pick(container, 'registeel');
+      fireEvent.change(nameInput(container), { target: { value: 'Partial Six' } });
+      const btn = saveButton(container)!;
+      expect(btn.disabled).toBe(true);
+      expect(container.textContent).toMatch(/add 4 more to save/i);
+    });
+
+    it('enables at exactly six for Show 6, and sends size 6', async () => {
+      const { container } = await mount(6, fakeSession('ash@example.com'));
+      for (const r of ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash']) {
+        await pick(container, r);
+      }
+      fireEvent.change(nameInput(container), { target: { value: 'Full Six' } });
+      expect(saveButton(container)!.disabled).toBe(false);
+      await act(async () => {
+        fireEvent.click(saveButton(container)!);
+      });
+      await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
+      const arg = savesApi.saveTeam.mock.calls[0][0] as { size: number; members: { ref: string }[] };
+      expect(arg.size).toBe(6);
+      expect(arg.members).toHaveLength(6);
+    });
+  });
+
+  /**
+   * The scoping that makes the overwrite prompt safe again. Before this, both
+   * builders shared one unfiltered `listTeams()`, so a same-named roster from
+   * the OTHER builder's size would show up as a match — and the overwrite
+   * this screen offers deletes every slot past the new length (see the brief
+   * and ledger Ruling 13). `listTeams` mocked here to actually honour the
+   * `size` argument, the way the real server-side `.eq('size', size)` would,
+   * so this test fails the way production would fail if the screen ever
+   * stopped passing its own size through.
+   */
+  it("never shows a Show 6 roster in the GBL picker, because listTeams is asked for size 3 only", async () => {
+    const sixRoster = savedTeam(
+      't-six',
+      'Shared Name',
+      ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash'],
+      'great',
+      6,
+    );
+    savesApi.listTeams.mockImplementation(async (size: number) => (size === 6 ? [sixRoster] : []));
+    const { container } = await mount(3, fakeSession('ash@example.com'));
+    expect(savesApi.listTeams).toHaveBeenCalledWith(3);
+    openSavedList(container);
+    await waitFor(() => expect(container.querySelector('.team-load-panel')).toBeTruthy());
+    expect(container.textContent).not.toMatch(/Shared Name/);
+  });
+
+  it('asks listTeams for its own size on mount', async () => {
+    await mount(6, fakeSession('ash@example.com'));
+    expect(savesApi.listTeams).toHaveBeenCalledWith(6);
+  });
+
   it('replaces the roster outright when loading a saved team, not appending to it', async () => {
     // The roster already carries two DIFFERENT members before the load. If the
     // screen appended instead of replacing, the roster would hold 4 (or more)
     // and would still contain azumarill/registeel — a superset, not the loaded
     // set. Asserting the exact final set is the only check that distinguishes
     // "replaced" from "happened to be the same length".
     savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'Rain Team', ['medicham', 'skarmory'])]);
     const { container } = await mount(3, fakeSession('ash@example.com'));
     await pick(container, 'azumarill');
     await pick(container, 'registeel');
@@ -341,42 +445,73 @@ describe('signed in', () => {
  * `saveTeam`'s update path took an `id` from the day it was written and had no
  * caller: every save from this screen omitted `id`, so every save inserted, and
  * saving twice under one name left two rows with the same label in the load
  * list and no way to tell them apart. These tests are about which of the two
  * branches the screen reaches, so they assert on the `id` argument — the only
  * thing that distinguishes them.
  */
 describe('saving over an existing roster', () => {
   const session = () => fakeSession('ash@example.com');
 
-  /** Build a roster and type `name` into the save box. */
+  /** Build a full roster (exactly `size`, here always 3) and type `name` into the save box. */
   async function rosterNamed(container: HTMLElement, name: string) {
     await pick(container, 'azumarill');
     await pick(container, 'registeel');
+    await pick(container, 'skarmory');
     fireEvent.change(nameInput(container), { target: { value: name } });
   }
 
   it('asks first, then updates the existing row instead of inserting a second one', async () => {
     savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
     const { container } = await mount(3, session());
     await rosterNamed(container, 'GL Squad');
 
     const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
     await act(async () => {
       fireEvent.click(saveButton(container)!);
     });
 
     expect(confirmSpy).toHaveBeenCalledTimes(1);
     await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
     const arg = savesApi.saveTeam.mock.calls[0][0] as { id?: string; name: string; members: { ref: string }[] };
     expect(arg.id).toBe('t1');
-    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel']);
+    expect(arg.members.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
+    confirmSpy.mockRestore();
+  });
+
+  /**
+   * Task 5b's whole point. Before the list was scoped by size, this exact
+   * scenario — a same-named roster of the OTHER size sitting in `savedTeams`
+   * — is what let a 3-roster save offer to replace a 6-roster, and the
+   * update path then deletes every slot past 3. `listTeams` is scoped
+   * server-side now, so this roster would never really reach a `size=3`
+   * mount's `savedTeams` — but the match itself is asserted here too
+   * (defense in depth against a stale fetch or a future regression in that
+   * scoping), by forcing exactly the state a scoping bug would produce.
+   */
+  it('does not offer to replace a same-named roster of a different size', async () => {
+    savesApi.listTeams.mockResolvedValue([
+      savedTeam('t-six', 'GL Squad', ['medicham', 'skarmory', 'bastiodon', 'whiscash', 'registeel', 'azumarill'], 'great', 6),
+    ]);
+    const { container } = await mount(3, session());
+    await rosterNamed(container, 'GL Squad');
+
+    const confirmSpy = vi.spyOn(window, 'confirm');
+    await act(async () => {
+      fireEvent.click(saveButton(container)!);
+    });
+
+    expect(confirmSpy).not.toHaveBeenCalled();
+    await waitFor(() => expect(savesApi.saveTeam).toHaveBeenCalledTimes(1));
+    // No id: this is an insert, not the update path that would delete the
+    // six's slots 4-6.
+    expect((savesApi.saveTeam.mock.calls[0][0] as { id?: string }).id).toBeUndefined();
     confirmSpy.mockRestore();
   });
 
   it('writes nothing at all when the replacement is declined', async () => {
     savesApi.listTeams.mockResolvedValue([savedTeam('t1', 'GL Squad', ['medicham'])]);
     const { container } = await mount(3, session());
     await rosterNamed(container, 'GL Squad');
 
     const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
     await act(async () => {
diff --git a/supabase/migrations/20260903020000_teams_size.sql b/supabase/migrations/20260903020000_teams_size.sql
new file mode 100644
index 0000000..ec243bf
--- /dev/null
+++ b/supabase/migrations/20260903020000_teams_size.sql
@@ -0,0 +1,50 @@
+-- Saved rosters gain a size (task 5b — reported by the human partner mid-M2a,
+-- ledger Ruling 13).
+--
+-- Both builders — GBL (size=3) and Show 6 (size=6) — rendered the same
+-- TeamBuilderScreen and shared one unfiltered `listTeams()`. That meant every
+-- roster showed up in both pickers, distinguishable only by name, and the
+-- overwrite prompt this screen offers — added the same day this migration was
+-- written — matched a same-named roster from EITHER size. Its update path
+-- upserts the new slots and then deletes every slot past the new length, so
+-- saving a 3-roster under a name already used by a 6-roster silently deleted
+-- three of that six's members. This migration is what lets the client scope
+-- `listTeams` and the save gate to one size, closing that hole at the source
+-- rather than patching the symptom in the screen.
+--
+-- The rule: size is a consequence of the screen a roster was saved from, not
+-- a stored guess. A roster saved from Show 6 is a 6-roster; one from GBL is a
+-- 3-roster — never anything else.
+alter table public.teams add column size smallint;
+
+-- Backfill is exact for every roster that exists: the partner's local
+-- database holds exactly 2 saved rosters, both complete at 6 members, and
+-- production holds no rows at all (no accounts yet). All of them are
+-- complete, and from here on the save gate guarantees completeness, so member
+-- count IS the size. The `> 3` form rather than `= 6` so a partial roster
+-- predating this rule (none exist today, but the check below cannot assume
+-- that forever) lands somewhere deterministic rather than violating the
+-- check that follows.
+update public.teams t
+   set size = case when (select count(*) from public.team_members m where m.team_id = t.id) > 3 then 6 else 3 end;
+
+alter table public.teams alter column size set not null;
+alter table public.teams add constraint teams_size check (size in (3, 6));
+
+-- The name-uniqueness index widens to include size. Under the new rule a GBL
+-- "Core" and a Show 6 "Core" are two different rosters, and once each
+-- builder's list only ever shows its own size, forbidding the shared name
+-- would be a restriction the UI could never explain to the person hitting it.
+--
+-- A unique index cannot gain a column in place, so this drops
+-- `teams_owner_name_uniq` (from migration 20260902163500) and recreates it
+-- under the SAME name with size added: (owner_id, size, lower(btrim(name))).
+-- The name is kept deliberately — `writeError` in app/src/lib/saves.ts
+-- matches the string "teams_owner_name_uniq" in the 23505 Postgres returns to
+-- turn it into a readable sentence, and a renamed index would silently break
+-- that mapping back down to a raw constraint-violation message.
+--
+-- Done last, after size is populated and NOT NULL: an index over a column
+-- cannot be built while that column is still nullable mid-backfill.
+drop index if exists public.teams_owner_name_uniq;
+create unique index teams_owner_name_uniq on public.teams (owner_id, size, lower(btrim(name)));
diff --git a/supabase/tests/teams.test.ts b/supabase/tests/teams.test.ts
index dc28d77..fdd382d 100644
--- a/supabase/tests/teams.test.ts
+++ b/supabase/tests/teams.test.ts
@@ -18,48 +18,48 @@ describe('team policies', () => {
 
   beforeAll(async () => {
     await makeUser(userA, `TeamA_${userA.slice(0, 8)}`);
     await makeUser(userB, `TeamB_${userB.slice(0, 8)}`);
   });
 
   afterEach(async () => {
     await sql(`delete from public.teams where owner_id in ('${userA}', '${userB}')`);
   });
 
-  async function teamFor(owner: string): Promise<string> {
+  async function teamFor(owner: string, size: 3 | 6 = 6): Promise<string> {
     const [row] = await sql<{ id: string }>(
-      `insert into public.teams (owner_id, name, league)
-       values ('${owner}', 'Test Roster', 'great') returning id`,
+      `insert into public.teams (owner_id, name, league, size)
+       values ('${owner}', 'Test Roster', 'great', ${size}) returning id`,
     );
     return row.id;
   }
 
   it('lets an owner insert their own team', async () => {
     const rows = await asUser({ sub: userA })<{ id: string }>(
-      `insert into public.teams (owner_id, name, league)
-       values ('${userA}', 'Mine', 'great') returning id`,
+      `insert into public.teams (owner_id, name, league, size)
+       values ('${userA}', 'Mine', 'great', 6) returning id`,
     );
     expect(rows).toHaveLength(1);
   });
 
   it('defaults owner_id to the signed-in user, since the client never sends it', async () => {
     const rows = await asUser({ sub: userA })<{ owner_id: string }>(
-      `insert into public.teams (name, league) values ('Defaulted', 'great') returning owner_id`,
+      `insert into public.teams (name, league, size) values ('Defaulted', 'great', 6) returning owner_id`,
     );
     expect(rows[0].owner_id).toBe(userA);
   });
 
   it('refuses a team inserted on someone else\'s behalf', async () => {
     await expect(
       asUser({ sub: userB })(
-        `insert into public.teams (owner_id, name, league)
-         values ('${userA}', 'Not mine', 'great')`,
+        `insert into public.teams (owner_id, name, league, size)
+         values ('${userA}', 'Not mine', 'great', 6)`,
       ),
     ).rejects.toThrow(/row-level security/);
   });
 
   it('shows an owner their own team', async () => {
     const id = await teamFor(userA);
     const rows = await asUser({ sub: userA })(`select id from public.teams where id = '${id}'`);
     expect(rows).toHaveLength(1);
   });
 
@@ -153,39 +153,55 @@ describe('team policies', () => {
    * That prompt compares against the roster list already in the browser, so two
    * tabs — or one tab whose list is stale — both see "no such name" and both
    * insert. The client cannot close that window; only the database can, because
    * only the database sees both writes.
    *
    * Trimmed and lower-cased to match the client's own comparison exactly
    * (`name.trim().toLowerCase()` in TeamBuilderScreen). An index on bare `name`
    * would let "  GL Squad" through a check that had already called it taken,
    * which is worse than no index: the two rules would disagree.
    */
-  it('refuses a second roster with the same name for one owner', async () => {
-    await asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`);
+  it('refuses a second roster with the same name and size for one owner', async () => {
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
     await expect(
-      asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`),
+      asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`),
     ).rejects.toThrow(/teams_owner_name_uniq/);
   });
 
-  it('refuses one that differs only in case or surrounding space', async () => {
-    await asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`);
+  it('refuses one that differs only in case or surrounding space, at the same size', async () => {
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
     await expect(
-      asUser({ sub: userA })(`insert into public.teams (name, league) values ('  gl squad  ', 'ultra')`),
+      asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('  gl squad  ', 'ultra', 3)`),
     ).rejects.toThrow(/teams_owner_name_uniq/);
   });
 
   /** Names are personal. Two people may both have a "GL Squad". */
   it('lets a different owner hold the same name', async () => {
-    await asUser({ sub: userA })(`insert into public.teams (name, league) values ('GL Squad', 'great')`);
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
     const rows = await asUser({ sub: userB })<{ id: string }>(
-      `insert into public.teams (name, league) values ('GL Squad', 'great') returning id`,
+      `insert into public.teams (name, league, size) values ('GL Squad', 'great', 3) returning id`,
+    );
+    expect(rows).toHaveLength(1);
+  });
+
+  /**
+   * The whole point of widening the index to (owner_id, size, name): a GBL
+   * "Core" and a Show 6 "Core" are two different rosters now that each
+   * builder only ever sees its own size, and forbidding the shared name would
+   * be a restriction the UI could never explain. Asserted alongside the
+   * same-size duplicate rejection above, not instead of it — an index that
+   * simply permitted everything would pass this half alone.
+   */
+  it('lets one owner hold the same name at two different sizes', async () => {
+    await asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('GL Squad', 'great', 3)`);
+    const rows = await asUser({ sub: userA })<{ id: string }>(
+      `insert into public.teams (name, league, size) values ('GL Squad', 'great', 6) returning id`,
     );
     expect(rows).toHaveLength(1);
   });
 
   /** The rename path has to keep working, or overwriting is the only way to save. */
   it('still lets an owner rename a roster to a name nobody holds', async () => {
     const id = await teamFor(userA);
     const rows = await asUser({ sub: userA })<{ name: string }>(
       `update public.teams set name = 'Renamed' where id = '${id}' returning name`,
     );
@@ -195,11 +211,46 @@ describe('team policies', () => {
   it('rejects a third charge move', async () => {
     const id = await teamFor(userA);
     await expect(
       sql(
         `insert into public.team_members
            (team_id, slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina)
          values ('${id}', 1, 'azumarill', 'BUBBLE', '{"A","B","C"}', 0, 15, 15)`,
       ),
     ).rejects.toThrow(/team_members_charge_count/);
   });
+
+  /**
+   * Task 5b: size is a consequence of the screen a roster was saved from, not
+   * a stored guess (ledger Ruling 13). Every insert above already supplies it
+   * because the column is NOT NULL with no default — these tests are the ones
+   * that pin down the column's own rules rather than relying on it as a side
+   * effect of another test passing.
+   */
+  describe('team size', () => {
+    it('rejects a team with no size at all', async () => {
+      await expect(
+        asUser({ sub: userA })(`insert into public.teams (name, league) values ('No Size', 'great')`),
+      ).rejects.toThrow(/null value in column "size"|violates not-null constraint/);
+    });
+
+    it('rejects a size outside 3 or 6', async () => {
+      await expect(
+        asUser({ sub: userA })(`insert into public.teams (name, league, size) values ('Bad Size', 'great', 4)`),
+      ).rejects.toThrow(/teams_size/);
+    });
+
+    it('accepts a size of 3', async () => {
+      const rows = await asUser({ sub: userA })<{ size: number }>(
+        `insert into public.teams (name, league, size) values ('Three', 'great', 3) returning size`,
+      );
+      expect(rows[0].size).toBe(3);
+    });
+
+    it('accepts a size of 6', async () => {
+      const rows = await asUser({ sub: userA })<{ size: number }>(
+        `insert into public.teams (name, league, size) values ('Six', 'great', 6) returning size`,
+      );
+      expect(rows[0].size).toBe(6);
+    });
+  });
 });
