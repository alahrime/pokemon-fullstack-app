### Task 2: `rules_hash` becomes an actual hash

`canonicalize()` returns the whole canonical string and `rules_hash` stores it verbatim. That was fine while nothing read the column. M2a indexes and partitions queues on it, which is the moment a 32-byte digest stops being cosmetic — and changing it later means rewriting stored values underneath a live queue.

Web Crypto's `crypto.subtle` exists in browsers and in Deno, which is why the digest lives here rather than in a Node-only helper: the Edge Function must compute it with this exact code.

**Files:**
- Create: `app/src/rules/hash.ts`
- Modify: `app/src/rules/index.ts`
- Modify: `app/src/lib/saves.ts:~150` (the `format_versions` insert)
- Test: `app/src/rules/__tests__/hash.test.ts`

**Interfaces:**
- Produces: `rulesHash(format: Format): Promise<string>` — 64 lowercase hex characters. Async because `crypto.subtle.digest` is.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/rules/__tests__/hash.test.ts
import { describe, it, expect } from 'vitest';
import { RULES_SCHEMA, type Format } from '../index';
import { rulesHash } from '../hash';

const base: Format = {
  schema: RULES_SCHEMA, base: 'great', start: 'empty', pool: [],
  composition: { size: 3, uniqueSpecies: true }, selection: { mode: 'open' },
};

describe('rulesHash', () => {
  it('is 64 hex characters', async () => {
    expect(await rulesHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agrees for two independently authored identical formats', async () => {
    // The whole point of partitioning queues by hash rather than by
    // format_version_id: two people who wrote the same rules must meet.
    const twin: Format = { ...base, composition: { ...base.composition } };
    expect(await rulesHash(twin)).toBe(await rulesHash(base));
  });

  it('differs when a rule differs', async () => {
    const bigger: Format = { ...base, composition: { ...base.composition, size: 6 } };
    expect(await rulesHash(bigger)).not.toBe(await rulesHash(base));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && ./node_modules/.bin/vitest run src/rules/__tests__/hash.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — cannot resolve `../hash`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/rules/hash.ts
import { canonicalize } from './canonical';
import type { Format } from './types';

/**
 * The queue identity of a format.
 *
 * `canonicalize` decides what "the same rules" means — key order irrelevant,
 * notes irrelevant, clause order significant. This only compresses that string
 * into something worth indexing.
 *
 * `crypto.subtle` rather than a Node import on purpose: this exact function
 * runs in the browser AND in the Edge Function that recomputes the hash it
 * refuses to take on trust. Two implementations would be two answers.
 */
export async function rulesHash(format: Format): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(format));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Export it and use it at the write site**

Add to `app/src/rules/index.ts`:

```ts
export { rulesHash } from './hash';
```

In `app/src/lib/saves.ts`, change the `format_versions` insert to await the digest. The import line becomes `import { canonicalize, rulesHash, type Format } from '../rules';` and the insert becomes:

```ts
  const { error } = await supabase.from('format_versions').insert({
    format_id: id,
    version: next,
    rules: f.format,
    rules_hash: await rulesHash(f.format),
  });
```

`canonicalize` stays imported — it remains the definition of format identity and is what the hash is taken over.

- [ ] **Step 5: Run the tests**

Run: `cd app && ./node_modules/.bin/vitest run src/rules src/lib/__tests__/saves.test.ts > /tmp/green.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0. If `saves.test.ts` asserted the old string value, update that assertion to a 64-hex regex — the stored value genuinely changed.

- [ ] **Step 6: Confirm the module still runs outside a browser**

Run: `cd app && npm run rules:node > /tmp/rules.log 2>&1; echo "EXIT=$?"`
Expected: EXIT=0. This is the check that matters — if `crypto.subtle` were unavailable under Node this is where it surfaces, not in production.

- [ ] **Step 7: Run the gate and commit**

```bash
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
git add app/src/rules/hash.ts app/src/rules/index.ts app/src/rules/__tests__/hash.test.ts app/src/lib/saves.ts app/src/lib/__tests__/saves.test.ts
git commit -m "feat(rules): rules_hash is a sha256, now that a queue partitions on it"
```

**Note for the reviewer:** existing `format_versions` rows keep the old canonical-string value. Production holds none. A local stack is rebuilt with `npm run db:reset`.

---

