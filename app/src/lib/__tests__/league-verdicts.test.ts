import { describe, it, expect } from 'vitest';
import { getEntry, leagueVerdicts } from '../engine';

describe('leagueVerdicts', () => {
  it('reads every league from the same tables the Report uses', () => {
    const iv = { a: 0, d: 14, s: 15 };
    const rows = leagueVerdicts('azumarill', iv, false);
    expect(rows.map((r) => r.league)).toEqual(['great', 'ultra', 'master']);
    for (const r of rows) {
      const { entry, table } = getEntry('azumarill', iv, r.league, false);
      expect(r).toMatchObject({ rank: entry.rank, cp: entry.cp, lvl: entry.lvl });
      expect(r.pct).toBeCloseTo((100 * entry.sp) / table.best.sp, 6);
    }
  });

  it('reads a hundo as rank 1 in Master, where there is no cap', () => {
    expect(leagueVerdicts('mewtwo', { a: 15, d: 15, s: 15 }, false)[2]).toMatchObject({ rank: 1, pct: 100, lvl: 50 });
  });

  it('follows Best Buddy', () => {
    const iv = { a: 15, d: 15, s: 15 };
    expect(leagueVerdicts('azumarill', iv, true)[2].lvl).toBe(51);
    expect(leagueVerdicts('azumarill', iv, false)[2].lvl).toBe(50);
  });
});
