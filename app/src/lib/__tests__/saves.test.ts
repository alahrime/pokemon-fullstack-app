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
      update: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'update', payload }); return q; }),
      delete: vi.fn(() => { calls.push({ table: name, op: 'delete' }); return q; }),
      limit: vi.fn(() => q),
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
