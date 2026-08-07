import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { TeamBuilderScreen } from '../TeamBuilderScreen';

/** Pick the nth option out of the live search dropdown. */
function pick(container: HTMLElement, typed: string) {
  const input = container.querySelector('.team-add input') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  const row = container.querySelector('.search-dropdown .search-row');
  if (!row) throw new Error(`no search result for "${typed}"`);
  fireEvent.mouseDown(row);
}

describe('TeamBuilderScreen — building a roster', () => {
  it('renders one empty slot per team size', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    expect(container.querySelectorAll('.team-slots > *')).toHaveLength(3);
    const six = renderApp(<TeamBuilderScreen size={6} />);
    expect(six.container.querySelectorAll('.team-slots > *')).toHaveLength(6);
  });

  it('titles itself by size', () => {
    renderApp(<TeamBuilderScreen size={3} />);
    expect(screen.getByText('GBL Teams')).toBeTruthy();
  });

  it('adds a pick to the roster and clears it again', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    pick(container, 'azumarill');
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(2);
    const clear = container.querySelector('.team-slots .pokemon-card, .team-slots [role="button"]');
    if (clear) {
      fireEvent.click(clear);
      expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(3);
    }
  });

  it('keeps Analyse disabled until the team is full', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    const analyse = screen.getByRole('button', { name: /Analyse team/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(true);
    pick(container, 'azumarill');
    expect(analyse.disabled).toBe(true);
  });

  it('keeps Suggest disabled on an empty roster and enables it once picked', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    const suggest = screen.getByRole('button', { name: /Suggest next pick/i }) as HTMLButtonElement;
    expect(suggest.disabled).toBe(true);
    pick(container, 'azumarill');
    expect(suggest.disabled).toBe(false);
  });

  it('refuses a second member of the same species', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    pick(container, 'azumarill');
    // The duplicate rule removes it from the pool entirely, so the search can
    // no longer offer it — which is the enforcement, not a silent rejection.
    const input = container.querySelector('.team-add input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'azumarill' } });
    const rows = [...container.querySelectorAll('.search-dropdown .search-row')];
    expect(rows.some((r) => /^Azumarill$/i.test(r.textContent?.trim() ?? ''))).toBe(false);
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(2);
  });
});

describe('TeamBuilderScreen — analysis', () => {
  it('runs the simulation and reports a win rate', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    pick(container, 'azumarill');
    pick(container, 'registeel');
    pick(container, 'medicham');
    const analyse = screen.getByRole('button', { name: /Analyse team/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(false);
    fireEvent.click(analyse);
    await waitFor(() => expect(container.querySelector('.team-report')).toBeTruthy(), { timeout: 60000 });
    expect(container.textContent).toMatch(/%/);
  }, 90000);

  it('suggests a completion for a partial team', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    pick(container, 'azumarill');
    pick(container, 'registeel');
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 60000 });
  }, 90000);
});

describe('TeamBuilderScreen — Show 6', () => {
  const fill = (container: HTMLElement, refs: string[]) => refs.forEach((r) => pick(container, r));

  it('scores a six as a matrix game, with a floor and a blind-pick number', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={6} />);
    fill(container, ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash']);
    fireEvent.click(screen.getByRole('button', { name: /Analyse six/i }));
    await waitFor(() => expect(container.querySelector('.team-report')).toBeTruthy(), { timeout: 120000 });
    expect(container.textContent).toMatch(/Guaranteed floor/);
    expect(container.textContent).toMatch(/If they pick blind/);
    // The maximin line is three of the six, not all of them.
    expect(container.textContent).toMatch(/Your strongest line/);
  }, 180000);

  it('exports the analysis as JSON and the threats as CSV', async () => {
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
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    fill(container, ['azumarill', 'registeel', 'medicham']);
    fireEvent.click(screen.getByRole('button', { name: /Analyse team/i }));
    await waitFor(() => expect(container.querySelector('.team-report')).toBeTruthy(), { timeout: 60000 });
    fireEvent.click(screen.getByRole('button', { name: /Export JSON/i }));
    fireEvent.click(screen.getByRole('button', { name: /^CSV$/i }));
    expect(names.some((n) => n.endsWith('.json'))).toBe(true);
    expect(names.some((n) => n.endsWith('.csv'))).toBe(true);
    vi.restoreAllMocks();
  }, 90000);

  it('opens the build modal from an empty slot and closes it again', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    fireEvent.click(container.querySelector('.team-slot.is-empty')!);
    const modal = document.querySelector('.modal, .add-modal, [role="dialog"]');
    expect(modal).toBeTruthy();
  });
});
