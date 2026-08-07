import { describe, it, expect } from 'vitest';
import {
  AA_TEXT, AA_LARGE, CUSTOM_GROUNDS, CUSTOM_SIGNALS, SIGNAL_MAX_SHIFT,
  adaptSignal, buildPalette, contrast, customBase, distinguishable, ramp, signalRejection,
} from '../palette';

describe('contrast maths', () => {
  it('matches the WCAG reference points', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#000000', '#000000')).toBeCloseTo(1, 5);
    // 4.54:1 — the canonical "just passes AA" grey on white.
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.6);
  });
  it('is symmetric', () => {
    expect(contrast('#3099e1', '#04121e')).toBeCloseTo(contrast('#04121e', '#3099e1'), 9);
  });
});

describe('ramps', () => {
  it('run nine steps with the base in the middle', () => {
    const r = ramp('#3099e1', 'dark');
    expect(r).toHaveLength(9);
    expect(r[6]).toBe('#3099e1');
  });
  it('run toward the ground, so -100 sits on the background in either scheme', () => {
    const dark = ramp('#3099e1', 'dark');
    const light = ramp('#3099e1', 'light');
    expect(contrast(dark[0], '#000000')).toBeLessThan(contrast(dark[8], '#000000'));
    expect(contrast(light[0], '#ffffff')).toBeLessThan(contrast(light[8], '#ffffff'));
  });
});

describe('every custom palette a user can build passes its own checks', () => {
  it('holds for all grounds and every legal signal pair', () => {
    let built = 0;
    for (const g of CUSTOM_GROUNDS) {
      const legal = CUSTOM_SIGNALS.filter((s) => !signalRejection(s.hex, g.hex))
        .map((s) => adaptSignal(s.hex, g.hex).hex);
      expect(legal.length).toBeGreaterThan(6);
      for (const a of legal) {
        const seconds = CUSTOM_SIGNALS
          .filter((s) => !signalRejection(s.hex, g.hex, a))
          .map((s) => adaptSignal(s.hex, g.hex).hex);
        for (const b of seconds) {
          const { checks } = buildPalette(customBase({ bg: g.hex, accent: a, accent2: b }));
          const failed = checks.filter((c) => !c.ok);
          if (failed.length) {
            throw new Error(`${g.label} ${a}/${b}: ${failed.map((f) => `${f.name} ${f.ratio.toFixed(2)}`).join(', ')}`);
          }
          built++;
        }
      }
    }
    // If the editor can offer it, it has to pass — this is the whole promise.
    expect(built).toBeGreaterThan(500);
  });
});

describe('what the editor refuses', () => {
  it('leaves a real choice on every ground, and a different one per ground', () => {
    const counts = CUSTOM_GROUNDS.map((g) => ({
      ground: g.label,
      n: CUSTOM_SIGNALS.filter((s) => !signalRejection(s.hex, g.hex)).length,
    }));
    // Never so narrow it stops being a choice — offering only colours that
    // already cleared 4.5:1 raw left a light ground with 2 of 18.
    for (const c of counts) expect(c.n).toBeGreaterThanOrEqual(12);
    // And genuinely ground-dependent: a light ground rules out the pale
    // saturated colours a dark one keeps.
    expect(new Set(counts.map((c) => c.n)).size).toBeGreaterThan(1);
  });

  it('refuses a second signal that cannot be told from the first', () => {
    const bg = CUSTOM_GROUNDS.find((g) => g.id === 'slate')!.hex;
    const water = adaptSignal(CUSTOM_SIGNALS.find((s) => s.id === 'water')!.hex, bg).hex;
    expect(signalRejection(CUSTOM_SIGNALS.find((s) => s.id === 'water')!.hex, bg, water))
      .toMatch(/tell apart/);
    const distinct = CUSTOM_SIGNALS.filter((s) => !signalRejection(s.hex, bg, water));
    expect(distinct.length).toBeLessThan(CUSTOM_SIGNALS.length);
    expect(distinct.length).toBeGreaterThan(8);
  });

  it('refuses a colour that would have to stop being itself', () => {
    // The guard exists so a chip never lies about what it will render.
    const far = adaptSignal('#ffff00', '#ffffff');
    expect(far.shift).toBeGreaterThan(0);
    expect(signalRejection('#ffff00', '#ffffff')).toBeTruthy();
  });

  it('reports a shift of zero when a colour already suits its ground', () => {
    expect(adaptSignal('#3099e1', '#04121e').shift).toBe(0);
    expect(SIGNAL_MAX_SHIFT).toBeGreaterThan(0);
  });
});

describe('derived text', () => {
  it('clears both grounds on every ground offered', () => {
    for (const g of CUSTOM_GROUNDS) {
      const base = customBase({ bg: g.hex, accent: '#3099e1', accent2: '#e4613e' });
      expect(contrast(base.text, base.bg)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(base.text, base.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
  it('picks the scheme from the ground rather than asking', () => {
    expect(customBase({ bg: '#05070a', accent: '#fff', accent2: '#fff' }).scheme).toBe('dark');
    expect(customBase({ bg: '#ffffff', accent: '#000', accent2: '#000' }).scheme).toBe('light');
  });
});

describe('distinguishable', () => {
  it('separates by lightness or by hue, not only by lightness', () => {
    expect(distinguishable('#3099e1', '#3099e1')).toBe(false);
    // Same luminance, opposite hue: still two different colours.
    expect(distinguishable('#e4613e', '#3e9de4')).toBe(true);
  });
  it('agrees with the large-text floor being lower than the text floor', () => {
    expect(AA_LARGE).toBeLessThan(AA_TEXT);
  });
});
