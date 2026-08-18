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
const components = readFileSync('src/styles/components.css', 'utf8');
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

describe('rows gel into place', () => {
  const css = () => strip(motion);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = (sel: string) => css().match(new RegExp(`${esc(sel)}\\s*\\{[^}]*\\}`))?.[0] ?? '';

  it('cascades every table, not only the two that opted in', () => {
    // The cascade used to need a class on the tbody and a --row-i per row.
    // Nine of the app's eleven tables had neither and snapped in as a block.
    expect(css()).toMatch(/\.table tbody > tr > \*\s*\{[^}]*animation:\s*gel-in/);
    // The index comes from the row's own position, which is what makes it
    // apply with no markup at all.
    expect(css()).toMatch(/\.table tbody > tr:nth-child\(1\)[^{]*\{[^}]*--row-i:\s*0/);
    expect(css()).toMatch(/\.table tbody > tr:nth-child\(18\)[^{]*\{[^}]*--row-i:\s*17/);
  });

  it('springs rather than slides — it overshoots and settles', () => {
    for (const sel of ['.table tbody > tr > *', '.stagger-drop > *', '.stagger-drop-rows > tr > *']) {
      expect(rule(sel), sel).toMatch(/animation:\s*gel-in/);
      // The overshoot lives in the token, so retuning the spring retunes every
      // row in the app at once.
      expect(rule(sel), sel).toMatch(/var\(--ease-spring\)/);
    }
    // …and that token is an overshoot: the third control point passes 1.
    expect(strip(tokens)).toMatch(/--ease-spring:\s*cubic-bezier\([^)]*?,\s*1\.\d+\s*,/);
  });

  it('caps the run and scales it, so a long page still lands and motion-off skips it', () => {
    for (const sel of ['.table tbody > tr > *', '.stagger-drop > *']) {
      expect(rule(sel), sel).toMatch(/animation-delay:\s*calc\(min\(/);
      expect(rule(sel), sel).toMatch(/var\(--motion-scale\)/);
    }
    // Rows past the cap default to the last step rather than to zero, or the
    // hundredth row would arrive before the second.
    expect(css()).toMatch(/\.table tbody > tr > \*\s*\{[^}]*var\(--row-i,\s*18\)/);
  });

  it('steps far enough apart to be seen as a cascade at all', () => {
    // This is the regression, not a preference: at 18ms consecutive rows were
    // roughly one frame apart on a 60Hz screen, so a table read as a single
    // block fading in — which is what it looked like, and what was reported.
    const step = Number(strip(tokens).match(/--row-step:\s*(\d+)ms/)![1]);
    expect(step).toBeGreaterThanOrEqual(40);
    // And the run still has to end: a hundred rows at 55ms would be 5.5s.
    const run = Number(strip(tokens).match(/--row-run:\s*(\d+)ms/)![1]);
    expect(run).toBeLessThanOrEqual(1200);
    expect(run / step).toBeGreaterThan(8);
  });

  it('replays where the list re-orders, or the arrival is seen once and never again', () => {
    // React reuses keyed rows across a sort, so nothing remounts and no
    // animation restarts. The tbody carries the ordering in its key instead.
    const moves = readFileSync('src/screens/MovesScreen.tsx', 'utf8');
    expect(moves).toMatch(/<tbody[^>]*key=\{`\$\{kind\}-\$\{sort\.key\}-\$\{sort\.desc\}-\$\{page\}`\}/);
    const heat = readFileSync('src/screens/detail/HeatmapView.tsx', 'utf8');
    expect(heat).toMatch(/<tbody key=\{from\}>/);
    // Cores renders its records as list items rather than a table, and had the
    // same problem: switching sort reused every node, so the list sat still
    // while the tables flowed.
    const cores = readFileSync('src/screens/CoresScreen.tsx', 'utf8');
    expect(cores).toMatch(/className="core-list stagger-drop" key=\{/);
    expect(cores).toMatch(/className="pillar-list stagger-drop" key=\{/);
  });

  it('flows a screen\'s title and blurb in ahead of them', () => {
    const flow = rule('.text-flow > *');
    expect(flow).toMatch(/animation:\s*text-flow/);
    expect(flow).toMatch(/var\(--motion-scale\)/);
    expect(css()).toMatch(/@keyframes text-flow[\s\S]*?filter:\s*blur\(/);
  });
});

describe('the form toggle as a thrown switch', () => {
  /**
   * The two poles are still two buttons — that is what carries `aria-pressed`
   * and the disabled state — but the engaged fill is one block on the channel
   * that travels between them. jsdom computes no `:has()` and no transform, so
   * what is held here is the rule itself; the travel was measured in the
   * browser, where the block lands on the second pole with delta 0 (thumb left
   * 174px, pole left 174px, both 170px wide).
   */
  const block = strip(components).match(/\.form-toggle::before\s*\{[^}]*\}/)![0];

  it('paints the engaged state once, on the channel, not on each pole', () => {
    expect(block).toMatch(/position:\s*absolute/);
    // One pole wide, so a 100% throw lands it exactly on the other.
    expect(block).toMatch(/width:\s*calc\(50% - 3px\)/);
    expect(strip(components)).toMatch(
      /\.form-toggle:has\(\.form-opt:nth-child\(2\)\.is-active\)::before\s*\{\s*transform:\s*translateX\(100%\)/,
    );
  });

  it('animates the throw off the duration tokens, so motion-off drops it', () => {
    expect(block).toMatch(/transition:[\s\S]*?transform var\(--dur-3\)/);
    // A hardcoded ms here would keep sliding with motion turned off — every
    // other transition in the app scales through --motion-scale.
    expect(block).not.toMatch(/transition:[\s\S]*?\d+ms/);
  });

  it('leaves an unreachable pole unlit rather than advertising it', () => {
    expect(strip(components)).toMatch(
      /\.form-toggle:has\(\.form-opt:nth-child\(2\):disabled\)::before\s*\{[^}]*box-shadow/,
    );
  });

  it('does not also chamfer the label, which would be a third nested notch', () => {
    // The channel and the block are both clipped; .form-opt is deliberately
    // out of the shared clip-path set.
    const clipSet = strip(components).match(/[^}]*\{\s*clip-path: polygon\(9px 0[^}]*\}/g) ?? [];
    expect(clipSet.some((r) => /\.form-opt\s*[,{]/.test(r))).toBe(false);
    expect(strip(components)).toMatch(/\.form-toggle\s*\{[^}]*clip-path:\s*polygon\(9px 0/);
  });
});

describe('the heatmap legend overlay', () => {
  it('never eats a click meant for the cell underneath it', () => {
    // It covers the high-attack/high-defense corner, which is the part of the
    // field this view had always kept clear. Taking no pointer events is what
    // makes that acceptable: the reading is hidden, the control is not.
    const panel = strip(components).match(/\.hv-legend-panel\s*\{[^}]*\}/)![0];
    expect(panel).toMatch(/pointer-events:\s*none/);
    expect(panel).toMatch(/position:\s*absolute/);
    // Above the grid — a selected cell lifts itself to 2.
    expect(Number(panel.match(/z-index:\s*(\d+)/)![1])).toBeGreaterThan(2);
  });

  it('has a corner to move to, measured from the field rather than the wrapper', () => {
    const css = strip(components);
    expect(css).toMatch(/\.hv-legend-panel\s*\{[^}]*right:\s*4px/);
    // The other corner has to clear the inset the first one set, or the panel
    // spans both edges and never appears to move.
    expect(css).toMatch(/\.hv-legend-panel\.is-left\s*\{[^}]*right:\s*auto[^}]*left:\s*4px/);
    // Absolute against the drawn field: anchored to .hv-plot instead, the left
    // corner would land over the DEF axis labels rather than on the cells.
    expect(css).toMatch(/\.hv-grid,\s*\n?\s*\.hv-terrain-canvas\s*\{\s*position:\s*relative/);
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
