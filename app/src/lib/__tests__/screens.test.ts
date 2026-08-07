import { describe, it, expect } from 'vitest';
import { HUE_OF, SCREEN_DEFS } from '../screens';

describe('screen table', () => {
  it('is the single source for nav and landing alike', () => {
    expect(SCREEN_DEFS.length).toBeGreaterThanOrEqual(6);
  });
  it('gives every screen a unique id', () => {
    const ids = SCREEN_DEFS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('gives every screen a distinct hue, so colour identifies a section', () => {
    const hues = SCREEN_DEFS.map((s) => s.hue);
    expect(new Set(hues).size).toBe(hues.length);
  });
  it('draws hues from the type palette rather than inventing a second scheme', () => {
    for (const s of SCREEN_DEFS) expect(s.hue).toMatch(/^var\(--type-[a-z]+\)$/);
  });
  it('gives every screen a label, kicker, glyph and blurb', () => {
    for (const s of SCREEN_DEFS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.kicker.length).toBeGreaterThan(0);
      expect(s.glyph.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(10);
    }
  });
  it('HUE_OF indexes the same table', () => {
    for (const s of SCREEN_DEFS) expect(HUE_OF[s.id]).toBe(s.hue);
  });
});
