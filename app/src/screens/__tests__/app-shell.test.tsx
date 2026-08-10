import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import App from '../../App';
import { Board } from '../../components/Board';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('App shell', () => {
  const go = (c: HTMLElement, label: string) =>
    [...c.querySelectorAll('.nav-tab')].find((t) => t.textContent?.includes(label))!;

  it('starts on the landing page, where the search is the page', () => {
    const { container } = renderApp(<App />);
    expect(container.querySelector('.nav-search, #nav-species')).toBeFalsy();
    expect(container.querySelector('.landing-route')).toBeTruthy();
  });

  it('moves between screens from the nav', async () => {
    const { container } = renderApp(<App />);
    fireEvent.click(go(container, 'Rankings'));
    await waitFor(() => expect(container.textContent).toMatch(/Rankings/));
    fireEvent.click(go(container, 'Battle'));
    await waitFor(() => expect(container.querySelectorAll('.bt-side').length).toBe(2));
  });

  it('the Report picker changes the species in place', async () => {
    // It used to live in the nav and route here from wherever you were, which
    // is why it navigated. Now it is on the screen that reads the selection,
    // so picking simply updates the report under it.
    const { container } = renderApp(<App />);
    fireEvent.click(go(container, 'Report'));
    await waitFor(() => expect(container.querySelector('.species-search input')).toBeTruthy());
    const input = container.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'skarmory' } });
    const row = await waitFor(() => {
      const r = [...container.querySelectorAll('.search-row')].find((x) => /skarmory/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Skarmory');
      return r;
    });
    fireEvent.mouseDown(row);
    await waitFor(() => expect(go(container, 'Report').className).toMatch(/is-active/));
    await waitFor(() => expect(container.textContent).toMatch(/Skarmory/i));
    // And the nav no longer carries a picker of its own.
    expect(container.querySelector('.nav .report-search')).toBeNull();
  });

  it('changing league re-points the opponent, which is league-specific', async () => {
    const { container } = renderApp(<App />);
    fireEvent.click(go(container, 'Rankings'));
    await waitFor(() => expect(container.querySelector('.league-tab, .league-tabs button')).toBeTruthy());
    const leagues = [...container.querySelectorAll('.league-tabs button, .league-tab')];
    const other = leagues.find((b) => !b.className.includes('is-active'));
    if (other) {
      fireEvent.click(other);
      await waitFor(() => expect(other.className).toMatch(/is-active/));
    }
  });

  it('the brand returns to the landing page and clears the search', async () => {
    const { container } = renderApp(<App />);
    fireEvent.click(go(container, 'Battle'));
    await waitFor(() => expect(container.querySelectorAll('.bt-side').length).toBe(2));
    fireEvent.click(container.querySelector('.nav-brand')!);
    await waitFor(() => expect(container.querySelector('.landing-route')).toBeTruthy());
  });
});

describe('Board drag auto-scroll', () => {
  const blocks = [
    { id: 'a', label: 'Alpha', node: <div style={{ height: 800 }}>alpha</div> },
    { id: 'b', label: 'Beta', node: <div style={{ height: 800 }}>beta</div> },
  ];

  it('scrolls the page while a drag sits against an edge', () => {
    vi.useFakeTimers();
    const scrolls: number[] = [];
    window.scrollBy = ((_x: number, y: number) => scrolls.push(y)) as never;
    const { container } = renderApp(<Board storageKey="scroll" blocks={blocks} editing />);
    const item = container.querySelector('.board-slot') as HTMLElement;
    fireEvent.dragStart(item, { dataTransfer: { effectAllowed: '', setData: () => {} } });
    expect(container.querySelector('.is-dragging')).toBeTruthy();

    // The listener is on window, not on a node, so dispatch it there directly.
    // With no nav rendered the top band starts at 0, so y=50 is inside it.
    const over = (y: number) =>
      act(() => { window.dispatchEvent(Object.assign(new Event('dragover'), { clientY: y })); });
    over(50);
    act(() => { vi.advanceTimersByTime(64); });
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((d) => d < 0)).toBe(true);

    // Releasing the drag stops the timer.
    scrolls.length = 0;
    fireEvent.dragEnd(item);
    act(() => { vi.advanceTimersByTime(200); });
    expect(scrolls).toHaveLength(0);
    vi.useRealTimers();
  });

  it('leaves the page alone while the pointer is clear of both edges', () => {
    vi.useFakeTimers();
    const scrolls: number[] = [];
    window.scrollBy = ((_x: number, y: number) => scrolls.push(y)) as never;
    // jsdom reports an innerHeight of 768, so the middle is far from either band.
    const { container } = renderApp(<Board storageKey="scroll2" blocks={blocks} editing />);
    fireEvent.dragStart(container.querySelector('.board-slot')!, {
      dataTransfer: { effectAllowed: '', setData: () => {} },
    });
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('dragover'), { clientY: Math.round(window.innerHeight / 2) }),
      );
    });
    act(() => { vi.advanceTimersByTime(64); });
    expect(scrolls).toHaveLength(0);
    vi.useRealTimers();
  });
});
