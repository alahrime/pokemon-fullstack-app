# Task 1 review package — d74761e..f19f269

## Commits
f19f269 feat(data): a deterministic revision identifying this data build

## Files changed
 app/scripts/build-data.mjs         | 12 +++++++++++-
 app/src/data/species.json          |  2 +-
 app/src/lib/__tests__/data.test.ts |  4 ++++
 app/src/lib/data.ts                | 12 +++++++++++-
 4 files changed, 27 insertions(+), 3 deletions(-)

## NOTE ON species.json
app/src/data/species.json is GENERATED and single-line minified JSON, so its
one-line change renders as a 1.4MB diff. It is excluded below. Verified
separately: `git diff --numstat` reports exactly 1 insertion, 1 deletion, and
the only textual difference is the added dataRev field:


## Full diff (species.json excluded)
diff --git a/app/scripts/build-data.mjs b/app/scripts/build-data.mjs
index f01b3ea..b89b14b 100644
--- a/app/scripts/build-data.mjs
+++ b/app/scripts/build-data.mjs
@@ -25,20 +25,21 @@
  * SHADOWS. Shadow variants are not emitted as separate rows. A shadow shares
  * its base form's stats, typing and movepool exactly, so it is represented as
  * `shadowEligible` plus a separate rank set, and the engine derives the
  * variant by applying the multipliers. That keeps the file ~1100 rows instead
  * of ~1600 and makes shadow a toggle rather than a parallel roster.
  */
 
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
+import { createHash } from 'node:crypto';
 
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 const SRC = path.resolve(HERE, '../../data-src');
 const OUT = path.resolve(HERE, '../src/data');
 
 const LEAGUES = [
   { id: 'great', cp: 1500, file: 'rankings-1500.json' },
   { id: 'ultra', cp: 2500, file: 'rankings-2500.json' },
   { id: 'master', cp: 10000, file: 'rankings-10000.json' },
 ];
@@ -408,21 +409,30 @@ const byId = new Map(species.map((s) => [s.id, s]));
 const opponents = {};
 for (const lg of LEAGUES) {
   const table = rankByLeague.get(lg.id);
   opponents[lg.id] = [...table.entries()]
     .filter(([id]) => byId.has(id))
     .sort((a, b) => a[1].rank - b[1].rank)
     .slice(0, CURATED_PER_LEAGUE)
     .map(([id]) => id);
 }
 
-fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify({ moves: moveTable, species }));
+const out = { moves: moveTable, species };
+
+// A stable identity for this data build. Taken over the payload with the key
+// order the writer already fixes, so regenerating unchanged inputs yields the
+// same rev — `verify-data` asserts species.json is byte-identical across
+// rebuilds and this must not be what breaks it.
+const payload = JSON.stringify({ moves: out.moves, species: out.species });
+out.dataRev = createHash('sha256').update(payload).digest('hex').slice(0, 16);
+
+fs.writeFileSync(path.join(OUT, 'species.json'), JSON.stringify(out));
 fs.writeFileSync(path.join(OUT, 'opponents.json'), JSON.stringify(opponents, null, 2));
 
 // ── report ─────────────────────────────────────────────────────────────────
 const shadowCount = species.filter((s) => s.shadowEligible).length;
 const formCount = species.filter((s) => s.id.includes('_')).length;
 const embedded = species.reduce((n, s) => n + s.fastMoves.length + s.chargeMoves.length, 0);
 console.log(`species.json    ${species.length} entries (${formCount} alternate forms, ${shadowCount} shadow-eligible)`);
 console.log(`  moves         ${Object.keys(moveTable).length} interned, ${embedded} references`);
 for (const lg of LEAGUES) {
   const n = species.filter((s) => s.leagues.includes(lg.id)).length;
diff --git a/app/src/lib/__tests__/data.test.ts b/app/src/lib/__tests__/data.test.ts
index 9cb9e30..f22609a 100644
--- a/app/src/lib/__tests__/data.test.ts
+++ b/app/src/lib/__tests__/data.test.ts
@@ -27,20 +27,24 @@ describe('refs', () => {
     expect(speciesOf('azumarill_shadow')?.id).toBe('azumarill');
     expect(speciesOf('not_a_species')).toBeUndefined();
   });
 });
 
 describe('roster', () => {
   it('is populated and internally consistent', () => {
     expect(SPECIES.length).toBeGreaterThan(1000);
     expect(SPECIES_BY_ID.size).toBe(SPECIES.length);
   });
+  it('exposes a data revision that identifies this build', async () => {
+    const { DATA_REV } = await import('../data');
+    expect(DATA_REV).toMatch(/^[0-9a-f]{16}$/);
+  });
   it('ROSTER includes shadows and BASE_ROSTER does not', () => {
     expect(ROSTER.length).toBeGreaterThan(BASE_ROSTER.length);
     expect(BASE_ROSTER.every((r) => !r.shadow)).toBe(true);
   });
   it('excludes every unsimulated species from every picker', () => {
     const rosterIds = new Set(ROSTER.map((r) => r.ref));
     for (const id of UNSIMULATED_IDS) {
       expect(isSimulated(id)).toBe(false);
       expect(rosterIds.has(id)).toBe(false);
       expect(opponentCandidatesFor('great')).not.toContain(id);
diff --git a/app/src/lib/data.ts b/app/src/lib/data.ts
index 4586444..d84e0a7 100644
--- a/app/src/lib/data.ts
+++ b/app/src/lib/data.ts
@@ -28,21 +28,31 @@ interface RawSpecies
   extends Omit<Species, 'fastMoves' | 'chargeMoves' | 'chargeMove' | 'chargeMove2' | 'leagueMoves'> {
   fastMoves: string[];
   chargeMoves: string[];
   chargeMove: string;
   chargeMove2: string | null;
   leagueMoves?: Partial<Record<LeagueId, { fast: string; charge: string; charge2: string | null }>>;
 }
 const raw = artefact<{
   moves: Record<string, FastMove & ChargeMove>;
   species: RawSpecies[];
-}>(speciesRaw, 'species.json', ['moves', 'species'], 'npm run data');
+  dataRev: string;
+}>(speciesRaw, 'species.json', ['moves', 'species', 'dataRev'], 'npm run data');
+
+/**
+ * Identifies the generated data this build carries.
+ *
+ * Matches and scheduled offers pin it: a random draw agreed on Tuesday and
+ * played on Friday must deal the same six, and the only way to notice that the
+ * data moved underneath it is to have recorded which data it was.
+ */
+export const DATA_REV: string = raw.dataRev;
 
 export const SPECIES: Species[] = raw.species.map((s) => ({
   ...s,
   fastMoves: s.fastMoves.map((k) => raw.moves[k] as FastMove),
   chargeMoves: s.chargeMoves.map((k) => raw.moves[k] as ChargeMove),
   chargeMove: raw.moves[s.chargeMove] as ChargeMove,
   chargeMove2: s.chargeMove2 ? (raw.moves[s.chargeMove2] as ChargeMove) : null,
   leagueMoves: s.leagueMoves
     ? Object.fromEntries(
         Object.entries(s.leagueMoves).map(([lg, m]) => [
