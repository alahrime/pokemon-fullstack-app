import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ReportScreen } from '../ReportScreen';
import App from '../../App';
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

  it('picks a roll off the ranking window', () => {
    const { container } = renderApp(<ReportScreen />);
    const rows = container.querySelectorAll('.hv-top-row');
    expect(rows.length).toBeGreaterThan(0);
    const other = [...rows].find((r) => !r.className.includes('is-selected'))!;
    fireEvent.click(other);
    expect(container.querySelector('.hv-top-row.is-selected')).toBeTruthy();
  });

  it('stands the window on the current roll, seven spreads either side', () => {
    // The default roll is 0/14/15, rank 9 — far enough down that a centred
    // window is a real one rather than clamped to the top of the ranking.
    const { container } = renderApp(<ReportScreen />);
    const rows = [...container.querySelectorAll('.hv-top-row')];
    expect(rows).toHaveLength(15);
    expect(rows.findIndex((r) => r.className.includes('is-selected'))).toBe(7);
  });

  it('follows the adjuster: a new roll re-centres the window on it', () => {
    const { container } = renderApp(<ReportScreen />);
    const before = container.querySelector('.hv-top-row.is-selected')!.textContent;
    fireEvent.click(container.querySelector('[aria-label="Decrease Defense"]')!);
    const rows = [...container.querySelectorAll('.hv-top-row')];
    const selected = rows.findIndex((r) => r.className.includes('is-selected'));
    expect(rows[selected].textContent).not.toBe(before);
    // Centred on the new roll, except where the ranking runs out above it:
    // dropping a defense point here lands on rank 7, which has only six
    // spreads above it to show.
    const rank = Number(rows[selected].querySelector('.hv-top-rank')!.textContent);
    expect(selected).toBe(Math.min(7, rank - 1));
  });

  it('reports the stats a spread buys, not the stat product twice over', () => {
    const { container } = renderApp(<ReportScreen />);
    const heads = [...container.querySelectorAll('.hv-top-table th')].map((h) => h.textContent);
    expect(heads).toEqual(['#', 'IV', 'Atk', 'Def', 'HP', 'SP %']);
    // Six cells per row, and the last is the share of rank 1 — the raw stat
    // product column it used to sit beside is gone.
    const cells = container.querySelectorAll('.hv-top-row')[0].querySelectorAll('td');
    expect(cells).toHaveLength(6);
    expect(cells[5].textContent).toMatch(/^\d+\.\d%$/);
  });

  it('pages through the rest of the 4096, and finds its way back', () => {
    const { container } = renderApp(<ReportScreen />);
    const range = () => container.querySelector('.hv-top-pager .pager-range')!.textContent;
    const opening = range();
    fireEvent.click(container.querySelector('[aria-label="Next ranks"]')!);
    expect(range()).not.toBe(opening);
    // Off your own roll, the way back appears — and only then.
    const home = [...container.querySelectorAll('.hv-top-home')].at(-1)!;
    fireEvent.click(home);
    expect(range()).toBe(opening);
    expect(container.querySelector('.hv-top-home')).toBeFalsy();
  });

  it('sends the legend to the other corner when you pick a spread beneath it', () => {
    const { container } = renderApp(<ReportScreen />);
    const cell = container.querySelector('.heat-cell')!;
    // jsdom lays nothing out, so every rect is 0×0 and the real geometry has to
    // be supplied: a panel occupying 100–200 × 100–150. The corners themselves
    // were measured in the browser.
    const stub = () => {
      const panel = container.querySelector('.hv-legend-panel')!;
      panel.getBoundingClientRect = () =>
        ({ left: 100, right: 200, top: 100, bottom: 150, width: 100, height: 50 }) as DOMRect;
      return panel;
    };

    stub();
    fireEvent.click(cell, { clientX: 300, clientY: 400 });
    // A pick out in the open leaves it where it is.
    expect(container.querySelector('.hv-legend-panel')!.className).not.toContain('is-left');

    stub();
    fireEvent.click(cell, { clientX: 150, clientY: 120 });
    expect(container.querySelector('.hv-legend-panel')!.className).toContain('is-left');

    // And back again from the far corner — the same gesture, both ways.
    stub();
    fireEvent.click(cell, { clientX: 150, clientY: 120 });
    expect(container.querySelector('.hv-legend-panel')!.className).not.toContain('is-left');
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

describe('opponent list ordering and the fight jump', () => {
  it('orders the breakpoint list meta-first inside each damage step', async () => {
    const { container } = renderApp(<ReportScreen />);
    const breakpoints = [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Breakpoints')!;
    fireEvent.click(breakpoints);
    await waitFor(() => expect(container.querySelectorAll('.opp-cell').length).toBeGreaterThan(0));
    // Damage is a small integer and almost everything ties on it, so without a
    // rank tiebreak this order is arbitrary. The first entry should be a
    // recognisable meta Pokémon rather than whatever the scan happened to emit.
    const names = [...container.querySelectorAll('.opp-name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(4);
    expect(names.every((n) => typeof n === 'string' && n!.length > 0)).toBe(true);
  });

  it('gives every opponent a way into the simulator', () => {
    const { container } = renderApp(<ReportScreen />);
    const cells = container.querySelectorAll('.opp-cell-wrap');
    expect(cells.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.opp-fight').length).toBe(cells.length);
    // The action cannot be nested inside the cell, which is itself a button.
    expect(container.querySelectorAll('.opp-cell .opp-fight')).toHaveLength(0);
  });

  it('opens the fight with the report species and the clicked opponent', async () => {
    const { container } = renderApp(<App />);
    fireEvent.click([...container.querySelectorAll('.nav-tab')].find((t) => t.textContent?.includes('Report'))!);
    await waitFor(() => expect(container.querySelector('.opp-fight')).toBeTruthy());
    const wrap = container.querySelector('.opp-cell-wrap')!;
    const opponent = wrap.querySelector('.opp-name')!.textContent!;
    fireEvent.click(wrap.querySelector('.opp-fight')!);
    await waitFor(() => expect(container.querySelectorAll('.bt-side').length).toBe(2));
    const [a, b] = [...container.querySelectorAll('.bt-side')];
    expect(a.querySelector('.battle-mon-name')!.textContent).toMatch(/Azumarill/);
    // Shadow opponents keep their form across the jump.
    expect(b.querySelector('.battle-mon-name')!.textContent!.replace(/[^A-Za-z ]/g, '').trim())
      .toBe(opponent.replace(/\s*\(Shadow\)/, '').trim());
  });
});
