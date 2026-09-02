### Task 1: A deterministic data revision

A scheduled match agreed Tuesday and played Friday must deal the six it promised. Nothing in the repo identifies a data build today, so `matches.data_rev` would have nothing to store. The digest is over the generated payload, so an unchanged rebuild produces an unchanged rev — `species.json` is already asserted byte-identical across regenerations, and this must not break that.

**Files:**
- Modify: `app/scripts/build-data.mjs`
- Modify: `app/src/lib/data.ts`
- Test: `app/src/lib/__tests__/data.test.ts`

**Interfaces:**
- Produces: `DATA_REV: string` exported from `app/src/lib/data.ts` — 16 lowercase hex characters.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/data.test.ts — append inside the existing describe
it('exposes a data revision that identifies this build', async () => {
  const { DATA_REV } = await import('../data');
  expect(DATA_REV).toMatch(/^[0-9a-f]{16}$/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && ./node_modules/.bin/vitest run src/lib/__tests__/data.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `DATA_REV` is undefined, so the regex match throws.

- [ ] **Step 3: Emit the rev from the data build**

In `app/scripts/build-data.mjs`, after the output object is assembled and immediately before it is written, add:

```js
import { createHash } from 'node:crypto';

// A stable identity for this data build. Taken over the payload with the key
// order the writer already fixes, so regenerating unchanged inputs yields the
// same rev — `verify-data` asserts species.json is byte-identical across
// rebuilds and this must not be what breaks it.
const payload = JSON.stringify({ moves: out.moves, species: out.species });
out.dataRev = createHash('sha256').update(payload).digest('hex').slice(0, 16);
```

- [ ] **Step 4: Export it**

In `app/src/lib/data.ts`, beside the other top-level exports derived from the JSON:

```ts
/**
 * Identifies the generated data this build carries.
 *
 * Matches and scheduled offers pin it: a random draw agreed on Tuesday and
 * played on Friday must deal the same six, and the only way to notice that the
 * data moved underneath it is to have recorded which data it was.
 */
export const DATA_REV: string = (raw as { dataRev?: string }).dataRev ?? 'unknown';
```

- [ ] **Step 5: Regenerate and verify determinism**

Run: `cd app && npm run data > /tmp/data.log 2>&1; echo "EXIT=$?" && git diff --stat src/data/species.json`
Expected: EXIT=0, and `species.json` shows the added `dataRev` key only. Run `npm run data` a second time and confirm `git diff` reports no further change — that is the determinism assertion, and a differing rev between two runs means the hash input is unstable.

- [ ] **Step 6: Run the test and the gate**

Run: `cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0.

- [ ] **Step 7: Commit**

```bash
git add app/scripts/build-data.mjs app/src/lib/data.ts app/src/lib/__tests__/data.test.ts app/src/data/species.json
git commit -m "feat(data): a deterministic revision identifying this data build"
```

---

