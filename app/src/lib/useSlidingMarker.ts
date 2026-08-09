import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Track the active child of a group so one marker can travel between options.
 *
 * The engaged state in this app is a lit fill or a lit rail, and it used to be
 * painted by the active button itself — so changing page or category snapped it
 * from one box to another with nothing in between. Moving it to a single
 * element that slides is the difference between a readout updating and a
 * control responding.
 *
 * Measures rather than computes: the options are content-sized (a two-digit
 * page is narrower than a three-digit one, "Consistency" wider than "Leads"),
 * so the marker's geometry has to come from the DOM.
 *
 * There is no dependency array. It re-measures after every render and only
 * commits a changed box, which covers the cases a dep list keeps missing — the
 * page run sliding, a font finishing loading, a container query reflowing the
 * group — without a render loop.
 */
export type MarkerBox = { x: number; w: number };

export function useSlidingMarker<T extends HTMLElement>(activeSelector: string) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<MarkerBox | null>(null);

  const measure = useCallback(() => {
    const host = ref.current;
    const el = host?.querySelector<HTMLElement>(activeSelector);
    // offsetWidth is 0 in jsdom and before layout. Publishing no box then lets
    // the caller fall back to painting the active option itself, so the
    // engaged state is never invisible while waiting for a measurement.
    if (!host || !el || el.offsetWidth === 0) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    // Rects, not offsetLeft/offsetWidth: those round to whole pixels, which
    // left the fill up to 0.41px off its button — a visible sliver of hairline
    // border down one edge. The marker's containing block is the host's
    // padding box, so the border is subtracted and the scroll offset added
    // back (these groups scroll sideways on a narrow screen).
    const hostRect = host.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const borderLeft = parseFloat(getComputedStyle(host).borderLeftWidth) || 0;
    const next = {
      x: rect.left - hostRect.left - borderLeft + host.scrollLeft,
      w: rect.width,
    };
    setBox((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
  }, [activeSelector]);

  useLayoutEffect(measure);

  useEffect(() => {
    const host = ref.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    for (const child of host.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, box };
}
