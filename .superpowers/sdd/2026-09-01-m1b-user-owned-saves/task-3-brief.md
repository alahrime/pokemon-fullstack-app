### Task 3: The codec and the data layer

**Files:**
- Create: `app/src/lib/teamCodec.ts`, `app/src/lib/__tests__/team-codec.test.ts`,
  `app/src/lib/saves.ts`, `app/src/lib/__tests__/saves.test.ts`

**Interfaces:**
- Consumes: the table and column names from Tasks 1 and 2.
- Produces:

```ts
// teamCodec.ts
export interface StoredMember {
  ref: string; fast_move: string; charge_moves: string[];
  iv_attack: number; iv_defense: number; iv_stamina: number; level: number | null;
}
export interface DecodedMember { choice: AddPokemonChoice; unknownMove: string | null }
export function encodeMember(choice: AddPokemonChoice, league: LeagueId): StoredMember
export function decodeMember(stored: StoredMember): DecodedMember

// saves.ts
export interface SavedTeam { id: string; name: string; league: LeagueId; members: StoredMember[] }
export async function listTeams(): Promise<SavedTeam[]>
export async function saveTeam(t: { id?: string; name: string; league: LeagueId; members: StoredMember[] }): Promise<string>
export async function deleteTeam(id: string): Promise<void>
export interface SavedFormat { id: string; name: string; format: Format; version: number; rulesHash: string }
export async function listServerFormats(): Promise<SavedFormat[]>
export async function saveServerFormat(f: { id?: string; name: string; format: Format }): Promise<string>
export async function deleteServerFormat(id: string): Promise<void>
```

- [ ] **Step 1: Write the failing codec tests**

Create `app/src/lib/__tests__/team-codec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeMember, decodeMember } from '../teamCodec';
import { speciesOf } from '../data';

/**
 * The index/id conversion, which is the whole reason this module exists.
 * `species.json` is generated, so a stored fastIdx would silently repoint at a
 * different move the next time the data is rebuilt.
 */
describe('team member codec', () => {
  const ref = 'registeel';
  const fastMoves = speciesOf(ref)!.fastMoves;

  it('stores the fast move id, not the index', () => {
    const stored = encodeMember({ ref, chargeIds: [], fastIdx: 1, iv: { a: 0, d: 14, s: 15 } }, 'great');
    expect(stored.fast_move).toBe(fastMoves[1].id);
    expect(Object.values(stored)).not.toContain(1);
  });

  it('round-trips a member back to the same choice', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST'], fastIdx: 0, iv: { a: 2, d: 15, s: 13 } };
    const { choice: back, unknownMove } = decodeMember(encodeMember(choice, 'great'));
    expect(back).toEqual(choice);
    expect(unknownMove).toBeNull();
  });

  it('records the level the engine derives, rather than leaving it null', () => {
    const stored = encodeMember({ ref, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 14, s: 15 } }, 'great');
    expect(stored.level).toBeGreaterThan(1);
    expect(stored.level).toBeLessThanOrEqual(51);
  });

  /**
   * The failure this design exists to make loud. A move that has left the data
   * must not resolve to whatever now sits at that index.
   */
  it('reports a fast move that no longer exists instead of silently picking another', () => {
    const { choice, unknownMove } = decodeMember({
      ref, fast_move: 'MOVE_THAT_WAS_REMOVED', charge_moves: [],
      iv_attack: 0, iv_defense: 14, iv_stamina: 15, level: 41.5,
    });
    expect(unknownMove).toBe('MOVE_THAT_WAS_REMOVED');
    expect(choice.fastIdx).toBe(0);
  });

  it('reports an unknown ref rather than throwing', () => {
    const { choice, unknownMove } = decodeMember({
      ref: 'not_a_pokemon', fast_move: 'BULLET_PUNCH', charge_moves: [],
      iv_attack: 0, iv_defense: 0, iv_stamina: 0, level: null,
    });
    expect(unknownMove).toBe('BULLET_PUNCH');
    expect(choice.ref).toBe('not_a_pokemon');
  });

  it('keeps both charge moves in order', () => {
    const choice = { ref, chargeIds: ['FOCUS_BLAST', 'FLASH_CANNON'], fastIdx: 0, iv: { a: 0, d: 0, s: 0 } };
    expect(encodeMember(choice, 'great').charge_moves).toEqual(['FOCUS_BLAST', 'FLASH_CANNON']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/team-codec.test.ts
```

Expected: FAIL — `Cannot find module '../teamCodec'`.

- [ ] **Step 3: Write the codec**

Create `app/src/lib/teamCodec.ts`:

```ts
import type { AddPokemonChoice } from '../components/AddPokemonModal';
import type { LeagueId } from './types';
import { speciesOf } from './data';
import { getEntry } from './engine';

export interface StoredMember {
  ref: string;
  fast_move: string;
  charge_moves: string[];
  iv_attack: number;
  iv_defense: number;
  iv_stamina: number;
  level: number | null;
}

export interface DecodedMember {
  choice: AddPokemonChoice;
  /** The stored move id, when it no longer exists in the data. Null when fine. */
  unknownMove: string | null;
}

export function encodeMember(choice: AddPokemonChoice, league: LeagueId): StoredMember {
  const species = speciesOf(choice.ref);
  const fast = species?.fastMoves[choice.fastIdx];
  // Level is recorded, not authoritative — the engine derives it from the IVs
  // and the cap. Stored so a later data change that moves it can be seen.
  let level: number | null = null;
  try {
    level = getEntry(choice.ref, choice.iv, league).entry.lvl;
  } catch {
    // An unknown ref has no table. The member is still worth storing.
  }
  return {
    ref: choice.ref,
    fast_move: fast?.id ?? '',
    charge_moves: [...choice.chargeIds],
    iv_attack: choice.iv.a,
    iv_defense: choice.iv.d,
    iv_stamina: choice.iv.s,
    level,
  };
}

export function decodeMember(stored: StoredMember): DecodedMember {
  const species = speciesOf(stored.ref);
  const idx = species?.fastMoves.findIndex((m) => m.id === stored.fast_move) ?? -1;
  return {
    choice: {
      ref: stored.ref,
      chargeIds: [...stored.charge_moves],
      // Fall back to the first move, and SAY SO through unknownMove. Resolving
      // silently is how a saved team quietly becomes a different team.
      fastIdx: idx >= 0 ? idx : 0,
      iv: { a: stored.iv_attack, d: stored.iv_defense, s: stored.iv_stamina },
    },
    unknownMove: idx >= 0 ? null : stored.fast_move,
  };
}
```

- [ ] **Step 4: Run the codec tests**

Expected: PASS, all 7.

- [ ] **Step 5: Write the failing data-layer tests**

Create `app/src/lib/__tests__/saves.test.ts`. Mock `@supabase/supabase-js` at the package boundary,
the way `src/screens/__tests__/sign-in.test.tsx` does — the setup-file stub is not enough here
because these tests assert the exact calls made.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RULES_SCHEMA, type Format } from '../../rules';

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

// No `as Format` cast: every required field is present, so the annotation alone
// type-checks. A cast here would hide the next real mismatch.
const FORMAT: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

function harness(rows: Record<string, unknown[]>) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  function table(name: string) {
    const q: Record<string, unknown> = {
      select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
      eq: vi.fn(() => q),
      order: vi.fn(() => q),
      insert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'insert', payload }); return q; }),
      upsert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'upsert', payload }); return q; }),
      delete: vi.fn(() => { calls.push({ table: name, op: 'delete' }); return q; }),
      single: vi.fn(async () => ({ data: rows[name]?.[0] ?? null, error: null })),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows[name] ?? [], error: null }).then(res),
    };
    return q;
  }
  pkg.client = { from: vi.fn((n: string) => table(n)) };
  return { calls };
}

beforeEach(() => vi.resetModules());

describe('saved teams', () => {
  it('reads a team and its members into one object', async () => {
    harness({
      teams: [{ id: 't1', name: 'Mine', league: 'great',
        team_members: [{ slot: 1, ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: ['ICE_BEAM'],
          iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 }] }],
    });
    const { listTeams } = await import('../saves');
    const teams = await listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe('Mine');
    expect(teams[0].members[0].ref).toBe('azumarill');
  });

  it('writes members in slot order, one row each', async () => {
    const { calls } = harness({ teams: [{ id: 't1' }] });
    const { saveTeam } = await import('../saves');
    await saveTeam({
      name: 'Mine', league: 'great',
      members: [
        { ref: 'azumarill', fast_move: 'BUBBLE', charge_moves: [], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 },
        { ref: 'registeel', fast_move: 'LOCK_ON', charge_moves: [], iv_attack: 1, iv_defense: 14, iv_stamina: 15, level: 41 },
      ],
    });
    const members = calls.find((c) => c.table === 'team_members' && c.op === 'insert');
    expect((members?.payload as { slot: number }[]).map((m) => m.slot)).toEqual([1, 2]);
  });

  it('never writes an owner_id from the client', async () => {
    const { calls } = harness({ teams: [{ id: 't1' }] });
    const { saveTeam } = await import('../saves');
    await saveTeam({ name: 'Mine', league: 'great', members: [] });
    const insert = calls.find((c) => c.table === 'teams' && c.op === 'insert');
    // owner_id comes from a column default of auth.uid(); a client-supplied one
    // is a value the policy then has to agree with, which is a second source of
    // truth for who owns a row.
    expect(Object.keys(insert?.payload as object)).not.toContain('owner_id');
  });
});

describe('saved formats', () => {
  it('appends a version rather than updating one', async () => {
    const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 3 }] });
    const { saveServerFormat } = await import('../saves');
    await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
    expect(calls.some((c) => c.table === 'format_versions' && c.op === 'insert')).toBe(true);
    expect(calls.some((c) => c.table === 'format_versions' && c.op === 'upsert')).toBe(false);
  });

  it('stores the canonical hash alongside the rules', async () => {
    const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 0 }] });
    const { saveServerFormat } = await import('../saves');
    const { canonicalize } = await import('../../rules');
    await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
    const v = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
    expect((v?.payload as { rules_hash: string }).rules_hash).toBe(canonicalize(FORMAT));
  });
});
```

- [ ] **Step 6: Run and watch it fail, then implement `saves.ts`**

```bash
cd app && ./node_modules/.bin/vitest run src/lib/__tests__/saves.test.ts
```

Expected: FAIL — `Cannot find module '../saves'`. Then write `app/src/lib/saves.ts`:

```ts
import { supabase } from './supabase';
import { canonicalize, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';

export interface SavedTeam {
  id: string;
  name: string;
  league: LeagueId;
  members: StoredMember[];
}

/**
 * `owner_id` is never sent from here. It defaults to `auth.uid()` in the
 * database, so who owns a row is decided in one place; a client-supplied owner
 * is a second source of truth the policy then has to agree with.
 */
export async function listTeams(): Promise<SavedTeam[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, league, team_members(slot, ref, fast_move, charge_moves, iv_attack, iv_defense, iv_stamina, level)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as { id: string; name: string; league: LeagueId; team_members: (StoredMember & { slot: number })[] };
    return {
      id: r.id,
      name: r.name,
      league: r.league,
      members: [...r.team_members].sort((a, b) => a.slot - b.slot),
    };
  });
}

export async function saveTeam(t: {
  id?: string;
  name: string;
  league: LeagueId;
  members: StoredMember[];
}): Promise<string> {
  let id = t.id;
  if (id) {
    const { error } = await supabase
      .from('teams')
      .update({ name: t.name, league: t.league, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    // Slots are positional and the roster may have shrunk, so the old rows go
    // rather than being upserted over — an upsert would leave a stale slot 3
    // behind when a three becomes a two.
    const { error: clearError } = await supabase.from('team_members').delete().eq('team_id', id);
    if (clearError) throw new Error(clearError.message);
  } else {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: t.name, league: t.league })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  }
  if (t.members.length > 0) {
    const { error } = await supabase
      .from('team_members')
      .insert(t.members.map((m, i) => ({ ...m, team_id: id, slot: i + 1 })));
    if (error) throw new Error(error.message);
  }
  return id;
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export interface SavedFormat {
  id: string;
  name: string;
  format: Format;
  version: number;
  rulesHash: string;
}

export async function listServerFormats(): Promise<SavedFormat[]> {
  const { data, error } = await supabase
    .from('formats')
    .select('id, name, format_versions(version, rules, rules_hash)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const r = row as { id: string; name: string; format_versions: { version: number; rules: Format; rules_hash: string }[] };
    // The current version is the highest one; there is no pointer column to
    // disagree with it.
    const latest = [...r.format_versions].sort((a, b) => b.version - a.version)[0];
    if (!latest) return [];
    return [{ id: r.id, name: r.name, format: latest.rules, version: latest.version, rulesHash: latest.rules_hash }];
  });
}

export async function saveServerFormat(f: { id?: string; name: string; format: Format }): Promise<string> {
  let id = f.id;
  if (id) {
    const { error } = await supabase
      .from('formats')
      .update({ name: f.name, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.from('formats').insert({ name: f.name }).select('id').single();
    if (error) throw new Error(error.message);
    id = (data as { id: string }).id;
  }
  const { data: prior } = await supabase
    .from('format_versions')
    .select('version')
    .eq('format_id', id)
    .order('version', { ascending: false })
    .limit(1);
  const next = ((prior as { version: number }[] | null)?.[0]?.version ?? 0) + 1;
  // Append. A version is immutable in the database, so this is the only way to
  // change what a format says.
  const { error } = await supabase.from('format_versions').insert({
    format_id: id,
    version: next,
    rules: f.format,
    rules_hash: canonicalize(f.format),
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteServerFormat(id: string): Promise<void> {
  const { error } = await supabase.from('formats').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 7: Add the `owner_id` default the data layer relies on**

`saves.ts` deliberately never sends `owner_id`, so the column needs a default. Add a migration —
`npx supabase migration new owner_defaults`:

```sql
-- The client never sends owner_id, so there is exactly one place that decides
-- who owns a row. Without this default the insert fails a NOT NULL, and the
-- obvious fix — sending it from the client — creates a second source of truth
-- the policy then has to agree with.
alter table public.teams alter column owner_id set default auth.uid();
alter table public.formats alter column owner_id set default auth.uid();
```

- [ ] **Step 8: Run both gates**

```bash
cd app && npm run db:reset > /tmp/reset.log 2>&1; echo "EXIT=$?"
./node_modules/.bin/vitest run --config vitest.db.config.ts > /tmp/db.log 2>&1; echo "EXIT=$?"
npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 9: Commit**

```bash
git add app/src/lib supabase/migrations
git commit -m "feat(saves): a codec that stores move ids, and the layer that writes them"
```

---

