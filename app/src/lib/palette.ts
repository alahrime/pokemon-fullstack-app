/**
 * Palette derivation and the contrast rules every theme has to satisfy.
 *
 * One implementation, used twice: `scripts/build-themes.ts` bakes the shipped
 * type themes with it at build time, and the custom-theme editor runs the same
 * code in the browser. A second copy would drift, and the copy that drifted
 * would be the one deciding whether a user's own palette is readable.
 *
 * Everything here is sRGB and WCAG 2.1. No colour library: the maths is forty
 * lines and a dependency here would be a dependency in the data build too.
 */

export type Scheme = 'dark' | 'light';

/** The five colours a theme is described by. Everything else is derived. */
export interface ThemeBase {
  scheme: Scheme;
  bg: string;
  surface: string;
  text: string;
  accent: string;
  accent2: string;
}

const clamp255 = (n: number) => Math.round(Math.max(0, Math.min(255, n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0');

export const toHex = ([r, g, b]: number[]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function fromHex(h: string): number[] {
  const v = h.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** Relative luminance, per WCAG 2.1. */
export function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(fromHex(a));
  const lb = luminance(fromHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const A = fromHex(a);
  const B = fromHex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

/**
 * A nine-step ramp from a base colour.
 *
 * Dark themes run dark-to-light so that -700 is the readable accent and -100
 * is a tint that sits on the background; light themes run the other way, so a
 * component styled against `--color-accent-700` means the same thing in both.
 */
export function ramp(base: string, scheme: Scheme): string[] {
  const dark = scheme === 'dark';
  const floor = dark ? '#050608' : '#ffffff';
  const ceil = dark ? '#ffffff' : '#0a0a0a';
  const below = [0.86, 0.76, 0.64, 0.5, 0.34, 0.17];
  const above = [0.34, 0.62];
  return [...below.map((t) => mix(base, floor, t)), base, ...above.map((t) => mix(base, ceil, t))];
}

/** Nudge a colour toward `toward` until it clears `target` against `ground`. */
export function ensureContrast(colour: string, ground: string, target: number, toward: string): string {
  let out = colour;
  for (let i = 0; i < 60 && contrast(out, ground) < target; i++) out = mix(out, toward, 0.03);
  return out;
}

/** AA floors: 4.5:1 carries body text, 3:1 carries large text and UI edges. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

/**
 * Two signal colours have to be told apart, not just read.
 *
 * Contrast against the ground says nothing about whether the accent and the
 * second accent look like the same colour — and they carry different meanings
 * everywhere in this UI, so a pair that fails this is worse than a pair that
 * is merely dull.
 */
export const DISTINCT_MIN = 1.35;
export function distinguishable(a: string, b: string): boolean {
  const [ra, ga, ba] = fromHex(a);
  const [rb, gb, bb] = fromHex(b);
  // Ratio of luminances, plus a plain channel distance so two colours of equal
  // lightness but different hue still count as different.
  const lum = contrast(a, b);
  const dist = Math.abs(ra - rb) + Math.abs(ga - gb) + Math.abs(ba - bb);
  return lum >= DISTINCT_MIN || dist >= 150;
}

export interface PaletteCheck {
  name: string;
  ratio: number;
  needs: number;
  ok: boolean;
}

/** Derive the full token set, and report what every pairing measured. */
export function buildPalette(base: ThemeBase): { tokens: Record<string, string>; checks: PaletteCheck[] } {
  const dark = base.scheme === 'dark';
  const toward = dark ? '#ffffff' : '#000000';
  const away = dark ? '#000000' : '#ffffff';

  const neutrals = ramp(mix(base.surface, toward, 0.34), base.scheme);
  const accents = ramp(base.accent, base.scheme);
  const accent2s = ramp(base.accent2, base.scheme);

  // Each text tier is pushed until it clears its own floor rather than assumed.
  const muted = ensureContrast(mix(base.text, base.surface, 0.34), base.surface, AA_TEXT, base.text);
  const faint = ensureContrast(mix(base.text, base.surface, 0.58), base.surface, AA_LARGE, base.text);
  const accentReadable = ensureContrast(base.accent, base.bg, AA_TEXT, toward);
  const accent2Readable = ensureContrast(base.accent2, base.bg, AA_TEXT, toward);
  const onAccent = contrast('#ffffff', base.accent) >= contrast(away, base.accent) ? '#ffffff' : away;

  const checks: PaletteCheck[] = [
    ['text on background', contrast(base.text, base.bg), AA_TEXT],
    ['text on surface', contrast(base.text, base.surface), AA_TEXT],
    ['muted text on surface', contrast(muted, base.surface), AA_TEXT],
    ['faint text on surface', contrast(faint, base.surface), AA_LARGE],
    ['accent on background', contrast(accentReadable, base.bg), AA_TEXT],
    ['second accent on background', contrast(accent2Readable, base.bg), AA_TEXT],
    ['on-accent over accent', contrast(onAccent, base.accent), AA_TEXT],
  ].map(([name, ratio, needs]) => ({
    name: name as string,
    ratio: ratio as number,
    needs: needs as number,
    ok: (ratio as number) >= (needs as number),
  }));

  const rule = (pct: number) => `color-mix(in srgb, ${neutrals[6]} ${pct}%, transparent)`;
  const tokens: Record<string, string> = {
    'color-scheme': base.scheme,
    '--color-bg': base.bg,
    '--color-surface': base.surface,
    '--color-text': base.text,
    '--color-accent': accentReadable,
    '--color-accent-2': accent2Readable,
    '--color-divider': rule(40),
    '--surface-1': base.bg,
    '--surface-2': base.surface,
    '--surface-3': neutrals[2],
    '--surface-inverse': base.text,
    '--text-inverse': base.bg,
    '--text-muted': muted,
    '--text-faint': faint,
    '--color-on-accent': onAccent,
    '--rule-hairline': rule(26),
    '--rule-strong': rule(46),
    '--focus-ring': 'color-mix(in srgb, var(--color-accent) 70%, transparent)',
    '--grid-line': rule(12),
    '--shadow-sm': `0 1px 2px rgb(0 0 0 / ${dark ? 0.5 : 0.12})`,
    '--shadow-md': `0 6px 18px -6px rgb(0 0 0 / ${dark ? 0.62 : 0.16})`,
    '--shadow-lg': `0 20px 48px -18px rgb(0 0 0 / ${dark ? 0.7 : 0.2})`,
    '--glow-accent': `0 0 22px color-mix(in srgb, var(--color-accent) ${dark ? 34 : 22}%, transparent)`,
    '--glow-signal': `0 0 14px color-mix(in srgb, var(--color-accent-2) ${dark ? 30 : 20}%, transparent)`,
    '--font-heading': "'Archivo', system-ui, sans-serif",
    '--font-heading-weight': '800',
    '--font-body': "'Archivo', system-ui, sans-serif",
    '--font-mono': "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    '--font-numeric': 'var(--font-mono)',
    '--radius-sm': '2px',
    '--radius-md': '3px',
    '--radius-lg': '4px',
    '--chrome-opacity': dark ? '1' : '0.5',
    // Kept purple in every theme: it is a game marker, not decoration.
    '--shadow-aura': dark ? '#a855f7' : '#7e22ce',
    '--shadow-aura-deep': dark ? '#6d28d9' : '#4c1d95',
    '--shadow-ink': dark ? '#1a0b2e' : '#2e1065',
  };
  neutrals.forEach((c, i) => (tokens[`--color-neutral-${(i + 1) * 100}`] = c));
  accents.forEach((c, i) => (tokens[`--color-accent-${(i + 1) * 100}`] = c));
  accent2s.forEach((c, i) => (tokens[`--color-accent-2-${(i + 1) * 100}`] = c));

  return { tokens, checks };
}

/**
 * A custom theme is three choices; the rest follows.
 *
 * The user picks a ground, then a signal, then a second signal. Text is NOT a
 * choice — it is derived to clear 4.5:1 against both grounds, because a text
 * colour is the one thing a person cannot pick badly without the result being
 * unusable, and offering it as a free choice is offering them that.
 */
export interface CustomChoice {
  bg: string;
  accent: string;
  accent2: string;
}

export function customBase(choice: CustomChoice): ThemeBase {
  const scheme: Scheme = luminance(fromHex(choice.bg)) < 0.18 ? 'dark' : 'light';
  const dark = scheme === 'dark';
  const surface = mix(choice.bg, dark ? '#ffffff' : '#000000', 0.06);
  // Start from the far end and walk back until it clears both grounds.
  const seed = dark ? '#ffffff' : '#0a0a0a';
  const text = ensureContrast(
    ensureContrast(seed, choice.bg, AA_TEXT, seed),
    surface,
    AA_TEXT,
    seed,
  );
  return { scheme, bg: choice.bg, surface, text, accent: choice.accent, accent2: choice.accent2 };
}

/**
 * The colours the custom-theme editor offers.
 *
 * Signals are the eighteen type colours rather than a generic colour wheel:
 * they are already this app's vocabulary, and picking "Water blue" is a
 * choice someone can make, where a hex field is a puzzle. Grounds are ten
 * tinted darks and lights, because a ground is chosen for its weight rather
 * than its hue.
 */
export const CUSTOM_GROUNDS: { id: string; label: string; hex: string }[] = [
  { id: 'void', label: 'Void', hex: '#05070a' },
  { id: 'slate', label: 'Slate', hex: '#0c1118' },
  { id: 'ocean', label: 'Ocean', hex: '#04121e' },
  { id: 'forest', label: 'Forest', hex: '#071409' },
  { id: 'plum', label: 'Plum', hex: '#150a1c' },
  { id: 'ember', label: 'Ember', hex: '#180a06' },
  { id: 'paper', label: 'Paper', hex: '#f7f3ea' },
  { id: 'bone', label: 'Bone', hex: '#f1efe9' },
  { id: 'frost', label: 'Frost', hex: '#f0f6f9' },
  { id: 'chalk', label: 'Chalk', hex: '#ffffff' },
];

export const CUSTOM_SIGNALS: { id: string; label: string; hex: string }[] = [
  { id: 'normal', label: 'Normal', hex: '#828282' },
  { id: 'fire', label: 'Fire', hex: '#e4613e' },
  { id: 'water', label: 'Water', hex: '#3099e1' },
  { id: 'electric', label: 'Electric', hex: '#dfbc28' },
  { id: 'grass', label: 'Grass', hex: '#439837' },
  { id: 'ice', label: 'Ice', hex: '#47c8c8' },
  { id: 'fighting', label: 'Fighting', hex: '#e49021' },
  { id: 'poison', label: 'Poison', hex: '#9354cb' },
  { id: 'ground', label: 'Ground', hex: '#a4733c' },
  { id: 'flying', label: 'Flying', hex: '#74aad0' },
  { id: 'psychic', label: 'Psychic', hex: '#e96c8c' },
  { id: 'bug', label: 'Bug', hex: '#9f9f28' },
  { id: 'rock', label: 'Rock', hex: '#a9a481' },
  { id: 'ghost', label: 'Ghost', hex: '#6f4570' },
  { id: 'dragon', label: 'Dragon', hex: '#576fbc' },
  { id: 'dark', label: 'Dark', hex: '#4f4747' },
  { id: 'steel', label: 'Steel', hex: '#74b0cb' },
  { id: 'fairy', label: 'Fairy', hex: '#e18ce1' },
];

/**
 * How far a colour has to move to be readable on a ground, 0 to 1.
 *
 * The type colours are mid-lightness by design, so almost none of them clear
 * 4.5:1 against white — offering only the ones that already pass left a light
 * ground with two choices out of eighteen, which is not a choice. So a signal
 * is darkened or lightened to suit its ground, and the swatch shows the
 * adapted colour, not the original: what you pick is still what you get.
 *
 * What it will not do is pretend. Past `SIGNAL_MAX_SHIFT` the colour has moved
 * so far that it is no longer the colour on the chip — Electric yellow on
 * white ends up brown — and that is reported as a rejection rather than
 * quietly shipped.
 */
/**
 * Measured, not guessed. Across all 180 ground-by-signal pairs the largest
 * adaptation is 0.284 — Fairy on Bone — so a threshold above that would never
 * fire and the guard would be decoration. At 0.20 a dark ground keeps 17 or 18
 * of the 18 signals and a light one keeps 12 or 13: the pale, saturated
 * colours drop out, which is exactly the set that cannot stay themselves on
 * white.
 */
export const SIGNAL_MAX_SHIFT = 0.2;

export function adaptSignal(hex: string, ground: string): { hex: string; shift: number } {
  const toward = luminance(fromHex(ground)) < 0.18 ? '#ffffff' : '#000000';
  const out = ensureContrast(hex, ground, AA_TEXT, toward);
  const [r, g, b] = fromHex(hex);
  const [r2, g2, b2] = fromHex(out);
  const shift = (Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2)) / (3 * 255);
  return { hex: out, shift };
}

/**
 * Why a signal cannot be used, or null if it can.
 *
 * The editor asks this rather than deciding for itself, so the rule that greys
 * a swatch out and the rule that would have failed the build are the same
 * rule.
 */
export function signalRejection(
  hex: string,
  ground: string,
  other?: string | null,
): string | null {
  const { hex: adapted, shift } = adaptSignal(hex, ground);
  if (shift > SIGNAL_MAX_SHIFT) return 'cannot stay this colour and stay readable here';
  if (contrast(adapted, ground) < AA_TEXT) {
    return `${contrast(adapted, ground).toFixed(1)}:1 on this ground — needs ${AA_TEXT}:1`;
  }
  if (other && !distinguishable(adapted, other)) return 'too close to the other signal to tell apart';
  return null;
}
