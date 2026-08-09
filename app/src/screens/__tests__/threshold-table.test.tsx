import { describe, it, expect } from 'vitest';
import { renderApp } from '../../test/render';
import { ThresholdTable } from '../detail/ThresholdTable';
import type { ThresholdRow } from '../../lib/engine';
import { bpRowsFor, opponentInfo } from '../../lib/engine';

/**
 * The threshold table's structure.
 *
 * The column that carries the table is the last one: a gauge pinned at the
 * threshold with the signed gap beside it. That gap is computed here — `have`
 * and `at` were both on the row and never subtracted — so it is worth testing
 * as arithmetic rather than as decoration.
 *
 * Appearance is not asserted; jsdom lays nothing out. The gauge geometry (fill
 * starting exactly at the centre pin, staying inside the track, scaling with
 * the gap) was measured in the browser, in a dark theme and a light one, at
 * 1280 and at 375 where the table scrolls inside its container.
 */

const row = (over: Partial<ThresholdRow> = {}): ThresholdRow => ({
  kind: 'Breakpoint',
  move: 'Counter (2t)',
  needLabel: 'atk 102.52',
  need: 102.52,
  spread: '1/15/15',
  dmgLabel: '9 dmg',
  have: 101.68,
  at: 102.52,
  met: false,
  near: true,
  ...over,
});

const render = (r: ThresholdRow) => renderApp(<ThresholdTable rows={[r]} />).container;

describe('the threshold table shows the gap, not just the verdict', () => {
  it('subtracts the roll from the requirement, signed and in the right unit', () => {
    expect(render(row()).querySelector('.thr-gap')!.textContent).toBe('−0.84atk');
    const over = render(row({ kind: 'Bulkpoint', have: 178.64, at: 160.3, met: true, near: false }));
    expect(over.querySelector('.thr-gap')!.textContent).toBe('+18.34def');
  });

  it('says so plainly when the roll sits exactly on the threshold', () => {
    // Common: the first breakpoint of a move is often the bottom of the range.
    const c = render(row({ have: 102.52, at: 102.52, met: true, near: false }));
    expect(c.querySelector('.thr-gap')!.textContent).toBe('±0atk');
  });

  it('points the gauge the way the gap runs', () => {
    expect(render(row()).querySelector('.thr-gauge-fill')!.getAttribute('data-dir')).toBe('short');
    expect(
      render(row({ have: 200, at: 160, met: true, near: false })).querySelector('.thr-gauge-fill')!.getAttribute('data-dir'),
    ).toBe('over');
  });

  it('clamps the gauge so one freak row cannot flatten the rest', () => {
    // Half the track is 50%; the span is +/-15%, so anything past that pins.
    const wild = render(row({ have: 400, at: 100, met: true, near: false }));
    const mag = (wild.querySelector('.thr-gauge-fill') as HTMLElement).style.getPropertyValue('--mag');
    expect(parseFloat(mag)).toBeCloseTo(50, 5);
    const half = render(row({ have: 107.5, at: 100, met: true, near: false }));
    expect(parseFloat((half.querySelector('.thr-gauge-fill') as HTMLElement).style.getPropertyValue('--mag'))).toBeCloseTo(25, 5);
  });

  it('names the state on the row, so the styling has one thing to key off', () => {
    expect(render(row({ met: true, near: false })).querySelector('.thr-row')!.getAttribute('data-state')).toBe('met');
    expect(render(row({ met: false, near: true })).querySelector('.thr-row')!.getAttribute('data-state')).toBe('near');
    expect(render(row({ met: false, near: false })).querySelector('.thr-row')!.getAttribute('data-state')).toBe('out');
  });

  it('tells damage dealt from damage taken with a glyph, not only a word', () => {
    const bp = render(row());
    const bulk = render(row({ kind: 'Bulkpoint' }));
    expect(bp.querySelector('.thr-kind svg')).toBeTruthy();
    expect(bulk.querySelector('.thr-kind svg')).toBeTruthy();
    expect(bp.querySelector('.thr-kind')!.classList.contains('is-bulk')).toBe(false);
    expect(bulk.querySelector('.thr-kind')!.classList.contains('is-bulk')).toBe(true);
  });

  it('breaks the IV spread into its three values', () => {
    const c = render(row({ spread: '1/15/14' }));
    expect([...c.querySelectorAll('.thr-iv')].map((e) => e.textContent)).toEqual(['1', '15', '14']);
  });

  it('stays inside a horizontal scroller, which is what keeps it off the page edge', () => {
    // The table is ~719px against a 283px column on a phone.
    const c = render(row());
    expect(c.querySelector('.table-scroll > table.thr')).toBeTruthy();
  });

  it('drives real rows without throwing, and survives an empty set', () => {
    const real = bpRowsFor('umbreon', { a: 0, d: 15, s: 15 }, 'great', opponentInfo('forretress', 'great'));
    expect(real.length).toBeGreaterThan(0);
    const { container } = renderApp(<ThresholdTable rows={real} />);
    expect(container.querySelectorAll('.thr-row').length).toBe(real.length);
    expect(() => renderApp(<ThresholdTable rows={[]} />)).not.toThrow();
  });
});
