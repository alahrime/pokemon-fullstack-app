import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { HeatmapView } from '../../screens/detail/HeatmapView';
import { MovesPanel } from '../MovesPanel';
import { AddPokemonModal } from '../AddPokemonModal';
import { SPECIES_BY_ID } from '../../lib/data';
import { buildHeatCells, getTable, opponentInfo, paletteFor } from '../../lib/engine';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('HeatmapView with WebGL available', () => {
  /**
   * jsdom has no GL context, so the 3D toggle never renders and neither of its
   * buttons is reachable. Pretend the probe succeeded — the terrain itself is
   * lazy-loaded and excluded from coverage, but the switch between the two
   * views is ordinary code and worth holding.
   */
  const pretendWebGL = () => {
    (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext = function () {};
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
  };

  const view = () => {
    const species = SPECIES_BY_ID.get('azumarill')!;
    const iv = { a: 0, d: 14, s: 15 };
    const table = getTable('azumarill', 'great');
    const opp = opponentInfo('registeel', 'great');
    const cells = buildHeatCells('azumarill', iv, 'great', opp, 0, 'rank');
    return { species, iv, table, cells, palette: paletteFor(species) };
  };

  it('offers the terrain, and comes back to the flat grid', async () => {
    pretendWebGL();
    const { iv, table, cells, palette } = view();
    const { container } = renderApp(
      <HeatmapView
        cells={cells} colorBy="rank" colorByLabel="Rank" onPick={() => {}}
        ivS={iv.s} onIvS={() => {}} table={table} iv={iv} palette={palette} />);
    const controls = container.querySelector('.hv-controls')!;
    const threeD = [...controls.querySelectorAll('button')].find((b) => b.textContent === '3D');
    expect(threeD).toBeTruthy();
    fireEvent.click(threeD!);
    // The flat grid gives way to the lazily-loaded terrain.
    await waitFor(() => expect(container.querySelector('.hv-terrain')).toBeTruthy());
    const twoD = [...controls.querySelectorAll('button')].find((b) => b.textContent === '2D')!;
    fireEvent.click(twoD);
    expect(container.querySelector('.hv-grid')).toBeTruthy();
  });

  it('hides the toggle entirely where the probe fails', () => {
    const { iv, table, cells, palette } = view();
    const { container } = renderApp(
      <HeatmapView
        cells={cells} colorBy="rank" colorByLabel="Rank" onPick={() => {}}
        ivS={iv.s} onIvS={() => {}} table={table} iv={iv} palette={palette} />);
    const controls = container.querySelector('.hv-controls')!;
    expect([...controls.querySelectorAll('button')].some((b) => b.textContent === '3D')).toBe(false);
  });
});

describe('MovesPanel pickers', () => {
  const azumarill = SPECIES_BY_ID.get('azumarill')!;

  it('picks a fast move out of the browser', () => {
    const onMoveIdx = vi.fn();
    const { container } = renderApp(
      <MovesPanel species={azumarill} moveIdx={0} onMoveIdx={onMoveIdx}
        chargeIds={[]} onChargeIds={() => {}} />);
    const col = container.querySelectorAll('.moves-col')[0];
    fireEvent.click(col.querySelector('.move-picker-btn')!);
    const rows = [...col.querySelectorAll('.move-picker-row')];
    expect(rows.length).toBeGreaterThan(1);
    // The equipped move is marked, so the browser agrees with the tiles.
    expect(rows.some((r) => r.className.includes('is-active'))).toBe(true);
    fireEvent.click(rows.find((r) => !r.className.includes('is-active'))!);
    expect(onMoveIdx).toHaveBeenCalled();
  });

  it('picks a charged move out of the browser', () => {
    const onChargeIds = vi.fn();
    const { container } = renderApp(
      <MovesPanel species={azumarill} moveIdx={0} onMoveIdx={() => {}}
        chargeIds={[]} onChargeIds={onChargeIds} />);
    const col = container.querySelectorAll('.moves-col')[1];
    fireEvent.click(col.querySelector('.move-picker-btn')!);
    const rows = [...col.querySelectorAll('.move-picker-row')];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.some((r) => r.className.includes('is-active'))).toBe(true);
    fireEvent.click(rows.find((r) => !r.className.includes('is-active'))!);
    expect(onChargeIds).toHaveBeenCalled();
  });
});

describe('AddPokemonModal IV controls', () => {
  const open = async () => {
    const onCommit = vi.fn();
    const r = renderApp(
      <AddPokemonModal league="great" restrictTo={undefined} onCommit={onCommit} onClose={() => {}} />);
    const input = r.container.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'azumarill' } });
    const row = await waitFor(() => {
      const x = [...r.container.querySelectorAll('.search-row')].find((n) => /azumarill/i.test(n.textContent ?? ''));
      if (!x) throw new Error('no Azumarill');
      return x;
    });
    fireEvent.mouseDown(row);
    await waitFor(() => expect(r.container.querySelector('.iv-step')).toBeTruthy());
    return { ...r, onCommit };
  };

  it('steps an IV with the +/- buttons', async () => {
    const { container } = await open();
    const value = () => container.querySelector('.iv-value')!.textContent;
    const before = value();
    const steps = container.querySelectorAll('.iv-step');
    expect(steps.length).toBeGreaterThan(1);
    fireEvent.click(steps[1]);
    expect(value()).not.toBe(before);
    fireEvent.click(steps[0]);
    expect(value()).toBe(before);
  });

  it('sets an IV by pressing the track', async () => {
    const { container } = await open();
    const track = container.querySelector('[role="slider"]') as HTMLElement;
    // The stubbed track is 200px wide over 15 ticks.
    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    expect(container.querySelector('.iv-value')!.textContent).toBe('15');
  });
});
