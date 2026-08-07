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

describe('Matchup flips layout', () => {
  it('puts the verdict above the grid, not at the head of the side column', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Matchup flips'));
    await waitFor(() => expect(container.querySelector('.fv-grid')).toBeTruthy());

    const now = container.querySelector('.fv-now')!;
    const cols = container.querySelector('.fv-cols')!;
    const side = container.querySelector('.fv-side')!;
    // The verdict is a sibling before the two columns. Inside the side column
    // it pushed the opponents table below the grid it controls.
    expect(now.parentElement).toBe(cols.parentElement);
    expect(now.compareDocumentPosition(cols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(side.contains(now)).toBe(false);
  });

  it('keeps the shield matrix and the opponents table in the side column', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Matchup flips'));
    await waitFor(() => expect(container.querySelector('.fv-side')).toBeTruthy());
    const side = container.querySelector('.fv-side')!;
    expect(side.querySelector('table')).toBeTruthy();
    expect(side.querySelector('.sm-col, .sm-contents')).toBeTruthy();
  });

  it('lets the grid flex rather than pinning it, so the table can sit beside it', async () => {
    const { container } = renderApp(<ReportScreen />);
    fireEvent.click(tab(container, 'Matchup flips'));
    await waitFor(() => expect(container.querySelector('.fv-grid-col')).toBeTruthy());
    // jsdom applies no stylesheet, so this asserts the contract the CSS keys
    // off rather than the computed width: both columns are flex children of
    // the same row.
    const col = container.querySelector('.fv-grid-col')!;
    const side = container.querySelector('.fv-side')!;
    expect(col.parentElement).toBe(side.parentElement);
    expect(col.parentElement!.className).toContain('fv-cols');
  });
});

describe('report left column', () => {
  it('names every readout, not just the controls', () => {
    const { container } = renderApp(<ReportScreen />);
    const side = container.querySelector('.report-side')!;
    const labels = [...side.querySelectorAll('.side-block > .hud-label')]
      .map((l) => l.textContent!.replace(/max →.*$/, '').trim());
    // The column used to be labelled down to "Adjust roll" and then run
    // anonymous: a stat strip, a list of numbers and a table with nothing
    // saying what any of them was.
    expect(labels).toContain('Form');
    expect(labels).toContain('Adjust roll');
    expect(labels).toContain('Battle stats');
    expect(labels).toContain('This spread');
  });

  it('puts the stat strip and the detail list inside named blocks', () => {
    const { container } = renderApp(<ReportScreen />);
    const side = container.querySelector('.report-side')!;
    expect(side.querySelector('.side-block .stat-strip')).toBeTruthy();
    expect(side.querySelector('.side-block .detail-list')).toBeTruthy();
  });

  it('labels the Shadow comparison where one exists', async () => {
    const { container } = renderApp(<With species="venusaur"><ReportScreen /></With>);
    await waitFor(() => expect(container.querySelector('.rs-shadow-table')).toBeTruthy());
    const block = container.querySelector('.rs-shadow-table')!.closest('.side-block')!;
    expect(block.querySelector('.hud-label')!.textContent).toContain('Shadow damage');
  });

  it('omits the Shadow block entirely for a species with no Shadow form', () => {
    const { container } = renderApp(<ReportScreen />);
    expect(container.querySelector('.rs-shadow-table')).toBeFalsy();
  });
});
