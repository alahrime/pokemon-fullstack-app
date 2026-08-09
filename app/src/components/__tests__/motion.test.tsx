import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { SegGroup, SegButton } from '../Seg';
import { RankingsScreen } from '../../screens/RankingsScreen';
import { BestTeams } from '../BestTeams';

/**
 * Motion: markers that travel, rows that arrive, presses that are felt.
 *
 * The engaged state used to be painted by whichever option was active, so
 * changing page or category snapped it from one box to another. It is now one
 * element that slides — measured from the DOM, because the options are
 * content-sized.
 *
 * jsdom lays nothing out and paints nothing, so what is asserted here is the
 * two things it *can* settle: the structure that carries the animation, and
 * the fallback for when no measurement exists. The travel itself was measured
 * in the browser — the marker lands on its option with delta 0 on both axes.
 */

const motion = readFileSync('src/styles/motion.css', 'utf8');
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the travelling marker', () => {
  it('falls back to the option painting itself when nothing can be measured', () => {
    // Every element is 0x0 in jsdom, which is the same position the real app is
    // in for one frame before layout. Publishing no marker then is what stops
    // the engaged state being invisible while it waits to be measured.
    const { container } = renderApp(
      <SegGroup>
        <SegButton active onClick={() => {}}>Overall</SegButton>
        <SegButton active={false} onClick={() => {}}>Leads</SegButton>
      </SegGroup>,
    );
    expect(container.querySelector('.seg-marker')).toBeNull();
    expect(container.querySelector('.seg-group')!.classList.contains('has-marker')).toBe(false);
    // …and the active button keeps its own fill, which the stylesheet only
    // removes once a marker exists to replace it.
    expect(container.querySelector('.seg-btn.is-active')).toBeTruthy();
  });

  it('only strips the option\'s own fill once a marker is there to replace it', () => {
    const css = strip(motion);
    expect(css).toMatch(/\.seg-group\.has-marker\s+\.seg-btn\.is-active\s*\{[^}]*background:\s*transparent/);
    // Unconditionally would leave the active segment unpainted in jsdom, with
    // reduced motion, and for the frame before the first measurement.
    expect(css).not.toMatch(/^\.seg-btn\.is-active\s*\{[^}]*background:\s*transparent/m);
  });

  it('animates position rather than redrawing, and only position', () => {
    const marker = strip(motion).match(/\.seg-marker\s*\{[^}]*\}/)![0];
    expect(marker).toMatch(/transition:[^;]*transform var\(--dur-3\)/);
    expect(marker).toMatch(/transition:[^;]*width var\(--dur-3\)/);
    // position:absolute keeps it out of the flex flow, so adding it cannot
    // shift the buttons it sits behind.
    expect(marker).toMatch(/position:\s*absolute/);
    expect(marker).toMatch(/pointer-events:\s*none/);
  });

  it('puts the pager rail behind the numbers the same way', () => {
    const css = strip(motion);
    expect(css).toMatch(/\.pager-rail\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.pager-nums\.has-marker\s+\.pager-num\.is-on::after\s*\{\s*opacity:\s*0/);
  });
});

describe('rows arriving', () => {
  it('deals the rankings rather than swapping them', () => {
    const { container } = renderApp(<RankingsScreen />);
    const body = container.querySelector('tbody')!;
    expect(body.classList.contains('stagger-drop-rows')).toBe(true);
    // Each row carries its own position, which is what staggers the arrival.
    const rows = [...container.querySelectorAll('.rank-row')];
    expect(rows[0].getAttribute('style')).toContain('--row-i: 0');
    expect(rows[3].getAttribute('style')).toContain('--row-i: 3');
  });

  it('replays the arrival when the page changes, not only on first load', () => {
    // React only re-runs a CSS animation if the node is new, so the body is
    // keyed. Without this a new page of rows appears fully formed.
    const { container } = renderApp(<RankingsScreen />);
    const before = container.querySelector('tbody');
    fireEvent.click([...container.querySelectorAll('.pager-num')].find((n) => n.textContent === '3')!);
    expect(container.querySelector('tbody')).not.toBe(before);
  });

  it('caps the stagger so a hundred rows do not take a minute to land', () => {
    const css = strip(motion);
    for (const rule of ['.stagger-drop > *', '.stagger-drop-rows > tr > *']) {
      const body = css.match(new RegExp(`\\${rule.replace(/[*>]/g, (m) => '\\' + m)}\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(body, rule).toMatch(/animation-delay:\s*calc\(min\(/);
      // Scaled by --motion-scale, which is the one dial reduced motion turns.
      expect(body, rule).toMatch(/var\(--motion-scale\)/);
    }
  });
});

describe('reduced motion', () => {
  it('collapses all of it from one place, so new animation cannot escape it', () => {
    // Both switches zero --motion-scale and force every duration, which is why
    // none of the rules added here need their own reduced-motion branch.
    expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*?--motion-scale:\s*0/);
    expect(tokens).toMatch(/\[data-motion='off'\][\s\S]*?--motion-scale:\s*0/);
    expect(tokens).toMatch(/\[data-motion='off'\][\s\S]*?transition-duration:\s*1ms\s*!important/);
  });
});

describe('a page of teams', () => {
  it('re-slices when the page size changes on the first page', () => {
    // Regression: the slice was memoised without pageSize, so changing 25 to 50
    // while already on page 1 left 25 teams on screen under a pager reading
    // "1–50". Nothing else in the deps had changed.
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={() => {}} />);
    const rows = () => container.querySelectorAll('.bt-row').length;
    const first = rows();
    expect(first).toBeGreaterThan(0);
    fireEvent.change(container.querySelector('.pager-size-input')!, { target: { value: '50' } });
    expect(rows()).toBeGreaterThan(first);
    expect(container.querySelector('.pager-range')!.textContent).toContain('1–50');
  });
});
