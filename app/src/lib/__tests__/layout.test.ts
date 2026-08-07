import { describe, it, expect, beforeEach } from 'vitest';
import { clearOrder, loadOrder, reorder, saveOrder } from '../layout';

beforeEach(() => localStorage.clear());

describe('reorder', () => {
  it('moves an item forward', () => expect(reorder(['a','b','c','d'], 0, 2)).toEqual(['b','c','a','d']));
  it('moves an item backward', () => expect(reorder(['a','b','c','d'], 3, 1)).toEqual(['a','d','b','c']));
  it('is a no-op onto itself', () => expect(reorder(['a','b','c'], 1, 1)).toEqual(['a','b','c']));
  it('does not mutate its input', () => {
    const src = ['a','b','c'];
    reorder(src, 0, 2);
    expect(src).toEqual(['a','b','c']);
  });
  it('keeps every element — a reorder never drops one', () => {
    const out = reorder(['a','b','c','d','e'], 4, 0);
    expect([...out].sort()).toEqual(['a','b','c','d','e']);
  });
});

describe('loadOrder', () => {
  it('falls back to the declared order when nothing is saved', () => {
    expect(loadOrder('k', ['a','b','c'])).toEqual(['a','b','c']);
  });
  it('restores a saved order', () => {
    saveOrder('k', ['c','a','b']);
    expect(loadOrder('k', ['a','b','c'])).toEqual(['c','a','b']);
  });
  it('drops ids that no longer exist rather than rendering a hole', () => {
    saveOrder('k', ['c','gone','a']);
    expect(loadOrder('k', ['a','c'])).toEqual(['c','a']);
  });
  it('appends a new panel in its declared position instead of losing it', () => {
    saveOrder('k', ['c','a']);
    const out = loadOrder('k', ['a','b','c']);
    expect([...out].sort()).toEqual(['a','b','c']);
  });
  it('survives corrupt storage', () => {
    localStorage.setItem('k', '{not json');
    expect(loadOrder('k', ['a','b'])).toEqual(['a','b']);
  });
  it('survives storage holding the wrong shape', () => {
    localStorage.setItem('k', '{"a":1}');
    expect(loadOrder('k', ['a','b'])).toEqual(['a','b']);
  });
});

describe('clearOrder', () => {
  it('returns to the declared order', () => {
    saveOrder('k', ['b','a']);
    clearOrder('k');
    expect(loadOrder('k', ['a','b'])).toEqual(['a','b']);
  });
});
