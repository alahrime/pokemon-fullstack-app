import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderApp } from '../../test/render';
import { RulerView } from '../detail/RulerView';
import type { RulerData } from '../../lib/engine';
import { opponentInfo, rulersFor } from '../../lib/engine';

/**
 * The damage ruler's structure, which its whole design rests on.
 *
 * jsdom lays nothing out, so none of this asserts appearance — the geometry
 * (bands tiling the field exactly, the tick landing on the band boundary, the
 * marker flag staying inside the track at both extremes) was measured in the
 * browser at 1280 and 375, in a dark theme and a light one. What is worth
 * holding here is the structure the CSS keys off, because a renamed attribute
 * would silently drop the styling and still render something.
 */

const ruler = (over: Partial<RulerData> = {}): RulerData => ({
  title: 'Counter → Lickilicky',
  sub: '2-turn · 8 power · target def 126.9',
  unit: 'atk',
  badge: '1 / 2 breakpoints',
  note: 'Bands are damage per use',
  min: '101.7',
  max: '114.3',
  bands: [
    { label: '8 dmg', start: 0, width: 6.7, active: true },
    { label: '9 dmg', start: 6.7, width: 93.3, active: false },
  ],
  ticks: [{ pos: 6.7 }],
  youPos: 0,
  youLabel: '101.68',
  flat: false,
  ...over,
});

const css = readFileSync('src/styles/components.css', 'utf8');

describe('the ruler renders the two-level system', () => {
  it('marks exactly the occupied level, and leaves the other unmarked', () => {
    const { container } = renderApp(<RulerView rulers={[ruler()]} />);
    const bands = [...container.querySelectorAll('.rv-band')];
    expect(bands).toHaveLength(2);
    expect(bands.filter((b) => b.hasAttribute('data-active'))).toHaveLength(1);
    expect(bands[0].hasAttribute('data-active')).toBe(true);
  });

  it('places levels, transitions and the marker from the data, not from CSS', () => {
    const { container } = renderApp(<RulerView rulers={[ruler()]} />);
    const band = container.querySelector('.rv-band') as HTMLElement;
    expect(band.style.getPropertyValue('--start')).toBe('0%');
    expect(band.style.getPropertyValue('--w')).toBe('6.7%');
    expect((container.querySelector('.rv-tick') as HTMLElement).style.getPropertyValue('--pos')).toBe('6.7%');
    expect((container.querySelector('.rv-you') as HTMLElement).style.getPropertyValue('--pos')).toBe('0%');
  });

  it('anchors the marker flag at whichever end it is against', () => {
    // Centred on the marker it hangs off the axis; "YOU 101.68" was cut in
    // half at 0%. Only the extremes are anchored — the middle stays centred.
    const at = (youPos: number) => {
      const { container } = renderApp(<RulerView rulers={[ruler({ youPos })]} />);
      return container.querySelector('.rv-you')!.getAttribute('data-edge');
    };
    expect(at(0)).toBe('start');
    expect(at(99.6)).toBe('end');
    expect(at(50)).toBeNull();
  });

  it('flags the flat case, which is the common one', () => {
    const flat = ruler({
      flat: true,
      badge: 'No breakpoint in reach',
      bands: [{ label: '3 dmg', start: 0, width: 100, active: true }],
      ticks: [],
    });
    const { container } = renderApp(<RulerView rulers={[flat]} />);
    expect(container.querySelector('.rv-cell')!.hasAttribute('data-flat')).toBe(true);
    expect(container.querySelectorAll('.rv-tick')).toHaveLength(0);
    // The lone level still reports as occupied — it is the state you are in —
    // so the quieting has to come from the flat marker, not from unsetting it.
    expect(container.querySelector('.rv-band')!.hasAttribute('data-active')).toBe(true);
  });

  it('withdraws the accent when there is no finding to announce', () => {
    // The styling rule that keeps a full-width lit slab off the majority case.
    expect(css).toMatch(/\.rv-cell\[data-flat\] \.rv-band\[data-active\]\s*\{/);
    const at = css.indexOf('.rv-cell[data-flat] .rv-band[data-active] {');
    expect(css.slice(at, at + 400)).toMatch(/box-shadow:\s*none/);
  });

  it('drives real data without throwing, and survives an empty set', () => {
    const real = rulersFor('medicham', { a: 0, d: 15, s: 15 }, 'great', opponentInfo('lickilicky', 'great'));
    expect(real.length).toBeGreaterThan(0);
    const { container } = renderApp(<RulerView rulers={real} />);
    expect(container.querySelectorAll('.rv-cell').length).toBe(real.length);
    expect(() => renderApp(<RulerView rulers={[]} />)).not.toThrow();
  });
});
