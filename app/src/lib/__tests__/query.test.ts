import { describe, it, expect } from 'vitest';
import { QUERY_FORMS, compileQuery } from '../query';
import { SPECIES } from '../data';

const run = (q: string) => {
  const t = compileQuery(q, SPECIES);
  return t ? SPECIES.filter(t) : null;
};

describe('compileQuery', () => {
  it('returns null for an empty query, meaning "no filter"', () => {
    expect(compileQuery('', SPECIES)).toBeNull();
    expect(compileQuery('   ', SPECIES)).toBeNull();
  });
  it('matches a name substring, case-insensitively', () => {
    const out = run('pikachu')!;
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.name.toLowerCase().includes('pikachu'))).toBe(true);
    expect(run('PIKACHU')!.length).toBe(out.length);
  });
  it('matches a type', () => {
    const out = run('water')!;
    expect(out.length).toBeGreaterThan(50);
    expect(out.every((s) => s.types.includes('water') || s.name.toLowerCase().includes('water'))).toBe(true);
  });
  it('supports & as intersection', () => {
    const both = run('water & flying')!;
    const water = run('water')!;
    expect(both.length).toBeLessThan(water.length);
  });
  it('supports , as union — the operator is a comma, not a pipe', () => {
    const either = run('steel,fairy')!;
    expect(either.length).toBeGreaterThan(run('steel')!.length);
  });
  it('treats an unknown operator as literal text rather than throwing', () => {
    expect(run('steel|fairy')).toEqual([]);
  });
  it('supports ! as negation', () => {
    const all = run('water')!;
    const notLegend = run('water & !legendary')!;
    expect(notLegend.length).toBeLessThanOrEqual(all.length);
  });
  it('matches a generation', () => {
    const g1 = run('gen1')!;
    expect(g1.length).toBeGreaterThan(0);
    expect(g1.every((s) => s.dex <= 151)).toBe(true);
  });
  it('matches a move with @', () => {
    const out = run('@counter')!;
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) =>
      [...s.fastMoves, ...s.chargeMoves].some((m) => m.name.toLowerCase().includes('counter')))).toBe(true);
  });
  it('matches a dex number exactly', () => {
    const out = run('25')!;
    expect(out.some((s) => s.dex === 25)).toBe(true);
  });
  it('returns an empty result for nonsense rather than throwing', () => {
    expect(run('zzzznotathing')).toEqual([]);
  });
  it('every documented form parses and matches something', () => {
    // The syntax guide is generated from this table, so a form that stopped
    // working would be documented and broken at the same time.
    for (const group of QUERY_FORMS) {
      for (const f of group.forms) {
        // A couple of entries list alternatives separated by a middot.
        for (const q of f.syntax.split('·').map((x) => x.trim())) {
          const out = run(q);
          expect(out, `${q} produced no term`).not.toBeNull();
          expect(out!.length, `${q} matched nothing`).toBeGreaterThan(0);
        }
      }
    }
  });
});
