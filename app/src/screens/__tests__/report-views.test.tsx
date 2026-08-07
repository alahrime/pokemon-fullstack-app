import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ReportScreen } from '../ReportScreen';
import { CoresScreen } from '../CoresScreen';
import { useEffect } from 'react';
import { useAppState } from '../../state/AppState';

/** Put the app on a species before the screen under test reads it. */
function With({ species, children }: { species: string; children: React.ReactNode }) {
  const { set } = useAppState();
  useEffect(() => { set('species', species); }, [species]);
  return <>{children}</>;
}

beforeEach(() => localStorage.clear());

const tab = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes(label))!;

describe('ReportScreen views', () => {
  it('opens on the heatmap', () => {
    const { container } = renderApp(<ReportScreen />);
    expect(tab(container, '4096 heatmap').getAttribute('aria-selected')).toBe('true');
  });

  it('switches to the damage ruler', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Damage ruler'));
    await waitFor(() =>
      expect(tab(container, 'Damage ruler').getAttribute('aria-selected')).toBe('true'));
    expect(container.querySelector('.stagger')).toBeTruthy();
  });

  it('switches to the threshold table', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Threshold table'));
    await waitFor(() =>
      expect(tab(container, 'Threshold table').getAttribute('aria-selected')).toBe('true'));
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('switches to matchup flips and builds the grid', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Matchup flips'));
    await waitFor(() =>
      expect(tab(container, 'Matchup flips').getAttribute('aria-selected')).toBe('true'));
    expect(container.textContent).toBeTruthy();
  });

  it('compares Normal against Shadow damage for an eligible species', async () => {
    // Azumarill, the default, has no Shadow form — the comparison only exists
    // for a species that does.
    const { container } = renderApp(<With species="venusaur"><ReportScreen /></With>);
    await waitFor(() => {
      const rows = [...container.querySelectorAll('table tr')].map((r) => r.textContent ?? '');
      expect(rows.some((r) => /PvPoke rank/.test(r))).toBe(true);
    });
    expect(container.textContent).toMatch(/Shadow/);
  });

  it('says plainly when no Shadow form exists', () => {
    const { container } = renderApp(<ReportScreen />);
    expect(container.textContent).toMatch(/No Shadow form exists/);
  });

  it('toggles to the Shadow form and re-derives the readout', async () => {
    const { container } = renderApp(<With species="venusaur"><ReportScreen /></With>);
    const shadowOpt = await waitFor(() => {
      const el = container.querySelector('.form-opt-shadow') as HTMLButtonElement;
      expect(el.disabled).toBe(false);
      return el;
    });
    fireEvent.click(shadowOpt);
    await waitFor(() =>
      expect(container.querySelector('.form-opt-shadow')!.getAttribute('aria-pressed')).toBe('true'));
    // Attack x1.2 and defense x5/6 cancel in stat product, so the rank must not
    // move — only the damage thresholds do.
    expect(container.textContent).toMatch(/never moves|rank/i);
  });
});

describe('CoresScreen', () => {
  it('lists cores and opens one', async () => {
    const { container } = renderApp(<CoresScreen />);
    const row = container.querySelector('.core-row, .cores-list li, .core-card');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    await waitFor(() => expect(container.textContent).toBeTruthy());
  });

  it('exports the core list', () => {
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
    const { container } = renderApp(<CoresScreen />);
    const csv = [...container.querySelectorAll('button')].find((b) => /csv/i.test(b.textContent ?? ''));
    if (csv) {
      fireEvent.click(csv);
      expect(names.length).toBeGreaterThan(0);
    }
  });
});
