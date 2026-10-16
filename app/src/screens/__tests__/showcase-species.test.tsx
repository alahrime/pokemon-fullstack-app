import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import {
  BASE_ROSTER, LEAGUES, ROSTER, SHOWCASE_IDS, SPECIES_BY_ID, everyRefFor, opponentsFor, pickableFor,
} from '../../lib/data';
import { SpeciesSearch } from '../../components/SpeciesSearch';
import { ReportScreen } from '../ReportScreen';
import { LandingScreen } from '../LandingScreen';

/**
 * Shedinja is in the data only to be shown (GO bars it from Trainer Battles): a profile favourite and a Report card
 * with a notice, never a team member, an opponent or a format's pool.
 */
afterEach(cleanup);

/** Types into a search and returns the names it offers. */
async function offered(container: HTMLElement, typed: string): Promise<string[]> {
  const input = container.querySelector('input') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  // Past the search's debounce, so the rows are this query's and not the empty box's draw.
  await act(() => new Promise((r) => setTimeout(r, 400)));
  return [...container.querySelectorAll('.search-dropdown .search-row .search-row-name')].map((n) => n.textContent?.trim() ?? '');
}

describe('a showcase-only species', () => {
  it('is in the data, flagged, with no league', () => {
    const s = SPECIES_BY_ID.get('shedinja')!;
    expect(s.showcaseOnly).toBe(true);
    expect(s.leagues).toEqual([]);
    expect(SHOWCASE_IDS.has('shedinja')).toBe(true);
  });

  it('is held out of every roster, picker and pool', () => {
    expect(ROSTER.some((r) => r.ref.startsWith('shedinja'))).toBe(false);
    expect(BASE_ROSTER.some((r) => r.ref === 'shedinja')).toBe(false);
    for (const lg of LEAGUES) {
      expect(pickableFor(lg.id)).not.toContain('shedinja');
      expect(everyRefFor(lg.id)).not.toContain('shedinja');
      expect(opponentsFor(lg.id).map((s) => s.id)).not.toContain('shedinja');
    }
  });

  it('is offered only by a search that opts in', async () => {
    const plain = renderApp(<SpeciesSearch id="a" value="" startEmpty onChange={() => {}} />);
    expect(await offered(plain.container, 'shedin')).not.toContain('Shedinja');
    cleanup();
    const opted = renderApp(<SpeciesSearch id="b" value="" startEmpty includeShowcase onChange={() => {}} />);
    expect(await offered(opted.container, 'shedin')).toContain('Shedinja');
  });

  it('gets a card and a notice on the Report, not ranks or matchups', async () => {
    const { container } = renderApp(<ReportScreen />);
    // The column's own search (the pinned phone copy comes first in the DOM).
    const boxes = container.querySelectorAll('input[role=combobox]');
    const input = boxes[boxes.length - 1] as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'shedinja' } });
    const row = await waitFor(() => {
      const hit = [...container.querySelectorAll('.search-dropdown .search-row')].find((r) => /^Shedinja$/.test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''));
      if (!hit) throw new Error('no Shedinja row');
      return hit;
    });
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(await screen.findByRole('note')).toHaveTextContent(/can't be used in Trainer Battles or GO Battle League/);
    expect(container.querySelector('.league-verdicts')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Shedinja' })).toBeInTheDocument();
  });

  it('is offered by the home page search', async () => {
    const { container } = renderApp(<LandingScreen />);
    expect(await offered(container, 'shedinja')).toContain('Shedinja');
  });
});
