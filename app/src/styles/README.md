# Design system

Two themes over one token layer. A theme swap is a single attribute change on
`<html>` — no rebuild, no conditional rendering, no component knows which theme
is active.

## Files

| File | Contains | Edit it when |
|---|---|---|
| `tokens.css` | Primitives: spacing, type scale, motion durations/easings, geometry. **No colour.** | Retuning rhythm, density, or how fast things feel |
| `themes.css` | Colour ramps + semantic aliases, per `[data-theme]` | Changing a palette, adding a theme |
| `components.css` | Component classes, built from semantic tokens only | Adding or restyling a component |
| `motion.css` | Keyframes + reveal utilities | Adding an animation |
| `hud.css` | Chrome that only appears in the HUD theme | Tuning the tactical overlay |

`modernist.css` is a deprecated signpost; nothing imports it.

Load order is fixed in `src/index.css` and matters — later layers consume
earlier ones.

## The ramp contract

Every ramp runs `100 → 900` in order of **increasing contrast against the page**,
not increasing lightness. On a light ground `100` is palest and `900` darkest;
on a dark ground that inverts.

This is what makes components theme-agnostic for free. A pairing like:

```css
.tag-accent { background: var(--color-accent-100); color: var(--color-accent-800); }
```

reads as "quiet fill, loud text" and stays legible in both themes with no
override. The same holds for the heatmap ramp computed in `lib/engine.ts` —
`tierColor()` walks `neutral-200 → accent-700`, which is always low → high
intensity regardless of ground.

**If a component needs a per-theme override, the ramp is wrong.** Fix the ramp
rather than adding the override.

## Semantic aliases

Components should reference these, not raw ramp steps:

`--surface-1/2/3`, `--surface-inverse`, `--text-inverse`, `--text-muted`,
`--text-faint`, `--color-on-accent`, `--rule-hairline`, `--rule-strong`,
`--focus-ring`, `--grid-line`, `--glow-accent`, `--glow-signal`,
`--font-numeric`, `--chrome-opacity`.

`--color-on-accent` matters: the old code used `--color-bg` as the foreground on
accent fills, which only worked because the ground was light.

## Adding a theme

1. Add a `:root[data-theme='yours']` block in `themes.css` defining **every**
   token the existing blocks define — the two current themes are at exact
   parity (59 tokens each) and new ones must match.
2. Add it to `THEMES` in `state/ThemeContext.tsx`.

Nothing else. There is a parity checker worth re-running after any token change;
it walks every `var(--x)` in `src/` and reports tokens undefined in either theme.

## Motion

`--motion-scale` is the master dial. Every duration is `calc(Nms * var(--motion-scale))`,
so setting it to `0` collapses all animation at the source. It's driven by:

- `@media (prefers-reduced-motion: reduce)` — automatic
- `:root[data-motion='off']` — the in-app toggle

Transitions still "complete" when disabled, they just do so instantly, so no
state logic depends on `transitionend` timing.

The 4096-cell heatmap reveal is pure CSS: each cell carries a `--cell-delay`
derived from its grid position, multiplied by `--stagger-step`. No timers, no
per-cell JavaScript — it stays on the compositor.

## HUD chrome

Everything in `hud.css` multiplies by `--chrome-opacity`, which the modernist
theme sets to `0`. HUD components stay mounted across a theme swap and simply
become invisible — identical layout, no reflow mid-transition.

## 3D

`components/Heatmap3D.tsx` renders the 4096-space as instanced terrain: the
plane is attack × defense, colour follows the selected metric, height is
normalised stat product.

Colours are **not** duplicated in JS. `lib/cssColor.ts` hands each
`color-mix(...)` expression back to the browser via a hidden probe element and
reads what it computed, caching per theme. The ramp in `lib/engine.ts` stays the
single source of truth.

three.js is ~900 kB, so the view is `React.lazy`-split and only fetched when the
user picks 3D. `hasWebGL()` gates the toggle; without a context the 2D grid is
the only option.
