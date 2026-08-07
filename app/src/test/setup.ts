import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement layout, so anything that measures returns zeros.
 * Components here read `getBoundingClientRect` for tilt, drag edges and
 * marker placement; stubbing it to a plausible box keeps those paths
 * exercisable rather than silently short-circuiting on a 0x0 rect.
 */
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, toJSON: () => ({}) };
};

// Used by the card tilt and the board auto-scroll.
window.scrollTo = () => {};
window.scrollBy = () => {};
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
}

/**
 * jsdom implements no SVG geometry, so a path cannot report its own length.
 * BattleTimeline uses it to set up the line-drawing animation. Stubbed rather
 * than guarded in the component: the component is correct, the environment is
 * the thing missing a feature, and adding a runtime check there would be
 * carrying test scaffolding in shipped code.
 */
// @ts-expect-error — jsdom's SVGElement lacks the geometry interface entirely.
SVGElement.prototype.getTotalLength = SVGElement.prototype.getTotalLength ?? (() => 100);
// @ts-expect-error — same.
SVGElement.prototype.getPointAtLength = SVGElement.prototype.getPointAtLength ?? (() => ({ x: 0, y: 0 }));

/**
 * jsdom implements no pointer capture. The IV track uses it so a drag survives
 * leaving the element, which is correct behaviour — the environment simply has
 * no such concept, so it is stubbed rather than removed from the component.
 */
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}
