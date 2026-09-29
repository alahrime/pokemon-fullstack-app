import { describe, it, expect } from 'vitest';
import {
  ROSTER_SIZE, cpBounds, leagueCap, toBuilds, checkRoster, memberFromChoice, describeViolation,
  type RosterMember,
} from '../roster';
import { RULES_SCHEMA, resolvePool, type Format, type Violation } from '../../rules';
import { movesFor, SPECIES_BY_ID } from '../../lib/data';
import { getEntry } from '../../lib/engine';
import { CPM, BB_MAX_LEVEL_IDX, MAX_LEVEL_IDX } from '../../lib/cpm';

const FORMAT: Format = {
  schema: RULES_SCHEMA, base: 'great', pool: [],
  composition: { size: ROSTER_SIZE, uniqueSpecies: true }, selection: { mode: 'open' },
};

function member(ref: string, cp = 1400): RosterMember {
  const m = movesFor(SPECIES_BY_ID.get(ref)!, 'great');
  return { ref, fast: m.fast.id, charges: m.charges.map((c) => c.id), cp, bestBuddy: false };
}
const legal = resolvePool(FORMAT).legal;
const SIX = ['azumarill', 'registeel', 'altaria', 'medicham', 'skarmory', 'stunfisk_galarian'];
const six = (): RosterMember[] => SIX.map((r) => member(r));
const with_ = (i: number, over: Partial<RosterMember>): RosterMember[] =>
  six().map((m, j) => (j === i ? { ...m, ...over } : m));
const check = (r: RosterMember[], f = FORMAT) => checkRoster(r, f, 'great');

describe('cpBounds', () => {
  it('floors at 10 and tops out at the perfect level-50 CP, level 51 with a Best Buddy', () => {
    const a = cpBounds('azumarill', false);
    const b = cpBounds('azumarill', true);
    expect(a.min).toBe(10);
    expect(b.max).toBeGreaterThan(a.max);
    const s = SPECIES_BY_ID.get('azumarill')!;
    const cp = (i: number) =>
      Math.floor(((s.atk + 15) * Math.sqrt(s.def + 15) * Math.sqrt(s.hp + 15) * CPM[i] ** 2) / 10);
    expect(a.max).toBe(cp(MAX_LEVEL_IDX));
    expect(b.max).toBe(cp(BB_MAX_LEVEL_IDX));
  });
  it.each(['azumarill', 'registeel', 'mewtwo'])('%s agrees with the engine at 15/15/15', (ref) => {
    expect(cpBounds(ref, false).max).toBe(getEntry(ref, { a: 15, d: 15, s: 15 }, 'master', false).entry.cp);
    expect(cpBounds(ref, true).max).toBe(getEntry(ref, { a: 15, d: 15, s: 15 }, 'master', true).entry.cp);
  });
});

describe('leagueCap', () => {
  it('is 1500 / 2500 / none', () => {
    expect(leagueCap('great')).toBe(1500);
    expect(leagueCap('ultra')).toBe(2500);
    expect(leagueCap('master')).toBeNull();
  });
});

describe('memberFromChoice / toBuilds', () => {
  it('maps a modal choice to a member and a member to a build', () => {
    const s = SPECIES_BY_ID.get('azumarill')!;
    const m = memberFromChoice(
      { ref: 'azumarill', fastIdx: 1, chargeIds: ['a', 'b'], iv: { a: 0, d: 15, s: 15 } }, 1490, true,
    );
    expect(m).toEqual({ ref: 'azumarill', fast: s.fastMoves[1].id, charges: ['a', 'b'], cp: 1490, bestBuddy: true });
    expect(Object.keys(m).sort()).toEqual(['bestBuddy', 'charges', 'cp', 'fast', 'ref']);
    expect(toBuilds([m])).toEqual([{ ref: 'azumarill', fast: s.fastMoves[1].id, charges: ['a', 'b'] }]);
  });
});

describe('checkRoster', () => {
  it('accepts a legal six', () => {
    expect(SIX.every((r) => legal.includes(r))).toBe(true);
    expect(check(six())).toEqual({ ok: true, problems: [] });
  });
  it('names the count', () => {
    expect(check(six().slice(0, 5)).problems.join()).toMatch(/exactly 6.*you have 5/);
  });
  it('flags each member fault at its slot', () => {
    const cases: [number, Partial<RosterMember>, RegExp][] = [
      [2, { ref: 'nope' }, /^Slot 3: unknown/],
      [0, { fast: 'NOT_A_MOVE' }, /^Slot 1: .*fast move/],
      [0, { charges: ['NOT_A_MOVE'] }, /^Slot 1: .*NOT_A_MOVE/],
      [0, { charges: [] }, /^Slot 1: pick one or two/],
      [0, { charges: ['a', 'b', 'c'] }, /^Slot 1: pick one or two/],
      [4, { cp: 1400.5 }, /^Slot 5: CP must be a whole/],
      [4, { cp: 9 }, /^Slot 5: CP is below 10/],
      [1, { cp: 99999 }, /^Slot 2: .*cannot reach CP 99999/],
      [1, { cp: 1501 }, /^Slot 2: CP 1501 is over the 1500 cap/],
    ];
    for (const [i, over, re] of cases) {
      expect(check(with_(i, over)).problems.some((p) => re.test(p)), JSON.stringify(over)).toBe(true);
    }
  });
  it('Best Buddy under the cap is fine', () => {
    expect(check(with_(0, { bestBuddy: true, cp: 1490 })).ok).toBe(true);
  });
  it('reports a ref outside the format pool', () => {
    const r = check(with_(0, { ref: 'mewtwo', ...{} }));
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.startsWith('Format:'))).toBe(true);
  });
  it('a duplicate species violates uniqueSpecies', () => {
    const r = check(with_(1, member('azumarill')));
    expect(r.problems.some((p) => p.startsWith('Format:') && /azumarill/.test(p))).toBe(true);
  });
});

describe('describeViolation', () => {
  const all: Violation[] = [
    { kind: 'size', expected: 6, actual: 5 },
    { kind: 'illegal-ref', ref: 'x', clause: 1 },
    { kind: 'duplicate-species', refs: ['x', 'y'] },
    { kind: 'duplicate-family', refs: ['x', 'y'] },
    { kind: 'quota', select: 'type:fire', min: 1, actual: 0 },
    { kind: 'quota', select: 'type:fire', max: 1, actual: 2 },
    { kind: 'unknown-move', ref: 'x', move: 'm' },
  ];
  it('says more than the kind name for every kind', () => {
    for (const v of all) {
      const s = describeViolation(v);
      expect(s).not.toBe(v.kind);
      expect(s).not.toContain(v.kind);
      expect(s.split(' ').length).toBeGreaterThan(3);
    }
  });
});
