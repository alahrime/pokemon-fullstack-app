/**
 * Resolve a CSS colour expression to a concrete `rgb()` string.
 *
 * The heatmap ramp in lib/engine.ts emits theme-aware expressions like
 * `color-mix(in srgb, var(--color-accent) 62%, var(--color-neutral-200))`.
 * The DOM resolves those natively; WebGL cannot. Rather than duplicating the
 * ramp in JS (and letting the two drift), we hand the expression back to the
 * browser and read what it computed.
 *
 * Results are cached per theme — the cache key includes the current
 * `data-theme`, so a theme swap transparently produces a fresh palette.
 */

const cache = new Map<string, [number, number, number]>();
let probe: HTMLElement | null = null;

function getProbe(): HTMLElement {
  if (probe) return probe;
  probe = document.createElement('span');
  probe.style.display = 'none';
  probe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(probe);
  return probe;
}

function currentTheme(): string {
  return document.documentElement.getAttribute('data-theme') ?? 'hud';
}

/** Returns linear-ish sRGB components in 0..1, ready for THREE.Color.setRGB. */
export function resolveCssColor(expr: string): [number, number, number] {
  const key = `${currentTheme()}::${expr}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const el = getProbe();
  el.style.color = '';
  el.style.color = expr;
  const computed = getComputedStyle(el).color;

  const m = computed.match(/-?[\d.]+/g);
  let rgb: [number, number, number] = [1, 0, 0];
  if (m && m.length >= 3) {
    // getComputedStyle returns 0-255 for rgb() and 0-1 for color(srgb ...).
    const isUnit = computed.startsWith('color(');
    const d = isUnit ? 1 : 255;
    rgb = [Number(m[0]) / d, Number(m[1]) / d, Number(m[2]) / d];
  }
  cache.set(key, rgb);
  return rgb;
}

/** Clear the memo — call after a theme swap if colours look stale. */
export function clearColorCache(): void {
  cache.clear();
}

/** Feature-detect WebGL so the 3D view can degrade to the 2D grid. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}
