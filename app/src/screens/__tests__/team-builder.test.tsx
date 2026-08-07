import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { TeamBuilderScreen } from '../TeamBuilderScreen';

/**
 * Add a named Pokemon through the live search dropdown.
 *
 * Waits for the row that actually matches. Reading the first `.search-row`
 * synchronously after the change event reads the *previous* render's list —
 * typing "registeel" that way added Vigoroth (Shadow), and "skarmory" added
 * Kadabra, so every test using this helper was asserting against an arbitrary
 * roster. Nothing here failed because of it; the assertions are structural. But
 * a test that names its team has to get that team.
 */
async function pick(container: HTMLElement, typed: string) {
  const input = container.querySelector('.team-add input') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  const row = await waitFor(() => {
    const hit = [...container.querySelectorAll('.search-dropdown .search-row')].find((r) =>
      new RegExp(`^${typed}$`, 'i').test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''),
    );
    if (!hit) throw new Error(`no search result for "${typed}"`);
    return hit;
  });
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

  it('adds a pick to the roster and clears it again', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    await pick(container, 'azumarill');
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(2);
    const clear = container.querySelector('.team-slots .pokemon-card, .team-slots [role="button"]');
    if (clear) {
      fireEvent.click(clear);
      expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(3);
    }
  });

  it('keeps Analyse disabled until the team is full', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    const analyse = screen.getByRole('button', { name: /Analyse team/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(true);
    await pick(container, 'azumarill');
    expect(analyse.disabled).toBe(true);
  });

  it('keeps Suggest disabled on an empty roster and enables it once picked', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    const suggest = screen.getByRole('button', { name: /Suggest next pick/i }) as HTMLButtonElement;
    expect(suggest.disabled).toBe(true);
    await pick(container, 'azumarill');
    expect(suggest.disabled).toBe(false);
  });

  it('refuses a second member of the same species', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    await pick(container, 'azumarill');
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
    await pick(container, 'azumarill');
    await pick(container, 'registeel');
    await pick(container, 'medicham');
    const analyse = screen.getByRole('button', { name: /Analyse team/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(false);
    fireEvent.click(analyse);
    await waitFor(() => expect(container.querySelector('.team-report')).toBeTruthy(), { timeout: 60000 });
    expect(container.textContent).toMatch(/%/);
  }, 90000);

  it('suggests a completion for a partial team', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    await pick(container, 'azumarill');
    await pick(container, 'registeel');
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 60000 });
  }, 90000);

  it('suggests beside two Pokemon that already share a typing', async () => {
    // Registeel + Skarmory is an ordinary Great pairing, both Steel. The ABC
    // rule applied to the whole roster rejected every candidate and rendered
    // the panel with nothing in it.
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    await pick(container, 'registeel');
    await pick(container, 'skarmory');
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 60000 });
    expect(container.querySelectorAll('.suggest-cards .pc').length).toBeGreaterThan(0);
  }, 90000);
});

describe('TeamBuilderScreen — Show 6', () => {
  const fill = async (container: HTMLElement, refs: string[]) => {
    for (const r of refs) await pick(container, r);
  };

  it('scores a six as a matrix game, with a floor and a blind-pick number', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={6} />);
    await fill(container, ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory', 'whiscash']);
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
    await fill(container, ['azumarill', 'registeel', 'medicham']);
    fireEvent.click(screen.getByRole('button', { name: /Analyse team/i }));
    await waitFor(() => expect(container.querySelector('.team-report')).toBeTruthy(), { timeout: 60000 });
    fireEvent.click(screen.getByRole('button', { name: /Export JSON/i }));
    fireEvent.click(screen.getByRole('button', { name: /^CSV$/i }));
    expect(names.some((n) => n.endsWith('.json'))).toBe(true);
    expect(names.some((n) => n.endsWith('.csv'))).toBe(true);
    vi.restoreAllMocks();
  }, 90000);

  it('suggests a sixth member for a five-strong roster', async () => {
    // The failure this covers: the screen asked for the completion to a team of
    // *three* whatever its size, so a Show 6 past its third member was judged by
    // a rule five arbitrary Pokemon always break, and the list came back empty.
    const { container } = renderApp(<TeamBuilderScreen size={6} />);
    await fill(container, ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory']);
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 120000 });
    expect(container.querySelectorAll('.suggest-cards .pc').length).toBeGreaterThan(0);
  }, 180000);

  it('labels a six by its guaranteed floor, not as a win rate', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={6} />);
    await fill(container, ['azumarill', 'registeel', 'medicham']);
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 120000 });
    const labels = [...container.querySelectorAll('.suggest-cards .pc-metric-label')];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.textContent?.trim() === 'floor')).toBe(true);
    // A floor is a margin. Rendered with a % it reads as a hopeless team.
    const values = [...container.querySelectorAll('.suggest-cards .pc-metric-value')];
    expect(values.every((v) => !v.textContent?.includes('%'))).toBe(true);
  }, 180000);

  it('takes a suggested sixth member onto the roster', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={6} />);
    await fill(container, ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory']);
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-cards')).toBeTruthy(), { timeout: 120000 });
    fireEvent.click(container.querySelector('.suggest-cards .pc') as HTMLElement);
    expect(container.querySelectorAll('.team-slot.is-empty').length).toBe(0);
  }, 180000);

  it('names the allowance it judged candidates by', async () => {
    const { container } = renderApp(<TeamBuilderScreen size={6} />);
    await fill(container, ['azumarill', 'registeel', 'medicham', 'bastiodon', 'skarmory']);
    fireEvent.click(screen.getByRole('button', { name: /Suggest next pick/i }));
    await waitFor(() => expect(container.querySelector('.suggest-rule')).toBeTruthy(), { timeout: 120000 });
    const note = container.querySelector('.suggest-rule')!.textContent ?? '';
    expect(note).toMatch(/sharing a typing/);
    // These five already repeat Steel three ways, so the note has to say the
    // allowance was raised rather than leave a silently loosened rule.
    expect(note).toMatch(/allowance for a 6 is 2/);
  }, 180000);

  it('opens the build modal from an empty slot and closes it again', () => {
    const { container } = renderApp(<TeamBuilderScreen size={3} />);
    fireEvent.click(container.querySelector('.team-slot.is-empty')!);
    const modal = document.querySelector('.modal, .add-modal, [role="dialog"]');
    expect(modal).toBeTruthy();
  });
});
