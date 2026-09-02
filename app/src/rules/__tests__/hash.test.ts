import { describe, it, expect } from 'vitest';
import { RULES_SCHEMA, type Format } from '../index';
import { rulesHash } from '../hash';

const base: Format = {
  schema: RULES_SCHEMA, base: 'great', start: 'empty', pool: [],
  composition: { size: 3, uniqueSpecies: true }, selection: { mode: 'open' },
};

describe('rulesHash', () => {
  it('is 64 hex characters', async () => {
    expect(await rulesHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agrees for two independently authored identical formats', async () => {
    // The whole point of partitioning queues by hash rather than by
    // format_version_id: two people who wrote the same rules must meet.
    const twin: Format = { ...base, composition: { ...base.composition } };
    expect(await rulesHash(twin)).toBe(await rulesHash(base));
  });

  it('differs when a rule differs', async () => {
    const bigger: Format = { ...base, composition: { ...base.composition, size: 6 } };
    expect(await rulesHash(bigger)).not.toBe(await rulesHash(base));
  });
});
