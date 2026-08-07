/**
 * Generate the type-inspired themes, and refuse to emit one that fails 508.
 *
 * Hand-picking 64 hex values per theme and eyeballing the result is how you
 * ship a palette that looks fine to whoever chose it and is unreadable to
 * someone else. Here each theme is described by five colours; the ramps are
 * derived, and every pairing the UI actually renders is measured against
 * WCAG 2.1 before anything is written. A theme that misses its target is a
 * build failure, not a judgement call.
 *
 * Run with `npm run themes`. Output goes to src/styles/types-themes.css.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/styles/types-themes.css');

// ── colour maths ────────────────────────────────────────────────────────────

const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const toHex = ([r, g, b]) => `#${hex(r)}${hex(g)}${hex(b)}`;
const fromHex = (h) => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};

/** Relative luminance, per WCAG 2.1. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1..21. */
function contrast(a, b) {
  const la = luminance(fromHex(a));
  const lb = luminance(fromHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const mix = (a, b, t) => {
  const A = fromHex(a);
  const B = fromHex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
};

/**
 * A nine-step ramp from a base colour.
 *
 * Dark themes run dark-to-light so that -700 is the readable accent and -100
 * is a tint that sits on the background; light themes run the other way. This
 * mirrors the ramps the existing themes already ship, so a component styled
 * against `--color-accent-700` keeps meaning the same thing.
 */
function ramp(base, scheme) {
  const dark = scheme === 'dark';
  const floor = dark ? '#050608' : '#ffffff';
  const ceil = dark ? '#ffffff' : '#0a0a0a';
  // -700 is the base itself; the rest step away from it in both directions.
  const below = [0.86, 0.76, 0.64, 0.5, 0.34, 0.17];
  const above = [0.34, 0.62];
  return [
    ...below.map((t) => mix(base, floor, t)),
    base,
    ...above.map((t) => mix(base, ceil, t)),
  ];
}

/** Nudge a colour toward its ground until it clears `target` against it. */
function ensureContrast(colour, ground, target, toward) {
  let out = colour;
  for (let i = 0; i < 60 && contrast(out, ground) < target; i++) {
    out = mix(out, toward, 0.03);
  }
  return out;
}

// ── the themes ──────────────────────────────────────────────────────────────

/**
 * Five colours each, drawn from the type chart rather than invented. Ghost and
 * Dragon are deliberately absent: the existing Midnight already occupies that
 * indigo, and a second one would read as the same theme.
 */
const THEMES = [
  {
    id: 'water', label: 'Water', scheme: 'dark',
    blurb: 'Deep ocean, cyan signal',
    bg: '#04121e', surface: '#0a2033', text: '#d6e4ee', accent: '#3f9fe0', accent2: '#49d3c4',
  },
  {
    id: 'grass', label: 'Grass', scheme: 'dark',
    blurb: 'Canopy green, citrus signal',
    bg: '#071409', surface: '#0e2413', text: '#dcead9', accent: '#5cb85c', accent2: '#c3e34a',
  },
  {
    id: 'psychic', label: 'Psychic', scheme: 'dark',
    blurb: 'Plum dusk, magenta signal',
    bg: '#150a1c', surface: '#241031', text: '#ebdcf2', accent: '#e0609a', accent2: '#7ad4f0',
  },
  {
    id: 'electric', label: 'Electric', scheme: 'dark',
    blurb: 'Charcoal, high-voltage signal',
    bg: '#101008', surface: '#1c1b0e', text: '#efeada', accent: '#e8c020', accent2: '#63c8f0',
  },
  {
    id: 'steel', label: 'Steel', scheme: 'light',
    blurb: 'Brushed metal, cool ink',
    bg: '#eef1f4', surface: '#ffffff', text: '#161b21', accent: '#3c6d92', accent2: '#8a6d3f',
  },
  {
    id: 'ice', label: 'Ice', scheme: 'light',
    blurb: 'Glacier white, frost signal',
    bg: '#f0f6f9', surface: '#ffffff', text: '#10222b', accent: '#1f7f9e', accent2: '#6a52b5',
  },
];

// ── emit ────────────────────────────────────────────────────────────────────

/**
 * The pairings the UI actually renders, and what each has to clear.
 *
 * 4.5:1 is the AA floor for body text; 3:1 covers large text and the boundary
 * of a control, which is what the accents and rules are used for.
 */
const CHECKS = [
  ['text on background', (t) => [t.text, t.bg], 4.5],
  ['text on surface', (t) => [t.text, t.surface], 4.5],
  ['muted text on surface', (t) => [t.muted, t.surface], 4.5],
  ['faint text on surface', (t) => [t.faint, t.surface], 3],
  ['accent on background', (t) => [t.accentReadable, t.bg], 4.5],
  ['second accent on background', (t) => [t.accent2Readable, t.bg], 4.5],
  ['on-accent over accent', (t) => [t.onAccent, t.accent], 4.5],
];

const failures = [];
const report = [];
let css = `/* ═══════════════════════════════════════════════════════════════════════════
   TYPE THEMES — generated by scripts/build-themes.mjs. Do not hand-edit.

   Each theme is derived from five colours and then checked: body text clears
   4.5:1 against both its grounds, the accents clear 4.5:1 where they carry
   text, and the faint tier clears 3:1. The generator refuses to emit a theme
   that misses, so a palette cannot regress into being unreadable.
   ═══════════════════════════════════════════════════════════════════════ */
`;

for (const t of THEMES) {
  const dark = t.scheme === 'dark';
  const toward = dark ? '#ffffff' : '#000000';
  const away = dark ? '#000000' : '#ffffff';

  const neutrals = ramp(mix(t.surface, toward, 0.34), t.scheme);
  const accents = ramp(t.accent, t.scheme);
  const accent2s = ramp(t.accent2, t.scheme);

  // Text tiers, each pushed until it clears its own floor rather than assumed.
  const muted = ensureContrast(mix(t.text, t.surface, 0.34), t.surface, 4.5, t.text);
  const faint = ensureContrast(mix(t.text, t.surface, 0.58), t.surface, 3, t.text);
  const accentReadable = ensureContrast(t.accent, t.bg, 4.5, toward);
  const accent2Readable = ensureContrast(t.accent2, t.bg, 4.5, toward);
  const onAccent = contrast('#ffffff', t.accent) >= contrast(away, t.accent) ? '#ffffff' : away;

  const m = { ...t, muted, faint, accentReadable, accent2Readable, onAccent };
  for (const [name, pick, target] of CHECKS) {
    const [a, b] = pick(m);
    const ratio = contrast(a, b);
    report.push(`${t.id.padEnd(9)} ${name.padEnd(28)} ${ratio.toFixed(2)}:1  (needs ${target})`);
    if (ratio < target) failures.push(`${t.id}: ${name} is ${ratio.toFixed(2)}:1, needs ${target}`);
  }

  const rule = (pct) => `color-mix(in srgb, ${neutrals[6]} ${pct}%, transparent)`;
  css += `
:root[data-theme='${t.id}'],
/* The preview tile carries this attribute, so it renders in this theme's own
   tokens and cannot drift from the real palette. Deliberately the tile and not
   the button around it: on the button it also recoloured the label, which made
   every light theme's name unreadable against a dark panel. */
.theme-swatch-face[data-theme='${t.id}'] {
  color-scheme: ${t.scheme};

  --color-bg: ${t.bg};
  --color-surface: ${t.surface};
  --color-text: ${t.text};
  --color-accent: ${accentReadable};
  --color-accent-2: ${accent2Readable};
  --color-divider: ${rule(40)};

${neutrals.map((c, i) => `  --color-neutral-${(i + 1) * 100}: ${c};`).join('\n')}

${accents.map((c, i) => `  --color-accent-${(i + 1) * 100}: ${c};`).join('\n')}

${accent2s.map((c, i) => `  --color-accent-2-${(i + 1) * 100}: ${c};`).join('\n')}

  --surface-1: ${t.bg};
  --surface-2: ${t.surface};
  --surface-3: ${neutrals[2]};
  --surface-inverse: ${t.text};
  --text-inverse: ${t.bg};
  --text-muted: ${muted};
  --text-faint: ${faint};
  --color-on-accent: ${onAccent};

  --rule-hairline: ${rule(26)};
  --rule-strong: ${rule(46)};
  --focus-ring: color-mix(in srgb, var(--color-accent) 70%, transparent);
  --grid-line: ${rule(12)};

  --shadow-sm: 0 1px 2px rgb(0 0 0 / ${dark ? 0.5 : 0.12});
  --shadow-md: 0 6px 18px -6px rgb(0 0 0 / ${dark ? 0.62 : 0.16});
  --shadow-lg: 0 20px 48px -18px rgb(0 0 0 / ${dark ? 0.7 : 0.2});
  --glow-accent: 0 0 22px color-mix(in srgb, var(--color-accent) ${dark ? 34 : 22}%, transparent);
  --glow-signal: 0 0 14px color-mix(in srgb, var(--color-accent-2) ${dark ? 30 : 20}%, transparent);

  --font-heading: 'Archivo', system-ui, sans-serif;
  --font-heading-weight: 800;
  --font-body: 'Archivo', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --font-numeric: var(--font-mono);

  --radius-sm: 2px;
  --radius-md: 3px;
  --radius-lg: 4px;

  /* The HUD chrome multiplies by this, so a light theme can turn the whole
     machined layer down without every rule needing its own override. */
  --chrome-opacity: ${dark ? 1 : 0.5};

  /* The Shadow-Pokemon aura. Kept purple in every theme on purpose: it is a
     game marker, not decoration, and re-tinting it per theme would make the
     same badge mean something different on each. */
  --shadow-aura: ${dark ? '#a855f7' : '#7e22ce'};
  --shadow-aura-deep: ${dark ? '#6d28d9' : '#4c1d95'};
  --shadow-ink: ${dark ? '#1a0b2e' : '#2e1065'};
}
`;
}

console.log(report.join('\n'));
if (failures.length) {
  console.error('\nCONTRAST FAILURES:\n' + failures.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}

writeFileSync(OUT, css);
console.log(`\nwrote ${OUT} — ${THEMES.length} themes, every pairing clears its target`);
