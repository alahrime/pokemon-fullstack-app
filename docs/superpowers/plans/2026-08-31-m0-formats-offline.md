# M0 — Formats, Offline: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a format authoring system — rules schema, validator, linter, seeded random draft, and a builder UI persisting to `localStorage` — into the existing app with no backend and no data-pipeline change.

**Architecture:** A pure, isomorphic rules module at `app/src/rules/` resolves a format to a set of **refs** (`azumarill`, `azumarill_shadow`) using the app's existing search-query parser, rebinding one token so `shadow` means "is the Shadow variant" rather than "has one". A pool is an ordered clause pipeline where the last matching clause wins; composition is a list of quota clauses over the same selector language; selection is either open pick or a deterministic seeded draft. The UI is a builder screen that recomputes the legal pool per keystroke and can explain, for any ref, which clause decided it.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest 3, oxlint. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-paragon-platform-design.md` — sections 4 (rules language) and 5 (build identity). Read both before starting.

## Global Constraints

- **No new runtime dependencies.** Everything here is standard library plus what `app/package.json` already lists.
- **`src/rules/` imports no React and no browser API.** No `window`, `document`, `localStorage`, `crypto`, `fetch`. It must be bundleable by esbuild for Node exactly as `src/lib/` already is. Persistence lives in `src/state/`, not in `src/rules/`.
- **Never hand-edit `app/src/data/species.json`.** It is generated. This plan changes no generated data and runs no data build.
- **The gate is `cd app && npm run check`** — tsc, oxlint, themes, token parity, verify-data, spread audit, and 571+ tests. It runs before every commit. Do not skip it, and do not relax an existing assertion to make it pass.
- **Refs, not species ids.** A team member, a pool entry and a quota subject are all `ref` strings. Use `parseRef` / `makeRef` from `src/lib/data.ts`; never hand-concatenate `_shadow`.
- **Read the signature before writing the test.** This codebase's most repeated historical mistake is assumed APIs. `,` is the query language's *or* and `&` its *and*. `compileQuery` returns `null` for an empty query, not a match-all.
- **jsdom applies no stylesheet.** Assert structure in component tests; never assert computed layout there.
- **Design tokens only.** Styles use `app/src/styles/tokens.css` variables — spacing, `--text-*`, `--font-mono`, league accents — never literal colours or pixel sizes.
- **Commit after every task**, using the message given in that task's final step.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `app/src/rules/types.ts` | The format schema: `Format`, `PoolClause`, `Quota`, `Composition`, `Selection`, `Build`, `Violation`, `Diagnostic`. No logic. |
| `app/src/rules/canonical.ts` | Canonical serialisation of a `Format` — the string a `rules_hash` will later be taken over. |
| `app/src/rules/selector.ts` | Ref-aware selector compilation. Wraps the search parser, rebinds `shadow`. |
| `app/src/rules/pool.ts` | `resolvePool` — the last-match-wins clause pipeline. |
| `app/src/rules/team.ts` | `validateTeam` — size, uniqueness and quota checks over a team of builds. |
| `app/src/rules/lint.ts` | `lintFormat` — publish-time errors and warnings, including composition satisfiability. |
| `app/src/rules/roll.ts` | `rollTeam` — the deterministic seeded draft. |
| `app/src/rules/index.ts` | The module's public surface; the only path UI code imports from. |
| `app/src/state/formatStore.ts` | `localStorage` persistence. The only file in this plan that touches a browser API. |
| `app/src/screens/FormatBuilderScreen.tsx` | The builder screen. |
| `app/src/components/PoolPreview.tsx` | Legal-pool count, per-clause delta, and the why-is-this-illegal explanation. |
| `app/src/components/ClauseEditor.tsx` | Add, edit, reorder and remove pool clauses. |

**Modified**

| File | Change |
|---|---|
| `app/src/lib/query.ts` | Extract the per-term compiler into an exported `termCompiler` factory. Behaviour-preserving. |
| `app/src/lib/screens.ts` | Register the builder screen. |
| `app/src/styles/components.css` | Styles for the builder, clause list and pool preview. |
| `app/.oxlintrc.json` *(or the existing oxlint config)* | Guard: `src/rules/**` may not import React. |

---

### Task 1: The schema, and its canonical form

**Files:**
- Create: `app/src/rules/types.ts`
- Create: `app/src/rules/canonical.ts`
- Test: `app/src/rules/__tests__/canonical.test.ts`

**Interfaces:**
- Consumes: `LeagueId` from `src/lib/types.ts`.
- Produces: every type below, plus `canonicalize(format: Format): string`. Tasks 2–11 all import from `src/rules/types.ts`.

- [ ] **Step 1: Write the types**

Create `app/src/rules/types.ts`:

```ts
import type { LeagueId } from '../lib/types';

/**
 * Schema version of a stored format.
 *
 * Bumped only when a stored document's *meaning* changes. A reader that finds
 * a version it does not know refuses the format rather than guessing, because
 * a misread ruleset silently changes which team is legal.
 */
export const RULES_SCHEMA = 1;

export type Effect = 'allow' | 'deny';

/**
 * One step of the pool pipeline.
 *
 * `select` is a query in the rules subset of the search language (see
 * `selector.ts`). Clause order is significant: the last clause that matches a
 * ref decides its legality, the way .gitignore and iptables resolve.
 */
export interface PoolClause {
  effect: Effect;
  select: string;
  note?: string;
}

/** A count constraint over the members of a team that match `select`. */
export interface Quota {
  select: string;
  min?: number;
  max?: number;
  note?: string;
}

export interface Composition {
  /** Members the roster must hold. */
  size: number;
  /** Members brought into a single battle. Defaults to `size`. */
  bring?: number;
  /** No two members sharing a Pokedex number. */
  uniqueSpecies?: boolean;
  /** No two members from one evolution family. */
  uniqueFamilies?: boolean;
  quotas?: Quota[];
}

export type SelectionMode = 'open' | 'random';

export interface Selection {
  mode: SelectionMode;
  /** Draw only from the top N of the league ranking. Absent → the whole pool. */
  topN?: number;
  /** Slots the player picks; the rest are rolled. Defaults to 0. */
  playerPicks?: number;
  /** Whether the draw also deals each slot's moves. */
  rollMoves?: boolean;
}

export interface Format {
  schema: number;
  base: LeagueId;
  pool: PoolClause[];
  composition: Composition;
  selection: Selection;
}

/**
 * One team member: a ref plus the loadout it is running.
 *
 * The ref carries species and Shadow together (`forretress_shadow`); the moves
 * are what distinguish two builds of the same ref, which is the whole reason a
 * build is not just a ref.
 */
export interface Build {
  ref: string;
  /** Fast move id, as it appears in `Species.fastMoves[].id`. */
  fast: string;
  /** One or two charged move ids. */
  charges: string[];
}

export type Violation =
  | { kind: 'size'; expected: number; actual: number }
  | { kind: 'illegal-ref'; ref: string; clause: number }
  | { kind: 'duplicate-species'; refs: [string, string] }
  | { kind: 'duplicate-family'; refs: [string, string] }
  | { kind: 'quota'; select: string; min?: number; max?: number; actual: number }
  | { kind: 'unknown-move'; ref: string; move: string };

export type Diagnostic =
  | { level: 'error'; kind: 'empty-pool' }
  | { level: 'error'; kind: 'pool-too-small'; need: number; have: number }
  | { level: 'error'; kind: 'unsatisfiable' }
  | { level: 'error'; kind: 'bad-selector'; clause: number; select: string }
  | { level: 'warn'; kind: 'unsatisfiable-unproven' }
  | { level: 'warn'; kind: 'narrow-pool'; have: number; leagueSize: number }
  | { level: 'warn'; kind: 'dead-clause'; clause: number };
```

- [ ] **Step 2: Write the failing test**

Create `app/src/rules/__tests__/canonical.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalize } from '../canonical';
import { RULES_SCHEMA, type Format } from '../types';

const base: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [
    { effect: 'deny', select: 'flying', note: 'air banned' },
    { effect: 'allow', select: '+mantine' },
  ],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

describe('canonicalize', () => {
  it('is stable across key order', () => {
    const shuffled = {
      selection: base.selection,
      composition: base.composition,
      pool: base.pool,
      base: base.base,
      schema: base.schema,
    } as Format;
    expect(canonicalize(shuffled)).toBe(canonicalize(base));
  });

  it('ignores notes, which are commentary and not rules', () => {
    const noNote: Format = { ...base, pool: [{ effect: 'deny', select: 'flying' }, base.pool[1]] };
    expect(canonicalize(noNote)).toBe(canonicalize(base));
  });

  it('does NOT ignore clause order, because order changes meaning', () => {
    const flipped: Format = { ...base, pool: [base.pool[1], base.pool[0]] };
    expect(canonicalize(flipped)).not.toBe(canonicalize(base));
  });

  it('normalises selector whitespace and case', () => {
    const messy: Format = { ...base, pool: [{ effect: 'deny', select: '  FLYING ' }, base.pool[1]] };
    expect(canonicalize(messy)).toBe(canonicalize(base));
  });

  it('treats an absent optional as identical to its default', () => {
    const explicit: Format = { ...base, composition: { ...base.composition, uniqueFamilies: false } };
    expect(canonicalize(explicit)).toBe(canonicalize(base));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/canonical.test.ts`
Expected: FAIL — cannot resolve `../canonical`.

- [ ] **Step 4: Implement**

Create `app/src/rules/canonical.ts`:

```ts
import type { Format, PoolClause, Quota } from './types';

/**
 * The canonical string form of a format.
 *
 * This is the value a `rules_hash` is taken over once matchmaking exists, so
 * two people who independently author the same rules produce the same string
 * and land in the same queue. That makes three things load-bearing:
 *
 *   - Key order must not matter, so every object is written field by field
 *     rather than handed to JSON.stringify.
 *   - Notes must not matter. They are commentary; a format is not a different
 *     format because someone explained it.
 *   - Clause order *must* matter. Under last-match-wins the same clauses in a
 *     different order are a different ruleset, and collapsing that would pool
 *     two genuinely different formats into one queue.
 *
 * Optional fields are written at their defaults rather than omitted, so an
 * explicit `false` and an absent flag agree.
 */
function normSelect(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

function clause(c: PoolClause): string {
  return `${c.effect}:${normSelect(c.select)}`;
}

function quota(q: Quota): string {
  return `${normSelect(q.select)}:${q.min ?? 0}:${q.max ?? -1}`;
}

export function canonicalize(f: Format): string {
  const c = f.composition;
  const s = f.selection;
  const parts = [
    `schema=${f.schema}`,
    `base=${f.base}`,
    `pool=[${f.pool.map(clause).join('|')}]`,
    `size=${c.size}`,
    `bring=${c.bring ?? c.size}`,
    `uniqueSpecies=${c.uniqueSpecies ?? false}`,
    `uniqueFamilies=${c.uniqueFamilies ?? false}`,
    // Quotas are a set, not a sequence — unlike pool clauses, they all apply
    // at once and their order cannot change an outcome. Sorted so two authors
    // who added the same quotas in a different order still agree.
    `quotas=[${(c.quotas ?? []).map(quota).sort().join('|')}]`,
    `mode=${s.mode}`,
    `topN=${s.topN ?? 0}`,
    `playerPicks=${s.playerPicks ?? 0}`,
    `rollMoves=${s.rollMoves ?? false}`,
  ];
  return parts.join(';');
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/canonical.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the gate**

Run: `cd app && npm run check`
Expected: PASS. If tsc complains that `types.ts` exports are unused, that is expected until Task 2 — it is not an error, only unreferenced code.

- [ ] **Step 7: Commit**

```bash
git add app/src/rules/types.ts app/src/rules/canonical.ts app/src/rules/__tests__/canonical.test.ts
git commit -m "feat(rules): the format schema, and a canonical form that keeps clause order"
```

---

### Task 2: A ref-aware selector

**Files:**
- Modify: `app/src/lib/query.ts` — extract an exported `termCompiler`
- Create: `app/src/rules/selector.ts`
- Test: `app/src/rules/__tests__/selector.test.ts`

**Interfaces:**
- Consumes: `Species` from `src/lib/types.ts`; `parseRef`, `speciesOf`, `SPECIES` from `src/lib/data.ts`.
- Produces: `termCompiler(roster: readonly Species[]): (raw: string) => Term` exported from `src/lib/query.ts`; and from `src/rules/selector.ts`, `type RefTerm = (ref: string) => boolean` plus `compileSelector(select: string, roster?: readonly Species[]): RefTerm | null`.

**Why this task exists.** The search language compiles predicates over a `Species`. A rule needs predicates over a **ref**, because `forretress` and `forretress_shadow` must be allowed and denied independently. Almost every term is unchanged — a type, a tag, a generation are properties of the species either way — but `shadow` means "has a Shadow variant" in search and must mean "is the Shadow variant" in a rule. The two cannot be reconciled by wrapping `compileQuery`, because `shadow` can appear inside an `or` (`water,shadow`) where it cannot be factored out. So the rules layer re-does the trivial `,`/`&` split and delegates each individual term to the existing compiler.

- [ ] **Step 1: Extract the term compiler, behaviour-preserving**

In `app/src/lib/query.ts`, replace the body of `compileQuery` so that the closure setup becomes a reusable factory. Add above `compileQuery`:

```ts
/**
 * A per-term compiler bound to one roster.
 *
 * Extracted so the rules layer (`src/rules/selector.ts`) can reuse the term
 * vocabulary without reimplementing it. The `,`/`&` splitting is five lines and
 * is done by each caller; the terms themselves are the part worth sharing, and
 * a second implementation of them would drift.
 */
export function termCompiler(roster: readonly Species[]): (raw: string) => Term {
  let byName: Map<string, string> | null = null;
  const familyIdFor = (name: string): string | null => {
    if (!byName) {
      byName = new Map();
      for (const s of roster) {
        if (!s.family) continue;
        if (!byName.has(s.id)) byName.set(s.id, s.family);
        const plain = s.name.toLowerCase();
        if (!byName.has(plain)) byName.set(plain, s.family);
      }
    }
    return byName.get(name) ?? null;
  };
  const familyOf = () => null;
  return (raw: string) => compileTerm(raw, familyOf, familyIdFor);
}
```

Then rewrite `compileQuery` to use it, deleting the now-duplicated closure setup:

```ts
export function compileQuery(query: string, roster: readonly Species[]): Term | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const term = termCompiler(roster);

  const alternatives = q
    .split(',')
    .map((clause) => clause.split('&').map(term).filter(Boolean))
    .filter((and) => and.length > 0);

  if (!alternatives.length) return null;
  return (s) => alternatives.some((and) => and.every((t) => t(s)));
}
```

- [ ] **Step 2: Prove the refactor changed nothing**

Run: `cd app && npx vitest run src/lib/__tests__`
Expected: PASS, with the existing query tests unchanged. If any query test fails, the extraction is wrong — revert and redo it. Do not edit the test.

- [ ] **Step 3: Write the failing selector test**

Create `app/src/rules/__tests__/selector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileSelector } from '../selector';
import { makeRef } from '../../lib/data';

const AZU = 'azumarill';
const AZU_S = makeRef('azumarill', true);

describe('compileSelector', () => {
  it('matches a type across both variants of a species', () => {
    const t = compileSelector('water')!;
    expect(t(AZU)).toBe(true);
    expect(t(AZU_S)).toBe(true);
  });

  it('rebinds `shadow` to mean *is* the Shadow, not *has* one', () => {
    const t = compileSelector('shadow')!;
    expect(t(AZU_S)).toBe(true);
    expect(t(AZU)).toBe(false);
  });

  it('negates the rebound token correctly', () => {
    const t = compileSelector('!shadow')!;
    expect(t(AZU)).toBe(true);
    expect(t(AZU_S)).toBe(false);
  });

  it('composes shadow with a species term to reach one variant', () => {
    const t = compileSelector('azumarill&!shadow')!;
    expect(t(AZU)).toBe(true);
    expect(t(AZU_S)).toBe(false);
  });

  it('keeps `,` as or and `&` as and', () => {
    const or = compileSelector('water,fire')!;
    const and = compileSelector('water&fairy')!;
    expect(or(AZU)).toBe(true);
    expect(and(AZU)).toBe(true);
    expect(compileSelector('water&fire')!(AZU)).toBe(false);
  });

  it('handles shadow inside an or, where it cannot be factored out', () => {
    const t = compileSelector('fire,shadow')!;
    expect(t(AZU_S)).toBe(true);
    expect(t(AZU)).toBe(false);
  });

  it('returns null for an empty selector rather than a match-all', () => {
    expect(compileSelector('')).toBeNull();
    expect(compileSelector('   ')).toBeNull();
  });

  it('is false for a ref whose species does not exist', () => {
    expect(compileSelector('water')!('not_a_species')).toBe(false);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/selector.test.ts`
Expected: FAIL — cannot resolve `../selector`.

- [ ] **Step 5: Implement**

Create `app/src/rules/selector.ts`:

```ts
import { termCompiler } from '../lib/query';
import { SPECIES, parseRef, speciesOf } from '../lib/data';
import type { Species } from '../lib/types';

/** A predicate over a ref, which is what a rule actually constrains. */
export type RefTerm = (ref: string) => boolean;

/**
 * Tokens whose meaning differs between search and rules.
 *
 * `shadow` is the only one. In search it maps to `shadowEligible` and asks
 * "does a Shadow of this exist"; in a rule it must ask "is this ref the Shadow
 * one", because the whole point of resolving to refs is that a ban can be more
 * specific than a species. Everything else — types, tags, generations, families,
 * movepools — is a property of the species and needs no rebinding.
 */
function reboundTerm(body: string): RefTerm | null {
  if (body === 'shadow') return (ref) => parseRef(ref).shadow;
  return null;
}

/**
 * Compile one `&`-separated term, ref-aware.
 *
 * Negation is stripped here so a rebound token can be negated too, and the
 * original raw text (leading `!` included) is handed to the shared compiler for
 * everything else, so `!water` keeps being negated by the code that already
 * knows how.
 */
function refTerm(raw: string, term: (r: string) => (s: Species) => boolean): RefTerm {
  let body = raw.trim().toLowerCase();
  let negate = false;
  while (body.startsWith('!')) {
    negate = !negate;
    body = body.slice(1).trim();
  }

  const rebound = reboundTerm(body);
  if (rebound) return negate ? (ref) => !rebound(ref) : rebound;

  const t = term(raw);
  return (ref) => {
    const s = speciesOf(ref);
    return !!s && t(s);
  };
}

/**
 * Compile a rules selector into a predicate over refs.
 *
 * The `,`-then-`&` split mirrors `compileQuery` exactly — or-of-ands, matching
 * how the separators read — and the terms come from the same compiler, so the
 * language a user already knows from the search box is the language a rule
 * speaks. Returns null for an empty selector so a caller can skip the clause
 * rather than being handed a predicate that matches everything.
 */
export function compileSelector(
  select: string,
  roster: readonly Species[] = SPECIES,
): RefTerm | null {
  const q = select.trim().toLowerCase();
  if (!q) return null;

  const term = termCompiler(roster);
  const alternatives = q
    .split(',')
    .map((clause) => clause.split('&').map((raw) => refTerm(raw, term)))
    .filter((and) => and.length > 0);

  if (!alternatives.length) return null;
  return (ref) => alternatives.some((and) => and.every((t) => t(ref)));
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/selector.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the gate**

Run: `cd app && npm run check`
Expected: PASS, including the pre-existing query tests.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/query.ts app/src/rules/selector.ts app/src/rules/__tests__/selector.test.ts
git commit -m "feat(rules): selectors over refs, with shadow rebound to mean the variant"
```

---

### Task 3: Resolve the pool

**Files:**
- Create: `app/src/rules/pool.ts`
- Test: `app/src/rules/__tests__/pool.test.ts`

**Interfaces:**
- Consumes: `compileSelector` (Task 2); `Format` (Task 1); `opponentCandidatesFor` from `src/lib/data.ts`.
- Produces: `interface PoolResolution { legal: string[]; decidedBy: Map<string, number>; bad: number[] }` and `resolvePool(format: Format): PoolResolution`. `decidedBy` maps **every base-league ref** — legal or not — to the index of the clause that decided it, or `-1` for "no clause matched, so base-league membership decided it". `bad` lists indices of clauses whose selector failed to compile.

**Why `decidedBy` covers illegal refs too.** The builder's most important affordance is answering "why is my Mantine illegal?", and that question is only ever asked about a ref that is *not* in `legal`. A map covering only the legal set cannot answer it.

- [ ] **Step 1: Write the failing test**

Create `app/src/rules/__tests__/pool.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolvePool } from '../pool';
import { RULES_SCHEMA, type Format } from '../types';
import { opponentCandidatesFor, parseRef, speciesOf } from '../../lib/data';

function fmt(pool: Format['pool']): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool,
    composition: { size: 3 },
    selection: { mode: 'open' },
  };
}

describe('resolvePool', () => {
  it('with no clauses, is exactly the league pool', () => {
    const { legal } = resolvePool(fmt([]));
    expect(legal.sort()).toEqual([...opponentCandidatesFor('great')].sort());
  });

  it('a deny removes everything it matches', () => {
    const { legal } = resolvePool(fmt([{ effect: 'deny', select: 'flying' }]));
    expect(legal.some((r) => speciesOf(r)?.types.includes('flying'))).toBe(false);
    expect(legal.length).toBeGreaterThan(0);
  });

  it('the LAST matching clause wins, so a later allow re-admits', () => {
    const denyOnly = resolvePool(fmt([{ effect: 'deny', select: 'water' }]));
    const reAdmit = resolvePool(
      fmt([
        { effect: 'deny', select: 'water' },
        { effect: 'allow', select: 'azumarill' },
      ]),
    );
    expect(denyOnly.legal).not.toContain('azumarill');
    expect(reAdmit.legal).toContain('azumarill');
  });

  it('order changes the result, which is why order is canonical', () => {
    const a = resolvePool(fmt([
      { effect: 'deny', select: 'water' },
      { effect: 'allow', select: 'azumarill' },
    ]));
    const b = resolvePool(fmt([
      { effect: 'allow', select: 'azumarill' },
      { effect: 'deny', select: 'water' },
    ]));
    expect(a.legal).toContain('azumarill');
    expect(b.legal).not.toContain('azumarill');
  });

  it('bans one variant without banning the species', () => {
    const { legal } = resolvePool(fmt([{ effect: 'deny', select: 'shadow' }]));
    expect(legal.every((r) => !parseRef(r).shadow)).toBe(true);
    expect(legal.length).toBeGreaterThan(0);
  });

  it('names the deciding clause for an illegal ref', () => {
    const { decidedBy } = resolvePool(fmt([
      { effect: 'deny', select: 'flying' },
      { effect: 'allow', select: '+mantine' },
    ]));
    const flyer = [...decidedBy.keys()].find(
      (r) => speciesOf(r)?.types.includes('flying') && speciesOf(r)?.family !== 'FAMILY_MANTYKE',
    )!;
    expect(decidedBy.get(flyer)).toBe(0);
  });

  it('uses -1 when no clause matched at all', () => {
    const { decidedBy } = resolvePool(fmt([{ effect: 'deny', select: 'flying' }]));
    expect(decidedBy.get('azumarill')).toBe(-1);
  });

  it('reports an uncompilable clause instead of silently ignoring it', () => {
    const { bad } = resolvePool(fmt([{ effect: 'deny', select: '   ' }]));
    expect(bad).toEqual([0]);
  });

  it('never admits a species the engine cannot simulate', () => {
    const { legal } = resolvePool(fmt([]));
    expect(legal).not.toContain('mimikyu');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/pool.test.ts`
Expected: FAIL — cannot resolve `../pool`.

- [ ] **Step 3: Implement**

Create `app/src/rules/pool.ts`:

```ts
import { opponentCandidatesFor } from '../lib/data';
import { compileSelector, type RefTerm } from './selector';
import type { Format } from './types';

export interface PoolResolution {
  /** Refs that survive the pipeline, in league order. */
  legal: string[];
  /**
   * Every base-league ref mapped to the clause that decided it, or -1 when no
   * clause matched and league membership alone decided. Covers illegal refs
   * too — "why is this banned" is only ever asked about one of those.
   */
  decidedBy: Map<string, number>;
  /** Indices of clauses whose selector would not compile. */
  bad: number[];
}

/**
 * Resolve a format to its legal refs.
 *
 * The base set is `opponentCandidatesFor`, which is already exactly right: it
 * returns refs rather than species ids, includes a Shadow row wherever the
 * Shadow is league-legal in its own right, and has already dropped everything
 * in UNSIMULATED_IDS. Reimplementing league membership here would duplicate a
 * rule that lives in the data layer and would drift from it.
 *
 * Every clause is tested against every ref rather than stopping at the first
 * match, because the *last* match decides. Stopping early would silently
 * implement first-match-wins, which reads identically on simple formats and
 * diverges exactly when a format uses an exception — the case the ordering
 * exists to serve.
 */
export function resolvePool(format: Format): PoolResolution {
  const base = opponentCandidatesFor(format.base);

  const compiled: (RefTerm | null)[] = [];
  const bad: number[] = [];
  format.pool.forEach((c, i) => {
    const t = compileSelector(c.select);
    if (!t) bad.push(i);
    compiled.push(t);
  });

  const legal: string[] = [];
  const decidedBy = new Map<string, number>();

  for (const ref of base) {
    let allowed = true;
    let by = -1;
    for (let i = 0; i < compiled.length; i++) {
      const t = compiled[i];
      if (!t) continue;
      if (t(ref)) {
        allowed = format.pool[i].effect === 'allow';
        by = i;
      }
    }
    decidedBy.set(ref, by);
    if (allowed) legal.push(ref);
  }

  return { legal, decidedBy, bad };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/pool.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/rules/pool.ts app/src/rules/__tests__/pool.test.ts
git commit -m "feat(rules): the pool pipeline, where the last matching clause wins"
```

---

### Task 4: Validate a team — size and uniqueness

**Files:**
- Create: `app/src/rules/team.ts`
- Test: `app/src/rules/__tests__/team.test.ts`

**Interfaces:**
- Consumes: `resolvePool` (Task 3); `Build`, `Violation`, `Format` (Task 1); `conflictsOnTeam`, `speciesOf` from `src/lib/data.ts`.
- Produces: `validateTeam(team: readonly Build[], format: Format): { ok: boolean; violations: Violation[] }`. Task 5 extends this same function with quotas; Task 7 and the UI both call it.

**Reuse note.** `uniqueSpecies` is already implemented in the data layer as `conflictsOnTeam`, which compares by **Pokedex number** rather than by id. That is the correct comparison and not an obvious one: it catches a Pokemon against its own Shadow, a regional form against its base, and a Mega against its origin, all of which carry distinct ids. Do not write a new `a !== b` check.

- [ ] **Step 1: Write the failing test**

Create `app/src/rules/__tests__/team.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateTeam } from '../team';
import { RULES_SCHEMA, type Build, type Format } from '../types';
import { SPECIES_BY_ID, makeRef, movesFor } from '../../lib/data';

/** A legal build for a ref, using the league's rated loadout. */
function build(ref: string, league: 'great' | 'ultra' | 'master' = 'great'): Build {
  const id = ref.replace(/_shadow$/, '');
  const s = SPECIES_BY_ID.get(id)!;
  const m = movesFor(s, league);
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
}

function fmt(over: Partial<Format> = {}): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3, uniqueSpecies: true },
    selection: { mode: 'open' },
    ...over,
  };
}

describe('validateTeam', () => {
  it('accepts a legal team of the right size', () => {
    const team = [build('azumarill'), build('registeel'), build('altaria')];
    expect(validateTeam(team, fmt())).toEqual({ ok: true, violations: [] });
  });

  it('rejects the wrong size and says what it wanted', () => {
    const r = validateTeam([build('azumarill')], fmt());
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual({ kind: 'size', expected: 3, actual: 1 });
  });

  it('rejects a ref the pool banned, naming the clause', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: 'azumarill' }] });
    const r = validateTeam([build('azumarill'), build('registeel'), build('altaria')], f);
    expect(r.violations).toContainEqual({ kind: 'illegal-ref', ref: 'azumarill', clause: 0 });
  });

  it('treats a Pokemon and its own Shadow as the same species', () => {
    const team = [build('azumarill'), build(makeRef('azumarill', true)), build('altaria')];
    const r = validateTeam(team, fmt());
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === 'duplicate-species')).toBe(true);
  });

  it('allows that pair when uniqueSpecies is off', () => {
    const f = fmt({ composition: { size: 3, uniqueSpecies: false } });
    const team = [build('azumarill'), build(makeRef('azumarill', true)), build('altaria')];
    expect(validateTeam(team, f).ok).toBe(true);
  });

  it('rejects two members of one evolution family when asked', () => {
    const f = fmt({ composition: { size: 2, uniqueFamilies: true } });
    const r = validateTeam([build('poliwrath'), build('politoed')], f);
    expect(r.violations.some((v) => v.kind === 'duplicate-family')).toBe(true);
  });

  it('rejects a move the species cannot learn', () => {
    const bad: Build = { ...build('azumarill'), fast: 'NOT_A_MOVE' };
    const r = validateTeam([bad, build('registeel'), build('altaria')], fmt());
    expect(r.violations).toContainEqual({ kind: 'unknown-move', ref: 'azumarill', move: 'NOT_A_MOVE' });
  });

  it('collects every violation rather than stopping at the first', () => {
    const r = validateTeam([build('azumarill'), build(makeRef('azumarill', true))], fmt());
    expect(r.violations.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/team.test.ts`
Expected: FAIL — cannot resolve `../team`.

- [ ] **Step 3: Implement**

Create `app/src/rules/team.ts`:

```ts
import { conflictsOnTeam, speciesOf } from '../lib/data';
import { resolvePool } from './pool';
import type { Build, Format, Violation } from './types';

export interface TeamCheck {
  ok: boolean;
  violations: Violation[];
}

/**
 * Whether a team satisfies a format.
 *
 * Every violation is collected rather than returning on the first, because the
 * caller is a builder UI: showing one problem, then another after it is fixed,
 * then a third, is a worse experience than showing all three at once.
 *
 * This is also the function the coordinator will call server-side once
 * matchmaking exists, and it is the trust boundary — a client's claim that its
 * team is legal is worth nothing until this has said so somewhere the client
 * does not control. That is why it takes the team and the format and reads no
 * ambient state.
 */
export function validateTeam(team: readonly Build[], format: Format): TeamCheck {
  const violations: Violation[] = [];
  const c = format.composition;

  if (team.length !== c.size) {
    violations.push({ kind: 'size', expected: c.size, actual: team.length });
  }

  const { legal, decidedBy } = resolvePool(format);
  const legalSet = new Set(legal);

  for (const b of team) {
    if (!legalSet.has(b.ref)) {
      violations.push({ kind: 'illegal-ref', ref: b.ref, clause: decidedBy.get(b.ref) ?? -1 });
    }
    const s = speciesOf(b.ref);
    if (!s) continue;
    const fasts = new Set(s.fastMoves.map((m) => m.id));
    const charges = new Set(s.chargeMoves.map((m) => m.id));
    if (!fasts.has(b.fast)) violations.push({ kind: 'unknown-move', ref: b.ref, move: b.fast });
    for (const ch of b.charges) {
      if (!charges.has(ch)) violations.push({ kind: 'unknown-move', ref: b.ref, move: ch });
    }
  }

  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const a = team[i].ref;
      const b = team[j].ref;
      // Dex-number comparison, via the data layer. It catches a Pokemon against
      // its own Shadow, a regional form against its base and a Mega against its
      // origin — every one of which carries a distinct id, so `a !== b` would
      // miss all three.
      if (c.uniqueSpecies && conflictsOnTeam(a, b)) {
        violations.push({ kind: 'duplicate-species', refs: [a, b] });
      }
      if (c.uniqueFamilies) {
        const fa = speciesOf(a)?.family;
        const fb = speciesOf(b)?.family;
        if (fa && fb && fa === fb) violations.push({ kind: 'duplicate-family', refs: [a, b] });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/team.test.ts`
Expected: PASS, 8 tests. If the `poliwrath`/`politoed` case fails, check the actual family id in `species.json` and use two refs that genuinely share one — the assertion is about the rule, not those two species.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/rules/team.ts app/src/rules/__tests__/team.test.ts
git commit -m "feat(rules): team validation, reusing the dex-based duplicate check"
```

---

### Task 5: Quotas, including moveset restrictions

**Files:**
- Modify: `app/src/rules/team.ts` — add quota evaluation to `validateTeam`
- Create: `app/src/rules/buildSelector.ts`
- Test: `app/src/rules/__tests__/quotas.test.ts`

**Interfaces:**
- Consumes: `compileSelector` (Task 2); `Build`, `Quota` (Task 1).
- Produces: `type BuildTerm = (b: Build) => boolean` and `compileBuildSelector(select: string): BuildTerm | null` from `src/rules/buildSelector.ts`. `validateTeam` gains quota violations; its signature does not change.

**Why a second selector layer.** A pool clause asks "may I bring Forretress"; a quota may ask "may I bring *this* Forretress". In the search language `@voltswitch` means "can learn Volt Switch" — a movepool predicate. In a quota it must mean "is running Volt Switch". That is a second deliberate rebinding, and it is the mechanism by which moveset restrictions live in composition rather than in the pool.

- [ ] **Step 1: Write the failing test**

Create `app/src/rules/__tests__/quotas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileBuildSelector } from '../buildSelector';
import { validateTeam } from '../team';
import { RULES_SCHEMA, type Build, type Format } from '../types';
import { SPECIES_BY_ID, makeRef, movesFor } from '../../lib/data';

function build(ref: string): Build {
  const id = ref.replace(/_shadow$/, '');
  const s = SPECIES_BY_ID.get(id)!;
  const m = movesFor(s, 'great');
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
}

function fmt(over: Partial<Format['composition']>): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3, ...over },
    selection: { mode: 'open' },
  };
}

describe('compileBuildSelector', () => {
  it('rebinds @move to mean *running* it, not merely able to learn it', () => {
    const s = SPECIES_BY_ID.get('azumarill')!;
    const rated = movesFor(s, 'great');
    const running = compileBuildSelector(`@${rated.fast.name.toLowerCase().replace(/\s+/g, '')}`)!;
    const b = build('azumarill');
    expect(running(b)).toBe(true);

    const other = s.fastMoves.find((m) => m.id !== rated.fast.id);
    if (other) expect(running({ ...b, fast: other.id })).toBe(false);
  });

  it('still answers non-move terms from the ref', () => {
    const t = compileBuildSelector('water')!;
    expect(t(build('azumarill'))).toBe(true);
  });

  it('rebinds shadow the same way the pool selector does', () => {
    const t = compileBuildSelector('shadow')!;
    expect(t(build(makeRef('azumarill', true)))).toBe(true);
    expect(t(build('azumarill'))).toBe(false);
  });
});

describe('validateTeam quotas', () => {
  const team = [build('azumarill'), build('registeel'), build('altaria')];

  it('passes a max that is respected', () => {
    const r = validateTeam(team, fmt({ quotas: [{ select: 'water', max: 1 }] }));
    expect(r.ok).toBe(true);
  });

  it('fails a max that is exceeded, reporting the count', () => {
    const r = validateTeam(team, fmt({ quotas: [{ select: 'water', max: 0 }] }));
    expect(r.violations).toContainEqual({ kind: 'quota', select: 'water', max: 0, actual: 1 });
  });

  it('fails an unmet minimum', () => {
    const r = validateTeam(team, fmt({ quotas: [{ select: 'shadow', min: 1 }] }));
    expect(r.violations).toContainEqual({ kind: 'quota', select: 'shadow', min: 1, actual: 0 });
  });

  it('expresses "some shadows" as a range', () => {
    const mixed = [build(makeRef('azumarill', true)), build('registeel'), build('altaria')];
    const q = fmt({ quotas: [{ select: 'shadow', min: 1, max: 2 }] });
    expect(validateTeam(mixed, q).ok).toBe(true);
    expect(validateTeam(team, q).ok).toBe(false);
  });

  it('ignores a quota whose selector will not compile', () => {
    const r = validateTeam(team, fmt({ quotas: [{ select: '  ' }] }));
    expect(r.violations.filter((v) => v.kind === 'quota')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/quotas.test.ts`
Expected: FAIL — cannot resolve `../buildSelector`.

- [ ] **Step 3: Implement the build selector**

Create `app/src/rules/buildSelector.ts`:

```ts
import { CHARGE_MOVES, FAST_MOVES } from '../lib/data';
import { compileSelector } from './selector';
import type { Build } from './types';

/** A predicate over a build — a ref plus the loadout it is running. */
export type BuildTerm = (b: Build) => boolean;

const ALL_MOVES = [...FAST_MOVES, ...CHARGE_MOVES];

/** Loose match on a move's name, id or type, the way the search box matches. */
function movesMatching(body: string): Set<string> {
  const want = body.replace(/\s+/g, '');
  const out = new Set<string>();
  for (const m of ALL_MOVES) {
    const name = m.name.toLowerCase().replace(/\s+/g, '');
    const id = m.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name.includes(want) || id.includes(want) || m.type === want) out.add(m.id);
  }
  return out;
}

/**
 * Compile a quota selector, which sees the loadout as well as the ref.
 *
 * One token is rebound relative to both the search language and the pool
 * selector: `@x` in search asks whether a species *can learn* x, and in a quota
 * it asks whether this build is *running* x. That difference is what lets a
 * format say "at most one Volt Switch" without the pool having to ban
 * Forretress outright — which is the placement the spec argues for, since the
 * pool answers whether you may bring Forretress and composition answers whether
 * you may bring that one.
 *
 * Every other token falls through to the ref selector unchanged.
 */
export function compileBuildSelector(select: string): BuildTerm | null {
  const q = select.trim().toLowerCase();
  if (!q) return null;

  const alternatives = q.split(',').map((clause) =>
    clause.split('&').map((raw): BuildTerm => {
      let body = raw.trim();
      let negate = false;
      while (body.startsWith('!')) {
        negate = !negate;
        body = body.slice(1).trim();
      }

      if (body.startsWith('@')) {
        const ids = movesMatching(body.slice(1));
        const t: BuildTerm = (b) => ids.has(b.fast) || b.charges.some((c) => ids.has(c));
        return negate ? (b) => !t(b) : t;
      }

      const ref = compileSelector(raw);
      return ref ? (b) => ref(b.ref) : () => true;
    }),
  );

  if (!alternatives.length) return null;
  return (b) => alternatives.some((and) => and.every((t) => t(b)));
}
```

- [ ] **Step 4: Add quota evaluation to `validateTeam`**

In `app/src/rules/team.ts`, add the import:

```ts
import { compileBuildSelector } from './buildSelector';
```

and insert this block immediately before the final `return` statement:

```ts
  // Quotas are count constraints over the subset of the team matching a
  // selector. A quota whose selector will not compile is skipped rather than
  // failing the team: an unparseable rule is the author's problem and is
  // reported by lintFormat at publish time, not the player's problem here.
  for (const q of format.composition.quotas ?? []) {
    const term = compileBuildSelector(q.select);
    if (!term) continue;
    const actual = team.filter(term).length;
    const under = q.min !== undefined && actual < q.min;
    const over = q.max !== undefined && actual > q.max;
    if (under || over) {
      // Built as one literal rather than assigned field by field: `Violation`
      // is a discriminated union and tsc will not let you set `.min` on a value
      // already narrowed to one member.
      violations.push({
        kind: 'quota',
        select: q.select,
        actual,
        ...(q.min !== undefined ? { min: q.min } : {}),
        ...(q.max !== undefined ? { max: q.max } : {}),
      });
    }
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd app && npx vitest run src/rules/__tests__/quotas.test.ts src/rules/__tests__/team.test.ts`
Expected: PASS, 13 tests total.

- [ ] **Step 6: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/rules/buildSelector.ts app/src/rules/team.ts app/src/rules/__tests__/quotas.test.ts
git commit -m "feat(rules): quotas, and moveset rules that live in composition"
```

---

### Task 6: Lint a format — pool size and dead clauses

**Files:**
- Create: `app/src/rules/lint.ts`
- Test: `app/src/rules/__tests__/lint.test.ts`

**Interfaces:**
- Consumes: `resolvePool` (Task 3); `Diagnostic`, `Format` (Task 1); `opponentCandidatesFor` from `src/lib/data.ts`.
- Produces: `lintFormat(format: Format): Diagnostic[]` and the exported constants `NARROW_POOL_FRACTION = 0.1`, `MIN_POOL_ABSOLUTE = 30`, `RANDOM_POOL_MULTIPLE = 4`. Task 7 extends the same function with the satisfiability check.

**Thresholds, and why they are relative.** The measured base pools are 1,143 refs in Great, 841 in Ultra and 365 in Master. A flat floor is either trivial in Great or crippling in Master, so narrowness is a fraction of the base league. Export the constants so a test can assert them and a future tuning pass has one place to edit.

- [ ] **Step 1: Write the failing test**

Create `app/src/rules/__tests__/lint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lintFormat, MIN_POOL_ABSOLUTE, NARROW_POOL_FRACTION, RANDOM_POOL_MULTIPLE } from '../lint';
import { RULES_SCHEMA, type Format } from '../types';

function fmt(over: Partial<Format> = {}): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3 },
    selection: { mode: 'open' },
    ...over,
  };
}

describe('lintFormat', () => {
  it('passes a plain league format with nothing to say', () => {
    expect(lintFormat(fmt())).toEqual([]);
  });

  it('errors on a pool emptied by its own clauses', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '!nothingmatchesthisxyz' }] });
    expect(lintFormat(f).some((d) => d.kind === 'empty-pool' && d.level === 'error')).toBe(true);
  });

  it('errors on a selector that will not compile', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '   ' }] });
    expect(lintFormat(f)).toContainEqual({ level: 'error', kind: 'bad-selector', clause: 0, select: '   ' });
  });

  it('warns on a clause that matches nothing', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: 'zzzznotaspecies' }] });
    expect(lintFormat(f).some((d) => d.kind === 'dead-clause' && d.clause === 0)).toBe(true);
  });

  it('warns on a clause fully shadowed by a later one', () => {
    const f = fmt({
      pool: [
        { effect: 'deny', select: 'azumarill' },
        { effect: 'allow', select: 'water' },
      ],
    });
    expect(lintFormat(f).some((d) => d.kind === 'dead-clause' && d.clause === 0)).toBe(true);
  });

  it('warns when the pool is a sliver of its league', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '!azumarill' }] });
    expect(lintFormat(f).some((d) => d.kind === 'narrow-pool')).toBe(true);
  });

  it('errors when a random draft has too few to draw from', () => {
    const f = fmt({
      pool: [{ effect: 'deny', select: '!azumarill' }],
      selection: { mode: 'random' },
    });
    expect(lintFormat(f).some((d) => d.kind === 'pool-too-small' && d.level === 'error')).toBe(true);
  });

  it('does not raise pool-too-small for an open-pick format', () => {
    const f = fmt({ pool: [{ effect: 'deny', select: '!azumarill' }] });
    expect(lintFormat(f).some((d) => d.kind === 'pool-too-small')).toBe(false);
  });

  it('exposes its thresholds for tuning', () => {
    expect(NARROW_POOL_FRACTION).toBeGreaterThan(0);
    expect(MIN_POOL_ABSOLUTE).toBeGreaterThan(0);
    expect(RANDOM_POOL_MULTIPLE).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/lint.test.ts`
Expected: FAIL — cannot resolve `../lint`.

- [ ] **Step 3: Implement**

Create `app/src/rules/lint.ts`:

```ts
import { opponentCandidatesFor } from '../lib/data';
import { resolvePool } from './pool';
import { compileSelector } from './selector';
import type { Diagnostic, Format } from './types';

/**
 * Publish-time thresholds.
 *
 * Relative rather than absolute because the base pools differ by a factor of
 * three — 1,143 refs in Great, 841 in Ultra, 365 in Master — so one flat number
 * is either trivial at the top or crippling at the bottom. Exported so a test
 * can assert them and a tuning pass has exactly one place to edit.
 */
export const NARROW_POOL_FRACTION = 0.1;
export const MIN_POOL_ABSOLUTE = 30;
/** A random draft needs a pool several times its team size to be a draft. */
export const RANDOM_POOL_MULTIPLE = 4;

/**
 * Everything wrong with a format, before anybody plays it.
 *
 * Errors block publishing; warnings do not. The distinction matters: a format
 * that is merely narrow is a legitimate thing to want, and refusing it would be
 * the tool overruling its user. A format that no legal team can satisfy is not.
 */
export function lintFormat(format: Format): Diagnostic[] {
  const out: Diagnostic[] = [];

  format.pool.forEach((c, i) => {
    if (!compileSelector(c.select)) {
      out.push({ level: 'error', kind: 'bad-selector', clause: i, select: c.select });
    }
  });

  const { legal, decidedBy } = resolvePool(format);
  const leagueSize = opponentCandidatesFor(format.base).length;

  if (legal.length === 0) {
    out.push({ level: 'error', kind: 'empty-pool' });
    return out;
  }

  // A clause is dead when it decided nothing — either it matched no ref at all,
  // or every ref it matched was overruled by a later clause. Both read the same
  // to an author ("rule 3 does nothing") and both are nearly always a typo, so
  // they warn rather than block.
  const decisive = new Set(decidedBy.values());
  format.pool.forEach((_, i) => {
    if (!decisive.has(i) && compileSelector(format.pool[i].select)) {
      out.push({ level: 'warn', kind: 'dead-clause', clause: i });
    }
  });

  const size = format.composition.size;
  if (format.selection.mode === 'random' && legal.length < size * RANDOM_POOL_MULTIPLE) {
    out.push({
      level: 'error',
      kind: 'pool-too-small',
      need: size * RANDOM_POOL_MULTIPLE,
      have: legal.length,
    });
  }

  if (legal.length < Math.max(MIN_POOL_ABSOLUTE, leagueSize * NARROW_POOL_FRACTION)) {
    out.push({ level: 'warn', kind: 'narrow-pool', have: legal.length, leagueSize });
  }

  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/lint.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/rules/lint.ts app/src/rules/__tests__/lint.test.ts
git commit -m "feat(rules): publish-time linting, with thresholds scaled to the league"
```

---

### Task 7: Prove a format is satisfiable

**Files:**
- Modify: `app/src/rules/lint.ts` — add the satisfiability search
- Test: `app/src/rules/__tests__/satisfiable.test.ts`

**Interfaces:**
- Consumes: `resolvePool` (Task 3), `compileBuildSelector` (Task 5), `conflictsOnTeam` and `speciesOf` from `src/lib/data.ts`.
- Produces: `findSatisfyingTeam(format: Format): { found: string[] | null; exhausted: boolean }` exported from `src/rules/lint.ts`, plus the constant `SEARCH_NODE_BUDGET = 20000`. `lintFormat` gains `unsatisfiable` and `unsatisfiable-unproven` diagnostics.

**Why this is a search and not a count.** Quotas with minimums interact with uniqueness constraints in ways no count detects. "Minimum one Shadow, maximum one Water, unique families, size six" can be individually satisfiable in every clause and jointly impossible. The search is bounded, and **when the budget runs out it reports "unproven", never "unsatisfiable"** — a linter that says "I could not prove this works" is honest, and one that wrongly blocks a legal format is not.

Refs are evaluated as builds using each species' rated loadout, since a quota may be moveset-aware and a satisfiability proof needs a concrete team.

- [ ] **Step 1: Write the failing test**

Create `app/src/rules/__tests__/satisfiable.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findSatisfyingTeam, lintFormat } from '../lint';
import { RULES_SCHEMA, type Format } from '../types';

function fmt(over: Partial<Format> = {}): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size: 3, uniqueSpecies: true },
    selection: { mode: 'open' },
    ...over,
  };
}

describe('findSatisfyingTeam', () => {
  it('finds a team for an ordinary format', () => {
    const r = findSatisfyingTeam(fmt());
    expect(r.found).not.toBeNull();
    expect(r.found!.length).toBe(3);
  });

  it('finds one under a minimum quota', () => {
    const f = fmt({ composition: { size: 3, uniqueSpecies: true, quotas: [{ select: 'shadow', min: 1 }] } });
    expect(findSatisfyingTeam(f).found).not.toBeNull();
  });

  it('proves a contradiction impossible', () => {
    const f = fmt({
      composition: {
        size: 2,
        uniqueSpecies: true,
        quotas: [{ select: 'shadow', min: 2 }, { select: 'shadow', max: 0 }],
      },
    });
    const r = findSatisfyingTeam(f);
    expect(r.found).toBeNull();
    expect(r.exhausted).toBe(false);
  });

  it('cannot field more members than the pool holds', () => {
    const f = fmt({
      pool: [{ effect: 'deny', select: '!azumarill' }],
      composition: { size: 3, uniqueSpecies: true },
    });
    expect(findSatisfyingTeam(f).found).toBeNull();
  });
});

describe('lintFormat satisfiability', () => {
  it('errors when a format is provably unsatisfiable', () => {
    const f = fmt({
      composition: {
        size: 2,
        uniqueSpecies: true,
        quotas: [{ select: 'shadow', min: 2 }, { select: 'shadow', max: 0 }],
      },
    });
    expect(lintFormat(f).some((d) => d.kind === 'unsatisfiable' && d.level === 'error')).toBe(true);
  });

  it('says nothing about satisfiability for a format that works', () => {
    const ds = lintFormat(fmt());
    expect(ds.some((d) => d.kind === 'unsatisfiable' || d.kind === 'unsatisfiable-unproven')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/satisfiable.test.ts`
Expected: FAIL — `findSatisfyingTeam` is not exported.

- [ ] **Step 3: Implement**

In `app/src/rules/lint.ts`, add these imports:

```ts
import { SPECIES_BY_ID, conflictsOnTeam, movesFor, parseRef, speciesOf } from '../lib/data';
import { compileBuildSelector, type BuildTerm } from './buildSelector';
import type { Build, Quota } from './types';
```

and add, above `lintFormat`:

```ts
/**
 * How many partial teams the satisfiability search will consider.
 *
 * Bounded because the search is over a pool of up to ~1,100 refs and a
 * pathological format could otherwise hang the builder on every keystroke.
 * Exhausting the budget is reported as "unproven", never as "unsatisfiable" —
 * see findSatisfyingTeam.
 */
export const SEARCH_NODE_BUDGET = 20000;

/** The rated loadout for a ref, which is what a satisfiability proof fields. */
function ratedBuild(ref: string, format: Format): Build {
  const s = SPECIES_BY_ID.get(parseRef(ref).id)!;
  const m = movesFor(s, format.base);
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
}

/**
 * Look for one team that satisfies every composition rule.
 *
 * Backtracking over slots, with unmet minimum quotas driving the candidate
 * order — a format demanding a Shadow is far more quickly satisfied by trying
 * Shadows first than by walking the pool alphabetically.
 *
 * The distinction between the two failure modes is the whole point. `found:
 * null, exhausted: false` means the search space was covered and nothing works,
 * which is a real error worth blocking a publish. `found: null, exhausted:
 * true` means the budget ran out, which proves nothing at all and must never
 * be reported as unsatisfiable — wrongly blocking a legal format is a worse
 * failure than letting a pathological one through.
 */
export function findSatisfyingTeam(format: Format): { found: string[] | null; exhausted: boolean } {
  const c = format.composition;
  const { legal } = resolvePool(format);
  if (legal.length < c.size) return { found: null, exhausted: false };

  const quotas = (c.quotas ?? [])
    .map((q) => ({ q, term: compileBuildSelector(q.select) }))
    .filter((x): x is { q: Quota; term: BuildTerm } => x.term !== null);

  const builds = new Map(legal.map((r) => [r, ratedBuild(r, format)]));
  let nodes = 0;
  let exhausted = false;

  const chosen: string[] = [];

  function counts(): number[] {
    return quotas.map(({ term }) => chosen.filter((r) => term(builds.get(r)!)).length);
  }

  function viable(): boolean {
    const remaining = c.size - chosen.length;
    const cs = counts();
    for (let i = 0; i < quotas.length; i++) {
      const { q } = quotas[i];
      if (q.max !== undefined && cs[i] > q.max) return false;
      if (q.min !== undefined && cs[i] + remaining < q.min) return false;
    }
    return true;
  }

  function compatible(ref: string): boolean {
    for (const r of chosen) {
      if (c.uniqueSpecies && conflictsOnTeam(r, ref)) return false;
      if (c.uniqueFamilies) {
        const a = speciesOf(r)?.family;
        const b = speciesOf(ref)?.family;
        if (a && b && a === b) return false;
      }
    }
    return true;
  }

  /**
   * Candidate order, computed once.
   *
   * Members of any minimum quota come first, so a format demanding a Shadow is
   * satisfied in a few nodes rather than after walking the pool alphabetically.
   *
   * Deliberately static rather than recomputed per node. A dynamic reordering
   * would destroy the index ordering that makes this a search over *
   * combinations, and without it the recursion has to restart from 0 at every
   * level and explores permutations instead — 6! times more work for the same
   * answer, which turns a cheap search into one that only ever reports
   * "unproven".
   */
  const ordered = (() => {
    const wanted: string[] = [];
    const rest: string[] = [];
    const mins = quotas.filter(({ q }) => q.min !== undefined);
    for (const r of legal) {
      (mins.some(({ term }) => term(builds.get(r)!)) ? wanted : rest).push(r);
    }
    return [...wanted, ...rest];
  })();

  function search(startIdx: number): boolean {
    if (!viable()) return false;
    if (chosen.length === c.size) return true;
    if (nodes++ > SEARCH_NODE_BUDGET) {
      exhausted = true;
      return false;
    }
    for (let i = startIdx; i < ordered.length; i++) {
      const ref = ordered[i];
      if (!compatible(ref)) continue;
      chosen.push(ref);
      // i + 1, never 0: each ref is considered once per branch, so this walks
      // combinations rather than permutations.
      if (search(i + 1)) return true;
      chosen.pop();
      if (exhausted) return false;
    }
    return false;
  }

  const ok = search(0);
  return { found: ok ? [...chosen] : null, exhausted };
}
```

Then, in `lintFormat`, immediately before the final `return out;`:

```ts
  const sat = findSatisfyingTeam(format);
  if (!sat.found) {
    out.push(
      sat.exhausted
        ? { level: 'warn', kind: 'unsatisfiable-unproven' }
        : { level: 'error', kind: 'unsatisfiable' },
    );
  }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/satisfiable.test.ts src/rules/__tests__/lint.test.ts`
Expected: PASS, 15 tests. If the search is slow enough to be noticeable, lower `SEARCH_NODE_BUDGET` and confirm the "provably impossible" test still reports `exhausted: false` — that case must terminate by exhausting the space, not the budget.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/rules/lint.ts app/src/rules/__tests__/satisfiable.test.ts
git commit -m "feat(rules): a bounded satisfiability search that admits when it does not know"
```

---

### Task 8: The deterministic draft

**Files:**
- Create: `app/src/rules/roll.ts`
- Test: `app/src/rules/__tests__/roll.test.ts`

**Interfaces:**
- Consumes: `resolvePool` (Task 3); `Format`, `Build` (Task 1); `rankOfRef`, `SPECIES_BY_ID`, `movesFor`, `parseRef` from `src/lib/data.ts`.
- Produces: `rollTeam(format: Format, seed: string, playerId: string): Build[]` from `src/rules/roll.ts`.

**Determinism is the requirement, not randomness.** Both players roll from one shared seed and must get different, reproducible teams. The draw must be recomputable later from the seed alone, so a claim of a bad roll can be checked. That rules out `Math.random` entirely — including the seeded one in `src/test/setup.ts`, which is test scaffolding and not available in production.

- [ ] **Step 1: Write the failing test**

Create `app/src/rules/__tests__/roll.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rollTeam } from '../roll';
import { RULES_SCHEMA, type Format } from '../types';
import { SPECIES_BY_ID, movesFor, parseRef, rankOfRef } from '../../lib/data';

function fmt(over: Partial<Format['selection']> = {}, size = 6): Format {
  return {
    schema: RULES_SCHEMA,
    base: 'great',
    pool: [],
    composition: { size, uniqueSpecies: true },
    selection: { mode: 'random', ...over },
  };
}

describe('rollTeam', () => {
  it('is deterministic for one seed and player', () => {
    const a = rollTeam(fmt(), 'seed-1', 'player-a');
    const b = rollTeam(fmt(), 'seed-1', 'player-a');
    expect(a).toEqual(b);
  });

  it('gives two players different draws from the same seed', () => {
    const a = rollTeam(fmt(), 'seed-1', 'player-a');
    const b = rollTeam(fmt(), 'seed-1', 'player-b');
    expect(a.map((x) => x.ref)).not.toEqual(b.map((x) => x.ref));
  });

  it('changes with the seed', () => {
    const a = rollTeam(fmt(), 'seed-1', 'player-a');
    const b = rollTeam(fmt(), 'seed-2', 'player-a');
    expect(a.map((x) => x.ref)).not.toEqual(b.map((x) => x.ref));
  });

  it('deals exactly the composition size', () => {
    expect(rollTeam(fmt({}, 3), 's', 'p')).toHaveLength(3);
  });

  it('never deals the same species twice when uniqueSpecies is set', () => {
    const dexes = rollTeam(fmt(), 's', 'p').map((b) => SPECIES_BY_ID.get(parseRef(b.ref).id)!.dex);
    expect(new Set(dexes).size).toBe(dexes.length);
  });

  it('draws only from the top N when asked', () => {
    const team = rollTeam(fmt({ topN: 20 }), 's', 'p');
    for (const b of team) expect(rankOfRef(b.ref, 'great')).toBeLessThanOrEqual(20);
  });

  it('leaves playerPicks slots undealt', () => {
    expect(rollTeam(fmt({ playerPicks: 2 }, 6), 's', 'p')).toHaveLength(4);
  });

  it('deals the rated loadout when rollMoves is off', () => {
    const b = rollTeam(fmt({ rollMoves: false }, 1), 's', 'p')[0];
    const s = SPECIES_BY_ID.get(parseRef(b.ref).id)!;
    expect(b.fast).toBe(movesFor(s, 'great').fast.id);
  });

  it('deals a legal loadout when rollMoves is on', () => {
    const team = rollTeam(fmt({ rollMoves: true }, 6), 's', 'p');
    for (const b of team) {
      const s = SPECIES_BY_ID.get(parseRef(b.ref).id)!;
      expect(s.fastMoves.some((m) => m.id === b.fast)).toBe(true);
      for (const c of b.charges) expect(s.chargeMoves.some((m) => m.id === c)).toBe(true);
    }
  });

  it('does not depend on Math.random', () => {
    const real = Math.random;
    Math.random = () => { throw new Error('rollTeam must not use Math.random'); };
    try {
      expect(() => rollTeam(fmt(), 's', 'p')).not.toThrow();
    } finally {
      Math.random = real;
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/rules/__tests__/roll.test.ts`
Expected: FAIL — cannot resolve `../roll`.

- [ ] **Step 3: Implement**

Create `app/src/rules/roll.ts`:

```ts
import { SPECIES_BY_ID, conflictsOnTeam, movesFor, parseRef, rankOfRef, speciesOf } from '../lib/data';
import { resolvePool } from './pool';
import type { Build, Format } from './types';

/**
 * A seeded generator, so a draw can be recomputed from the seed alone.
 *
 * Math.random is unusable here even though the test setup seeds it: that seeding
 * is scaffolding for the suite, not a property of the running app, and a draw
 * that cannot be reproduced outside a test is a draw nobody can audit. The
 * requirement is not randomness, it is a reproducible arbitrary order.
 *
 * xmur3 to turn the string key into a 32-bit state, then mulberry32 — the same
 * generator the test setup uses, chosen for the same reasons: three lines,
 * uniform enough, identical on every platform.
 */
function seedFrom(key: string): number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function rng(key: string): () => number {
  let a = seedFrom(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal one player's team.
 *
 * The key mixes the seed with the player id, so both sides of a match draw from
 * one agreed seed and still get different teams — and either draw can be
 * checked afterwards by anyone holding the seed.
 *
 * `playerPicks` slots are left undealt: the player fills them. So a six with two
 * picks returns four builds, and the UI is responsible for the rest.
 */
export function rollTeam(format: Format, seed: string, playerId: string): Build[] {
  const next = rng(`${seed}|${playerId}`);
  const { legal } = resolvePool(format);

  const topN = format.selection.topN;
  const pool = topN ? legal.filter((r) => rankOfRef(r, format.base) <= topN) : [...legal];

  // Fisher-Yates against the seeded generator, so the order is a function of the
  // key and nothing else.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const want = Math.max(0, format.composition.size - (format.selection.playerPicks ?? 0));
  const picked: string[] = [];
  for (const ref of pool) {
    if (picked.length === want) break;
    if (format.composition.uniqueSpecies && picked.some((r) => conflictsOnTeam(r, ref))) continue;
    if (format.composition.uniqueFamilies) {
      const f = speciesOf(ref)?.family;
      if (f && picked.some((r) => speciesOf(r)?.family === f)) continue;
    }
    picked.push(ref);
  }

  return picked.map((ref) => {
    const s = SPECIES_BY_ID.get(parseRef(ref).id)!;
    if (!format.selection.rollMoves) {
      const m = movesFor(s, format.base);
      return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id) };
    }
    const fast = s.fastMoves[Math.floor(next() * s.fastMoves.length)];
    const charges = [...s.chargeMoves];
    for (let i = charges.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [charges[i], charges[j]] = [charges[j], charges[i]];
    }
    return { ref, fast: fast.id, charges: charges.slice(0, Math.min(2, charges.length)).map((c) => c.id) };
  });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/roll.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/rules/roll.ts app/src/rules/__tests__/roll.test.ts
git commit -m "feat(rules): a draft that can be recomputed from its seed"
```

---

### Task 9: The public surface, and the React guard

**Files:**
- Create: `app/src/rules/index.ts`
- Test: `app/src/rules/__tests__/isolation.test.ts`
- Modify: the oxlint config at `app/.oxlintrc.json` (create it if absent — check first with `ls app/.oxlintrc*`)

**Interfaces:**
- Produces: `src/rules/index.ts` re-exporting `canonicalize`, `compileSelector`, `compileBuildSelector`, `resolvePool`, `validateTeam`, `lintFormat`, `findSatisfyingTeam`, `rollTeam`, and every type from `types.ts`. UI code imports only from `../rules`.

**Why the isolation test exists.** The rules module's whole value later is that a server can run it. That property is invisible — nothing breaks today if somebody imports React into it — so it needs a test that fails the moment it stops being true, rather than a comment asking people to be careful.

- [ ] **Step 1: Write the barrel**

Create `app/src/rules/index.ts`:

```ts
/**
 * The rules module's public surface.
 *
 * UI code imports from here and never from the files behind it, so the internal
 * layout can change without a hundred import rewrites — and so the one rule
 * that matters about this directory stays checkable: nothing in it may import
 * React or touch a browser API. It has to run unchanged under Node, because the
 * server will eventually validate teams with exactly this code, and a validator
 * that disagrees with the client is worse than no validator.
 */
export { canonicalize } from './canonical';
export { compileSelector, type RefTerm } from './selector';
export { compileBuildSelector, type BuildTerm } from './buildSelector';
export { resolvePool, type PoolResolution } from './pool';
export { validateTeam, type TeamCheck } from './team';
export {
  lintFormat,
  findSatisfyingTeam,
  MIN_POOL_ABSOLUTE,
  NARROW_POOL_FRACTION,
  RANDOM_POOL_MULTIPLE,
  SEARCH_NODE_BUDGET,
} from './lint';
export { rollTeam } from './roll';
export * from './types';
```

- [ ] **Step 2: Write the failing isolation test**

Create `app/src/rules/__tests__/isolation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/rules');

function sources(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.ts'));
}

describe('src/rules stays runnable outside a browser', () => {
  it('imports no React', () => {
    for (const f of sources()) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, `${f} imports react`).not.toMatch(/from\s+['"]react/);
    }
  });

  it('touches no browser global', () => {
    // Word-boundary matches so a comment mentioning "the document" does not trip
    // it, but `document.querySelector` does.
    const banned = /\b(window|document|localStorage|sessionStorage|navigator)\s*\./;
    for (const f of sources()) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, `${f} touches a browser global`).not.toMatch(banned);
    }
  });

  it('has at least one source file, so the test cannot pass vacuously', () => {
    expect(sources().length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 3: Run it and watch it pass**

Run: `cd app && npx vitest run src/rules/__tests__/isolation.test.ts`
Expected: PASS, 3 tests. This one passes immediately — it is a regression guard, not a red-green cycle. Prove it can fail: temporarily add `import { useState } from 'react';` to `src/rules/pool.ts`, re-run, confirm FAIL, then remove it.

- [ ] **Step 4: Confirm the module really does run under Node**

Run:

```bash
cd app && ./node_modules/.bin/esbuild src/rules/index.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/rules-check.mjs --log-level=warning \
  && node -e "import('./node_modules/.cache/rules-check.mjs').then(m => console.log('exports:', Object.keys(m).length))"
```

Expected: a bundle builds and prints a non-zero export count. This is the same mechanism `scripts/build-matrix.ts` already uses to run `src/lib` under Node, and it is the actual proof the isolation test approximates.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/rules/index.ts app/src/rules/__tests__/isolation.test.ts
git commit -m "feat(rules): one public surface, and a test that keeps it server-runnable"
```

---

### Task 10: Persist formats to localStorage

**Files:**
- Create: `app/src/state/formatStore.ts`
- Test: `app/src/state/__tests__/formatStore.test.ts`

**Interfaces:**
- Consumes: `Format`, `RULES_SCHEMA`, `canonicalize` from `../rules`.
- Produces: `interface StoredFormat { id: string; name: string; format: Format; updatedAt: number }`, and `listFormats(): StoredFormat[]`, `saveFormat(name: string, format: Format, id?: string): StoredFormat`, `deleteFormat(id: string): void`, `STORAGE_KEY`.

**Where the browser lives.** This is the only file in the plan that touches `localStorage`, which is why it sits in `src/state/` rather than `src/rules/`. Follow the pattern already in `src/state/ThemeContext.tsx` for reading and writing.

- [ ] **Step 1: Write the failing test**

Create `app/src/state/__tests__/formatStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEY, deleteFormat, listFormats, saveFormat } from '../formatStore';
import { RULES_SCHEMA, type Format } from '../../rules';

const f: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [{ effect: 'deny', select: 'flying' }],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

beforeEach(() => localStorage.clear());

describe('formatStore', () => {
  it('starts empty', () => expect(listFormats()).toEqual([]));

  it('round-trips a saved format', () => {
    const saved = saveFormat('Air Ban', f);
    const back = listFormats();
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(saved.id);
    expect(back[0].format).toEqual(f);
  });

  it('updates in place when given an id', () => {
    const first = saveFormat('Air Ban', f);
    const edited: Format = { ...f, composition: { ...f.composition, size: 6 } };
    saveFormat('Air Ban', edited, first.id);
    const back = listFormats();
    expect(back).toHaveLength(1);
    expect(back[0].format.composition.size).toBe(6);
  });

  it('deletes', () => {
    const s = saveFormat('Air Ban', f);
    deleteFormat(s.id);
    expect(listFormats()).toEqual([]);
  });

  it('survives corrupt storage rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not json{{{');
    expect(listFormats()).toEqual([]);
  });

  it('drops a stored format whose schema it does not know', () => {
    const alien = [{ id: 'x', name: 'Alien', updatedAt: 1, format: { ...f, schema: 999 } }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alien));
    expect(listFormats()).toEqual([]);
  });

  it('orders most recently updated first', () => {
    const a = saveFormat('A', f);
    const b = saveFormat('B', f);
    expect(listFormats()[0].id).toBe(b.id);
    saveFormat('A', f, a.id);
    expect(listFormats()[0].id).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/state/__tests__/formatStore.test.ts`
Expected: FAIL — cannot resolve `../formatStore`.

- [ ] **Step 3: Implement**

Create `app/src/state/formatStore.ts`:

```ts
import { RULES_SCHEMA, type Format } from '../rules';

export const STORAGE_KEY = 'paragon.formats.v1';

export interface StoredFormat {
  id: string;
  name: string;
  format: Format;
  updatedAt: number;
}

/**
 * Formats, kept in localStorage until there is a server to keep them on.
 *
 * Two things this deliberately does not do. It does not throw on bad input:
 * storage can be corrupted, cleared or written by an older build, and a format
 * list that explodes takes the whole screen with it — an empty list is a
 * recoverable state and an exception is not. And it does not migrate unknown
 * schema versions, it drops them, because guessing at the meaning of a ruleset
 * silently changes which teams are legal.
 */
function read(): StoredFormat[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is StoredFormat =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as StoredFormat).id === 'string' &&
        typeof (x as StoredFormat).name === 'string' &&
        !!(x as StoredFormat).format &&
        (x as StoredFormat).format.schema === RULES_SCHEMA,
    );
  } catch {
    return [];
  }
}

function write(all: StoredFormat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A full or unavailable quota is not worth taking the screen down for.
  }
}

/** Saved formats, most recently updated first. */
export function listFormats(): StoredFormat[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveFormat(name: string, format: Format, id?: string): StoredFormat {
  const all = read();
  const entry: StoredFormat = {
    id: id ?? `f${Date.now().toString(36)}${all.length}`,
    name,
    format,
    updatedAt: Date.now(),
  };
  write([...all.filter((x) => x.id !== entry.id), entry]);
  return entry;
}

export function deleteFormat(id: string): void {
  write(read().filter((x) => x.id !== id));
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd app && npx vitest run src/state/__tests__/formatStore.test.ts`
Expected: PASS, 7 tests. If the "most recently updated first" test is flaky because two saves land in the same millisecond, that is a real ordering weakness — add a monotonic counter to `updatedAt` rather than loosening the test.

- [ ] **Step 5: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/state/formatStore.ts app/src/state/__tests__/formatStore.test.ts
git commit -m "feat(formats): localStorage persistence that survives a corrupt store"
```

---

### Task 11: The pool preview, and why a ref is illegal

**Files:**
- Create: `app/src/components/PoolPreview.tsx`
- Modify: `app/src/styles/components.css`
- Test: `app/src/components/__tests__/pool-preview.test.tsx`

**Interfaces:**
- Consumes: `resolvePool`, `lintFormat`, `Format` from `../rules`; `displayName`, `speciesOf` from `../lib/data`.
- Produces: `<PoolPreview format={f} onExplain={(ref) => …} />` — a component showing the legal count, each clause's delta, the diagnostics, and an explanation line for a queried ref.

**The affordance this task exists for.** Under last-match-wins every ref has exactly one deciding clause, so "why is my Mantine illegal?" has a precise answer — *denied by rule 1: `flying`* — and it costs nothing to produce, because `resolvePool` already computed it.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/__tests__/pool-preview.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoolPreview } from '../PoolPreview';
import { RULES_SCHEMA, type Format } from '../../rules';

const f: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [
    { effect: 'deny', select: 'flying', note: 'air banned' },
    { effect: 'allow', select: '+mantine' },
  ],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

describe('PoolPreview', () => {
  it('shows how many refs are legal', () => {
    render(<PoolPreview format={f} />);
    expect(screen.getByTestId('pool-count').textContent).toMatch(/\d/);
  });

  it('shows a delta for every clause', () => {
    render(<PoolPreview format={f} />);
    expect(screen.getAllByTestId('clause-delta')).toHaveLength(2);
  });

  it('names the deciding clause for an illegal ref', () => {
    render(<PoolPreview format={f} explain="pidgeot" />);
    expect(screen.getByTestId('explain').textContent).toMatch(/rule 1/i);
  });

  it('says so when a ref is legal', () => {
    render(<PoolPreview format={f} explain="azumarill" />);
    expect(screen.getByTestId('explain').textContent).toMatch(/legal/i);
  });

  it('renders diagnostics when the format has problems', () => {
    const broken: Format = { ...f, pool: [{ effect: 'deny', select: '!zzz' }] };
    render(<PoolPreview format={broken} />);
    expect(screen.getAllByTestId('diagnostic').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/__tests__/pool-preview.test.tsx`
Expected: FAIL — cannot resolve `../PoolPreview`.

- [ ] **Step 3: Implement**

Create `app/src/components/PoolPreview.tsx`:

```tsx
import { useMemo } from 'react';
import { displayName } from '../lib/data';
import { lintFormat, resolvePool, type Format } from '../rules';

interface Props {
  format: Format;
  /** A ref to explain, if the user has asked about one. */
  explain?: string;
}

/**
 * The legal pool, as it stands, with each clause's contribution.
 *
 * Recomputed from scratch on every render rather than diffed: the roster is
 * ~1,650 refs and a term compiles to a closure, so a full pass is far below
 * anything worth memoising against a keystroke, and an incremental version
 * would have to reproduce last-match-wins a second time to stay correct.
 *
 * The per-clause delta is what the pipeline costs the author to understand, so
 * it is shown rather than described: a clause that reads as a small exception
 * and removes eighty refs is the mistake this catches.
 */
export function PoolPreview({ format, explain }: Props) {
  const { legal, decidedBy } = useMemo(() => resolvePool(format), [format]);
  const diagnostics = useMemo(() => lintFormat(format), [format]);

  // Each prefix of the clause list, so a delta is the difference one clause made
  // in the position it actually occupies — which is the only place its effect is
  // defined.
  const deltas = useMemo(() => {
    let prev = resolvePool({ ...format, pool: [] }).legal.length;
    return format.pool.map((_, i) => {
      const n = resolvePool({ ...format, pool: format.pool.slice(0, i + 1) }).legal.length;
      const d = n - prev;
      prev = n;
      return d;
    });
  }, [format]);

  const explained = explain ? decidedBy.get(explain) : undefined;

  return (
    <section className="pool-preview">
      <p className="hud-label">Legal pool</p>
      <p data-testid="pool-count" className="pool-count">
        {legal.length}
      </p>

      <ol className="clause-deltas">
        {format.pool.map((c, i) => (
          <li key={i} data-testid="clause-delta">
            <span className="hud-label">rule {i + 1}</span>
            <code>{c.effect} {c.select}</code>
            <span className={deltas[i] < 0 ? 'delta-down' : 'delta-up'}>
              {deltas[i] > 0 ? `+${deltas[i]}` : deltas[i]}
            </span>
          </li>
        ))}
      </ol>

      {explain && (
        <p data-testid="explain" className="pool-explain">
          {explained === undefined
            ? `${explain} is not in this league.`
            : explained === -1
              ? `${displayName(explain)} is legal — no rule touches it.`
              : `${displayName(explain)}: ${format.pool[explained].effect === 'deny' ? 'denied' : 'allowed'} by rule ${explained + 1} — ${format.pool[explained].select}`}
        </p>
      )}

      <ul className="pool-diagnostics">
        {diagnostics.map((d, i) => (
          <li key={i} data-testid="diagnostic" className={`diag diag-${d.level}`}>
            {d.kind}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `app/src/styles/components.css`. Use tokens only — no literal colours or sizes:

```css
/* Format builder — the legal pool as it stands, and what each clause did to it. */
.pool-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.pool-count {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
}

.clause-deltas {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  list-style: none;
  margin: 0;
  padding: 0;
}

.clause-deltas li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-2);
}

.delta-down { color: var(--danger); font-family: var(--font-mono); }
.delta-up { color: var(--accent); font-family: var(--font-mono); }

.pool-explain { font-size: var(--text-sm); }

.pool-diagnostics { list-style: none; margin: 0; padding: 0; }
.diag { font-size: var(--text-sm); font-family: var(--font-mono); }
.diag-error { color: var(--danger); }
.diag-warn { color: var(--warn); }
```

Before committing, confirm every custom property used above exists in `app/src/styles/tokens.css`. If `--warn` or `--danger` is named differently there, use the real name — do not add a new token to make this CSS compile.

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd app && npx vitest run src/components/__tests__/pool-preview.test.tsx`
Expected: PASS, 5 tests. If `pidgeot` is not in the Great pool in current data, pick a Flying ref that is — the assertion is about the explanation, not that species.

- [ ] **Step 6: Run the gate**

Run: `cd app && npm run check`
Expected: PASS, including token parity.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/PoolPreview.tsx app/src/components/__tests__/pool-preview.test.tsx app/src/styles/components.css
git commit -m "feat(formats): a live pool, and a straight answer to why a ref is banned"
```

---

### Task 12: The clause editor

**Files:**
- Create: `app/src/components/ClauseEditor.tsx`
- Modify: `app/src/styles/components.css`
- Test: `app/src/components/__tests__/clause-editor.test.tsx`

**Interfaces:**
- Consumes: `PoolClause` from `../rules`.
- Produces: `<ClauseEditor clauses={…} onChange={(next: PoolClause[]) => void} />`.

**Ordering is a first-class control, not a detail.** Under last-match-wins, moving a clause changes the format. The editor must make reordering obvious and must not let a drag be the only way to do it.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/__tests__/clause-editor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClauseEditor } from '../ClauseEditor';
import type { PoolClause } from '../../rules';

const clauses: PoolClause[] = [
  { effect: 'deny', select: 'flying' },
  { effect: 'allow', select: '+mantine' },
];

describe('ClauseEditor', () => {
  it('renders one row per clause', () => {
    render(<ClauseEditor clauses={clauses} onChange={() => {}} />);
    expect(screen.getAllByTestId('clause-row')).toHaveLength(2);
  });

  it('adds a clause', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(onChange).toHaveBeenCalledWith([...clauses, { effect: 'deny', select: '' }]);
  });

  it('removes a clause', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(onChange).toHaveBeenCalledWith([clauses[1]]);
  });

  it('moves a clause down, which changes the format', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: /move down/i })[0]);
    expect(onChange).toHaveBeenCalledWith([clauses[1], clauses[0]]);
  });

  it('does not offer to move the first clause up', () => {
    render(<ClauseEditor clauses={clauses} onChange={() => {}} />);
    expect(screen.getAllByRole('button', { name: /move up/i })[0]).toBeDisabled();
  });

  it('edits a selector', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.change(screen.getAllByTestId('clause-select')[0], { target: { value: 'water' } });
    expect(onChange).toHaveBeenCalledWith([{ effect: 'deny', select: 'water' }, clauses[1]]);
  });

  it('toggles allow and deny', () => {
    const onChange = vi.fn();
    render(<ClauseEditor clauses={clauses} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId('clause-effect')[0]);
    expect(onChange).toHaveBeenCalledWith([{ effect: 'allow', select: 'flying' }, clauses[1]]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/__tests__/clause-editor.test.tsx`
Expected: FAIL — cannot resolve `../ClauseEditor`.

- [ ] **Step 3: Implement**

Create `app/src/components/ClauseEditor.tsx`:

```tsx
import type { PoolClause } from '../rules';

interface Props {
  clauses: PoolClause[];
  onChange: (next: PoolClause[]) => void;
}

/**
 * Add, edit, reorder and remove pool clauses.
 *
 * Reordering is offered as explicit buttons rather than only as a drag. Under
 * last-match-wins the order *is* the ruleset — moving rule 2 above rule 1 gives
 * a different legal pool — so it has to be reachable by keyboard and obvious at
 * a glance, not a gesture somebody has to discover.
 */
export function ClauseEditor({ clauses, onChange }: Props) {
  const replace = (i: number, c: PoolClause) =>
    onChange(clauses.map((x, j) => (j === i ? c : x)));

  const swap = (i: number, j: number) => {
    const next = [...clauses];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="clause-editor">
      <ol className="clause-list">
        {clauses.map((c, i) => (
          <li key={i} data-testid="clause-row" className="clause-row">
            <span className="hud-label">rule {i + 1}</span>

            <button
              type="button"
              data-testid="clause-effect"
              className="form-toggle"
              aria-label={`rule ${i + 1} effect, currently ${c.effect}`}
              onClick={() => replace(i, { ...c, effect: c.effect === 'deny' ? 'allow' : 'deny' })}
            >
              {c.effect}
            </button>

            <input
              data-testid="clause-select"
              className="clause-input"
              value={c.select}
              placeholder="flying, +mantine, azumarill&!shadow"
              aria-label={`rule ${i + 1} selector`}
              onChange={(e) => replace(i, { ...c, select: e.target.value })}
            />

            <button
              type="button"
              className="chip-btn"
              aria-label={`move rule ${i + 1} up`}
              disabled={i === 0}
              onClick={() => swap(i, i - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="chip-btn"
              aria-label={`move rule ${i + 1} down`}
              disabled={i === clauses.length - 1}
              onClick={() => swap(i, i + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="chip-btn"
              aria-label={`remove rule ${i + 1}`}
              onClick={() => onChange(clauses.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="chip-btn"
        onClick={() => onChange([...clauses, { effect: 'deny', select: '' }])}
      >
        Add rule
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `app/src/styles/components.css`:

```css
/* Format builder — the ordered clause pipeline. */
.clause-editor { display: flex; flex-direction: column; gap: var(--space-2); }
.clause-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }

.clause-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto auto auto;
  align-items: center;
  gap: var(--space-2);
}

.clause-input { font-family: var(--font-mono); width: 100%; }
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd app && npx vitest run src/components/__tests__/clause-editor.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the gate**

Run: `cd app && npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/ClauseEditor.tsx app/src/components/__tests__/clause-editor.test.tsx app/src/styles/components.css
git commit -m "feat(formats): a clause editor where order is a visible control"
```

---

### Task 13: The builder screen

**Files:**
- Create: `app/src/screens/FormatBuilderScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Test: `app/src/screens/__tests__/format-builder.test.tsx`

**Interfaces:**
- Consumes: `ClauseEditor` (Task 12), `PoolPreview` (Task 11), `formatStore` (Task 10), and `lintFormat` from `../rules`.
- Produces: the `FormatBuilderScreen` component, registered in `src/lib/screens.ts`.

**Before writing this, read `app/src/lib/screens.ts` and one existing screen** — `MovesScreen.tsx` is the closest in shape. Match how a screen is registered, how it receives state and how its heading and layout are built. Do not invent a new screen shape.

- [ ] **Step 1: Read the existing pattern**

Run: `cd app && sed -n '1,80p' src/lib/screens.ts && sed -n '1,60p' src/screens/MovesScreen.tsx`

Note the exact shape of a screen entry — its id, label, icon and component — and follow it.

- [ ] **Step 2: Write the failing test**

Create `app/src/screens/__tests__/format-builder.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormatBuilderScreen } from '../FormatBuilderScreen';
import { listFormats } from '../../state/formatStore';

beforeEach(() => localStorage.clear());

describe('FormatBuilderScreen', () => {
  it('opens on an empty format with the whole league legal', () => {
    render(<FormatBuilderScreen />);
    expect(Number(screen.getByTestId('pool-count').textContent)).toBeGreaterThan(500);
  });

  it('adding a deny clause shrinks the pool', () => {
    render(<FormatBuilderScreen />);
    const before = Number(screen.getByTestId('pool-count').textContent);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'flying' } });
    expect(Number(screen.getByTestId('pool-count').textContent)).toBeLessThan(before);
  });

  it('saves a named format to storage', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    const saved = listFormats();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Air Ban');
  });

  it('refuses to save while an error diagnostic stands', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Broken' } });
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: '!zzzznope' } });
    expect(screen.getByRole('button', { name: /^save/i })).toBeDisabled();
    expect(listFormats()).toEqual([]);
  });

  it('lists a saved format and loads it back', () => {
    render(<FormatBuilderScreen />);
    fireEvent.change(screen.getByLabelText(/format name/i), { target: { value: 'Air Ban' } });
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByTestId('clause-select'), { target: { value: 'flying' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    fireEvent.click(screen.getByRole('button', { name: /new format/i }));
    expect(screen.queryAllByTestId('clause-row')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /load Air Ban/i }));
    expect(screen.getAllByTestId('clause-row')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd app && npx vitest run src/screens/__tests__/format-builder.test.tsx`
Expected: FAIL — cannot resolve `../FormatBuilderScreen`.

- [ ] **Step 4: Implement**

Create `app/src/screens/FormatBuilderScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ClauseEditor } from '../components/ClauseEditor';
import { PoolPreview } from '../components/PoolPreview';
import { LEAGUES } from '../lib/data';
import { RULES_SCHEMA, lintFormat, type Format, type LeagueId } from '../rules';
import { deleteFormat, listFormats, saveFormat, type StoredFormat } from '../state/formatStore';

const EMPTY: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

/**
 * Author a format, and watch the pool move as you do.
 *
 * Saving is blocked while any error diagnostic stands, and only errors block:
 * a narrow pool is a legitimate thing to want and warning about it is the most
 * the tool should do. An unsatisfiable one is not, and shipping it means
 * somebody queues into a format no legal team can enter.
 */
export function FormatBuilderScreen() {
  const [format, setFormat] = useState<Format>(EMPTY);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<StoredFormat[]>(() => listFormats());
  const [explain, setExplain] = useState('');

  const diagnostics = useMemo(() => lintFormat(format), [format]);
  const blocked = diagnostics.some((d) => d.level === 'error') || name.trim() === '';

  const onSave = () => {
    if (blocked) return;
    const entry = saveFormat(name.trim(), format, editing);
    setEditing(entry.id);
    setSaved(listFormats());
  };

  const onLoad = (s: StoredFormat) => {
    setFormat(s.format);
    setName(s.name);
    setEditing(s.id);
  };

  const onNew = () => {
    setFormat(EMPTY);
    setName('');
    setEditing(undefined);
  };

  return (
    <div className="format-builder">
      <header className="format-builder-head">
        <label className="hud-label" htmlFor="format-name">Format name</label>
        <input
          id="format-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Air Ban"
        />

        <label className="hud-label" htmlFor="format-league">League</label>
        <select
          id="format-league"
          value={format.base}
          onChange={(e) => setFormat({ ...format, base: e.target.value as LeagueId })}
        >
          {LEAGUES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>

        <label className="hud-label" htmlFor="format-size">Team size</label>
        <input
          id="format-size"
          type="number"
          min={1}
          max={6}
          value={format.composition.size}
          onChange={(e) =>
            setFormat({
              ...format,
              composition: { ...format.composition, size: Number(e.target.value) || 1 },
            })
          }
        />

        <button type="button" className="chip-btn" onClick={onSave} disabled={blocked}>
          Save
        </button>
        <button type="button" className="chip-btn" onClick={onNew}>
          New format
        </button>
      </header>

      <div className="format-builder-body">
        <ClauseEditor
          clauses={format.pool}
          onChange={(pool) => setFormat({ ...format, pool })}
        />

        <div className="format-builder-side">
          <label className="hud-label" htmlFor="explain-ref">Why is this banned?</label>
          <input
            id="explain-ref"
            value={explain}
            onChange={(e) => setExplain(e.target.value)}
            placeholder="azumarill"
          />
          <PoolPreview format={format} explain={explain.trim() || undefined} />
        </div>
      </div>

      <section className="format-saved">
        <p className="hud-label">Saved formats</p>
        <ul>
          {saved.map((s) => (
            <li key={s.id}>
              <button type="button" className="chip-btn" onClick={() => onLoad(s)}>
                Load {s.name}
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => {
                  deleteFormat(s.id);
                  setSaved(listFormats());
                }}
              >
                Delete {s.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Register the screen**

In `app/src/lib/screens.ts`, add an entry for the builder following the exact shape of the existing entries you read in Step 1. Give it the label `Formats`.

- [ ] **Step 6: Add the styles**

Append to `app/src/styles/components.css`:

```css
/* Format builder — the screen. */
.format-builder { display: flex; flex-direction: column; gap: var(--space-3); }
.format-builder-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.format-builder-body { display: grid; grid-template-columns: 1fr; gap: var(--space-3); }

@media (min-width: 60rem) {
  .format-builder-body { grid-template-columns: 2fr 1fr; }
}

.format-builder-side { display: flex; flex-direction: column; gap: var(--space-2); }
.format-saved ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd app && npx vitest run src/screens/__tests__/format-builder.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 8: Run the whole gate**

Run: `cd app && npm run check`
Expected: PASS — tsc, oxlint, themes, token parity, verify-data, spread audit, and the full suite including every test added by this plan.

- [ ] **Step 9: Verify it in the running app**

Start the dev server through the preview tooling, open the Formats screen, and confirm by measurement rather than by eye:

1. The pool count with no clauses equals `opponentCandidatesFor('great').length`.
2. Typing `flying` into a deny clause drops the count and shows a negative delta.
3. Asking about a Flying species names rule 1.
4. Adding `allow +mantine` after it shows `+1` or more and re-admits that family.

Read the numbers out of the DOM rather than judging from a screenshot — a wrong count and a right count look identical at screenshot scale.

- [ ] **Step 10: Commit**

```bash
git add app/src/screens/FormatBuilderScreen.tsx app/src/screens/__tests__/format-builder.test.tsx app/src/lib/screens.ts app/src/styles/components.css
git commit -m "feat(formats): the builder screen — author a format, watch the pool move"
```

---

## Self-Review

Run against the spec before starting execution.

**Spec coverage.** Section 4's requirements map to tasks as follows: the schema and canonical form → Task 1; ref-keyed pools with `shadow` rebound → Tasks 2–3; last-match-wins and `decidedBy` → Task 3; quota composition including moveset rules → Tasks 4–5; publish gates with league-scaled thresholds → Task 6; satisfiability → Task 7; the seeded draft with `topN`, `playerPicks` and `rollMoves` → Task 8; `UNSIMULATED_IDS` respected → Task 3, inherited from `opponentCandidatesFor` and asserted; the isomorphic constraint → Task 9; persistence → Task 10; the builder with live pool deltas and the why-is-this-banned answer → Tasks 11–13.

**Deliberately out of M0**, each with a reason:

- **`packages/rules` as a workspace.** The code lives at `app/src/rules/` instead. There is no root `package.json`, so a workspace is new structure; the spec's justification for a separate package is the M2 client/server trust boundary, which does not exist yet; and `src/lib` is already proven to run under Node by the existing esbuild-bundled build scripts. The no-React, no-browser-API constraint is kept and is enforced by a test in Task 9. Moving to `packages/rules` in M2 is a directory move plus a `package.json`.
- **`rules_hash`.** Task 1 produces the canonical string a hash will be taken over. No hash function is invented now, because M0 has no queue to partition and the wire identity should be chosen where it is first used.
- **`bring` and `match.rounds`.** Present in the schema (Task 1) and canonicalised, but unused until there is a battle to bring three of six into.
- **Megas.** Excluded by `opponentCandidatesFor`, which is correct: the spec holds megas out of every league pool until `minLevel` lands, and that is its own data task.

**Type consistency.** `Format`, `PoolClause`, `Quota`, `Composition`, `Selection`, `Build`, `Violation` and `Diagnostic` are defined once in Task 1 and imported everywhere after. `RefTerm` (Task 2) and `BuildTerm` (Task 5) are distinct on purpose — one takes a ref, the other a build. `resolvePool` returns `{ legal, decidedBy, bad }` in Task 3 and is consumed with those exact field names in Tasks 4, 6, 7, 8 and 11. `validateTeam` returns `{ ok, violations }` throughout. `lintFormat` returns `Diagnostic[]` in Tasks 6, 7, 11 and 13.

**Known risk to watch during execution.** Tests naming specific species — `azumarill`, `registeel`, `altaria`, `pidgeot`, `poliwrath`/`politoed` — depend on current generated data. If any is absent from the Great pool, substitute one with the same property. The assertion is always about the rule, never about that species.
