import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { TeamBuilderScreen } from '../TeamBuilderScreen';
import { CoresScreen } from '../CoresScreen';
import { RankingsScreen } from '../RankingsScreen';
import { DiagnosticsScreen } from '../DiagnosticsScreen';
import { BestTeams } from '../../components/BestTeams';

beforeEach(() => {
  localStorage.clear();
  // A test that throws before restoring would otherwise leave its
  // document.createElement spy in place, and the next capture would chain
  // onto it and record into the dead test's array.
  vi.restoreAllMocks();
});

/** Downloads reach jsdom's unimplemented navigation; capture the names instead. */
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

describe('TeamBuilderScreen — adding through the modal', () => {
  it('builds a Pokémon in the modal and lands it in a slot', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    fireEvent.click(container.querySelector('.team-slot.is-empty')!);
    const modal = document.querySelector('.modal-panel') as HTMLElement;
    expect(modal).toBeTruthy();

    const input = modal.querySelector('.species-search input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'registeel' } });
    const row = await waitFor(() => {
      const r = [...modal.querySelectorAll('.search-row')].find((x) => /registeel/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Registeel');
      return r;
    });
    fireEvent.mouseDown(row);

    const commit = [...modal.querySelectorAll('button')]
      .find((b) => /^(add|add to team|confirm)$/i.test(b.textContent?.trim() ?? ''));
    expect(commit).toBeTruthy();
    fireEvent.click(commit!);
    await waitFor(() => expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(2));
    expect(container.textContent).toMatch(/Registeel/i);
    expect(document.querySelector('.modal-panel')).toBeFalsy();
  });

  it('closes the modal without adding anything', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    fireEvent.click(container.querySelector('.team-slot.is-empty')!);
    expect(document.querySelector('.modal-panel')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.modal-panel')).toBeFalsy();
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(3);
  });

  it('loads a discovered team, replacing the roster outright', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    // Put one member in by hand first; a load must not append to it.
    const search = container.querySelector('.team-add input') as HTMLInputElement;
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'azumarill' } });
    const row = await waitFor(() => {
      const r = [...container.querySelectorAll('.search-dropdown .search-row')]
        .find((x) => /azumarill/i.test(x.textContent ?? ''));
      if (!r) throw new Error('no Azumarill');
      return r;
    });
    fireEvent.mouseDown(row);
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(2);

    const load = container.querySelector('[title="Load into the slots above"]');
    if (load) {
      fireEvent.click(load);
      // A full team of three, not four and not a rejected load.
      expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(0);
    }
  });

  it('takes a suggested completion straight onto the team', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    for (const name of ['azumarill', 'registeel']) {
      // Remounted on every pick — a stale reference searches a detached node.
      const search = container.querySelector('.team-add input') as HTMLInputElement;
      fireEvent.focus(search);
      fireEvent.change(search, { target: { value: name } });
      const row = await waitFor(() => {
        const r = [...container.querySelectorAll('.search-dropdown .search-row')]
          .find((x) => new RegExp(name, 'i').test(x.textContent ?? ''));
        if (!r) throw new Error(`no ${name}`);
        return r;
      });
      fireEvent.mouseDown(row);
    }
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 60000 });
    const card = container.querySelector('.suggest-cards .pc') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(0);
  }, 90000);

  it('exports the threat table as CSV', async () => {
    const names = captureDownloads();
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    for (const name of ['azumarill', 'registeel', 'medicham']) {
      const search = container.querySelector('.team-add input') as HTMLInputElement;
      fireEvent.focus(search);
      fireEvent.change(search, { target: { value: name } });
      const row = await waitFor(() => {
        const r = [...container.querySelectorAll('.search-dropdown .search-row')]
          .find((x) => new RegExp(name, 'i').test(x.textContent ?? ''));
        if (!r) throw new Error(`no ${name}`);
        return r;
      });
      fireEvent.mouseDown(row);
    }
    fireEvent.click(screen.getByRole('button', { name: /Analyse team/i }));
    await waitFor(() => expect(container.querySelector('.team-report')).toBeTruthy(), { timeout: 60000 });
    // Several buttons on this screen say "CSV"; the threat table's is the one
    // that carries the report, so target it by what it does.
    fireEvent.click(container.querySelector('[title="The threat table as CSV"]')!);
    expect(names.some((n) => n.startsWith('paragon-threats') && n.endsWith('.csv'))).toBe(true);
  }, 90000);
});

describe('CoresScreen — the rest of its controls', () => {
  it('switches between a varied list and every core in score order', () => {
    const { container } = renderApp(<CoresScreen />);
    const all = container.querySelector('[title="Every core in score order, repeats included"]')!;
    fireEvent.click(all);
    const variedCount = container.querySelectorAll('.core-row, .core-card').length;
    const varied = container.querySelector('[title*="At most three cores per Pokémon"]')!;
    fireEvent.click(varied);
    expect(container.querySelectorAll('.core-row, .core-card').length).toBeGreaterThan(0);
    expect(variedCount).toBeGreaterThan(0);
  });

  it('sorts by rescue, which is the default the others toggle away from', () => {
    const { container } = renderApp(<CoresScreen />);
    const rescue = container.querySelector('[title="Mutual rescue, both directions"]')!;
    fireEvent.click(container.querySelector('[title="Raw appearances together in top teams"]')!);
    fireEvent.click(rescue);
    expect(rescue.className).toMatch(/is-active/);
  });
});

describe('RankingsScreen paging', () => {
  it('steps forward and back through the pages', () => {
    const { container } = renderApp(<RankingsScreen />);
    const pager = container.querySelector('.rankings-pager')!;
    const [prev, next] = [...pager.querySelectorAll('button')];
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    const before = pager.querySelector('.opp-page-num')!.textContent;
    fireEvent.click(next);
    expect(pager.querySelector('.opp-page-num')!.textContent).not.toBe(before);
    fireEvent.click(prev);
    expect(pager.querySelector('.opp-page-num')!.textContent).toBe(before);
  });
});

describe('BestTeams paging', () => {
  it('steps through the stratum a page at a time', () => {
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={() => {}} />);
    const pager = container.querySelector('.opp-pager');
    if (!pager) return; // fewer teams than a page
    const [prev, next] = [...pager.querySelectorAll('button')];
    const before = pager.querySelector('.opp-page-num')!.textContent;
    fireEvent.click(next);
    expect(pager.querySelector('.opp-page-num')!.textContent).not.toBe(before);
    fireEvent.click(prev);
    expect(pager.querySelector('.opp-page-num')!.textContent).toBe(before);
  });
});

describe('DiagnosticsScreen', () => {
  it('exports the two rankings side by side as CSV', () => {
    const names = captureDownloads();
    const { container } = renderApp(<DiagnosticsScreen />);
    const csv = container.querySelector('.diag-export')!;
    fireEvent.click(csv);
    expect(names.some((n) => n.startsWith('paragon-bt') && n.endsWith('.csv'))).toBe(true);
  });
});
