import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEY, deleteFormat, listFormats, saveFormat } from '../formatStore';
import { RULES_SCHEMA, type Format } from '../../rules';

const f: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [{ effect: 'deny', select: 'flying' }],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

beforeEach(() => localStorage.clear());

describe('formatStore', () => {
  it('starts empty', () => expect(listFormats()).toEqual([]));

  it('round-trips a saved format', () => {
    const saved = saveFormat('Air Ban', f);
    const back = listFormats();
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(saved.id);
    expect(back[0].format).toEqual(f);
  });

  it('updates in place when given an id', () => {
    const first = saveFormat('Air Ban', f);
    const edited: Format = { ...f, composition: { ...f.composition, size: 6 } };
    saveFormat('Air Ban', edited, first.id);
    const back = listFormats();
    expect(back).toHaveLength(1);
    expect(back[0].format.composition.size).toBe(6);
  });

  it('deletes', () => {
    const s = saveFormat('Air Ban', f);
    deleteFormat(s.id);
    expect(listFormats()).toEqual([]);
  });

  it('survives corrupt storage rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not json{{{');
    expect(listFormats()).toEqual([]);
  });

  it('drops a stored format whose schema it does not know', () => {
    const alien = [{ id: 'x', name: 'Alien', updatedAt: 1, format: { ...f, schema: 999 } }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alien));
    expect(listFormats()).toEqual([]);
  });

  it('orders most recently updated first', () => {
    const a = saveFormat('A', f);
    const b = saveFormat('B', f);
    expect(listFormats()[0].id).toBe(b.id);
    saveFormat('A', f, a.id);
    expect(listFormats()[0].id).toBe(a.id);
  });
});
