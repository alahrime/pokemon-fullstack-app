import { describe, it, expect } from 'vitest';
import { sql } from './helpers';

describe('every public table is protected', () => {
  it('has row level security enabled', async () => {
    const rows = await sql(
      `select tablename from pg_tables where schemaname='public' and rowsecurity = false`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  // TEMPORARY: this asserts the default-deny starting state landed by Task 2
  // (RLS on, zero policies) before Task 4 opens access deliberately. Task 4
  // writes real policies on these tables, which makes this count nonzero by
  // design — delete this test there rather than "fixing" it.
  it('starts denying everything before any policy is written', async () => {
    const rows = await sql(`select count(*)::int as n from pg_policies where schemaname='public'`);
    expect(rows[0].n).toBe(0);
  });
});
