import { describe, it, expect } from 'vitest';
import { HUE_OF, SCREEN_DEFS, SECTIONS, sectionOf, railScreens, railIdOf } from '../screens';

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

describe('sections', () => {
  it('puts every screen except landing and account in exactly one section', () => {
    const all = SECTIONS.flatMap((s) => s.screens);
    expect(new Set(all).size).toBe(all.length);
    for (const d of SCREEN_DEFS) {
      if (d.id === 'account') expect(all).not.toContain(d.id);
      else expect(all, d.id).toContain(d.id);
    }
    expect(all).not.toContain('landing');
  });
  it('orders the sections and their screens as specified', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['analyze', 'teams', 'play']);
    expect(SECTIONS[0].screens).toEqual(['report', 'battle', 'moves', 'rankings', 'diagnostics']);
    expect(SECTIONS[1].screens).toEqual(['gbl', 'show6', 'cores', 'formats']);
    expect(SECTIONS[2].screens).toEqual(['matchmaking', 'match', 'friends', 'chat', 'tournaments', 'ranked']);
  });
  it('finds a screen\'s section, and none for landing and account', () => {
    expect(sectionOf('rankings')?.id).toBe('analyze');
    expect(sectionOf('match')?.id).toBe('play');
    expect(sectionOf('landing')).toBeNull();
    expect(sectionOf('account')).toBeNull();
  });
  it('keeps match off the rail and lights Matches while a match is open', () => {
    const play = SECTIONS.find((s) => s.id === 'play')!;
    expect(railScreens(play).map((d) => d.id)).toEqual(['matchmaking', 'friends', 'chat', 'tournaments', 'ranked']);
    expect(railIdOf('match')).toBe('matchmaking');
    expect(railIdOf('friends')).toBe('friends');
  });
  it('gives sections type-palette hues', () => {
    for (const s of SECTIONS) expect(s.hue).toMatch(/^var\(--type-[a-z]+\)$/);
  });
});
