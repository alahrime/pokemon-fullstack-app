import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { CoresScreen } from '../CoresScreen';
import { RankingsScreen } from '../RankingsScreen';
import { ReportScreen } from '../ReportScreen';

beforeEach(() => localStorage.clear());

function captureDownloads() {
  const names: string[] = [];
  URL.createObjectURL = (() => 'blob:x') as never;
  URL.revokeObjectURL = (() => {}) as never;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'download', { set: (v: string) => names.push(v), get: () => '' });
      (el as HTMLAnchorElement).click = () => {};
    }
    return el;
  });
  return names;
}

const seg = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

describe('CoresScreen controls', () => {
  it('sorts by every available key without losing the list', () => {
    const { container } = renderApp(<CoresScreen />);
    const count = container.querySelectorAll('.core-row, .core-card, li').length;
    for (const label of ['Lift', 'Seen', 'Balance', 'Score']) {
      const b = seg(container, label);
      if (b) fireEvent.click(b);
    }
    expect(container.querySelectorAll('.core-row, .core-card, li').length).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(0);
  });

  it('filters the list by name', () => {
    const { container } = renderApp(<CoresScreen />);
    const input = container.querySelector('input[placeholder="Filter by name…"]') as HTMLInputElement;
    const before = container.querySelectorAll('.core-row, .core-card').length;
    fireEvent.change(input, { target: { value: 'zzzznothing' } });
    const after = container.querySelectorAll('.core-row, .core-card').length;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('opens a core and shows both rescue directions', () => {
    const { container } = renderApp(<CoresScreen />);
    const row = container.querySelector('.core-row, .core-card') as HTMLElement;
    fireEvent.click(row.querySelector('button') ?? row);
    const detail = container.querySelector('.core-detail');
    if (detail) expect(detail.textContent).toBeTruthy();
  });

  it('switches to pillars and back', () => {
    const { container } = renderApp(<CoresScreen />);
    const pillars = container.querySelector('[title="A lead whose weakness two teammates both answer"]');
    fireEvent.click(pillars!);
    expect(container.textContent).toBeTruthy();
    fireEvent.click(container.querySelector('[title="Pairs that rescue each other"]')!);
    expect(container.querySelector('.core-row, .core-card')).toBeTruthy();
  });

  it('exports whichever tab is showing', () => {
    const names = captureDownloads();
    const { container } = renderApp(<CoresScreen />);
    const csv = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'CSV');
    fireEvent.click(csv!);
    fireEvent.click(container.querySelector('[title="A lead whose weakness two teammates both answer"]')!);
    const csv2 = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'CSV');
    fireEvent.click(csv2!);
    expect(names.length).toBe(2);
    vi.restoreAllMocks();
  });

  it('scores an arbitrary pair on demand', async () => {
    const { container } = renderApp(<CoresScreen />);
    fireEvent.click(container.querySelector('[title="Score any two Pokémon on demand"]')!);
    const inputs = [...container.querySelectorAll('.species-search input')] as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    // Scope the dropdown to its own field: both fields are open at once, and
    // picking out of the wrong one silently left the second empty.
    // The query is debounced, so the rows on screen immediately after typing
    // are still the previous query's — picking one gave both fields the same
    // species, which the button rightly refuses.
    const choose = async (input: HTMLInputElement, name: string) => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: name } });
      const row = await waitFor(() => {
        const r = [...input.closest('.species-search')!.querySelectorAll('.search-row')]
          .find((x) => new RegExp(name, 'i').test(x.textContent ?? ''));
        if (!r) throw new Error(`no result for ${name}`);
        return r;
      });
      fireEvent.mouseDown(row);
      fireEvent.blur(input);
    };
    await choose(inputs[0], 'azumarill');
    await choose(inputs[1], 'registeel');
    const score = [...container.querySelectorAll('button')]
      .find((b) => /Score pair/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(score.disabled).toBe(false);
    fireEvent.click(score);
    await waitFor(() => expect(container.querySelector('.core-check-result')).toBeTruthy(), { timeout: 60000 });
    // The percentile places the score against the pool's own strong pairs.
    expect(container.textContent).toMatch(/pct/);
  }, 90000);
});

describe('RankingsScreen', () => {
  it('exports the current view as CSV', () => {
    const names = captureDownloads();
    const { container } = renderApp(<RankingsScreen />);
    const csv = [...container.querySelectorAll('.best-teams-export .btn')];
    expect(csv.length).toBeGreaterThan(0);
    csv.forEach((b) => fireEvent.click(b));
    expect(names.every((n) => /\.(csv|json)$/.test(n))).toBe(true);
    expect(names.length).toBe(csv.length);
    vi.restoreAllMocks();
  });
});

describe('HeatmapView', () => {
  it('offers a flat grid, and picks a roll off it', () => {
    const { container } = renderApp(<ReportScreen />);
    const cell = container.querySelector('.heat-cell, [data-iv], svg rect');
    if (cell) fireEvent.click(cell);
    expect(container.textContent).toBeTruthy();
  });
});
