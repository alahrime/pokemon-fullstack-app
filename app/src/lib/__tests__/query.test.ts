import { describe, it, expect } from 'vitest';
import { QUERY_FORMS, compileQuery, isStructured } from '../query';
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

/** Matching species for a query that is expected to compile. */
const hits = (q: string) => run(q) ?? [];

describe('move-slot queries', () => {
  it('@1 searches fast moves only', () => {
    // Counter is a fast move; nothing learns it as a charged move, so the
    // charged-slot form must find nobody.
    expect(hits('@1counter').length).toBeGreaterThan(0);
    expect(hits('@2counter')).toHaveLength(0);
  });
  it('@2 searches charged moves only', () => {
    expect(hits('@2ice beam').length).toBeGreaterThan(0);
    expect(hits('@1ice beam')).toHaveLength(0);
  });
  it('an unslotted @ searches both pools', () => {
    const both = hits('@counter').length;
    expect(both).toBe(hits('@1counter').length);
  });
  it('matches a move by its type as well as its name', () => {
    expect(hits('@dragon').length).toBeGreaterThan(0);
  });
  it('a bare @ with nothing after it matches nobody', () => {
    expect(hits('@')).toHaveLength(0);
    expect(hits('@1')).toHaveLength(0);
  });
});

describe('negation', () => {
  it('! excludes — `&` is and, `,` is or', () => {
    const all = hits('water').length;
    const notFairy = hits('water&!fairy').length;
    expect(notFairy).toBeLessThan(all);
    expect(notFairy).toBeGreaterThan(0);
    // The or-form is the opposite question and answers far wider.
    expect(hits('water,!fairy').length).toBeGreaterThan(all);
  });
  it('double negation cancels', () => {
    expect(hits('!!water').length).toBe(hits('water').length);
  });
  it('a bare ! matches everything, having excluded nothing', () => {
    expect(hits('!').length).toBe(SPECIES.length);
  });
});

describe('bare terms resolve most-specific first', () => {
  it('a number is a dex number', () => {
    const r = hits('184');
    expect(r.every((s) => s.dex === 184)).toBe(true);
  });
  it('xl finds the spreads that need candy XL', () => {
    expect(hits('xl').length).toBeGreaterThan(0);
  });
  it('shadow reads as a tag even though the data spells it shadowEligible', () => {
    const r = hits('shadow');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((s) => s.shadowEligible)).toBe(true);
  });
  it('family finds everything that has one', () => {
    expect(hits('family').every((s) => s.family !== null)).toBe(true);
  });
});

describe('isStructured', () => {
  it('is true for anything using an operator', () => {
    for (const q of ['@counter', 'water,steel', '!fairy', 'a&b', 'a+b']) {
      expect(isStructured(q)).toBe(true);
    }
  });
  it('is true for a generation name, which is a concept not a name', () => {
    expect(isStructured('gen1')).toBe(true);
  });
  it('is false for a plain name search', () => {
    expect(isStructured('azumarill')).toBe(false);
    expect(isStructured('')).toBe(false);
  });
});
