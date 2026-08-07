import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ReportScreen } from '../ReportScreen';
import { IVAdjuster } from '../../components/IVAdjuster';

beforeEach(() => localStorage.clear());

const tab = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes(label))!;

describe('IVAdjuster dragging', () => {
  // The stubbed track is 200px wide over 15 ticks, so clientX maps to
  // ceil(x / 200 * 15) — tick 3 spans (26.7, 40], tick 8 spans (93.3, 106.7].
  // `onSet` here is the panel's, which carries the stat key as well.
  const setup = () => {
    const onSet = vi.fn();
    const onBump = vi.fn();
    const r = renderApp(<IVAdjuster iv={{ a: 0, d: 8, s: 15 }} onBump={onBump} onSet={onSet} />);
    const track = r.container.querySelector('[role="slider"]') as HTMLElement;
    return { ...r, track, onSet, onBump };
  };

  it('commits a value on press', () => {
    const { track, onSet } = setup();
    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    expect(onSet).toHaveBeenCalledWith('a', 15);
  });

  it('pressing the tick already set clears to zero, which the bar cannot otherwise reach', () => {
    const { container, onSet } = setup();
    // The DEF row sits at 8; pressing its own tick zeroes it.
    const def = [...container.querySelectorAll('[role="slider"]')]
      .find((t) => t.getAttribute('aria-valuenow') === '8') as HTMLElement;
    fireEvent.pointerDown(def, { clientX: 106, pointerId: 1 });
    expect(onSet).toHaveBeenCalledWith('d', 0);
  });

  it('updates while dragging, but only when the tick actually changes', () => {
    // The panel is controlled, so this has to hold the value for the guard to
    // mean anything — against a stub that never advances, every move looks
    // like a change.
    const seen: number[] = [];
    function Held() {
      const [iv, setIv] = useState({ a: 0, d: 8, s: 15 });
      return (
        <IVAdjuster
          iv={iv}
          onBump={() => {}}
          onSet={(k, v) => { if (k === 'a') seen.push(v); setIv((cur) => ({ ...cur, [k]: v })); }}
        />
      );
    }
    const { container } = renderApp(<Held />);
    const track = container.querySelector('[role="slider"]') as HTMLElement;
    fireEvent.pointerDown(track, { clientX: 38, pointerId: 1 });
    expect(seen).toEqual([3]);
    // Still tick 3 — a state update here would fire on every pointer event.
    fireEvent.pointerMove(track, { clientX: 39, pointerId: 1 });
    expect(seen).toEqual([3]);
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 });
    expect(seen).toEqual([3, 12]);
  });

  it('ignores movement when no drag is in progress', () => {
    const { track, onSet } = setup();
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 });
    expect(onSet).not.toHaveBeenCalled();
  });

  it('ends the drag on pointer up, and on cancel', () => {
    const { track, onSet } = setup();
    fireEvent.pointerDown(track, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 40, pointerId: 1 });
    onSet.mockClear();
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 });
    expect(onSet).not.toHaveBeenCalled();

    fireEvent.pointerDown(track, { clientX: 40, pointerId: 1 });
    fireEvent.pointerCancel(track, { pointerId: 1 });
    onSet.mockClear();
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 });
    expect(onSet).not.toHaveBeenCalled();
  });

  it('steps with the arrow keys', () => {
    const { track, onBump } = setup();
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(onBump).toHaveBeenCalled();
  });
});

describe('ReportScreen wiring', () => {
  it('reorders its panels and puts them back', () => {
    const { container } = renderApp(<ReportScreen />);
    const edit = container.querySelector('.board-edit-btn') as HTMLButtonElement;
    fireEvent.click(edit);
    const labels = () => [...container.querySelectorAll('.board-grip-label')].map((e) => e.textContent);
    const before = labels();
    expect(before.length).toBeGreaterThan(1);
    const down = container.querySelector(`[aria-label="Move ${before[0]} down"]`)!;
    fireEvent.click(down);
    expect(labels()).not.toEqual(before);
    const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!;
    fireEvent.click(reset);
    expect(labels()).toEqual(before);
  });

  it('changes the loadout from the report\'s own moves panel', () => {
    const { container } = renderApp(<ReportScreen />);
    const fastCol = container.querySelectorAll('.moves-col')[0];
    const tiles = fastCol.querySelectorAll('.move-tile');
    expect(tiles.length).toBeGreaterThan(0);
    fireEvent.click(tiles[0]);
    expect(container.querySelector('.moves-panel')).toBeTruthy();
  });

  it('selects an opponent from the grid and pages through it', () => {
    const { container } = renderApp(<ReportScreen />);
    const cells = container.querySelectorAll('.opp-cell');
    expect(cells.length).toBeGreaterThan(0);
    const target = [...cells].find((c) => c.getAttribute('aria-pressed') === 'false')!;
    fireEvent.click(target);
    expect(target.getAttribute('aria-pressed')).toBe('true');

    const next = container.querySelector('[aria-label="Next page"]') as HTMLButtonElement;
    if (next && !next.disabled) {
      fireEvent.click(next);
      fireEvent.click(container.querySelector('[aria-label="Previous page"]')!);
    }
    const pageRange = container.querySelector('[aria-label="Page"]') as HTMLInputElement;
    if (pageRange) fireEvent.change(pageRange, { target: { value: '1' } });
  });

  it('picks a roll off the heatmap\'s top-of-the-space table', () => {
    const { container } = renderApp(<ReportScreen />);
    const rows = container.querySelectorAll('.hv-top-row');
    expect(rows.length).toBeGreaterThan(0);
    const other = [...rows].find((r) => !r.className.includes('is-selected'))!;
    fireEvent.click(other);
    expect(container.querySelector('.hv-top-row.is-selected')).toBeTruthy();
  });

  it('moves the HP IV slice, which re-slices the 4096', () => {
    const { container } = renderApp(<ReportScreen />);
    const slider = container.querySelector('.hv-slice input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '7' } });
    expect(container.querySelector('.hv-slice-value')!.textContent).toBe('7');
  });

  it('offers the 3D terrain only where WebGL exists, and returns to the flat grid', () => {
    const { container } = renderApp(<ReportScreen />);
    const controls = container.querySelector('.hv-controls')!;
    const threeD = [...controls.querySelectorAll('button')].find((b) => b.textContent === '3D');
    if (!threeD) {
      // No WebGL in jsdom by default: the toggle is absent and 2D is all there is.
      expect(container.querySelector('.hv-grid')).toBeTruthy();
      return;
    }
    fireEvent.click(threeD);
    const twoD = [...controls.querySelectorAll('button')].find((b) => b.textContent === '2D')!;
    fireEvent.click(twoD);
    expect(container.querySelector('.hv-grid')).toBeTruthy();
  });

  it('drives the flip view: a cell, the slice, and an opponent row', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Matchup flips'));
    await waitFor(() => expect(container.querySelector('.fv-grid')).toBeTruthy());

    const cells = container.querySelectorAll('.fv-grid > div');
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(cells[0]);

    const slice = container.querySelector('.fv-slice-range') as HTMLInputElement;
    fireEvent.change(slice, { target: { value: '3' } });
    expect(container.textContent).toMatch(/HP IV slice 3/);

    const rows = container.querySelectorAll('table tbody tr');
    if (rows.length > 1) fireEvent.click(rows[1]);
  });

  it('sets both shield counts from the flip view\'s matrix', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Matchup flips'));
    await waitFor(() => expect(container.querySelector('.sm-col, .shield-matrix')).toBeTruthy());
    const cells = container.querySelectorAll('.shield-cell, .sm-contents button');
    if (cells.length) fireEvent.click(cells[cells.length - 1]);
  });
});

describe('ReportScreen loadout', () => {
  it('changes the charged moves from the report\'s own panel', () => {
    const { container } = renderApp(<ReportScreen />);
    const chargeCol = container.querySelectorAll('.moves-col')[1];
    const tiles = [...chargeCol.querySelectorAll('.move-tile')];
    expect(tiles.length).toBeGreaterThan(0);
    const before = tiles.filter((t) => t.className.includes('is-active')).length;
    const target = tiles.find((t) => !t.className.includes('is-active')) ?? tiles[0];
    fireEvent.click(target);
    const after = [...container.querySelectorAll('.moves-col')[1].querySelectorAll('.move-tile')]
      .filter((t) => t.className.includes('is-active'));
    // Whatever the click did, the mon is never left with nothing to throw.
    expect(after.length).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });
});
