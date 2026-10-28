import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { BattleScreen } from '../BattleScreen';
import { MATRIX_STORE_KEY } from '../MatrixBattle';
import { bestSpreadFor } from '../../lib/engine';
import { META_SIZE } from '../../lib/battleMatrix';

/** Battle → Matrix, driven the way a player would: lists edited in place, a meta filled in, every view read. */

const entry = (key: string, ref: string, a: number, d: number, s: number) => ({ key, ref, fastIdx: 0, chargeIds: [], iv: { a, d, s } });

function seed(left: unknown[], right: unknown[] = []) {
  localStorage.setItem(MATRIX_STORE_KEY, JSON.stringify({ great: { left: { entries: left, shields: 1 }, right: { entries: right, shields: 1 } } }));
}

async function openMatrix() {
  const view = renderApp(<BattleScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Matrix' }));
  await screen.findByRole('region', { name: 'Your Pokémon' }, { timeout: 10000 });
  return view;
}

const side = (name: 'Your Pokémon' | 'Opponents') => screen.getByRole('region', { name });

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = (() => 'blob:x') as never;
  URL.revokeObjectURL = (() => {}) as never;
});

describe('Battle → Matrix', () => {
  it('switches modes, and asks for both sides before showing a matrix', async () => {
    await openMatrix();
    expect(screen.getByText(/Add at least one Pokémon on each side/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    expect(screen.queryByRole('region', { name: 'Your Pokémon' })).toBeNull();
  });

  it('quick-fills a side with a meta and fights every pairing', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6), entry('b', 'cramorant', 8, 11, 5)]);
    const { container } = await openMatrix();
    fireEvent.change(screen.getByLabelText('Quick fill Opponents'), { target: { value: 'meta:great' } });
    expect(within(side('Opponents')).getAllByRole('listitem').length).toBe(META_SIZE);
    await waitFor(() => expect(container.querySelectorAll('.bm-table tbody tr').length).toBe(2));
    expect(container.querySelectorAll('.bm-table tbody .bm-val').length).toBe(2 * META_SIZE);
    // Kept per league across a reload.
    const stored = JSON.parse(localStorage.getItem(MATRIX_STORE_KEY)!);
    expect(stored.great.right.entries.length).toBe(META_SIZE);
  });

  it('edits IVs in place, sets a whole side to rank 1, duplicates, removes and clears', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('z', 'azumarill', 0, 15, 15)]);
    await openMatrix();
    const left = side('Your Pokémon');
    // The Analyze screen's appraisal bars, on the card.
    const ivs = within(left).getByRole('group', { name: 'Cramorant IVs' });
    // Sword, shield and heart stand in for the words; the sliders keep them as their names.
    expect(ivs.querySelectorAll('.iv-label.is-icon svg').length).toBe(3);
    expect(ivs.querySelector('.iv-label:not(.is-icon)')).toBeNull();
    const atk = within(ivs).getByRole('slider', { name: 'Attack' });
    expect(atk.getAttribute('aria-valuenow')).toBe('8');
    fireEvent.click(within(ivs).getByRole('button', { name: 'Increase Attack' }));
    expect(within(ivs).getByRole('slider', { name: 'Attack' }).getAttribute('aria-valuenow')).toBe('9');
    fireEvent.keyDown(within(ivs).getByRole('slider', { name: 'Attack' }), { key: 'End' });
    expect(within(ivs).getByRole('slider', { name: 'Attack' }).getAttribute('aria-valuenow')).toBe('15');

    // Moves are picked on the card: the fast move, and either charged move (the second can be dropped).
    const fast = within(left).getByLabelText('Cramorant fast move') as HTMLSelectElement;
    const other = [...fast.options].find((o) => o.value !== fast.value)!.value;
    fireEvent.change(fast, { target: { value: other } });
    expect((within(left).getByLabelText('Cramorant fast move') as HTMLSelectElement).value).toBe(other);
    const c1 = within(left).getByLabelText('Cramorant charged move 1') as HTMLSelectElement;
    const swap = [...c1.options].find((o) => o.value !== c1.value)!.value;
    fireEvent.change(c1, { target: { value: swap } });
    expect((within(left).getByLabelText('Cramorant charged move 1') as HTMLSelectElement).value).toBe(swap);
    fireEvent.change(within(left).getByLabelText('Cramorant charged move 2'), { target: { value: '' } });
    expect((within(left).getByLabelText('Cramorant charged move 2') as HTMLSelectElement).value).toBe('');
    fireEvent.change(within(left).getByLabelText('Cramorant charged move 1'), { target: { value: '' } });
    expect((within(left).getByLabelText('Cramorant charged move 1') as HTMLSelectElement).value).toBe(swap);

    fireEvent.click(within(left).getByRole('button', { name: 'Duplicate Cramorant' }));
    expect(within(left).getAllByRole('listitem').length).toBe(2);

    fireEvent.click(within(left).getByRole('button', { name: 'All rank 1' }));
    const best = bestSpreadFor('cramorant', 'great');
    for (const g of within(left).getAllByRole('group', { name: 'Cramorant IVs' })) {
      expect(within(g).getByRole('slider', { name: 'Defense' }).getAttribute('aria-valuenow')).toBe(String(best.d));
    }
    expect(within(left).getAllByText('#1').length).toBe(2);

    fireEvent.click(within(left).getAllByRole('button', { name: 'Remove Cramorant' })[0]);
    expect(within(left).getAllByRole('listitem').length).toBe(1);
    fireEvent.click(within(left).getByRole('button', { name: 'Clear' }));
    expect(within(left).getByText('No Pokémon yet.')).toBeTruthy();
  });

  it('changes shields per side, and reads every view with its Differences', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6), entry('b', 'cramorant', 1, 2, 13), entry('c', 'jellicent', 1, 14, 14)],
      [entry('x', 'azumarill', 0, 15, 15), entry('y', 'medicham', 0, 15, 15), entry('w', 'registeel', 0, 15, 15)]);
    const { container } = await openMatrix();
    fireEvent.click(within(side('Opponents')).getByRole('button', { name: '2' }));
    fireEvent.click(within(side('Your Pokémon')).getByRole('button', { name: '0' }));
    await waitFor(() => expect(container.querySelector('.bm-results.is-stale')).toBeNull());
    const diffs = screen.getByRole('region', { name: 'Differences' });
    expect(within(diffs).getByText('Baseline')).toBeTruthy();

    for (const tab of ['Breakpoints', 'Bulkpoints', 'CMP', 'Battle Rating']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true');
      expect(!!screen.queryByLabelText('Move')).toBe(tab === 'Breakpoints' || tab === 'Bulkpoints');
      expect(!!container.querySelector('.bm-table .bm-cmp')).toBe(tab === 'CMP');
      expect(screen.getByRole('button', { name: /Record/ }).textContent).toMatch(tab === 'CMP' ? /CMP Record/ : /^Record/);
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Breakpoints' }));
    fireEvent.change(screen.getByLabelText('Move'), { target: { value: 'charge1' } });
    expect(within(diffs).getByText(/charged move 1/)).toBeTruthy();

    // Jellicent against a Cramorant baseline differs somewhere on damage.
    expect(container.querySelectorAll('.bm-diff-row')[2].querySelectorAll('.bm-chip').length).toBeGreaterThan(0);

    // A different baseline moves the marker.
    fireEvent.change(within(diffs).getByLabelText('Compare against'), { target: { value: 'c' } });
    expect(container.querySelectorAll('.bm-diff-row')[2].classList.contains('is-base')).toBe(true);
  });

  it('sorts by a column, toggles, and goes back to list order', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6), entry('c', 'jellicent', 1, 14, 14), entry('b', 'medicham', 0, 15, 15)],
      [entry('x', 'azumarill', 0, 15, 15), entry('y', 'registeel', 0, 15, 15)]);
    const { container } = await openMatrix();
    const order = () => [...container.querySelectorAll('.bm-table tbody .bm-pos')].map((n) => n.textContent);
    await waitFor(() => expect(order()).toEqual(['1', '2', '3']));
    const heads = container.querySelectorAll<HTMLButtonElement>('.bm-colhead .bm-sort');
    fireEvent.click(heads[0]);
    const desc = order();
    fireEvent.click(heads[0]);
    expect(order()).toEqual([...desc].reverse());
    fireEvent.click(screen.getByRole('button', { name: /Record/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Bulkpoints' }));
    fireEvent.click(screen.getByRole('button', { name: 'Average' }));
    expect(screen.getByRole('button', { name: /List order/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /List order/ }));
    expect(order()).toEqual(['1', '2', '3']);
  });

  it('exports the view on show as CSV', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)], [entry('x', 'azumarill', 0, 15, 15)]);
    await openMatrix();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export to CSV' }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('adds through the Add Pokémon dialog and edits an entry in it', async () => {
    seed([entry('a', 'cramorant', 8, 9, 6)]);
    await openMatrix();
    fireEvent.click(within(side('Opponents')).getByRole('button', { name: '+ Add Pokémon' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a Pokémon' });
    const input = dialog.querySelector('input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Medicham' } });
    const row = await waitFor(() => {
      const hit = [...document.querySelectorAll('.search-dropdown .search-row')].find((r) => /^Medicham$/i.test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''));
      if (!hit) throw new Error('no Medicham');
      return hit;
    }, { timeout: 10000 });
    fireEvent.mouseDown(row);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to opponents' }));
    expect(within(side('Opponents')).getByText('Medicham')).toBeTruthy();

    fireEvent.click(within(side('Your Pokémon')).getByTitle("Change Cramorant's species or form"));
    const edit = screen.getByRole('dialog', { name: 'Edit a Pokémon' });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save changes' }));
    expect(within(side('Your Pokémon')).getAllByRole('listitem').length).toBe(1);
  });

  it('ignores a stored list it cannot read', async () => {
    localStorage.setItem(MATRIX_STORE_KEY, '{not json');
    await openMatrix();
    expect(within(side('Your Pokémon')).getByText('No Pokémon yet.')).toBeTruthy();
  });
});
