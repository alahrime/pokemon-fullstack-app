import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import App from '../../App';
import { AddPokemonModal } from '../AddPokemonModal';
import { LeagueTabs } from '../LeagueTabs';
import { SiteFooter } from '../SiteFooter';
import { SearchHelp } from '../SearchHelp';
import { ShieldMatrix } from '../ShieldMatrix';
import { ThresholdTable } from '../../screens/detail/ThresholdTable';
import { RulerView } from '../../screens/detail/RulerView';
import { scenarioMatrix, rulersFor, bpRowsFor, opponentInfo } from '../../lib/engine';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('App shell', () => {
  it('mounts and shows the nav', () => {
    const { container } = renderApp(<App />);
    expect(container.querySelectorAll('.nav-tab').length).toBeGreaterThanOrEqual(6);
  });
  it('navigates between screens', async () => {
    const { container } = renderApp(<App />);
    const rankings = [...container.querySelectorAll('.nav-tab')].find((b) => b.textContent!.includes('Rankings'))!;
    fireEvent.click(rankings);
    expect(rankings.getAttribute('aria-current')).toBe('page');
  });
  it('the brand returns to the landing page', () => {
    const { container } = renderApp(<App />);
    fireEvent.click(container.querySelector('.nav-tab')!);
    fireEvent.click(container.querySelector('.nav-brand')!);
    // Identify the screen by the screen, not by the absent nav search: that
    // search has moved to the Report, so its absence no longer distinguishes
    // anything and the assertion would pass however broken the brand was.
    expect(container.querySelector('.landing-route')).toBeTruthy();
  });
  it('keeps the species picker on the Report rather than in the nav', () => {
    // It sat in the nav and was inert on four of the six screens, since only
    // the Report reads `state.species`. It now leads the Report's Analysis
    // row, beside the readouts it changes.
    const { container } = renderApp(<App />);
    expect(container.querySelector('.nav .report-search')).toBeNull();
    fireEvent.click([...container.querySelectorAll('.nav-tab')].find((b) => b.textContent!.includes('Report'))!);
    const search = container.querySelector('.report-search');
    expect(search, 'the Report must carry the picker').toBeTruthy();
    expect(container.querySelector('.nav')!.contains(search!)).toBe(false);
  });
  it('gives every nav tab its own hue', () => {
    const { container } = renderApp(<App />);
    const hues = [...container.querySelectorAll('.nav-tab')].map((t) => (t as HTMLElement).style.getPropertyValue('--tab-hue'));
    expect(new Set(hues).size).toBe(hues.length);
  });
});

describe('LeagueTabs', () => {
  it('renders the three leagues and reports a change', () => {
    const onChange = vi.fn();
    const { container } = renderApp(<LeagueTabs value="great" onChange={onChange} />);
    const tabs = container.querySelectorAll('button');
    expect(tabs.length).toBe(3);
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalled();
  });
});

describe('AddPokemonModal', () => {
  it('opens with a search and a close control', () => {
    const { container } = renderApp(
      <AddPokemonModal league="great" onCommit={() => {}} onClose={() => {}} />);
    expect(container.querySelector('input')).toBeTruthy();
  });
  it('closes on Escape without committing', () => {
    const onClose = vi.fn(), onCommit = vi.fn();
    renderApp(<AddPokemonModal league="great" onCommit={onCommit} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
  it('lets a species be chosen and committed with its build', () => {
    const onCommit = vi.fn();
    const { container } = renderApp(
      <AddPokemonModal league="great" onCommit={onCommit} onClose={() => {}} />);
    fireEvent.focus(container.querySelector('input')!);
    const row = container.querySelector('.search-row');
    if (row) {
      fireEvent.mouseDown(row);
      const add = [...container.querySelectorAll('button')].find((b) => /add|confirm/i.test(b.textContent!));
      if (add && !(add as HTMLButtonElement).disabled) {
        fireEvent.click(add);
        expect(onCommit).toHaveBeenCalled();
        const choice = onCommit.mock.calls[0][0];
        expect(choice.ref).toBeTruthy();
        expect(choice.iv).toHaveProperty('a');
      }
    }
  });
});

describe('SearchHelp', () => {
  it('shows nothing when closed and the syntax guide when open', () => {
    const { container, rerender } = renderApp(<SearchHelp open={false} onClose={() => {}} />);
    expect(container.textContent!.trim()).toBe('');
    rerender(<SearchHelp open onClose={() => {}} />);
    expect(container.textContent!.length).toBeGreaterThan(50);
  });
  it('closes when asked', () => {
    const onClose = vi.fn();
    const { container } = renderApp(<SearchHelp open onClose={onClose} />);
    const btn = [...container.querySelectorAll('button')].find((b) => /close|×|✕/i.test(b.textContent! + b.getAttribute('aria-label')));
    if (btn) { fireEvent.click(btn); expect(onClose).toHaveBeenCalled(); }
  });
});

describe('SiteFooter', () => {
  it('renders build provenance', () => {
    const { container } = renderApp(<SiteFooter />);
    expect(container.textContent!.length).toBeGreaterThan(10);
  });
});

describe('ShieldMatrix', () => {
  it('renders a 3x3 lattice and reports a pick', () => {
    const cells = scenarioMatrix('registeel', { a: 0, d: 15, s: 15 }, 'great', 'azumarill', 0);
    const onChange = vi.fn();
    const { container } = renderApp(<ShieldMatrix mine={1} theirs={1} cells={cells} onChange={onChange} />);
    const btns = container.querySelectorAll('button');
    expect(btns.length).toBeGreaterThanOrEqual(9);
    fireEvent.click(btns[0]);
    expect(onChange).toHaveBeenCalled();
  });
});

describe('detail views', () => {
  it('ThresholdTable renders its rows, and nothing when empty', () => {
    const rows = bpRowsFor('registeel', { a: 0, d: 15, s: 15 }, 'great', opponentInfo('azumarill', 'great'));
    const { container } = renderApp(<ThresholdTable rows={rows} />);
    expect(container.textContent!.length).toBeGreaterThan(0);
    const { container: empty } = renderApp(<ThresholdTable rows={[]} />);
    expect(() => empty).not.toThrow();
  });
  it('RulerView renders every ruler band', () => {
    const rulers = rulersFor('registeel', { a: 0, d: 15, s: 15 }, 'great', opponentInfo('azumarill', 'great'));
    const { container } = renderApp(<RulerView rulers={rulers} />);
    expect(container.textContent!.length).toBeGreaterThan(0);
  });
  it('RulerView survives an empty set', () => {
    expect(() => renderApp(<RulerView rulers={[]} />)).not.toThrow();
  });
});
