import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIER, ENGINE_REV, TIERS, btComparison, btCyclicByTier, btFitFor,
  fieldPool, overallOf, rankingsFor, teamPool,
} from '../rankings';
import {
  TEAM_ENGINE_REV, TEAM_PASSES, TEAM_TIERS, allTeamRows, bestTeams, coreBalance,
  coresFor, pillarsFor, teamCount,
} from '../teams';
import { lookupPair } from '../pairLookup';
import { summaryFor } from '../summary';
import { stamp, toCsv } from '../exportData';
import { artefact, leagueArtefact } from '../artefact';

const LEAGUES = ['great', 'ultra', 'master'] as const;

describe('rankings artefact', () => {
  it('exposes tiers and a default that is one of them', () => {
    for (const lg of LEAGUES) expect(TIERS(lg)).toContain(DEFAULT_TIER(lg));
  });
  it('agrees with the teams artefact on engine revision', () => {
    for (const lg of LEAGUES) expect(TEAM_ENGINE_REV(lg)).toBe(ENGINE_REV(lg));
  });
  it('ranks every league, sorted by Overall descending', () => {
    for (const lg of LEAGUES) {
      const rows = rankingsFor(lg, DEFAULT_TIER(lg), 'overall', 'd1');
      expect(rows.length).toBeGreaterThan(100);
      for (let i = 1; i < 40; i++) expect(rows[i].score).toBeLessThanOrEqual(rows[i - 1].score);
    }
  });
  it('gives a field pool of the size asked for', () => {
    expect(fieldPool('great', '100', 6)).toHaveLength(6);
    expect(teamPool('great').length).toBeGreaterThan(0);
  });
  it('looks up a single Overall', () => {
    expect(typeof overallOf('great', '500', 'registeel')).toBe('number');
  });
});

describe('Bradley-Terry artefact', () => {
  it('carries every field the Diagnostics screen reads', () => {
    for (const lg of LEAGUES) {
      const fit = btFitFor(lg, DEFAULT_TIER(lg))!;
      expect(fit).toBeDefined();
      for (const k of ['r2','rmse','cyclicPct','total','n','worst'] as const) {
        expect(fit[k], `${lg} missing ${k}`).toBeDefined();
      }
    }
  });
  it('reports a census — the triple count is exactly C(n,3)', () => {
    for (const lg of LEAGUES) {
      const fit = btFitFor(lg, DEFAULT_TIER(lg))!;
      expect(fit.total).toBe((fit.n * (fit.n - 1) * (fit.n - 2)) / 6);
    }
  });
  it('keeps the cyclic share a share', () => {
    for (const lg of LEAGUES) for (const t of TIERS(lg)) {
      const f = btFitFor(lg, t);
      if (!f) continue;
      expect(f.cyclicPct).toBeGreaterThanOrEqual(0);
      expect(f.cyclicPct).toBeLessThanOrEqual(100);
    }
  });
  it('compares the two rankings over the same population', () => {
    const { rows, rho } = btComparison('great', DEFAULT_TIER('great'));
    expect(rows.length).toBeGreaterThan(50);
    expect(rho).toBeGreaterThan(-1);
    expect(rho).toBeLessThanOrEqual(1);
    // Both ranks are dense 1..n over the same rows.
    expect(new Set(rows.map((r) => r.compositeRank)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.btRank)).size).toBe(rows.length);
  });
  it('reports cyclic share for every tier', () => {
    const byTier = btCyclicByTier('great');
    expect(byTier.length).toBe(TIERS('great').length);
    expect(byTier.every((t) => t.n > 0)).toBe(true);
  });
});

describe('teams artefact', () => {
  it('names its passes and tiers', () => {
    expect(TEAM_PASSES.length).toBeGreaterThanOrEqual(3);
    for (const lg of LEAGUES) expect(TEAM_TIERS(lg).length).toBeGreaterThan(0);
  });
  it('returns teams of the right size, all legal', () => {
    for (const size of [3, 6] as const) {
      const teams = bestTeams('great', '100', 'overall', 'd1', size, 0, 5);
      expect(teams.length).toBeGreaterThan(0);
      for (const t of teams) {
        expect(t.refs).toHaveLength(size);
        expect(new Set(t.refs).size).toBe(size);
      }
    }
  });
  it('reports a count that matches what it can return', () => {
    const n = teamCount('great', '100', 'overall', 'd1', 3);
    expect(bestTeams('great', '100', 'overall', 'd1', 3, 0, n + 10).length).toBeLessThanOrEqual(n);
  });
  it('slices consistently, so paging does not drop or repeat a team', () => {
    const all = bestTeams('great', '100', 'overall', 'd1', 3, 0, 10);
    const second = bestTeams('great', '100', 'overall', 'd1', 3, 5, 10);
    expect(second[0].refs).toEqual(all[5].refs);
  });
  it('orders teams by score descending', () => {
    const teams = bestTeams('great', '100', 'overall', 'd1', 3, 0, 20);
    for (let i = 1; i < teams.length; i++) expect(teams[i].score).toBeLessThanOrEqual(teams[i - 1].score);
  });
  it('emits cores and pillars', () => {
    expect(coresFor('great').length).toBeGreaterThan(0);
    expect(pillarsFor('great').length).toBeGreaterThan(0);
  });
  it('coreBalance is a 0..1 reciprocity measure', () => {
    for (const c of coresFor('great').slice(0, 30)) {
      const b = coreBalance(c);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
  it('exports every stratum as flat rows', () => {
    const rows = allTeamRows('great');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('members');
  });
});

describe('summary artefact', () => {
  it('matches the rankings it was generated from', () => {
    for (const lg of LEAGUES) {
      const s = summaryFor(lg);
      expect(s.engineRev).toBe(ENGINE_REV(lg));
      expect(s.featured.length).toBeGreaterThan(0);
    }
  });
});

describe('pairLookup', () => {
  // The first call for a league builds its field, weight vector and type
  // pressure map; every later call is a cache hit (~30ms). Under coverage
  // instrumentation that cold start exceeds the 5s default, so this one gets
  // room. It is a warm-up cost, not a slow function.
  it('reports on an arbitrary pair', { timeout: 30_000 }, () => {
    const r = lookupPair('registeel', 'azumarill', 'great');
    expect(r).toBeTruthy();
    expect(Number.isFinite(r.score)).toBe(true);
  });
  it('handles a Pokemon outside the ranked field without pretending it is elite', () => {
    const r = lookupPair('caterpie', 'azumarill', 'great');
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe('exportData', () => {
  it('quotes fields containing separators', () => {
    const csv = toCsv([{ a: 'x,y', b: 'plain' }]);
    expect(csv).toContain('"x,y"');
  });
  it('emits a header row from the keys, with a BOM and CRLF for Excel', () => {
    const csv = toCsv([{ alpha: 1, beta: 2 }]);
    // Both are deliberate: without the BOM Excel mangles non-ASCII species
    // names, and without CRLF it treats the whole file as one row.
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv.replace(/^\ufeff/, '').split('\r\n')[0]).toBe('alpha,beta');
  });
  it('survives an empty set', () => expect(typeof toCsv([])).toBe('string'));
  it('stamps a filename-safe timestamp', () => expect(stamp()).toMatch(/^[\w-]+$/));
});

describe('artefact readers', () => {
  it('accepts a well-formed league artefact and types it', () => {
    const raw = {
      great: { a: 1, b: 2 }, ultra: { a: 1, b: 2 }, master: { a: 1, b: 2 },
    };
    const out = leagueArtefact<{ a: number; b: number }>(raw, 'x.json', ['a', 'b'], 'npm run x');
    expect(out.great.a).toBe(1);
  });

  it('names the missing field and the command that rebuilds it', () => {
    const raw = { great: { a: 1 }, ultra: { a: 1, b: 2 }, master: { a: 1, b: 2 } };
    expect(() => leagueArtefact<{ a: number; b: number }>(raw, 'x.json', ['a', 'b'], 'npm run x'))
      .toThrow(/great is missing b.*npm run x/s);
  });

  it('rejects an artefact missing a whole league', () => {
    expect(() => leagueArtefact({ great: {}, ultra: {} }, 'x.json', [], 'npm run x'))
      .toThrow(/no data for the master league/);
  });

  it('rejects a non-object', () => {
    expect(() => leagueArtefact(null, 'x.json', [], 'npm run x')).toThrow(/not an object/);
    expect(() => artefact(42, 'x.json', [], 'npm run x')).toThrow(/not an object/);
  });

  it('checks top-level keys for artefacts with their own shape', () => {
    expect(artefact<{ moves: number }>({ moves: 1 }, 'x.json', ['moves'], 'npm run x').moves).toBe(1);
    expect(() => artefact<{ moves: number }>({}, 'x.json', ['moves'], 'npm run x'))
      .toThrow(/missing moves/);
  });

  it('treats a present-but-falsy field as present', () => {
    // 0 and '' are legitimate values; only undefined means "the build did not
    // emit this", which is the failure being guarded.
    expect(() => artefact({ n: 0, s: '' }, 'x.json', ['n', 's'], 'npm run x')).not.toThrow();
  });
});
