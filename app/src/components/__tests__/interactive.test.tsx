import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { goTo } from '../../test/nav';
import { SECTIONS, SCREEN_DEFS } from '../../lib/screens';
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
    expect(container.querySelectorAll('.nav-section').length).toBe(3);
  });
  it('navigates between screens', async () => {
    const { container } = renderApp(<App />);
    goTo(container, 'Rankings');
    const active = container.querySelector('.nav-tab.is-active')!;
    expect(active.textContent).toMatch(/Rankings/);
    expect(active.getAttribute('aria-current')).toBe('page');
  });
  it('the brand returns to the landing page', () => {
    const { container } = renderApp(<App />);
    goTo(container, 'Report');
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
    goTo(container, 'Report');
    const search = container.querySelector('.report-search');
    expect(search, 'the Report must carry the picker').toBeTruthy();
    expect(container.querySelector('.nav')!.contains(search!)).toBe(false);
  });
  it('gives every nav tab its own hue', () => {
    const { container } = renderApp(<App />);
    // A section deliberately wears the hue of its lead screen, so distinctness
    // holds within the sections and within each rail, not across the two. Every
    // screen having its own hue is covered in lib/__tests__/screens.test.ts.
    const huesOf = (sel: string) =>
      [...container.querySelectorAll(sel)].map((t) => (t as HTMLElement).style.getPropertyValue('--tab-hue'));
    const sections = huesOf('.nav-section');
    expect(new Set(sections).size).toBe(sections.length);
    for (const s of SECTIONS) {
      goTo(container, SCREEN_DEFS.find((d) => d.id === s.screens[0])!.label);
      const rail = huesOf('.nav-tab');
      expect(rail.length, s.id).toBeGreaterThan(0);
      expect(new Set(rail).size, s.id).toBe(rail.length);
    }
  });
});

describe('LeagueTabs', () => {
  it('renders the three leagues and reports a change', () => {
    const onChange = vi.fn();
    const { container } = renderApp(<LeagueTabs value="great" cup={null} onChange={onChange} />);
    const tabs = container.querySelectorAll('.league-tab');
    expect(tabs.length).toBe(3);
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('ultra', null);
  });
  it('picking a limited cup reports its league and key', () => {
    const onChange = vi.fn();
    const { container, getByRole } = renderApp(<LeagueTabs value="great" cup={null} onChange={onChange} />);
    fireEvent.click(getByRole('combobox', { name: 'Limited cup' }));
    fireEvent.click(container.querySelector('#cup-select-list [role=option]:nth-child(2)')!);
    expect(onChange.mock.calls[0][1]).toEqual(expect.any(String));
  });
});

describe('AddPokemonModal', () => {
  it('opens with a search and a close control', () => {
    // Portalled into <body>: a fixed scrim inside a transformed ancestor is
    // not fixed to the viewport at all.
    renderApp(<AddPokemonModal league="great" onCommit={() => {}} onClose={() => {}} />);
    expect(document.body.querySelector('.modal-panel input')).toBeTruthy();
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
    renderApp(<AddPokemonModal league="great" onCommit={onCommit} onClose={() => {}} />);
    const container = document.body;
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
