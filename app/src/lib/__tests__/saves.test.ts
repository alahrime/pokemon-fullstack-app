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

/**
 * `errors` fails one table's writes the way PostgREST does — a code plus the
 * text it puts in `message`. Without it every query in this harness succeeds,
 * so nothing here could ever exercise a failure branch.
 */
function harness(rows: Record<string, unknown[]>, errors: Record<string, { code: string; message: string }> = {}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  function table(name: string) {
    const q: Record<string, unknown> = {
      select: vi.fn(() => { calls.push({ table: name, op: 'select' }); return q; }),
      eq: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'eq', payload: [col, val] }); return q; }),
      gt: vi.fn((col: string, val: unknown) => { calls.push({ table: name, op: 'gt', payload: [col, val] }); return q; }),
      // Recorded like every other modifier below, not a bare no-op: a caller
      // relying on referenced-table ordering (see the `listServerFormats`
      // test) needs its exact arguments visible, not just that `order` was
      // called with something.
      order: vi.fn((col: string, opts?: unknown) => { calls.push({ table: name, op: 'order', payload: [col, opts] }); return q; }),
      insert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'insert', payload }); return q; }),
      upsert: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'upsert', payload }); return q; }),
      update: vi.fn((payload: unknown) => { calls.push({ table: name, op: 'update', payload }); return q; }),
      delete: vi.fn(() => { calls.push({ table: name, op: 'delete' }); return q; }),
      limit: vi.fn((n: number, opts?: unknown) => { calls.push({ table: name, op: 'limit', payload: [n, opts] }); return q; }),
      single: vi.fn(async () => ({ data: rows[name]?.[0] ?? null, error: errors[name] ?? null })),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[name] ?? [], error: errors[name] ?? null }).then(res),
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
    await expect(saveTeam({ name: 'GL Squad', league: 'great', members: [] })).rejects.toThrow(
      /A roster called "GL Squad" already exists/,
    );
  });

  it('passes an unrelated write failure through untouched', async () => {
    // The guard on the other side: swallowing every write error into one
    // friendly sentence would hide a connection failure behind a name clash.
    harness({ teams: [] }, { teams: { code: '08006', message: 'could not connect to server' } });
    const { saveTeam } = await import('../saves');
    await expect(saveTeam({ name: 'GL Squad', league: 'great', members: [] })).rejects.toThrow(
      /could not connect to server/,
    );
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

  /**
   * The whole point: a roster that shrinks from three to two must not leave a
   * stale slot 3 behind. Both writes are asserted — a suite that only checked
   * the upsert would pass even if the trailing-slot delete were deleted. The
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
      id: 't1', name: 'Mine', league: 'great',
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
    expect(scopedByTeam?.payload).toEqual(['team_id', 't1']);
    const boundedBySlot = calls.find((c) => c.table === 'team_members' && c.op === 'gt');
    expect(boundedBySlot?.payload).toEqual(['slot', 2]);
  });

  /**
   * Editing a team down to nothing is the shrink case taken to its limit:
   * every member must go, the upsert is skipped (nothing to write), and the
   * delete's bound becomes `gt('slot', 0)` — every slot is greater than 0, so
   * every row qualifies. Nothing exercised this path before.
   */
  it('editing a team to an empty roster removes every member', async () => {
    const { calls } = harness({ teams: [{ id: 't1' }] });
    const { saveTeam } = await import('../saves');
    await saveTeam({ id: 't1', name: 'Mine', league: 'great', members: [] });
    const upsert = calls.find((c) => c.table === 'team_members' && c.op === 'upsert');
    expect(upsert).toBeUndefined();
    const deletes = calls.filter((c) => c.table === 'team_members' && c.op === 'delete');
    expect(deletes).toHaveLength(1);
    const scopedByTeam = calls.find((c) => c.table === 'team_members' && c.op === 'eq');
    expect(scopedByTeam?.payload).toEqual(['team_id', 't1']);
    const boundedBySlot = calls.find((c) => c.table === 'team_members' && c.op === 'gt');
    expect(boundedBySlot?.payload).toEqual(['slot', 0]);
  });

  /**
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
      id: 't1', name: 'Mine', league: 'great',
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
      id: 't1', name: 'Mine', league: 'great',
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

describe('saved formats', () => {
  it('appends a version rather than updating one', async () => {
    const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 3 }, { version: 1 }] });
    const { saveServerFormat } = await import('../saves');
    await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
    expect(calls.some((c) => c.table === 'format_versions' && c.op === 'insert')).toBe(true);
    expect(calls.some((c) => c.table === 'format_versions' && c.op === 'upsert')).toBe(false);
  });

  /**
   * `next = prior[0].version + 1`, computed from an `.order('version', {
   * ascending: false }).limit(1)` chain. Nothing before this asserted the
   * appended NUMBER — only that some insert happened — so a reversed sort, a
   * dropped `.order`, or a hardcoded `next = 1` all passed every test in this
   * file. A wrong version here is a `unique (format_id, version)` violation
   * on the user's third save, not a cosmetic miscount.
   *
   * Proved load-bearing by temporarily hardcoding `next = 1` in
   * `saveServerFormat`: this assertion failed (`1` !== `4`) with that
   * mutation in place, and passes again with the real computation restored —
   * see the fix report for the before/after run.
   */
  it('computes the next version from the highest existing version, not just any row', async () => {
    const { calls } = harness({ formats: [{ id: 'f1' }], format_versions: [{ version: 3 }, { version: 1 }] });
    const { saveServerFormat } = await import('../saves');
    await saveServerFormat({ id: 'f1', name: 'Air Ban', format: FORMAT });
    const insert = calls.find((c) => c.table === 'format_versions' && c.op === 'insert');
    expect((insert?.payload as { version: number }).version).toBe(4);
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

describe('listServerFormats', () => {
  /**
   * The embed used to pull every version's full `rules` jsonb for every
   * format, only to sort client-side and throw all but the newest away — a
   * payload that grows linearly with a user's edit history for data thrown
   * away on the next line, re-fetched after every save AND every delete.
   * PostgREST's referenced-table ordering avoids the over-fetch, but only if
   * the client actually asks for it on the FORMAT_VERSIONS table specifically
   * — asserting real argument values here, not merely that `order`/`limit`
   * were called with something, is what would catch a `referencedTable` typo
   * or a modifier applied to the wrong query.
   */
  it('orders and limits the embedded versions by referencedTable, not just the top-level query', async () => {
    const { calls } = harness({
      formats: [{ id: 'f1', name: 'Air Ban', format_versions: [{ version: 3, rules: FORMAT, rules_hash: 'h3' }] }],
    });
    const { listServerFormats } = await import('../saves');
    await listServerFormats();

    const versionOrder = calls.find(
      (c) => c.table === 'formats' && c.op === 'order' && (c.payload as unknown[])[0] === 'version',
    );
    expect(versionOrder?.payload).toEqual(['version', { referencedTable: 'format_versions', ascending: false }]);

    const versionLimit = calls.find((c) => c.table === 'formats' && c.op === 'limit');
    expect(versionLimit?.payload).toEqual([1, { referencedTable: 'format_versions' }]);
  });

  it('still returns the highest version when the embed hands back more than one row', async () => {
    // The client-side backstop: even if the referenced-table limit above were
    // ever bypassed, listServerFormats must not report a stale version as
    // current.
    harness({
      formats: [
        {
          id: 'f1',
          name: 'Air Ban',
          format_versions: [
            { version: 1, rules: FORMAT, rules_hash: 'h1' },
            { version: 3, rules: FORMAT, rules_hash: 'h3' },
          ],
        },
      ],
    });
    const { listServerFormats } = await import('../saves');
    const formats = await listServerFormats();
    expect(formats).toEqual([{ id: 'f1', name: 'Air Ban', format: FORMAT, version: 3, rulesHash: 'h3' }]);
  });
});
