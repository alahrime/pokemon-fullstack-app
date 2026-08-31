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

  it('matches an archetype selector against a move the build is running', () => {
    // registeel's rated Great build runs Flash Cannon + Focus Blast, both
    // archetype "Nuke"; azumarill's runs Ice Beam + Play Rough, both "High
    // Energy" — neither name nor id nor type contains "nuke", only archetype.
    const t = compileBuildSelector('@nuke')!;
    expect(t(build('registeel'))).toBe(true);
    expect(t(build('azumarill'))).toBe(false);
  });

  it('a slot-prefixed selector matches only in the intended slot', () => {
    // azumarill's rated Great build runs Bubble (water, fast) and Ice Beam
    // (ice, charged) among its moves — an ice-type move exists only as a
    // charge, so a fast-only selector must not pick it up even though the
    // unprefixed and charge-prefixed forms do.
    const b = build('azumarill');
    expect(compileBuildSelector('@ice')!(b)).toBe(true);
    expect(compileBuildSelector('@2ice')!(b)).toBe(true);
    expect(compileBuildSelector('@1ice')!(b)).toBe(false);
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
    // registeel, not azumarill: azumarill.shadowEligible is false in the
    // current generated data, so azumarill_shadow is not a legal Great ref
    // and would fail on illegal-ref before the quota logic under test ever
    // ran. registeel is Shadow-eligible and Shadow-legal in Great League.
    const mixed = [build(makeRef('registeel', true)), build('registeel'), build('altaria')];
    const q = fmt({ quotas: [{ select: 'shadow', min: 1, max: 2 }] });
    expect(validateTeam(mixed, q).ok).toBe(true);
    expect(validateTeam(team, q).ok).toBe(false);
  });

  it('ignores a quota whose selector will not compile', () => {
    const r = validateTeam(team, fmt({ quotas: [{ select: '  ' }] }));
    expect(r.violations.filter((v) => v.kind === 'quota')).toEqual([]);
  });

  it('counts an archetype quota against builds actually running it, not an empty match set', () => {
    // Regression for the finding: movesMatching (pre-fix) recognised only
    // name/id/type, so '@nuke' matched nothing and any quota built on it
    // silently passed with actual: 0 regardless of max. Only registeel's
    // rated build runs Nuke-archetype charges among this team.
    const ok = validateTeam(team, fmt({ quotas: [{ select: '@nuke', max: 1 }] }));
    expect(ok.ok).toBe(true);

    const exceeded = validateTeam(team, fmt({ quotas: [{ select: '@nuke', max: 0 }] }));
    expect(exceeded.violations).toContainEqual({ kind: 'quota', select: '@nuke', max: 0, actual: 1 });
  });
});
